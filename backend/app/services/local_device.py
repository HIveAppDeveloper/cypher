import asyncio,json
from datetime import datetime,timedelta
from sqlalchemy import select,func
from app.models.workspace import LocalDevice,LocalDeviceJob
from app.services.plugins import seal,reveal

async def local_device_tool(args,bot_id):
    from app.services.usage import active
    current=active.get()
    if not current:return {'error':'Local devices are available during a persisted agent task.'}
    async with current[1]() as db:
        action=args.get('action','list')
        if action=='list':
            rows=(await db.execute(select(LocalDevice).where(LocalDevice.paired==True))).scalars().all()
            return {'devices':[{'id':r.id,'name':r.name,'scopes':r.scopes,'folders':r.folders,'online':bool(r.last_seen_at and r.last_seen_at>datetime.utcnow()-timedelta(seconds=30))} for r in rows]}
        if action=='status':
            job=await db.get(LocalDeviceJob,args.get('job_id',''))
            return {'status':job.status,'result':json.loads(reveal(job.result)) if job.result else None} if job else {'error':'Device job not found.'}
        device=await db.get(LocalDevice,args.get('device_id',''))
        if not device or not device.paired or action not in device.scopes:return {'error':'Choose a paired device with this permission. The user must approve every action on that device.'}
        pending=await db.scalar(select(func.count()).select_from(LocalDeviceJob).where(LocalDeviceJob.device_id==device.id,LocalDeviceJob.status.in_(['pending','awaiting_local_approval'])))
        if pending>=3:return {'error':'This device already has three pending requests. Wait for local approval.'}
        payload={key:args.get(key,'') for key in ('path','content','command')}
        if any(len(str(value))>200000 for value in payload.values()):return {'error':'Keep device request values below 200 KB.'}
        job=LocalDeviceJob(device_id=device.id,action=action,payload=seal(json.dumps(payload)));db.add(job);await db.commit();await db.refresh(job)
        return {'job_id':job.id,'status':'pending_local_approval','instruction':'The companion displays this request for the owner to approve. Use action=status with this job_id to inspect its result. Do not claim that the action has run before status=completed. Never create a second copy while it is pending.'}
