"""Slow discovery must not overwrite later owner changes to a connection."""
import asyncio
from datetime import datetime, timezone
import json

import pytest
from sqlalchemy import delete, select

from app.api import plugins as api
from app.db.tenancy import current_tenant_id
from app.models.plugin import Plugin, PluginAuthorization
from app.models.runtime import RuntimeCheck
from app.services import plugins
from .test_workspace_workflows import workspace


OWNER = 'refresh-race-owner'
SCHEMA = {'type': 'object', 'properties': {}}


@pytest.mark.asyncio
@pytest.mark.parametrize('change', ['tool_pause', 'connection_pause', 'credential', 'oauth', 'token_refresh', 'delete'])
async def test_refresh_respects_changes_committed_during_discovery(workspace, monkeypatch, change):
    client, sessions = workspace
    entered, release = asyncio.Event(), asyncio.Event()

    async def auth(*_):
        return None, None

    async def discover(*args, **kwargs):
        entered.set()
        await release.wait()
        return [{'name': 'read', 'description': 'Fresh description', 'schema': SCHEMA},
                {'name': 'new_tool', 'schema': SCHEMA}]

    monkeypatch.setattr(plugins, 'connection_auth', auth)
    monkeypatch.setattr(api, 'discover', discover)
    tenant = current_tenant_id.set(OWNER)
    try:
        async with sessions() as db:
            plugin = Plugin(name='Saved service', url='https://service.example/mcp', enabled=True,
                            credential=None if change in {'oauth', 'token_refresh'} else plugins.seal('synthetic-old-key'),
                            tools=[{'name': 'read', 'description': 'Original', 'schema': SCHEMA}])
            db.add(plugin)
            await db.flush()
            pid = plugin.id
            if change in {'oauth', 'token_refresh'}:
                db.add(PluginAuthorization(name='Old account', url=plugin.url, plugin_id=pid,
                                           status='connected', created_at=1))
            db.add(RuntimeCheck(name='plugin:' + pid, status='passed', detail={'message': 'Latest check'},
                                updated_at=datetime.now(timezone.utc)))
            await db.commit()
    finally:
        current_tenant_id.reset(tenant)

    headers = {'x-grokbot-user-id': OWNER}
    refresh = asyncio.create_task(client.post(f'/api/plugins/{pid}/refresh', headers=headers))
    try:
        await asyncio.wait_for(entered.wait(), timeout=5)
        if change == 'tool_pause':
            result = await client.patch(f'/api/plugins/{pid}/tools/read', headers=headers, json={'enabled': False})
            assert result.status_code == 200
        elif change == 'connection_pause':
            result = await client.patch(f'/api/plugins/{pid}', headers=headers, json={'enabled': False})
            assert result.status_code == 200
        elif change == 'delete':
            result = await client.delete(f'/api/plugins/{pid}', headers=headers)
            assert result.status_code == 200
        else:
            tenant = current_tenant_id.set(OWNER)
            try:
                async with sessions() as db:
                    saved = await db.get(Plugin, pid)
                    if change != 'token_refresh':
                        saved.tools = [{'name': 'current_account_tool', 'schema': SCHEMA}]
                    if change == 'credential':
                        saved.credential = plugins.seal('synthetic-new-key')
                    elif change == 'token_refresh':
                        authorization = (await db.execute(select(PluginAuthorization).where(
                            PluginAuthorization.plugin_id == pid))).scalar_one()
                        authorization.payload = plugins.seal('{"tokens":{"access_token":"synthetic-refreshed-token"}}')
                    else:
                        await db.execute(delete(PluginAuthorization).where(PluginAuthorization.plugin_id == pid))
                        db.add(PluginAuthorization(name='New account', url=saved.url, plugin_id=pid,
                                                   status='connected', created_at=2))
                    await db.commit()
            finally:
                current_tenant_id.reset(tenant)
    finally:
        release.set()
        response = await refresh

    if change == 'delete':
        assert response.status_code == 404
    elif change in {'credential', 'oauth'}:
        assert response.status_code == 409
    else:
        assert response.status_code == 200, response.text
        data = response.json()
        assert data['enabled'] is (change != 'connection_pause')
        read = next(tool for tool in data['tools'] if tool['name'] == 'read')
        assert read['enabled'] is (change != 'tool_pause')
        assert read['description'] == 'Fresh description'

    tenant = current_tenant_id.set(OWNER)
    try:
        async with sessions() as db:
            saved = await db.get(Plugin, pid)
            if change == 'delete':
                assert saved is None
            elif change in {'credential', 'oauth'}:
                assert [tool['name'] for tool in saved.tools] == ['current_account_tool']
                assert await db.get(RuntimeCheck, 'plugin:' + pid) is not None
                if change == 'credential':
                    assert plugins.reveal(saved.credential) == 'synthetic-new-key'
            else:
                assert saved.enabled is (change != 'connection_pause')
                assert saved.tools[0]['enabled'] is (change != 'tool_pause')
                assert saved.tools[1]['name'] == 'new_tool'
                assert await db.get(RuntimeCheck, 'plugin:' + pid) is None
    finally:
        current_tenant_id.reset(tenant)

    assert (await client.get('/api/plugins', headers={'x-grokbot-user-id': 'other-owner'})).json() == []


@pytest.mark.asyncio
@pytest.mark.parametrize('change', ['tool_pause', 'oauth'])
async def test_google_refresh_respects_concurrent_tool_pause_and_grant_replacement(workspace, monkeypatch, change):
    from app.services import google_workspace as google

    client, sessions = workspace
    entered, release = asyncio.Event(), asyncio.Event()
    original_grant = google.grant
    saved_access = {'groups': ['gmail'], 'scopes': [google.PREFIX + 'gmail.modify']}
    allowed = google.allowed_tools(saved_access)
    name = allowed[0]['name']

    async def delayed_grant(db, *args, **kwargs):
        row = await original_grant(db, *args, **kwargs)
        entered.set()
        await release.wait()
        return row

    monkeypatch.setattr(google, 'grant', delayed_grant)
    tenant = current_tenant_id.set(OWNER)
    try:
        async with sessions() as db:
            plugin = Plugin(name='Google Workspace', url=google.plugin_url(), enabled=True,
                            credential=plugins.seal(google.REFERENCE), tools=[allowed[0]])
            db.add(plugin)
            await db.flush()
            pid = plugin.id
            db.add(PluginAuthorization(name='Google', url=google.GRANT_URL, plugin_id=pid,
                                       status='connected', created_at=1,
                                       payload=plugins.seal(json.dumps(saved_access))))
            await db.commit()
    finally:
        current_tenant_id.reset(tenant)


    headers = {'x-grokbot-user-id': OWNER}
    refresh = asyncio.create_task(client.post(f'/api/plugins/{pid}/refresh', headers=headers))
    try:
        await asyncio.wait_for(entered.wait(), timeout=5)
        if change == 'tool_pause':
            response = await client.patch(f'/api/plugins/{pid}/tools/{name}', headers=headers, json={'enabled': False})
            assert response.status_code == 200
        else:
            tenant = current_tenant_id.set(OWNER)
            try:
                async with sessions() as db:
                    await db.execute(delete(PluginAuthorization).where(PluginAuthorization.plugin_id == pid))
                    db.add(PluginAuthorization(name='New Google account', url=google.GRANT_URL, plugin_id=pid,
                                               status='connected', created_at=2,
                                               payload=plugins.seal(json.dumps({'groups': [], 'scopes': []}))))
                    plugin = await db.get(Plugin, pid)
                    plugin.tools = []
                    await db.commit()
            finally:
                current_tenant_id.reset(tenant)
    finally:
        release.set()
        response = await refresh

    assert response.status_code == (200 if change == 'tool_pause' else 409)
    tenant = current_tenant_id.set(OWNER)
    try:
        async with sessions() as db:
            plugin = await db.get(Plugin, pid)
            if change == 'tool_pause':
                assert len(plugin.tools) == len(allowed)
                assert next(tool for tool in plugin.tools if tool['name'] == name)['enabled'] is False
            else:
                assert plugin.tools == []
    finally:
        current_tenant_id.reset(tenant)


@pytest.mark.asyncio
@pytest.mark.parametrize('mode', ['discovery', 'invoke'])
@pytest.mark.parametrize('change', ['credential', 'oauth', 'delete', 'pause', 'tool_pause', 'token_refresh'])
async def test_connection_test_does_not_save_results_for_a_replaced_or_removed_connection(workspace, monkeypatch, mode, change):
    client, sessions = workspace
    entered, release = asyncio.Event(), asyncio.Event()
    name = 'read_wiki_structure' if mode == 'invoke' else 'lookup'
    url = 'https://mcp.deepwiki.com/mcp' if mode == 'invoke' else 'https://service.example/mcp'

    async def auth(*_):
        return None, None

    async def provider(*args, **kwargs):
        entered.set()
        await release.wait()
        return {'success': True, 'content': 'Synthetic old-account result'} if mode == 'invoke' else [{'name': name, 'schema': SCHEMA}]

    monkeypatch.setattr(plugins, 'connection_auth', auth)
    monkeypatch.setattr(plugins, 'invoke', provider)
    monkeypatch.setattr(api, 'discover', provider)
    tenant = current_tenant_id.set(OWNER)
    try:
        async with sessions() as db:
            plugin = Plugin(name='Saved connection', url=url, enabled=True, tools=[{'name': name, 'schema': SCHEMA}],
                            credential=None if change in {'oauth', 'token_refresh'} else plugins.seal('synthetic-old-key'))
            db.add(plugin)
            await db.flush()
            pid = plugin.id
            if change in {'oauth', 'token_refresh'}:
                db.add(PluginAuthorization(name='Old account', url=url, plugin_id=pid, status='connected', created_at=1))
            await db.commit()
    finally:
        current_tenant_id.reset(tenant)

    headers = {'x-grokbot-user-id': OWNER}
    test = asyncio.create_task(client.post(f'/api/plugins/{pid}/test', headers=headers))
    try:
        await asyncio.wait_for(entered.wait(), timeout=5)
        if change == 'delete':
            assert (await client.delete(f'/api/plugins/{pid}', headers=headers)).status_code == 200
        elif change == 'pause':
            assert (await client.patch(f'/api/plugins/{pid}', headers=headers, json={'enabled': False})).status_code == 200
        elif change == 'tool_pause':
            assert (await client.patch(f'/api/plugins/{pid}/tools/{name}', headers=headers, json={'enabled': False})).status_code == 200
        else:
            tenant = current_tenant_id.set(OWNER)
            try:
                async with sessions() as db:
                    if change == 'credential':
                        plugin = await db.get(Plugin, pid)
                        plugin.credential = plugins.seal('synthetic-new-key')
                    elif change == 'oauth':
                        await db.execute(delete(PluginAuthorization).where(PluginAuthorization.plugin_id == pid))
                        db.add(PluginAuthorization(name='New account', url=url, plugin_id=pid, status='connected', created_at=2))
                    else:
                        authorization = (await db.execute(select(PluginAuthorization).where(PluginAuthorization.plugin_id == pid))).scalar_one()
                        authorization.payload = plugins.seal(json.dumps({'tokens': {'access_token': 'synthetic-refreshed-token'}}))
                    await db.commit()
            finally:
                current_tenant_id.reset(tenant)
    finally:
        release.set()
        response = await test

    # Catalog discovery does not execute the paused tool; it may still report
    # discovery while keeping that tool disabled. An actual tool test may not.
    current_result = change == 'token_refresh' or (change == 'tool_pause' and mode == 'discovery')
    assert response.status_code == (200 if current_result else 404 if change == 'delete' else 409)
    tenant = current_tenant_id.set(OWNER)
    try:
        async with sessions() as db:
            check = await db.get(RuntimeCheck, 'plugin:' + pid)
            if current_result:
                assert check.status == ('passed' if mode == 'invoke' else 'discovered')
            else:
                assert check is None
    finally:
        current_tenant_id.reset(tenant)

