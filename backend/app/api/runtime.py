import asyncio
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from app.db.session import get_db
from app.models.runtime import RuntimeHeartbeat, RuntimeCheck
from app.config import settings
from app.services.runtime_identity import runtime_identity, same_release
router=APIRouter()
from typing import Literal
from pydantic import SecretStr
Provider = Literal['openai', 'gemini', 'claude', 'xai']

@router.get('/model-catalog/nicrron')
async def nicrron_model_catalog():
    """Expose only public chat-model metadata; the Nicrron key stays server-side."""
    from app.services.nicrron import NicrronError, model_catalog
    try:
        return await model_catalog()
    except NicrronError as error:
        raise HTTPException(
            status_code=503,
            detail='Nicrron model catalog is temporarily unavailable. Try again shortly.',
        ) from error

@router.post('/model-connections/{provider}/verify', status_code=202)
async def queue_model_verification(provider: Provider, db=Depends(get_db)):
    from app.services.model_connections import queue_check
    return await queue_check(db, provider)

class ProviderKey(BaseModel):
    api_key: SecretStr

@router.post('/model-connections/{provider}/api-key', status_code=202)
async def connect_model_key(provider: Provider, body: ProviderKey, db=Depends(get_db)):
    from app.services.model_connections import queue_check
    return await queue_check(db, provider, body.api_key.get_secret_value().strip())

class ModelCheckRequest(BaseModel):
    provider: str
    model: str

@router.post('/models/test')
async def verify_model_connection(body: ModelCheckRequest):
    from app.services.llm_gateway import LLMGateway, model_selection
    from app.services.model_routing import ModelConfigurationError, ModelNotConfiguredError, ModelCapabilityError, public_model_error
    try:
        provider, model = model_selection(body.model, body.provider)
        async with asyncio.timeout(50):
            result = await LLMGateway.complete(
                messages=[{'role':'user','content':'Reply with exactly: Connection verified.'}],
                provider=provider, model=model, max_tokens=128, allow_fallback=False,
            )
        choices = getattr(result, 'choices', None) or []
        content = getattr(getattr(choices[0], 'message', None), 'content', None) if choices else None
        if not content:
            raise HTTPException(status_code=502, detail='The selected model returned no text. Check the route and try again.')
    except HTTPException:
        raise
    except ModelNotConfiguredError as error:
        raise HTTPException(status_code=422, detail='This model is not available on the configured route. Add the provider in OmniRoute or configure its backend key, then try again.') from error
    except (ModelConfigurationError, ModelCapabilityError) as error:
        raise HTTPException(status_code=422, detail=public_model_error(error)) from error
    except Exception as error:
        raise HTTPException(status_code=503, detail=public_model_error(error)) from error
    from app.services import omniroute
    return {'status':'passed','provider':provider,'model':model,'transport':'omniroute' if omniroute.enabled() else 'direct'}

@router.get('')
async def runtime(db=Depends(get_db)):
    await db.execute(text('SELECT 1'))
    heartbeat=await db.get(RuntimeHeartbeat,'worker')
    age=(datetime.utcnow()-heartbeat.updated_at).total_seconds() if heartbeat else None
    deployment = runtime_identity()
    worker_release = await db.get(RuntimeCheck, 'worker_release')
    worker_deployment = worker_release.detail if worker_release else {}
    version_matches = same_release(deployment, worker_deployment)
    worker_fresh = age is not None and 0 <= age < 90
    version_ready = version_matches is True or not (deployment['deployment_id'] or deployment['commit'])
    checks = {}
    from sqlalchemy import select
    heartbeats = {item.name:item for item in (await db.execute(select(RuntimeHeartbeat))).scalars().all()}
    for name in ('model_verified', 'mcp_verified', 'mcp_tool_verified', 'model_verification_failed', 'mcp_verification_failed'):
        item = heartbeats.get(name)
        checks[name] = item.updated_at.isoformat() + 'Z' if item else None
    details = {}
    transport = 'omniroute' if settings.OMNIROUTE_URL else 'direct'
    recorded_checks = {item.name:item for item in (await db.execute(select(RuntimeCheck))).scalars().all()}
    from app.services.model_connections import can_manage, public_connections, model_map, remote_control_available
    managed = can_manage()
    model_records = [item for name, item in recorded_checks.items() if name.startswith('model_connection:')]
    connections = {'can_manage_model_connections':managed,'model_connections':public_connections(model_records) if managed else []}
    for name in ('model','fallback','fleet','starter_plugins','media_openai','mcp','browser','computer','check_request'):
        result = recorded_checks.get(name)
        if result:
            stale_transport = name in {'model','fallback','fleet','media_openai'} and (result.detail or {}).get('transport', 'direct') != transport
            details[name] = {'status':'not_checked' if stale_transport else result.status,'detail':{} if stale_transport else result.detail,'checked_at':result.updated_at.isoformat()+'Z'}
    managed_provider_key = any((item.detail or {}).get('state') == 'ready' and (item.detail or {}).get('credentials_encrypted')
                               for name, item in recorded_checks.items() if name in {'model_connection:gemini', 'model_connection:xai'})
    model_configured = bool(settings.OMNIROUTE_API_KEY) if settings.OMNIROUTE_URL else bool(settings.LLM_API_KEY) or managed_provider_key
    configured_services = {'model': model_configured, 'model_control': remote_control_available(), 'backend_auth': len(settings.BACKEND_API_TOKEN) >= 32, 'atlas_engine': bool(settings.GROKBOT_ATLAS_ENGINE_ENABLED and settings.ATLAS_ENGINE_SIGNING_KEY)}
    from app.services.omniroute import cloud_project_matches
    return {'configured_services': configured_services, 'checks':details, **checks, **connections, 'database':True,'worker':worker_fresh and version_ready,'worker_last_seen_seconds':int(age) if age is not None else None,'worker_version_matches':version_matches,'deployment':deployment,'worker_deployment':worker_deployment,'model_transport':transport,'model_gateway_project_matches':cloud_project_matches(),'model_configured':model_configured,'configured_models':list(model_map(model_records)) if settings.OMNIROUTE_URL else [],'sandbox_backend':settings.SANDBOX_BACKEND}

@router.post('/checks', status_code=202)
async def request_checks(db=Depends(get_db)):
    if db.bind.dialect.name == 'postgresql':
        await db.execute(text('SELECT pg_advisory_xact_lock(1763000275)'))
    item = await db.get(RuntimeCheck, 'check_request')
    if item and item.status in ('pending','running'):
        return {'status':item.status}
    if item and (datetime.utcnow()-item.updated_at).total_seconds() < 60:
        raise HTTPException(status_code=429, detail='Wait a minute before running cloud checks again.')
    if item:
        item.status='pending'; item.detail={}; item.updated_at=datetime.utcnow()
    else: db.add(RuntimeCheck(name='check_request', status='pending', detail={}, updated_at=datetime.utcnow()))
    await db.commit()
    return {'status':'pending'}
