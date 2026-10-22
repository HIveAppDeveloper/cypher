"""Turn any public website into an MCP server that runs in the cloud.

A site that publishes an OpenAPI document gets one tool per operation. Every
site also gets cloud-browser tools scoped to its own domain, so websites with
no API can still be read and operated. instagram.com adds public link reading.
"""
import asyncio
import html
import json
import re
import time
from contextlib import asynccontextmanager
from urllib.parse import urljoin, urlsplit, urlencode, quote
from mcp.server.lowlevel import Server
from mcp.types import CallToolResult, ImageContent, TextContent, Tool, ToolAnnotations
from app.services.plugins import validate_endpoint, http_client, credential_headers

SCHEME = 'site-mcp://'
OPENAPI_PATHS = ('/openapi.json', '/.well-known/openapi.json', '/api/openapi.json', '/swagger.json',
                 '/api/swagger.json', '/v1/openapi.json', '/api/v1/openapi.json', '/docs/openapi.json',
                 '/api/v3/openapi.json', '/v3/api-docs', '/api-docs', '/swagger/v1/swagger.json')
MCP_CANDIDATES = ('https://mcp.{host}/mcp', 'https://mcp.{host}', 'https://{host}/mcp', 'https://{host}/mcp/',
                  'https://app.{host}/mcp/', 'https://api.{host}/mcp')
MAX_OPERATIONS = 60
SPEC_TTL = 600
PREVIEW_AGENT = 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'
_specs: dict[str, tuple[float, dict | None]] = {}
BROWSER_NAMES = {'open_page', 'read_page', 'search_site', 'click', 'fill_form', 'screenshot', 'read_instagram_link'}


def site_url(host): return SCHEME + host
def is_site(url): return isinstance(url, str) and url.startswith(SCHEME)
def site_host(url): return url.removeprefix(SCHEME).split('/')[0].lower()


def on_site(url, host):
    target = (urlsplit(url).hostname or '').lower().removeprefix('www.')
    return target == host or target.endswith('.' + host)


async def probe_mcp(host):
    """Find an MCP server at a conventional address when the site does not advertise one."""
    initialize = {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize', 'params': {
        'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 'open-grokbot', 'version': '1'}}}
    async def check(url):
        try:
            await validate_endpoint(url)
            async with http_client(headers={'accept': 'application/json, text/event-stream'}, timeout=5) as client:
                response = await client.post(url, json=initialize)
        except Exception:
            return None
        if response.status_code == 401 and 'resource_metadata' in response.headers.get('www-authenticate', ''): return url
        if response.status_code == 200 and '"protocolVersion"' in response.text[:4000]: return url
        return None
    found = await asyncio.gather(*(check(pattern.format(host=host)) for pattern in MCP_CANDIDATES))
    return next((url for url in found if url), None)


async def openapi_spec(host):
    cached = _specs.get(host)
    if cached and time.monotonic() - cached[0] < SPEC_TTL: return cached[1]
    async def read(path):
        try:
            async with http_client(timeout=5) as client:
                response = await client.get('https://' + host + path)
            if response.status_code != 200 or len(response.content) > 2_000_000: return None
            data = response.json()
            return data if isinstance(data, dict) and isinstance(data.get('paths'), dict) and ('openapi' in data or 'swagger' in data) else None
        except Exception:
            return None
    found = next((spec for spec in await asyncio.gather(*(read(path) for path in OPENAPI_PATHS)) if spec), None)
    _specs[host] = (time.monotonic(), found)
    return found


def api_base(spec, host):
    servers = [s.get('url', '') for s in spec.get('servers', []) if isinstance(s, dict)]
    if not servers and spec.get('host'): servers = ['https://' + spec['host'] + spec.get('basePath', '')]
    for server in servers or ['/']:
        base = urljoin('https://' + host + '/', server)
        if base.startswith('https://') and on_site(base, host): return base.rstrip('/')
    return 'https://' + host


def reference(spec, pointer):
    if not isinstance(pointer, str) or not pointer.startswith('#/'):
        raise ValueError('Only local OpenAPI references are supported.')
    value = spec
    for part in pointer[2:].split('/'):
        key = part.replace('~1', '/').replace('~0', '~')
        if not isinstance(value, dict) or key not in value:
            raise ValueError('OpenAPI reference was not found.')
        value = value[key]
    return value


def resolved_object(value, spec):
    seen = set()
    while isinstance(value, dict) and '$ref' in value:
        pointer = value['$ref']
        if pointer in seen: raise ValueError('Circular OpenAPI object reference.')
        seen.add(pointer)
        target = reference(spec, pointer)
        if not isinstance(target, dict): raise ValueError('Expected an OpenAPI object.')
        value = {**target, **{k: v for k, v in value.items() if k != '$ref'}}
    return value


def tool_schema(schema, spec):
    """Bundle local references into a standalone JSON schema, including cycles."""
    definitions, names = {}, {}
    def bundle(value):
        if isinstance(value, list): return [bundle(item) for item in value]
        if not isinstance(value, dict): return value
        result = {key: bundle(item) for key, item in value.items() if key != '$ref'}
        if '$ref' in value:
            pointer = value['$ref']
            if pointer not in names:
                target = reference(spec, pointer)
                if not isinstance(target, (dict, bool)): raise ValueError('Expected a schema reference.')
                name = names[pointer] = 'schema_' + str(len(names))
                definitions[name] = {}
                definitions[name] = bundle(target)
            result['$ref'] = '#/$defs/' + names[pointer]
        return result
    result = bundle(schema)
    if definitions: result['$defs'] = definitions
    return result


def operations(spec):
    taken = set(BROWSER_NAMES)
    count = 0
    for path, item in spec.get('paths', {}).items():
        try: item = resolved_object(item, spec)
        except ValueError: continue
        if not isinstance(item, dict): continue
        shared = item.get('parameters', [])
        for method in ('get', 'post', 'put', 'patch', 'delete'):
            op = item.get(method)
            if not isinstance(op, dict): continue
            name = re.sub(r'[^A-Za-z0-9_]+', '_', op.get('operationId') or f'{method}_{path}').strip('_')[:60] or method
            original, suffix = name, 1
            while name in taken:
                name = original[:54] + '_' + str(suffix)
                suffix += 1
            taken.add(name)
            try:
                params = [resolved_object(p, spec) for p in [*shared, *op.get('parameters', [])]]
                params = list({(p['in'], p['name']): p for p in params if isinstance(p, dict) and p.get('in') in ('path', 'query') and p.get('name')}.values())
            except (ValueError, TypeError): continue
            properties = {p['name']: {**(p['schema'] if isinstance(p.get('schema'), dict) else {}), 'description': p.get('description', '')[:300]} for p in params}
            required = [p['name'] for p in params if p.get('required') or p.get('in') == 'path']
            if method in ('post', 'put', 'patch'):
                try: request_body = resolved_object(op.get('requestBody') or {}, spec)
                except ValueError: continue
                body = (request_body.get('content') or {}).get('application/json', {}).get('schema')
                properties['body'] = body if isinstance(body, (dict, bool)) else {'description': 'JSON request body.'}
                if request_body.get('required'): required.append('body')
            try: schema = tool_schema({'type': 'object', 'properties': properties, 'required': required}, spec)
            except (ValueError, TypeError, RecursionError): continue
            yield {'name': name, 'method': method.upper(), 'path': path, 'params': params,
                   'description': ((op.get('summary') or '') + ' ' + (op.get('description') or '')).strip()[:1500] or f'{method.upper()} {path}',
                   'schema': schema}
            count += 1
            if count >= MAX_OPERATIONS: return


class SiteServer:
    """Generated tools served over the standard MCP protocol."""
    def __init__(self, host):
        self.tools, self.handlers = [], {}
        self.server = Server(host)
        @self.server.list_tools()
        async def list_tools(): return self.tools
        @self.server.call_tool()
        async def call_tool(name, arguments):
            content = await self.handlers[name](arguments)
            if content and content[0].type == 'text':
                try: result = json.loads(content[0].text)
                except ValueError: result = None
                if isinstance(result, dict) and result.get('success') is False:
                    return CallToolResult(content=content, isError=True)
            return content

    def add(self, name, description, schema, handler, read_only):
        self.tools.append(Tool(name=name, description=description, inputSchema=schema, annotations=ToolAnnotations(readOnlyHint=read_only)))
        self.handlers[name] = handler




def text(value): return [TextContent(type='text', text=json.dumps(value, default=str)[:20000])]


async def browser_session():
    """Act in the calling bot's own cloud browser, so a sign-in done in its computer view carries over."""
    from app.services.usage import active
    current = active.get()
    if current and current[0]:
        from app.models.task import Task
        async with current[1]() as db:
            task = await db.get(Task, current[0])
            if task: return task.bot_id
    return None


def instagram_fields(page):
    meta = {m[0]: html.unescape(m[1]) for m in re.findall(r'<meta (?:property|name)="(og:[a-z:]+|description)" content="([^"]*)"', page)}
    return meta


async def read_instagram(url):
    if not on_site(url, 'instagram.com'): return {'success': False, 'error': 'Use an instagram.com post, reel or profile link.'}
    path = urlsplit(url).path
    await validate_endpoint('https://www.instagram.com' + path)
    async with http_client(headers={'user-agent': PREVIEW_AGENT}, timeout=15) as client:
        page = (await client.get('https://www.instagram.com' + path)).text
        meta = instagram_fields(page)
        if not meta.get('og:title'): return {'success': False, 'error': 'Instagram did not return this link publicly. It may be private, removed, or need a signed-in browser (use open_page).'}
        result = {'success': True, 'url': meta.get('og:url', url), 'type': meta.get('og:type'), 'title': meta.get('og:title'),
                  'summary': meta.get('og:description'), 'image': meta.get('og:image')}
        counts = re.match(r'([\d.,KMB]+) (likes|Followers), ([\d.,KMB]+) (comments|Following)', meta.get('og:description', ''))
        if counts: result.update({counts.group(2).lower(): counts.group(1), counts.group(4).lower(): counts.group(3)})
        post = re.search(r'/(p|reel|tv)/([A-Za-z0-9_-]+)', path)
        if post:
            embed = (await client.get(f'https://www.instagram.com/{post.group(1)}/{post.group(2)}/embed/captioned/')).text
            caption = re.search(r'<div class="Caption">(.*?)<div class="CaptionComments">', embed, re.S)
            if caption:
                words = html.unescape(re.sub(r'<[^>]+>', ' ', caption.group(1)))
                result['caption'] = re.sub(r'\s+', ' ', words).strip()[:5000]
            author = re.search(r'class="UsernameText">([^<]+)<', embed) or re.search(r'instagram\.com/([A-Za-z0-9_.]+)/p/', result['url'])
            if author: result['author'] = author.group(1)
            result['kind'] = 'reel' if post.group(1) in ('reel', 'tv') else 'post'
        else:
            result['kind'] = 'profile'
        return result


async def build(host, token=None):
    server = SiteServer(host)
    try:
        spec = await openapi_spec(host)
        base, ops = (api_base(spec, host), list(operations(spec))) if spec else (None, [])
    except Exception:
        ops = []
    if ops:
        headers = credential_headers(token)
        for op in ops:
            async def call(arguments, op=op):
                path = op['path']
                for p in op['params']:
                    if p['in'] == 'path': path = path.replace('{' + p['name'] + '}', quote(str(arguments.get(p['name'], '')), safe=''))
                query = {p['name']: arguments[p['name']] for p in op['params'] if p['in'] == 'query' and p['name'] in arguments}
                url = base + path + ('?' + urlencode(query, doseq=True) if query else '')
                if not on_site(url, host): return text({'success': False, 'error': 'This operation points outside the website.'})
                async with http_client(headers=headers, timeout=30) as client:
                    response = await client.request(op['method'], url, json=arguments.get('body') if 'body' in arguments else None)
                try: data = response.json()
                except ValueError: data = response.text[:15000]
                return text({'success': response.is_success, 'status': response.status_code, 'data': data})
            server.add(op['name'], op['description'], op['schema'], call, op['method'] == 'GET')
    from app.services.tools.registry import _browser_tool
    @asynccontextmanager
    async def session():
        from app.services.computer import agent_access
        from app.services.usage import active
        bot_id, current = await browser_session(), active.get()
        if not bot_id or not current:
            yield None
            return
        async with agent_access(bot_id, current[1]): yield bot_id
    def scoped(handler):
        async def call(arguments):
            async with session() as sid:
                if sid is None:
                    return text({'success': False, 'error': 'Use this website tool from an agent conversation with its private cloud browser.'})
                return await handler(arguments, sid)
        return call
    async def address(url):
        try:
            parsed = urlsplit(url)
            if not on_site(url, host) or parsed.scheme != 'https' or parsed.netloc != parsed.hostname: return False
            await validate_endpoint('https://' + parsed.hostname)
            return True
        except (ValueError, OSError):
            return False
    async def page_allowed(sid):
        page = await _browser_tool._get_page(sid)
        return await address(page.url)
    def refused():
        return text({'success': False, 'error': f'The page left {host}. Only {host} pages can be read or used with this connection.'})
    async def open_page(arguments, sid):
        target = urljoin('https://' + host + '/', arguments.get('path') or '/')
        if not await address(target): return text({'success': False, 'error': f'Only {host} pages can be opened with this connection. Use HTTPS without an explicit port and a public address.'})
        result = await _browser_tool.navigate_to(target, session_id=sid)
        if not await page_allowed(sid): return refused()
        return text(result)
    async def read_page(arguments, sid):
        if not await page_allowed(sid): return refused()
        result = await _browser_tool.extract_content(arguments.get('focus') or 'Read the page', session_id=sid)
        if not await page_allowed(sid): return refused()
        return text(result)
    async def click(arguments, sid):
        if not await page_allowed(sid): return refused()
        result = await _browser_tool.click(arguments['target'], session_id=sid)
        if not await page_allowed(sid): return refused()
        return text(result)
    async def fill(arguments, sid):
        if not await page_allowed(sid): return refused()
        result = await _browser_tool.fill_form(arguments['fields'], session_id=sid)
        if not await page_allowed(sid): return refused()
        if result.get('success') and arguments.get('submit'):
            result['submit'] = await _browser_tool.click(arguments['submit'], session_id=sid)
            if not await page_allowed(sid): return refused()
        return text(result)
    async def screenshot(arguments, sid):
        if not await page_allowed(sid): return refused()
        shot = await _browser_tool.screenshot(session_id=sid)
        if not await page_allowed(sid): return refused()
        if not shot.get('success'): return text(shot)
        return [ImageContent(type='image', data=shot['screenshot_base64'], mimeType='image/png'), *text({'title': shot['title'], 'url': shot['url']})]
    async def search(arguments, sid):
        from app.services.tools.web_search import search_web
        return text(await search_web({'query': f"site:{host} {arguments['query']}"}, None))
    server.add('open_page', f'Open a page on {host} in the cloud browser and return its text. Pass a path such as /pricing or a full {host} URL.',
             {'type': 'object', 'properties': {'path': {'type': 'string', 'maxLength': 2000}}, 'required': []}, scoped(open_page), True)
    server.add('read_page', f'Read the text, links and form fields of the current {host} page.',
             {'type': 'object', 'properties': {'focus': {'type': 'string', 'maxLength': 500}}, 'required': []}, scoped(read_page), True)
    server.add('search_site', f'Search the public web for pages on {host}.',
             {'type': 'object', 'properties': {'query': {'type': 'string', 'minLength': 1, 'maxLength': 500}}, 'required': ['query']}, scoped(search), True)
    server.add('screenshot', f'Capture the current {host} page.', {'type': 'object', 'properties': {}}, scoped(screenshot), True)
    server.add('click', f'Click a button or link on the current {host} page by CSS selector or visible text.',
             {'type': 'object', 'properties': {'target': {'type': 'string', 'minLength': 1, 'maxLength': 500}}, 'required': ['target']}, scoped(click), False)
    server.add('fill_form', f'Fill fields on the current {host} page (CSS selector to value), optionally clicking a submit button.',
             {'type': 'object', 'properties': {'fields': {'type': 'object', 'additionalProperties': {'type': 'string'}}, 'submit': {'type': 'string'}}, 'required': ['fields']}, scoped(fill), False)
    if host == 'instagram.com':
        async def instagram(arguments): return text(await read_instagram(arguments['url']))
        server.add('read_instagram_link', 'Read a public Instagram post, reel or profile link: caption, author, likes, comments, followers and image.',
                 {'type': 'object', 'properties': {'url': {'type': 'string', 'minLength': 10, 'maxLength': 2000}}, 'required': ['url']}, instagram, True)
    return server


@asynccontextmanager
async def site_session(url, token=None):
    from mcp.shared.memory import create_connected_server_and_client_session
    server = await build(site_host(url), token)
    async with create_connected_server_and_client_session(server.server) as client:
        yield client
