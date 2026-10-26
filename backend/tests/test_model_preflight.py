"""Reuse one verified model entry per route without caching across requests."""
import json

import httpx
import pytest

from app.schemas.input import RunOptions
from app.services import llm_gateway, model_routing, omniroute
from app.services.model_routing import ModelCapabilityError
from .test_omniroute import router


@pytest.mark.asyncio
async def test_real_gateway_removes_redundant_sql_route_refresh(router, monkeypatch):
    seen, install = router
    refreshes = []
    async def refresh():
        refreshes.append(True)
    monkeypatch.setattr(omniroute, 'refresh_model_routes', refresh)
    install(lambda request: httpx.Response(200, json={'choices': [{'message': {'role': 'assistant', 'content': '42'}}]}))
    for _ in range(2):
        result = await llm_gateway.LLMGateway.complete([{'role': 'user', 'content': 'Compute 17+25.'}],
            model='gpt-6.1-sol', provider='openai', options=RunOptions(), allow_fallback=False)
        assert result.choices[0].message.content == '42'
    # Each call retains its initial credential refresh and fresh capability
    # catalog refresh. Generation options do not repeat that SQL route lookup.
    assert len(refreshes) == 4
    assert len([r for r in seen if r.url.path == '/v1/models']) == 1
    assert len([r for r in seen if r.url.path == '/v1/chat/completions']) == 2


@pytest.mark.asyncio
async def test_fallback_gets_its_own_validated_metadata_and_preserves_inputs(router, monkeypatch):
    seen, install = router
    lookups = []
    async def catalog():
        lookups.append(True)
        return {f'openai/{name}': {'type': 'language', 'modalities': {'input': ['text', 'image']},
            'supported_parameters': ['tools'], 'reasoning_options': [{'type': 'effort', 'values': [effort]}]}
            for name, effort in [('gpt-6.1-sol', 'high'), ('gpt-6-luna', 'low')]}
    monkeypatch.setattr(model_routing, 'route_catalog', catalog)
    def respond(request):
        body = json.loads(request.content)
        if body['model'] == 'cx/gpt-6.1-sol':
            assert body['reasoning_effort'] == 'high'
            return httpx.Response(503, json={'error': 'busy'})
        assert body['model'] == 'cx/gpt-6-luna-low' and body['reasoning_effort'] == 'low'
        return httpx.Response(200, json={'choices': [{'message': {'role': 'assistant', 'content': 'Ready'}}]})
    install(respond)
    messages = [{'role': 'user', 'content': [{'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,abc'}}]}]
    tools = [{'type': 'function', 'function': {'name': 'read_data', 'parameters': {'type': 'object'}}}]
    result = await llm_gateway.LLMGateway.complete(messages, tools,
        model='gpt-6.1-sol', provider='openai', fallback=('openai', 'gpt-6-luna'), options=RunOptions(reasoning_effort='high'))
    assert len(lookups) == 2
    assert result._hidden_params['grokbot_route']['fallback'] is True
    assert all(json.loads(request.content)['messages'] == messages and json.loads(request.content)['tools'] == tools for request in seen)


@pytest.mark.asyncio
async def test_later_request_revalidates_and_blocks_revoked_capability(router, monkeypatch):
    seen, install = router
    lookups = []
    async def catalog():
        lookups.append(True)
        return {'openai/gpt-6.1-sol': {'type': 'language',
            'modalities': {'input': ['text', 'image'] if len(lookups) == 1 else ['text']},
            'supported_parameters': ['tools']}}
    monkeypatch.setattr(model_routing, 'route_catalog', catalog)
    install(lambda request: httpx.Response(200, json={'choices': [{'message': {'role': 'assistant', 'content': 'Read'}}]}))
    messages = [{'role': 'user', 'content': [{'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,abc'}}]}]
    await llm_gateway.LLMGateway.complete(messages, model='gpt-6.1-sol', provider='openai', allow_fallback=False)
    with pytest.raises(ModelCapabilityError, match='cannot read'):
        await llm_gateway.LLMGateway.complete(messages, model='gpt-6.1-sol', provider='openai', allow_fallback=False)
    assert len(lookups) == 2 and len(seen) == 1
