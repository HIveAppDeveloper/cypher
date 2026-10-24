"""UI adapters use isolated SQL fixtures; provider/network calls are forbidden."""
import json
import gzip
from datetime import datetime

import pytest

from app.db.tenancy import current_tenant_id
from app.models.plugin import Plugin, PluginAuthorization
from app.models.runtime import RuntimeCheck
from app.services import plugins
from .test_workspace_workflows import workspace

A = {'x-grokbot-user-id': 'ui-contract-owner'}
B = {'x-grokbot-user-id': 'other-ui-owner'}


@pytest.mark.asyncio
async def test_connection_list_survives_damaged_credentials_and_oauth(workspace, monkeypatch):
    client, sessions = workspace
    async def forbidden(*args, **kwargs):
        raise AssertionError('Listing saved connections must not contact providers')
    monkeypatch.setattr(plugins, 'discover', forbidden)
    owner = current_tenant_id.set(A['x-grokbot-user-id'])
    try:
        async with sessions() as db:
            broken = Plugin(name='Broken token', url='https://broken.example/mcp', credential='DAMAGED-SECRET', tools=[{'name': 'read'}])
            oauth = Plugin(name='Broken OAuth', url='https://oauth.example/mcp', tools=[])
            saved = Plugin(name='Saved token', url='https://saved.example/mcp', credential=plugins.seal('SAVED-SECRET'), tools=[])
            public = Plugin(name='Public docs', url='https://docs.example/mcp', tools=[])
            db.add_all([broken, oauth, saved, public]); await db.flush()
            db.add(PluginAuthorization(name=oauth.name, url=oauth.url, plugin_id=oauth.id, status='connected', payload='DAMAGED-OAUTH', created_at=1))
            db.add(RuntimeCheck(name='plugin:'+broken.id, status='passed', detail={'message':'Old test passed'}, updated_at=datetime.utcnow()))
            await db.commit()
            ids = broken.id, oauth.id
    finally:
        current_tenant_id.reset(owner)
    response = await client.get('/api/plugins', headers=A)
    assert response.status_code == 200, response.text
    rows = {row['name']: row for row in response.json()}
    for name in ('Broken token', 'Broken OAuth'):
        assert rows[name]['connection_state'] == 'sign_in_required'
        assert rows[name]['authenticated'] is False
        assert rows[name]['verification']['status'] == 'failed'
        assert 'Reconnect' in rows[name]['verification']['detail']['message']
    assert rows['Broken token']['tools'][0]['description'] == ''
    assert rows['Saved token']['authenticated'] is True
    assert rows['Saved token']['verification']['status'] == 'not_tested'
    assert rows['Public docs']['connection_state'] == 'public'
    assert not any(secret in response.text for secret in ('DAMAGED-SECRET', 'DAMAGED-OAUTH', 'SAVED-SECRET'))
    assert (await client.get('/api/plugins', headers=B)).json() == []
    for pid in ids:
        for action in ('refresh', 'test'):
            failure = await client.post(f'/api/plugins/{pid}/{action}', headers=A)
            assert failure.status_code == 401, failure.text
            assert 'Reconnect' in failure.json()['detail']
        assert (await client.delete(f'/api/plugins/{pid}', headers=B)).status_code == 200
        assert len((await client.get('/api/plugins', headers=A)).json()) == (4 if pid == ids[0] else 3)
        assert (await client.delete(f'/api/plugins/{pid}', headers=A)).status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize('grant', [
    {'tokens': {'access_token': 'OAUTH-SECRET', 'token_type': 'Bearer'}},
    {'access_token':'GOOGLE-SECRET', 'refresh_token':'REFRESH-SECRET'},
    {'managed_id':'managed-fixture'},
])
async def test_valid_oauth_is_saved_access_and_not_claimed_as_execution_verified(workspace, grant):
    client, sessions = workspace
    owner = current_tenant_id.set(A['x-grokbot-user-id'])
    try:
        async with sessions() as db:
            p = Plugin(name='OAuth fixture', url='https://oauth.example/mcp', tools=[], enabled=False)
            db.add(p); await db.flush()
            db.add(PluginAuthorization(name=p.name, url=p.url, plugin_id=p.id, status='connected', created_at=1,
                payload=plugins.seal(json.dumps(grant))))
            await db.commit()
    finally:
        current_tenant_id.reset(owner)
    response = await client.get('/api/plugins', headers=A)
    assert response.status_code == 200
    row = response.json()[0]
    assert row['authenticated'] and row['connection_state'] == 'paused'
    assert row['verification'] == {'status':'not_tested'}
    assert not any(secret in response.text for secret in ('OAUTH-SECRET','GOOGLE-SECRET','REFRESH-SECRET','managed-fixture'))
