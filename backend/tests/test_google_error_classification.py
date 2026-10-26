import httpx
import pytest
from fastapi import HTTPException
from app.services import google_workspace as google
from app.services import plugins
from app.db.tenancy import current_tenant_id
from app.models.plugin import Plugin
from .test_workspace_workflows import workspace


@pytest.mark.asyncio
@pytest.mark.parametrize('reason', ['dailyLimitExceeded','userRateLimitExceeded','rateLimitExceeded','quotaExceeded','RESOURCE_EXHAUSTED'])
async def test_google_403_quota_is_retryable_without_reconnection_or_private_detail(monkeypatch,reason):
    def reject(_):return httpx.Response(403,headers={'Retry-After':'120'},json={'error':{'status':reason,'errors':[{'reason':reason,'message':'private provider and user data'}],'message':'private body'}})
    monkeypatch.setattr(google,'client',lambda:httpx.AsyncClient(transport=httpx.MockTransport(reject)))
    with pytest.raises(HTTPException) as error:
        await google.api_request('synthetic-access','GET','https://gmail.googleapis.com/gmail/v1/users/me/profile')
    assert error.value.status_code==429 and error.value.detail['code']=='rate_limited'
    assert error.value.headers['Retry-After']=='120'
    assert 'private' not in str(error.value.detail) and 'Reconnect' not in str(error.value.detail)


@pytest.mark.asyncio
@pytest.mark.parametrize('reason,code',[('insufficientPermissions','permission_required'),('ACCESS_TOKEN_SCOPE_INSUFFICIENT','permission_required'),('domainPolicy','google_access_denied'),('private-unknown-reason','google_access_denied')])
async def test_google_403_permissions_and_unknown_denials_are_distinct(monkeypatch,reason,code):
    monkeypatch.setattr(google,'client',lambda:httpx.AsyncClient(transport=httpx.MockTransport(lambda _:httpx.Response(403,json={'error':{'errors':[{'reason':reason,'message':'private detail'}]}}))))
    with pytest.raises(HTTPException) as error:await google.api_request('synthetic','GET','https://gmail.googleapis.com/gmail/v1/users/me/profile')
    assert error.value.status_code==403 and error.value.detail['code']==code
    assert 'private' not in str(error.value.detail)


@pytest.mark.asyncio
async def test_google_quota_test_replaces_stale_pass_without_changing_saved_grant(workspace,monkeypatch):
    client,sessions=workspace
    async def limited(*_):raise HTTPException(429,{'code':'rate_limited','message':'safe quota message'})
    monkeypatch.setattr(google,'invoke',limited)
    monkeypatch.setattr('app.db.session.AsyncSessionLocal',sessions)
    tenant=current_tenant_id.set('quota-owner')
    try:
        async with sessions() as db:
            plugin=Plugin(name='Google Workspace',url='https://cypher.example/api/google/mcp',credential=plugins.seal('grokbot-google-workspace'),enabled=True,tools=[{'name':'gmail_users_getProfile','schema':{'type':'object'},'read_only':True}])
            db.add(plugin);await db.commit();identifier=plugin.id;credential=plugin.credential
    finally:current_tenant_id.reset(tenant)
    result=await client.post(f'/api/plugins/{identifier}/test',headers={'x-grokbot-user-id':'quota-owner'})
    assert result.status_code==200
    assert result.json()['status']=='failed' and result.json()['code']=='rate_limited' and result.json()['retryable'] is True
    saved=(await client.get('/api/plugins',headers={'x-grokbot-user-id':'quota-owner'})).json()[0]
    assert saved['authenticated'] and saved['enabled'] and saved['verification']['detail']['code']=='rate_limited'
    tenant=current_tenant_id.set('quota-owner')
    try:
        async with sessions() as db:assert (await db.get(Plugin,identifier)).credential==credential
    finally:current_tenant_id.reset(tenant)
