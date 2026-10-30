"""Remote MCP connections, with encrypted credentials and public HTTPS endpoints."""
import asyncio
import base64
import hashlib
import json
import ipaddress
import socket
from contextlib import asynccontextmanager
from datetime import timedelta
from urllib.parse import urlsplit
import httpx
from cryptography.fernet import Fernet, InvalidToken
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
from app.config import settings

# `readOnlyHint` is untrusted unless the server is an explicitly reviewed
# first-party endpoint. Keep this list in source control; registry entries and
# user-supplied URLs never add trust. Match the exact HTTPS host and path.
TRUSTED_PREVIEW_ANNOTATION_ENDPOINTS = frozenset({
    ('https', 'mcp.linear.app', '/mcp'),
    ('https', 'mcp.notion.com', '/mcp'),
    ('https', 'mcp.vercel.com', ''),
    ('https', 'mcp.windsor.ai', ''),
    ('https', 'mcp.figma.com', '/mcp'),
    ('https', 'api.canva.com', '/connect/v1/mcp'),
    ('https', 'api.githubcopilot.com', '/mcp/readonly'),
    ('https', 'gmailmcp.googleapis.com', '/mcp/v1'),
    ('https', 'drivemcp.googleapis.com', '/mcp/v1'),
    ('https', 'docsmcp.googleapis.com', '/mcp/v1'),
    ('https', 'sheetsmcp.googleapis.com', '/mcp/v1'),
    ('https', 'slidesmcp.googleapis.com', '/mcp/v1'),
    ('https', 'calendarmcp.googleapis.com', '/mcp/v1'),
    ('https', 'chatmcp.googleapis.com', '/mcp/v1'),
    ('https', 'peoplemcp.googleapis.com', '/mcp/v1'),
    ('https', 'classroommcp.googleapis.com', '/mcp/v1'),
})
REVIEWED_READ_ONLY_DOCUMENT_TOOLS = {
    'mcp.deepwiki.com': {'read_wiki_structure', 'read_wiki_contents', 'ask_question'},
    'learn.microsoft.com': {'microsoft_docs_search', 'microsoft_docs_fetch', 'microsoft_code_sample_search'},
    'docs.mcp.cloudflare.com': {'search_cloudflare_documentation', 'get_cloudflare_documentation'},
}

def trusts_read_only_annotations(url):
    try:
        parsed = urlsplit(url)
        return (parsed.scheme.casefold(), (parsed.hostname or '').casefold(), parsed.path.rstrip('/')) in TRUSTED_PREVIEW_ANNOTATION_ENDPOINTS
    except (TypeError, ValueError):
        return False

def is_read_only(url, tool):
    # Preserve the existing generic-chat classification and retry behavior.
    # Scoped previews use `is_preview_read_only` below, which applies a
    # stricter trust boundary before it can skip the owner's approval policy.
    if tool.get('read_only') is True: return True
    try:
        parsed = urlsplit(url)
    except (TypeError, ValueError):
        return False
    if parsed.scheme.casefold() != 'https': return False
    return tool.get('name') in REVIEWED_READ_ONLY_DOCUMENT_TOOLS.get((parsed.hostname or '').casefold(), set())


def is_preview_read_only(url, tool):
    """Trust read-only annotations only from explicitly reviewed endpoints."""
    if tool.get('read_only') is not True:
        return False
    if trusts_read_only_annotations(url):
        return True
    try:
        parsed = urlsplit(url)
    except (TypeError, ValueError):
        return False
    host = (parsed.hostname or '').casefold()
    return parsed.scheme.casefold() == 'https' and tool.get('name') in REVIEWED_READ_ONLY_DOCUMENT_TOOLS.get(host, set())


def transient_failure(error):
    children = getattr(error, 'exceptions', None)
    if children: return all(transient_failure(item) for item in children)
    status = getattr(error, 'status_code', None)
    if status is None: status = getattr(getattr(error, 'response', None), 'status_code', None)
    return status in {408, 429, 500, 502, 503, 504} or isinstance(error, (TimeoutError, httpx.TransportError))


def provider_status(error):
    """Unwrap transport exception groups without exposing provider bodies."""
    status = getattr(error, 'status_code', None)
    if status is None:
        status = getattr(getattr(error, 'response', None), 'status_code', None)
    if status is not None:
        return status
    return next((status for child in getattr(error, 'exceptions', [])
                 if (status := provider_status(child)) is not None), None)


def authentication_failure(error):
    from app.services.plugin_auth import SignInRequired
    if isinstance(error, (SignInRequired, InvalidToken)): return True
    if type(error).__name__ in {'UserAuthorizationRequiredError','InvalidGrantError','NoValidTokenError','AuthorizationExpiredError'}:return True
    if provider_status(error) in {401,403}: return True
    return any(authentication_failure(child) for child in getattr(error, 'exceptions', []))


def tool_result(result, name):
    parts = []
    attachments = []
    for item in result.content:
        if item.type == 'text': parts.append(item.text)
        elif item.type == 'resource' and hasattr(item.resource, 'text'): parts.append(item.resource.text)
        elif item.type in {'image','audio'} and len(attachments)<3:
            formats={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','audio/mpeg':'mp3','audio/wav':'wav','audio/ogg':'ogg'}
            mime=getattr(item,'mimeType','')
            try:
                if mime in formats and len(item.data)<4*1024*1024 and len(base64.b64decode(item.data,validate=True))<=3*1024*1024:
                    attachments.append({'name':f'plugin-output-{len(attachments)+1}.{formats[mime]}','mime':mime,'data':item.data})
            except (ValueError,TypeError):pass
    structured = getattr(result, 'structuredContent', None)
    if structured is not None and not parts: parts.append(json.dumps(structured, default=str))
    output = {'success': not result.isError, 'content': '\n'.join(parts)[:20000], 'plugin': name}
    if result.isError and output['content'].lstrip().lower().startswith('output validation error:'):
        output['code']='invalid_provider_output'
    if structured is not None:
        encoded = json.dumps(structured, default=str)
        if len(encoded) <= 20000: output['structured_content'] = structured
        else: output['structured_content_truncated'] = True
    other_types = sorted({item.type for item in result.content if item.type not in ('text', 'resource')})
    if other_types: output['content_types'] = other_types
    if attachments: output['_attachments'] = attachments
    if not output['content']: output['content'] = 'The plugin returned '+(', '.join(other_types)+' content.' if other_types else 'an empty result.')
    return output

async def validate_endpoint(url):
    parsed = urlsplit(url)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.port not in (None, 443):
        raise ValueError('Use a public HTTPS MCP URL without a token or query string. Put a bearer token in the token field.')
    addresses = await asyncio.to_thread(socket.getaddrinfo, parsed.hostname, 443, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError('Plugins must use a public server address.')


async def validate_public_web_url(url):
    """Reject private-network destinations before cloud browser requests."""
    try:
        parsed = urlsplit(url)
        hostname = parsed.hostname
        port = parsed.port or (443 if parsed.scheme == 'https' else 80)
    except (TypeError, ValueError):
        raise ValueError('Use a valid public HTTP or HTTPS website URL.')
    if parsed.scheme not in {'http', 'https'} or not hostname or parsed.username or parsed.password:
        raise ValueError('Cloud browsing is limited to public HTTP or HTTPS websites.')
    try:
        addresses = await asyncio.wait_for(
            asyncio.to_thread(socket.getaddrinfo, hostname, port, type=socket.SOCK_STREAM),
            timeout=5,
        )
    except (OSError, asyncio.TimeoutError):
        raise ValueError('This website could not be resolved as a public address.')
    if not addresses or any(not ipaddress.ip_address(address[4][0].split('%', 1)[0]).is_global for address in addresses):
        raise ValueError('Cloud browsing is limited to public network addresses.')

def cipher():
    secret = settings.BACKEND_API_TOKEN or settings.SECRET_KEY
    if not secret or secret == "local-only-change-before-exposure" or len(secret) < 32:
        raise ValueError("Configure a random BACKEND_API_TOKEN or SECRET_KEY of at least 32 characters before storing MCP credentials.")
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret.encode()).digest()))

def seal(token): return cipher().encrypt(token.encode()).decode() if token else None

def reveal(token): return cipher().decrypt(token.encode()).decode() if token else None

def is_google_workspace(plugin):
    # One damaged or outdated saved credential must not prevent discovery of
    # every other connection. Invocation still authenticates and fails closed.
    try:
        return reveal(plugin.credential) == 'grokbot-google-workspace'
    except (InvalidToken, ValueError):
        return False

def http_client(headers=None, timeout=None, auth=None):
    async def guard(request):
        parsed = urlsplit(str(request.url))
        await validate_endpoint(parsed._replace(query='',fragment='').geturl())
    return httpx.AsyncClient(headers=headers, timeout=timeout or 20, auth=auth, follow_redirects=False, event_hooks={'request':[guard]})

def credential_headers(token):
    if not token: return {}
    if token.startswith('{'):
        headers=json.loads(token)
        if not isinstance(headers,dict) or len(headers)!=1:raise ValueError('Invalid saved credential.')
        import re
        if any(not re.fullmatch(r'[A-Za-z][A-Za-z0-9-]{0,63}',name) or name.lower() in {'host','cookie','content-length','transfer-encoding','connection','proxy-authorization'} or not isinstance(value,str) or '\r' in value or '\n' in value for name,value in headers.items()):
            raise ValueError('Invalid authentication header.')
        return headers
    return {'Authorization':'Bearer '+token}

@asynccontextmanager
async def session(url, token=None, auth=None):
    await validate_endpoint(url)
    headers = credential_headers(token)
    async with streamablehttp_client(url, headers=headers, timeout=15, sse_read_timeout=25, httpx_client_factory=http_client, auth=auth) as streams:
        async with ClientSession(streams[0], streams[1], read_timeout_seconds=timedelta(seconds=60)) as client:
            await client.initialize()
            yield client

async def discover(url, token=None, auth=None):
    # Initialization and tools/list are read-only. A transient network failure
    # should not turn a working saved connection into an unavailable catalog
    # entry; never retry provider sign-in or permanent protocol errors.
    for attempt in range(2):
        try:
            return await _discover_once(url,token,auth)
        except Exception as error:
            if attempt or authentication_failure(error) or not transient_failure(error):raise
            await asyncio.sleep(1)


async def _discover_once(url, token=None, auth=None):
    async with asyncio.timeout(25):
        async with session(url, token, auth) as client:
            tools = []
            cursor = None
            seen = set()
            while True:
                result = await client.list_tools(cursor=cursor)
                tools.extend({'name': t.name, 'description': (t.description or '')[:2000], 'schema': t.inputSchema, 'read_only': is_read_only(url, {'name':t.name, 'read_only':bool(getattr(t, 'annotations', None) and t.annotations.readOnlyHint)})} for t in result.tools)
                cursor = result.nextCursor
                if not cursor:
                    return tools
                if cursor in seen or len(tools)>5000:
                    raise ValueError('The server returned an invalid or excessive tool catalog.')
                seen.add(cursor)


async def _scoped_preview_snapshot(db, plugin_id, scope_id):
    """Return the current eligible preview tools for one linked tenant account."""
    from sqlalchemy import select
    from app.db.tenancy import current_tenant_id
    from app.models.plugin import Plugin, PluginAuthorization

    tenant_id = current_tenant_id.get()
    if not tenant_id or not scope_id or str(plugin_id) != str(scope_id):
        return None
    plugin = (await db.execute(select(Plugin).where(
        Plugin.id == str(scope_id), Plugin.tenant_id == tenant_id, Plugin.enabled.is_(True)
    ))).scalar_one_or_none()
    if plugin is None:
        return None
    try:
        account_linked = bool(reveal(plugin.credential))
    except (InvalidToken, ValueError):
        account_linked = False
    if not account_linked:
        account_linked = bool(await db.scalar(select(PluginAuthorization.id).where(
            PluginAuthorization.plugin_id == str(scope_id),
            PluginAuthorization.tenant_id == tenant_id,
            PluginAuthorization.status == 'connected',
            PluginAuthorization.payload.is_not(None),
        ).limit(1)))
    if not account_linked:
        return None

    provider = 'google' if is_google_workspace(plugin) else None
    tools = [{
        **tool,
        'plugin_id': plugin.id,
        'service': plugin.name,
        'authenticated': True,
        'provider': provider,
        'read_only': True,
    } for tool in (plugin.tools or [])
        if isinstance(tool, dict) and tool.get('enabled', True) is True and is_preview_read_only(plugin.url, tool)]
    return {'plugin_id': plugin.id, 'service': plugin.name, 'tools': tools}


async def scoped_preview_snapshot(plugin_id, scope_id):
    """Recheck a preview account immediately before discovery or approval."""
    from app.db.tenancy import current_tenant_id
    if not current_tenant_id.get():
        return None
    from app.db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        return await _scoped_preview_snapshot(db, plugin_id, scope_id)


async def invoke(plugin_id, tool_name, arguments, *, preview_scope_id=None):
    from app.db.session import AsyncSessionLocal
    from app.models.plugin import Plugin
    async with AsyncSessionLocal() as db:
        if preview_scope_id is not None:
            snapshot = await _scoped_preview_snapshot(db, plugin_id, preview_scope_id)
            if not snapshot or not any(tool['name'] == tool_name and tool.get('read_only') is True for tool in snapshot['tools']):
                return {'success':False, 'error':'This preview only allows read-only tools from the selected connection. No provider call was made.', 'code':'preview_scope_denied'}
        plugin = await db.get(Plugin, plugin_id)
        if not plugin or not plugin.enabled or tool_name not in {t['name'] for t in plugin.tools if t.get('enabled',True)}:
            return {'success':False, 'error': 'Plugin or tool is disabled.', 'code':'disabled'}
        tool = next(t for t in plugin.tools if t['name'] == tool_name)
        from app.services import google_workspace
        if is_google_workspace(plugin):
            try:return await google_workspace.invoke(db,tool_name,arguments)
            except Exception as error:
                detail=getattr(error,'detail',None)
                code=detail.get('code') if isinstance(detail,dict) else None
                status=provider_status(error)
                if status==429 or code=='rate_limited':
                    return {'success':False,'error':'Google usage or rate limits were reached. Wait before retrying; your saved connection is unchanged.','code':'rate_limited','provider_status':429,'retryable':True}
                if status==401 or code=='permission_required':
                    return {'success':False,'error':'Google access needs sign-in or updated permissions. Reconnect Google in Apps.','code':'sign_in_required'}
                if status==403:
                    return {'success':False,'error':'Google denied this operation. Check API and organization settings; your saved connection is unchanged.','code':'google_access_denied'}
                return {'success':False,'error':'Google did not complete this operation. Retry or check its connection.','code':'google_unavailable'}
        from jsonschema import Draft202012Validator, ValidationError, SchemaError
        try:
            Draft202012Validator(tool['schema']).validate(arguments)
        except (ValidationError, SchemaError):
            return {'success':False, 'error':'Arguments do not match this plugin tool. Search its current schema and correct the parameters.', 'code':'invalid_arguments'}
        async with asyncio.timeout(90):
            for attempt in range(3 if is_read_only(plugin.url, tool) else 1):
                try:
                    token,auth=await connection_auth(db,plugin)
                    async with session(plugin.url, token, auth) as client:
                        result = await client.call_tool(tool_name, arguments)
                        output = tool_result(result, plugin.name)
                        if (urlsplit(plugin.url).hostname == 'jobherder.com' and tool_name == 'get_pricing'
                                and output.get('code') == 'invalid_provider_output'):
                            from app.services.provider_fallbacks import jobherder_website_pricing
                            try:
                                return await jobherder_website_pricing(plugin.name)
                            except Exception:
                                output['recovery_url'] = 'https://jobherder.com/pricing'
                                output['recovery_message'] = 'The provider rejected its pricing output. The official pricing page could not be verified either. No registration, purchase, or job search ran.'
                        return output
                except Exception as error:
                    if attempt < 2 and is_read_only(plugin.url, tool) and transient_failure(error):
                        await asyncio.sleep(2 ** attempt)
                        continue
                    # Do not leak raw transport/OAuth responses into agent context.
                    if authentication_failure(error):
                        return {'success':False, 'error':'This plugin needs sign-in again. Reconnect it in Plugins.', 'code':'sign_in_required'}
                    status = provider_status(error)
                    if status in {429, 502, 503, 504}:
                        return {'success':False, 'error':f'The provider is temporarily unavailable (HTTP {status}). Retry later; your saved connection has not been changed.',
                                'code':'provider_unavailable', 'provider_status':status, 'retryable':True}
                    return {'success':False, 'error':'The plugin call failed. Check its connection and service permissions; no successful result was returned.', 'code':'unavailable'}


async def connection_auth(db,plugin):
    from app.services import managed_connections
    managed,token=await managed_connections.credentials(plugin)
    if managed:return token,None
    from app.services.plugin_auth import provider_for_plugin
    return token,await provider_for_plugin(db,plugin.id)
