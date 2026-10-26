from datetime import datetime
from typing import Literal
from uuid import UUID,uuid4
from zoneinfo import ZoneInfo,ZoneInfoNotFoundError
import secrets
from fastapi import APIRouter,Depends,HTTPException,Query,Response
from pydantic import BaseModel,Field,field_validator,ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.models.bot import Bot
from app.models.task import Task
from app.models.conversation import Conversation,ConversationParticipant
from app.models.workspace import Knowledge,Routine,Notification,SharedTemplate
from app.schemas.bot import BotCreate
from app.services import workspace as service
router=APIRouter()

class KnowledgeInput(BaseModel):
    kind:Literal['memory','skill']='memory'
    scope:str=Field(default='workspace',max_length=80)
    name:str=Field(min_length=1,max_length=80)
    content:str=Field(min_length=1,max_length=12000)
    parameters:list[str]=Field(default_factory=list,max_length=20)
    @field_validator('parameters')
    @classmethod
    def parameters_valid(cls,values):
        import re
        if len(values)!=len(set(values)) or any(not re.fullmatch(r'[a-z][a-z0-9_]{0,39}',v) for v in values):raise ValueError('Use unique lowercase parameter names.')
        return values

def public_knowledge(item):return {key:getattr(item,key) for key in ('id','kind','scope','name','content','parameters','updated_at')}

@router.get('/knowledge')
async def knowledge(db:AsyncSession=Depends(get_db)):
    return [public_knowledge(x) for x in (await db.execute(select(Knowledge).order_by(Knowledge.name))).scalars().all()]

@router.post('/knowledge',status_code=201)
async def save_knowledge(body:KnowledgeInput,db:AsyncSession=Depends(get_db)):
    if body.scope!='workspace':
        if not body.scope.startswith('bot:'):raise HTTPException(422,'Choose the workspace or an agent memory scope.')
        if not await db.get(Bot,body.scope.removeprefix('bot:')):raise HTTPException(404,'Agent not found')
    try:return public_knowledge(await service.save_knowledge(db,**body.model_dump()))
    except ValueError as error:raise HTTPException(422,str(error))

@router.delete('/knowledge/{id}')
async def delete_knowledge(id:UUID,db:AsyncSession=Depends(get_db)):
    item=await db.get(Knowledge,str(id))
    if not item:raise HTTPException(404,'Item not found')
    await db.delete(item);await db.commit();return {'deleted':True}

class PreferenceInput(BaseModel):
    weekly_token_limit:int|None=Field(default=None,ge=0,le=1000000000)
    notifications:bool|None=None
    tool_approval:Literal['never','writes','always']|None=None
    hidden_bots:list[UUID]|None=Field(default=None,max_length=200)
    pinned_bots:list[UUID]|None=Field(default=None,max_length=200)
    bot_sections:dict[str,list[UUID]]|None=None
    model_config=ConfigDict(extra='forbid')

@router.get('/settings')
async def settings(db:AsyncSession=Depends(get_db)):return await service.preferences(db)

@router.patch('/settings')
async def update_settings(body:PreferenceInput,db:AsyncSession=Depends(get_db)):
    values=body.model_dump(exclude_unset=True,mode='json')
    if values.get('bot_sections') and (len(values['bot_sections'])>30 or any(len(k)>80 or len(v)>200 for k,v in values['bot_sections'].items())):raise HTTPException(422,'Use up to 30 short sections.')
    return await service.update_preferences(db,values)

class RoutineInput(BaseModel):
    conversation_id:UUID
    name:str=Field(min_length=1,max_length=100)
    instructions:str=Field(min_length=1,max_length=12000)
    schedule:Literal['interval','daily','weekdays']='interval'
    interval_minutes:int=Field(default=60,ge=1,le=43200)
    at_time:str=Field(default='09:00',pattern=r'^(?:[01]\d|2[0-3]):[0-5]\d$')
    timezone:str=Field(default='UTC',max_length=80)
    enabled:bool=True
    @field_validator('timezone')
    @classmethod
    def valid_zone(cls,value):
        try:ZoneInfo(value)
        except ZoneInfoNotFoundError:raise ValueError('Choose a valid IANA timezone.')
        return value

def public_routine(item):return {key:getattr(item,key) for key in ('id','conversation_id','name','instructions','schedule','interval_minutes','at_time','timezone','enabled','next_run_at','last_task_id','created_at')}

@router.get('/routines')
async def routines(db:AsyncSession=Depends(get_db)):return [public_routine(r) for r in (await db.execute(select(Routine).order_by(Routine.created_at.desc()))).scalars().all()]

@router.post('/routines',status_code=201)
async def add_routine(body:RoutineInput,db:AsyncSession=Depends(get_db)):
    if not await db.get(Conversation,str(body.conversation_id)):raise HTTPException(404,'Workspace not found')
    if not await db.scalar(select(ConversationParticipant.bot_id).where(ConversationParticipant.conversation_id==str(body.conversation_id)).limit(1)):raise HTTPException(409,'This conversation needs an agent before it can run a routine.')
    row=Routine(**{**body.model_dump(),'conversation_id':str(body.conversation_id)})
    row.next_run_at=service.next_run(row);db.add(row);await db.commit();await db.refresh(row);return public_routine(row)

class RoutineState(BaseModel):enabled:bool
@router.patch('/routines/{id}')
async def routine_state(id:UUID,body:RoutineState,db:AsyncSession=Depends(get_db)):
    row=await db.get(Routine,str(id))
    if not row:raise HTTPException(404,'Routine not found')
    if body.enabled and not await db.scalar(select(ConversationParticipant.bot_id).where(ConversationParticipant.conversation_id==row.conversation_id).limit(1)):raise HTTPException(409,'This conversation needs an agent before the routine can resume.')
    row.enabled=body.enabled;row.next_run_at=service.next_run(row) if row.enabled else None
    await db.commit();return public_routine(row)

@router.post('/routines/{id}/run',status_code=202)
async def run_routine(id:UUID,db:AsyncSession=Depends(get_db)):
    row=(await db.execute(select(Routine).where(Routine.id==str(id)).with_for_update())).scalar_one_or_none()
    if not row:raise HTTPException(404,'Routine not found')
    prior=await db.get(Task,row.last_task_id) if row.last_task_id else None
    if prior and prior.status in {'pending','running','cancel_requested','waiting_approval'}:return {'task_id':prior.id,'status':prior.status}
    try:task=await service.queue_routine(db,row)
    except ValueError as error:raise HTTPException(409,str(error))
    await db.commit();return {'task_id':task.id,'status':'pending'}

@router.get('/runs')
async def runs(db:AsyncSession=Depends(get_db)):
    rows=(await db.execute(select(Task.id,Task.title,Task.status,Task.conversation_id,Task.created_at,Task.completed_at).order_by(Task.created_at.desc()).limit(100))).all()
    return [dict(row._mapping) for row in rows]

@router.get('/runs/metrics')
async def run_metrics(response:Response,hours:int=Query(default=24,ge=1,le=168),cap:int=Query(default=5000,ge=1,le=10000),db:AsyncSession=Depends(get_db)):
    from app.db.tenancy import current_tenant_id
    from app.services.task_metrics import task_metrics
    tenant=current_tenant_id.get()
    if not tenant:raise HTTPException(401,'Sign in to read workspace task metrics.')
    response.headers['Cache-Control']='private, no-store'
    return await task_metrics(db,tenant,hours=hours,cap=cap)

@router.get('/runs/{id}/metrics')
async def run_observation(id:UUID,response:Response,db:AsyncSession=Depends(get_db)):
    from app.db.tenancy import current_tenant_id
    from app.services.task_observation import task_observation
    tenant=current_tenant_id.get()
    if not tenant:raise HTTPException(401,'Sign in to read workspace task metrics.')
    result=await task_observation(db,tenant,str(id))
    if result is None:raise HTTPException(404,'Task not found')
    response.headers['Cache-Control']='private, no-store'
    return result

@router.post('/runs/{id}/skill-draft')
async def skill_draft(id:UUID,db:AsyncSession=Depends(get_db)):
    import re
    from app.models.execution import ExecutionStep
    task=await db.get(Task,str(id))
    if not task or task.status!='completed':raise HTTPException(404,'Choose a completed run from your workspace.')
    steps=(await db.execute(select(ExecutionStep.name).where(ExecutionStep.task_id==task.id,ExecutionStep.status=='completed').order_by(ExecutionStep.updated_at))).scalars().all()
    tools=list(dict.fromkeys(name for name in steps if name not in {'model','context summary'}))
    objective=service.SECRET.sub('[credential omitted]',task.description or task.title)[:4000]
    content='Repeat this verified workflow with the current inputs.\nObjective to adapt: '+objective+'\n'
    if tools:content+='Previously used tools (choose current equivalents and re-check permissions): '+', '.join(tools[:30])+'.\n'
    content+='Inspect current source data. Perform only the actions the user authorizes. Verify each result before reporting completion. Stop for any required login or approval. Do not reuse old task-specific values without checking them.'
    name=re.sub(r'[^a-z0-9_-]+','-',task.title.lower()).strip('-')[:70]
    if not name or not name[0].isalpha():name='workflow-'+name
    return {'name':name,'content':content,'parameters':[],'source_task_id':task.id,'notice':'Review this recipe before saving. Tool arguments, credentials and private files are excluded.'}

@router.get('/usage')
async def usage(db:AsyncSession=Depends(get_db)):
    from app.services.usage import summary
    return await summary(db)

@router.get('/notifications')
async def notifications(db:AsyncSession=Depends(get_db)):
    rows=(await db.execute(select(Notification).where(Notification.read==False).order_by(Notification.created_at.desc()).limit(30))).scalars().all()
    return [{key:getattr(r,key) for key in ('id','task_id','conversation_id','title','detail','created_at')} for r in rows]

@router.post('/notifications/{id}/read')
async def read_notification(id:UUID,db:AsyncSession=Depends(get_db)):
    row=await db.get(Notification,str(id))
    if not row:raise HTTPException(404,'Notification not found')
    row.read=True;await db.commit();return {'read':True}

@router.post('/bots/{id}/duplicate',status_code=201)
async def duplicate(id:UUID,db:AsyncSession=Depends(get_db)):
    bot=await db.get(Bot,str(id))
    if not bot:raise HTTPException(404,'Agent not found')
    names=set((await db.execute(select(Bot.name))).scalars().all())
    base=bot.name[:65]+' copy';name=base;index=2
    while name in names:name=f'{base} {index}';index+=1
    row=Bot(**{key:getattr(bot,key) for key in ('role','description','system_prompt','llm_provider','llm_model','tools_enabled','memory_enabled')},name=name)
    db.add(row);await db.commit();await db.refresh(row)
    return {'id':row.id,'name':row.name}

async def export_template(db,id,include_memories=False):
    bot=await db.get(Bot,str(id))
    if not bot:raise HTTPException(404,'Agent not found')
    data={key:getattr(bot,key) for key in ('name','role','description','system_prompt','llm_provider','llm_model','tools_enabled','memory_enabled')}
    import json
    if service.SECRET.search(json.dumps(data)):raise HTTPException(422,'Remove credentials from this agent’s configuration before exporting.')
    memories=[]
    if include_memories:
        rows=(await db.execute(select(Knowledge).where(Knowledge.kind=='memory',Knowledge.scope=='bot:'+str(id)))).scalars().all()
        memories=[{'name':r.name,'content':r.content} for r in rows]
    return {'format':'grokbot-template-v1','bot':data,'memories':memories,'notice':'Credentials, connected accounts, conversation history and private files are excluded.'}

@router.get('/templates/{id}/export')
async def export(id:UUID,include_memories:bool=False,db:AsyncSession=Depends(get_db)):return await export_template(db,id,include_memories)

class ImportTemplate(BaseModel):
    format:Literal['grokbot-template-v1']
    bot:BotCreate
    memories:list[dict]=Field(default_factory=list,max_length=30)

@router.post('/templates/import',status_code=201)
async def import_template(body:ImportTemplate,db:AsyncSession=Depends(get_db)):
    from app.api.bots import create_bot
    from app.services.model_profiles import ALLOWED_MODELS
    if (body.bot.llm_provider,body.bot.llm_model) not in ALLOWED_MODELS:raise HTTPException(422,'Choose an available task model before importing.')
    if service.SECRET.search(body.bot.system_prompt):raise HTTPException(422,'Templates cannot contain credentials.')
    bot=await create_bot(body.bot,db)
    for item in body.memories:
        name,content=item.get('name'),item.get('content')
        if isinstance(name,str) and isinstance(content,str) and 0<len(name)<=80 and 0<len(content)<=12000:
            try:await service.save_knowledge(db,'memory','bot:'+bot.id,name,content)
            except ValueError:pass
    return {'id':bot.id,'name':bot.name}

@router.post('/templates/{id}/share',status_code=201)
async def share_template(id:UUID,include_memories:bool=False,db:AsyncSession=Depends(get_db)):
    payload=await export_template(db,id,include_memories)
    row=SharedTemplate(id=secrets.token_urlsafe(24),payload=payload);db.add(row);await db.commit()
    return {'id':row.id,'path':'/templates/'+row.id}

@router.get('/templates/shared/{id}')
async def shared_template(id:str,db:AsyncSession=Depends(get_db)):
    if not 24<=len(id)<=64:raise HTTPException(404,'Template not found')
    row=(await db.execute(select(SharedTemplate).where(SharedTemplate.id==id).execution_options(skip_tenant_filter=True))).scalar_one_or_none()
    if not row:raise HTTPException(404,'Template not found')
    return row.payload

@router.delete('/templates/shared/{id}')
async def revoke_template(id:str,db:AsyncSession=Depends(get_db)):
    row=await db.get(SharedTemplate,id)
    if not row:raise HTTPException(404,'Template not found')
    await db.delete(row);await db.commit();return {'deleted':True}
