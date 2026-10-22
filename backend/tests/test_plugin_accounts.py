"""Multiple account grants must never overwrite a different saved account."""
import pytest
from app.api import plugins, plugin_catalog
from .test_workspace_workflows import workspace

TOOLS = [{'name': 'atlas_organizations', 'description': 'List workspaces', 'schema': {'type': 'object'}, 'read_only': True}]
URL = 'https://atlassolution.net/api/mcp'


@pytest.mark.asyncio
async def test_keys_keep_accounts_and_reconnect_only_the_selected_account(workspace, monkeypatch):
    client, _ = workspace
    calls = []
    async def discover(url, token=None):
        calls.append(token)
        return TOOLS
    monkeypatch.setattr(plugins, 'discover', discover)
    owner = {'x-grokbot-user-id': 'account-owner'}
    other = {'x-grokbot-user-id': 'another-owner'}
    first = await client.post('/api/plugins', headers=owner, json={'name': 'Personal', 'url': URL, 'token': 'personal-key'})
    assert first.status_code == 200, first.text
    second = await client.post('/api/plugins', headers=owner, json={'name': 'Hive', 'url': URL, 'token': 'hive-key', 'new_connection': True})
    assert second.status_code == 200, second.text
    personal, hive = first.json()['id'], second.json()['id']
    assert personal != hive
    rows = (await client.get('/api/plugins', headers=owner)).json()
    assert {row['name'] for row in rows} == {'Personal', 'Hive'}
    assert 'hive-key' not in str(rows) and 'personal-key' not in str(rows)
    ambiguous = await client.post('/api/plugins', headers=owner, json={'name': 'Ambiguous', 'url': URL, 'token': 'wrong'})
    assert ambiguous.status_code == 409 and calls == ['personal-key', 'hive-key']
    foreign = await client.post('/api/plugins', headers=other, json={'name': 'Foreign', 'url': URL, 'token': 'wrong', 'plugin_id': hive})
    assert foreign.status_code == 404
    mismatched = await client.post('/api/plugins', headers=owner, json={'name': 'Wrong server', 'url': 'https://other.example/mcp', 'token': 'wrong', 'plugin_id': hive})
    assert mismatched.status_code == 404
    refreshed = await client.post('/api/plugins', headers=owner, json={'name': 'Hive refreshed', 'url': URL, 'token': 'new-hive-key', 'plugin_id': hive})
    assert refreshed.status_code == 200 and refreshed.json()['id'] == hive
    rows = (await client.get('/api/plugins', headers=owner)).json()
    assert {row['name'] for row in rows} == {'Personal', 'Hive refreshed'}
    assert (await client.get('/api/plugins', headers=other)).json() == []


@pytest.mark.asyncio
async def test_oauth_add_account_and_reconnect_use_distinct_records(workspace, monkeypatch):
    client, _ = workspace
    async def validate(_): pass
    async def provider(*_): return object()
    async def discover(*_, **__): return TOOLS
    monkeypatch.setattr(plugin_catalog, 'validate_endpoint', validate)
    monkeypatch.setattr(plugin_catalog, 'make_provider', provider)
    monkeypatch.setattr(plugin_catalog, 'discover', discover)
    monkeypatch.setenv('GROKBOT_MANAGED_CONNECTORS', '[]')
    headers = {'x-grokbot-user-id': 'oauth-owner'}
    payload = {'name': 'Personal', 'url': 'https://provider.example/mcp'}
    first = await client.post('/api/plugins/authorize', headers=headers, json=payload)
    monkeypatch.setenv('GROKBOT_MANAGED_CONNECTORS', '[{"id":"owner-installation","name":"Provider","url":"https://provider.example/mcp","connector":"oauth/provider"}]')
    second = await client.post('/api/plugins/authorize', headers=headers, json={**payload, 'name': 'Hive', 'new_connection': True})
    assert first.status_code == second.status_code == 200
    assert first.json()['plugin_id'] != second.json()['plugin_id']
    monkeypatch.setenv('GROKBOT_MANAGED_CONNECTORS', '[]')
    ambiguous = await client.post('/api/plugins/authorize', headers=headers, json={**payload, 'reconnect': True})
    assert ambiguous.status_code == 409
    refreshed = await client.post('/api/plugins/authorize', headers=headers, json={**payload, 'reconnect': True, 'plugin_id': second.json()['plugin_id']})
    assert refreshed.status_code == 200 and refreshed.json()['plugin_id'] == second.json()['plugin_id']
    assert len((await client.get('/api/plugins', headers=headers)).json()) == 2


@pytest.mark.asyncio
async def test_atlas_catalog_resolves_hive_setup_without_guessing_endpoints(workspace):
    client, _ = workspace
    for website in ['atlassolution.net', 'atlas-hiveapp.vercel.app']:
        result = await client.post('/api/plugins/resolve', headers={'x-grokbot-user-id': 'catalog-owner'}, json={'website': website})
        assert result.status_code == 200
        assert result.json()['url'] == URL and result.json()['auth'] == 'api_key'


@pytest.mark.asyncio
async def test_atlas_verification_only_calls_the_workspace_read_tool(workspace, monkeypatch):
    client, _ = workspace
    from app.services import plugins as service, verification
    async def discover(*_, **__): return TOOLS
    calls = []
    async def invoke(plugin_id, name, args):
        calls.append((name, args))
        return {'success': True, 'structured_content': {'organizations': []}}
    async def save_check(*_): pass
    monkeypatch.setattr(plugins, 'discover', discover)
    monkeypatch.setattr(service, 'invoke', invoke)
    monkeypatch.setattr(verification, 'save_check', save_check)
    headers = {'x-grokbot-user-id': 'atlas-owner'}
    connected = await client.post('/api/plugins', headers=headers, json={'name': 'Hive', 'url': URL, 'token': 'test-only-key'})
    result = await client.post('/api/plugins/' + connected.json()['id'] + '/test', headers=headers)
    assert result.status_code == 200 and result.json()['status'] == 'passed'
    assert calls == [('atlas_organizations', {})]


@pytest.mark.asyncio
async def test_vercel_empty_team_grant_is_not_reported_as_verified(workspace, monkeypatch):
    client, _ = workspace
    from app.services import plugins as service, verification
    async def discover(*_, **__):
        return [{'name': 'list_teams', 'description': 'List teams', 'schema': {'type': 'object'}, 'read_only': True}]
    async def invoke(*_):
        return {'success': True, 'content': '{"result":{"teams":[]}}'}
    async def save_check(*_): pass
    monkeypatch.setattr(plugins, 'discover', discover)
    monkeypatch.setattr(service, 'invoke', invoke)
    monkeypatch.setattr(verification, 'save_check', save_check)
    headers = {'x-grokbot-user-id': 'vercel-owner'}
    connected = await client.post('/api/plugins', headers=headers, json={'name': 'Vercel', 'url': 'https://mcp.vercel.com', 'token': 'test-only-key'})
    result = await client.post('/api/plugins/' + connected.json()['id'] + '/test', headers=headers)
    assert result.status_code == 200 and result.json()['status'] == 'failed'
    assert 'no team access' in result.json()['message']
