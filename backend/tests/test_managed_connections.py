import hashlib,json
from types import SimpleNamespace
from urllib.parse import parse_qs,urlsplit
import httpx,httpx2,pytest
from sqlalchemy import select
from vercel.connect import UserAuthorizationRequiredError
from app.config import settings
from app.db.tenancy import current_tenant_id
from app.models.plugin import Plugin,PluginAuthorization
from app.services import managed_connections as managed
from app.services.plugins import reveal
from app.api import plugin_catalog
from .test_workspace_workflows import workspace

CONFIG=[{'id':'provider','name':'Provider','url':'https://provider.example/mcp','domains':['provider.example'],'connector':'oauth/provider','owner_installation':'installed-owner'},
        {'id':'private','name':'Private installation','url':'https://private.example/mcp','domains':[],'connector':'github/private','owner_installation':'private-install','owner_only':True}]

@pytest.mark.asyncio
async def test_new_users_sign_in_separately_and_reuse_their_own_grant(workspace,monkeypatch):
    client,sessions=workspace
    monkeypatch.setenv('GROKBOT_MANAGED_CONNECTORS',json.dumps(CONFIG))
    async def public(_):pass
    monkeypatch.setattr(plugin_catalog,'validate_endpoint',public)
    from vercel import connect
    authorized=set();subjects=[];returns={};discovered=[]
    async def get_token(connector,**params):
        subject=params['subject'];subjects.append(subject)
        if subject.id not in authorized:raise UserAuthorizationRequiredError(httpx2.Response(401),'Consent required')
        return 'access-for-'+subject.id
    async def start(connector,**params):
        returns[params['subject'].id]=params['return_url']
        return SimpleNamespace(url='https://accounts.provider.example/consent')
    async def discover(url,token):
        discovered.append(token)
        return [{'name':'read','description':'Read','schema':{'type':'object'},'read_only':True}]
    monkeypatch.setattr(connect,'get_token',get_token)
    monkeypatch.setattr(connect,'start_authorization',start)
    monkeypatch.setattr(managed,'discover',discover)
    a={'x-grokbot-user-id':'person-a'};b={'x-grokbot-user-id':'person-b'}
    assert (await client.post('/api/plugins/resolve',headers=a,json={'website':'provider.example'})).json()['url']==CONFIG[0]['url']
    begun=(await client.post('/api/plugins/authorize',headers=a,json={'name':'Provider','url':CONFIG[0]['url']})).json()
    assert begun['status']=='awaiting_login'
    state=parse_qs(urlsplit(returns['grokbot:person-a']).query)['state'][0]
    body={'state':state,'binding':begun['binding']}
    assert (await client.post('/api/plugins/managed/callback',headers=b,json=body)).status_code==400
    assert (await client.post('/api/plugins/managed/callback',headers=a,json={**body,'binding':'wrong-browser-binding'})).status_code==400
    authorized.add('grokbot:person-a')
    result=await client.post('/api/plugins/managed/callback',headers=a,json=body)
    assert result.status_code==200,result.text
    pid=result.json()['plugin_id']
    assert (await client.get('/api/plugins',headers=b)).json()==[]
    again=(await client.post('/api/plugins/authorize',headers=a,json={'name':'Provider','url':CONFIG[0]['url']})).json()
    assert again['status']=='connected' and again['plugin_id']==pid and len(returns)==1
    await client.patch('/api/plugins/'+pid+'/tools/read',headers=a,json={'enabled':False})
    refreshed=await client.post('/api/plugins/authorize',headers=a,json={'name':'Provider','url':CONFIG[0]['url'],'reconnect':True})
    assert refreshed.status_code==200 and refreshed.json()['status']=='connected'
    own=(await client.get('/api/plugins',headers=a)).json()
    assert len(own)==1 and own[0]['tools'][0]['enabled'] is False
    other=await client.post('/api/plugins/authorize',headers=b,json={'name':'Provider','url':CONFIG[0]['url'],'subject':'app','installation_id':'installed-owner'})
    assert other.json()['status']=='awaiting_login' and 'grokbot:person-b' in returns
    assert all(subject.type=='user' for subject in subjects)
    assert all(token=='access-for-grokbot:person-a' for token in discovered)
    token=current_tenant_id.set('person-a')
    try:
        async with sessions() as db:
            plugin=await db.get(Plugin,pid)
            assert reveal(plugin.credential)=='grokbot-connect:provider'
            assert 'access-for' not in plugin.credential
            rows=list((await db.execute(select(PluginAuthorization))).scalars())
            assert not any('access-for' in (row.payload or '') for row in rows)
    finally:current_tenant_id.reset(token)


def test_reused_owner_installations_remain_private_after_verified_owner_migration(monkeypatch):
    monkeypatch.setenv('GROKBOT_MANAGED_CONNECTORS',json.dumps(CONFIG))
    monkeypatch.setattr(settings,'LEGACY_OWNER_EMAIL','owner@example.com')
    owner='email:'+hashlib.sha256(b'owner@example.com').hexdigest()
    token=current_tenant_id.set(owner)
    try:
        params=managed.request_parameters(CONFIG[0])
        assert params['subject'].type=='app' and params['installation_id']=='installed-owner'
        assert all(c['reuse_available'] for c in managed.public_connections())
    finally:current_tenant_id.reset(token)
    token=current_tenant_id.set('new-person')
    try:
        params=managed.request_parameters(CONFIG[0],force_refresh=True)
        assert params['subject'].type=='user' and params['subject'].id=='grokbot:new-person'
        assert params['options'].force_refresh and 'installation_id' not in params
        assert len(managed.public_connections())==1
        with pytest.raises(ValueError):managed.request_parameters(CONFIG[1])
    finally:current_tenant_id.reset(token)


@pytest.mark.asyncio
async def test_managed_tokens_cannot_be_sent_to_another_endpoint(monkeypatch):
    monkeypatch.setenv('GROKBOT_MANAGED_CONNECTORS',json.dumps(CONFIG))
    monkeypatch.setattr(settings,'BACKEND_API_TOKEN','test-only-private-key-more-than-thirty-two')
    from app.services.plugins import seal
    calls=[]
    async def access(*_):calls.append(True);return 'must-not-leak'
    monkeypatch.setattr(managed,'get_access',access)
    plugin=SimpleNamespace(url='https://attacker.example/mcp',credential=seal('grokbot-connect:provider'))
    with pytest.raises(ValueError):await managed.credentials(plugin)
    assert not calls


@pytest.mark.asyncio
async def test_new_website_uses_its_published_connector_and_rejects_registry_impersonation(monkeypatch):
    from app.services import website_connectors
    monkeypatch.setenv('GROKBOT_MANAGED_CONNECTORS','[]')
    async def valid(_):pass
    monkeypatch.setattr(plugin_catalog,'validate_endpoint',valid)
    monkeypatch.setattr(website_connectors,'validate_endpoint',valid)
    requests=[]
    def transport(request):
        requests.append(str(request.url))
        if request.url.host=='new-provider.example' and request.url.path=='/.well-known/mcp.json':
            return httpx.Response(200,json={'mcpServers':{'official':{'url':'https://mcp.new-provider.example/mcp'}}})
        if request.url.host=='registry.modelcontextprotocol.io':
            return httpx.Response(200,json={'servers':[{'server':{'name':'impersonator','websiteUrl':'https://unlisted.example','remotes':[{'type':'streamable-http','url':'https://attacker.example/mcp'}]}}]})
        return httpx.Response(404)
    monkeypatch.setattr(plugin_catalog,'http_client',lambda:httpx.AsyncClient(transport=httpx.MockTransport(transport)))
    found=await plugin_catalog.resolve(plugin_catalog.Website(website='new-provider.example'))
    assert found['url']=='https://mcp.new-provider.example/mcp' and found['source']=='https://new-provider.example'
    generated=await plugin_catalog.resolve(plugin_catalog.Website(website='unlisted.example'))
    assert generated['url']=='site-mcp://unlisted.example' and generated['auth']=='generated'

@pytest.mark.asyncio
async def test_two_managed_accounts_on_one_endpoint_remain_distinct(workspace,monkeypatch):
    client,sessions=workspace
    config=[{**CONFIG[0],'id':'account-one'},{**CONFIG[0],'id':'account-two','name':'Provider second account','connector':'oauth/second'}]
    monkeypatch.setenv('GROKBOT_MANAGED_CONNECTORS',json.dumps(config))
    async def valid(_):pass
    async def access(config,force_refresh=False):return 'token-'+config['id']
    async def discover(*args):return [{'name':'read','description':'Read','schema':{},'read_only':True}]
    monkeypatch.setattr(plugin_catalog,'validate_endpoint',valid)
    monkeypatch.setattr(managed,'get_access',access);monkeypatch.setattr(managed,'discover',discover)
    headers={'x-grokbot-user-id':'multi-account-owner'}
    ids=[]
    for item in config:
        r=await client.post('/api/plugins/authorize',headers=headers,json={'name':item['name'],'url':item['url'],'connection_id':item['id']})
        assert r.status_code==200,r.text
        ids.append(r.json()['plugin_id'])
    assert ids[0]!=ids[1]
    assert len((await client.get('/api/plugins',headers=headers)).json())==2
    again=await client.post('/api/plugins/authorize',headers=headers,json={'name':'First','url':config[0]['url'],'connection_id':'account-one'})
    assert again.json()['plugin_id']==ids[0]
