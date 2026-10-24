"""Normalize native PostgreSQL URLs for SQLAlchemy's asyncpg driver."""
from sqlalchemy.engine import make_url
from sqlalchemy.pool import NullPool

def engine_options(raw_url: str):
    url = make_url(raw_url)
    if url.drivername.startswith("sqlite"):
        return url, {"connect_args": {"check_same_thread": False}}
    if url.drivername not in {"postgres", "postgresql", "postgresql+asyncpg"}:
        raise ValueError("Use a native postgresql:// URL. Prisma Accelerate prisma:// and prisma+postgres:// URLs cannot be used by asyncpg.")
    query = dict(url.query)
    query["prepared_statement_cache_size"] = "0"
    # These options belong to Prisma/libpq, not asyncpg.connect().
    ssl_mode = query.pop("sslmode", None)
    for key in ("pgbouncer", "connection_limit", "pool_timeout", "schema", "channel_binding"):
        query.pop(key, None)
    connect_args = {"statement_cache_size": 0}
    if ssl_mode:
        connect_args["ssl"] = ssl_mode
    url = url.set(drivername="postgresql+asyncpg", query=query)
    return url, {"connect_args": connect_args, "poolclass": NullPool, "pool_pre_ping": True}
