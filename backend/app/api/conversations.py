from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from typing import List
from uuid import UUID
from app.db.session import get_db
from app.models.conversation import Conversation, ConversationParticipant
from app.models.message import Message
from app.schemas.conversation import ConversationCreate, ConversationResponse
from app.schemas.message import MessageResponse

router = APIRouter()

@router.post("", response_model=ConversationResponse)
async def create_conversation(conv: ConversationCreate, db: AsyncSession = Depends(get_db)):
    db_conv = Conversation(title=conv.title, is_group=conv.is_group)
    db.add(db_conv)
    await db.flush()
    for bot_id in conv.bot_ids:
        part = ConversationParticipant(conversation_id=db_conv.id, bot_id=bot_id)
        db.add(part)
    await db.commit()
    await db.refresh(db_conv)
    return db_conv

@router.get("", response_model=List[ConversationResponse])
async def list_conversations(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Conversation))
    return result.scalars().all()

@router.get("/{id}")
async def get_conversation(id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Conversation).options(selectinload(Conversation.messages)).filter(Conversation.id == id)
    )
    conv = result.scalars().first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"conversation": conv, "messages": conv.messages[-50:]}

@router.post("/{id}/participants")
async def add_participant(id: UUID, bot_id: UUID, db: AsyncSession = Depends(get_db)):
    part = ConversationParticipant(conversation_id=id, bot_id=bot_id)
    db.add(part)
    await db.commit()
    return {"status": "added"}

@router.delete("/{id}/participants/{bot_id}")
async def remove_participant(id: UUID, bot_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ConversationParticipant).filter_by(conversation_id=id, bot_id=bot_id))
    part = result.scalars().first()
    if part:
        await db.delete(part)
        await db.commit()
    return {"status": "removed"}
