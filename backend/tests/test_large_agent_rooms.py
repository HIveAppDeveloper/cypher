"""Real isolated SQL/API checks for large, tenant-owned agent rosters."""
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import settings
from app.db.session import Base, get_db
from app.db.tenancy import current_tenant_id
from app.main import app
from app.models.bot import Bot
from app.models.conversation import ConversationParticipant

OWNER = 'large-room-owner'


@pytest_asyncio.fixture
async def workspace(tmp_path, monkeypatch):
    engine = create_async_engine(f'sqlite+aiosqlite:///{tmp_path}/rooms.db')
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    bots = [str(uuid4()) for _ in range(201)]
    foreign, deleted = str(uuid4()), str(uuid4())
    owner_context = current_tenant_id.set(OWNER)
    async with sessions() as db:
        for index, bot_id in enumerate(bots):
            db.add(Bot(id=bot_id, tenant_id=OWNER, name=f'Agent {index}', role=f'Specialist {index}',
                       system_prompt=f'Only perform assignment {index}.', llm_provider='openai',
                       llm_model='gpt-6.1-sol', tools_enabled=['browser']))
        for bot_id, tenant, status in [(deleted, OWNER, 'deleted')]:
            db.add(Bot(id=bot_id, tenant_id=tenant, name=bot_id, role='Private', system_prompt='Private instructions',
                       llm_provider='openai', llm_model='gpt-6.1-sol', tools_enabled=[], status=status))
        await db.commit()
        other_context = current_tenant_id.set('other-owner')
        try:
            db.add(Bot(id=foreign, tenant_id='other-owner', name=foreign, role='Private',
                       system_prompt='Private instructions', llm_provider='openai',
                       llm_model='gpt-6.1-sol', tools_enabled=[], status='idle'))
            await db.commit()
        finally:
            current_tenant_id.reset(other_context)

    async def dependency():
        async with sessions() as db:
            yield db
    monkeypatch.setattr(settings, 'BACKEND_API_TOKEN', 'large-room-offline-token')
    monkeypatch.setattr(settings, 'REQUIRE_USER_AUTH', True)
    app.dependency_overrides[get_db] = dependency
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test',
                                    headers={'Authorization':'Bearer large-room-offline-token', 'x-grokbot-user-id':OWNER}) as client:
            yield client, sessions, engine, bots, foreign, deleted
    finally:
        app.dependency_overrides.pop(get_db, None)
        await engine.dispose()
        current_tenant_id.reset(owner_context)


@pytest.mark.asyncio
async def test_two_hundred_distinct_agents_keep_their_own_instructions(workspace):
    client, sessions, engine, bots, _, _ = workspace
    bot_reads = []
    def record(connection, cursor, statement, parameters, context, many):
        if 'FROM bots' in statement:
            bot_reads.append(statement)
    event.listen(engine.sync_engine, 'before_cursor_execute', record)
    try:
        response = await client.post('/api/conversations', json={'title':'Large team', 'is_group':True, 'bot_ids':bots[:200]})
    finally:
        event.remove(engine.sync_engine, 'before_cursor_execute', record)
    assert response.status_code == 200, response.text
    room = response.json()
    assert set(room['bot_ids']) == set(bots[:200])
    assert len(bot_reads) == 1, 'large teams must not require one bot lookup per member'
    async with sessions() as db:
        members = (await db.execute(select(ConversationParticipant.bot_id).where(ConversationParticipant.conversation_id==room['id']))).scalars().all()
        prompts = (await db.execute(select(Bot.system_prompt).where(Bot.id.in_(bots[:200])))).scalars().all()
    assert len(set(members)) == len(set(prompts)) == 200
    visible = (await client.get('/api/conversations')).json()
    assert next(item for item in visible if item['id']==room['id'])['is_group'] is True


@pytest.mark.asyncio
async def test_room_capacity_and_unique_owned_active_members_are_enforced(workspace):
    client, _, _, bots, foreign, deleted = workspace
    for ids in [bots, [bots[0], bots[0]], [], [bots[0]]]:
        assert (await client.post('/api/conversations', json={'title':'Invalid', 'is_group':True, 'bot_ids':ids})).status_code == 422
    for unavailable in [foreign, deleted, str(uuid4())]:
        assert (await client.post('/api/conversations', json={'title':'Private', 'is_group':True, 'bot_ids':[bots[0], unavailable]})).status_code == 404
    assert (await client.get('/api/conversations')).json() == []


@pytest.mark.asyncio
async def test_additions_reach_exactly_two_hundred_and_never_expose_other_tenants(workspace):
    client, _, _, bots, foreign, deleted = workspace
    room = (await client.post('/api/conversations', json={'title':'Growing team', 'is_group':True, 'bot_ids':bots[:199]})).json()['id']
    path = '/api/conversations/'+room+'/participants'
    assert (await client.post(path, params={'bot_id':bots[199]})).status_code == 200
    assert (await client.post(path, params={'bot_id':bots[199]})).status_code == 409
    assert (await client.post(path, params={'bot_id':bots[200]})).status_code == 422
    for unavailable in [foreign, deleted]:
        assert (await client.post(path, params={'bot_id':unavailable})).status_code == 404
    assert (await client.post(path, params={'bot_id':bots[0]}, headers={'x-grokbot-user-id':'other-owner'})).status_code == 404
    rooms = (await client.get('/api/conversations')).json()
    assert len(rooms[0]['bot_ids']) == 200


@pytest.mark.asyncio
async def test_adding_a_teammate_promotes_direct_conversation_to_group(workspace):
    client, _, _, bots, _, _ = workspace
    room = (await client.post('/api/conversations', json={'title':'Now a team', 'bot_ids':bots[:1]})).json()['id']
    assert (await client.post('/api/conversations/'+room+'/participants', params={'bot_id':bots[1]})).status_code == 200
    assert (await client.get('/api/conversations')).json()[0]['is_group'] is True


@pytest.mark.asyncio
async def test_agent_skill_api_exposes_only_its_own_five_and_actual_persisted_choice(workspace):
    client, sessions, _, bots, foreign, deleted = workspace
    path = '/api/bots/'+bots[0]+'/skills'
    response = await client.get(path)
    assert response.status_code == 200, response.text
    profile = response.json()
    assert profile['bot_id'] == bots[0]
    assert len(set(profile['skill_ids'])) == len(profile['skills']) == 5
    assert profile['selected_by'] == 'automatic'
    assert profile['persisted'] is False
    from app.services.agent_skills import select_agent_skills
    async with sessions() as db:
        await select_agent_skills(db, bots[0], list(reversed(profile['skill_ids'])))
    chosen = (await client.get(path)).json()
    assert chosen['selected_by'] == 'agent'
    assert chosen['persisted'] is True
    assert chosen['skill_ids'] == list(reversed(profile['skill_ids']))
    assert (await client.get(path, headers={'x-grokbot-user-id':'other-owner'})).status_code == 404
    for unavailable in [foreign, deleted]:
        assert (await client.get('/api/bots/'+unavailable+'/skills')).status_code == 404
