import asyncio,hashlib,secrets,uuid
from datetime import datetime,timedelta
from typing import Literal
from fastapi import APIRouter,Depends,HTTPException,Header
from pydantic import BaseModel,Field
from sqlalchemy import select,func,text
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.models.automation import Goal,Channel,ChannelEvent,Delivery
from app.models.task import Task
from app.models.conversation import ConversationParticipant
from app.services.plugins import seal,validate_endpoint

router=APIRouter()
Manager=Literal['gpt-6.1-sol','gpt-6-luna']
class GoalInput(BaseModel):
    conversation_id:str
    title:str=Field(min_length=1,max_length=120)
    objective:str=Field(min_length=1,max_length=12000)
    success_criteria:str=Field(min_length=1,max_length=2000)
    manager_model:Manager='gpt-6.1-sol'
    interval_minutes:int=Field(default=60,ge=15,le=10080)
    max_runs:int=Field(default=3,ge=1,le=20)
class GoalState(BaseModel):
    status:Literal['active','paused']
class ChannelInput(BaseModel):
    name:str=Field(min_length=1,max_length=80)
    conversation_id:str
    manager_model:Manager='gpt-6.1-sol'
    webhook_url:str|None=Field(default=None,max_length=1000)
class ChannelState(BaseModel):
    enabled:bool
class ChannelMessage(BaseModel):
    event_id:str=Field(min_length=1,max_length=128)
    text:str=Field(min_length=1,max_length=20000)

def goal_public(g):
    return {k:getattr(g,k) for k in ['id','conversation_id','title','objective','success_criteria','manager_model','status','interval_minutes','max_runs','runs','next_run_at','last_summary','created_at']}
def channel_public(c):
    return {k:getattr(c,k) for k in ['id','name','conversation_id','manager_model','enabled','webhook_url','created_at']}
async def participant(db,conversation):
    p=(await db.execute(select(ConversationParticipant).where(ConversationParticipant.conversation_id==conversation).limit(1))).scalar_one_or_none()
    if not p:raise HTTPException(404,'Choose an existing conversation.')
    return p
async def create_goal(db,data:GoalInput):
    await participant(db,data.conversation_id)
    if db.bind.dialect.name=='postgresql':await db.execute(text('SELECT pg_advisory_xact_lock(1763000277)'))
    if await db.scalar(select(func.count()).select_from(Goal).where(Goal.status=='active'))>=10:
        raise HTTPException(409,'Ten goals are already active. Pause one first.')
    goal=Goal(**data.model_dump());db.add(goal);await db.commit();await db.refresh(goal)
    return goal

@router.get('/goals')
async def goals(db:AsyncSession=Depends(get_db)):
    return [goal_public(g) for g in (await db.execute(select(Goal).order_by(Goal.created_at.desc()).limit(100))).scalars()]
@router.post('/goals',status_code=201)
async def add_goal(data:GoalInput,db:AsyncSession=Depends(get_db)):
    return goal_public(await create_goal(db,data))
@router.patch('/goals/{id}')
async def goal_state(id:str,data:GoalState,db:AsyncSession=Depends(get_db)):
    g=(await db.execute(select(Goal).where(Goal.id==id).with_for_update())).scalar_one_or_none()
    if not g:raise HTTPException(404,'Goal not found.')
    if data.status=='active' and (g.runs>=g.max_runs or g.status=='completed'):raise HTTPException(409,'This goal has finished its run allowance. Create a new goal to continue.')
    if data.status=='active' and g.last_task_id:
        previous=await db.get(Task,g.last_task_id)
        if previous and previous.status=='cancel_requested':raise HTTPException(409,'Wait for the current task to stop before resuming.')
        if previous and previous.status not in ('pending','running','completed'):
            g.last_task_id=None;g.completion_requested=False
    g.status=data.status;g.next_run_at=datetime.utcnow() if data.status=='active' else None
    if data.status=='paused' and g.last_task_id:
        t=await db.get(Task,g.last_task_id)
        if t and t.status in ('pending','running'):t.status='cancelled' if t.status=='pending' else 'cancel_requested'
    await db.commit();return goal_public(g)
@router.get('/channels')
async def channels(db:AsyncSession=Depends(get_db)):
    return [channel_public(c) for c in (await db.execute(select(Channel).order_by(Channel.created_at.desc()))).scalars()]
@router.post('/channels',status_code=201)
async def add_channel(data:ChannelInput,db:AsyncSession=Depends(get_db)):
    await participant(db,data.conversation_id)
    if data.webhook_url:
        try:await asyncio.wait_for(validate_endpoint(data.webhook_url),timeout=5)
        except Exception:raise HTTPException(422,'Use a public HTTPS webhook without query parameters or redirects.')
    token=secrets.token_urlsafe(32)
    try:encrypted=seal(token)
    except ValueError as error:raise HTTPException(503,str(error))
    c=Channel(**data.model_dump(),token_hash=hashlib.sha256(token.encode()).hexdigest(),signing_secret=encrypted)
    db.add(c);await db.commit();await db.refresh(c)
    return {**channel_public(c),'token':token,'inbound_path':f'/api/channels/{c.id}/events'}
@router.patch('/channels/{id}')
async def channel_state(id:str,data:ChannelState,db:AsyncSession=Depends(get_db)):
    c=await db.get(Channel,id)
    if not c:raise HTTPException(404,'Channel not found.')
    c.enabled=data.enabled;await db.commit();return channel_public(c)
@router.get('/channels/{id}/deliveries')
async def deliveries(id:str,db:AsyncSession=Depends(get_db)):
    rows=(await db.execute(select(Delivery).where(Delivery.channel_id==id).order_by(Delivery.next_attempt_at.desc()).limit(20))).scalars()
    return [{'id':d.id,'status':d.status,'attempts':d.attempts,'detail':d.detail} for d in rows]
@router.post('/channels/{id}/events',status_code=202)
async def channel_event(id:str,data:ChannelMessage,x_grokbot_channel_key:str=Header(default=''),db:AsyncSession=Depends(get_db)):
    # External senders authenticate with this channel's key, not a browser login.
    c=(await db.execute(select(Channel).where(Channel.id==id).with_for_update().execution_options(skip_tenant_filter=True))).scalar_one_or_none()
    if not c or not c.enabled or not secrets.compare_digest(c.token_hash,hashlib.sha256(x_grokbot_channel_key.encode()).hexdigest()):raise HTTPException(401,'Invalid channel credentials or disabled channel.')
    from app.db.tenancy import current_tenant_id
    tenant_token=current_tenant_id.set(c.tenant_id)
    try:
        old=(await db.execute(select(ChannelEvent).where(ChannelEvent.channel_id==id,ChannelEvent.event_id==data.event_id))).scalar_one_or_none()
        if old:return {'status':'duplicate','task_id':old.task_id}
        count=await db.scalar(select(func.count()).select_from(ChannelEvent).where(ChannelEvent.channel_id==id,ChannelEvent.created_at>datetime.utcnow()-timedelta(minutes=1)))
        if count>=10:raise HTTPException(429,'Channel event limit reached. Try again in a minute.')
        if await db.scalar(select(func.count()).select_from(Task).where(Task.status.in_(['pending','running'])))>=20:raise HTTPException(429,'The workspace queue is full.')
        p=await participant(db,c.conversation_id)
        task=Task(id=str(uuid.uuid4()),conversation_id=c.conversation_id,bot_id=p.bot_id,title=data.text[:100],description=data.text,status='pending',result={'request':{'channel_id':id,'options':{'provider':'openai','model':c.manager_model,'max_tokens':2048,'reasoning_effort':'low','max_iterations':8,'team_rounds':1}}})
        db.add(task);db.add(ChannelEvent(channel_id=id,event_id=data.event_id,task_id=task.id));await db.commit()
        return {'status':'queued','task_id':task.id}
    finally:
        current_tenant_id.reset(tenant_token)


@router.post('/channels/{id}/test',status_code=202)
async def test_channel(id:str,db:AsyncSession=Depends(get_db)):
    from app.services.plugins import reveal
    c=await db.get(Channel,id)
    if not c:raise HTTPException(404,'Channel not found.')
    return await channel_event(id,ChannelMessage(event_id='test-'+str(uuid.uuid4()),text='Connection test: reply with exactly Channel connected. Do not use external tools, generate media, or create goals.'),reveal(c.signing_secret),db)
