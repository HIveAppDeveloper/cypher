"""Installation-owner OpenRouter consent; no browser tokens or model inference."""
import base64
import hashlib
import secrets
import re
import time
from datetime import datetime
from urllib.parse import urlencode
from uuid import UUID, uuid4

import httpx
from fastapi import HTTPException
from sqlalchemy import select, text
from app.config import settings
from app.db.tenancy import current_tenant_id
from app.models.runtime import RuntimeCheck
from app.services import model_connections, omniroute
from app.services.plugins import cipher, reveal, seal

PREFIX = 'provider_consent:openrouter:'
CALLBACK = 'https://cypher-agent.vercel.app/api/model-connections/openrouter/callback'
TTL = 600


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def owner():
    model_connections.require_owner()
    return current_tenant_id.get() or 'legacy-owner'


async def gateway_support():
    if not model_connections.remote_control_available():
        return False
    try:
        url = omniroute.endpoint().removesuffix('/v1') + '/api/internal/connections/check'
        headers = omniroute.headers()
        headers['Authorization'] = 'Bearer ' + settings.OMNIROUTE_CONTROL_KEY
        async with httpx.AsyncClient(timeout=5, follow_redirects=False) as client:
            response = await client.post(url, headers=headers, json={'provider':'openrouter','action':'capabilities'})
        data = response.json() if response.status_code == 200 else {}
        capabilities = data.get('capabilities',{})
        return data.get('state') == 'supported' and data.get('provider') == 'openrouter' and capabilities.get('openrouter_consent_enrollment') is True and type(capabilities.get('version')) is int and capabilities['version'] == 1
    except Exception:
        return False


async def begin(db, binding):
    subject = owner()
    try:
        cipher()
    except ValueError:
        raise HTTPException(503, 'Secure account storage is not configured.') from None
    if not await gateway_support():
        raise HTTPException(503, 'Browser account connection is not available on this gateway release yet. Your current providers are unchanged.')
    if db.bind.dialect.name == 'postgresql':
        await db.execute(text('SELECT pg_advisory_xact_lock(1763000289)'))
    check = await db.get(RuntimeCheck,model_connections.PREFIX+'openrouter')
    if check and check.status in {'pending','running'}:
        raise HTTPException(409, 'An account connection is already saving. Wait for its result before starting again.')
    pending = (await db.execute(select(RuntimeCheck).where(RuntimeCheck.name.startswith(PREFIX), RuntimeCheck.status.in_(['awaiting','exchanging'])).with_for_update())).scalars()
    for row in pending:
        if row.detail.get('owner') == subject:
            if row.status == 'exchanging' and time.time() < row.detail.get('expires_at',0):
                raise HTTPException(409, 'An account connection is already exchanging consent. Wait for its result before starting again.')
            row.status = 'cancelled'
            row.detail = {key:value for key,value in row.detail.items() if key != 'verifier_encrypted'}
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
    identifier = str(uuid4())
    expires = time.time() + TTL
    db.add(RuntimeCheck(name=PREFIX+identifier,status='awaiting',updated_at=datetime.utcnow(),detail={
        'owner':subject,'binding_hash':digest(binding),'state_hash':digest(state),
        'verifier_encrypted':seal(verifier),'expires_at':expires,
    }))
    await db.commit()
    url = 'https://openrouter.ai/auth?' + urlencode({'callback_url':CALLBACK,'state':state,'code_challenge':challenge,'code_challenge_method':'S256','key_label':'Cypher'})
    return {'flow_id':identifier,'authorization_url':url,'expires_at':expires}


async def flow(db, identifier, lock=False):
    subject = owner()
    try:
        identifier = str(UUID(identifier))
    except (TypeError, ValueError, AttributeError):
        raise HTTPException(404, 'Connection request not found.') from None
    query = select(RuntimeCheck).where(RuntimeCheck.name == PREFIX+identifier)
    if lock:
        query = query.with_for_update()
    row = (await db.execute(query)).scalar_one_or_none()
    if not row or row.detail.get('owner') != subject:
        raise HTTPException(404, 'Connection request not found.')
    return row


async def finish(db, identifier, binding, state, code, denied=False):
    row = await flow(db, identifier, lock=True)
    detail = dict(row.detail)
    if row.status != 'awaiting' or time.time() >= detail.get('expires_at',0):
        raise HTTPException(409, 'This connection request expired or was already used. Start again.')
    if not secrets.compare_digest(detail.get('binding_hash',''),digest(binding)) or not secrets.compare_digest(detail.get('state_hash',''),digest(state)):
        raise HTTPException(400, 'This callback does not match the browser that started sign-in.')
    verifier = reveal(detail.pop('verifier_encrypted',None))
    row.status = 'cancelled' if denied else 'exchanging'
    row.detail = detail
    await db.commit()  # Consume before network I/O; concurrent callbacks cannot exchange twice.
    if denied:
        return {'status':'cancelled'}
    try:
        if not code or len(code) > 4096:
            raise ValueError('Invalid authorization response')
        async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
            response = await client.post('https://openrouter.ai/api/v1/auth/keys',json={'code':code,'code_verifier':verifier,'code_challenge_method':'S256'})
        if response.status_code != 200 or len(response.content) > 16384:
            raise ValueError('Account exchange failed')
        key = response.json().get('key')
        if not isinstance(key,str) or not re.fullmatch(r'sk-or-v1-[A-Za-z0-9_-]{20,240}',key):
            raise ValueError('Invalid account key')
        await model_connections.queue_check(db,'openrouter',key,verification_target='provider_account')
        check = await db.get(RuntimeCheck,model_connections.PREFIX+'openrouter')
        row.status = 'queued'
        row.detail = {**detail,'request_id':check.detail['request_id']}
        row.updated_at = datetime.utcnow()
        await db.commit()
        return {'status':'queued'}
    except Exception:
        await db.rollback()
        row = await flow(db,identifier,lock=True)
        row.status = 'failed'
        row.detail = detail
        row.updated_at = datetime.utcnow()
        await db.commit()
        return {'status':'failed'}


async def status(db, identifier):
    row = await flow(db, identifier)
    state = row.status
    message = 'Finish allowing access on OpenRouter. No model request has been sent.'
    if state in {'awaiting','exchanging'} and time.time() >= row.detail.get('expires_at',0):
        state = 'expired'
    if state == 'queued':
        check = await db.get(RuntimeCheck,model_connections.PREFIX+'openrouter')
        if not check or check.detail.get('request_id') != row.detail.get('request_id'):
            state = 'superseded'
        elif check.status in {'pending','running'}:
            state = 'saving'
        elif check.detail.get('state') == 'connected' and check.detail.get('account_connected') is True:
            state = 'connected'
        else:
            state = 'failed'
    if state == 'connected':
        message = 'OpenRouter account connected. Model access has not been tested. OpenRouter credits are separate from your provider subscriptions.'
    elif state == 'saving':
        message = 'Consent received. Securely checking and saving the account in the cloud; no model inference runs.'
    elif state in {'failed','expired','cancelled','superseded'}:
        message = 'This connection was not completed. Your previous provider access is unchanged; start again when ready.'
    return {'status':state,'message':message,'account_connected':state=='connected','model_access_verified':False}
