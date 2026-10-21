"""A companion can access only jobs for its own, revocable device credential."""
import hashlib,json,secrets
from datetime import datetime,timedelta
from uuid import UUID
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,Field
from sqlalchemy import select,delete
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.db.tenancy import current_tenant_id
from app.models.workspace import LocalDevice,LocalDeviceJob
from app.services.plugins import seal,reveal
router=APIRouter()

def digest(value):return hashlib.sha256(value.encode()).hexdigest()
class PairInput(BaseModel):name:str=Field(min_length=1,max_length=80)
@router.post('/devices',status_code=201)
async def pair(body:PairInput,db:AsyncSession=Depends(get_db)):
    secret=secrets.token_urlsafe(32)
    row=LocalDevice(name=body.name,token_hash=digest(secret),expires_at=datetime.utcnow()+timedelta(minutes=10));db.add(row);await db.commit();await db.refresh(row)
    return {'id':row.id,'pairing_code':row.id+'.'+secret,'expires_at':row.expires_at}

@router.get('/devices')
async def devices(db:AsyncSession=Depends(get_db)):
    rows=(await db.execute(select(LocalDevice))).scalars().all()
    return [{'id':r.id,'name':r.name,'paired':r.paired,'scopes':r.scopes,'folders':r.folders,'last_seen_at':r.last_seen_at} for r in rows]

@router.delete('/devices/{id}')
async def revoke(id:UUID,db:AsyncSession=Depends(get_db)):
    row=await db.get(LocalDevice,str(id))
    if not row:raise HTTPException(404,'Device not found')
    await db.execute(delete(LocalDeviceJob).where(LocalDeviceJob.device_id==row.id));await db.delete(row);await db.commit();return {'revoked':True}

class Credential(BaseModel):token:str=Field(min_length=50,max_length=150)
async def credential(db,token,paired):
    try:id,secret=token.split('.',1);UUID(id)
    except ValueError:raise HTTPException(401,'Invalid device credential')
    row=(await db.execute(select(LocalDevice).where(LocalDevice.id==id).execution_options(skip_tenant_filter=True).with_for_update())).scalar_one_or_none()
    if not row or not secrets.compare_digest(row.token_hash,digest(secret)) or row.paired!=paired or (not paired and (not row.expires_at or row.expires_at<datetime.utcnow())):
        raise HTTPException(401,'Device access expired or was revoked')
    return row

class Claim(Credential):
    folders:list[str]=Field(default_factory=list,max_length=20)
    allow_shell:bool=False
@router.post('/claim')
async def claim(body:Claim,db:AsyncSession=Depends(get_db)):
    row=await credential(db,body.token,False)
    secret=secrets.token_urlsafe(32);row.token_hash=digest(secret);row.paired=True;row.expires_at=None;row.last_seen_at=datetime.utcnow();row.folders=body.folders;row.scopes=['read_file','write_file'] if body.folders else []
    if body.allow_shell:row.scopes=[*row.scopes,'shell']
    await db.commit();return {'token':row.id+'.'+secret,'name':row.name}

@router.post('/poll')
async def poll(body:Credential,db:AsyncSession=Depends(get_db)):
    row=await credential(db,body.token,True);token=current_tenant_id.set(row.tenant_id)
    try:
        row.last_seen_at=datetime.utcnow()
        job=(await db.execute(select(LocalDeviceJob).where(LocalDeviceJob.device_id==row.id,LocalDeviceJob.status=='pending').order_by(LocalDeviceJob.created_at).limit(1).with_for_update(skip_locked=True))).scalar_one_or_none()
        if job and job.created_at<datetime.utcnow()-timedelta(minutes=10):job.status='expired';job.payload='';job=None
        if not job:await db.commit();return {'job':None}
        job.status='awaiting_local_approval';await db.commit()
        return {'job':{'id':job.id,'action':job.action,'arguments':json.loads(reveal(job.payload))}}
    finally:current_tenant_id.reset(token)

class Complete(Credential):
    job_id:UUID
    approved:bool
    result:dict=Field(default_factory=dict)
@router.post('/complete')
async def complete(body:Complete,db:AsyncSession=Depends(get_db)):
    row=await credential(db,body.token,True);token=current_tenant_id.set(row.tenant_id)
    try:
        job=await db.get(LocalDeviceJob,str(body.job_id))
        if not job or job.device_id!=row.id or job.status!='awaiting_local_approval':raise HTTPException(404,'Pending device job not found')
        result=json.dumps(body.result)
        if len(result)>220000:raise HTTPException(422,'Device result exceeds 220 KB')
        job.status='completed' if body.approved else 'denied';job.result=seal(result);job.payload='';await db.commit();return {'status':job.status}
    finally:current_tenant_id.reset(token)
