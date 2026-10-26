import asyncio
import os
from datetime import datetime, timedelta
from decimal import Decimal
from uuid import uuid4
import pytest
import pytest_asyncio
from sqlalchemy import func, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.db.session import Base
from app.db.tenancy import current_tenant_id
from app.models.apple_messages import AppleLinkChallenge, AppleOutbox, AppleThread
from app.models.bot import Bot
from app.models.conversation import Conversation, ConversationParticipant
from app.models.task import Task
from app.models.workspace import Notification
from app.services import apple_messages as service
from app.config import settings

@pytest_asyncio.fixture
async def workspace(tmp_path, monkeypatch):
    test_url = os.getenv('CYPHER_APPLE_TEST_POSTGRES_URL')
    if test_url and make_url(test_url).database != 'cypher_apple_msp_test':
        pytest.fail('Apple-core PostgreSQL tests require the dedicated disposable test database.')
    schema = 'e2e_apple_' + uuid4().hex if test_url else None
    engine = create_async_engine(test_url, connect_args={'server_settings': {'search_path': schema}}) if test_url else create_async_engine(f'sqlite+aiosqlite:///{tmp_path}/apple.db')
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as c:
        if schema: await c.execute(text(f'CREATE SCHEMA "{schema}"'))
        await c.run_sync(Base.metadata.create_all)
    monkeypatch.setattr(settings, 'SECRET_KEY', 'isolated-apple-test-key-longer-than-thirty-two-characters')
    rooms = {}
    for owner in ['owner-a', 'owner-b']:
        with service.tenant_scope(owner):
            async with sessions() as db:
                bot = Bot(name='Manager', role='Assistant', system_prompt='Assist', llm_provider='openai', llm_model='gpt-6.1-sol', tools_enabled=[])
                room = Conversation(title='Private workspace'); db.add_all([bot, room]); await db.flush()
                db.add(ConversationParticipant(conversation_id=room.id, bot_id=bot.id)); await db.commit(); rooms[owner] = room.id
    try:
        yield sessions, rooms
    finally:
        if schema:
            async with engine.begin() as c: await c.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await engine.dispose()

async def linked(sessions, rooms, owner='owner-a', opaque='opaque-a', updates=False):
    with service.tenant_scope(owner):
        async with sessions() as db:
            code = await service.create_link_challenge(db, rooms[owner], updates_opt_in=updates); await db.commit()
    # A FUTURE Apple-authenticated transport call, never an unverified HTTP endpoint.
    with service.tenant_scope(None):
        async with sessions() as db:
            thread = await service.link_verified_customer(db, code=code, business_id='business-id', opaque_id=opaque)
            await db.commit(); return thread.id, code

async def incoming(sessions, body, event=None, opaque='opaque-a', ended=False):
    with service.tenant_scope(None):
        async with sessions() as db:
            result = await service.accept_verified_event(db, business_id='business-id', opaque_id=opaque,
                event_id=event or str(uuid4()), body=body, ended=ended)
            await db.commit(); return result

@pytest.mark.asyncio
async def test_link_is_expiring_one_use_scoped_and_identity_is_encrypted(workspace):
    sessions, rooms = workspace
    with service.tenant_scope('owner-a'):
        async with sessions() as db:
            with pytest.raises(ValueError, match='existing workspace'): await service.create_link_challenge(db, rooms['owner-b'])
    thread_id, code = await linked(sessions, rooms)
    with service.tenant_scope(None):
        async with sessions() as db:
            thread = await db.get(AppleThread, thread_id)
            assert thread.tenant_id == 'owner-a' and thread.sealed_opaque_id != 'opaque-a'
            from app.services.plugins import reveal
            assert reveal(thread.sealed_opaque_id) == 'opaque-a'
            with pytest.raises(ValueError, match='invalid or expired'):
                await service.link_verified_customer(db, code=code, business_id='business-id', opaque_id='opaque-a')
    with service.tenant_scope('owner-a'):
        async with sessions() as db:
            expired = await service.create_link_challenge(db, rooms['owner-a'])
            challenge = await db.get(AppleLinkChallenge, service._hash(expired)); challenge.expires_at = datetime.utcnow()-timedelta(seconds=1); await db.commit()
            with pytest.raises(ValueError, match='invalid or expired'):
                await service.link_verified_customer(db, code=expired, business_id='business-id', opaque_id='opaque-new')

@pytest.mark.asyncio
async def test_other_tenant_cannot_take_existing_apple_identity_or_reply(workspace):
    sessions, rooms = workspace; thread_id, _ = await linked(sessions, rooms)
    with service.tenant_scope('owner-b'):
        async with sessions() as db:
            code = await service.create_link_challenge(db, rooms['owner-b']); await db.commit()
            with pytest.raises(ValueError, match='already linked'):
                await service.link_verified_customer(db, code=code, business_id='business-id', opaque_id='opaque-a')
            with pytest.raises(ValueError, match='unavailable'):
                await service.queue_human_reply(db, thread_id, body='Foreign reply', client_message_id='foreign')
            with pytest.raises(ValueError, match='not found'): await service.unlink(db, thread_id)

@pytest.mark.asyncio
async def test_inbound_retry_creates_one_task_and_preserves_tenant_context(workspace):
    sessions, rooms = workspace; await linked(sessions, rooms)
    token = current_tenant_id.set('owner-b')
    try:
        result = await incoming(sessions, 'Research this company', event='stable-event'); assert current_tenant_id.get() == 'owner-b'
        again = await incoming(sessions, 'Research this company', event='stable-event')
        assert result['task_id'] == again['task_id'] and again['duplicate']
        with pytest.raises(ValueError, match='already used'): await incoming(sessions, 'Different request', event='stable-event')
    finally: current_tenant_id.reset(token)
    with service.tenant_scope('owner-a'):
        async with sessions() as db:
            assert await db.scalar(select(func.count()).select_from(Task)) == 1
            task = await db.get(Task, result['task_id'])
            assert task.tenant_id == 'owner-a' and task.conversation_id == rooms['owner-a']
            assert task.result['request']['options']['max_iterations'] == 8

@pytest.mark.asyncio
async def test_stop_and_end_suppress_outputs_and_require_new_owner_link(workspace):
    sessions, rooms = workspace; thread_id, _ = await linked(sessions, rooms, updates=True)
    assert (await incoming(sessions, 'STOP'))['disposition'] == 'opted_out'
    assert (await incoming(sessions, 'Another task'))['disposition'] == 'ignored'
    with service.tenant_scope('owner-a'):
        async with sessions() as db:
            assert (await db.get(AppleThread, thread_id)).updates_opt_in is False
            assert set((await db.scalars(select(AppleOutbox.status))).all()) == {'suppressed'}
    await linked(sessions, rooms)
    assert (await incoming(sessions, '', ended=True))['disposition'] == 'closed'
    assert (await incoming(sessions, 'Hi again'))['disposition'] == 'ignored'

@pytest.mark.asyncio
async def test_human_handoff_pauses_bot_and_preserves_consecutive_operator_replies(workspace):
    sessions, rooms = workspace; thread_id, _ = await linked(sessions, rooms)
    assert (await incoming(sessions, 'agent', event='ask-human'))['disposition'] == 'human_requested'
    assert (await incoming(sessions, 'I need more help'))['disposition'] == 'human'
    with service.tenant_scope('owner-a'):
        async with sessions() as db:
            assert await db.scalar(select(func.count()).select_from(Task)) == 0
            assert await db.scalar(select(func.count()).select_from(Notification)) == 1
            first = await service.queue_human_reply(db, thread_id, body='Hello from a person.', client_message_id='reply-1')
            second = await service.queue_human_reply(db, thread_id, body='How can I help?', client_message_id='reply-2')
            repeat = await service.queue_human_reply(db, thread_id, body='Hello from a person.', client_message_id='reply-1')
            assert repeat.id == first.id and first.status == second.status == 'pending'; await db.commit()

@pytest.mark.asyncio
async def test_updates_require_optin_and_never_leak_internal_content(workspace):
    sessions, rooms = workspace
    await linked(sessions, rooms, updates=False); await linked(sessions, rooms, opaque='opaque-second', updates=True)
    with service.tenant_scope('owner-a'):
        async with sessions() as db:
            bot = await db.scalar(select(Bot.id))
            task = Task(id=str(uuid4()), conversation_id=rooms['owner-a'], bot_id=bot, title='Finished work', description='Work', status='completed', result={'responses':[
                {'sender_type':'bot','content':'Private chain','metadata':{'internal':True}},
                {'sender_type':'user','content':'User request'}, {'sender_type':'bot','content':'Verified public answer'}]})
            db.add(task); await db.flush(); await service.queue_task_result(db, task); await service.queue_task_result(db, task)
            rows = (await db.scalars(select(AppleOutbox).where(AppleOutbox.source_id == 'update:'+task.id))).all()
            assert len(rows) == 1 and 'Verified public answer' in rows[0].body
            assert 'Private chain' not in rows[0].body and 'User request' not in rows[0].body
            assert rows[0].reported_cost is None and rows[0].currency is None; await db.commit()

@pytest.mark.asyncio
async def test_dispatch_disabled_by_default_and_uncertain_sends_are_not_retried(workspace):
    sessions, rooms = workspace; await linked(sessions, rooms)
    with service.tenant_scope(None):
        async with sessions() as db:
            assert await service.claim_outbound(db) is None
            row = await service.claim_outbound(db, apple_transport_approved=True)
            assert row.status == 'sending'; message_id, owner = row.id, row.tenant_id; await db.commit()
        async with sessions() as db: assert await service.claim_outbound(db, apple_transport_approved=True) is None
    with service.tenant_scope(owner):
        async with sessions() as db:
            await service.settle_outbound(db, message_id); await db.commit()
            assert (await db.get(AppleOutbox, message_id)).status == 'uncertain'
            assert await service.claim_outbound(db, apple_transport_approved=True) is None
            await service.settle_outbound(db, message_id, provider_reference='verified-delivery'); await db.commit()
            assert (await db.get(AppleOutbox, message_id)).status == 'sent'

@pytest.mark.asyncio
async def test_reported_cost_exact_idempotent_and_separate_from_unknown(workspace):
    sessions, rooms = workspace; await linked(sessions, rooms)
    with service.tenant_scope('owner-a'):
        async with sessions() as db:
            row = await service.claim_outbound(db, apple_transport_approved=True); await db.commit()
            await service.settle_outbound(db, row.id, provider_reference='receipt'); await db.commit(); assert row.reported_cost is None
            await service.settle_outbound(db, row.id, provider_reference='receipt', cost='0.0125', currency='USD'); await db.commit()
            await service.settle_outbound(db, row.id, provider_reference='receipt', cost='0.0125', currency='USD'); assert row.reported_cost == Decimal('0.0125')
            with pytest.raises(ValueError, match='different provider cost'):
                await service.settle_outbound(db, row.id, provider_reference='receipt', cost='0.1', currency='USD')
            with pytest.raises(ValueError, match='finite'):
                await service.settle_outbound(db, row.id, provider_reference='receipt', cost='NaN', currency='USD')
            with pytest.raises(ValueError, match='Currency requires'):
                await service.settle_outbound(db, row.id, provider_reference='receipt', currency='USD')

@pytest.mark.asyncio
async def test_link_requires_explicit_update_consent_and_unknown_identity_cannot_queue(workspace):
    sessions, rooms = workspace
    with service.tenant_scope('owner-a'):
        async with sessions() as db:
            with pytest.raises(ValueError, match='explicit'):
                await service.create_link_challenge(db, rooms['owner-a'], updates_opt_in='false')
    with pytest.raises(ValueError, match='Link this Apple conversation'):
        await incoming(sessions, 'Unlinked request', opaque='unknown-customer')

@pytest.mark.asyncio
async def test_rate_limit_bounds_tasks_and_rolls_back_rejected_event(workspace):
    sessions, rooms = workspace; await linked(sessions, rooms)
    accepted = 0
    for i in range(15):
        try:
            await incoming(sessions, 'Bounded task '+str(i), event='limit-'+str(i)); accepted += 1
        except ValueError as error:
            assert 'queue is full' in str(error)
    with service.tenant_scope('owner-a'):
        async with sessions() as db:
            count = await db.scalar(select(func.count()).select_from(Task))
            assert count == accepted == 10

@pytest.mark.asyncio
async def test_explicit_unlink_releases_identity_without_moving_old_history(workspace):
    sessions, rooms = workspace; old_id, _ = await linked(sessions, rooms)
    first = await incoming(sessions, 'Private previous task')
    with service.tenant_scope('owner-a'):
        async with sessions() as db:
            await service.unlink(db, old_id); await db.commit()
            old = await db.get(AppleThread, old_id)
            assert old.state == 'closed' and not old.sealed_opaque_id
    new_id, _ = await linked(sessions, rooms, owner='owner-b')
    assert new_id != old_id
    with service.tenant_scope('owner-b'):
        async with sessions() as db:
            assert await db.scalar(select(func.count()).select_from(Task)) == 0
            assert await db.scalar(select(Task.id).where(Task.id == first['task_id'])) is None
            assert (await db.get(AppleThread, new_id)).conversation_id == rooms['owner-b']


pg_only = pytest.mark.skipif(not os.getenv('CYPHER_APPLE_TEST_POSTGRES_URL'), reason='Requires disposable Apple-core PostgreSQL')


@pg_only
@pytest.mark.asyncio
async def test_concurrent_consent_withdrawal_and_task_update_cannot_leave_pending_update(workspace):
    sessions, rooms = workspace
    thread_id, _ = await linked(sessions, rooms, updates=True)
    with service.tenant_scope('owner-a'):
        async with sessions() as db:
            bot = await db.scalar(select(Bot.id))
            task = Task(id=str(uuid4()), conversation_id=rooms['owner-a'], bot_id=bot,
                title='Synthetic complete task', description='Synthetic', status='completed', result={})
            db.add(task)
            await db.commit()
            task_id = task.id
    async def withdraw():
        with service.tenant_scope('owner-a'):
            async with sessions() as db:
                await service.set_updates_opt_in(db, thread_id, False)
                await db.commit()
    async def queue_result():
        with service.tenant_scope('owner-a'):
            async with sessions() as db:
                await service.queue_task_result(db, await db.get(Task, task_id))
                await db.commit()
    await asyncio.wait_for(asyncio.gather(withdraw(), queue_result()), timeout=10)
    with service.tenant_scope('owner-a'):
        async with sessions() as db:
            assert (await db.get(AppleThread, thread_id)).updates_opt_in is False
            states = (await db.scalars(select(AppleOutbox.status).where(
                AppleOutbox.thread_id == thread_id, AppleOutbox.source_id == 'update:'+task_id))).all()
            assert set(states) <= {'suppressed'}

@pytest.mark.asyncio
@pg_only
async def test_concurrent_native_replays_queue_exactly_one_task_on_postgres(workspace):
    sessions, rooms = workspace; await linked(sessions, rooms)
    results = await asyncio.gather(incoming(sessions, 'Concurrent task', event='pg-replay'), incoming(sessions, 'Concurrent task', event='pg-replay'), return_exceptions=True)
    assert all(isinstance(result, dict) for result in results), results
    assert results[0]['task_id'] == results[1]['task_id']
    assert sum(bool(r['duplicate']) for r in results) == 1
    with service.tenant_scope('owner-a'):
        async with sessions() as db: assert await db.scalar(select(func.count()).select_from(Task)) == 1

@pytest.mark.asyncio
@pg_only
async def test_concurrent_dispatch_claims_once_and_optout_cannot_requeue_it(workspace):
    sessions, rooms = workspace; await linked(sessions, rooms)
    async def claim():
        with service.tenant_scope(None):
            async with sessions() as db:
                row = await service.claim_outbound(db, apple_transport_approved=True)
                await db.commit(); return row.id if row else None
    claims = await asyncio.gather(claim(), claim())
    assert sum(value is not None for value in claims) == 1
    await incoming(sessions, 'STOP')
    assert await claim() is None
    with service.tenant_scope('owner-a'):
        async with sessions() as db:
            rows = (await db.scalars(select(AppleOutbox))).all()
            assert len(rows) == 1 and rows[0].status == 'sending'

@pytest.mark.asyncio
@pg_only
async def test_concurrent_cross_tenant_identity_links_cannot_take_over_history(workspace):
    sessions, rooms = workspace
    codes = []
    for owner in ['owner-a','owner-b']:
        with service.tenant_scope(owner):
            async with sessions() as db:
                code = await service.create_link_challenge(db, rooms[owner]); await db.commit(); codes.append(code)
    async def link(code):
        with service.tenant_scope(None):
            async with sessions() as db:
                thread = await service.link_verified_customer(db, code=code, business_id='business-id', opaque_id='same-opaque')
                await db.commit(); return thread.tenant_id
    results = await asyncio.gather(*(link(code) for code in codes), return_exceptions=True)
    assert sum(isinstance(result, str) for result in results) == 1
    assert sum(isinstance(result, ValueError) for result in results) == 1
    with service.tenant_scope(None):
        async with sessions() as db: assert await db.scalar(select(func.count()).select_from(AppleThread)) == 1
