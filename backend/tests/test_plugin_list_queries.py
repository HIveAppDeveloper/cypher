"""Listing many connections must use bounded SQL without changing account state."""
from datetime import datetime
import json

import pytest
from sqlalchemy import event

from app.db.tenancy import current_tenant_id
from app.models.plugin import Plugin, PluginAuthorization
from app.models.runtime import RuntimeCheck
from app.services.plugins import seal
from .test_workspace_workflows import workspace


@pytest.mark.asyncio
@pytest.mark.parametrize('count', [7, 196])
async def test_verifications_are_batched_and_keep_auth_pause_damage_and_tenant_projections(workspace, count):
    client, sessions = workspace
    cases = [
        ('Public', None, True, None, 'passed'),
        ('Paused', seal('synthetic-saved-key'), False, None, 'passed'),
        ('Damaged key', 'unreadable-synthetic-key', True, None, 'passed'),
        ('OAuth', None, True, seal(json.dumps({'tokens': {'access_token': 'synthetic-oauth-token'}})), 'discovered'),
        ('Damaged grant', None, True, 'unreadable-synthetic-grant', 'passed'),
        ('Failed check', seal('another-synthetic-key'), True, None, 'failed'),
        ('Unchecked', None, True, None, None),
    ] + [(f'Public {i}', None, True, None, 'passed') for i in range(count - 7)]
    for owner in ('list-query-owner', 'other-query-owner'):
        tenant = current_tenant_id.set(owner)
        try:
            async with sessions() as db:
                for name, credential, enabled, payload, status in cases if owner == 'list-query-owner' else cases[:1]:
                    plugin = Plugin(name=name if owner == 'list-query-owner' else 'Private neighbor',
                                    url='https://synthetic.example/mcp', credential=credential, enabled=enabled,
                                    tools=[{'name': 'read', 'description': 'Read', 'enabled': False}])
                    db.add(plugin)
                    await db.flush()
                    if owner == 'other-query-owner':
                        neighbor_id = plugin.id
                    if payload:
                        db.add(PluginAuthorization(name=name, url=plugin.url, plugin_id=plugin.id,
                                                   payload=payload, status='connected', created_at=1))
                    if status:
                        db.add(RuntimeCheck(name='plugin:' + plugin.id, status=status,
                                            detail={'message': name + ' evidence'}, updated_at=datetime(2026, 1, 1)))
                await db.commit()
        finally:
            current_tenant_id.reset(tenant)

    selects = []
    def capture(_conn, _cursor, statement, parameters, _context, _many):
        if statement.lstrip().upper().startswith('SELECT'):
            selects.append((statement, parameters))
    engine = sessions.kw['bind'].sync_engine
    event.listen(engine, 'before_cursor_execute', capture)
    try:
        response = await client.get('/api/plugins', headers={'x-grokbot-user-id': 'list-query-owner'})
    finally:
        event.remove(engine, 'before_cursor_execute', capture)

    assert response.status_code == 200, response.text
    data = response.json()
    assert len(data) == count
    assert neighbor_id not in response.text
    assert all(tool['enabled'] is False for plugin in data for tool in plugin['tools'])
    saved = {plugin['name']: plugin for plugin in data}
    for name, authenticated, state, verification in [
        ('Public', False, 'public', 'passed'),
        ('Paused', True, 'paused', 'passed'),
        ('Damaged key', False, 'sign_in_required', 'failed'),
        ('OAuth', True, 'saved', 'discovered'),
        ('Damaged grant', False, 'sign_in_required', 'failed'),
        ('Failed check', True, 'saved', 'failed'),
        ('Unchecked', False, 'public', 'not_tested'),
    ]:
        plugin = saved[name]
        assert (plugin['authenticated'], plugin['connection_state'], plugin['verification']['status']) == (authenticated, state, verification)
        if name in {'Public', 'Paused', 'OAuth', 'Failed check'}:
            assert plugin['verification']['detail'] == {'message': name + ' evidence'}
            assert plugin['verification']['checked_at'] == '2026-01-01T00:00:00Z'
        if name in {'Damaged key', 'Damaged grant'}:
            assert plugin['verification']['detail']['code'] == 'sign_in_required'
    assert saved['Paused']['enabled'] is False
    assert 'unreadable-synthetic' not in response.text and 'synthetic-oauth-token' not in response.text
    checks = [(sql, params) for sql, params in selects if 'runtime_checks' in sql]
    assert neighbor_id not in repr(checks)
    print(json.dumps({'plugins': count, 'selects': len(selects), 'verification_selects': len(checks)}))
    assert len(selects) <= 3, f'{len(selects)} SELECTs for {count} plugins'
    assert len(checks) == 1
