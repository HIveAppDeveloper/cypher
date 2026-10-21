import json
from datetime import datetime,timedelta
from typing import Literal
from uuid import UUID
from fastapi import APIRouter,Depends,HTTPException,Query
from pydantic import BaseModel,Field
from sqlalchemy import select,func
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.models.bot import Bot
from app.models.task import Task
from app.models.workspace import ComputerControl,ComputerCommand,ToolApproval,SharedFile
from app.services.computer import taken_over,shared_files_tool
from app.services.plugins import seal,reveal
router=APIRouter()

def protect(value):
    try:return seal(value)
    except ValueError as error:raise HTTPException(503,str(error))

async def bot_exists(db,id):
    if not await db.get(Bot,str(id)):raise HTTPException(404,'Agent not found')

class ControlInput(BaseModel):takeover:bool
@router.post('/{id}/control')
async def control(id:UUID,body:ControlInput,db:AsyncSession=Depends(get_db)):
    await bot_exists(db,id)
    row=await db.get(ComputerControl,str(id))
    if not row:row=ComputerControl(bot_id=str(id));db.add(row)
    row.takeover_until=datetime.utcnow()+timedelta(minutes=15) if body.takeover else None
    await db.commit();return {'takeover':body.takeover,'expires_at':row.takeover_until}

class CommandInput(BaseModel):
    action:Literal['screenshot','navigate','click','type','key','scroll','terminal','list_files','read_file','write_file']
    url:str=Field(default='',max_length=2000)
    x:float=Field(default=0,ge=0,le=1280)
    y:float=Field(default=0,ge=0,le=720)
    text:str=Field(default='',max_length=6000)
    key:Literal['Enter','Tab','Shift+Tab','Backspace','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ControlOrMeta+A']='Enter'
    delta:int=Field(default=500,ge=-5000,le=5000)
    command:str=Field(default='',max_length=6000)
    path:str=Field(default='/workspace',max_length=1000)
    content:str=Field(default='',max_length=100000)

@router.post('/{id}/commands',status_code=202)
async def command(id:UUID,body:CommandInput,db:AsyncSession=Depends(get_db)):
    await bot_exists(db,id)
    if not await taken_over(db,str(id)):raise HTTPException(409,'Take control first. Your session may have expired.')
    pending=await db.scalar(select(func.count()).select_from(ComputerCommand).where(ComputerCommand.bot_id==str(id),ComputerCommand.status.in_(['pending','running'])))
    if pending>=3:raise HTTPException(429,'Wait for the current computer actions to finish.')
    row=ComputerCommand(bot_id=str(id),action=body.action,payload=protect(body.model_dump_json(exclude={'action'})));db.add(row);await db.commit();await db.refresh(row)
    return {'id':row.id,'status':row.status}

@router.get('/{id}/commands/{command_id}')
async def command_result(id:UUID,command_id:UUID,db:AsyncSession=Depends(get_db)):
    row=await db.get(ComputerCommand,str(command_id))
    if not row or row.bot_id!=str(id):raise HTTPException(404,'Computer action not found')
    return {'id':row.id,'status':row.status,'result':json.loads(reveal(row.result)) if row.result else None}

@router.get('/approvals/pending')
async def approvals(db:AsyncSession=Depends(get_db)):
    rows=(await db.execute(select(ToolApproval).join(Task,Task.id==ToolApproval.task_id).where(ToolApproval.status=='pending',Task.status=='running').order_by(ToolApproval.created_at).limit(30))).scalars().all()
    from app.services.context import SECRET
    return [{'id':r.id,'task_id':r.task_id,'bot_id':r.bot_id,'name':r.name,'arguments':SECRET.sub('[credential hidden]',reveal(r.arguments))} for r in rows]

class Decision(BaseModel):approved:bool
@router.post('/approvals/{id}')
async def decision(id:UUID,body:Decision,db:AsyncSession=Depends(get_db)):
    row=await db.get(ToolApproval,str(id))
    if not row or row.status!='pending':raise HTTPException(404,'Pending approval not found')
    task=await db.get(Task,row.task_id)
    if not task or task.status!='running':raise HTTPException(409,'This task is no longer awaiting approval.')
    row.status='approved' if body.approved else 'denied';await db.commit();return {'status':row.status}

@router.get('/shared/files')
async def files(db:AsyncSession=Depends(get_db)):
    return [{'id':r.id,'name':r.name,'updated_at':r.updated_at} for r in (await db.execute(select(SharedFile.id,SharedFile.name,SharedFile.updated_at).order_by(SharedFile.name))).all()]

class FileInput(BaseModel):
    name:str=Field(min_length=1,max_length=200)
    content:str=Field(max_length=200000)
@router.post('/shared/files')
async def save_file(body:FileInput,db:AsyncSession=Depends(get_db)):
    # Use this request's scoped session, including when the test engine is overridden.
    if '/' in body.name or '\\' in body.name:raise HTTPException(422,'Use a simple file name.')
    if len(body.content.encode())>200000:raise HTTPException(422,'Keep shared text files below 200 KB.')
    row=(await db.execute(select(SharedFile).where(SharedFile.name==body.name))).scalar_one_or_none()
    if not row:row=SharedFile(name=body.name);db.add(row)
    row.content=protect(body.content);row.updated_at=datetime.utcnow();await db.commit();return {'saved':True}

@router.get('/shared/files/{id}')
async def read_file(id:UUID,db:AsyncSession=Depends(get_db)):
    row=await db.get(SharedFile,str(id))
    if not row:raise HTTPException(404,'Shared file not found')
    return {'name':row.name,'content':reveal(row.content)}

@router.delete('/shared/files/{id}')
async def delete_file(id:UUID,db:AsyncSession=Depends(get_db)):
    row=await db.get(SharedFile,str(id))
    if not row:raise HTTPException(404,'Shared file not found')
    await db.delete(row);await db.commit();return {'deleted':True}
