"""Owner-managed model verification, durably queued without browser liveness."""
import asyncio
from contextlib import suppress
from datetime import datetime, timedelta
from urllib.parse import urlsplit
from uuid import uuid4

import httpx
from fastapi import HTTPException
from sqlalchemy import select, text
from app.config import settings
from app.db.tenancy import current_tenant_id
from app.models.runtime import RuntimeCheck

PROVIDERS = {
    'openai': ('OpenAI', 'openai/gpt-6.1-sol', 'https://chatgpt.com/'),
    'gemini': ('Gemini', 'google/gemini-3.8-flash', 'https://aistudio.google.com/api-keys'),
    'claude': ('Claude', 'anthropic/claude-sonnet-5.5', 'https://platform.claude.com/settings/keys'),
    'xai': ('Grok (xAI)', 'xai/grok-4.5', 'https://console.x.ai/'),
}
LOCAL_KEY_PROVIDERS = {'gemini', 'xai'}
PREFIX = 'model_connection:'
ROUTES = {
    'openai/gpt-6.1-sol': {'cx/gpt-6.1-sol'},
    'google/gemini-3.8-flash': {'gemini/gemini-3.8-flash', 'agy/gemini-3.8-flash-low'},
    'anthropic/claude-sonnet-5.5': {
        'anthropic/claude-sonnet-5-5', 'agy/claude-sonnet-5-5-low',
        'cc/claude-sonnet-4-6',
    },
    'anthropic/claude-haiku-4.5': {'ddgw/claude-haiku-4-5'},
    'xai/grok-4.5': {'xai/grok-4.5', 'xao/grok-4.5'},\n    'xai/grok-4.7': {'xai/grok-4.7'},
}
PROVIDER_MODELS = {provider:{info[1]} for provider,info in PROVIDERS.items()}
PROVIDER_MODELS['claude'].add('anthropic/claude-haiku-4.5')

def remote_control_available():
    return bool(settings.OMNIROUTE_URL and settings.OMNIROUTE_CONTROL_KEY)

def can_manage():
    from app.services.managed_connections import installation_owner
    tenant = current_tenant_id.get()
    return bool(installation_owner(tenant) and (tenant != 'legacy-owner' or not settings.REQUIRE_USER_AUTH)) or (not settings.REQUIRE_USER_AUTH and tenant is None)

def require_owner():
    if not can_manage():
        raise HTTPException(403, 'Only the installation owner can manage its shared model connections.')

def safe_verification_url(value):
    try:
        parsed = urlsplit(value)
        return value if isinstance(value, str) and len(value) < 8192 and parsed.scheme == 'https' and parsed.hostname == 'accounts.google.com' and not parsed.username and not parsed.password and parsed.port in (None, 443) else None
    except (TypeError, ValueError):
        return None

def model_map(records):
    result = dict(settings.OMNIROUTE_MODEL_MAP)
    for row in records:
        detail = row.detail or {}
        for public in detail.get('blocked_models', []):
            if public in ROUTES: result.pop(public, None)
        route = detail.get('active_route') or {}
        if route.get('transport_model') in ROUTES.get(route.get('public_model'), set()):
            result[route['public_model']] = route['transport_model']
    return result

def public_connections(records):
    by_name = {row.name: row for row in records}
    result = []
    for provider, (label, public, account_url) in PROVIDERS.items():
        row = by_name.get(PREFIX + provider)
        detail = row.detail or {} if row else {}
        state = 'checking' if row and row.status in {'pending', 'running'} else detail.get('state', 'not_checked')
        active = detail.get('active_route') or {}
        if active.get('public_model') in PROVIDER_MODELS[provider]: public = active['public_model']
        if public == 'anthropic/claude-haiku-4.5': account_url = 'https://duck.ai/'
        item = {'id': provider, 'name': label, 'model': public, 'state': state, 'job_status': row.status if row else None,
                'message': detail.get('message', 'Check the saved connection to verify model access.'),
                'account_url': account_url,
                'can_add_api_key': provider in {'gemini', 'claude', 'xai'} and (not settings.OMNIROUTE_URL or remote_control_available()),
                'requires_api_key': provider in LOCAL_KEY_PROVIDERS and not settings.OMNIROUTE_URL,
                'key_configured': bool(detail.get('credentials_encrypted')),
                'checked_at': detail.get('checked_at'), 'verification_url': None}
        expires = detail.get('verification_expires_at')
        try:
            if provider not in LOCAL_KEY_PROVIDERS and state == 'verification_required' and expires and datetime.fromisoformat(expires.rstrip('Z')) > datetime.utcnow():
                from app.services.plugins import reveal
                item['verification_url'] = safe_verification_url(reveal(detail.get('verification_encrypted')))
        except (ValueError, TypeError): pass
        if provider == 'gemini' and state == 'verification_required' and remote_control_available():
            item['message'] = 'Google requires an account check before this OmniRoute connection can respond. Complete the check, then choose Check again.'
        elif provider == 'gemini' and state == 'verification_required':
            item['message'] = 'Connect Gemini with an AI Studio API key. Google account subscriptions are available through OmniRoute when configured there.'
        elif state == 'verification_required' and not item['verification_url']:
            item['message'] = 'The verification link expired. Choose Check again to get a fresh Google account check.'
        result.append(item)
    return result

async def queue_check(db, provider, api_key=None):
    require_owner()
    if provider not in PROVIDERS or (api_key is not None and provider not in {'gemini', 'claude', 'xai'}):
        raise HTTPException(422, 'Choose a supported model connection.')
    if settings.OMNIROUTE_URL and not remote_control_available():
        raise HTTPException(503, 'OmniRoute account management is not configured on this runtime.')
    if provider not in LOCAL_KEY_PROVIDERS and not remote_control_available():
        raise HTTPException(503, 'Model connection management is not configured on this runtime.')
    if api_key is not None and (not 20 <= len(api_key) <= 1000 or any(c.isspace() or ord(c) < 32 for c in api_key)):
        raise HTTPException(422, 'Enter a valid provider API key without spaces or line breaks.')
    from app.services.plugins import cipher
    try: cipher()
    except ValueError: raise HTTPException(503, 'Secure credential storage must be configured before managing model connections.')
    if db.bind.dialect.name == 'postgresql': await db.execute(text('SELECT pg_advisory_xact_lock(1763000276)'))
    row = await db.get(RuntimeCheck, PREFIX + provider)
    if row and row.status in {'pending', 'running'}: return {'status': row.status}
    if row and datetime.utcnow() - row.updated_at < timedelta(seconds=15):
        raise HTTPException(429, 'Wait 15 seconds before checking this connection again.', headers={'Retry-After': '15'})
    previous = row.detail or {} if row else {}
    detail = {key: value for key, value in previous.items() if key in {'active_route', 'blocked_models'}}
    if provider in LOCAL_KEY_PROVIDERS and previous.get('credentials_encrypted'):
        detail['credentials_encrypted'] = previous['credentials_encrypted']
    detail.update(provider=provider, action='connect_api_key' if api_key is not None else 'check', request_id=str(uuid4()), attempts=0, state='checking', message='Queued in the cloud. You can close this window while the connection is checked.')
    if api_key is not None:
        from app.services.plugins import seal
        if provider in LOCAL_KEY_PROVIDERS and previous.get('credentials_encrypted'):
            detail['previous_credentials_encrypted'] = previous['credentials_encrypted']
            detail['previous_key_state'] = previous.get('state')
            detail['previous_key_message'] = previous.get('message')
            detail['previous_key_checked_at'] = previous.get('checked_at')
        detail['credentials_encrypted'] = seal(api_key)
    elif provider in LOCAL_KEY_PROVIDERS and not remote_control_available() and not detail.get('credentials_encrypted'):
        raise HTTPException(422, 'Add a provider API key before checking this connection.')
    if row: row.status = 'pending'; row.detail = detail; row.updated_at = datetime.utcnow()
    else: db.add(RuntimeCheck(name=PREFIX + provider, status='pending', detail=detail, updated_at=datetime.utcnow()))
    await db.commit()
    return {'status': 'pending'}

async def control_check(payload):
    from app.services import omniroute
    from app.services.model_profiles import included_routing
    if payload['provider'] == 'claude' and payload['action'] == 'check' and included_routing():
        try:
            response = await omniroute.request('/chat/completions', {
                'model':'ddgw/claude-haiku-4-5',
                'messages':[{'role':'user','content':'A shop has 17 red balloons and 25 blue balloons. How many balloons are there altogether? Answer briefly.'}],
                'max_tokens':256, 'stream':False,
            })
            content = ((response.get('choices') or [{}])[0].get('message') or {}).get('content')
            if response.get('model') not in {'claude-haiku-4-5','ddgw/claude-haiku-4-5'} or not isinstance(content,str) or '42' not in content:
                raise RuntimeError('Free Claude did not pass its answer check.')
            return {'state':'ready','message':'Free Claude Haiku 4.5 answered through Duck.ai. Sonnet 5.5 still requires separate provider access.',
                    'public_model':'anthropic/claude-haiku-4.5','transport_model':'ddgw/claude-haiku-4-5'}
        except Exception:
            return {'state':'unavailable','message':'The free Claude route did not pass its live check. Your existing Codex connection remains available.'}
    url = omniroute.endpoint().removesuffix('/v1') + '/api/internal/connections/check'
    headers = omniroute.headers()
    headers['Authorization'] = 'Bearer ' + settings.OMNIROUTE_CONTROL_KEY
    async with httpx.AsyncClient(timeout=110, follow_redirects=False) as client:
        response = await client.post(url, headers=headers, json=payload)
    if response.status_code != 200: raise RuntimeError('Provider check could not complete.')
    result = response.json()
    if not isinstance(result, dict) or result.get('state') not in {'ready', 'verification_required', 'sign_in_required', 'billing_required', 'access_denied', 'rate_limited', 'unavailable'}:
        raise RuntimeError('Provider check returned no verified state.')
    expected = PROVIDER_MODELS[payload['provider']]
    if result['state'] == 'ready' and (result.get('public_model') not in expected or result.get('transport_model') not in ROUTES.get(result.get('public_model'),set())):
        raise RuntimeError('Provider check did not verify the requested model.')
    return result


async def provider_key_check(provider, api_key):
    """Verify a direct provider API key against that provider's official API."""
    model = PROVIDERS[provider][1].split('/', 1)[1]
    if provider == 'gemini':
        url = f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
        headers = {'x-goog-api-key': api_key, 'Content-Type': 'application/json'}
        payload = {'contents': [{'role': 'user', 'parts': [{'text': 'Reply with exactly: Connection verified.'}]}],
                   'generationConfig': {'maxOutputTokens': 16}}
    elif provider == 'xai':
        url = 'https://api.x.ai/v1/chat/completions'
        headers = {'Authorization': 'Bearer ' + api_key, 'Content-Type': 'application/json'}
        payload = {'model': model, 'messages': [{'role': 'user', 'content': 'Reply with exactly: Connection verified.'}], 'max_tokens': 16}
    else:
        raise ValueError('This provider does not use a direct API key check.')
    async with httpx.AsyncClient(timeout=50, follow_redirects=False) as client:
        response = await client.post(url, headers=headers, json=payload)
    if response.status_code == 401 or response.status_code == 403:
        return {'state': 'access_denied', 'message': f'{PROVIDERS[provider][0]} rejected this API key or model access.'}
    if response.status_code == 402:
        return {'state': 'billing_required', 'message': f'{PROVIDERS[provider][0]} API billing or credits need attention.'}
    if response.status_code == 429:
        return {'state': 'rate_limited', 'message': f'{PROVIDERS[provider][0]} API is rate limited. Wait briefly, then check again.'}
    if not 200 <= response.status_code < 300:
        return {'state': 'unavailable', 'message': f'{PROVIDERS[provider][0]} could not verify this model. Check the API key and model access.'}
    try:
        body = response.json()
        if provider == 'gemini':
            choices = body.get('candidates') or []
            content = choices[0].get('content', {}).get('parts', []) if choices else []
            verified = any(isinstance(part, dict) and isinstance(part.get('text'), str) and part['text'].strip() for part in content)
        else:
            choices = body.get('choices') or []
            message = choices[0].get('message') if choices else None
            verified = isinstance(message, dict) and isinstance(message.get('content'), str) and bool(message['content'].strip())
    except (ValueError, TypeError, AttributeError, IndexError):
        verified = False
    if not verified:
        return {'state': 'unavailable', 'message': f'{PROVIDERS[provider][0]} returned no model response. Check model availability and retry.'}
    return {'state': 'ready', 'message': f'{PROVIDERS[provider][0]} API key verified with a model response.',
            'public_model': PROVIDERS[provider][1], 'transport_model': PROVIDERS[provider][1]}

async def recover_checks(sessions):
    async with sessions() as db:
        rows = (await db.execute(select(RuntimeCheck).where(RuntimeCheck.name.startswith(PREFIX), RuntimeCheck.status == 'running'))).scalars().all()
        for row in rows:
            detail = dict(row.detail or {})
            if detail.get('attempts', 0) < 3: row.status = 'pending'
            else:
                row.status = 'failed'
                preserved_ready = False
                if detail.get('provider') in LOCAL_KEY_PROVIDERS:
                    if detail.get('action') == 'connect_api_key' and detail.get('previous_credentials_encrypted'):
                        detail['credentials_encrypted'] = detail['previous_credentials_encrypted']
                        if detail.get('previous_key_state') == 'ready':
                            detail.update(state='ready', message='The replacement key could not be checked. Your previous verified key is still active.',
                                          checked_at=detail.get('previous_key_checked_at'))
                            preserved_ready = True
                    elif detail.get('action') == 'connect_api_key':
                        detail.pop('credentials_encrypted', None)
                    detail.pop('previous_credentials_encrypted', None)
                    detail.pop('previous_key_state', None)
                    detail.pop('previous_key_message', None)
                    detail.pop('previous_key_checked_at', None)
                else:
                    detail.pop('credentials_encrypted', None)
                if not preserved_ready:
                    detail.update(state='unavailable', message='The connection check stopped repeatedly. Check again to retry.', checked_at=datetime.utcnow().isoformat()+'Z')
            row.detail = detail; row.updated_at = datetime.utcnow()
        await db.commit()

async def run_requested_check(sessions, pulse):
    async with sessions() as db:
        row = (await db.execute(select(RuntimeCheck).where(RuntimeCheck.name.startswith(PREFIX), RuntimeCheck.status == 'pending').order_by(RuntimeCheck.updated_at).limit(1).with_for_update(skip_locked=True))).scalar_one_or_none()
        if not row: return False
        detail = dict(row.detail or {}); detail['attempts'] = detail.get('attempts', 0) + 1
        row.status = 'running'; row.detail = detail; row.updated_at = datetime.utcnow()
        name = row.name; await db.commit()
    payload = {'provider': detail['provider'], 'action': detail['action']}
    try:
        if detail.get('credentials_encrypted'):
            from app.services.plugins import reveal
            payload['api_key'] = reveal(detail['credentials_encrypted'])
        if remote_control_available():
            check = control_check(payload)
        elif payload['provider'] in LOCAL_KEY_PROVIDERS:
            check = provider_key_check(payload['provider'], payload['api_key'])
        else:
            check = control_check(payload)
        task = asyncio.create_task(check)
        try:
            while not task.done():
                await pulse()
                await asyncio.wait({task}, timeout=5)
            result = await task
        finally:
            if not task.done():
                task.cancel()
                with suppress(asyncio.CancelledError): await task
    except asyncio.CancelledError: raise
    except Exception:
        result = {'state': 'unavailable', 'message': 'The connection could not be checked. Your existing connection was preserved. Check again shortly.'}
    payload.pop('api_key', None)
    async with sessions() as db:
        row = (await db.execute(select(RuntimeCheck).where(RuntimeCheck.name == name).with_for_update())).scalar_one()
        current = row.detail or {}
        if current.get('request_id') != detail['request_id'] or current.get('attempts') != detail['attempts']: return True
        # Whitelist fields: neither provider errors nor raw credentials reach UI.
        updated = {key: value for key, value in detail.items() if key not in {'credentials_encrypted', 'previous_credentials_encrypted', 'previous_key_state', 'previous_key_message', 'previous_key_checked_at', 'verification_encrypted'}}
        updated.update(state=result['state'], message=str(result.get('message', 'Check finished.'))[:500], checked_at=datetime.utcnow().isoformat()+'Z')
        public = PROVIDERS[detail['provider']][1]
        if result['state'] == 'ready' and result.get('public_model') in PROVIDER_MODELS[detail['provider']] and result.get('transport_model') in ROUTES.get(result['public_model'],set()):
            active_public = result['public_model']
            updated['active_route'] = {'public_model': active_public, 'transport_model': result['transport_model']}
            updated['blocked_models'] = sorted(PROVIDER_MODELS[detail['provider']] - {active_public})
        if detail['provider'] in LOCAL_KEY_PROVIDERS:
            if result['state'] == 'ready':
                updated['credentials_encrypted'] = detail.get('credentials_encrypted')
                updated['blocked_models'] = []
            elif detail.get('previous_credentials_encrypted'):
                updated['credentials_encrypted'] = detail['previous_credentials_encrypted']
                if detail.get('previous_key_state') == 'ready':
                    updated.update(state='ready', message='The replacement key was not verified. Your previous verified key is still active.',
                                   checked_at=detail.get('previous_key_checked_at'))
            elif detail['action'] == 'check':
                updated['credentials_encrypted'] = detail.get('credentials_encrypted')
        elif detail['action'] == 'check' and result['state'] in {'verification_required', 'access_denied', 'sign_in_required'}:
            updated.pop('active_route', None); updated['blocked_models'] = [public]
        if result['state'] == 'verification_required':
            url = safe_verification_url(result.get('verification_url'))
            if url:
                from app.services.plugins import seal
                updated['verification_encrypted'] = seal(url)
                updated['verification_expires_at'] = (datetime.utcnow()+timedelta(minutes=10)).isoformat()+'Z'
        row.status = 'completed'; row.detail = updated; row.updated_at = datetime.utcnow()
        await db.commit()
    return True
