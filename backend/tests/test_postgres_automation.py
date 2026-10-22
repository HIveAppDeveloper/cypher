"""Exercise scheduler selection and row locks on a disposable database."""
import asyncio
import os
from datetime import datetime,timedelta
from uuid import uuid4

import pytest
from sqlalchemy import select,text,func
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker

from app.db.session import Base
from app.db.tenancy import current_tenant_id
from app.models.bot import Bot
from app.models.conversation import Conversation,ConversationParticipant
from app.models.automation import Goal
from app.models.task import Task
from app.services.automation import tick_goals


@pytest.mark.asyncio
@pytest.mark.skipif(not os.getenv('GROKBOT_TEST_POSTGRES_URL'),reason='Requires disposable PostgreSQL')
async def test_scheduler_advances_other_workspaces_once_with_concurrent_ticks():
    schema='e2e_goal_selection_'+uuid4().hex
    engine=create_async_engine(os.environ['GROKBOT_TEST_POSTGRES_URL'],connect_args={'server_settings':{'search_path':schema}})
    sessions=async_sessionmaker(engine,expire_on_commit=False)
    due_ids=[];complete_id=None
    try:
        async with engine.begin() as conn:
            await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
            await conn.run_sync(Base.metadata.create_all)
        for owner in ('waiting-owner','due-owner'):
            context=current_tenant_id.set(owner)
            try:
                async with sessions() as db:
                    bot=Bot(name='Manager',role='Coordinator',system_prompt='Manage',llm_provider='openai',llm_model='gpt-6-luna',tools_enabled=[])
                    room=Conversation(title='Workspace',is_group=False)
                    db.add_all([bot,room]);await db.flush()
                    db.add(ConversationParticipant(conversation_id=room.id,bot_id=bot.id))
                    def goal(**values):
                        return Goal(conversation_id=room.id,title='Check',objective='Check',success_criteria='Checked',max_runs=2,**values)
                    if owner=='waiting-owner':
                        for i in range(10):
                            if i<5:
                                pending=Task(conversation_id=room.id,bot_id=bot.id,title='Waiting',description='Waiting',status='pending')
                                db.add(pending);await db.flush()
                                db.add(goal(runs=1,last_task_id=pending.id,next_run_at=datetime.utcnow()-timedelta(days=1)))
                            else:db.add(goal(next_run_at=datetime.utcnow()+timedelta(days=1)))
                    else:
                        for _ in range(2):
                            due=goal();db.add(due);await db.flush();due_ids.append(due.id)
                        previous=Task(conversation_id=room.id,bot_id=bot.id,title='Done',description='Done',status='completed')
                        db.add(previous);await db.flush()
                        complete=goal(runs=1,last_task_id=previous.id,completion_requested=True,next_run_at=datetime.utcnow()+timedelta(days=1))
                        db.add(complete);await db.flush();complete_id=complete.id
                    await db.commit()
            finally:current_tenant_id.reset(context)
        await asyncio.gather(tick_goals(sessions),tick_goals(sessions))
        async with sessions() as db:
            for gid in due_ids:
                goal=await db.get(Goal,gid)
                assert goal.runs==1 and goal.last_task_id
                assert (await db.get(Task,goal.last_task_id)).tenant_id=='due-owner'
            assert (await db.get(Goal,complete_id)).status=='completed'
            assert await db.scalar(select(func.count()).select_from(Task).where(Task.tenant_id=='due-owner',Task.status=='pending'))==2
    finally:
        async with engine.begin() as conn:await conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        await engine.dispose()
