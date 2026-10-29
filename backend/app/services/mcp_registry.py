"""Discover MCP interfaces through API Anything, with official-registry fallback."""

import asyncio
import re
from urllib.parse import urlsplit

from app.services.plugins import http_client

REGISTRY_SERVERS = "https://registry.modelcontextprotocol.io/v0.1/servers"


def _safe_public_url(value):
    if not isinstance(value, str) or not value.startswith("https://") or any(c in value for c in "{}"):
        return ""
    try:
        parsed = urlsplit(value)
        if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.port not in (None, 443):
            return ""
    except ValueError:
        return ""
    return value


def _safe_source_url(value):
    if not isinstance(value, str) or len(value) > 2000:
        return ""
    try:
        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None, 443):
            return ""
    except ValueError:
        return ""
    return value


def server_to_catalog(entry):
    """Map one registry response to the connector browser's small public shape."""
    if not isinstance(entry, dict):
        return None
    server = entry.get("server") if isinstance(entry.get("server"), dict) else entry
    metadata = entry.get("_meta") if isinstance(entry.get("_meta"), dict) else {}
    status = str(entry.get("status") or server.get("status") or metadata.get("status") or "active").lower()
    if status in {"deleted", "deprecated"}:
        return None

    remotes = server.get("remotes") if isinstance(server.get("remotes"), list) else []
    remote = next((item for item in remotes if isinstance(item, dict) and item.get("type") == "streamable-http" and _safe_public_url(item.get("url"))), None)
    endpoint = _safe_public_url(remote.get("url")) if remote else ""
    packages = server.get("packages") if isinstance(server.get("packages"), list) else []
    other_transports = {item.get("type") for item in remotes if isinstance(item, dict)}
    if endpoint:
        setup_note = ""
        transport = "streamable-http"
    elif "sse" in other_transports:
        setup_note = "This listing uses Server-Sent Events. GrokBot currently connects to Streamable HTTP servers."
        transport = "sse"
    elif packages:
        setup_note = "This listing requires a local package or a hosted MCP URL. GrokBot can connect once the provider supplies a public HTTPS Streamable HTTP address."
        transport = "local"
    else:
        setup_note = "This listing does not include a concrete public HTTPS Streamable HTTP address. Ask the provider for its MCP server URL."
        transport = "unknown"

    name = str(server.get("title") or server.get("name") or "MCP server")[:100]
    source = _safe_source_url(server.get("websiteUrl"))
    if not source:
        repository = server.get("repository") if isinstance(server.get("repository"), dict) else {}
        source = _safe_source_url(repository.get("url"))
    if not source:
        source = "https://registry.modelcontextprotocol.io/"
    icon = ""
    icons = server.get("icons") if isinstance(server.get("icons"), list) else []
    if icons and isinstance(icons[0], dict):
        icon = _safe_public_url(icons[0].get("src"))

    domains = set()
    for value in (source, endpoint):
        try:
            host = urlsplit(value).hostname if value else None
        except ValueError:
            host = None
        if host:
            domains.add(host.lower().removeprefix("www."))
    identifier = str(server.get("name") or name)
    version = str(server.get("version") or "latest")
    return {
        "id": f"mcp:{identifier}:{version}",
        "name": name,
        "url": endpoint,
        "description": str(server.get("description") or "Published MCP server")[:1000],
        "category": "MCP Registry",
        "domains": sorted(domains),
        "icon": icon or None,
        "source": source,
        "auth": "auto" if endpoint else "setup",
        "setup_note": setup_note,
        "transport": transport,
    }


async def _search_official_registry(query, cursor=None):
    params = {"search": query, "version": "latest", "limit": 50}
    if cursor:
        params["cursor"] = cursor
    async with http_client(timeout=8) as client:
        response = await client.get(REGISTRY_SERVERS, params=params)
        response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict) or not isinstance(payload.get("servers"), list):
        raise ValueError("The MCP Registry returned an invalid result.")
    items = [mapped for entry in payload["servers"] if (mapped := server_to_catalog(entry))]
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    next_cursor = metadata.get("nextCursor")
    return {"items": items, "next_cursor": next_cursor if isinstance(next_cursor, str) and next_cursor else None}


async def search_registry(query, cursor=None):
    from app.services.api_anything import discovery_hint, search_interfaces
    query = discovery_hint(query)
    # Existing official-registry cursors stay opaque and keep their original
    # provider. API Anything's catalog does not currently expose pagination.
    # The fallback shares the existing eight-second search budget, including
    # slow DNS/streaming, rather than adding another full timeout to the UI.
    try:
        async with asyncio.timeout(8):
            if cursor:
                return await _search_official_registry(query, cursor)
            try:
                items = await search_interfaces(query)
            except Exception:
                items = []
            if items:
                return {'items': items, 'next_cursor': None}
            async with asyncio.timeout(4):
                return await _search_official_registry(query)
    except Exception:
        # A page cursor belongs to the live registry. Never replace its page
        # with a repeated first page from another source.
        if cursor:
            raise
        saved = _search_packaged_registry(query)
        if saved['items']:
            return saved
        raise


def _search_packaged_registry(query):
    from app.services.mcp_directory import read_snapshot
    from app.services.api_anything import public_host
    snapshot = read_snapshot()
    words = re.findall(r'[a-z0-9]+', query.lower())
    items = []
    for row in snapshot['entries']:
        text = ' '.join(str(row.get(k) or '') for k in ('title', 'registry_name', 'description', 'url', 'domains')).lower()
        if not words or not all(word in text for word in words):
            continue
        endpoint = _safe_public_url(row.get('url'))
        if endpoint and not public_host(urlsplit(endpoint).hostname):
            endpoint = ''
        items.append({
            'id': 'mcp:' + str(row.get('registry_name') or row['id']) + ':' + str(row.get('version') or 'latest'),
            'name': str(row.get('title') or row.get('registry_name') or 'MCP server')[:100],
            'url': endpoint,
            'description': ('Saved directory listing; access is checked when you connect. ' + str(row.get('description') or ''))[:1000],
            'category': 'MCP Registry',
            'domains': row.get('domains') or [],
            'icon': _safe_public_url(row.get('icon')) or None,
            'source': _safe_source_url(row.get('source')) or 'https://registry.modelcontextprotocol.io/',
            'discovery_source': 'packaged_registry',
            'snapshot_at': snapshot.get('fetched_at'),
            'auth': 'auto' if endpoint else 'setup',
            'setup_note': '' if endpoint else row.get('setup_note') or 'Ask the provider for its public HTTPS MCP endpoint.',
            'transport': row.get('transport') or 'unknown',
        })
        if len(items) == 50:
            break
    return {'items': items, 'next_cursor': None}
