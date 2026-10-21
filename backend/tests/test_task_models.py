"""Task routing, provider input preservation and recoverable database startup."""
import asyncio
from types import SimpleNamespace
import httpx
import pytest
from app.services.model_profiles import PROFILES, task_specialty, gateway_id
from app.schemas.input import RunOptions


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
    catalog={gateway_id(p.provider,p.model):{'type':'language','modalities':{'input':['text','image','pdf']},'supported_parameters':['tools','reasoning'],'reasoning_options':[{'type':'effort','values':['low','high']}]} for p in PROFILES.values()}
    async def models():return catalog
    monkeypatch.setattr(model_routing,'gateway_catalog',models)
    monkeypatch.setattr(settings,'LLM_USE_GATEWAY',True)
    monkeypatch.setattr(settings,'LLM_FALLBACK_MODEL',None)
    monkeypatch.setenv('AI_GATEWAY_API_KEY','test-credential')
    seen=[]
    async def complete(**kw):
        seen.append(kw)
        return ModelResponse(choices=[{'message':{'role':'assistant','content':'verified'}}])
    monkeypatch.setattr(llm_gateway.litellm,'acompletion',complete)
    tools=[{'type':'function','function':{'name':'read_source','parameters':{'type':'object','properties':{}}}}]
    image={'type':'image_url','image_url':{'url':'data:image/png;base64,abc'}}
    for p in set(PROFILES.values()):
        r=await llm_gateway.LLMGateway.complete(messages=[{'role':'user','content':[image]}],tools=tools,model=p.model,provider=p.provider,options=RunOptions(reasoning_effort='medium'))
        assert seen[-1]['messages'][0]['content']==[image]
        assert seen[-1]['tools']==tools
        assert 'temperature' not in seen[-1]
        assert seen[-1]['model'].endswith(gateway_id(p.provider,p.model))
        assert r._hidden_params['grokbot_route']['model']==p.model


@pytest.mark.asyncio
async def test_provider_capacity_fallback_is_observable_and_preserves_request(monkeypatch):
    from app.services import llm_gateway, model_routing
    from app.config import settings
    from litellm import ModelResponse
    monkeypatch.setattr(settings,'LLM_USE_GATEWAY',True)
    monkeypatch.setattr(settings,'LLM_FALLBACK_MODEL',None)
    monkeypatch.setenv('AI_GATEWAY_API_KEY','test-credential')
    async def check(*args):pass
    async def models():return {gateway_id(p.provider,p.model):{'supported_parameters':['tools'],'reasoning_options':[]} for p in PROFILES.values()}
    monkeypatch.setattr(llm_gateway,'validate_capabilities',check)
    monkeypatch.setattr(model_routing,'gateway_catalog',models)
    calls=[]
    class Busy(Exception):status_code=503
    async def complete(**kw):
        calls.append(kw)
        if len(calls)==1:raise Busy()
        return ModelResponse(choices=[{'message':{'role':'assistant','content':'ready'}}])
    monkeypatch.setattr(llm_gateway.litellm,'acompletion',complete)
    messages=[{'role':'user','content':'Find reliable sources'}]
    r=await llm_gateway.LLMGateway.complete(messages=messages,provider='gemini',model='gemini-3.8-flash',fallback=('openai','gpt-6.1-sol'),options=RunOptions())
    assert len(calls)==2 and all(c['messages']==messages for c in calls)
    assert r._hidden_params['grokbot_route']=={'provider':'openai','model':'gpt-6.1-sol','fallback':True}


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
