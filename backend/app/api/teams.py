"""Create a usable specialist team and its shared conversation in one action."""
from fastapi import APIRouter, Depends
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.models.bot import Bot
from app.models.conversation import Conversation, ConversationParticipant
router = APIRouter()
TEAM = [
 ('Coordinator','Coordinator','openai','gpt-6.1-sol','Lead the team. Understand the task, delegate specific work to specialists, and synthesize their real findings into a clear final answer. OpenAI handles the main conversation. Make decisions autonomously. Never invent completed actions.'),
 ('Builder','Developer','openai','gpt-6.1-sol','Implement complete working software and workflows. Use shell, browser, file, and connected plugin tools. Test what you build. Share concrete results with teammates.'),
 ('Researcher','Researcher','gemini','gemini-3.5-flash','Research and examine multimodal inputs. Check primary sources with browser tools and share evidence with the team. State uncertainty and source URLs.'),
 ('Writer','Writer','anthropic','claude-sonnet-4.6','Turn the team’s facts into polished, concise writing. Challenge weak claims and deliver finished copy. Use actual source evidence.'),
 ('Reviewer','Reviewer','openai','gpt-6.1-sol','Check the team’s work for correctness, missing requirements, broken code, and unsupported claims. Use tools to verify. Report concrete fixes.'),
 ('Runner','Operations','openai','gpt-6-luna','Handle smaller execution tasks efficiently with available tools. Share concise results, errors, and evidence. Never claim success without a tool result.'),
]
@router.post('/default')
async def default_team(db: AsyncSession = Depends(get_db)):
    if db.bind.dialect.name == 'postgresql':
        await db.execute(text('SELECT pg_advisory_xact_lock(1763000273)'))
    existing = (await db.execute(select(Conversation).options(selectinload(Conversation.participants)).where(Conversation.title == 'Agent lounge', Conversation.is_group == True))).scalars().first()
    if existing:
        return {'id':existing.id,'title':existing.title,'is_group':True,'bot_ids':[p.bot_id for p in existing.participants]}
    ids=[]
    for name,role,provider,model,prompt in TEAM:
        bot=(await db.execute(select(Bot).where(Bot.name==name))).scalar_one_or_none()
        if not bot:
            bot=Bot(name=name,role=role,llm_provider=provider,llm_model=model,system_prompt=prompt,description=role,tools_enabled=['browser','shell','filesystem','media','plugins'])
            db.add(bot); await db.flush()
        ids.append(bot.id)
    room=Conversation(title='Agent lounge',is_group=True)
    db.add(room); await db.flush()
    for id in ids: db.add(ConversationParticipant(conversation_id=room.id,bot_id=id))
    await db.commit()
    return {'id':room.id,'title':room.title,'is_group':True,'bot_ids':ids}
