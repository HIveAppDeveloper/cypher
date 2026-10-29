"""Offline contract tests. No real provider tokens or requests are used."""
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from app.config import settings
from app.services import muse, omniroute, usage
from app.services.llm_gateway import LLMGateway
from app.services.model_routing import ModelConfigurationError, ModelCapabilityError

KEY = 'synthetic-meta-token-1234567890'
MESSAGES = [{'role':'system','content':'Use tools carefully.'}, {'role':'user','content':'Find my meeting.'}]
TOOLS = [{'type':'function','function':{'name':'find_meeting','description':'Find a meeting','parameters':{'type':'object','properties':{}}}}]


def body(**updates):
    return {'id':'muse-test','object':'chat.completion','model':muse.MODEL,
            'choices':[{'index':0,'message':{'role':'assistant','content':'Connection verified.'},'finish_reason':'stop'}],
            'usage':{'prompt_tokens':19,'completion_tokens':7,'total_tokens':26}, **updates}


def transport(monkeypatch, respond):
    real = httpx.AsyncClient
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kw: real(transport=httpx.MockTransport(respond), **kw))


@pytest.mark.asyncio
async def test_official_endpoint_replays_visible_history_and_function_tools(monkeypatch):
    calls=[]
    history = MESSAGES + [{'role':'assistant','content':None,'reasoning_content':'private SDK field',
        'tool_calls':[{'id':'call-1','type':'function','function':{'name':'find_meeting','arguments':'{}'},'index':0}], 'provider_specific_fields':{'discard':'SDK only'}},
        {'role':'tool','tool_call_id':'call-1','name':'find_meeting','content':'Meeting at noon.'}]
    def respond(request):
        calls.append(request)
        assert str(request.url) == muse.ENDPOINT
        assert request.headers['authorization'] == 'Bearer '+KEY
        sent=json.loads(request.content)
        assert sent['model']==muse.MODEL and sent['max_completion_tokens']==256 and sent['reasoning_effort']=='minimal'
        assert sent['tools']==TOOLS
        assert sent['messages'][:2]==MESSAGES
        assert sent['messages'][2]=={'role':'assistant','content':None,'tool_calls':[{'id':'call-1','type':'function','function':{'name':'find_meeting','arguments':'{}'}}]}
        assert sent['messages'][3]=={'role':'tool','content':'Meeting at noon.','tool_call_id':'call-1'}
        assert 'api_base' not in sent and 'stream_options' not in sent
        return httpx.Response(200,json=body())
    transport(monkeypatch, respond)
    reply=await muse.complete(history,TOOLS,muse.MODEL,{'max_tokens':256,'reasoning_effort':'none','api_base':'https://never.example'},KEY)
    assert reply.model==muse.MODEL and reply.choices[0].message.content=='Connection verified.'
    assert reply.usage.prompt_tokens==19 and reply.usage.completion_tokens==7
    assert len(calls)==1


@pytest.mark.asyncio
@pytest.mark.parametrize('status',[301,302,401,402,403,429,500])
async def test_redirects_and_provider_errors_never_leak_or_retry(monkeypatch,status):
    calls=[]
    def respond(request):
        calls.append(request)
        return httpx.Response(status,json={'error':{'message':'sensitive '+KEY}},headers={'location':'https://evil.example/collect'})
    transport(monkeypatch,respond)
    with pytest.raises(muse.MuseError) as caught:
        await muse.complete(MESSAGES,None,muse.MODEL,{},KEY)
    assert caught.value.status_code==status and KEY not in str(caught.value) and len(calls)==1


@pytest.mark.asyncio
@pytest.mark.parametrize('result',[body(model='llama'),body(choices=[]),body(choices=[{}]),body(choices=[{'message':{'role':'assistant','content':''},'finish_reason':'stop'}]), {'error':'secret'}])
async def test_wrong_model_empty_and_malformed_results_fail_closed(monkeypatch,result):
    transport(monkeypatch,lambda _:httpx.Response(200,json=result))
    with pytest.raises(muse.MuseError,match='502'):
        await muse.complete(MESSAGES,None,muse.MODEL,{},KEY)


@pytest.mark.asyncio
async def test_network_timeout_is_sanitized(monkeypatch):
    def respond(request): raise httpx.ReadTimeout(KEY,request=request)
    transport(monkeypatch,respond)
    with pytest.raises(muse.MuseError,match='504') as caught:
        await muse.complete(MESSAGES,None,muse.MODEL,{},KEY)
    assert KEY not in str(caught.value)


@pytest.mark.asyncio
@pytest.mark.parametrize('part',[{'type':'image_url','image_url':{'url':'private'}},{'type':'file','file':{}},{'type':'input_audio','input_audio':{}},{'type':'video_url','video_url':'private'},{'type':'unknown','data':'private'}])
async def test_unsupported_input_is_preserved_and_rejected_before_network(monkeypatch,part):
    client=AsyncMock(side_effect=AssertionError('No network expected'))
    monkeypatch.setattr(httpx,'AsyncClient',client)
    messages=[{'role':'user','content':[{'type':'text','text':'Read this'},part]}]
    with pytest.raises(ModelCapabilityError,match='files are preserved'):
        await muse.complete(messages,None,muse.MODEL,{},KEY)
    assert messages[0]['content'][1] is part
    client.assert_not_called()


class Events(httpx.AsyncByteStream):
    def __init__(self, events): self.events=events; self.closed=False
    async def __aiter__(self):
        for event in self.events: yield ('data: '+json.dumps(event)+'\n\n').encode()
    async def aclose(self): self.closed=True


@pytest.mark.asyncio
async def test_stream_closes_on_consumer_cancellation_and_truncation_fails(monkeypatch):
    first=body(object='chat.completion.chunk',choices=[{'index':0,'delta':{'role':'assistant','content':'Hello'},'finish_reason':None}])
    events=Events([first])
    transport(monkeypatch,lambda _:httpx.Response(200,stream=events))
    stream=muse.stream(MESSAGES,None,muse.MODEL,{},KEY)
    chunk=await anext(stream)
    assert chunk.choices[0].delta.content=='Hello'
    await stream.aclose()
    assert events.closed
    events=Events([first])
    with pytest.raises(muse.MuseError,match='502'):
        _=[chunk async for chunk in muse.stream(MESSAGES,None,muse.MODEL,{},KEY)]
    assert events.closed


@pytest.mark.asyncio
async def test_gateway_uses_only_verified_meta_token_and_records_usage(monkeypatch):
    from app.services.plugins import seal
    monkeypatch.setattr(settings,'SECRET_KEY','synthetic-encryption-secret-at-least-32-characters')
    monkeypatch.setattr(settings,'OMNIROUTE_URL','https://router.example')
    monkeypatch.setattr(omniroute,'refresh_model_routes',AsyncMock())
    monkeypatch.setattr(omniroute,'_managed_records',[SimpleNamespace(name='model_connection:muse',status='completed',detail={'state':'ready','credentials_encrypted':seal(KEY)})])
    lower=AsyncMock(side_effect=AssertionError('Muse must not reach OmniRoute'))
    monkeypatch.setattr(omniroute,'complete',lower)
    recorded=AsyncMock();monkeypatch.setattr(usage,'record',recorded)
    allowance=AsyncMock();monkeypatch.setattr(usage,'check_allowance',allowance)
    transport(monkeypatch,lambda _:httpx.Response(200,json=body()))
    response=await LLMGateway.complete(MESSAGES,TOOLS,model=muse.MODEL,provider='muse',max_tokens=256,allow_fallback=False)
    assert response._hidden_params['grokbot_route']=={'provider':'muse','model':muse.MODEL,'fallback':False,'transport':'provider_api'}
    lower.assert_not_called();allowance.assert_awaited_once()
    args=recorded.await_args
    assert args.args[:2]==('muse',muse.MODEL) and args.args[2].total_tokens==26 and args.kwargs=={'direct':True}


@pytest.mark.asyncio
async def test_unverified_muse_never_uses_ambient_keys_or_a_fallback(monkeypatch):
    monkeypatch.setattr(omniroute,'refresh_model_routes',AsyncMock())
    monkeypatch.setattr(omniroute,'_managed_records',[])
    monkeypatch.setattr(settings,'LLM_API_KEY',KEY)
    monkeypatch.setenv('MUSE_API_KEY',KEY)
    client=AsyncMock(side_effect=AssertionError('No network expected'));monkeypatch.setattr(httpx,'AsyncClient',client)
    with pytest.raises(ModelConfigurationError,match='Connect Meta Muse'):
        await LLMGateway.complete(MESSAGES,model=muse.MODEL,provider='muse',fallback=('openai','gpt-6.1-sol'))
    client.assert_not_called()


@pytest.mark.asyncio
async def test_gateway_stream_records_final_usage_and_always_closes(monkeypatch):
    monkeypatch.setattr(omniroute,'refresh_model_routes',AsyncMock())
    monkeypatch.setattr(muse,'verified_token',lambda _:KEY)
    recorded=AsyncMock();monkeypatch.setattr(usage,'record',recorded)
    finished=body(object='chat.completion.chunk',choices=[{'index':0,'delta':{'content':'Done'},'finish_reason':'stop'}])
    events=Events([finished]);transport(monkeypatch,lambda _:httpx.Response(200,stream=events))
    result=[chunk async for chunk in LLMGateway.stream(MESSAGES,model=muse.MODEL,provider='muse',max_tokens=256)]
    assert result[0].choices[0].delta.content=='Done' and events.closed
    assert recorded.await_args.args[2].total_tokens==26 and recorded.await_args.kwargs=={'direct':True}
