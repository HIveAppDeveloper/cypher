"""Background catalog discovery must belong to the current saved account."""
import asyncio
from datetime import datetime
import json

import pytest
from sqlalchemy import delete, select

from app.db.tenancy import current_tenant_id
from app.models.plugin import Plugin, PluginAuthorization
from app.models.runtime import RuntimeCheck
from app.services import plugin_sync, plugins
from .test_workspace_workflows import workspace


OWNER = 'catalog-generation-owner'
URL = 'https://catalog-generation.example/mcp'
SCHEMA = {'type': 'object', 'properties': {}}


@pytest.mark.asyncio
@pytest.mark.parametrize('change', ['oauth_replace', 'oauth_remove', 'token_refresh', 'tool_pause', 'pause', 'credential', 'delete'])
async def test_background_recheck_rejects_replaced_auth_but_keeps_current_choices(workspace, monkeypatch, change):
    client, sessions = workspace
    entered, release = asyncio.Event(), asyncio.Event()
    calls = []

    async def auth(_db, plugin):
        calls.append(plugin.id)
        return None, None

    async def discover(*args, **kwargs):
        entered.set()
        await release.wait()
        return [{'name': 'read', 'description': 'Old-account discovery', 'schema': SCHEMA},
                {'name': 'new_tool', 'schema': SCHEMA}]

    monkeypatch.setattr(plugins, 'connection_auth', auth)
    monkeypatch.setattr(plugin_sync, 'discover', discover)
    token = current_tenant_id.set(OWNER)
    try:
        async with sessions() as db:
            plugin = Plugin(name='Saved service', url=URL, enabled=True,
                            credential=plugins.seal('synthetic-old-key') if change == 'credential' else None,
                            tools=[{'name': 'read', 'schema': SCHEMA}])
            db.add(plugin)
            await db.flush()
            pid = plugin.id
            if change.startswith('oauth') or change == 'token_refresh':
                db.add(PluginAuthorization(name='Saved account', url=URL, plugin_id=pid,
                                           status='connected', created_at=1,
                                           payload=plugins.seal(json.dumps({'tokens': {'access_token': 'synthetic-old-token'}}))))
            db.add(RuntimeCheck(name='plugin:' + pid, status='passed', detail={'message': 'Current account check'},
                                updated_at=datetime(2026, 1, 1)))
            await db.commit()
    finally:
        current_tenant_id.reset(token)

    token = current_tenant_id.set('neighbor-catalog-owner')
    try:
        async with sessions() as db:
            neighbor = Plugin(name='Neighbor service', url=URL, enabled=True,
                              tools=[{'name': 'neighbor_private_tool', 'schema': SCHEMA}])
            db.add(neighbor)
            await db.commit()
            neighbor_id = neighbor.id
    finally:
        current_tenant_id.reset(token)

    token = current_tenant_id.set(OWNER)
    try:
        recheck = asyncio.create_task(plugin_sync.connect_entry({'name': 'Service', 'url': URL, 'auth': 'auto'}, sessions))
        try:
            await asyncio.wait_for(entered.wait(), timeout=5)
            headers = {'x-grokbot-user-id': OWNER}
            if change == 'tool_pause':
                assert (await client.patch(f'/api/plugins/{pid}/tools/read', headers=headers, json={'enabled': False})).status_code == 200
            elif change == 'pause':
                assert (await client.patch(f'/api/plugins/{pid}', headers=headers, json={'enabled': False})).status_code == 200
            elif change == 'delete':
                assert (await client.delete(f'/api/plugins/{pid}', headers=headers)).status_code == 200
            else:
                async with sessions() as db:
                    plugin = await db.get(Plugin, pid)
                    if change == 'token_refresh':
                        authorization = (await db.execute(select(PluginAuthorization).where(PluginAuthorization.plugin_id == pid))).scalar_one()
                        authorization.payload = plugins.seal(json.dumps({'tokens': {'access_token': 'synthetic-refreshed-token'}}))
                    else:
                        plugin.tools = [{'name': 'current_account_tool', 'schema': SCHEMA}]
                        if change == 'credential':
                            plugin.credential = plugins.seal('synthetic-new-key')
                        else:
                            await db.execute(delete(PluginAuthorization).where(PluginAuthorization.plugin_id == pid))
                            if change == 'oauth_replace':
                                db.add(PluginAuthorization(name='Replacement account', url=URL, plugin_id=pid,
                                                           status='connected', created_at=2))
                    await db.commit()
        finally:
            release.set()
            result = await recheck

        assert calls == [pid]
        rejected = change in {'oauth_replace', 'oauth_remove', 'credential', 'delete'}
        assert result['status'] == ('unavailable' if rejected else 'paused' if change == 'pause' else 'connected')
        async with sessions() as db:
            plugin = await db.get(Plugin, pid)
            check = await db.get(RuntimeCheck, 'plugin:' + pid)
            if change == 'delete':
                assert plugin is None
            elif rejected:
                assert [tool['name'] for tool in plugin.tools] == ['current_account_tool']
                assert check.detail == {'message': 'Current account check'}
                if change == 'credential':
                    assert plugins.reveal(plugin.credential) == 'synthetic-new-key'
            elif change == 'pause':
                assert plugin.enabled is False and plugin.tools == [{'name': 'read', 'schema': SCHEMA}]
                assert check is not None
            else:
                assert [tool['name'] for tool in plugin.tools] == ['read', 'new_tool']
                assert plugin.tools[0]['enabled'] is (change != 'tool_pause')
                assert check is None
            assert await db.get(Plugin, neighbor_id) is None
    finally:
        current_tenant_id.reset(token)

    token = current_tenant_id.set('neighbor-catalog-owner')
    try:
        async with sessions() as db:
            assert (await db.get(Plugin, neighbor_id)).tools == [{'name': 'neighbor_private_tool', 'schema': SCHEMA}]
    finally:
        current_tenant_id.reset(token)
