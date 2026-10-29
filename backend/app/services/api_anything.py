"""Read-only MCP interface discovery from API Anything's public catalog.

Wire contract: goodnight000/api-anything@3495ffe8, src/registry-api.ts.
No installer, learned operation, account session, reporting or publishing runs here.
"""
import asyncio
from collections import OrderedDict
from copy import deepcopy
import hashlib
import ipaddress
import json
import re
import time
from urllib.parse import urlsplit

from app.services.plugins import http_client

SEARCH_URL = 'https://api-anything-registry.forth-site.workers.dev/v1/search'
REQUEST_SECONDS = 2
MAX_BYTES = 512_000
CACHE_SECONDS = 60
_cache = OrderedDict()


def public_host(value):
    if not isinstance(value, str) or len(value) > 253:
        return ''
    host = value.lower()
    labels = host.split('.')
    if len(labels) < 2 or labels[-1].isdigit() or any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label) for label in labels):
        return ''
    if host.endswith(('.localhost', '.local', '.internal', '.test', '.onion')):
        return ''
    try:
        ipaddress.ip_address(host)
        return ''
    except ValueError:
        return host


def interface_to_catalog(match, interface):
    if not isinstance(match, dict) or not isinstance(interface, dict) or interface.get('kind') != 'mcp':
        return None
    domain = public_host(match.get('domain'))
    site = match.get('name')
    url = interface.get('url')
    confirmations = interface.get('confirmations')
    if not domain or not isinstance(site, str) or not re.fullmatch(r'[a-z0-9][a-z0-9._-]{0,63}', site):
        return None
    if type(confirmations) is not int or confirmations < 1:
        return None
    if not isinstance(url, str) or len(url) > 2000 or any(c.isspace() or ord(c) < 32 or c in '{}\\' for c in url):
        return None
    try:
        parsed = urlsplit(url)
        host = public_host(parsed.hostname)
        if parsed.scheme != 'https' or not host or parsed.username is not None or parsed.password is not None or parsed.query or parsed.fragment or parsed.port not in (None, 443):
            return None
    except ValueError:
        return None
    if host != domain and not host.endswith('.' + domain):
        return None
    title = match.get('displayName')
    description = match.get('description')
    return {
        'id': 'api-anything:' + site + ':' + hashlib.sha256(url.encode()).hexdigest()[:16],
        'name': title[:100] if isinstance(title, str) and title.strip() else domain,
        'url': url,
        'description': description[:1000] if isinstance(description, str) else 'MCP interface discovered through API Anything. Access and compatibility are checked when you connect.',
        'category': 'MCP Registry',
        'domains': sorted({domain, host}),
        'icon': None,
        'source': 'https://api-anything-registry.forth-site.workers.dev/sites/' + site,
        'discovery_source': 'api_anything',
        'auth': 'auto',
        'setup_note': '',
        # The upstream contract identifies MCP, but does not attest its transport
        # or a working grant. Existing explicit Connect performs that verification.
        'transport': 'unknown',
    }


def discovery_hint(query):
    query = query.strip()
    url_shaped = '://' in query or query.startswith('//') or (
        not any(c.isspace() for c in query) and any(c in query for c in './?#@'))
    if not url_shaped:
        return query
    value = query if '://' in query else 'https:' + query if query.startswith('//') else 'https://' + query
    host = public_host(urlsplit(value).hostname)
    if not host:
        raise ValueError('Use a public website hostname for MCP discovery')
    return host


async def search_interfaces(query):
    hint = discovery_hint(query)
    cached = _cache.get(hint)
    if cached and cached[0] > time.monotonic():
        _cache.move_to_end(hint)
        return deepcopy(cached[1])
    # A URL is a discovery hint, never an instruction to fetch that URL or send
    # its query/fragment (which can contain a login code) to another catalog.
    if not hint:
        return []
    async with asyncio.timeout(REQUEST_SECONDS):
        async with http_client(timeout=REQUEST_SECONDS) as client:
            async with client.stream('GET', SEARCH_URL, params={'q': hint, 'limit': 20}) as response:
                response.raise_for_status()
                data = bytearray()
                async for part in response.aiter_bytes():
                    data.extend(part)
                    if len(data) > MAX_BYTES:
                        raise ValueError('API Anything catalog response is too large')
    payload = json.loads(data)
    if not isinstance(payload, dict) or not isinstance(payload.get('matches'), list):
        raise ValueError('API Anything catalog response is invalid')
    items, seen = [], set()
    for match in payload['matches'][:20]:
        if not isinstance(match, dict) or not isinstance(match.get('interfaces'), list):
            continue
        for interface in match['interfaces'][:10]:
            item = interface_to_catalog(match, interface)
            if item and item['url'] not in seen:
                seen.add(item['url'])
                items.append(item)
            if len(items) == 50:
                break
        if len(items) == 50:
            break
    _cache[hint] = (time.monotonic() + CACHE_SECONDS, deepcopy(items))
    _cache.move_to_end(hint)
    while len(_cache) > 128:
        _cache.popitem(last=False)
    return items
