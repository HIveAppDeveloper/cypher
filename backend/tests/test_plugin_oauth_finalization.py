"""Real PostgreSQL lock ordering for OAuth replacement with identical tools."""
import asyncio
import copy
import hashlib
import json
import os
import time
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import event, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import plugin_catalog
from app.config import settings
from app.db.session import Base
from app.db.tenancy import current_tenant_id
from app.models.plugin import Plugin, PluginAuthorization
from app.services.plugins import seal


@pytest_asyncio.fixture
async def postgres_store(monkeypatch):
    uri = os.getenv('CYPHER_PLUGIN_TEST_POSTGRES_URL')
    if not uri:
        pytest.skip('Requires an owned Unix-socket-only disposable PostgreSQL')
    parsed = make_url(uri)
    assert parsed.host is None and parsed.database == 'postgres'
    assert parsed.query.get('host', '').startswith('/private/tmp/cypher-plugin-oauth-pg-')
    schema = 'e2e_plugin_oauth_' + uuid4().hex
    app_name = 'plugin-oauth-' + uuid4().hex
    engine = create_async_engine(uri, execution_options={'schema_translate_map': {None: schema}},
                                 connect_args={'server_settings': {'application_name': app_name}})
    observer = create_async_engine(uri, isolation_level='AUTOCOMMIT')
    monkeypatch.setattr(settings, 'BACKEND_API_TOKEN', 'synthetic-oauth-lock-key-not-for-production')
    async with engine.begin() as conn:
        await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
        await conn.run_sync(Base.metadata.create_all)
    tenant = current_tenant_id.set('oauth-lock-owner')
    try:
        yield engine, observer, async_sessionmaker(engine, expire_on_commit=False), app_name
    finally:
        current_tenant_id.reset(tenant)
        async with engine.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await observer.dispose()
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize('mode', ['authorize', 'callback'])
async def test_identical_tool_oauth_replacement_waits_for_current_connection_transaction(postgres_store, monkeypatch, mode):
    engine, observer, sessions, app_name = postgres_store
    entered, release = asyncio.Event(), asyncio.Event()
    tools = [{'name': 'read', 'description': 'Read', 'schema': {'type': 'object'}, 'enabled': True}]
    state, binding = 'synthetic-state-' + uuid4().hex, 'synthetic-binding-' + uuid4().hex

    async def noop(*args, **kwargs):
        pass

    async def exchange(*args, **kwargs):
        return httpx.Request('POST', 'https://synthetic.example/token')

    async def provider(*args, **kwargs):
        return SimpleNamespace(_initialize=noop, _exchange_token_authorization_code=exchange,
                               _handle_token_response=noop)

    async def discover(*args, **kwargs):
        entered.set()
        await release.wait()
        return copy.deepcopy(tools)

    from app.api import device
    monkeypatch.setattr(device, 'require_device', noop)
    monkeypatch.setattr(plugin_catalog, 'validate_endpoint', noop)
    monkeypatch.setattr(plugin_catalog, 'make_provider', provider)
    monkeypatch.setattr(plugin_catalog, 'discover', discover)
    monkeypatch.setattr(plugin_catalog, 'http_client', lambda: httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json={'access_token': 'synthetic-token'}))))
    async with sessions() as db:
        plugin = Plugin(name='Existing', url='https://synthetic.example/mcp', tools=copy.deepcopy(tools), enabled=True)
        db.add(plugin)
        await db.flush()
        pid = plugin.id
        old = PluginAuthorization(name=plugin.name, url=plugin.url, plugin_id=pid, status='connected', created_at=time.time())
        db.add(old)
        await db.flush()
        old_id = old.id
        if mode == 'callback':
            db.add(PluginAuthorization(name=plugin.name, url=plugin.url, plugin_id=pid, status='awaiting_login',
                                       created_at=time.time(), state_hash=hashlib.sha256(state.encode()).hexdigest(),
                                       binding_hash=hashlib.sha256(binding.encode()).hexdigest(),
                                       payload=seal(json.dumps({'verifier': 'synthetic-verifier'}))))
        await db.commit()

    updates = []
    def observe(_conn, _cursor, statement, _parameters, _context, _many):
        if statement.lstrip().upper().startswith('UPDATE') and '.plugins SET' in statement:
            updates.append(statement)
    event.listen(engine.sync_engine, 'before_cursor_execute', observe)

    async def finalize():
        async with sessions() as db:
            if mode == 'authorize':
                return await plugin_catalog.authorize(plugin_catalog.Begin(name='Existing', url=plugin.url, reconnect=True), db)
            return await plugin_catalog.callback(plugin_catalog.Callback(state=state, binding=binding, code='synthetic-code'), db)

    try:
        async with sessions() as guard:
            await guard.execute(select(Plugin).where(Plugin.id == pid).with_for_update())
            request = asyncio.create_task(finalize())
            try:
                await asyncio.wait_for(entered.wait(), timeout=10)
                release.set()
                blocked = False
                async with observer.connect() as conn:
                    for _ in range(200):
                        blocked = await conn.scalar(text("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name=:name AND wait_event_type='Lock')"), {'name': app_name})
                        if blocked or request.done():
                            break
                        await asyncio.sleep(.01)
                print(json.dumps({'mode': mode, 'actual_postgres_lock_wait': blocked,
                                  'finished_while_guard_held': request.done()}))
                assert blocked and not request.done(), 'OAuth replacement bypassed the held connection row lock'
                # The old authorization must remain active until the guarded
                # verification/refresh transaction has finished.
                assert await guard.get(PluginAuthorization, old_id) is not None
            finally:
                release.set()
                await guard.commit()
                result = await asyncio.wait_for(request, timeout=10)
        assert result['status'] == 'connected'
        async with sessions() as db:
            assert await db.get(PluginAuthorization, old_id) is None
            assert (await db.get(Plugin, pid)).tools == tools
        # Equal JSON caused no ORM UPDATE: the explicit SELECT lock is required.
        assert not updates
    finally:
        event.remove(engine.sync_engine, 'before_cursor_execute', observe)
