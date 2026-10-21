import hashlib
import importlib.util
import json
import secrets
import sys
import time
import types
from pathlib import Path
from urllib.parse import parse_qs,urlsplit
import httpx
import pytest
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from fastapi import HTTPException
from app.db.session import Base
from app.models.plugin import Plugin,PluginAuthorization
from app.services import plugin_auth
from app.services.plugin_auth import DatabaseTokenStorage,make_provider,SignInRequired
from app.config import settings

spec=importlib.util.spec_from_file_location('plugin_catalog_tests',Path(__file__).parents[1]/'app/api/plugin_catalog.py')
catalog_api=importlib.util.module_from_spec(spec);spec.loader.exec_module(catalog_api)

@pytest.fixture
async def db(tmp_path,monkeypatch):
    monkeypatch.setattr(settings,'BACKEND_API_TOKEN','test-only-encryption-key-not-for-production')
    engine=create_async_engine(f'sqlite+aiosqlite:///{tmp_path}/oauth.db')
    async with engine.begin() as connection:await connection.run_sync(Base.metadata.create_all)
    factory=async_sessionmaker(engine,expire_on_commit=False)
    async with factory() as session:yield session
    await engine.dispose()

@pytest.mark.asyncio
async def test_website_resolution_and_catalog(monkeypatch):
    monkeypatch.setattr(catalog_api,'http_client',lambda:httpx.AsyncClient(transport=httpx.MockTransport(lambda request:httpx.Response(404))))
    assert len(catalog_api.catalog())==100
    assert len({item['url'] for item in catalog_api.catalog()})==100
    result=await catalog_api.resolve(catalog_api.Website(website='https://vercel.com/hiveapp/open-grokbot'))
    assert result['url']=='https://mcp.vercel.com'
    for url in ['vercel.com','https://www.vercel.com/','notion.so','linear.app']:
        assert (await catalog_api.resolve(catalog_api.Website(website=url)))['url'].startswith('https://')
    with pytest.raises(HTTPException) as error:await catalog_api.resolve(catalog_api.Website(website='https://unlisted-company.invalid'))
    assert error.value.status_code==404
    with pytest.raises(HTTPException):await catalog_api.resolve(catalog_api.Website(website='https://user:password@vercel.com'))

async def create_flow(db):
    binding=secrets.token_urlsafe(32)
    row=PluginAuthorization(name='Test service',url='https://service.example/mcp',created_at=time.time(),status='discovering',binding_hash=hashlib.sha256(binding.encode()).hexdigest())
    db.add(row);await db.commit();await db.refresh(row)
    return row,binding

async def prepare_consent(db,row,monkeypatch):
    async def valid_endpoint(url):pass
    monkeypatch.setattr(plugin_auth,'validate_endpoint',valid_endpoint)
    provider=await make_provider(db,row,'https://grokbot.example/api/plugin-oauth/callback')
    requests=[]
    def transport(request):
        requests.append(request)
        if request.url.path=='/mcp':return httpx.Response(401,headers={'WWW-Authenticate':'Bearer resource_metadata="https://service.example/.well-known/oauth-protected-resource"'},json={})
        if request.url.path=='/.well-known/oauth-protected-resource':return httpx.Response(200,json={'resource':'https://service.example/mcp','authorization_servers':['https://accounts.example'],'scopes_supported':['read']})
        if request.url.path=='/.well-known/oauth-authorization-server':return httpx.Response(200,json={'issuer':'https://accounts.example','authorization_endpoint':'https://accounts.example/authorize','token_endpoint':'https://accounts.example/token','registration_endpoint':'https://accounts.example/register','code_challenge_methods_supported':['S256'],'response_types_supported':['code'],'token_endpoint_auth_methods_supported':['none']})
        if request.url.path=='/register':return httpx.Response(201,json={'client_id':'test-client','redirect_uris':['https://grokbot.example/api/plugin-oauth/callback'],'token_endpoint_auth_method':'none'})
        return httpx.Response(404)
    with pytest.raises(SignInRequired):
        async with httpx.AsyncClient(auth=provider,transport=httpx.MockTransport(transport)) as client:
            await client.get(row.url,headers={'MCP-Protocol-Version':'2025-11-25'})
    saved=DatabaseTokenStorage(db,row).read()
    return provider,saved,requests

@pytest.mark.asyncio
async def test_real_sdk_discovers_registers_and_persists_pkce(db,monkeypatch):
    row,binding=await create_flow(db)
    provider,saved,requests=await prepare_consent(db,row,monkeypatch)
    params=parse_qs(urlsplit(saved['authorization_url']).query)
    assert row.status=='awaiting_login'
    assert params['code_challenge_method']==['S256']
    expected=plugin_auth.base64.urlsafe_b64encode(hashlib.sha256(saved['verifier'].encode()).digest()).decode().rstrip('=')
    assert params['code_challenge']==[expected]
    assert params['redirect_uri']==['https://grokbot.example/api/plugin-oauth/callback']
    assert saved['verifier'] not in row.payload and 'test-client' not in row.payload
    assert saved['oauth_metadata']['issuer'].rstrip('/')=='https://accounts.example'
    assert params['state'][0].startswith(row.id+'.')
    assert any(request.url.path=='/register' for request in requests)
    assert not any(request.url.path=='/token' for request in requests)

@pytest.mark.asyncio
async def test_callback_rejects_wrong_browser_and_expired_state(db,monkeypatch):
    row,binding=await create_flow(db);_,saved,_=await prepare_consent(db,row,monkeypatch)
    state=parse_qs(urlsplit(saved['authorization_url']).query)['state'][0]
    with pytest.raises(HTTPException) as error:
        await catalog_api.callback(catalog_api.Callback(state=state,code='temporary-code',binding='wrong-browser-binding'),db)
    assert error.value.status_code==400 and row.status=='awaiting_login'
    row.created_at=time.time()-601;await db.commit()
    with pytest.raises(HTTPException):await catalog_api.callback(catalog_api.Callback(state=state,code='temporary-code',binding=binding),db)

@pytest.mark.asyncio
async def test_callback_cancellation_never_connects(db,monkeypatch):
    row,binding=await create_flow(db);_,saved,_=await prepare_consent(db,row,monkeypatch)
    state=parse_qs(urlsplit(saved['authorization_url']).query)['state'][0]
    result=await catalog_api.callback(catalog_api.Callback(state=state,binding=binding,denied=True),db)
    assert result['status']=='cancelled' and row.plugin_id is None and row.payload is None

@pytest.mark.asyncio
async def test_callback_exchange_verification_and_replay_protection(db,monkeypatch):
    row,binding=await create_flow(db);_,saved,_=await prepare_consent(db,row,monkeypatch)
    state=parse_qs(urlsplit(saved['authorization_url']).query)['state'][0]
    exchange_requests=[]
    def exchange(request):
        exchange_requests.append(request)
        assert request.url.host=='accounts.example' and request.url.path=='/token'
        body=parse_qs(request.content.decode())
        assert body['code_verifier']==[saved['verifier']]
        assert body['code']==['temporary-code']
        return httpx.Response(200,json={'access_token':'private-access','refresh_token':'private-refresh','token_type':'Bearer','expires_in':3600})
    monkeypatch.setattr(catalog_api,'http_client',lambda:httpx.AsyncClient(transport=httpx.MockTransport(exchange)))
    async def tools(url,token=None,auth=None):
        assert auth and auth.context.current_tokens.access_token=='private-access'
        return [{'name':'lookup','description':'Look up records','schema':{'type':'object','properties':{}}}]
    monkeypatch.setattr(catalog_api,'discover',tools)
    result=await catalog_api.callback(catalog_api.Callback(state=state,code='temporary-code',binding=binding),db)
    assert result['status']=='connected' and len(exchange_requests)==1
    assert (await db.get(Plugin,result['plugin_id'])).tools[0]['name']=='lookup'
    assert 'private-access' not in row.payload and 'private-refresh' not in row.payload
    assert 'verifier' not in DatabaseTokenStorage(db,row).read()
    with pytest.raises(HTTPException):await catalog_api.callback(catalog_api.Callback(state=state,code='temporary-code',binding=binding),db)

@pytest.mark.asyncio
async def test_saved_token_expiry_and_refresh_retention(db):
    from mcp.shared.auth import OAuthToken
    row,_=await create_flow(db);storage=DatabaseTokenStorage(db,row)
    await storage.set_tokens(OAuthToken(access_token='old',refresh_token='keep-me',token_type='Bearer',expires_in=3600))
    await storage.update(expires_at=time.time()-10)
    assert (await storage.get_tokens()).expires_in==0
    await storage.set_tokens(OAuthToken(access_token='new',token_type='Bearer',expires_in=100))
    assert (await storage.get_tokens()).refresh_token=='keep-me'

@pytest.mark.asyncio
async def test_expired_saved_token_refreshes_before_tool_request(db,monkeypatch):
    from mcp.shared.auth import OAuthToken
    row,_=await create_flow(db);_,saved,_=await prepare_consent(db,row,monkeypatch)
    row.status='connected';storage=DatabaseTokenStorage(db,row)
    await storage.set_tokens(OAuthToken(access_token='expired',refresh_token='refresh-me',token_type='Bearer',expires_in=1))
    await storage.update(expires_at=time.time()-10)
    provider=await make_provider(db,row);requests=[]
    def transport(request):
        requests.append(request)
        if request.url.path=='/token':
            body=parse_qs(request.content.decode());assert body['grant_type']==['refresh_token'] and body['refresh_token']==['refresh-me']
            return httpx.Response(200,json={'access_token':'fresh','token_type':'Bearer','expires_in':3600})
        assert request.headers['Authorization']=='Bearer fresh'
        return httpx.Response(200,json={'ok':True})
    async with httpx.AsyncClient(auth=provider,transport=httpx.MockTransport(transport)) as client:
        assert (await client.get(row.url)).status_code==200
    assert len(requests)==2 and requests[0].url.path=='/token'
    assert (await storage.get_tokens()).refresh_token=='refresh-me'

@pytest.mark.asyncio
async def test_public_connection_does_not_create_invalid_oauth_provider(db):
    from app.services.plugin_auth import provider_for_plugin
    plugin=Plugin(name='Public tools',url='https://public.example/mcp',tools=[],enabled=True);db.add(plugin);await db.flush()
    row=PluginAuthorization(name=plugin.name,url=plugin.url,created_at=time.time(),status='connected',plugin_id=plugin.id)
    db.add(row);await db.commit()
    assert await provider_for_plugin(db,plugin.id) is None

@pytest.mark.asyncio
async def test_reconnect_preserves_existing_connection_until_verified(db,monkeypatch):
    plugin=Plugin(name='Existing',url='https://service.example/mcp',tools=[{'name':'lookup','enabled':False}],enabled=False);db.add(plugin);await db.flush()
    old=PluginAuthorization(name=plugin.name,url=plugin.url,created_at=time.time(),status='connected',plugin_id=plugin.id);db.add(old);await db.commit()
    row,binding=await create_flow(db);row.plugin_id=plugin.id;await db.commit()
    _,saved,_=await prepare_consent(db,row,monkeypatch)
    assert await db.get(PluginAuthorization,old.id) is not None and not plugin.enabled
    state=parse_qs(urlsplit(saved['authorization_url']).query)['state'][0]
    def exchange(request):return httpx.Response(200,json={'access_token':'new-private-access','token_type':'Bearer','expires_in':3600})
    monkeypatch.setattr(catalog_api,'http_client',lambda:httpx.AsyncClient(transport=httpx.MockTransport(exchange)))
    async def tools(url,token=None,auth=None):return [{'name':'lookup','description':'Look up records','schema':{}},{'name':'new_tool','description':'New tool','schema':{}}]
    monkeypatch.setattr(catalog_api,'discover',tools)
    result=await catalog_api.callback(catalog_api.Callback(state=state,code='temporary-code',binding=binding),db)
    assert result['plugin_id']==plugin.id and not plugin.enabled
    assert plugin.tools[0]['enabled'] is False
    assert await db.get(PluginAuthorization,old.id) is None
    assert row.status=='connected'

@pytest.mark.asyncio
async def test_cancel_sign_in_invalidates_callback_and_preserves_old_plugin(db,monkeypatch):
    row,binding=await create_flow(db);_,saved,_=await prepare_consent(db,row,monkeypatch)
    state=parse_qs(urlsplit(saved['authorization_url']).query)['state'][0]
    with pytest.raises(HTTPException):await catalog_api.cancel_authorization(catalog_api.CancelAuthorization(flow_id=row.id,binding='another-browser-binding'),db)
    result=await catalog_api.cancel_authorization(catalog_api.CancelAuthorization(flow_id=row.id,binding=binding),db)
    assert result['status']=='cancelled' and row.payload is None and row.state_hash is None
    with pytest.raises(HTTPException):await catalog_api.callback(catalog_api.Callback(state=state,code='temporary-code',binding=binding),db)
