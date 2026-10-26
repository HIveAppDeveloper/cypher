from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import IntegrityError
from typing import List
from uuid import UUID
from app.db.session import get_db
from app.models.conversation import Conversation, ConversationParticipant
from app.models.message import Message
from app.models.bot import Bot
from app.schemas.conversation import ConversationCreate, ConversationResponse
from app.schemas.message import MessageResponse
from app.services.team_limits import MAX_TEAM_AGENTS

router = APIRouter()

@router.post("", response_model=ConversationResponse)
async def create_conversation(conv: ConversationCreate, db: AsyncSession = Depends(get_db)):
    if not conv.bot_ids or (conv.is_group and len(conv.bot_ids) < 2) or len(set(conv.bot_ids)) != len(conv.bot_ids):
        raise HTTPException(status_code=422, detail=f"Select 1–{MAX_TEAM_AGENTS} unique agents, or at least two for a team room")
    requested = {str(bot_id) for bot_id in conv.bot_ids}
    # One tenant-scoped query also checks large rosters without 200 individual
    # lookups. Soft-deleted agents cannot join a new room.
    available = set((await db.execute(select(Bot.id).where(Bot.id.in_(requested), Bot.status != 'deleted'))).scalars())
    if available != requested:
        raise HTTPException(status_code=404, detail="Bot not found")
    db_conv = Conversation(title=conv.title, is_group=conv.is_group or len(requested) > 1)
    db.add(db_conv)
    await db.flush()
    for bot_id in conv.bot_ids:
        part = ConversationParticipant(conversation_id=db_conv.id, bot_id=str(bot_id))
        db.add(part)
    await db.commit()
    await db.refresh(db_conv)
    return {"id": db_conv.id, "title": db_conv.title, "is_group": db_conv.is_group, "created_at": db_conv.created_at, "updated_at": db_conv.updated_at, "bot_ids": conv.bot_ids}

@router.get("", response_model=List[ConversationResponse])
async def list_conversations(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Conversation).options(selectinload(Conversation.participants)))
    return [{"id": c.id, "title": c.title, "is_group": c.is_group, "created_at": c.created_at, "updated_at": c.updated_at, "bot_ids": [p.bot_id for p in c.participants]} for c in result.scalars().all()]

@router.get("/{id}")
async def get_conversation(id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Conversation).options(selectinload(Conversation.messages)).filter(Conversation.id == str(id))
    )
    conv = result.scalars().first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"conversation": conv, "messages": conv.messages[-50:]}

@router.post("/{id}/participants")
async def add_participant(id: UUID, bot_id: UUID, db: AsyncSession = Depends(get_db)):
    # Serialize additions on this room so two requests cannot both claim its
    # final available place. PostgreSQL holds this lock until commit.
    conversation = (await db.execute(select(Conversation).where(Conversation.id == str(id)).with_for_update())).scalar_one_or_none()
    bot = await db.get(Bot, str(bot_id))
    if conversation is None or bot is None or bot.status == 'deleted':
        raise HTTPException(status_code=404, detail="Conversation or bot not found")
    participants = (await db.execute(select(ConversationParticipant).where(ConversationParticipant.conversation_id == str(id)))).scalars().all()
    if any(part.bot_id == str(bot_id) for part in participants):
        raise HTTPException(status_code=409, detail="This agent is already in the conversation")
    if len(participants) >= MAX_TEAM_AGENTS:
        raise HTTPException(status_code=422, detail=f"A conversation can contain at most {MAX_TEAM_AGENTS} agents")
    part = ConversationParticipant(conversation_id=str(id), bot_id=str(bot_id))
    db.add(part)
    if participants:
        conversation.is_group = True
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="This agent is already in the conversation")
    return {"status": "added"}

@router.delete("/{id}/participants/{bot_id}")
async def remove_participant(id: UUID, bot_id: UUID, db: AsyncSession = Depends(get_db)):
    if await db.get(Conversation, str(id)) is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    result = await db.execute(select(ConversationParticipant).filter_by(conversation_id=str(id), bot_id=str(bot_id)))
    part = result.scalars().first()
    if part:
        await db.delete(part)
        await db.commit()
    return {"status": "removed"}
