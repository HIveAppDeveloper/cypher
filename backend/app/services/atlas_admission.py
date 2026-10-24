"""Shared, hash-only admission for the stateless Atlas inference boundary.

The gate row serializes admission across PostgreSQL processes. A nonce is
committed before inference can start and is retained after lease release, so
response loss cannot turn a retry into another model call. No request content,
raw identity, signing secret, or model credential is stored.
"""
import asyncio
import hashlib
import json
import logging
import os
import secrets
from urllib.parse import urlsplit
from dataclasses import dataclass
from contextlib import asynccontextmanager, suppress

from sqlalchemy import BigInteger, Column, Index, Integer, MetaData, String, Table, and_, cast, delete, func, insert, select, text, update
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from app.config import settings
from app.db.session import Base

logger = logging.getLogger(__name__)
SERVICE = "atlas-inference-v1"
NONCE_RETENTION_MS = 24 * 60 * 60 * 1000
LEASE_GRACE_MS = 10_000
STORE_TIMEOUT_SECONDS = 3
STORE_CLEANUP_SECONDS = 0.25
CLEANUP_BATCH = 256
JANITOR_SECONDS = 60
MAX_INFLIGHT = 16
MAX_PER_PRINCIPAL = 2

# Separate metadata prevents ordinary workspace create_all from introducing
# these tables when the engine feature is disabled.
metadata = MetaData(schema=Base.metadata.schema)
gate = Table("atlas_engine_admission_gate", metadata,
    Column("service", String(40), primary_key=True),
    Column("revision", Integer, nullable=False),
)
nonces = Table("atlas_engine_inference_leases", metadata,
    Column("nonce_hash", String(64), primary_key=True),
    Column("service", String(40), nullable=False),
    Column("principal_hash", String(64), nullable=False),
    Column("body_hash", String(64), nullable=False),
    Column("ownership_hash", String(64), nullable=False),
    Column("admitted_at_ms", BigInteger, nullable=False),
    Column("lease_expires_at_ms", BigInteger, nullable=False),
    Column("retain_until_ms", BigInteger, nullable=False),
    Column("released_at_ms", BigInteger),
)
Index("ix_atlas_engine_active_leases", nonces.c.service, nonces.c.released_at_ms, nonces.c.lease_expires_at_ms)
Index("ix_atlas_engine_principal_leases", nonces.c.service, nonces.c.principal_hash, nonces.c.released_at_ms, nonces.c.lease_expires_at_ms)
Index("ix_atlas_engine_nonce_expiry", nonces.c.service, nonces.c.retain_until_ms)


class AdmissionUnavailable(RuntimeError):
    """Store/schema/commit uncertainty: fail closed, do not invoke inference."""


class AdmissionDenied(RuntimeError):
    def __init__(self, status, code):
        self.status = status
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class Lease:
    nonce_hash: str
    ownership_token: str


def digest(*parts):
    return hashlib.sha256(json.dumps(parts, ensure_ascii=True, separators=(",", ":")).encode()).hexdigest()


def hosted_environment():
    return bool(os.getenv("VERCEL") or os.getenv("VERCEL_DEPLOYMENT_ID") or os.getenv("VERCEL_ENV") or any(os.getenv(name, "").lower() == "production" for name in ("NODE_ENV", "APP_ENV", "ENVIRONMENT")))


def local_admission_allowed():
    try:
        origin = urlsplit(settings.GROKBOT_PUBLIC_URL)
    except ValueError:
        return False
    return settings.GROKBOT_ATLAS_ENGINE_ALLOW_LOCAL_ADMISSION and not hosted_environment() and origin.scheme == "http" and origin.hostname in {"localhost", "127.0.0.1", "::1"}


async def initialize_admission_schema(connection):
    """Called under the existing bootstrap migration lock, only when opted in."""
    if not settings.GROKBOT_ATLAS_ENGINE_ENABLED or settings.GROKBOT_ATLAS_ENGINE_ADMISSION != "postgres":
        return
    if connection.dialect.name != "postgresql":
        raise AdmissionUnavailable("Shared PostgreSQL admission is required")
    await connection.run_sync(metadata.create_all)


class DurableAdmission:
    def __init__(self, sessions, database_engine, *, allow_sqlite=False):
        self.sessions = sessions
        self.engine = database_engine
        self.allow_sqlite = allow_sqlite

    def _dialect(self):
        dialect = self.engine.dialect.name
        if dialect == "postgresql":
            return dialect
        if dialect == "sqlite" and self.allow_sqlite and not hosted_environment():
            return dialect
        raise AdmissionUnavailable("Shared PostgreSQL admission is required")

    @asynccontextmanager
    async def _session(self):
        # A timeout has already delivered its cancellation when transaction
        # rollback starts. Give rollback AND session finalization fresh bounded
        # scopes rather than accidentally waiting forever inside that handler.
        resource = self.sessions()
        db = None
        failed = False
        try:
            db = await resource.__aenter__()
            yield db
        except BaseException:
            failed = True
            if db is not None:
                with suppress(Exception):
                    async with asyncio.timeout(STORE_CLEANUP_SECONDS):
                        await db.rollback()
            raise
        finally:
            if db is not None:
                try:
                    async with asyncio.timeout(STORE_CLEANUP_SECONDS):
                        await resource.__aexit__(None, None, None)
                except Exception:
                    if not failed:
                        raise AdmissionUnavailable("Shared admission cleanup could not be confirmed") from None

    async def _begin(self, db, dialect):
        if dialect == "sqlite":
            # SQLite has no row locks. The temporary-file contract test uses
            # its real single-writer lock across independent connections.
            await db.execute(text("BEGIN IMMEDIATE"))
        else:
            await db.begin()
            await db.execute(text("SET TRANSACTION ISOLATION LEVEL READ COMMITTED"))
            await db.execute(text("SET LOCAL synchronous_commit = 'on'"))
            await db.execute(text("SET LOCAL lock_timeout = '1500ms'"))
            await db.execute(text("SET LOCAL statement_timeout = '2500ms'"))

    async def _now(self, db, dialect):
        expression = cast(func.extract("epoch", func.clock_timestamp()) * 1000, BigInteger) if dialect == "postgresql" else cast((func.julianday("now") - 2440587.5) * 86400000, BigInteger)
        return int(await db.scalar(select(expression)))

    async def _lock(self, db, dialect):
        make_insert = postgres_insert if dialect == "postgresql" else sqlite_insert
        await db.execute(make_insert(gate).values(service=SERVICE, revision=1).on_conflict_do_nothing(index_elements=[gate.c.service]))
        revision = await db.scalar(select(gate.c.revision).where(gate.c.service == SERVICE).with_for_update())
        if revision != 1:
            raise AdmissionUnavailable("Admission schema revision is unavailable")

    async def _cleanup(self, db, now):
        expired = select(nonces.c.nonce_hash).where(nonces.c.service == SERVICE, nonces.c.retain_until_ms <= now, nonces.c.lease_expires_at_ms <= now).order_by(nonces.c.retain_until_ms, nonces.c.nonce_hash).limit(CLEANUP_BATCH)
        result = await db.execute(delete(nonces).where(nonces.c.nonce_hash.in_(expired)))
        return result.rowcount

    async def acquire(self, *, tenant_id, actor_id, request_id, raw_body, timeout_ms):
        dialect = self._dialect()
        principal = digest(SERVICE, tenant_id, actor_id)
        nonce = digest(SERVICE, tenant_id, actor_id, request_id)
        body_hash = hashlib.sha256(raw_body).hexdigest()
        token = secrets.token_urlsafe(32)
        try:
            async with asyncio.timeout(STORE_TIMEOUT_SECONDS):
                async with self._session() as db:
                    await self._begin(db, dialect)
                    await self._lock(db, dialect)
                    now = await self._now(db, dialect)
                    await self._cleanup(db, now)
                    existing = (await db.execute(select(nonces.c.body_hash).where(nonces.c.nonce_hash == nonce))).first()
                    if existing:
                        raise AdmissionDenied(409, "request_replayed" if existing.body_hash == body_hash else "request_conflict")
                    live = and_(nonces.c.service == SERVICE, nonces.c.released_at_ms.is_(None), nonces.c.lease_expires_at_ms > now)
                    count = await db.scalar(select(func.count()).select_from(nonces).where(live))
                    own = await db.scalar(select(func.count()).select_from(nonces).where(live, nonces.c.principal_hash == principal))
                    if count >= MAX_INFLIGHT or own >= MAX_PER_PRINCIPAL:
                        raise AdmissionDenied(429, "engine_busy")
                    await db.execute(insert(nonces).values(nonce_hash=nonce, service=SERVICE, principal_hash=principal, body_hash=body_hash, ownership_hash=digest(token), admitted_at_ms=now, lease_expires_at_ms=now + min(30_000, max(100, timeout_ms)) + LEASE_GRACE_MS, retain_until_ms=now + NONCE_RETENTION_MS))
                    # A failed/uncertain commit never authorizes a model call.
                    # If committed remotely, its nonce still prevents replay.
                    await db.commit()
        except AdmissionDenied:
            raise
        except asyncio.CancelledError:
            raise
        except Exception:
            raise AdmissionUnavailable("Shared admission could not be confirmed") from None
        return Lease(nonce, token)

    async def release(self, lease):
        dialect = self._dialect()
        try:
            async with asyncio.timeout(STORE_TIMEOUT_SECONDS):
                async with self._session() as db:
                    await self._begin(db, dialect)
                    now = await self._now(db, dialect)
                    # Ownership comparison makes release idempotent and prevents
                    # an old worker releasing a later lease after nonce cleanup.
                    result = await db.execute(update(nonces).where(nonces.c.nonce_hash == lease.nonce_hash, nonces.c.ownership_hash == digest(lease.ownership_token), nonces.c.released_at_ms.is_(None)).values(released_at_ms=now))
                    await db.commit()
                    return bool(result.rowcount)
        except asyncio.CancelledError:
            raise
        except Exception:
            raise AdmissionUnavailable("Shared admission release could not be confirmed") from None

    async def cleanup(self):
        dialect = self._dialect()
        try:
            async with asyncio.timeout(STORE_TIMEOUT_SECONDS):
                async with self._session() as db:
                    await self._begin(db, dialect)
                    await self._lock(db, dialect)
                    now = await self._now(db, dialect)
                    count = await self._cleanup(db, now)
                    await db.commit()
                    return count
        except asyncio.CancelledError:
            raise
        except Exception:
            raise AdmissionUnavailable("Shared admission cleanup could not be confirmed") from None


async def run_admission_janitor():
    """Finite, bounded TTL cleanup while the existing API process is alive."""
    from app.db.session import AsyncSessionLocal, engine
    store = DurableAdmission(AsyncSessionLocal, engine)
    while True:
        try:
            await store.cleanup()
        except AdmissionUnavailable:
            logger.warning("Atlas inference admission cleanup unavailable")
        await asyncio.sleep(JANITOR_SECONDS)
