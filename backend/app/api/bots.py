import asyncio
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
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
    data = bot.model_dump()
    name = data["name"].strip()
    if not name:
        base = data["role"].strip()[:60] or "Agent"
        existing = set((await db.execute(select(Bot.name).where(Bot.name.like(base + "%")))).scalars().all())
        name = base
        suffix = 2
        while name in existing:
            name = f"{base} {suffix}"
            suffix += 1
    data["name"] = name
    db_bot = Bot(**data)
    db.add(db_bot)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="That agent name is already in use. Choose another name or leave it blank.")
    await db.refresh(db_bot)
    return db_bot

@router.get("", response_model=List[BotResponse])
async def list_bots(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Bot))
    return result.scalars().all()

@router.get("/{bot_id}", response_model=BotResponse)
async def get_bot(bot_id: UUID, db: AsyncSession = Depends(get_db)):
    bot = await db.get(Bot, str(bot_id))
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
    return bot

@router.put("/{bot_id}", response_model=BotResponse)
async def update_bot(bot_id: UUID, bot_update: BotUpdate, db: AsyncSession = Depends(get_db)):
    bot = await db.get(Bot, str(bot_id))
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
    for key, value in bot_update.model_dump(exclude_unset=True).items():
        setattr(bot, key, value)
    await db.commit()
    await db.refresh(bot)
    return bot

@router.delete("/{bot_id}")
async def delete_bot(bot_id: UUID, db: AsyncSession = Depends(get_db)):
    bot = await db.get(Bot, str(bot_id))
    if bot:
        await db.delete(bot)
        await db.commit()
    return {"status": "deleted"}

@router.post("/{bot_id}/start")
async def start_bot(bot_id: UUID, db: AsyncSession = Depends(get_db)):
    bot = await db.get(Bot, str(bot_id))
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
    container_id = await asyncio.to_thread(SandboxManager.create_sandbox, str(bot.id))
    if not container_id:
        raise HTTPException(status_code=503, detail="Computer could not start; check the sandbox configuration and private logs")
    bot.container_id = container_id
    bot.status = "idle"
    await db.commit()
    return {"status": "started", "container_id": container_id}

@router.post("/{bot_id}/stop")
async def stop_bot(bot_id: UUID, db: AsyncSession = Depends(get_db)):
    bot = await db.get(Bot, str(bot_id))
    if not bot:
        raise HTTPException(status_code=404, detail="Bot not found")
    await asyncio.to_thread(SandboxManager.stop_sandbox, str(bot.id))
    bot.container_id = None
    bot.status = "offline"
    await db.commit()
    return {"status": "stopped"}
