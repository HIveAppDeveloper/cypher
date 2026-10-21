from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_, literal_column
from uuid import UUID, uuid4
import base64
from urllib.parse import quote
from fastapi.responses import Response
from app.db.session import get_db
from app.models.message import Message
from app.models.task import Task
from app.models.conversation import ConversationParticipant
from app.schemas.message import MessageCreate, MessageResponse

router = APIRouter()

@router.post("/{id}/messages", status_code=202)
async def send_message(id: UUID, msg: MessageCreate, db: AsyncSession = Depends(get_db)):
    if not msg.content.strip() and not msg.attachments:
        raise HTTPException(status_code=422, detail="Message cannot be empty")
    if msg.attachments and msg.options.output != 'text':
        raise HTTPException(status_code=422, detail="Choose Automatic output to discuss attached files. Media generation accepts a text prompt.")
    participant = (await db.execute(select(ConversationParticipant).where(ConversationParticipant.conversation_id == str(id)).limit(1))).scalar_one_or_none()
    if participant is None:
        raise HTTPException(status_code=404, detail="Conversation or bot not found")
    incoming_id = str(msg.client_message_id or uuid4())
    files = [a.model_dump() for a in msg.attachments]
    existing = await db.get(Message, incoming_id)
    if existing:
        if existing.conversation_id != str(id) or existing.sender_type != 'user' or existing.content != msg.content or (existing.metadata_json or {}).get('attachments', []) != files or (existing.metadata_json or {}).get('reply_to_id') != (str(msg.reply_to_id) if msg.reply_to_id else None):
            raise HTTPException(status_code=409, detail="Message identifier already used. Send a new message.")
        previous_task = (existing.metadata_json or {}).get('task_id')
        if previous_task:
            return {'status':'queued','task_id':previous_task,'message_id':incoming_id}
        raise HTTPException(status_code=409, detail="Message identifier already used.")
    thread_root=None
    if msg.reply_to_id:
        parent=await db.get(Message,str(msg.reply_to_id))
        if not parent or parent.conversation_id!=str(id) or (parent.metadata_json or {}).get('internal') or parent.message_type not in {'text','handoff'}:
            raise HTTPException(404,'Reply target not found in this conversation')
        thread_root=(parent.metadata_json or {}).get('thread_root_id') or parent.id
    from app.services.workspace import expand_skill
    try:description=await expand_skill(db,msg.content,participant.bot_id)
    except ValueError as error:raise HTTPException(422,str(error))
    reply_meta={'reply_to_id':str(msg.reply_to_id),'thread_root_id':thread_root} if msg.reply_to_id else {}
    task = Task(id=str(uuid4()),conversation_id=str(id), bot_id=participant.bot_id, title=msg.content[:100], description=description or "Review the attached files.", status="pending", result={"request": {"incoming_message_id":incoming_id,"attachments": files, "options": msg.options.model_dump(),**reply_meta}})
    db.add(task)
    db.add(Message(id=incoming_id,conversation_id=str(id),sender_type='user',content=msg.content,message_type='text',metadata_json={'attachments':files,'task_id':task.id,**reply_meta}))
    await db.commit()
    await db.refresh(task)
    return {"status": "queued", "task_id": task.id, "message_id": incoming_id}

@router.get("/{id}/messages", response_model=list[MessageResponse])
async def list_messages(id: UUID, limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0), before_id: UUID | None = None, after_id: UUID | None = None, db: AsyncSession = Depends(get_db)):
    projected = db.bind.dialect.name == 'postgresql'
    if projected:
        from sqlalchemy.dialects.postgresql import JSONB
        # Do not download base64 assets from PostgreSQL merely to strip them in
        # Python. That old polling path exhausted the provider's transfer quota.
        metadata = literal_column("(CASE WHEN jsonb_typeof(metadata_json::jsonb)='object' THEN metadata_json::jsonb ELSE '{}'::jsonb END - 'attachments' - 'audio_transcripts') || jsonb_build_object('attachments', COALESCE((SELECT jsonb_agg(jsonb_build_object('name',a->'name','mime',a->'mime')) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(metadata_json::jsonb->'attachments')='array' THEN metadata_json::jsonb->'attachments' ELSE '[]'::jsonb END) a), '[]'::jsonb))",type_=JSONB).label('metadata_json')
        query = select(Message.id,Message.conversation_id,Message.sender_type,Message.sender_bot_id,Message.content,Message.message_type,Message.created_at,metadata).where(Message.conversation_id==str(id))
    else:
        query = select(Message).where(Message.conversation_id == str(id))
    cursor = before_id or after_id
    if cursor:
        pivot = (await db.execute(select(Message.created_at,Message.conversation_id).where(Message.id==str(cursor)))).first()
        if pivot is None or pivot.conversation_id != str(id):
            raise HTTPException(status_code=404, detail='Message cursor not found')
        if after_id:
            query = query.where(or_(Message.created_at > pivot.created_at,and_(Message.created_at==pivot.created_at,Message.id>str(after_id))))
        else:
            query = query.where(or_(Message.created_at < pivot.created_at,and_(Message.created_at==pivot.created_at,Message.id<str(before_id))))
    order = (Message.created_at.asc(),Message.id.asc()) if after_id else (Message.created_at.desc(),Message.id.desc())
    result=await db.execute(query.order_by(*order).offset(offset).limit(limit))
    messages=result.mappings().all() if projected else result.scalars().all()
    if after_id:messages=list(reversed(messages))
    output = []
    for message in messages:
        item = MessageResponse.model_validate(dict(message) if projected else message).model_dump()
        meta = dict(item.get('metadata_json') or {})
        if 'attachments' in meta:
            meta['attachments'] = [{'name': a['name'], 'mime': a['mime'], 'url': f'/api/conversations/{id}/attachments/{message.id}/{index}'} for index, a in enumerate(meta['attachments'])]
        item['metadata_json'] = meta
        output.append(item)
    return output

@router.get("/{id}/tasks")
async def list_tasks(id: UUID, db: AsyncSession = Depends(get_db)):
    tasks = (await db.execute(select(Task).where(Task.conversation_id == str(id)).order_by(Task.created_at.desc()).limit(25))).scalars().all()
    return [{"id": t.id, "title": t.title, "status": t.status, "created_at": t.created_at} for t in tasks]

@router.get('/{id}/sync')
async def sync_conversation(id:UUID,after_id:UUID|None=None,db:AsyncSession=Depends(get_db)):
    # One browser request and one database connection for both pieces of state.
    return {'messages':await list_messages(id,limit=50,offset=0,before_id=None,after_id=after_id,db=db), 'tasks':await list_tasks(id,db=db)}

@router.get("/{id}/attachments/{message_id}/{index}")
async def get_attachment(id: UUID, message_id: UUID, index: int, db: AsyncSession = Depends(get_db)):
    message = await db.get(Message, str(message_id))
    files = (message.metadata_json or {}).get('attachments', []) if message else []
    if message is None or message.conversation_id != str(id) or index < 0 or index >= len(files):
        raise HTTPException(status_code=404, detail='Attachment not found')
    file = files[index]
    return Response(base64.b64decode(file['data']), media_type=file['mime'], headers={'Content-Disposition': "inline; filename*=UTF-8''" + quote(file['name'], safe=''), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store'})


@router.post("/{id}/tasks/{task_id}/cancel", status_code=202)
async def cancel_task(id: UUID, task_id: UUID, db: AsyncSession = Depends(get_db)):
    task = (await db.execute(select(Task).where(Task.id == str(task_id)).with_for_update())).scalar_one_or_none()
    if not task or task.conversation_id != str(id):
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status not in ("pending", "running", "cancel_requested"):
        raise HTTPException(status_code=409, detail="This task has already finished.")
    task.status = "cancelled" if task.status == "pending" else "cancel_requested"
    await db.commit()
    return {"status": task.status}


from pydantic import BaseModel, Field
class SteeringInput(BaseModel):
    instruction: str = Field(min_length=1, max_length=6000)

@router.post("/{id}/tasks/{task_id}/steer", status_code=202)
async def steer_task(id: UUID, task_id: UUID, body: SteeringInput, db: AsyncSession = Depends(get_db)):
    task = (await db.execute(select(Task).where(Task.id == str(task_id)).with_for_update())).scalar_one_or_none()
    if not task or task.conversation_id != str(id):
        raise HTTPException(status_code=404, detail="Task not found")
    if task.status not in ("pending", "running"):
        raise HTTPException(status_code=409, detail="This task is no longer accepting direction. Send a follow-up message instead.")
    if (task.result or {}).get('request', {}).get('options', {}).get('output', 'text') != 'text':
        raise HTTPException(status_code=409, detail="Media generation cannot be redirected after it starts. Cancel and send a new request.")
    instruction = body.instruction.strip()
    if not instruction:
        raise HTTPException(status_code=422, detail="Add a direction first.")
    count = len((await db.execute(select(Message.id).where(Message.conversation_id == str(id), Message.metadata_json['steering_task_id'].as_string() == str(task_id)))).all())
    if count >= 10:
        raise HTTPException(status_code=429, detail="This task has reached its ten direction changes. Send a follow-up after it finishes.")
    message = Message(conversation_id=str(id),sender_type='user',message_type='text',content='Updated direction: '+instruction,metadata_json={'steering_task_id':str(task_id)})
    db.add(message)
    await db.commit()
    return {'status':'accepted','detail':'Applied at the next model or tool boundary. In-flight actions cannot be undone.'}
