from contextlib import asynccontextmanager
from types import SimpleNamespace
import asyncio,json
import httpx,pytest
from sqlalchemy import select
from mcp.types import CallToolResult,TextContent,ImageContent
from app.models.plugin import Plugin
from app.db.tenancy import current_tenant_id
from app.services import plugins,plugin_sync
from .test_workspace_workflows import workspace

def test_structured_and_media_results_are_not_lost_or_unbounded():
    result=plugins.tool_result(CallToolResult(content=[],structuredContent={'value':42}),'service')
    assert result['success'] and result['structured_content']=={'value':42} and '42' in result['content']
    result=plugins.tool_result(CallToolResult(content=[ImageContent(type='image',mimeType='image/png',data='eA==')]),'service')
    assert result['_attachments'][0]['data']=='eA=='
    result=plugins.tool_result(CallToolResult(content=[],structuredContent={'text':'x'*30000}),'service')
    assert result['structured_content_truncated'] and 'structured_content' not in result and len(result['content'])==20000

@pytest.mark.asyncio
async def test_reads_retry_but_writes_do_not_and_invalid_arguments_never_run(workspace,monkeypatch):
    _,sessions=workspace
    from app.db import session as dbmodule
    from app.services import plugin_auth
    monkeypatch.setattr(dbmodule,'AsyncSessionLocal',sessions)
    async def provider(*_):return None
    monkeypatch.setattr(plugin_auth,'provider_for_plugin',provider)
    @asynccontextmanager
    async def session(*_):
        class Client:
            async def call_tool(self,name,arguments):
                calls.append(name)
                if len(calls)<3:raise httpx.ConnectError('temporary')
                return CallToolResult(content=[],structuredContent={'ok':True})
        yield Client()
    monkeypatch.setattr(plugins,'session',session)
    # Avoid a real backoff in a deterministic retry test.
    async def sleep(_):pass
    monkeypatch.setattr(plugins.asyncio,'sleep',sleep)
    token=current_tenant_id.set('plugin-owner')
    try:
        async with sessions() as db:
            p=Plugin(name='test',url='https://example.com/mcp',tools=[{'name':'read','schema':{'type':'object','properties':{'query':{'type':'string'}},'required':['query']},'read_only':True},{'name':'write','schema':{'type':'object'}}])
            db.add(p);await db.commit()
        calls=[]
        assert (await plugins.invoke(p.id,'read',{'query':'test'}))['success'] and len(calls)==3
        calls=[]
        assert (await plugins.invoke(p.id,'write',{}))['code']=='unavailable' and calls==['write']
        calls=[]
        assert (await plugins.invoke(p.id,'read',{'query':7}))['code']=='invalid_arguments' and not calls
    finally:current_tenant_id.reset(token)

@pytest.mark.asyncio
async def test_catalog_job_persists_progress_and_is_tenant_isolated(workspace,monkeypatch):
    client,sessions=workspace
    from app.api import plugin_catalog
    entries=[{'id':str(i),'name':'Service '+str(i),'url':f'https://service{i}.example/mcp','auth':'auto'} for i in range(8)]
    monkeypatch.setattr(plugin_catalog,'catalog',lambda:entries)
    async def discover(url,token=None):return [{'name':'read','description':'Read','schema':{'type':'object'},'read_only':True}]
    monkeypatch.setattr(plugin_sync,'discover',discover)
    a={'x-grokbot-user-id':'catalog-owner'};b={'x-grokbot-user-id':'other-owner'}
    job=await client.post('/api/plugins/catalog/sync',headers=a,json={})
    assert job.status_code==202
    assert (await client.get('/api/plugins/catalog/sync',headers=b)).json() is None
    await plugin_sync.tick(sessions)
    progress=(await client.get('/api/plugins/catalog/sync',headers=a)).json()
    assert progress['checked']==6 and progress['status']=='running'
    # Another runner resumes the persisted job, independent of a browser poll.
    await plugin_sync.tick(sessions)
    final=(await client.get('/api/plugins/catalog/sync',headers=a)).json()
    assert final['checked']==8 and final['counts']=={'connected':8} and final['status']=='completed'
    assert len((await client.get('/api/plugins',headers=a)).json())==8
    assert (await client.get('/api/plugins',headers=b)).json()==[]

def test_server_credentials_are_explicitly_endpoint_and_owner_bound(monkeypatch):
    monkeypatch.setenv('GROKBOT_PLUGIN_CREDENTIALS',json.dumps({'https://official.example/mcp':{'env':'SERVICE_TEST_KEY','header':'x-api-key'}}))
    monkeypatch.setenv('SERVICE_TEST_KEY','test-only-secret')
    assert plugin_sync.mapped_credential('https://official.example/mcp','another-owner') is None
    assert plugin_sync.mapped_credential('https://untrusted.example/mcp','legacy-owner') is None
    assert json.loads(plugin_sync.mapped_credential('https://official.example/mcp','legacy-owner'))=={'x-api-key':'test-only-secret'}
