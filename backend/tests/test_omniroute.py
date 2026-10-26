"""Exercise the real router adapter with only upstream HTTP replaced."""
import base64
import json
from io import BytesIO

import httpx
import pytest
from PIL import Image

from app.config import settings
from app.schemas.input import RunOptions
from app.services import omniroute, llm_gateway
from app.services.model_routing import ModelConfigurationError, ModelCapabilityError


@pytest.fixture
def router(monkeypatch):
    async def refresh(): pass
    monkeypatch.setattr(omniroute, 'refresh_model_routes', refresh)
    monkeypatch.setattr(omniroute, '_managed_records', [])
    monkeypatch.setattr(settings, 'OMNIROUTE_URL', 'https://router.example')
    monkeypatch.setattr(settings, 'OMNIROUTE_API_KEY', 'private-inference-key')
    monkeypatch.setattr(settings, 'OMNIROUTE_PROTECTION_BYPASS', 'private-access-key')
    monkeypatch.setattr(settings, 'NICRRON_API_KEY', '')
    monkeypatch.setattr(settings, 'LLM_FALLBACK_MODEL', None)
    monkeypatch.setattr(settings, 'OMNIROUTE_MODEL_MAP', {
        'openai/gpt-6.1-sol':'cx/gpt-6.1-sol',
        'openai/gpt-6-luna':'cx/gpt-6-luna-low',
    })
    monkeypatch.setattr(omniroute, '_cache_key', None)
    seen = []
    real_client = httpx.AsyncClient
    def install(handler, extra_models=()):
        def respond(request):
            assert request.url.host == 'router.example'
            assert request.headers['authorization'] == 'Bearer private-inference-key'
            assert request.headers['x-vercel-protection-bypass'] == 'private-access-key'
            seen.append(request)
            if request.url.path == '/v1/models':
                return httpx.Response(200, json={'data':[
                    {'id':model, 'input_modalities':['text','image'], 'capabilities':{'tool_calling':True,'reasoning':True,'effort_tiers':['low','high']},'pricing':{'input':2,'output':10}}
                    for model in settings.OMNIROUTE_MODEL_MAP.values()
                ] + list(extra_models)})
            return handler(request)
        monkeypatch.setattr(omniroute.httpx, 'AsyncClient', lambda **kw: real_client(transport=httpx.MockTransport(respond), **kw))
    return seen, install


@pytest.mark.asyncio
async def test_dynamic_nicrron_models_are_selectable_and_use_omniroute(router, monkeypatch):
    seen, install = router
    from app.services import nicrron
    model = 'anthropic/claude-sonnet-5-5'
    public_id = 'nicrron/' + model
    monkeypatch.setattr(settings, 'NICRRON_API_KEY', 'nicrron-test-key-never-live')

    async def catalog():
        return {'provider':'nicrron','configured':True,'status':'ready','models':[{'id':model,'name':'Claude Sonnet 5.5'}]}

    async def require_chat_model(value):
        assert value == model
        return {'id':value}

    monkeypatch.setattr(nicrron, 'model_catalog', catalog)
    monkeypatch.setattr(nicrron, 'require_chat_model', require_chat_model)

    def respond(request):
        body = json.loads(request.content)
        assert body['model'] == public_id
        return httpx.Response(200, json={'choices':[{'message':{'role':'assistant','content':'Nicrron route works'}}]})

    install(respond, extra_models=[{
        'id':public_id,
        'input_modalities':['text'],
        'capabilities':{'tool_calling':True},
        'pricing':{'input':3,'output':15},
    }])

    catalog_result = await omniroute.catalog()
    assert catalog_result[public_id]['transport_model'] == public_id
    response = await llm_gateway.LLMGateway.complete(
        [{'role':'user','content':'Say hello'}],
        provider='nicrron', model=model, allow_fallback=False,
    )
    assert response.choices[0].message.content == 'Nicrron route works'
    assert seen[-1].url.path == '/v1/chat/completions'
    assert json.loads(seen[-1].content)['model'] == public_id


@pytest.mark.asyncio
async def test_omniroute_catalog_does_not_enroll_configured_nicrron_key(router, monkeypatch):
    seen, install = router
    from app.services import nicrron

    monkeypatch.setattr(settings, 'NICRRON_API_KEY', 'nicrron-test-key-never-live')
    monkeypatch.setattr(nicrron, '_route_model_ids', set())
    monkeypatch.setattr(nicrron, '_route_checked_at', 0.0)
    monkeypatch.setattr(nicrron, '_catalog', {})
    monkeypatch.setattr(nicrron, '_catalog_at', 0.0)

    install(lambda request: httpx.Response(200, json={'choices': []}))
    await omniroute.catalog()

    assert [request.method for request in seen] == ['GET', 'GET']
    assert [request.url.path for request in seen] == ['/v1/models', '/v1/models']


@pytest.mark.asyncio
async def test_tools_receipts_images_and_specialist_fallback_use_only_router(router, monkeypatch):
    seen, install = router
    def forbidden(**kwargs):
        raise AssertionError('Router must not call LiteLLM or Vercel inference')
    monkeypatch.setattr(llm_gateway.litellm, 'acompletion', forbidden)
    def respond(request):
        body = json.loads(request.content)
        assert body['model'] == 'cx/gpt-6.1-sol'
        return httpx.Response(200, json={'choices':[{'message':{'role':'assistant','content':'43.18'}}]})
    install(respond)
    messages = [
        {'role':'user','content':[{'type':'image_url','image_url':{'url':'data:image/png;base64,original'}}]},
        {'role':'assistant','content':None,'tool_calls':[{'id':'receipt-1','type':'function','function':{'name':'read_record','arguments':'{}'}}]},
        {'role':'tool','tool_call_id':'receipt-1','content':'{"total":"43.18"}'},
    ]
    tools = [{'type':'function','function':{'name':'read_record','parameters':{'type':'object','properties':{}}}}]
    response = await llm_gateway.LLMGateway.complete(messages, tools, provider='gemini', model='gemini-3.8-flash', fallback=('openai','gpt-6.1-sol'), options=RunOptions(reasoning_effort='medium'))
    body = json.loads(seen[-1].content)
    assert body['messages'] == messages and body['tools'] == tools
    assert body['reasoning_effort'] == 'low' and 'temperature' not in body
    assert response.choices[0].message.content == '43.18'
    assert response._hidden_params['grokbot_route'] == {'provider':'openai','model':'gpt-6.1-sol','fallback':True,'transport':'omniroute','transport_model':'cx/gpt-6.1-sol'}
    assert (await omniroute.catalog())['openai/gpt-6.1-sol']['pricing']['input'] == 0.000002


@pytest.mark.asyncio
async def test_unsupported_input_is_preserved_and_never_sent(router):
    seen, install = router
    install(lambda request: pytest.fail('Unsupported file reached inference'))
    messages = [{'role':'user','content':[{'type':'file','file':{'file_data':'original-pdf'}}]}]
    with pytest.raises(ModelCapabilityError, match='files were kept'):
        await llm_gateway.LLMGateway.complete(messages, provider='openai', model='gpt-6.1-sol')
    assert len(seen) == 1 and seen[0].url.path == '/v1/models'
    assert messages[0]['content'][0]['file']['file_data'] == 'original-pdf'


@pytest.mark.asyncio
async def test_text_only_model_cannot_silently_drop_past_tool_receipts(router,monkeypatch):
    seen,install=router
    from app.services import model_routing
    async def catalog():
        return {'openai/gpt-6.1-sol':{'type':'language','modalities':{'input':['text']},'supported_parameters':[]}}
    monkeypatch.setattr(model_routing,'route_catalog',catalog)
    install(lambda request: pytest.fail('Tool receipt reached a text-only provider'))
    messages=[{'role':'assistant','content':None,'tool_calls':[{'id':'read-1','type':'function','function':{'name':'get_record','arguments':'{}'}}]}, {'role':'tool','tool_call_id':'read-1','content':'original receipt'}]
    with pytest.raises(ModelCapabilityError,match='tool calls'):
        await llm_gateway.LLMGateway.complete(messages,provider='openai',model='gpt-6.1-sol',allow_fallback=False)
    assert not seen and messages[1]['content']=='original receipt'


@pytest.mark.asyncio
async def test_new_free_thinking_route_uses_saved_omniroute_transport_without_fallback(router,monkeypatch):
    seen,install=router
    monkeypatch.setattr(settings,'OMNIROUTE_MODEL_MAP',{'deepseek/deepseek-v4-pro-think':'ds-web/deepseek-v4-pro-think'})
    monkeypatch.setattr(settings,'OMNIROUTE_CONTROL_KEY','')
    messages=[{'role':'system','content':'Return the completed answer.'},{'role':'user','content':'How much is 17 plus 25?'}]
    def respond(request):
        body=json.loads(request.content)
        assert body['model']=='ds-web/deepseek-v4-pro-think' and body['messages']==messages
        return httpx.Response(200,json={'model':'deepseek-v4-pro-think','choices':[{'message':{'role':'assistant','content':'42'}}]})
    install(respond)
    response=await llm_gateway.LLMGateway.complete(messages,provider='deepseek',model='deepseek-v4-pro-think',allow_fallback=False)
    assert response.choices[0].message.content=='42'
    assert response._hidden_params['grokbot_route']['fallback'] is False
    assert response._hidden_params['grokbot_route']['transport_model']=='ds-web/deepseek-v4-pro-think'
    assert len([r for r in seen if r.method=='POST'])==1


@pytest.mark.asyncio
@pytest.mark.parametrize('status', [302,401,403,413,429])
async def test_redirects_and_provider_errors_do_not_leak_keys_or_retry_elsewhere(router, status):
    seen, install = router
    install(lambda request: httpx.Response(status, headers={'location':'https://untrusted.example/'}, text='private-inference-key private-access-key private account details'))
    with pytest.raises(omniroute.OmniRouteError) as failure:
        await omniroute.request('/responses', {'model':'cx/gpt-6.1-sol'})
    assert len(seen) == 1 and failure.value.status_code == status
    assert 'private' not in str(failure.value)


@pytest.mark.asyncio
async def test_transport_timeout_uses_bounded_connected_fallback(router):
    seen, install = router
    def respond(request):
        if json.loads(request.content)['model'] == 'cx/gpt-6.1-sol':
            raise httpx.ReadTimeout('private upstream diagnostics',request=request)
        return httpx.Response(200,json={'choices':[{'message':{'role':'assistant','content':'Recovered'}}]})
    install(respond)
    result = await llm_gateway.LLMGateway.complete([{'role':'user','content':'Hello'}],provider='openai',model='gpt-6.1-sol',fallback=('openai','gpt-6-luna'))
    assert result.choices[0].message.content == 'Recovered'
    assert result._hidden_params['grokbot_route']['fallback']
    assert len([r for r in seen if r.method=='POST']) == 2


@pytest.mark.asyncio
async def test_server_voice_marker_is_transport_only_and_model_tools_manual_options_are_unchanged(router):
    from app.services.voice_metrics import voice_continuation
    seen,install=router
    messages=[{'role':'user','content':'Use the connected tool.'}]
    tools=[{'type':'function','function':{'name':'list_context','parameters':{'type':'object','properties':{}}}}]
    body={'model':'cx/gpt-6.1-sol','messages':messages,'tools':tools,'max_tokens':731,'reasoning_effort':'high'}
    def respond(request):
        assert request.headers['x-omniroute-work-class']=='voice'
        assert json.loads(request.content)==body
        return httpx.Response(200,json={'choices':[{'message':{'role':'assistant','content':'Verified tool result.'}}]})
    install(respond)
    with voice_continuation(True):
        await omniroute.complete(messages,tools,'openai','gpt-6.1-sol',{'max_tokens':731,'reasoning_effort':'high'})
        await omniroute.catalog()
        assert all('x-omniroute-work-class' not in request.headers for request in seen if request.url.path=='/v1/models')
    assert 'x-omniroute-work-class' not in omniroute.headers('/chat/completions')


@pytest.mark.asyncio
async def test_gateway_job_header_is_recorded_without_transcript_or_untrusted_header_content(router):
    from uuid import uuid4
    from app.services import voice_metrics
    _,install=router;job_id=str(uuid4())
    install(lambda request:httpx.Response(200,json={'text':'private transcript'},headers={'x-omniroute-job-id':job_id}))
    class Runner:
        @voice_metrics.audio_task
        async def run(self,attachments=None):
            return await omniroute.request('/audio/transcriptions',{'model':'omniroute/whisper-base-local','file':{'data':'private audio'}})
        async def _persist_voice_metrics(self,metrics):self.jobs=voice_metrics.gateway_jobs()
    runner=Runner();await runner.run(attachments=[{'mime':'audio/webm'}])
    assert runner.jobs==[{'job_id':job_id,'stage':'speech'}]


@pytest.mark.asyncio
async def test_streaming_voice_continuation_preserves_generation_and_correlates_opaque_job(router):
    from uuid import uuid4
    from app.services import voice_metrics
    _,install=router;job_id=str(uuid4())
    messages=[{'role':'user','content':'Keep the same chosen model and effort.'}]
    def respond(request):
        assert request.headers['x-omniroute-work-class']=='voice'
        assert json.loads(request.content)=={'model':'cx/gpt-6.1-sol','messages':messages,'stream':True,
            'stream_options':{'include_usage':True},'max_tokens':731,'reasoning_effort':'high'}
        chunk={'id':'stream-fixture','object':'chat.completion.chunk','created':1,'model':'cx/gpt-6.1-sol',
            'choices':[{'index':0,'delta':{'content':'Verified.'},'finish_reason':None}]}
        return httpx.Response(200,text='data: '+json.dumps(chunk)+'\n\ndata: [DONE]\n\n',
            headers={'content-type':'text/event-stream','x-omniroute-job-id':job_id})
    install(respond)
    class Runner:
        @voice_metrics.audio_task
        async def run(self,attachments=None):
            with voice_metrics.voice_continuation(True):
                return [chunk async for chunk in omniroute.stream(messages,None,'openai','gpt-6.1-sol',{'max_tokens':731,'reasoning_effort':'high'})]
        async def _persist_voice_metrics(self,metrics):self.jobs=voice_metrics.gateway_jobs()
    runner=Runner();chunks=await runner.run(attachments=[{'mime':'audio/webm'}])
    assert chunks[0].choices[0].delta.content=='Verified.'
    assert runner.jobs==[{'job_id':job_id,'stage':'model'}]
    assert not voice_metrics.is_voice_continuation()


@pytest.mark.parametrize('url', ['http://public.example', 'https://user:pass@router.example', 'https://router.example/?key=secret', 'https://router.example/unexpected'])
def test_invalid_router_destination_is_rejected_before_credentials_attach(router, monkeypatch, url):
    monkeypatch.setattr(settings, 'OMNIROUTE_URL', url)
    with pytest.raises(ModelConfigurationError): omniroute.headers()


@pytest.mark.asyncio
async def test_stream_is_real_deltas_and_forwards_generation_controls(router):
    seen, install = router
    def respond(request):
        body = json.loads(request.content)
        assert body['stream'] and body['max_tokens'] == 37
        chunks = [
            {'id':'a','choices':[{'index':0,'delta':{'role':'assistant','content':'Hello'},'finish_reason':None}]},
            {'id':'a','choices':[{'index':0,'delta':{'tool_calls':[{'index':0,'id':'call1','type':'function','function':{'name':'read_record','arguments':'{}'}}]},'finish_reason':'tool_calls'}]},
        ]
        return httpx.Response(200, text=''.join('data: '+json.dumps(chunk)+'\n\n' for chunk in chunks)+'data: [DONE]\n\n', headers={'content-type':'text/event-stream'})
    install(respond)
    chunks = [chunk async for chunk in llm_gateway.LLMGateway.stream([{'role':'user','content':'Hi'}],provider='openai',model='gpt-6.1-sol',max_tokens=37)]
    assert chunks[0].choices[0].delta.content == 'Hello'
    assert chunks[1].choices[0].delta.tool_calls[0].id == 'call1'


@pytest.mark.asyncio
async def test_gemini_complete_uses_signed_stream_path_and_collects_tool_calls(router,monkeypatch):
    seen,install=router
    monkeypatch.setattr(settings,'OMNIROUTE_MODEL_MAP',{'google/gemini-3.8-flash':'gemini/gemini-3.8-flash'})
    def respond(request):
        body=json.loads(request.content)
        assert body['stream'] and body['stream_options']['include_usage'] and body['max_tokens']==1000
        chunks=[
          {'id':'gemini-call','object':'chat.completion.chunk','created':1,'model':'gemini-3.8-flash','choices':[{'index':0,'delta':{'role':'assistant','tool_calls':[{'index':0,'id':'signed-call','type':'function','function':{'name':'multiply','arguments':'{"a":13'}}]},'finish_reason':None}]},
          {'id':'gemini-call','object':'chat.completion.chunk','created':1,'model':'gemini-3.8-flash','choices':[{'index':0,'delta':{'tool_calls':[{'index':0,'function':{'arguments':',"b":17}'}}]},'finish_reason':'tool_calls'}]},
          {'id':'gemini-call','object':'chat.completion.chunk','created':1,'model':'gemini-3.8-flash','choices':[],'usage':{'prompt_tokens':10,'completion_tokens':7,'total_tokens':17}},
        ]
        return httpx.Response(200,text=''.join('data: '+json.dumps(x)+'\n\n' for x in chunks)+'data: [DONE]\n\n',headers={'content-type':'text/event-stream'})
    install(respond)
    result=await omniroute.complete([{'role':'user','content':'Multiply'}],None,'gemini','gemini-3.8-flash',{'max_tokens':1000})
    call=result.choices[0].message.tool_calls[0]
    assert call.id=='signed-call' and json.loads(call.function.arguments)=={'a':13,'b':17}
    assert result.usage.total_tokens==17


@pytest.mark.asyncio
async def test_image_generation_returns_verified_bytes_and_other_media_never_uses_gateway(router):
    from app.services.media import generate_media
    from app.services.attachments import transcribe_audio
    seen, install = router
    buffer = BytesIO()
    Image.new('RGB', (2,2), 'red').save(buffer, format='PNG')
    encoded = base64.b64encode(buffer.getvalue()).decode()
    install(lambda request: httpx.Response(200,json={'output':[{'type':'image_generation_call','result':encoded}]}))
    files = await generate_media('image','A red square',image_provider='openai')
    assert files[0]['mime'] == 'image/png' and files[0]['data'] == encoded
    assert json.loads(seen[-1].content)['tool_choice'] == {'type':'image_generation'}
    with pytest.raises(ValueError, match='Video generation is not available'):
        await generate_media('video','A square')
    with pytest.raises(ModelCapabilityError, match='original audio is saved'):
        await transcribe_audio({'data':'original-audio'})
    assert len(seen) == 1


@pytest.mark.asyncio
async def test_native_web_search_retains_real_search_receipts(router):
    from app.services.tools.web_search import search_web
    seen, install = router
    install(lambda request: httpx.Response(200,json={'output':[
        {'type':'web_search_call','status':'completed','action':{'sources':[{'url':'https://docs.python.org/3/'}]}},
        {'type':'message','content':[{'type':'output_text','text':'Python documentation','annotations':[{'type':'url_citation','url':'https://docs.python.org/3/','title':'Python'}]}]},
    ]}))
    result = await search_web({'query':'Python official docs'},'test-bot')
    assert result['success'] and result['sources'][0]['url'] == 'https://docs.python.org/3/'
    assert json.loads(seen[0].content)['model'] == 'cx/gpt-6-luna-low'
    assert 'max_tool_calls' not in json.loads(seen[0].content)
