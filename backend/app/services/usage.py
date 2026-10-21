"""Inspect model consumption and stop new calls at the owner's weekly allowance."""
from contextvars import ContextVar
from contextlib import contextmanager
from functools import wraps
from datetime import datetime,timedelta
from sqlalchemy import select,func
from app.models.workspace import UsageEvent
from app.services.workspace import preferences

active=ContextVar('model_usage_context',default=None)

class UsageLimitError(ValueError):pass

def track_task(function):
    @wraps(function)
    async def wrapped(self,*args,**kwargs):
        from app.services.orchestrator import AsyncSessionLocal
        token=active.set((kwargs.get('task_id'),AsyncSessionLocal))
        try:return await function(self,*args,**kwargs)
        finally:active.reset(token)
    return wrapped


def week_start():
    now=datetime.utcnow();return (now-timedelta(days=now.weekday())).replace(hour=0,minute=0,second=0,microsecond=0)

async def summary(db):
    start=week_start()
    rows=(await db.execute(select(UsageEvent.provider,UsageEvent.model,func.sum(UsageEvent.input_tokens),func.sum(UsageEvent.output_tokens),func.sum(UsageEvent.estimated_cost)).where(UsageEvent.created_at>=start).group_by(UsageEvent.provider,UsageEvent.model))).all()
    models=[{'provider':r[0],'model':r[1],'input_tokens':r[2] or 0,'output_tokens':r[3] or 0,'estimated_cost':r[4] or 0} for r in rows]
    return {'models':models,'tokens':sum(r['input_tokens']+r['output_tokens'] for r in models),'estimated_cost':sum(r['estimated_cost'] for r in models),'weekly_token_limit':(await preferences(db)).get('weekly_token_limit'),'resets_at':(start+timedelta(days=7)).isoformat()+'Z'}

async def check_allowance():
    current=active.get()
    if not current or not current[0]:return
    async with current[1]() as db:
        usage=await summary(db)
        if usage['weekly_token_limit'] is not None and usage['tokens']>=usage['weekly_token_limit']:
            raise UsageLimitError('The workspace weekly model-token allowance has been reached. Adjust it in Usage or wait for its reset. No new model request was sent.')

async def record(provider,model,usage):
    current=active.get()
    if not current or not current[0] or not usage:return
    data=usage.model_dump() if hasattr(usage,'model_dump') else usage if isinstance(usage,dict) else {'input_tokens':getattr(usage,'input_tokens',0),'output_tokens':getattr(usage,'output_tokens',0)}
    incoming=data.get('prompt_tokens',data.get('input_tokens',0)) or 0
    outgoing=data.get('completion_tokens',data.get('output_tokens',0)) or 0
    try:
        from app.services.model_routing import gateway_catalog
        from app.services.model_profiles import gateway_id
        pricing=(await gateway_catalog()).get(gateway_id(provider,model),{}).get('pricing',{})
        cost=float(data.get('cost') or incoming*float(pricing.get('input',0))+outgoing*float(pricing.get('output',0)))
    except Exception:cost=0
    async with current[1]() as db:
        db.add(UsageEvent(task_id=current[0],provider=provider,model=model,input_tokens=incoming,output_tokens=outgoing,estimated_cost=cost));await db.commit()
