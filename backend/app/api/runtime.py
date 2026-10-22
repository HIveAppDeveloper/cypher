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
    for name in ('model','fallback','fleet','starter_plugins','media_openai','mcp','browser','computer','check_request'):
        result = recorded_checks.get(name)
        if result:
            stale_transport = name in {'model','fallback','fleet','media_openai'} and (result.detail or {}).get('transport', 'direct') != transport
            details[name] = {'status':'not_checked' if stale_transport else result.status,'detail':{} if stale_transport else result.detail,'checked_at':result.updated_at.isoformat()+'Z'}
    model_configured = bool(settings.OMNIROUTE_URL and settings.OMNIROUTE_API_KEY) or bool(settings.LLM_API_KEY)
    return {'checks':details, **checks, 'database':True,'worker':worker_fresh and version_ready,'worker_last_seen_seconds':int(age) if age is not None else None,'worker_version_matches':version_matches,'deployment':deployment,'worker_deployment':worker_deployment,'model_transport':transport,'model_configured':model_configured,'configured_models':list(settings.OMNIROUTE_MODEL_MAP) if settings.OMNIROUTE_URL else [],'sandbox_backend':settings.SANDBOX_BACKEND}

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
