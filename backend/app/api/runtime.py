import os
from datetime import datetime
from fastapi import APIRouter, Depends
from sqlalchemy import text
from app.db.session import get_db
from app.models.runtime import RuntimeHeartbeat, RuntimeCheck
from app.config import settings
router=APIRouter()
@router.get('')
async def runtime(db=Depends(get_db)):
    await db.execute(text('SELECT 1'))
    heartbeat=await db.get(RuntimeHeartbeat,'worker')
    age=(datetime.utcnow()-heartbeat.updated_at).total_seconds() if heartbeat else None
    checks = {}
    for name in ('gateway_verified', 'mcp_verified', 'mcp_tool_verified', 'gateway_verification_failed', 'mcp_verification_failed'):
        item = await db.get(RuntimeHeartbeat, name)
        checks[name] = item.updated_at.isoformat() + 'Z' if item else None
    details = {}
    for name in ('gateway','fallback','mcp'):
        result = await db.get(RuntimeCheck,name)
        if result: details[name] = {'status':result.status,'detail':result.detail,'checked_at':result.updated_at.isoformat()+'Z'}
    configured = await db.get(RuntimeHeartbeat, 'gateway_configured')
    return {'checks':details, **checks, 'database':True,'worker':age is not None and age<30,'worker_last_seen_seconds':int(age) if age is not None else None,'gateway_configured':bool(configured or os.getenv('AI_GATEWAY_API_KEY') or os.getenv('VERCEL_OIDC_TOKEN') or os.getenv('VERCEL_OIDC_TOKEN_FILE')),'sandbox_backend':settings.SANDBOX_BACKEND}
