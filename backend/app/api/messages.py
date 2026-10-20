from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID
from app.db.session import get_db
from app.models.message import Message
from app.models.task import Task
from app.models.conversation import ConversationParticipant
from app.schemas.message import MessageCreate, MessageResponse

router = APIRouter()

@router.post("/{id}/messages", status_code=202)
async def send_message(id: UUID, msg: MessageCreate, db: AsyncSession = Depends(get_db)):
    if not msg.content.strip():
        raise HTTPException(status_code=422, detail="Message cannot be empty")
    participant = (await db.execute(select(ConversationParticipant).where(ConversationParticipant.conversation_id == str(id)).limit(1))).scalar_one_or_none()
    if participant is None:
        raise HTTPException(status_code=404, detail="Conversation or bot not found")
    task = Task(conversation_id=str(id), bot_id=participant.bot_id, title=msg.content[:100], description=msg.content, status="pending")
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return {"status": "queued", "task_id": task.id}

@router.get("/{id}/messages", response_model=list[MessageResponse])
async def list_messages(id: UUID, limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Message).where(Message.conversation_id == str(id)).order_by(Message.created_at.desc()).offset(offset).limit(limit))
    return result.scalars().all()

@router.get("/{id}/tasks")
async def list_tasks(id: UUID, db: AsyncSession = Depends(get_db)):
    tasks = (await db.execute(select(Task).where(Task.conversation_id == str(id)).order_by(Task.created_at.desc()).limit(25))).scalars().all()
    return [{"id": t.id, "title": t.title, "status": t.status, "created_at": t.created_at} for t in tasks]
