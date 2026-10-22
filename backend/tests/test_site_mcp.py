import json
import httpx,pytest
import pytest_asyncio
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
async def test_operations_cannot_leave_the_website(monkeypatch,browser):
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

@pytest_asyncio.fixture
async def browser(monkeypatch):
    from types import SimpleNamespace
    from app.services.tools import registry
    from app.services import computer
    from app.services.usage import active
    from contextlib import asynccontextmanager
    fake=SimpleNamespace(url='https://example.com/',calls=[],after={})
    async def get_page(sid):return fake
    def operation(name):
        async def call(*args,**kwargs):
            fake.calls.append((name,kwargs['session_id']))
            fake.url=fake.after.get(name,fake.url)
            return {'success':True,'text_content':'SECRET','screenshot_base64':'c2VjcmV0','title':'SECRET','url':fake.url}
        return call
    fake._get_page=get_page
    for name in ('navigate_to','extract_content','click','fill_form','screenshot'):setattr(fake,name,operation(name))
    async def no_spec(host):return None
    async def bot():return 'test-bot'
    @asynccontextmanager
    async def access(*args):yield
    monkeypatch.setattr(registry,'_browser_tool',fake)
    monkeypatch.setattr(site_mcp,'openapi_spec',no_spec)
    monkeypatch.setattr(site_mcp,'browser_session',bot)
    monkeypatch.setattr(computer,'agent_access',access)
    fake.server=await site_mcp.build('example.com')
    token=active.set(('test-task',object()))
    try:yield fake
    finally:active.reset(token)

BROWSER_ACTIONS=[('read_page',{},'extract_content'),('click',{'target':'a'},'click'),('fill_form',{'fields':{},'submit':'button'},'fill_form'),('screenshot',{},'screenshot')]

@pytest.mark.asyncio
@pytest.mark.parametrize('name,args,operation',BROWSER_ACTIONS)
async def test_offsite_page_refused_before_action(browser,name,args,operation):
    browser.url='https://attacker.example/'
    result=await browser.server.handlers[name](args)
    assert json.loads(result[0].text)=={'success':False,'error':'The page left example.com. Only example.com pages can be read or used with this connection.'}
    assert browser.calls==[]

@pytest.mark.asyncio
@pytest.mark.parametrize('name,args,operation',BROWSER_ACTIONS+[('open_page',{},'navigate_to'),('fill_form',{'fields':{},'submit':'button'},'click')])
async def test_navigation_offsite_discards_content(browser,name,args,operation):
    browser.after[operation]='https://attacker.example/'
    result=await browser.server.handlers[name](args)
    assert len(result)==1 and result[0].type=='text'
    assert not json.loads(result[0].text)['success'] and 'SECRET' not in result[0].text
    assert [c[0] for c in browser.calls]==(['fill_form','click'] if name=='fill_form' and operation=='click' else [operation])

@pytest.mark.asyncio
@pytest.mark.parametrize('url',['http://example.com/','https://example.com:443/','https://example.com:8443/'])
async def test_navigation_rejects_http_and_ports(browser,url):
    result=await browser.server.handlers['open_page']({'path':url})
    assert not json.loads(result[0].text)['success'] and browser.calls==[]

@pytest.mark.asyncio
async def test_private_host_rejected_before_navigation_and_after_redirect(browser,monkeypatch):
    checked=[]
    async def validate(url):
        checked.append(url)
        if url=='https://private.example.com':raise ValueError('Private address')
    monkeypatch.setattr(site_mcp,'validate_endpoint',validate)
    result=await browser.server.handlers['open_page']({'path':'https://private.example.com/'})
    assert not json.loads(result[0].text)['success'] and browser.calls==[]
    browser.after['navigate_to']='https://private.example.com/'
    result=await browser.server.handlers['open_page']({})
    assert not json.loads(result[0].text)['success'] and 'SECRET' not in result[0].text
    assert checked==['https://private.example.com','https://example.com','https://private.example.com']

@pytest.mark.asyncio
@pytest.mark.parametrize('schema',[True,False])
async def test_boolean_schema_keeps_api_tools(monkeypatch,schema):
    async def spec(host):return {'paths':{'/items':{'get':{'operationId':'items','parameters':[{'name':'q','in':'query','schema':schema,'description':'Query'}]}}}}
    monkeypatch.setattr(site_mcp,'openapi_spec',spec)
    server=await site_mcp.build('example.com')
    assert {'items','open_page','read_page'}<=set(server.handlers)
    assert next(t for t in server.tools if t.name=='items').inputSchema['properties']['q']=={'description':'Query'}

@pytest.mark.asyncio
@pytest.mark.parametrize('failure',['fetch','parse'])
async def test_bad_spec_keeps_browser_tools(monkeypatch,failure):
    async def spec(host):
        if failure=='fetch':raise ValueError('Bad spec')
        return {'paths':{'/items':{'get':{'parameters':True}}}}
    monkeypatch.setattr(site_mcp,'openapi_spec',spec)
    assert set((await site_mcp.build('example.com')).handlers)=={'open_page','read_page','click','fill_form','screenshot','search_site'}

@pytest.mark.asyncio
@pytest.mark.parametrize('name,args',[(n,a) for n,a,_ in BROWSER_ACTIONS]+[('open_page',{}),('search_site',{'query':'items'})])
async def test_all_tools_hold_owner_control_lock(browser,monkeypatch,name,args):
    from contextlib import asynccontextmanager
    from app.services import computer
    from app.services.usage import active
    from app.services.tools import web_search
    events=[]
    sessions=object()
    async def bot():return 'bot-id'
    @asynccontextmanager
    async def access(bot_id,factory):
        assert bot_id=='bot-id' and factory is sessions
        events.append('enter')
        try:yield
        finally:events.append('exit')
    async def search(*args):
        assert events==['enter']
        return {'success':True}
    async def get_page(sid):
        assert sid=='bot-id' and events==['enter']
        return browser
    browser._get_page=get_page
    monkeypatch.setattr(site_mcp,'browser_session',bot)
    monkeypatch.setattr(computer,'agent_access',access)
    monkeypatch.setattr(web_search,'search_web',search)
    token=active.set(('task-id',sessions))
    try:result=await browser.server.handlers[name](args)
    finally:active.reset(token)
    assert result and events==['enter','exit']

@pytest.mark.asyncio
async def test_click_through_session_holds_owner_control_lock(browser,monkeypatch):
    from contextlib import asynccontextmanager
    from app.services import computer
    from app.services.usage import active
    events=[]
    sessions=object()
    async def bot():return 'bot-id'
    @asynccontextmanager
    async def access(bot_id,factory):
        assert factory is sessions
        events.append(('enter',bot_id))
        try:yield
        finally:events.append(('exit',bot_id))
    original_click=browser.click
    async def click(*args,**kwargs):
        assert events==[('enter','bot-id')]
        events.append(('click',kwargs['session_id']))
        return await original_click(*args,**kwargs)
    monkeypatch.setattr(browser,'click',click)
    monkeypatch.setattr(site_mcp,'browser_session',bot)
    monkeypatch.setattr(computer,'agent_access',access)
    token=active.set(('task-id',sessions))
    try:
        async with session('site-mcp://example.com') as client:
            result=await client.call_tool('click',{'target':'a'})
    finally:active.reset(token)
    assert not result.isError and json.loads(result.content[0].text)['success']
    assert browser.calls==[('click','bot-id')]
    assert events==[('enter','bot-id'),('click','bot-id'),('exit','bot-id')]


@pytest.mark.asyncio
@pytest.mark.parametrize('name,args',[(name,args) for name,args,_ in BROWSER_ACTIONS]+[('open_page',{}),('search_site',{'query':'hello'})])
async def test_browser_tools_require_a_private_agent_context(browser,name,args):
    from app.services.usage import active
    token=active.set(None)
    try: result=await browser.server.handlers[name](args)
    finally: active.reset(token)
    assert not json.loads(result[0].text)['success']
    assert browser.calls==[]


@pytest.mark.asyncio
async def test_unresolved_task_cannot_use_a_shared_browser(browser,monkeypatch):
    async def no_bot():return None
    monkeypatch.setattr(site_mcp,'browser_session',no_bot)
    result=await browser.server.handlers['open_page']({})
    assert not json.loads(result[0].text)['success'] and browser.calls==[]


@pytest.mark.asyncio
async def test_generated_tool_failures_are_mcp_errors(browser):
    from app.services.usage import active
    token=active.set(None)
    try:
        async with session('site-mcp://example.com') as client:
            result=await client.call_tool('open_page',{})
    finally:active.reset(token)
    assert result.isError and not json.loads(result.content[0].text)['success']
    assert browser.calls==[]


@pytest.mark.asyncio
async def test_api_reference_parameters_and_array_bodies_work_through_mcp(monkeypatch):
    from jsonschema import Draft202012Validator
    spec={'openapi':'3.1.0','components':{
        'parameters':{'Filter':{'name':'filter','in':'query','required':True,'schema':{'$ref':'#/components/schemas/Filter'}}},
        'schemas':{'Filter':{'type':'string','enum':['active']},'Item':{'type':'object','properties':{'name':{'type':'string'}},'required':['name']}},
        'requestBodies':{'Items':{'required':True,'content':{'application/json':{'schema':{'type':'array','items':{'$ref':'#/components/schemas/Item'}}}}}}},
        'paths':{'/items':{
            'get':{'operationId':'read_page','parameters':[{'$ref':'#/components/parameters/Filter'}]},
            'post':{'operationId':'saveItems','requestBody':{'$ref':'#/components/requestBodies/Items'}}}}}
    seen=[]
    def handler(request):
        if request.url.path=='/openapi.json':return httpx.Response(200,json=spec)
        if request.url.path!='/items':return httpx.Response(404)
        seen.append(request)
        return httpx.Response(200,json={'ok':True})
    monkeypatch.setattr(site_mcp,'http_client',fake_http(handler))
    tools=await discover('site-mcp://example.com')
    names=[tool['name'] for tool in tools]
    assert len(names)==len(set(names)) and 'read_page_1' in names
    by_name={tool['name']:tool for tool in tools}
    Draft202012Validator(by_name['read_page_1']['schema']).validate({'filter':'active'})
    Draft202012Validator(by_name['saveItems']['schema']).validate({'body':[{'name':'new'}]})
    async with session('site-mcp://example.com') as client:
        assert not (await client.call_tool('read_page_1',{'filter':'active'})).isError
        assert not (await client.call_tool('saveItems',{'body':[{'name':'new'}]})).isError
        assert (await client.call_tool('read_page_1',{'filter':'wrong'})).isError
        assert (await client.call_tool('saveItems',{'body':[{}]})).isError
    assert len(seen)==2
    assert str(seen[0].url)=='https://example.com/items?filter=active'
    assert json.loads(seen[1].content)==[{'name':'new'}]


def test_recursive_schema_is_bundled_and_external_references_are_skipped():
    from jsonschema import Draft202012Validator
    node={'type':'object','properties':{'child':{'$ref':'#/components/schemas/Node'}}}
    spec={'components':{'schemas':{'Node':node}},'paths':{'/tree':{'post':{
        'requestBody':{'required':True,'content':{'application/json':{'schema':{'$ref':'#/components/schemas/Node'}}}}}}}}
    op=next(site_mcp.operations(spec))
    Draft202012Validator(op['schema']).validate({'body':{'child':{'child':{}}}})
    node['properties']['child']['$ref']='https://external.example/schema'
    assert list(site_mcp.operations(spec))==[]
