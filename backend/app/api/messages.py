from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List
from uuid import UUID
from app.db.session import get_db
from app.models.message import Message
from app.schemas.message import MessageCreate, MessageResponse
import asyncio

router = APIRouter()

@router.post("/{id}/messages")
async def send_message(id: UUID, msg: MessageCreate, db: AsyncSession = Depends(get_db)):
    from app.services.orchestrator import AgentOrchestrator
    # Trigger orchestrator in background
    orchestrator = AgentOrchestrator()
    asyncio.create_task(orchestrator.process_message(str(id), msg.content))
    
    return {"status": "processing"}

@router.get("/{id}/messages", response_model=List[MessageResponse])
async def list_messages(id: UUID, limit: int = 50, offset: int = 0, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Message)
        .filter(Message.conversation_id == id)
        .order_by(Message.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    return result.scalars().all()
