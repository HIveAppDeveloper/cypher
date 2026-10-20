import os
from datetime import datetime
from fastapi import APIRouter, Depends
from sqlalchemy import text
from app.db.session import get_db
from app.models.runtime import RuntimeHeartbeat
from app.config import settings
router=APIRouter()
@router.get('')
async def runtime(db=Depends(get_db)):
    await db.execute(text('SELECT 1'))
    heartbeat=await db.get(RuntimeHeartbeat,'worker')
    age=(datetime.utcnow()-heartbeat.updated_at).total_seconds() if heartbeat else None
    return {'database':True,'worker':age is not None and age<30,'worker_last_seen_seconds':int(age) if age is not None else None,'gateway_configured':bool(os.getenv('AI_GATEWAY_API_KEY') or os.getenv('VERCEL_OIDC_TOKEN') or os.getenv('VERCEL_OIDC_TOKEN_FILE')),'sandbox_backend':settings.SANDBOX_BACKEND}
