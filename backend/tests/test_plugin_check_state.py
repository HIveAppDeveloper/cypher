"""A failed/discovery-only retest must replace a stale execution pass."""
import pytest
import httpx
from app.db.tenancy import current_tenant_id
from app.models.plugin import Plugin
from app.models.runtime import RuntimeCheck
from app.services import plugins
from .test_workspace_workflows import workspace


@pytest.mark.asyncio
@pytest.mark.parametrize('status', [401, 403, 503])
async def test_google_tool_failures_keep_safe_actionable_classification(workspace,monkeypatch,status):
    from fastapi import HTTPException
    from app.services import google_workspace
    _,sessions=workspace
    tenant=current_tenant_id.set('google-error-owner')
    try:
        async with sessions() as db:
            plugin=Plugin(name='Google Workspace',url='https://cypher.example/api/google/mcp',credential=plugins.seal('grokbot-google-workspace'),enabled=True,tools=[{'name':'gmail_users_getProfile','schema':{'type':'object'},'read_only':True}])
            db.add(plugin);await db.commit();pid=plugin.id
        monkeypatch.setattr('app.db.session.AsyncSessionLocal',sessions)
        async def reject(*_):raise HTTPException(status,'secret provider response and user data')
        monkeypatch.setattr(google_workspace,'invoke',reject)
        result=await plugins.invoke(pid,'gmail_users_getProfile',{})
        assert result['success'] is False
        assert result['code']==('sign_in_required' if status in {401,403} else 'google_unavailable')
        assert 'secret' not in str(result) and 'user data' not in str(result)
        if status in {401,403}:assert 'Reconnect Google' in result['error']
    finally:current_tenant_id.reset(tenant)


@pytest.mark.asyncio
async def test_website_fallback_is_not_reported_as_mcp_execution_pass(workspace,monkeypatch):
    client,sessions=workspace
    async def invoke(*_):
        return {'success':True,'verification_mode':'public_website_fallback','source_url':'https://jobherder.com/pricing','content':'Public pricing page'}
    monkeypatch.setattr(plugins,'invoke',invoke)
    tenant=current_tenant_id.set('fallback-owner')
    try:
        async with sessions() as db:
            plugin=Plugin(name='Jobherder',url='https://jobherder.com/mcp',enabled=True,tools=[{'name':'get_pricing','description':'Pricing'}])
            db.add(plugin);await db.commit();pid=plugin.id
    finally:current_tenant_id.reset(tenant)
    response=await client.post(f'/api/plugins/{pid}/test',headers={'x-grokbot-user-id':'fallback-owner'})
    data=response.json()
    assert response.status_code==200 and data['status']=='fallback'
    assert data['verification_mode']=='public_website_fallback' and data['source_url']=='https://jobherder.com/pricing'
    saved=(await client.get('/api/plugins',headers={'x-grokbot-user-id':'fallback-owner'})).json()[0]
    assert saved['verification']['status']=='fallback'


@pytest.mark.asyncio
async def test_damaged_saved_credential_does_not_hide_all_other_connections(workspace):
    client,sessions=workspace
    tenant=current_tenant_id.set('credential-list-owner')
    try:
        async with sessions() as db:
            for name,credential in [('Damaged','not-a-valid-encrypted-token'),('Healthy',plugins.seal('existing-test-token'))]:
                db.add(Plugin(name=name,url='https://service.example/mcp',credential=credential,enabled=True,tools=[{'name':'read','description':'Read'}]))
            await db.commit()
    finally:current_tenant_id.reset(tenant)
    response=await client.get('/api/plugins',headers={'x-grokbot-user-id':'credential-list-owner'})
    assert response.status_code==200
    saved={plugin['name']:plugin for plugin in response.json()}
    assert len(saved)==2 and not saved['Damaged']['authenticated'] and saved['Healthy']['authenticated']
    assert 'not-a-valid-encrypted-token' not in response.text


@pytest.mark.asyncio
@pytest.mark.parametrize('outcome,status,code',[
    ('network','failed','unavailable'),
    ('auth','failed','sign_in_required'),
    ('empty','failed','no_tools'),
    ('tools','discovered',None),
    ('legacy','failed','unsupported_endpoint'),
])
async def test_retest_persists_current_evidence_and_preserves_connection(workspace,monkeypatch,outcome,status,code):
    client,sessions=workspace
    from app.api import plugins as api
    async def auth(*_):return None,None
    async def discover(*_):
        if outcome=='network':raise httpx.ConnectError('private upstream detail')
        if outcome=='auth':
            raise httpx.HTTPStatusError('secret provider reply',request=httpx.Request('GET','https://service.example/mcp'),response=httpx.Response(401))
        return [] if outcome=='empty' else [{'name':'lookup','description':'Lookup'}]
    monkeypatch.setattr(plugins,'connection_auth',auth)
    monkeypatch.setattr(api,'discover',discover)
    tenant=current_tenant_id.set('readiness-owner')
    try:
        async with sessions() as db:
            plugin=Plugin(name='Saved service',url='site-mcp://gmail.com' if outcome=='legacy' else 'https://service.example/mcp',enabled=True,tools=[{'name':'lookup','description':'Lookup','enabled':False}])
            db.add(plugin);await db.commit();pid=plugin.id
            from datetime import datetime
            db.add(RuntimeCheck(name='plugin:'+pid,status='passed',detail={'message':'An old tool call passed.'},updated_at=datetime.utcnow()))
            await db.commit()
    finally:current_tenant_id.reset(tenant)
    response=await client.post(f'/api/plugins/{pid}/test',headers={'x-grokbot-user-id':'readiness-owner'})
    assert response.status_code==(401 if outcome=='auth' else 200)
    data=response.json()
    if outcome!='auth':assert data['status']==status and data.get('code')==code
    else:assert 'Reconnect' in data['detail']
    if outcome!='auth':assert data['latency_ms']>=0
    assert 'secret' not in str(data) and 'private upstream' not in str(data)
    saved=(await client.get('/api/plugins',headers={'x-grokbot-user-id':'readiness-owner'})).json()[0]
    assert saved['verification']['status']==status
    assert saved['verification']['detail']['message']==data.get('message',data.get('detail'))
    assert saved['enabled'] and saved['tools'][0]['enabled'] is False
    assert (await client.get('/api/plugins',headers={'x-grokbot-user-id':'another-owner'})).json()==[]
