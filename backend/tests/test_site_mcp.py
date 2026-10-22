import json
import httpx,pytest
from sqlalchemy import select
from app.api import plugin_catalog
from app.models.plugin import Plugin
from app.services import site_mcp, website_connectors
from app.services.plugins import discover, session
from .test_workspace_workflows import workspace

SPEC={'openapi':'3.1.0','servers':[{'url':'/api'}],'paths':{
    '/items/{id}':{'get':{'operationId':'getItem','summary':'Read an item','parameters':[{'name':'id','in':'path','required':True,'schema':{'type':'string'}},{'name':'fields','in':'query','schema':{'type':'string'}}]}},
    '/items':{'post':{'operationId':'createItem','requestBody':{'required':True,'content':{'application/json':{'schema':{'type':'object'}}}}}},
    '/elsewhere':{'get':{'operationId':'escape'}}}}

def fake_http(handler):
    def factory(headers=None,timeout=None,auth=None):
        return httpx.AsyncClient(transport=httpx.MockTransport(handler),headers=headers,timeout=timeout)
    return factory

@pytest.fixture(autouse=True)
def public(monkeypatch):
    async def allow(url):pass
    site_mcp._specs.clear()
    monkeypatch.setattr(site_mcp,'validate_endpoint',allow)
    monkeypatch.setattr(plugin_catalog,'validate_endpoint',allow)

@pytest.mark.asyncio
async def test_openapi_site_becomes_mcp_tools_that_call_the_api(monkeypatch):
    seen=[]
    def handler(request):
        seen.append((request.method,str(request.url),request.headers.get('x-api-key'),request.content))
        if request.url.path=='/openapi.json':return httpx.Response(200,json=SPEC)
        if request.url.path.startswith('/api/items'):return httpx.Response(200,json={'ok':True})
        return httpx.Response(404)
    monkeypatch.setattr(site_mcp,'http_client',fake_http(handler))
    tools={t['name']:t for t in await discover('site-mcp://example.com',json.dumps({'X-Api-Key':'k'}))}
    assert {'getItem','createItem','escape','open_page','read_page','search_site','click','fill_form','screenshot'}<=set(tools)
    assert tools['getItem']['read_only'] and not tools['createItem']['read_only'] and not tools['click']['read_only']
    assert tools['getItem']['schema']['required']==['id'] and 'body' in tools['createItem']['schema']['required']
    async with session('site-mcp://example.com',json.dumps({'X-Api-Key':'k'})) as client:
        result=await client.call_tool('getItem',{'id':'a b','fields':'name'})
        assert json.loads(result.content[0].text)=={'success':True,'status':200,'data':{'ok':True}}
        await client.call_tool('createItem',{'body':{'name':'new'}})
        invalid=await client.call_tool('getItem',{})
        assert invalid.isError
    calls=[c for c in seen if '/api/items' in c[1]]
    assert calls[0][:3]==('GET','https://example.com/api/items/a%20b?fields=name','k')
    assert calls[1][0]=='POST' and json.loads(calls[1][3])=={'name':'new'}

@pytest.mark.asyncio
async def test_operations_cannot_leave_the_website(monkeypatch):
    spec={**SPEC,'servers':[{'url':'https://attacker.example'}]}
    assert site_mcp.api_base(spec,'example.com')=='https://example.com'
    assert site_mcp.api_base({**SPEC,'servers':[{'url':'https://api.example.com/v2'}]},'example.com')=='https://api.example.com/v2'
    def handler(request):return httpx.Response(404)
    monkeypatch.setattr(site_mcp,'http_client',fake_http(handler))
    async with session('site-mcp://example.com') as client:
        result=await client.call_tool('open_page',{'path':'https://attacker.example/login'})
    assert 'Only example.com pages' in result.content[0].text

@pytest.mark.asyncio
async def test_probe_finds_conventional_oauth_and_public_mcp_endpoints(monkeypatch):
    def handler(request):
        if str(request.url)=='https://mcp.readdy.example/mcp':return httpx.Response(200,text='event: message\ndata: {"result":{"protocolVersion":"2025-06-18"}}')
        if str(request.url)=='https://app.base.example/mcp/':return httpx.Response(401,headers={'www-authenticate':'Bearer resource_metadata="https://app.base.example/.well-known/oauth-protected-resource/mcp"'})
        return httpx.Response(404)
    monkeypatch.setattr(site_mcp,'http_client',fake_http(handler))
    assert await site_mcp.probe_mcp('readdy.example')=='https://mcp.readdy.example/mcp'
    assert await site_mcp.probe_mcp('base.example')=='https://app.base.example/mcp/'
    assert await site_mcp.probe_mcp('nothing.example') is None

@pytest.mark.asyncio
async def test_instagram_links_are_read_from_public_previews(monkeypatch):
    post='<meta property="og:type" content="article" /><meta property="og:title" content="Just An Egg on Instagram: &quot;Hi&quot;" /><meta property="og:image" content="https://cdn.example/egg.jpg" /><meta property="og:url" content="https://www.instagram.com/world_record_egg/p/BsOGulcndj-/" /><meta property="og:description" content="60M likes, 4M comments - world_record_egg on January 4, 2019" />'
    embed='<span class="UsernameText">world_record_egg</span><div class="Caption"><a>world_record_egg</a> Let&#x2019;s set a <b>world record</b><div class="CaptionComments">'
    profile='<meta property="og:type" content="profile" /><meta property="og:title" content="NASA (&#064;nasa)" /><meta property="og:description" content="104M Followers, 94 Following, 4,970 Posts" />'
    agents=[]
    def handler(request):
        agents.append(request.headers['user-agent'])
        if request.url.path=='/p/BsOGulcndj-/':return httpx.Response(200,text=post)
        if request.url.path=='/p/BsOGulcndj-/embed/captioned/':return httpx.Response(200,text=embed)
        if request.url.path=='/nasa/':return httpx.Response(200,text=profile)
        return httpx.Response(200,text='<html></html>')
    monkeypatch.setattr(site_mcp,'http_client',fake_http(handler))
    result=await site_mcp.read_instagram('https://instagram.com/p/BsOGulcndj-/?igsh=abc')
    assert result['kind']=='post' and result['author']=='world_record_egg' and result['likes']=='60M' and result['comments']=='4M'
    assert result['caption']=='world_record_egg Let’s set a world record' and result['image']=='https://cdn.example/egg.jpg'
    assert (await site_mcp.read_instagram('https://www.instagram.com/nasa/'))['followers']=='104M'
    assert not (await site_mcp.read_instagram('https://www.instagram.com/p/missing/'))['success']
    assert not (await site_mcp.read_instagram('https://evil.example/p/x/'))['success']
    assert all(agent.startswith('facebookexternalhit') for agent in agents)
    tools={t['name'] for t in await discover('site-mcp://instagram.com')}
    assert 'read_instagram_link' in tools

@pytest.mark.asyncio
async def test_any_website_resolves_and_connects_in_one_click(workspace,monkeypatch):
    client,sessions=workspace
    async def none(*args):return None
    monkeypatch.setattr(website_connectors,'published_connector',none)
    monkeypatch.setattr(site_mcp,'probe_mcp',none)
    monkeypatch.setattr(site_mcp,'openapi_spec',none)
    def offline(*args,**kwargs):raise httpx.ConnectError('offline')
    monkeypatch.setattr(plugin_catalog,'http_client',offline)
    headers={'x-grokbot-user-id':'person-a'}
    found=(await client.post('/api/plugins/resolve',headers=headers,json={'website':'https://www.some-site.example/pricing'})).json()
    assert found['url']=='site-mcp://some-site.example' and found['auth']=='generated'
    connected=(await client.post('/api/plugins/authorize',headers=headers,json={'name':found['name'],'url':found['url']})).json()
    assert connected['status']=='connected'
    again=(await client.post('/api/plugins/authorize',headers=headers,json={'name':found['name'],'url':found['url']})).json()
    assert again['plugin_id']==connected['plugin_id']
    async with sessions() as db:
        plugin=(await db.execute(select(Plugin))).scalars().one()
    assert plugin.url=='site-mcp://some-site.example' and 'open_page' in {t['name'] for t in plugin.tools}
    listed=(await client.get('/api/plugins',headers=headers)).json()
    assert [p['url'] for p in listed]==['site-mcp://some-site.example']
    other=(await client.get('/api/plugins',headers={'x-grokbot-user-id':'person-b'})).json()
    assert other==[]

@pytest.mark.asyncio
async def test_featured_one_click_connectors_are_in_the_catalog(workspace):
    client,_=workspace
    items=(await client.get('/api/plugins/catalog',headers={'x-grokbot-user-id':'person-a'})).json()
    featured={i['name']:i for i in items if i.get('featured')}
    assert {'Lovable','Base44','Readdy','Instagram'}<=set(featured)
    assert featured['Lovable']['url']=='https://mcp.lovable.dev' and featured['Instagram']['url']=='site-mcp://instagram.com'
    resolved=(await client.post('/api/plugins/resolve',headers={'x-grokbot-user-id':'person-a'},json={'website':'readdy.ai'})).json()
    assert resolved['url']=='https://mcp.readdy.ai/mcp'
