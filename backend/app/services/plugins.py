"""Remote MCP connections, with encrypted credentials and public HTTPS endpoints."""
import asyncio
import base64
import hashlib
import ipaddress
import socket
from contextlib import asynccontextmanager
from datetime import timedelta
from urllib.parse import urlsplit
import httpx
from cryptography.fernet import Fernet
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
from app.config import settings

async def validate_endpoint(url):
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.port not in (None, 443):
        raise ValueError('Use a public HTTPS MCP URL without a token or query string. Put a bearer token in the token field.')
    addresses = await asyncio.to_thread(socket.getaddrinfo, parsed.hostname, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError('Plugins must use a public server address.')

def cipher():
    secret = settings.BACKEND_API_TOKEN or settings.SECRET_KEY
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest()))

def seal(token): return cipher().encrypt(token.encode()).decode() if token else None

def reveal(token): return cipher().decrypt(token.encode()).decode() if token else None

def http_client(headers=None, timeout=None, auth=None):
    return httpx.AsyncClient(headers=headers, timeout=timeout or 30, auth=auth, follow_redirects=False)

@asynccontextmanager
async def session(url, token=None):
    await validate_endpoint(url)
    headers = {'Authorization': 'Bearer ' + token} if token else {}
    async with streamablehttp_client(url, headers=headers, timeout=20, sse_read_timeout=60, httpx_client_factory=http_client) as streams:
        async with ClientSession(streams[0], streams[1], read_timeout_seconds=timedelta(seconds=60)) as client:
            await client.initialize()
            yield client

async def discover(url, token=None):
    async with asyncio.timeout(45):
        async with session(url, token) as client:
            result = await client.list_tools()
            return [{'name': t.name, 'description': (t.description or '')[:2000], 'schema': t.inputSchema} for t in result.tools[:40]]

async def invoke(plugin_id, tool_name, arguments):
    from app.db.session import AsyncSessionLocal
    from app.models.plugin import Plugin
    async with AsyncSessionLocal() as db:
        plugin = await db.get(Plugin, plugin_id)
        if not plugin or not plugin.enabled or tool_name not in {t['name'] for t in plugin.tools}:
            return {'error': 'Plugin or tool is disabled.'}
        async with asyncio.timeout(90):
            async with session(plugin.url, reveal(plugin.credential)) as client:
                result = await client.call_tool(tool_name, arguments)
                text = '\n'.join(c.text for c in result.content if c.type == 'text')
                return {'success': not result.isError, 'content': text[:20000] or 'The plugin returned no text.', 'plugin': plugin.name}
