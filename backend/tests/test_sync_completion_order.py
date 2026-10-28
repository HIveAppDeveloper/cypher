"""A worker completion between the sync endpoint's reads cannot lose its reply."""
from datetime import datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import messages as api
from app.db.session import Base
from app.db.tenancy import current_tenant_id
from app.main import app  # Register the actual model graph, without startup/lifespan.
from app.models.bot import Bot
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.task import Task


@pytest.mark.asyncio
async def test_sync_does_not_observe_completion_newer_than_its_message_snapshot(tmp_path):
    engine = create_async_engine(f'sqlite+aiosqlite:///{tmp_path}/sync-order.sqlite')
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    tenant = current_tenant_id.set('synthetic-voice-sync-owner')
    cid, bid, tid, incoming, reply = (str(uuid4()) for _ in range(5))
    now = datetime(2026, 10, 27, 12)
    committed_between_reads = False
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with sessions() as db:
            db.add_all([
                Bot(id=bid, name='Sync agent', role='Assistant', system_prompt='Synthetic fixture.',
                    llm_provider='openai', llm_model='fixture', tools_enabled=['none']),
                Conversation(id=cid, title='Synthetic voice sync', is_group=False),
                Task(id=tid, conversation_id=cid, bot_id=bid, title='Voice fixture',
                     description='No inference', status='running', created_at=now),
                Message(id=incoming, conversation_id=cid, sender_type='user', content='Synthetic voice input',
                        message_type='text', created_at=now, metadata_json={'task_id': tid}),
            ])
            await db.commit()

        async with sessions() as reader:
            execute = reader.execute

            async def interleave(statement, *args, **kwargs):
                nonlocal committed_between_reads
                result = await execute(statement, *args, **kwargs)
                columns = getattr(statement, 'column_descriptions', [])
                # Interleave after the real, buffered Message row query, not the
                # cursor lookup. The reader result remains the old snapshot.
                if not committed_between_reads and columns and columns[0].get('expr') is Message:
                    committed_between_reads = True
                    async with sessions() as writer:
                        task = await writer.get(Task, tid)
                        task.status = 'completed'
                        writer.add(Message(id=reply, conversation_id=cid, sender_type='bot', sender_bot_id=bid,
                                           content='The final spoken answer.', message_type='text',
                                           created_at=now + timedelta(seconds=1), metadata_json={'task_id': tid}))
                        await writer.commit()
                return result

            reader.execute = interleave
            snapshot = await api.sync_conversation(UUID(cid), after_id=UUID(incoming), db=reader)
            assert committed_between_reads
            final_present = any(str(item['id']) == reply for item in snapshot['messages'])
            completed = next(item for item in snapshot['tasks'] if item['id'] == tid)['status'] == 'completed'
            assert not completed or final_present, 'Sync advertised completed after reading a snapshot that omitted its committed reply'

        async with sessions() as db:
            settled = await api.sync_conversation(UUID(cid), after_id=UUID(incoming), db=db)
            assert settled['tasks'][0]['status'] == 'completed'
            assert [str(item['id']) for item in settled['messages']] == [reply]
    finally:
        current_tenant_id.reset(tenant)
        await engine.dispose()
