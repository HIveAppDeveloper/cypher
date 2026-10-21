import asyncio
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from sqlalchemy.future import select
from sqlalchemy import delete,update,func
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
    result = await db.execute(select(Bot).where(Bot.status!='deleted'))
    return result.scalars().all()

@router.get("/{bot_id}", response_model=BotResponse)
async def get_bot(bot_id: UUID, db: AsyncSession = Depends(get_db)):
    bot = await db.get(Bot, str(bot_id))
    if not bot or bot.status=='deleted':
        raise HTTPException(status_code=404, detail="Bot not found")
    return bot

@router.put("/{bot_id}", response_model=BotResponse)
async def update_bot(bot_id: UUID, bot_update: BotUpdate, db: AsyncSession = Depends(get_db)):
    bot = await db.get(Bot, str(bot_id))
    if not bot or bot.status=='deleted':
        raise HTTPException(status_code=404, detail="Bot not found")
    for key, value in bot_update.model_dump(exclude_unset=True).items():
        setattr(bot, key, value)
    try:await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409,'That agent name is already in use.')
    await db.refresh(bot)
    return bot

@router.delete("/{bot_id}")
async def delete_bot(bot_id: UUID, db: AsyncSession = Depends(get_db)):
    bot = (await db.execute(select(Bot).where(Bot.id==str(bot_id)).with_for_update())).scalar_one_or_none()
    if bot and bot.status!='deleted':
        from app.models.task import Task
        from app.models.conversation import ConversationParticipant
        from app.models.context import BrowserSession
        from app.models.workspace import Knowledge,ComputerControl,ComputerCommand,Routine
        from app.models.automation import Goal,Channel
        active=await db.scalar(select(func.count()).select_from(Task).where(Task.bot_id==bot.id,Task.status.in_(['pending','running','cancel_requested','waiting_approval'])))
        manual=await db.scalar(select(func.count()).select_from(ComputerCommand).where(ComputerCommand.bot_id==bot.id,ComputerCommand.status.in_(['pending','running'])))
        if active or manual:raise HTTPException(409,'Stop this agent’s active work before deleting it.')
        try:await asyncio.wait_for(asyncio.to_thread(SandboxManager.stop_sandbox,bot.id),30)
        except Exception:raise HTTPException(503,'The agent computer could not stop. Retry deletion shortly.')
        rooms=list((await db.execute(select(ConversationParticipant.conversation_id).where(ConversationParticipant.bot_id==bot.id))).scalars())
        await db.execute(delete(ConversationParticipant).where(ConversationParticipant.bot_id==bot.id))
        for cid in rooms:
            remaining=await db.scalar(select(func.count()).select_from(ConversationParticipant).where(ConversationParticipant.conversation_id==cid))
            if not remaining:
                await db.execute(update(Routine).where(Routine.conversation_id==cid).values(enabled=False,next_run_at=None))
                await db.execute(update(Goal).where(Goal.conversation_id==cid,Goal.status=='active').values(status='paused',next_run_at=None))
                await db.execute(update(Channel).where(Channel.conversation_id==cid).values(enabled=False))
        for model in (BrowserSession,ComputerControl,ComputerCommand):
            await db.execute(delete(model).where(model.bot_id==bot.id))
        await db.execute(delete(Knowledge).where(Knowledge.scope=='bot:'+bot.id))
        # Historical tasks/messages keep their foreign keys. Remove the active
        # identity and private configuration while preserving the execution record.
        bot.name='deleted-'+bot.id;bot.status='deleted';bot.system_prompt='';bot.description=None;bot.avatar_url=None;bot.tools_enabled=['none'];bot.container_id=None
        await db.commit()
    return {"status": "deleted"}

@router.post("/{bot_id}/start")
async def start_bot(bot_id: UUID, db: AsyncSession = Depends(get_db)):
    bot = await db.get(Bot, str(bot_id))
    if not bot or bot.status=='deleted':
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
    if not bot or bot.status=='deleted':
        raise HTTPException(status_code=404, detail="Bot not found")
    try:
        await asyncio.to_thread(SandboxManager.stop_sandbox, str(bot.id))
    except Exception:
        raise HTTPException(503,'The computer could not stop. Retry shortly or check the sandbox connection.')
    bot.container_id = None
    bot.status = "offline"
    await db.commit()
    return {"status": "stopped"}
