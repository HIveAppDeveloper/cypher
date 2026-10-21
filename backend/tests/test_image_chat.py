"""Real API/database/worker and LiteLLM Responses adapter; only provider HTTP is fake."""
import asyncio
import base64
import json
import time
from contextlib import suppress
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.config import settings
from app.services import llm_gateway, model_routing
from app.services.llm_gateway import LLMGateway, completion_options
from app.services.model_routing import ModelConfigurationError, ModelCapabilityError
from app.schemas.input import content_parts, RunOptions

PNG = base64.b64encode(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=')).decode()
IMAGE = {'name': 'test.png', 'mime': 'image/png', 'data': PNG}


def catalog():
    return {f'openai/{model}': {'id': f'openai/{model}', 'type': 'language', 'modalities': {'input': ['text', 'image', 'pdf']}, 'supported_parameters': ['tools']} for model in ('gpt-6.1-sol', 'gpt-6-luna')}


@pytest_asyncio.fixture
async def provider(monkeypatch):
    from litellm.llms.custom_httpx.http_handler import AsyncHTTPHandler
    from litellm.llms.custom_httpx import llm_http_handler
    state = SimpleNamespace(requests=[], statuses=[], outputs=[], models=catalog())
    async def get_catalog():
        return state.models
    monkeypatch.setattr(model_routing, 'gateway_catalog', get_catalog)
    monkeypatch.setattr(settings, 'LLM_USE_GATEWAY', True)
    monkeypatch.setattr(settings, 'LLM_FALLBACK_MODEL', None)
    monkeypatch.setattr(settings, 'LLM_FALLBACK_PROVIDER', None)
    monkeypatch.setenv('AI_GATEWAY_API_KEY', 'test-only-not-a-credential')
    def respond(request):
        body = json.loads(request.content)
        assert request.url.path == '/v1/responses'
        state.requests.append(body)
        status = state.statuses.pop(0) if state.statuses else 200
        if status != 200:
            return httpx.Response(status, json={'error': {'message': 'Rejected test request', 'type': 'test_error'}})
        output = state.outputs.pop(0) if state.outputs else [{'id': 'msg_test', 'type': 'message', 'status': 'completed', 'role': 'assistant', 'content': [{'type': 'output_text', 'text': 'Provider test response.', 'annotations': []}]}]
        return httpx.Response(200, json={'id': 'resp_test', 'object': 'response', 'created_at': 1, 'status': 'completed', 'model': body['model'], 'output': output, 'usage': {'input_tokens': 4, 'output_tokens': 3, 'total_tokens': 7}})
    handler = AsyncHTTPHandler(transport=httpx.MockTransport(respond))
    monkeypatch.setattr(llm_http_handler, 'get_async_httpx_client', lambda **kwargs: handler)
    try:
        yield state
    finally:
        await handler.client.aclose()


def jwt(exp):
    encode = lambda obj: base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip('=')
    return encode({'alg': 'none'}) + '.' + encode({'exp': exp}) + '.test'


def test_expired_startup_oidc_uses_rotating_daemon_file(tmp_path, monkeypatch):
    import vercel.oidc.token as oidc
    oidc._clear_cached_oidc_token()
    now = time.time()
    old, first, second = jwt(now - 60), jwt(now + 120), jwt(now + 3600)
    path = tmp_path / 'rotating-token'
    path.write_text(first)
    monkeypatch.setattr(settings, 'LLM_USE_GATEWAY', True)
    monkeypatch.delenv('AI_GATEWAY_API_KEY', raising=False)
    monkeypatch.setenv('VERCEL_OIDC_TOKEN', old)
    monkeypatch.setenv('VERCEL_OIDC_TOKEN_FILE', str(path))
    try:
        # Reproduce the old bug with the real SDK, then exercise our fix.
        assert oidc.get_vercel_oidc_token_sync() == old
        assert completion_options('gpt-6.1-sol', 'openai')['api_key'] == first
        path.write_text(second)
        monkeypatch.setattr(oidc, 'time', SimpleNamespace(time=lambda: now + 80, monotonic=time.monotonic))
        assert completion_options('gpt-6.1-sol', 'openai')['api_key'] == second
    finally:
        oidc._clear_cached_oidc_token()


def test_missing_direct_provider_key_fails_before_network(monkeypatch):
    monkeypatch.setattr(settings, 'LLM_USE_GATEWAY', False)
    monkeypatch.setattr(settings, 'LLM_API_KEY', '')
    for key in ('OPENAI_API_KEY', 'HIVE_OPENAI_API_KEY', 'ATLAS_OPENAI_API_KEY'):
        monkeypatch.delenv(key, raising=False)
    with pytest.raises(ModelConfigurationError, match='needs authentication'):
        completion_options('gpt-6.1-sol', 'openai')


@pytest.mark.asyncio
@pytest.mark.parametrize('files', [[], [IMAGE]])
async def test_text_and_image_real_responses_serialization(provider, files):
    response = await LLMGateway.complete(messages=[{'role': 'user', 'content': content_parts('test can you read this', files)}], provider='openai', model='gpt-6.1-sol', options=RunOptions())
    assert response.choices[0].message.content == 'Provider test response.'
    body = provider.requests[0]
    assert body['model'] == 'openai/gpt-6.1-sol'
    assert 'test can you read this' in json.dumps(body['input'])
    if files:
        assert 'input_image' in json.dumps(body['input'])
        assert f'data:image/png;base64,{PNG}' in json.dumps(body['input'])
    assert response._hidden_params['grokbot_route']['fallback'] is False


@pytest.mark.asyncio
async def test_capability_fallback_preserves_image(provider, monkeypatch):
    provider.models['openai/gpt-6.1-sol']['modalities']['input'] = ['text']
    monkeypatch.setattr(settings, 'LLM_FALLBACK_MODEL', 'gpt-6-luna')
    result = await LLMGateway.complete(messages=[{'role': 'user', 'content': content_parts('Read image', [IMAGE])}], options=RunOptions(), model='gpt-6.1-sol', provider='openai')
    assert len(provider.requests) == 1
    assert provider.requests[0]['model'] == 'openai/gpt-6-luna'
    assert PNG in json.dumps(provider.requests[0]['input'])
    assert result._hidden_params['grokbot_route']['fallback'] is True


@pytest.mark.asyncio
async def test_text_only_backup_never_receives_image(provider, monkeypatch):
    provider.statuses = [503]
    provider.models['openai/gpt-6-luna']['modalities']['input'] = ['text']
    monkeypatch.setattr(settings, 'LLM_FALLBACK_MODEL', 'gpt-6-luna')
    with pytest.raises(Exception):
        await LLMGateway.complete(messages=[{'role': 'user', 'content': content_parts('Read image', [IMAGE])}], model='gpt-6.1-sol', provider='openai')
    assert len(provider.requests) == 1
    assert provider.requests[0]['model'] == 'openai/gpt-6.1-sol'
    assert PNG in json.dumps(provider.requests[0]['input'])


@pytest.mark.asyncio
async def test_transient_failover_uses_compatible_backup(provider, monkeypatch):
    provider.statuses = [503, 200]
    monkeypatch.setattr(settings, 'LLM_FALLBACK_MODEL', 'gpt-6-luna')
    response = await LLMGateway.complete(messages=[{'role': 'user', 'content': content_parts('Read image', [IMAGE])}], model='gpt-6.1-sol', provider='openai', options=RunOptions())
    assert [r['model'] for r in provider.requests] == ['openai/gpt-6.1-sol', 'openai/gpt-6-luna']
    assert all(PNG in json.dumps(r['input']) for r in provider.requests)
    assert response._hidden_params['grokbot_route']['fallback']


@pytest.mark.asyncio
@pytest.mark.parametrize('status', [401, 402, 403, 400])
async def test_configuration_and_auth_errors_do_not_fan_out(provider, monkeypatch, status):
    provider.statuses = [status]
    monkeypatch.setattr(settings, 'LLM_FALLBACK_MODEL', 'gpt-6-luna')
    with pytest.raises(Exception):
        await LLMGateway.complete(messages=[{'role': 'user', 'content': 'Test'}], model='gpt-6.1-sol', provider='openai')
    assert len(provider.requests) == 1


@pytest.mark.asyncio
async def test_unavailable_and_unsupported_models_never_reach_provider(provider):
    for model in ('', ' ', 'Your provider’s model ID', 'openai/gpt-6.1-sol'):
        with pytest.raises(ModelConfigurationError):
            await LLMGateway.complete(messages=[{'role': 'user', 'content': 'Test'}], model=model, provider='openai')
    provider.models.clear()
    with pytest.raises(ModelCapabilityError, match='unavailable'):
        await LLMGateway.complete(messages=[{'role': 'user', 'content': 'Test'}], model='gpt-6.1-sol', provider='openai')
    assert not provider.requests


@pytest.mark.asyncio
async def test_unsupported_audio_is_explicit(provider):
    with pytest.raises(ModelCapabilityError, match='audio'):
        await LLMGateway.complete(messages=[{'role': 'user', 'content': content_parts('Listen', [{'name': 'test.wav', 'mime': 'audio/wav', 'data': 'dGVzdA=='}])}], model='gpt-6.1-sol', provider='openai')
    assert not provider.requests


@pytest.mark.parametrize('status,phrase', [(401, 'authenticate'), (402, 'credit'), (403, 'denied'), (404, 'model ID'), (429, 'rate limited'), (503, 'temporarily unavailable'), (400, 'rejected')])
def test_public_errors_do_not_leak_provider_secrets(status, phrase):
    error = Exception('Secret credential sk-private-value https://private.example/path?key=secret')
    error.status_code = status
    text = model_routing.public_model_error(error)
    assert phrase in text
    assert 'secret' not in text.lower() and 'private.example' not in text


@pytest_asyncio.fixture
async def workspace(tmp_path, monkeypatch, provider):
    from app.db.session import Base, get_db
    from app.main import app
    from app.services import orchestrator, worker, verification
    from app.services.memory import MemoryManager
    engine = create_async_engine(f'sqlite+aiosqlite:///{tmp_path}/image-chat.db')
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async def dependency():
        async with sessions() as db:
            yield db
    async def no_redis(self):
        return None
    app.dependency_overrides[get_db] = dependency
    monkeypatch.setattr(settings, 'BACKEND_API_TOKEN', '')
    monkeypatch.setattr(worker, 'AsyncSessionLocal', sessions)
    monkeypatch.setattr(verification, 'AsyncSessionLocal', sessions)
    monkeypatch.setattr(orchestrator, 'AsyncSessionLocal', sessions)
    monkeypatch.setattr(MemoryManager, '_get_redis', no_redis)
    monkeypatch.delenv('GROKBOT_VERIFY_CLOUD', raising=False)
    runner = None
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            bot = (await client.post('/api/bots', json={'name': 'Vision test', 'role': 'Assistant', 'system_prompt': 'Read user requests.', 'llm_provider': 'openai', 'llm_model': 'gpt-6.1-sol', 'tools_enabled': []})).json()
            room = (await client.post('/api/conversations', json={'title': 'Image test', 'bot_ids': [bot['id']]})).json()
            runner = asyncio.create_task(worker.run_worker())
            yield client, room['id']
    finally:
        if runner:
            runner.cancel()
            with suppress(asyncio.CancelledError):
                await runner
        app.dependency_overrides.clear()
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize('files,status', [([], 200), ([IMAGE], 200), ([IMAGE], 401)])
async def test_persisted_chat_through_worker_and_real_adapter(workspace, provider, files, status):
    client, room = workspace
    provider.statuses = [status]
    cid = str(uuid4())
    payload = {'sender_type': 'user', 'content': 'test can you read this', 'client_message_id': cid, 'attachments': files, 'options': {'provider': 'openai', 'model': 'gpt-6.1-sol'}}
    accepted = await client.post(f'/api/conversations/{room}/messages', json=payload)
    assert accepted.status_code == 202
    assert (await client.post(f'/api/conversations/{room}/messages', json=payload)).json()['task_id'] == accepted.json()['task_id']
    if files:
        changed = {**payload, 'attachments': [{**IMAGE, 'data': base64.b64encode(b'different image').decode()}]}
        assert (await client.post(f'/api/conversations/{room}/messages', json=changed)).status_code == 409
    for _ in range(150):
        jobs = (await client.get(f'/api/conversations/{room}/tasks')).json()
        if jobs[0]['status'] in ('completed', 'failed'):
            break
        await asyncio.sleep(.03)
    assert jobs[0]['status'] == ('completed' if status == 200 else 'failed')
    messages = (await client.get(f'/api/conversations/{room}/messages')).json()
    incoming = next(m for m in messages if m['id'] == cid)
    if files:
        saved = incoming['metadata_json']['attachments'][0]
        assert 'data' not in saved
        assert (await client.get(saved['url'])).content == base64.b64decode(PNG)
        assert PNG in json.dumps(provider.requests[0]['input'])
    result = next(m for m in messages if m['id'] != cid)
    if status == 401:
        assert result['message_type'] == 'status_update'
        assert 'authenticate' in result['content'] and 'Error reference:' in result['content']
    else:
        assert result['content'] == 'Provider test response.'
    assert len(provider.requests) == 1


@pytest.mark.asyncio
async def test_blank_configuration_and_media_attachment_rejected(workspace):
    client, room = workspace
    for model in ('', '   '):
        response = await client.post(f'/api/conversations/{room}/messages', json={'sender_type': 'user', 'content': 'Test', 'options': {'model': model}})
        assert response.status_code == 422
    response = await client.post(f'/api/conversations/{room}/messages', json={'sender_type': 'user', 'content': 'Test', 'attachments': [IMAGE], 'options': {'output': 'image'}})
    assert response.status_code == 422 and 'Automatic' in response.json()['detail']
    for value in ('', '   ', None, 10):
        bot = await client.post('/api/bots', json={'role': 'Assistant', 'system_prompt': 'Help', 'llm_provider': 'openai', 'llm_model': value})
        assert bot.status_code == 422


@pytest.mark.asyncio
async def test_tool_free_image_probe_omits_tool_definitions(workspace, provider):
    client, room = workspace
    response = await client.post(f'/api/conversations/{room}/messages', json={'sender_type': 'user', 'content': 'Read this image', 'attachments': [IMAGE], 'options': {'allow_tools': False, 'max_iterations': 1, 'max_tokens': 512, 'reasoning_effort': 'low'}})
    assert response.status_code == 202
    for _ in range(150):
        jobs = (await client.get(f'/api/conversations/{room}/tasks')).json()
        if jobs[0]['status'] in ('completed', 'failed'):
            break
        await asyncio.sleep(.03)
    assert jobs[0]['status'] == 'completed'
    assert len(provider.requests) == 1
    assert not provider.requests[0].get('tools')
    assert PNG in json.dumps(provider.requests[0]['input'])


@pytest.mark.asyncio
async def test_disabled_tools_cannot_execute_even_if_model_returns_call(workspace, monkeypatch):
    from unittest.mock import AsyncMock
    from app.services.tools.registry import ToolRegistry
    client, room = workspace
    async def forged_reply(**kwargs):
        assert kwargs['tools'] is None
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=None, tool_calls=[SimpleNamespace(function=SimpleNamespace(name='generate_image', arguments='{}'))]))])
    execution = AsyncMock()
    monkeypatch.setattr(LLMGateway, 'complete', forged_reply)
    monkeypatch.setattr(ToolRegistry, 'execute_tool', execution)
    accepted = await client.post(f'/api/conversations/{room}/messages', json={'sender_type': 'user', 'content': 'Read only test', 'options': {'allow_tools': False, 'max_iterations': 1}})
    assert accepted.status_code == 202
    for _ in range(150):
        jobs = (await client.get(f'/api/conversations/{room}/tasks')).json()
        if jobs[0]['status'] in ('completed', 'failed'):
            break
        await asyncio.sleep(.03)
    assert jobs[0]['status'] == 'failed'
    execution.assert_not_awaited()
    messages = (await client.get(f'/api/conversations/{room}/messages')).json()
    assert any('No tools were run' in item['content'] for item in messages)

@pytest.mark.asyncio
async def test_persisted_worker_search_tool_round_trip(workspace, provider, monkeypatch):
    from app.services.tools import web_search
    from tests.test_web_research import payload as search_payload
    client, room = workspace
    bots = (await client.get('/api/bots')).json()
    assert (await client.put('/api/bots/' + bots[0]['id'], json={'tools_enabled': ['browser']})).status_code == 200
    provider.outputs = [[{'id': 'fc_search', 'type': 'function_call', 'call_id': 'call_search', 'name': 'search_web', 'arguments': json.dumps({'query': 'A public profile'}), 'status': 'completed'}]]
    real_client = httpx.AsyncClient
    monkeypatch.setattr(web_search.httpx, 'AsyncClient', lambda **kwargs: real_client(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=search_payload())), **kwargs))
    accepted = await client.post(f'/api/conversations/{room}/messages', json={'sender_type': 'user', 'content': 'Research a public profile', 'options': {'max_iterations': 3}})
    assert accepted.status_code == 202
    for _ in range(150):
        jobs = (await client.get(f'/api/conversations/{room}/tasks')).json()
        if jobs[0]['status'] in ('completed', 'failed'): break
        await asyncio.sleep(.03)
    assert jobs[0]['status'] == 'completed'
    saved = (await client.get(f'/api/conversations/{room}/messages')).json()
    evidence = next(m for m in saved if m['message_type'] == 'tool_result')
    assert json.loads(evidence['content'])['sources'][0]['url'] == 'https://example.org/profile'
    assert len(provider.requests) == 2
    assert 'https://example.org/profile' in json.dumps(provider.requests[1]['input'])
    assert any(m['content'] == 'Provider test response.' for m in saved)
