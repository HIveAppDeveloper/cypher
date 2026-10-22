import os
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from app.db.session import get_db
from app.models.runtime import RuntimeHeartbeat, RuntimeCheck
from app.config import settings
from app.services.runtime_identity import runtime_identity, same_release
router=APIRouter()
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
    for name in ('gateway_verified', 'mcp_verified', 'mcp_tool_verified', 'gateway_verification_failed', 'mcp_verification_failed'):
        item = heartbeats.get(name)
        checks[name] = item.updated_at.isoformat() + 'Z' if item else None
    details = {}
    recorded_checks = {item.name:item for item in (await db.execute(select(RuntimeCheck))).scalars().all()}
    for name in ('gateway','fallback','fleet','starter_plugins','media_openai','media_google','media_video','mcp','browser','computer','check_request'):
        result = recorded_checks.get(name)
        if result: details[name] = {'status':result.status,'detail':result.detail,'checked_at':result.updated_at.isoformat()+'Z'}
    configured = heartbeats.get('gateway_configured')
    model_configured = bool(settings.OMNIROUTE_API_BASE and settings.OMNIROUTE_API_KEY and settings.OMNIROUTE_MODEL and settings.OMNIROUTE_FALLBACK_MODEL) if settings.OMNIROUTE_API_BASE else bool(configured or os.getenv('AI_GATEWAY_API_KEY') or os.getenv('VERCEL_OIDC_TOKEN') or os.getenv('VERCEL_OIDC_TOKEN_FILE'))
    return {'checks':details, **checks, 'database':True,'worker':worker_fresh and version_ready,'worker_last_seen_seconds':int(age) if age is not None else None,'worker_version_matches':version_matches,'deployment':deployment,'worker_deployment':worker_deployment,'gateway_configured':model_configured,'model_route':'OmniRoute' if settings.OMNIROUTE_API_BASE else 'Vercel AI Gateway' if settings.LLM_USE_GATEWAY else 'Direct provider','sandbox_backend':settings.SANDBOX_BACKEND}

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
