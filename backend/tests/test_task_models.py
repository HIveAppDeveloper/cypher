"""Task routing, provider input preservation and recoverable database startup."""
import asyncio
from types import SimpleNamespace
import httpx
import pytest
from app.services.model_profiles import PROFILES, task_specialty, model_route_id
from app.schemas.input import RunOptions

@pytest.fixture(autouse=True)
def isolated_model_connections(monkeypatch):
    from app.services import omniroute
    async def refresh(): pass
    monkeypatch.setattr(omniroute,'refresh_model_routes',refresh)
    monkeypatch.setattr(omniroute,'_managed_records',[])


def test_routes_current_task_and_trusted_role():
    for prompt, expected in [('Fix this Python bug','coding'),('Research current sources','research'),('Draft a short story','writing'),('Calculate this equation','analysis'),('Plan the architecture','planning'),('Review this answer','review'),('Hello','general')]:
        assert task_specialty(prompt)==expected
    assert task_specialty('Continue','Researcher')=='research'
    assert task_specialty('Describe these files',modalities={'image'})=='vision'
    assert task_specialty('Summarize',modalities={'pdf'})=='vision'


@pytest.mark.asyncio
async def test_every_task_model_preserves_tools_and_uses_correct_provider(monkeypatch):
    from app.services import llm_gateway, model_routing
    from app.config import settings
    from litellm import ModelResponse
    catalog={model_route_id(p.provider,p.model):{'type':'language','modalities':{'input':['text','image','pdf']},'supported_parameters':['tools','reasoning'],'reasoning_options':[{'type':'effort','values':['low','high']}]} for p in PROFILES.values()}
    route_map={key:'native/'+key for key in catalog}
    monkeypatch.setattr(settings,'OMNIROUTE_URL','https://router.example')
    monkeypatch.setattr(settings,'OMNIROUTE_API_KEY','test-route-key')
    monkeypatch.setattr(settings,'OMNIROUTE_MODEL_MAP',route_map)
    async def live_catalog():return catalog
    monkeypatch.setattr(model_routing,'route_catalog',live_catalog)
    monkeypatch.setattr(settings,'LLM_FALLBACK_MODEL',None)
    seen=[]
    async def complete(messages, tools, provider, model, generation):
        seen.append({'messages':messages,'tools':tools,'provider':provider,'model':model,**generation})
        return ModelResponse(choices=[{'message':{'role':'assistant','content':'verified'}}])
    from app.services import omniroute
    monkeypatch.setattr(omniroute,'complete',complete)
    tools=[{'type':'function','function':{'name':'read_source','parameters':{'type':'object','properties':{}}}}]
    image={'type':'image_url','image_url':{'url':'data:image/png;base64,abc'}}
    for p in set(PROFILES.values()):
        r=await llm_gateway.LLMGateway.complete(messages=[{'role':'user','content':[image]}],tools=tools,model=p.model,provider=p.provider,options=RunOptions(reasoning_effort='medium'))
        assert seen[-1]['messages'][0]['content']==[image]
        assert seen[-1]['tools']==tools
        assert 'temperature' not in seen[-1]
        assert seen[-1]['provider']==p.provider and seen[-1]['model']==p.model
        assert r._hidden_params['grokbot_route']['model']==p.model


@pytest.mark.asyncio
async def test_provider_capacity_fallback_is_observable_and_preserves_request(monkeypatch):
    from app.services import llm_gateway, model_routing
    from app.config import settings
    from litellm import ModelResponse
    monkeypatch.setattr(settings,'OMNIROUTE_URL','https://router.example')
    monkeypatch.setattr(settings,'OMNIROUTE_API_KEY','test-route-key')
    route_map={'google/gemini-3.8-flash':'google/gemini-3.8-flash','openai/gpt-6.1-sol':'openai/gpt-6.1-sol'}
    monkeypatch.setattr(settings,'OMNIROUTE_MODEL_MAP',route_map)
    monkeypatch.setattr(settings,'LLM_FALLBACK_MODEL',None)
    async def check(*args):pass
    catalog={key:{'supported_parameters':['tools'],'reasoning_options':[]} for key in route_map}
    monkeypatch.setattr(llm_gateway,'validate_capabilities',check)
    async def live_catalog():return catalog
    monkeypatch.setattr(model_routing,'route_catalog',live_catalog)
    calls=[]
    class Busy(Exception):status_code=503
    from app.services import omniroute
    async def complete(messages, tools, provider, model, generation):
        calls.append({'messages':messages,'provider':provider,'model':model,**generation})
        if len(calls)==1:raise Busy()
        return ModelResponse(choices=[{'message':{'role':'assistant','content':'ready'}}])
    monkeypatch.setattr(omniroute,'complete',complete)
    messages=[{'role':'user','content':'Find reliable sources'}]
    r=await llm_gateway.LLMGateway.complete(messages=messages,provider='gemini',model='gemini-3.8-flash',fallback=('openai','gpt-6.1-sol'),options=RunOptions())
    assert len(calls)==2 and all(c['messages']==messages for c in calls)
    route = r._hidden_params['grokbot_route']
    assert route['provider'] == 'openai' and route['model'] == 'gpt-6.1-sol' and route['fallback'] is True
    assert route['transport'] == 'omniroute' and route['transport_model'] == 'openai/gpt-6.1-sol'


@pytest.mark.asyncio
async def test_database_quota_does_not_crash_api_startup_or_leak_credentials(monkeypatch):
    from app.main import app
    from app.config import settings
    from app.db import bootstrap
    monkeypatch.setattr(settings,'RUN_EMBEDDED_WORKER',False)
    monkeypatch.setattr(settings,'SANDBOX_BACKEND','vercel')
    monkeypatch.setattr(settings,'REDIS_URL',None)
    monkeypatch.setattr(settings,'BACKEND_API_TOKEN','')
    monkeypatch.setattr(settings,'REQUIRE_USER_AUTH',False)
    async def unavailable(*args):raise RuntimeError('Your account or project has exceeded the quota. PRIVATE-TOKEN')
    monkeypatch.setattr(bootstrap,'initialize_database',unavailable)
    try:
        async with app.router.lifespan_context(app):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
                r=await client.get('/api/bots')
                assert r.status_code==503 and r.json()['code']=='database_quota'
                assert r.headers['retry-after']=='300' and 'PRIVATE-TOKEN' not in r.text
                assert (await client.get('/health')).status_code==200
    finally:
        for key in ('database_ready','database_failure'):
            if hasattr(app.state,key):delattr(app.state,key)


@pytest.mark.asyncio
async def test_wait_for_work_is_interruptible_and_does_not_leak_tasks():
    from app.db.wakeup import wait_for_work
    stop,wake=asyncio.Event(),asyncio.Event()
    waiter=asyncio.create_task(wait_for_work(wake,stop,30))
    wake.set()
    assert await asyncio.wait_for(waiter,1) is True
    assert not wake.is_set()
    waiter=asyncio.create_task(wait_for_work(wake,stop,30));stop.set()
    assert await asyncio.wait_for(waiter,1) is False

@pytest.mark.asyncio
async def test_free_claude_tool_task_uses_codex_and_never_adds_paid_backups(monkeypatch):
    from app.services import llm_gateway, model_routing, omniroute
    from app.config import settings
    from litellm import ModelResponse
    monkeypatch.setattr(settings,'OMNIROUTE_URL','https://router.example')
    monkeypatch.setattr(settings,'OMNIROUTE_API_KEY','test-route-key')
    monkeypatch.setattr(settings,'MODEL_ROUTING_POLICY','codex_and_free')
    monkeypatch.setattr(settings,'OMNIROUTE_CONTROL_KEY','')
    monkeypatch.setattr(settings,'OMNIROUTE_MODEL_MAP',{'openai/gpt-6.1-sol':'cx/gpt-6.1-sol'})
    monkeypatch.setattr(settings,'LLM_FALLBACK_MODEL',None)
    catalog={
        'anthropic/claude-haiku-4.5':{'type':'language','modalities':{'input':['text']},'supported_parameters':[]},
        'openai/gpt-6.1-sol':{'type':'language','modalities':{'input':['text','image']},'supported_parameters':['tools']},
    }
    async def live_catalog():return catalog
    monkeypatch.setattr(model_routing,'route_catalog',live_catalog)
    calls=[]
    async def complete(messages, tools, provider, model, generation):
        calls.append((messages,tools,provider,model))
        return ModelResponse(choices=[{'message':{'role':'assistant','content':'42'}}])
    monkeypatch.setattr(omniroute,'complete',complete)
    messages=[{'role':'user','content':'Read the connected account and tell me the total.'}]
    tools=[{'type':'function','function':{'name':'get_connectors','parameters':{'type':'object'}}}]
    result=await llm_gateway.LLMGateway.complete(messages,tools,provider='anthropic',model='claude-haiku-4.5',fallback=('openai','gpt-6.1-sol'))
    assert calls==[(messages,tools,'openai','gpt-6.1-sol')]
    assert result._hidden_params['grokbot_route']['fallback'] is True
    calls.clear()
    monkeypatch.setattr(settings,'LLM_FALLBACK_MODEL','grok-4.7')
    monkeypatch.setattr(settings,'LLM_FALLBACK_PROVIDER','xai')
    async def unavailable(messages,tools,provider,model,generation):
        calls.append((provider,model));raise omniroute.OmniRouteError(503)
    monkeypatch.setattr(omniroute,'complete',unavailable)
    with pytest.raises(omniroute.OmniRouteError):
        await llm_gateway.LLMGateway.complete(messages,provider='anthropic',model='claude-haiku-4.5',fallback=('openai','gpt-6.1-sol'))
    assert calls==[('anthropic','claude-haiku-4.5'),('openai','gpt-6.1-sol')]
