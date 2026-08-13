from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from typing import List
from uuid import UUID
from app.db.session import get_db
from app.models.bot import Bot
from app.schemas.bot import BotCreate, BotUpdate, BotResponse
from app.services.sandbox import SandboxManager

router = APIRouter()

@router.post("", response_model=BotResponse)
async def create_bot(bot: BotCreate, db: AsyncSession = Depends(get_db)):
    db_bot = Bot(**bot.model_dump())
    db.add(db_bot)
    await db.commit()
    await db.refresh(db_bot)
    return db_bot

@router.get("", response_model=List[BotResponse])
async def list_bots(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Bot))
    return result.scalars().all()

@router.get("/{bot_id}", response_model=BotResponse)
async def get_bot(bot_id: UUID, db: AsyncSession = Depends(get_db)):
    bot = await db.get(Bot, bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
    return bot

@router.put("/{bot_id}", response_model=BotResponse)
async def update_bot(bot_id: UUID, bot_update: BotUpdate, db: AsyncSession = Depends(get_db)):
    bot = await db.get(Bot, bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
    for key, value in bot_update.model_dump(exclude_unset=True).items():
        setattr(bot, key, value)
    await db.commit()
    await db.refresh(bot)
    return bot

@router.delete("/{bot_id}")
async def delete_bot(bot_id: UUID, db: AsyncSession = Depends(get_db)):
    bot = await db.get(Bot, bot_id)
    if bot:
        await db.delete(bot)
        await db.commit()
    return {"status": "deleted"}

@router.post("/{bot_id}/start")
async def start_bot(bot_id: UUID, db: AsyncSession = Depends(get_db)):
    bot = await db.get(Bot, bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
    container_id = SandboxManager.create_sandbox(str(bot.id))
    bot.container_id = container_id
    bot.status = "idle"
    await db.commit()
    return {"status": "started", "container_id": container_id}

@router.post("/{bot_id}/stop")
async def stop_bot(bot_id: UUID, db: AsyncSession = Depends(get_db)):
    bot = await db.get(Bot, bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
    SandboxManager.stop_sandbox(str(bot.id))
    bot.container_id = None
    bot.status = "offline"
    await db.commit()
    return {"status": "stopped"}
