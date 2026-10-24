"""Keep the newly deployed account status path intact; never contact Resend."""
from types import SimpleNamespace
import httpx
import pytest
from app.config import settings
from app.main import app
from app.services import resend


@pytest.mark.asyncio
@pytest.mark.parametrize('upstream_status,verified', [(200, True), (401, False), (403, False), (404, False), (500, False)])
async def test_accounts_status_preserves_receiving_probe(monkeypatch, upstream_status, verified):
    key = 'test-only-resend-key'
    calls = []
    def respond(request):
        calls.append(request)
        assert request.url.path == '/emails/receiving'
        assert request.url.params['limit'] == '1'
        assert request.headers['authorization'] == 'Bearer ' + key
        return httpx.Response(upstream_status, json={'data': [{'id': 'private-mail-reference', 'text': 'private mailbox content'}]})
    def receiving_client(**kwargs):
        return httpx.AsyncClient(transport=httpx.MockTransport(respond), **kwargs)
    monkeypatch.setenv('GROKBOT_RESEND_API_KEY', key)
    monkeypatch.setattr(resend, 'httpx', SimpleNamespace(AsyncClient=receiving_client, HTTPError=httpx.HTTPError))
    monkeypatch.setattr(settings, 'BACKEND_API_TOKEN', 'test-backend-token')
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        assert (await client.get('/api/accounts/status')).status_code == 401
        response = await client.get('/api/accounts/status', headers={'Authorization': 'Bearer test-backend-token'})
    assert response.status_code == 200
    assert response.json()['resend']['configured'] is True
    assert response.json()['resend']['verified'] is verified
    assert len(calls) == 1
    assert not any(value in response.text for value in (key, 'private-mail-reference', 'private mailbox content', 'test-backend-token'))


@pytest.mark.asyncio
async def test_accounts_missing_resend_key_makes_no_external_call(monkeypatch):
    def forbidden_client(**kwargs):
        raise AssertionError('Unconfigured status must not contact a provider')
    monkeypatch.delenv('GROKBOT_RESEND_API_KEY', raising=False)
    monkeypatch.setattr(resend, 'httpx', SimpleNamespace(AsyncClient=forbidden_client, HTTPError=httpx.HTTPError))
    monkeypatch.setattr(settings, 'BACKEND_API_TOKEN', '')
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        response = await client.get('/api/accounts/status')
    assert response.status_code == 200
    assert response.json()['resend']['configured'] is False


@pytest.mark.asyncio
async def test_accounts_receiving_network_failure_stays_sanitized(monkeypatch):
    def respond(request):
        raise httpx.ConnectError('private endpoint and credential must not escape', request=request)
    def receiving_client(**kwargs):
        return httpx.AsyncClient(transport=httpx.MockTransport(respond), **kwargs)
    monkeypatch.setenv('GROKBOT_RESEND_API_KEY', 'test-only-resend-key')
    monkeypatch.setattr(resend, 'httpx', SimpleNamespace(AsyncClient=receiving_client, HTTPError=httpx.HTTPError))
    monkeypatch.setattr(settings, 'BACKEND_API_TOKEN', '')
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        response = await client.get('/api/accounts/status')
    assert response.status_code == 200
    assert response.json()['resend']['verified'] is False
    assert 'private endpoint' not in response.text and 'test-only-resend-key' not in response.text
