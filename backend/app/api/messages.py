from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_
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
        if existing.conversation_id != str(id) or existing.sender_type != 'user' or existing.content != msg.content or (existing.metadata_json or {}).get('attachments', []) != files:
            raise HTTPException(status_code=409, detail="Message identifier already used. Send a new message.")
        previous_task = (existing.metadata_json or {}).get('task_id')
        if previous_task:
            return {'status':'queued','task_id':previous_task,'message_id':incoming_id}
        raise HTTPException(status_code=409, detail="Message identifier already used.")
    task = Task(id=str(uuid4()),conversation_id=str(id), bot_id=participant.bot_id, title=msg.content[:100], description=msg.content or "Review the attached files.", status="pending", result={"request": {"incoming_message_id":incoming_id,"attachments": files, "options": msg.options.model_dump()}})
    db.add(task)
    db.add(Message(id=incoming_id,conversation_id=str(id),sender_type='user',content=msg.content,message_type='text',metadata_json={'attachments':files,'task_id':task.id}))
    await db.commit()
    await db.refresh(task)
    return {"status": "queued", "task_id": task.id, "message_id": incoming_id}

@router.get("/{id}/messages", response_model=list[MessageResponse])
async def list_messages(id: UUID, limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0), before_id: UUID | None = None, db: AsyncSession = Depends(get_db)):
    query = select(Message).where(Message.conversation_id == str(id))
    if before_id:
        pivot = await db.get(Message, str(before_id))
        if pivot is None or pivot.conversation_id != str(id):
            raise HTTPException(status_code=404, detail='Message cursor not found')
        query = query.where(or_(Message.created_at < pivot.created_at, and_(Message.created_at == pivot.created_at, Message.id < str(before_id))))
    result = await db.execute(query.order_by(Message.created_at.desc(), Message.id.desc()).offset(offset).limit(limit))
    messages = result.scalars().all()
    output = []
    for message in messages:
        item = MessageResponse.model_validate(message).model_dump()
        meta = dict(message.metadata_json or {})
        if 'attachments' in meta:
            meta['attachments'] = [{'name': a['name'], 'mime': a['mime'], 'url': f'/api/conversations/{id}/attachments/{message.id}/{index}'} for index, a in enumerate(meta['attachments'])]
        item['metadata_json'] = meta
        output.append(item)
    return output

@router.get("/{id}/tasks")
async def list_tasks(id: UUID, db: AsyncSession = Depends(get_db)):
    tasks = (await db.execute(select(Task).where(Task.conversation_id == str(id)).order_by(Task.created_at.desc()).limit(25))).scalars().all()
    return [{"id": t.id, "title": t.title, "status": t.status, "created_at": t.created_at} for t in tasks]

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
