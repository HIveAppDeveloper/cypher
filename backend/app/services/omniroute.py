"""Authenticated OmniRoute transport, with no Vercel AI Gateway dependency."""
import hashlib
import json
import time
from urllib.parse import urlsplit

import httpx
from app.config import settings

_cache = {}
_cache_key = None
_cache_at = 0.0
_managed_records = []

async def refresh_model_routes():
    global _managed_records
    from app.db.session import AsyncSessionLocal
    from app.models.runtime import RuntimeCheck
    from sqlalchemy import select
    from app.services.model_connections import PREFIX
    async with AsyncSessionLocal() as db:
        _managed_records = list((await db.execute(select(RuntimeCheck).where(RuntimeCheck.name.startswith(PREFIX)))).scalars())


def managed_api_key(provider):
    """Return a decrypted owner-saved API key only for a verified connection."""
    from app.services.plugins import reveal
    from app.services.model_connections import PREFIX
    row = next((item for item in _managed_records if item.name == PREFIX + provider), None)
    detail = row.detail or {} if row else {}
    if detail.get('state') != 'ready' or not detail.get('credentials_encrypted'):
        return None
    try:
        return reveal(detail['credentials_encrypted'])
    except Exception:
        return None

def configured_model_map():
    from app.services.model_connections import model_map
    from app.services.model_profiles import included_routing, INCLUDED_ROUTES, FREE_ROUTES
    result = dict(model_map(_managed_records) if settings.OMNIROUTE_CONTROL_KEY else settings.OMNIROUTE_MODEL_MAP)
    result.update(FREE_ROUTES)
    if included_routing(): result.update(INCLUDED_ROUTES)
    return result


def enabled():
    return bool(settings.OMNIROUTE_URL)


def endpoint():
    from app.services.model_routing import ModelConfigurationError
    value = (settings.OMNIROUTE_URL or '').rstrip('/')
    url = urlsplit(value)
    if (url.scheme != 'https' and not (url.scheme == 'http' and url.hostname in {'127.0.0.1', 'localhost'})) or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in {'', '/v1'}:
        raise ModelConfigurationError('Configure OmniRoute with its HTTPS origin or /v1 endpoint, without credentials or query parameters.')
    if not settings.OMNIROUTE_API_KEY:
        raise ModelConfigurationError('The OmniRoute inference key is not configured on this runtime.')
    return value if url.path == '/v1' else value + '/v1'


def cloud_project_matches():
    """Return a routing diagnostic without exposing the configured URL or keys."""
    from app.services.model_routing import ModelConfigurationError
    try:
        url = urlsplit(endpoint())
        return url.port in (None, 443) and url.hostname in {
            'omniroute-cloud-ten.vercel.app', 'omniroute-cloud-hiveapp.vercel.app',
            'omniroute-cloud-p5iyakp1h-hiveapp.vercel.app',
        }
    except (ModelConfigurationError, ValueError):
        return False


def headers():
    endpoint()  # Validate the destination before attaching either credential.
    result = {'Authorization': 'Bearer ' + settings.OMNIROUTE_API_KEY}
    if settings.OMNIROUTE_PROTECTION_BYPASS:
        result['x-vercel-protection-bypass'] = settings.OMNIROUTE_PROTECTION_BYPASS
    return result


def model_id(provider, model):
    from app.services.model_profiles import model_route_id
    from app.services.model_routing import ModelNotConfiguredError, ModelCapabilityError
    public_id = model_route_id(provider, model)
    if any(public_id in (row.detail or {}).get('blocked_models', []) for row in _managed_records):
        raise ModelNotConfiguredError('This provider needs account verification. Open Workspace setup → Model access to check the connection.')
    target = configured_model_map().get(public_id) or public_id
    if not isinstance(target, str) or not target or len(target) > 200 or any(c in target for c in ('?', '#', ':', '\\')):
        raise ModelCapabilityError('This task model has no verified OmniRoute connection. Use a connected model or its configured automatic fallback.')
    return target


class OmniRouteError(RuntimeError):
    def __init__(self, status):
        self.status_code = status
        # Upstream bodies can contain account details. Keep those out of chat,
        # durable execution records, and error logs.
        super().__init__(f'OmniRoute model request failed (HTTP {status}).')


async def request(path, payload=None):
    if path not in {'/models', '/chat/completions', '/responses', '/audio/transcriptions', '/video/analyses'}:
        raise ValueError('Unsupported OmniRoute inference endpoint.')
    try:
        async with httpx.AsyncClient(timeout=110, follow_redirects=False) as client:
            response = await client.request('GET' if payload is None else 'POST', endpoint() + path, headers=headers(), json=payload)
    except httpx.TimeoutException as error:
        raise OmniRouteError(504) from error
    except httpx.NetworkError as error:
        raise OmniRouteError(503) from error
    if not 200 <= response.status_code < 300:
        raise OmniRouteError(response.status_code)
    try:
        result = response.json()
    except ValueError as error:
        raise OmniRouteError(502) from error
    if not isinstance(result, dict) or result.get('error'):
        raise OmniRouteError(502)
    return result


async def catalog():
    global _cache, _cache_key, _cache_at
    await refresh_model_routes()
    routes = configured_model_map()
    key = (endpoint(), hashlib.sha256(settings.OMNIROUTE_API_KEY.encode()).hexdigest(), json.dumps(routes, sort_keys=True))
    if key == _cache_key and _cache and time.monotonic() - _cache_at < 300:
        return _cache
    payload = await request('/models')
    raw = {m['id']: m for m in payload.get('data', []) if isinstance(m, dict) and isinstance(m.get('id'), str)}
    result = {}
    from app.services.model_profiles import ALLOWED_MODELS, model_route_id
    # Exact provider/model IDs may be used without a second alias when the
    # authenticated OmniRoute catalog actually exposes them. Different native
    # IDs remain an explicit deployment mapping.
    for provider, model in ALLOWED_MODELS:
        public_id = model_route_id(provider, model)
        if not any(public_id in (row.detail or {}).get('blocked_models', []) for row in _managed_records):
            routes.setdefault(public_id, public_id)
    for public_id, target in routes.items():
        item = raw.get(target)
        if not item:
            continue
        capabilities = item.get('capabilities') or {}
        modalities = item.get('input_modalities') or ['text']
        if capabilities.get('vision') and 'image' not in modalities:
            modalities = [*modalities, 'image']
        parameters = ['tools'] if capabilities.get('tool_calling') is True else []
        if not capabilities.get('reasoning'):
            parameters.append('temperature')
        efforts = capabilities.get('effort_tiers') or []
        pricing = item.get('pricing') or {}
        result[public_id] = {
            'id': public_id, 'type': 'language', 'transport': 'omniroute', 'transport_model': target,
            'modalities': {'input': modalities}, 'supported_parameters': parameters,
            'reasoning_options': [{'type': 'effort', 'values': efforts}] if efforts else [],
            # OmniRoute reports dollars per million tokens; usage accounting
            # expects dollars per token.
            'pricing': {name: float(pricing.get(name) or 0) / 1_000_000 for name in ('input', 'output')},
        }
    _cache, _cache_key, _cache_at = result, key, time.monotonic()
    return result


async def complete(messages, tools, provider, model, generation):
    from litellm import ModelResponse
    if provider == 'gemini':
        # OmniRoute's Gemini SSE translator preserves the signed function-call
        # context needed to consume real tool results on the next turn. Its
        # non-streaming path loses that context and can repeat completed calls.
        from litellm import stream_chunk_builder
        chunks = [chunk async for chunk in stream(messages, tools, provider, model, generation)]
        response = stream_chunk_builder(chunks)
        if not response or not response.choices:
            raise OmniRouteError(502)
        return response
    body = {'model': model_id(provider, model), 'messages': messages, **generation}
    if tools:
        body['tools'] = tools
    # These controls belong to other SDKs/transports and are never forwarded.
    for field in ('extra_body', 'service_tier', 'num_retries'):
        body.pop(field, None)
    response = await request('/chat/completions', body)
    if not response.get('choices'):
        raise OmniRouteError(502)
    return ModelResponse(**response)


async def stream(messages, tools, provider, model, generation=None):
    """Relay real SSE deltas, including tool calls and final usage."""
    from litellm.types.utils import ModelResponseStream
    body = {'model': model_id(provider, model), 'messages': messages, 'stream': True,
            'stream_options': {'include_usage': True}, **(generation or {})}
    if tools:
        body['tools'] = tools
    async with httpx.AsyncClient(timeout=110, follow_redirects=False) as client:
        async with client.stream('POST', endpoint() + '/chat/completions', headers=headers(), json=body) as response:
            if not 200 <= response.status_code < 300:
                raise OmniRouteError(response.status_code)
            async for line in response.aiter_lines():
                if not line.startswith('data:'):
                    continue
                value = line[5:].strip()
                if value == '[DONE]':
                    return
                try:
                    chunk = json.loads(value)
                except ValueError as error:
                    raise OmniRouteError(502) from error
                if not isinstance(chunk, dict) or chunk.get('error'):
                    raise OmniRouteError(502)
                yield ModelResponseStream(**chunk)
