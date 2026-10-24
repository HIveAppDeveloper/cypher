#!/usr/bin/env python3
"""Build a 10,000-entry MCP Registry snapshot and run a read-only MCP handshake.

This probes only each unique published Streamable HTTP endpoint once. It never
calls tools. HTTP redirects and non-public DNS addresses are rejected.
"""

import argparse
import asyncio
import gzip
import hashlib
import ipaddress
import json
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

REGISTRY = 'https://registry.modelcontextprotocol.io/v0.1/servers'
PROTOCOL_VERSION = '2025-11-25'
DEFAULT_OUTPUT = Path(__file__).parents[1] / 'app' / 'data' / 'mcp_directory.json.gz'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


OPENER = urllib.request.build_opener(NoRedirect())


def safe_https(value):
    if not isinstance(value, str) or not value.startswith('https://'):
        return ''
    try:
        parsed = urlsplit(value)
        if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.port not in (None, 443):
            return ''
    except ValueError:
        return ''
    return value


def fetch_registry(limit, checkpoint_path):
    entries = []
    cursor = None
    seen = set()
    if checkpoint_path.exists():
        checkpoint = json.loads(checkpoint_path.read_text())
        entries = checkpoint.get('entries') or []
        cursor = checkpoint.get('cursor')
        for item in entries:
            row = entry_to_row(item)
            if row:
                seen.add(row['id'])
    while len(entries) < limit:
        params = {'version': 'latest', 'limit': 100}
        if cursor:
            params['cursor'] = cursor
        url = REGISTRY + '?' + urllib.parse.urlencode(params)
        request = urllib.request.Request(url, headers={'User-Agent': 'CypherMcpDirectory/1.0 (read-only catalog sync)'})
        last_error = None
        for attempt in range(4):
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    payload = json.load(response)
                last_error = None
                break
            except (OSError, urllib.error.URLError) as error:
                last_error = error
                time.sleep(min(8, 2 ** attempt))
        if last_error is not None:
            raise last_error
        page = payload.get('servers') if isinstance(payload, dict) else None
        if not isinstance(page, list):
            raise ValueError('The Official MCP Registry returned an invalid server page.')
        for entry in page:
            server = entry.get('server') if isinstance(entry, dict) and isinstance(entry.get('server'), dict) else entry
            if not isinstance(server, dict):
                continue
            row = entry_to_row(entry)
            if not row or row['id'] in seen:
                continue
            seen.add(row['id'])
            entries.append(entry)
            if len(entries) >= limit:
                break
        metadata = payload.get('metadata') if isinstance(payload.get('metadata'), dict) else {}
        cursor = metadata.get('nextCursor')
        checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
        checkpoint_temp = checkpoint_path.with_suffix(checkpoint_path.suffix + '.tmp')
        checkpoint_temp.write_text(json.dumps({'cursor': cursor, 'entries': entries}, ensure_ascii=False))
        checkpoint_temp.replace(checkpoint_path)
        if len(entries) % 1000 == 0:
            print('downloaded %d Registry entries' % len(entries), flush=True)
        if not cursor or not page:
            break
    if len(entries) >= limit and checkpoint_path.exists():
        checkpoint_path.unlink()
    return entries[:limit]


def category_for(name, description):
    text = (str(name) + ' ' + str(description)).casefold()
    groups = (
        ('Development', ('code', 'developer', 'github', 'gitlab', 'repository', 'deploy', 'database', 'api', 'cloud', 'devops', 'terminal', 'ide')),
        ('Productivity', ('calendar', 'email', 'mail', 'task', 'project', 'document', 'drive', 'notion', 'slack', 'meeting', 'office')),
        ('Data and research', ('search', 'research', 'analytics', 'data', 'knowledge', 'wiki', 'web', 'browser', 'scrape', 'crawl')),
        ('Business', ('crm', 'sales', 'lead', 'customer', 'support', 'commerce', 'shop', 'marketing', 'advertising', 'ads')),
        ('Finance', ('finance', 'bank', 'accounting', 'invoice', 'payment', 'crypto', 'stock', 'trading', 'market', 'billing')),
        ('Design and media', ('image', 'video', 'audio', 'music', 'design', 'figma', 'photo', 'speech', 'voice', 'media')),
        ('Security', ('security', 'auth', 'identity', 'credential', 'secret', 'vulnerability', 'compliance', 'audit')),
        ('Travel and location', ('map', 'location', 'travel', 'flight', 'hotel', 'weather', 'geo', 'address')),
    )
    for label, terms in groups:
        if any(term in text for term in terms):
            return label
    return 'Other'


def entry_to_row(entry):
    server = entry.get('server') if isinstance(entry.get('server'), dict) else entry
    if not isinstance(server, dict):
        return None
    metadata = entry.get('_meta') if isinstance(entry.get('_meta'), dict) else {}
    registry_status = metadata.get('io.modelcontextprotocol.registry/official', {})
    if isinstance(registry_status, dict) and registry_status.get('status') in {'deleted', 'deprecated'}:
        return None
    remotes = server.get('remotes') if isinstance(server.get('remotes'), list) else []
    remote = next((item for item in remotes if isinstance(item, dict) and item.get('type') == 'streamable-http' and safe_https(item.get('url'))), None)
    endpoint = safe_https(remote.get('url')) if remote else ''
    packages = server.get('packages') if isinstance(server.get('packages'), list) else []
    transports = {item.get('type') for item in remotes if isinstance(item, dict)}
    if endpoint:
        transport, setup_note, test_status, test_message = 'streamable-http', '', 'not_tested', ''
    elif 'sse' in transports:
        transport, setup_note, test_status = 'sse', 'This listing uses SSE. Cypher connects to Streamable HTTP endpoints; ask the publisher for its Streamable HTTP URL.', 'transport_unsupported'
        test_message = 'This transport cannot be probed by the current connection client.'
    elif packages:
        transport, setup_note, test_status = 'local', 'This listing requires a local package. The publisher needs to host an HTTPS Streamable HTTP endpoint for one-tap connection.', 'local_setup'
        test_message = 'A local package has no hosted endpoint to test.'
    else:
        transport, setup_note, test_status = 'unknown', 'No hosted Streamable HTTP endpoint is published yet.', 'no_endpoint'
        test_message = 'The Registry entry does not publish a hosted endpoint.'
    name = str(server.get('name') or server.get('title') or 'mcp-server')[:400]
    title = str(server.get('title') or server.get('name') or 'MCP server')[:200]
    version = str(server.get('version') or 'latest')[:100]
    description = str(server.get('description') or 'Published MCP server')[:4000]
    source = safe_https(server.get('websiteUrl'))
    if not safe_https(source):
        repository = server.get('repository') if isinstance(server.get('repository'), dict) else {}
        source = repository.get('url')
    if not safe_https(source):
        source = 'https://registry.modelcontextprotocol.io/?q=' + urllib.parse.quote(name)
    icons = server.get('icons') if isinstance(server.get('icons'), list) else []
    icon = safe_https(icons[0].get('src')) if icons and isinstance(icons[0], dict) else ''
    domains = sorted({host.lower().removeprefix('www.') for value in (source, endpoint) if value for host in [urlsplit(value).hostname] if host})
    published_at = registry_status.get('updatedAt') if isinstance(registry_status, dict) else None
    try:
        registry_updated_at = datetime.fromisoformat(published_at.replace('Z', '+00:00')).replace(tzinfo=None).isoformat() if published_at else None
    except (ValueError, AttributeError):
        registry_updated_at = None
    identifier = hashlib.sha256((name + '\n' + version).encode()).hexdigest()
    return {
        'id': identifier,
        'registry_name': name,
        'title': title,
        'version': version,
        'description': description,
        'url': endpoint,
        'source': source,
        'icon': icon or None,
        'domains': domains,
        'category': category_for(name, description),
        'transport': transport,
        'setup_note': setup_note,
        'test_status': test_status,
        'test_message': test_message,
        'tool_count': None,
        'registry_updated_at': registry_updated_at,
        'tested_at': None,
    }


def sse_json(payload):
    if isinstance(payload, dict):
        return payload
    text = payload.decode('utf-8', errors='replace')
    for line in text.splitlines():
        if line.startswith('data:'):
            try:
                value = json.loads(line[5:].strip())
                if isinstance(value, dict):
                    return value
            except json.JSONDecodeError:
                continue
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def public_host(url):
    try:
        host = urlsplit(url).hostname
        if not host:
            return None
        addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
            return None
        return host
    except (OSError, ValueError):
        return None


def post_json(url, body, headers=None, timeout=5):
    all_headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'User-Agent': 'CypherMcpDirectory/1.0 (read-only MCP initialize probe)',
    }
    if headers:
        all_headers.update(headers)
    request = urllib.request.Request(url, data=json.dumps(body).encode(), headers=all_headers, method='POST')
    try:
        response = OPENER.open(request, timeout=timeout)
        with response:
            return response.status, dict(response.headers.items()), response.read(1024 * 1024)
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers.items()), error.read(1024 * 1024)


def probe_endpoint(url, timeout):
    host = public_host(url)
    if not host:
        return {'test_status': 'unsafe_or_unresolved', 'test_message': 'The endpoint hostname did not resolve only to public addresses.'}
    init = {
        'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
        'params': {
            'protocolVersion': PROTOCOL_VERSION,
            'capabilities': {},
            'clientInfo': {'name': 'Cypher directory checker', 'version': '1.0'},
        },
    }
    try:
        status, headers, body = post_json(url, init, timeout=timeout)
    except (OSError, TimeoutError, urllib.error.URLError) as error:
        return {'test_status': 'unavailable', 'test_message': type(error).__name__ + ' while opening the endpoint.'}
    if status in {401, 403}:
        return {'test_status': 'auth_required', 'test_message': 'The endpoint responded and requires account authorization.'}
    if status == 429:
        return {'test_status': 'rate_limited', 'test_message': 'The endpoint rate limited this one-time read-only check.'}
    if 300 <= status < 400:
        return {'test_status': 'redirected', 'test_message': 'The endpoint redirects. Update the Registry URL to its final HTTPS address.'}
    if status >= 500:
        return {'test_status': 'server_error', 'test_message': 'The endpoint returned HTTP ' + str(status) + '.'}
    if status < 200 or status >= 300:
        return {'test_status': 'not_mcp', 'test_message': 'The endpoint returned HTTP ' + str(status) + ' to MCP initialize.'}
    response = sse_json(body)
    result = response.get('result') if isinstance(response, dict) else None
    if not isinstance(result, dict) or not result.get('protocolVersion') or 'serverInfo' not in result:
        if isinstance(response, dict) and response.get('error'):
            return {'test_status': 'protocol_error', 'test_message': 'The endpoint returned a JSON-RPC error to MCP initialize.'}
        return {'test_status': 'not_mcp', 'test_message': 'The endpoint did not return an MCP initialize response.'}
    protocol = str(result.get('protocolVersion'))
    response_headers = {key.lower(): value for key, value in headers.items()}
    session_id = response_headers.get('mcp-session-id')
    followup_headers = {'MCP-Protocol-Version': protocol}
    if session_id:
        followup_headers['MCP-Session-Id'] = session_id
    notification = {'jsonrpc': '2.0', 'method': 'notifications/initialized'}
    try:
        post_json(url, notification, followup_headers, timeout=timeout)
        status, _, tool_body = post_json(url, {'jsonrpc':'2.0','id':2,'method':'tools/list','params':{}}, followup_headers, timeout=timeout)
    except (OSError, TimeoutError, urllib.error.URLError) as error:
        return {'test_status': 'protocol_verified', 'test_message': 'MCP initialize succeeded, but the read-only tool list timed out.', 'tool_count': None}
    if status in {401, 403}:
        return {'test_status': 'auth_required', 'test_message': 'MCP initialize succeeded; account authorization is required to list tools.', 'tool_count': None}
    tool_response = sse_json(tool_body) if 200 <= status < 300 else None
    tools = (tool_response.get('result') or {}).get('tools') if isinstance(tool_response, dict) else None
    if not isinstance(tools, list):
        return {'test_status': 'protocol_verified', 'test_message': 'MCP initialize succeeded; the read-only tool list was not available.', 'tool_count': None}
    if not tools:
        return {'test_status': 'no_tools', 'test_message': 'MCP responded, but it publishes no tools.', 'tool_count': 0}
    return {
        'test_status': 'protocol_verified',
        'test_message': 'MCP initialize and read-only tools/list succeeded.',
        'tool_count': len(tools),
    }


async def test_entries(entries, concurrency, timeout):
    probes = {}
    unique_urls = sorted({row['url'] for row in entries if row.get('url')})
    semaphore = asyncio.Semaphore(concurrency)
    host_semaphores = {}
    executor = ThreadPoolExecutor(max_workers=concurrency)

    async def probe(url):
        host = urlsplit(url).hostname or url
        host_semaphore = host_semaphores.setdefault(host, asyncio.Semaphore(1))
        async with semaphore, host_semaphore:
            loop = asyncio.get_running_loop()
            return url, await loop.run_in_executor(executor, probe_endpoint, url, timeout)

    tasks = [asyncio.create_task(probe(url)) for url in unique_urls]
    started = time.time()
    try:
        for index, task in enumerate(asyncio.as_completed(tasks), start=1):
            url, result = await task
            probes[url] = result
            if index % 250 == 0 or index == len(tasks):
                print('tested %d/%d unique endpoints (%.1fs)' % (index, len(tasks), time.time() - started), flush=True)
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        executor.shutdown(wait=False)
    for row in entries:
        if row.get('url'):
            result = probes.get(row['url'], {'test_status': 'not_tested', 'test_message': 'The endpoint check did not complete.'})
            row.update(result)
            row['tested_at'] = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    return probes


def write_snapshot(path, entries, fetched_at, source_count):
    path.parent.mkdir(parents=True, exist_ok=True)
    snapshot = {
        'source': 'https://registry.modelcontextprotocol.io/',
        'source_count': source_count,
        'fetched_at': fetched_at,
        'entries': entries,
    }
    with gzip.open(path, 'wt', encoding='utf-8', compresslevel=9) as handle:
        json.dump(snapshot, handle, ensure_ascii=False, separators=(',', ':'))


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--limit', type=int, default=10000)
    parser.add_argument('--source-file', type=Path, help='Use a previously downloaded raw Registry JSON array.')
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument('--checkpoint', type=Path, default=Path('/tmp/cypher-mcp-directory-fetch.json'))
    parser.add_argument('--concurrency', type=int, default=12)
    parser.add_argument('--timeout', type=float, default=5.0)
    parser.add_argument('--skip-probe', action='store_true')
    args = parser.parse_args()
    if args.limit < 1 or args.limit > 10000:
        parser.error('--limit must be between 1 and 10000')
    if args.concurrency < 1 or args.concurrency > 20:
        parser.error('--concurrency must be between 1 and 20')
    fetched_at = datetime.now(timezone.utc).isoformat()
    raw = json.loads(args.source_file.read_text()) if args.source_file else fetch_registry(args.limit, args.checkpoint)
    if not isinstance(raw, list):
        parser.error('--source-file must contain an array of Registry entries')
    entries = []
    seen = set()
    for raw_entry in raw:
        row = entry_to_row(raw_entry)
        if not row or row['id'] in seen:
            continue
        seen.add(row['id'])
        entries.append(row)
        if len(entries) >= args.limit:
            break
    if not args.skip_probe:
        await test_entries(entries, args.concurrency, args.timeout)
    write_snapshot(args.output, entries, fetched_at, len(raw))
    counts = {}
    for row in entries:
        counts[row['test_status']] = counts.get(row['test_status'], 0) + 1
    print(json.dumps({'output': str(args.output), 'entries': len(entries), 'source_count': len(raw), 'counts': counts}, indent=2))


if __name__ == '__main__':
    asyncio.run(main())
