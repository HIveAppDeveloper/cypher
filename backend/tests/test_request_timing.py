from types import SimpleNamespace

import httpx
import pytest
from fastapi.responses import Response, StreamingResponse

from app.services import request_timing as timing


@pytest.mark.asyncio
@pytest.mark.parametrize('elapsed,expected', [
    (0, '0.000'), (.0125, '12.500'), (300, '300000.000'),
    (300.001, None), (-1, None), (float('nan'), None), (float('inf'), None),
])
async def test_numeric_bounded_header_has_no_request_content(monkeypatch, elapsed, expected):
    ticks = iter([0, elapsed])
    monkeypatch.setattr(timing, 'perf_counter', lambda: next(ticks))
    original = Response('PRIVATE BODY', status_code=429, headers={timing.HEADER: 'spoofed', 'Retry-After': '12'})
    async def next_response(request):
        return original
    response = await timing.app_header_timing(SimpleNamespace(headers={'private': 'PRIVATE REQUEST'}), next_response)
    assert response is original and response.status_code == 429
    assert response.headers.get(timing.HEADER) == expected
    assert response.body == b'PRIVATE BODY' and response.headers['Retry-After'] == '12'
    assert 'PRIVATE' not in str(response.headers)


@pytest.mark.asyncio
async def test_timer_does_not_consume_or_wait_for_stream_body(monkeypatch):
    ticks = iter([100, 100.010])
    monkeypatch.setattr(timing, 'perf_counter', lambda: next(ticks))
    consumed = []
    async def body():
        consumed.append(True)
        yield b'private stream'
    original = StreamingResponse(body())
    async def next_response(request): return original
    response = await timing.app_header_timing(None, next_response)
    assert consumed == [] and response.headers[timing.HEADER] == '10.000'
    assert b''.join([chunk async for chunk in response.body_iterator]) == b'private stream'


@pytest.mark.asyncio
async def test_real_auth_errors_and_cors_keep_order_and_get_header(monkeypatch):
    from app.main import app
    from app.config import settings
    monkeypatch.setattr(settings, 'BACKEND_API_TOKEN', 'test-only-token-at-least-32-characters')
    monkeypatch.setattr(settings, 'REQUIRE_USER_AUTH', True)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        response = await client.get('/api/bots', headers={timing.HEADER: 'PRIVATE-SPOOF'})
        assert response.status_code == 401 and response.json() == {'detail': 'Unauthorized'}
        assert 0 <= float(response.headers[timing.HEADER]) <= 300000
        preflight = await client.options('/api/bots', headers={
            'Origin': 'http://localhost:3000', 'Access-Control-Request-Method': 'GET'})
        assert preflight.status_code == 200
        assert preflight.headers['access-control-allow-origin'] == 'http://localhost:3000'
        assert 0 <= float(preflight.headers[timing.HEADER]) <= 300000
