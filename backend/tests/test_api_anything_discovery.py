import asyncio
from copy import deepcopy

import httpx
import pytest

from app.services import api_anything, mcp_registry


def match():
    return {'name': 'example-com', 'domain': 'example.com', 'displayName': 'Example',
            'description': 'Public tools', 'operations': [],
            'interfaces': [{'kind': 'mcp', 'url': 'https://mcp.example.com/mcp', 'confirmations': 3}]}


@pytest.fixture(autouse=True)
def empty_cache():
    api_anything._cache.clear()
    yield
    api_anything._cache.clear()


def client(monkeypatch, handler):
    monkeypatch.setattr(api_anything, 'http_client', lambda **kwargs: httpx.AsyncClient(
        transport=httpx.MockTransport(handler), follow_redirects=False))


@pytest.mark.asyncio
async def test_real_search_wire_contract_maps_only_mcp_without_calling_found_endpoints(monkeypatch):
    requests = []
    site = match()
    site['operations'] = [{'name': 'read', 'status': 'live'}]
    site['interfaces'] += [deepcopy(site['interfaces'][0]), {'kind': 'openapi', 'url': 'https://example.com/api.json', 'confirmations': 5}]

    def handler(request):
        requests.append(request)
        assert request.method == 'GET' and str(request.url).startswith(api_anything.SEARCH_URL)
        assert dict(request.url.params) == {'q': 'Example', 'limit': '20'}
        assert 'authorization' not in request.headers and 'cookie' not in request.headers
        return httpx.Response(200, json={'matches': [site]})
    client(monkeypatch, handler)

    async def forbidden(*args, **kwargs):
        pytest.fail('Official registry should not delay an API Anything MCP result')
    monkeypatch.setattr(mcp_registry, '_search_official_registry', forbidden)
    result = await mcp_registry.search_registry('Example')
    assert len(requests) == 1 and result['next_cursor'] is None
    assert len(result['items']) == 1
    item = result['items'][0]
    assert item['url'] == 'https://mcp.example.com/mcp' and item['discovery_source'] == 'api_anything'
    assert item['transport'] == 'unknown' and 'connected' not in item and 'authenticated' not in item


@pytest.mark.parametrize('url', [
    'http://mcp.example.com/mcp', 'https://127.0.0.1/mcp', 'https://127.1/mcp',
    'https://[::1]/mcp', 'https://localhost/mcp', 'https://example.local/mcp',
    'https://mcp.example.com/mcp?token=secret', 'https://user:secret@mcp.example.com/mcp',
    'https://@mcp.example.com/mcp', 'https://mcp.example.com:8443/mcp',
    'https://mcp.example.com/mcp#secret', 'https://example.com.evil.net/mcp',
    'https://mcp.example.com/{account}/mcp', 'https://mcp.example.com\\@evil.net/mcp',
])
def test_untrusted_catalog_cannot_offer_private_cross_domain_or_credential_urls(url):
    site = match()
    interface = {**site['interfaces'][0], 'url': url}
    assert api_anything.interface_to_catalog(site, interface) is None


@pytest.mark.parametrize('change', [{'kind': 'openapi'}, {'confirmations': 0}, {'confirmations': True}, {'confirmations': '3'}])
def test_openapi_and_unconfirmed_interfaces_are_not_mcp_connections(change):
    site = match()
    assert api_anything.interface_to_catalog(site, {**site['interfaces'][0], **change}) is None


@pytest.mark.asyncio
@pytest.mark.parametrize('scenario', ['empty', 'operations', 'invalid', 'http_error', 'redirect', 'oversized', 'timeout'])
async def test_catalog_failures_or_non_mcp_results_keep_official_fallback(monkeypatch, scenario):
    seen = []
    async def handler(request):
        if scenario == 'timeout':
            raise httpx.ReadTimeout('synthetic', request=request)
        if scenario == 'oversized':
            return httpx.Response(200, content=b'x' * (api_anything.MAX_BYTES + 1))
        if scenario == 'http_error':
            return httpx.Response(503)
        if scenario == 'redirect':
            return httpx.Response(302, headers={'location': 'https://private.example/secret'})
        return httpx.Response(200, json={'matches': []} if scenario == 'empty' else
                              {'matches': [{'name': 'example-com', 'operations': [{'name': 'read'}]}]} if scenario == 'operations' else {'other': []})
    client(monkeypatch, handler)
    async def official(query, cursor=None):
        seen.append((query, cursor))
        return {'items': [{'id': 'official'}], 'next_cursor': 'opaque:next'}
    monkeypatch.setattr(mcp_registry, '_search_official_registry', official)
    assert await mcp_registry.search_registry('Example') == {'items': [{'id': 'official'}], 'next_cursor': 'opaque:next'}
    assert seen == [('Example', None)]


@pytest.mark.asyncio
async def test_cache_is_bounded_expires_and_returns_detached_results(monkeypatch):
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={'matches': [match()]})
    client(monkeypatch, handler)
    clock = [100]
    monkeypatch.setattr(api_anything.time, 'monotonic', lambda: clock[0])
    a = await api_anything.search_interfaces('Example')
    a[0]['domains'].append('tampered.invalid')
    b = await api_anything.search_interfaces('Example')
    assert len(calls) == 1 and 'tampered.invalid' not in b[0]['domains']
    clock[0] += 61
    await api_anything.search_interfaces('Example')
    assert len(calls) == 2
    for n in range(130):
        await api_anything.search_interfaces(f'Example {n}')
    assert len(api_anything._cache) == 128


@pytest.mark.asyncio
@pytest.mark.parametrize('hint', [
    'https://example.com/oauth?code=private#token',
    'example.com/oauth?code=private#token',
    '//example.com/oauth?code=private#token',
    'https://user:private@example.com/oauth',
])
async def test_discovery_url_does_not_forward_login_codes_to_either_catalog(monkeypatch, hint):
    seen = []
    def handler(request):
        seen.append(request.url.params['q'])
        return httpx.Response(200, json={'matches': []})
    client(monkeypatch, handler)
    async def official(query, cursor=None):
        seen.append(query)
        return {'items': [], 'next_cursor': None}
    monkeypatch.setattr(mcp_registry, '_search_official_registry', official)
    await mcp_registry.search_registry(hint)
    assert seen == ['example.com', 'example.com']
    assert list(api_anything._cache) == ['example.com']


@pytest.mark.asyncio
@pytest.mark.parametrize('cursor', [None, 'unchanged:opaque/cursor'])
async def test_outer_budget_cancels_slow_fallback_without_detached_network_work(monkeypatch, cursor):
    async def empty(query):
        return []
    cancelled = asyncio.Event()
    async def slow(query, cursor=None):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
    monkeypatch.setattr(api_anything, 'search_interfaces', empty)
    monkeypatch.setattr(mcp_registry, '_search_official_registry', slow)
    monkeypatch.setattr(mcp_registry, '_search_packaged_registry', lambda query: {'items': [], 'next_cursor': None})
    real_timeout = asyncio.timeout
    monkeypatch.setattr(mcp_registry.asyncio, 'timeout', lambda seconds: real_timeout(.02))
    with pytest.raises(TimeoutError):
        await mcp_registry.search_registry('Example', cursor)
    assert cancelled.is_set()


@pytest.mark.parametrize('query', ['//localhost/oauth?code=private', '/oauth?code=private', 'http://[bad]', '127.1/oauth?code=private'])
def test_ambiguous_or_nonpublic_url_hints_are_rejected_before_discovery(query):
    with pytest.raises(ValueError):
        api_anything.discovery_hint(query)


def test_ordinary_search_words_remain_unchanged():
    assert api_anything.discovery_hint('project management tools') == 'project management tools'


@pytest.mark.asyncio
async def test_unavailable_live_catalog_uses_saved_directory_without_claiming_verified_access(monkeypatch):
    from app.services import mcp_directory
    monkeypatch.setattr(mcp_directory, 'read_snapshot', lambda: {'fetched_at': '2026-10-24T00:00:00Z', 'entries': [
        {'id': 'saved', 'registry_name': 'example/linear', 'title': 'Linear', 'version': '1',
         'url': 'https://mcp.example.com/mcp', 'test_status': 'protocol_verified', 'tool_count': 10},
        {'id': 'other', 'registry_name': 'other', 'title': 'Other'},
    ]})
    async def empty(query):
        return []
    async def unavailable(query, cursor=None):
        raise httpx.ReadTimeout('synthetic')
    monkeypatch.setattr(api_anything, 'search_interfaces', empty)
    monkeypatch.setattr(mcp_registry, '_search_official_registry', unavailable)
    result = await mcp_registry.search_registry('linear')
    assert len(result['items']) == 1 and result['next_cursor'] is None
    item = result['items'][0]
    assert item['discovery_source'] == 'packaged_registry' and item['snapshot_at'] == '2026-10-24T00:00:00Z'
    assert item['url'] == 'https://mcp.example.com/mcp' and 'Saved directory listing' in item['description']
    assert 'test_status' not in item and 'tool_count' not in item and 'authenticated' not in item
    with pytest.raises(httpx.ReadTimeout):
        await mcp_registry.search_registry('linear', 'opaque:page2')


def test_packaged_fallback_has_real_github_entries_and_no_saved_connection_state():
    result = mcp_registry._search_packaged_registry('github')
    assert 0 < len(result['items']) <= 50
    assert all(item['discovery_source'] == 'packaged_registry' and 'authenticated' not in item for item in result['items'])
