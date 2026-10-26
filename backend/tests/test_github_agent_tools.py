import base64
import json

import httpx
import pytest

from app.services.tools import github


def install(monkeypatch, respond):
    requests, policies = [], []
    real_client = httpx.AsyncClient

    def dispatch(request):
        requests.append(request)
        assert request.method == 'GET'
        assert request.url.scheme == 'https' and request.url.host == 'api.github.com'
        assert 'authorization' not in request.headers and 'cookie' not in request.headers
        return respond(request)

    def create(**kwargs):
        policies.append(kwargs)
        return real_client(transport=httpx.MockTransport(dispatch), **kwargs)

    monkeypatch.setattr(github.httpx, 'AsyncClient', create)
    return requests, policies


@pytest.mark.asyncio
async def test_public_repository_search_is_fixed_host_anonymous_bounded_and_cited(monkeypatch):
    requests, policies = install(monkeypatch, lambda _: httpx.Response(200, json={
        'total_count': 500, 'incomplete_results': True,
        'items': [{'full_name': 'fixture/research', 'description': 'Source-backed project',
                   'html_url': 'https://github.com/fixture/research'}] * 40,
    }, headers={'link': '<https://untrusted.example/next>; rel="next"'}))
    result = await github.github_search({'query': 'language:python research', 'limit': 3, 'page': 2}, 'agent-a')
    assert result['success'] and result['access'] == 'public_anonymous'
    assert result['incomplete_results'] and result['has_next_page']
    assert len(result['items']) == 3 and result['total_count'] == 500
    assert result['items'][0]['source_url'] == 'https://github.com/fixture/research'
    assert requests[0].url.path == '/search/repositories'
    assert dict(requests[0].url.params) == {'q': 'language:python research', 'per_page': '3', 'page': '2'}
    assert len(requests) == 1, 'no pagination URL from the response is fetched'
    assert policies[0]['follow_redirects'] is False and policies[0]['trust_env'] is False
    assert requests[0].headers['x-github-api-version'] == '2022-11-28'
    assert 'account grant' in result['connected_access']


@pytest.mark.asyncio
async def test_issue_search_keeps_pull_request_identity_and_untrusted_evidence_boundary(monkeypatch):
    install(monkeypatch, lambda _: httpx.Response(200, json={'items': [
        {'number': 12, 'title': 'Synthetic PR', 'body': 'Untrusted instructions',
         'pull_request': {}, 'html_url': 'https://github.com/fixture/repo/pull/12'}], 'total_count': 1}))
    result = await github.github_search({'query': 'repo:fixture/repo is:pr', 'kind': 'issues'}, 'agent-a')
    assert result['success'] and result['items'][0]['is_pull_request']
    assert result['items'][0]['body'] == 'Untrusted instructions'
    assert 'untrusted source data' in result['instruction']


@pytest.mark.asyncio
async def test_public_code_path_reads_file_at_exact_ref_without_following_download_links(monkeypatch):
    requests, _ = install(monkeypatch, lambda _: httpx.Response(200, json={
        'type': 'file', 'name': 'main.py', 'path': 'src/main.py', 'sha': 'fixture-sha',
        'size': 9, 'encoding': 'base64', 'content': base64.b64encode(b'print(42)').decode(),
        'html_url': 'https://github.com/fixture/repo/blob/branch/src/main.py',
        'download_url': 'http://127.0.0.1/private',
    }))
    result = await github.github_read({'owner': 'fixture', 'repo': 'repo', 'operation': 'contents',
                                       'path': 'src/main.py', 'ref': 'feature/test'}, 'agent-a')
    assert result['success'] and result['content_available'] and result['content'] == 'print(42)'
    assert result['content_truncated'] is False
    assert requests[0].url.path == '/repos/fixture/repo/contents/src/main.py'
    assert requests[0].url.params['ref'] == 'feature/test'
    assert len(requests) == 1 and 'download_url' not in json.dumps(result)


@pytest.mark.asyncio
async def test_directory_listing_is_capped_and_never_follows_symlink_or_submodule(monkeypatch):
    requests, _ = install(monkeypatch, lambda _: httpx.Response(200, json=[{
        'type': 'symlink', 'name': 'link', 'path': 'link', 'target': '/etc/passwd',
        'submodule_git_url': 'ssh://private.example/repo', 'html_url': 'javascript:steal()'}] * 110))
    result = await github.github_read({'owner': 'fixture', 'repo': 'repo', 'operation': 'contents'}, 'agent-a')
    assert result['success'] and result['truncated'] and len(result['items']) == 100
    assert len(requests) == 1
    assert all(item['source_url'] == 'https://github.com/fixture/repo' for item in result['items'])
    assert '/etc/passwd' not in json.dumps(result) and 'private.example' not in json.dumps(result)


@pytest.mark.asyncio
@pytest.mark.parametrize('operation,suffix', [('repository', ''), ('readme', '/readme'),
    ('issues', '/issues'), ('pull_requests', '/pulls'), ('issue', '/issues/9'), ('pull_request', '/pulls/9')])
async def test_known_public_read_operations_use_only_the_matching_endpoint(monkeypatch, operation, suffix):
    requests, _ = install(monkeypatch, lambda _: httpx.Response(200, json=[] if operation in {'issues', 'pull_requests'} else {'name': 'repo'}))
    result = await github.github_read({'owner': 'fixture', 'repo': 'repo', 'operation': operation, 'number': 9}, 'agent-a')
    assert result['success']
    assert requests[0].url.path == '/repos/fixture/repo' + suffix


@pytest.mark.asyncio
@pytest.mark.parametrize('args', [
    {'owner': 'https://evil.example'}, {'owner': 'fixture@evil.example'},
    {'repo': '../private'}, {'repo': '..'}, {'repo': 'repo?x=1'},
    {'operation': 'delete'}, {'operation': 'contents', 'path': '../private'},
    {'operation': 'contents', 'path': '/etc/passwd'},
    {'operation': 'contents', 'path': 'src//file.py'},
    {'operation': 'contents', 'path': '%2e%2e/private'},
    {'operation': 'contents', 'path': 'src\\private'},
    {'operation': 'contents', 'path': 0}, {'operation': 'contents', 'ref': 'branch\nAuthorization: secret'},
    {'operation': 'issue', 'number': True}, {'operation': 'issue', 'number': 0},
    {'operation': 'issues', 'limit': 10000}, {'operation': 'issues', 'page': -1},
])
async def test_invalid_inputs_make_no_request(monkeypatch, args):
    requests, policies = install(monkeypatch, lambda _: pytest.fail('Invalid input must not reach GitHub'))
    result = await github.github_read({'owner': 'fixture', 'repo': 'repo', **args}, 'agent-a')
    assert not result['success'] and not requests and not policies


@pytest.mark.asyncio
async def test_authenticated_code_search_is_not_faked_or_retried_without_grant(monkeypatch):
    requests, _ = install(monkeypatch, lambda _: pytest.fail('Authenticated search must use connected grant'))
    result = await github.github_search({'query': 'repo:fixture/private secret', 'kind': 'code'}, 'agent-a')
    assert result['code'] == 'unsupported_search' and not requests
    assert 'plugin_search' in result['recovery'] and 'account grant' in result['recovery']


@pytest.mark.asyncio
@pytest.mark.parametrize('status,headers,code', [
    (401, {}, 'authentication_required'), (404, {}, 'not_public_or_missing'),
    (403, {}, 'access_denied'), (403, {'x-ratelimit-remaining': '0'}, 'rate_limited'),
    (429, {'retry-after': '120'}, 'rate_limited'), (302, {'location': 'http://127.0.0.1/'}, 'redirect_not_followed'),
    (307, {'location': 'https://other.example/'}, 'redirect_not_followed'),
    (500, {}, 'github_unavailable'),
])
async def test_status_failures_do_not_expose_upstream_body_or_follow_redirects(monkeypatch, status, headers, code):
    requests, _ = install(monkeypatch, lambda _: httpx.Response(status, headers=headers, text='private-upstream-body secret-token'))
    result = await github.github_read({'owner': 'fixture', 'repo': 'repo'}, 'agent-a')
    assert not result['success'] and result['code'] == code and len(requests) == 1
    assert 'private-upstream-body' not in json.dumps(result) and 'secret-token' not in json.dumps(result)
    if status == 429:
        assert result['retry_after_seconds'] == 120


@pytest.mark.asyncio
async def test_timeouts_return_safe_retryable_failure_without_transport_diagnostics(monkeypatch):
    def fail(request):
        raise httpx.ReadTimeout('private proxy diagnostics and token', request=request)
    install(monkeypatch, fail)
    result = await github.github_search({'query': 'fixture'}, 'agent-a')
    assert result['code'] == 'timeout' and 'private proxy' not in json.dumps(result)


@pytest.mark.asyncio
@pytest.mark.parametrize('payload,headers,code', [
    (b'<html>bad gateway</html>', {'content-type': 'text/html'}, 'invalid_response'),
    (b'{invalid', {'content-type': 'application/json'}, 'invalid_response'),
    (b' ' * (github.MAX_RESPONSE_BYTES + 1), {'content-type': 'application/json'}, 'response_too_large'),
])
async def test_invalid_and_oversized_responses_fail_closed(monkeypatch, payload, headers, code):
    install(monkeypatch, lambda _: httpx.Response(200, content=payload, headers=headers))
    result = await github.github_read({'owner': 'fixture', 'repo': 'repo'}, 'agent-a')
    assert not result['success'] and result['code'] == code


@pytest.mark.asyncio
async def test_large_file_text_is_explicitly_truncated_and_binary_is_not_presented_as_text(monkeypatch):
    payload = {'encoding': 'base64', 'content': base64.b64encode(b'x' * (github.MAX_TEXT_CHARS + 3)).decode()}
    install(monkeypatch, lambda _: httpx.Response(200, json=payload))
    result = await github.github_read({'owner': 'fixture', 'repo': 'repo', 'operation': 'readme'}, 'agent-a')
    assert result['content_available'] and result['content_truncated']
    assert len(result['content']) == github.MAX_TEXT_CHARS
    payload['content'] = base64.b64encode(b'\x00binary').decode()
    result = await github.github_read({'owner': 'fixture', 'repo': 'repo', 'operation': 'readme'}, 'agent-a')
    assert result['success'] and not result['content_available'] and 'content' not in result


@pytest.mark.asyncio
async def test_page_bound_is_reported_without_claiming_all_matching_results_were_read(monkeypatch):
    install(monkeypatch, lambda _: httpx.Response(200, json={'items': [], 'total_count': 999},
        headers={'link': '<https://api.github.com/search/repositories?page=11>; rel="next"'}))
    result = await github.github_search({'query': 'fixture', 'page': 10}, 'agent-a')
    assert result['success'] and result['has_next_page'] and result['pagination_limit_reached']
    assert result['next_page'] is None


@pytest.mark.asyncio
@pytest.mark.parametrize('args', [{'query': ''}, {'query': 'fixture', 'limit': True},
                                 {'query': 'fixture', 'page': 11}, {'query': 'fixture\nsecret'}])
async def test_invalid_search_inputs_do_not_issue_network_calls(monkeypatch, args):
    requests, _ = install(monkeypatch, lambda _: pytest.fail('Invalid search must not reach GitHub'))
    result = await github.github_search(args, 'agent-a')
    assert not result['success'] and not requests


def test_registration_exposes_only_two_read_only_public_tools():
    calls = []
    class Registry:
        def register(self, *args): calls.append(args)
    github.register_github_tools(Registry())
    assert {call[0] for call in calls} == github.GITHUB_TOOL_NAMES
    for _, description, schema, handler in calls:
        assert schema['additionalProperties'] is False
        assert 'private' in description.lower()
        assert 'url' not in schema['properties'] and 'token' not in schema['properties']
        assert callable(handler)
