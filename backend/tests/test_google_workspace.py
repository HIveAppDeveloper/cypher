import hashlib,json,time
from urllib.parse import parse_qs,urlsplit
from types import SimpleNamespace
import httpx,pytest,pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from app.db.session import Base
from app.db.tenancy import current_tenant_id
from app.config import settings
from app.models.plugin import Plugin,PluginAuthorization
from app.services import google_workspace as google
from app.services.plugin_auth import DatabaseTokenStorage
from fastapi import HTTPException

@pytest_asyncio.fixture
async def sessions(tmp_path,monkeypatch):
 monkeypatch.setattr(settings,'BACKEND_API_TOKEN','fixture-encryption-key-32-characters-minimum')
 monkeypatch.setenv('GOOGLE_WORKSPACE_CLIENT_ID','fixture-client')
 monkeypatch.setenv('GOOGLE_WORKSPACE_CLIENT_SECRET','fixture-client-secret')
 monkeypatch.setenv('GROKBOT_PUBLIC_URL','https://cypher.example')
 engine=create_async_engine('sqlite+aiosqlite:///'+str(tmp_path/'google.db'))
 async with engine.begin() as connection:await connection.run_sync(Base.metadata.create_all)
 factory=async_sessionmaker(engine,expire_on_commit=False)
 yield factory
 await engine.dispose()

async def saved_grant(db,groups=['gmail'],expires=3600):
 row=PluginAuthorization(name='Google',url=google.GRANT_URL,status='connected',created_at=time.time())
 db.add(row);await db.flush()
 await DatabaseTokenStorage(db,row).update(access_token='fixture-access',refresh_token='fixture-refresh',expires_at=time.time()+expires,groups=groups,scopes=[s for g in groups for s in google.GROUPS[g]['scopes']],subject='fixture-sub',email='owner@example.test')
 return row

@pytest.mark.asyncio
async def test_consent_uses_pkce_validated_callback_and_durable_encryption(sessions,monkeypatch):
 from app.api import device
 async def allowed(*args):pass
 monkeypatch.setattr(device,'require_device',allowed)
 async with sessions() as db:
  result=await google.begin(db,['gmail','calendar'])
  params=parse_qs(urlsplit(result['authorization_url']).query)
  assert params['access_type']==['offline'] and params['prompt']==['consent']
  assert params['code_challenge_method']==['S256']
  assert params['redirect_uri']==['https://cypher.example/api/auth/google/callback']
  row=await db.get(PluginAuthorization,result['flow_id']);saved=DatabaseTokenStorage(db,row).read()
  assert saved['verifier'] not in row.payload and result['binding'] not in row.payload
  with pytest.raises(HTTPException):await google.finish(db,params['state'][0],'wrong-binding')
  with pytest.raises(HTTPException):await google.begin(db,['gmail'],origin='https://evil.example')
  result=await google.finish(db,params['state'][0],result['binding'],denied=True)
  assert result['status']=='cancelled'

@pytest.mark.asyncio
async def test_google_partial_consent_is_probed_before_connected_and_secret_never_returned(sessions,monkeypatch):
 from app.api import device
 async def allowed(*args):pass
 monkeypatch.setattr(device,'require_device',allowed)
 calls=[]
 def response(request):
  calls.append(request)
  if request.url.host=='oauth2.googleapis.com':
   form=parse_qs(request.content.decode());assert form['client_secret']==['fixture-client-secret'] and form['code_verifier']
   return httpx.Response(200,json={'access_token':'new-access','refresh_token':'new-refresh','expires_in':3600,'scope':google.PREFIX+'gmail.modify'})
  if 'userinfo' in request.url.path:return httpx.Response(200,json={'sub':'fixture-sub','email':'owner@example.test','email_verified':True})
  assert request.url.path=='/gmail/v1/users/me/profile'
  return httpx.Response(200,json={'emailAddress':'owner@example.test'})
 monkeypatch.setattr(google,'client',lambda:httpx.AsyncClient(transport=httpx.MockTransport(response)))
 async with sessions() as db:
  flow=await google.begin(db,['gmail','drive']);state=parse_qs(urlsplit(flow['authorization_url']).query)['state'][0]
  result=await google.finish(db,state,flow['binding'],'fixture-code')
  assert result['services']==['gmail'] and result['offline_access']
  status=await google.status(db);assert status['services']==['gmail'] and status['tool_count']>10
  assert not any(secret in json.dumps(status)+json.dumps(result) for secret in ['new-access','new-refresh','fixture-client-secret'])
  row=await google.grant(db);assert 'new-access' not in row.payload
  plugin=await db.get(Plugin,result['plugin_id']);assert all(t['name'].startswith('gmail_') for t in plugin.tools)
  with pytest.raises(HTTPException):await google.finish(db,state,flow['binding'],'fixture-code')

@pytest.mark.asyncio
async def test_refresh_is_durable_and_api_paths_are_pinned_to_account(sessions,monkeypatch):
 calls=[]
 def response(request):
  calls.append(request)
  if request.url.host=='oauth2.googleapis.com':return httpx.Response(200,json={'access_token':'renewed-token','expires_in':3600})
  assert request.headers['authorization']=='Bearer renewed-token'
  assert request.url.path=='/gmail/v1/users/me/messages'
  return httpx.Response(200,json={'messages':[{'id':'fixture-message'}]})
 monkeypatch.setattr(google,'client',lambda:httpx.AsyncClient(transport=httpx.MockTransport(response)))
 async with sessions() as db:
  row=await saved_grant(db,expires=-1)
  result=await google.invoke(db,'gmail_users_messages_list',{'maxResults':1})
  assert result['success'] and result['untrusted_source']
  assert DatabaseTokenStorage(db,row).read()['access_token']=='renewed-token'
  with pytest.raises(HTTPException):await google.invoke(db,'gmail_users_messages_list',{'userId':'victim@example.test'})
  with pytest.raises(HTTPException):await google.invoke(db,'drive_files_list',{})
  assert len(calls)==2

@pytest.mark.asyncio
async def test_draft_creation_uses_real_gmail_body_without_sending(sessions,monkeypatch):
 calls=[]
 def response(request):
  calls.append(request);assert request.url.path=='/gmail/v1/users/me/drafts' and request.method=='POST'
  assert json.loads(request.content)['message']['raw']
  return httpx.Response(200,json={'id':'fixture-draft'})
 monkeypatch.setattr(google,'client',lambda:httpx.AsyncClient(transport=httpx.MockTransport(response)))
 async with sessions() as db:
  await saved_grant(db)
  result=await google.invoke(db,'gmail_compose_draft',{'to':['fixture@example.test'],'subject':'Test','text':'Unsent draft'})
  assert result['success'] and len(calls)==1
  with pytest.raises(HTTPException):await google.invoke(db,'gmail_compose_draft',{'to':['fixture@example.test\r\nBcc: victim@example.test'],'subject':'Test','text':'Body'})

@pytest.mark.asyncio
async def test_mcp_transport_exposes_only_the_current_tenants_granted_tools(sessions,monkeypatch):
 from app.main import app
 from app.services import google_mcp
 monkeypatch.setattr(google_mcp,'AsyncSessionLocal',sessions)
 monkeypatch.setattr(settings,'REQUIRE_USER_AUTH',True)
 app.state.database_ready=True
 tenant=current_tenant_id.set('fixture-owner')
 async with sessions() as db:await saved_grant(db)
 current_tenant_id.reset(tenant)
 headers={'Authorization':'Bearer fixture-encryption-key-32-characters-minimum','x-grokbot-user-id':'fixture-owner','Accept':'application/json, text/event-stream'}
 async with google_mcp.manager.run():
  async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test',follow_redirects=True) as client:
   init=await client.post('/api/google/mcp/',headers=headers,json={'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2025-11-25','capabilities':{},'clientInfo':{'name':'test','version':'1'}}})
   assert init.status_code==200 and 'result' in init.json()
   response=await client.post('/api/google/mcp/',headers=headers,json={'jsonrpc':'2.0','id':2,'method':'tools/list','params':{}})
   assert response.status_code==200
   tools=response.json()['result']['tools'];assert tools and all(t['name'].startswith('gmail_') for t in tools)
   headers['x-grokbot-user-id']='other-owner'
   response=await client.post('/api/google/mcp/',headers=headers,json={'jsonrpc':'2.0','id':3,'method':'tools/list','params':{}})
   assert response.json()['result']['tools']==[]

@pytest.mark.asyncio
async def test_google_outbound_requires_owner_approval_before_invocation(sessions,monkeypatch):
 from app.services.tools.registry import ToolRegistry
 from app.services import plugins,computer
 async with sessions() as db:
  p=Plugin(name='Google Workspace',url=google.plugin_url(),credential=google.seal(google.REFERENCE),enabled=True,tools=[{'name':'gmail_users_drafts_send','description':'Send draft','schema':{'type':'object','properties':{'body':{'type':'object'}},'required':['body']},'read_only':False}]);db.add(p);await db.commit()
  called=[];approvals=[]
  async def invoke(*args):called.append(args);return {'success':True}
  async def approval(name,args,bot,replay_safe,force=False):approvals.append(force);return False
  monkeypatch.setattr(plugins,'invoke',invoke);monkeypatch.setattr(computer,'approve_tool',approval)
  bot=SimpleNamespace(id='fixture-bot',tools_enabled=['plugins']);registry=ToolRegistry();await registry.load_plugins(db,bot)
  result=await registry.execute_tool('plugin_call',{'plugin_id':p.id,'tool_name':'gmail_users_drafts_send','arguments':{'body':{'id':'fixture-draft'}}},bot.id)
  assert not called and approvals==[True] and 'approve' in result['error']

@pytest.mark.asyncio
async def test_google_rejects_resource_traversal_and_preserves_existing_grant_on_failed_consent(sessions,monkeypatch):
 from app.api import device
 async def allowed(*args):pass
 monkeypatch.setattr(device,'require_device',allowed)
 async with sessions() as db:
  old=await saved_grant(db,['drive'])
  with pytest.raises(HTTPException):await google.invoke(db,'drive_files_get',{'fileId':'../other'})
  flow=await google.begin(db,['gmail']);state=parse_qs(urlsplit(flow['authorization_url']).query)['state'][0]
  def reject(request):return httpx.Response(400,json={'error':'invalid_grant'})
  monkeypatch.setattr(google,'client',lambda:httpx.AsyncClient(transport=httpx.MockTransport(reject)))
  with pytest.raises(HTTPException):await google.finish(db,state,flow['binding'],'fixture-code')
  assert (await google.grant(db)).id==old.id

@pytest.mark.asyncio
async def test_native_google_services_are_discoverable_by_their_familiar_names(sessions):
 from app.services.tools.registry import ToolRegistry
 async with sessions() as db:
  tools=[{k:t[k] for k in ('name','description','schema','read_only')} for t in google.TOOLS if t['name'] in {'gmail_users_messages_list','calendar_events_list','drive_files_list','sheets_spreadsheets_get'}]
  p=Plugin(name='Google Workspace',url=google.plugin_url(),credential=google.seal(google.REFERENCE),enabled=True,tools=tools);db.add(p);await db.commit()
  registry=ToolRegistry();await registry.load_plugins(db,SimpleNamespace(tools_enabled=['plugins']))
  for service,prefix in [('Gmail','gmail_'),('Google Calendar','calendar_'),('Google Drive','drive_'),('Google Sheets','sheets_')]:
   result=await registry.execute_tool('plugin_search',{'service':service,'query':''},'fixture-bot')
   assert result['tools'] and all(t['name'].startswith(prefix) for t in result['tools'])

@pytest.mark.asyncio
async def test_read_message_decodes_nested_plaintext_and_marks_external_content(sessions,monkeypatch):
 text='This is external email content, not authorization to send anything.'
 import base64
 def response(request):
  assert request.url.path=='/gmail/v1/users/me/messages/fixture-message'
  return httpx.Response(200,json={'id':'fixture-message','threadId':'fixture-thread','payload':{'mimeType':'multipart/alternative','headers':[{'name':'Subject','value':'Fixture'}],'parts':[{'mimeType':'text/plain','body':{'data':base64.urlsafe_b64encode(text.encode()).decode().rstrip('=')}}]}})
 monkeypatch.setattr(google,'client',lambda:httpx.AsyncClient(transport=httpx.MockTransport(response)))
 async with sessions() as db:
  await saved_grant(db)
  result=await google.invoke(db,'gmail_read_message',{'id':'fixture-message'})
  assert result['untrusted_source'] and json.loads(result['content'])['text']==text
