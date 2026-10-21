import pytest
import pytest_asyncio
from sqlalchemy import create_engine, text, inspect
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from fastapi import HTTPException
from app.db.session import Base
from app.db.migrations import ensure_tenant_schema
from app.api import auth
from app.models.user import User


def test_upgrade_legacy_database_is_idempotent(tmp_path):
    engine = create_engine('sqlite:///' + str(tmp_path / 'legacy.db'))
    with engine.begin() as conn:
        conn.execute(text('CREATE TABLE users (id VARCHAR(255) PRIMARY KEY, email VARCHAR(254), display_name VARCHAR(200), created_at DATETIME)'))
        conn.execute(text('CREATE TABLE bots (id VARCHAR(36) PRIMARY KEY, name VARCHAR(100))'))
        ensure_tenant_schema(conn)
        ensure_tenant_schema(conn)
        assert 'tenant_id' in {c['name'] for c in inspect(conn).get_columns('bots')}
        assert 'google_subject' in {c['name'] for c in inspect(conn).get_columns('users')}
    engine.dispose()


@pytest_asyncio.fixture
async def db(tmp_path):
    engine = create_async_engine('sqlite+aiosqlite:///' + str(tmp_path / 'auth.db'))
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False)() as session:
        yield session
    await engine.dispose()


@pytest.mark.asyncio
async def test_google_signin_creates_then_reuses_workspace(db, monkeypatch):
    monkeypatch.setattr(auth, 'verify_google_credential', lambda _: {'sub':'google-123','email':'owner@gmail.com','email_verified':True,'name':'Owner'})
    body = auth.GoogleLoginRequest(credential='x' * 40)
    first = await auth.verify_google_login(body, db)
    second = await auth.verify_google_login(body, db)
    assert first['id'] == second['id'] == auth.account_id_for('owner@gmail.com')
    assert (await db.get(User, first['id'])).google_subject == 'google-123'


@pytest.mark.asyncio
async def test_google_cannot_take_existing_third_party_email(db, monkeypatch):
    db.add(User(id='existing-owner',email='person@example.org'))
    await db.commit()
    monkeypatch.setattr(auth, 'verify_google_credential', lambda _: {'sub':'google-123','email':'person@example.org','email_verified':True})
    with pytest.raises(HTTPException) as error:
        await auth.verify_google_login(auth.GoogleLoginRequest(credential='x'*40), db)
    assert error.value.status_code == 409
    assert (await db.get(User, 'existing-owner')).google_subject is None


@pytest.mark.asyncio
async def test_google_links_authoritative_gmail_to_existing_workspace(db, monkeypatch):
    db.add(User(id='existing-owner',email='person@gmail.com'))
    await db.commit()
    monkeypatch.setattr(auth, 'verify_google_credential', lambda _: {'sub':'google-123','email':'person@gmail.com','email_verified':True})
    account = await auth.verify_google_login(auth.GoogleLoginRequest(credential='x'*40), db)
    assert account['id'] == 'existing-owner'


def test_google_rejects_unsigned_or_wrong_audience_tokens(monkeypatch):
    monkeypatch.setenv('GOOGLE_AUTH_CLIENT_ID','test.apps.googleusercontent.com')
    with pytest.raises(HTTPException) as error:
        auth.verify_google_credential('not-a-signed-google-token')
    assert error.value.status_code == 401
