"""Offline skill-profile persistence, isolation and prompt-contract checks."""
import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.db.session import Base
from app.db.tenancy import current_tenant_id
from app.models.bot import Bot
from app.models.workspace import WorkspaceSetting
from app.services import agent_skills as service
from app.services.specialist_catalog import get_skill

OWNER = 'skill-owner-a'
OTHER = 'skill-owner-b'
FIRST = ['python.execution-plan', 'python.reproduction', 'python.quality-review',
         'python.regression-check', 'python.summary']
SECOND = ['typescript.source-brief', 'typescript.root-cause', 'typescript.validation-plan',
          'typescript.compatibility', 'typescript.instructions']


@pytest_asyncio.fixture
async def store(tmp_path):
    engine = create_async_engine(f'sqlite+aiosqlite:///{tmp_path}/skills.db')
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(c, tables=[Bot.__table__, WorkspaceSetting.__table__]))
    try:
        yield sessions
    finally:
        await engine.dispose()


async def make_bot(sessions, tenant=OWNER, **changes):
    token = current_tenant_id.set(tenant)
    try:
        async with sessions() as db:
            bot = Bot(id=str(uuid4()), name='Engineer ' + uuid4().hex[:6], role='Python engineer',
                      system_prompt='Implement Python fixes, reproduce defects and verify tests.',
                      llm_provider='openai', llm_model='gpt-6-luna', tools_enabled=['none'], **changes)
            db.add(bot)
            await db.commit()
            return bot.id
    finally:
        current_tenant_id.reset(token)


@pytest.mark.asyncio
async def test_old_and_new_agents_get_five_honest_defaults_without_writing_or_permissions(store):
    bot_id = await make_bot(store)
    token = current_tenant_id.set(OWNER)
    try:
        async with store() as db:
            profile = await service.get_agent_skills(db, bot_id)
            assert profile['selected_by'] == 'automatic' and profile['persisted'] is False
            assert len(set(profile['skill_ids'])) == 5
            assert all(get_skill(item) is not None for item in profile['skill_ids'])
            assert profile['catalog_size'] == 10000
            assert list((await db.execute(select(WorkspaceSetting))).scalars()) == []
            assert (await db.get(Bot, bot_id)).tools_enabled == ['none']
            text = await service.prompt_for_bot(db, bot_id)
            assert len(text) <= 6000
            assert 'automatic initial choices, not a prior model decision' in text
            assert 'choose_agent_skills' in text and 'not completed work' in text
            assert all(item in text for item in profile['skill_ids'])
    finally:
        current_tenant_id.reset(token)


@pytest.mark.asyncio
async def test_compact_runtime_directory_keeps_choices_and_lazy_full_guidance(store):
    bot_id = await make_bot(store)
    handlers = {}
    service.register_agent_skill_tools(SimpleNamespace(
        register=lambda name, description, parameters, handler: handlers.update({name: handler})), store)
    token = current_tenant_id.set(OWNER)
    try:
        async with store() as db:
            profile = await service.select_agent_skills(db, bot_id, FIRST)
            before = (await db.get(WorkspaceSetting, service._key(bot_id))).value.copy()
            compact = await service.prompt_for_bot(db, bot_id, compact=True)
            full = await service.prompt_for_bot(db, bot_id)
            assert all(card['id'] in compact and card['name'] in compact for card in profile['skills'])
            assert len(compact) < len(full) / 2
            assert (await service.get_agent_skills(db, bot_id))['skill_ids'] == FIRST
            assert (await db.get(WorkspaceSetting, service._key(bot_id))).value == before
            assert (await db.get(Bot, bot_id)).tools_enabled == ['none']
        result = await handlers['search_agent_skills']({'query': 'Python regression check'}, bot_id)
        card = next(card for card in result['skills'] if card['id'] == 'python.regression-check')
        assert card['instructions'] == get_skill(card['id'])['instructions']
        assert card['eligibility']['eligible'] and card['sources']
    finally:
        current_tenant_id.reset(token)


@pytest.mark.asyncio
async def test_agent_choices_persist_and_same_choice_is_idempotent(store):
    bot_id = await make_bot(store)
    token = current_tenant_id.set(OWNER)
    try:
        async with store() as db:
            first = await service.select_agent_skills(db, bot_id, FIRST)
            await service.select_agent_skills(db, bot_id, FIRST)
            assert first['selected_by'] == 'agent' and first['persisted'] is True
        async with store() as db:
            profile = await service.get_agent_skills(db, bot_id)
            assert profile['skill_ids'] == FIRST
            assert len(list((await db.execute(select(WorkspaceSetting))).scalars())) == 1
            bot = await db.get(Bot, bot_id)
            assert bot.system_prompt == 'Implement Python fixes, reproduce defects and verify tests.'
            assert bot.tools_enabled == ['none']
            assert 'automatic initial choices' not in await service.prompt_for_bot(db, bot_id)
    finally:
        current_tenant_id.reset(token)


@pytest.mark.asyncio
@pytest.mark.parametrize('ids', [[], FIRST[:4], FIRST + ['python.fact-check'], FIRST[:4] + FIRST[:1],
                                FIRST[:4] + ['not.a-skill'], 'python.execution-plan', [1, 2, 3, 4, 5]])
async def test_selection_requires_exactly_five_different_catalog_ids(store, ids):
    bot_id = await make_bot(store)
    token = current_tenant_id.set(OWNER)
    try:
        async with store() as db:
            with pytest.raises(ValueError):
                await service.select_agent_skills(db, bot_id, ids)
            assert list((await db.execute(select(WorkspaceSetting))).scalars()) == []
    finally:
        current_tenant_id.reset(token)


@pytest.mark.asyncio
async def test_tenant_ownership_holds_even_for_cached_foreign_bot_instance(store):
    bot_id = await make_bot(store)
    token = current_tenant_id.set(OWNER)
    try:
        async with store() as db:
            await service.select_agent_skills(db, bot_id, FIRST)
            bot = await db.get(Bot, bot_id)
            foreign = current_tenant_id.set(OTHER)
            try:
                for action in (lambda: service.get_agent_skills(db, bot),
                               lambda: service.select_agent_skills(db, bot_id, SECOND)):
                    with pytest.raises(ValueError, match='Agent not found'):
                        await action()
            finally:
                current_tenant_id.reset(foreign)
            assert (await service.get_agent_skills(db, bot_id))['skill_ids'] == FIRST
    finally:
        current_tenant_id.reset(token)


@pytest.mark.asyncio
async def test_deleted_agent_cannot_retrieve_or_change_saved_profile(store):
    bot_id = await make_bot(store)
    token = current_tenant_id.set(OWNER)
    try:
        async with store() as db:
            await service.select_agent_skills(db, bot_id, FIRST)
            bot = await db.get(Bot, bot_id)
            bot.status = 'deleted'
            await db.commit()
            with pytest.raises(ValueError, match='Agent not found'):
                await service.get_agent_skills(db, bot_id)
            with pytest.raises(ValueError, match='Agent not found'):
                await service.select_agent_skills(db, bot_id, SECOND)
    finally:
        current_tenant_id.reset(token)


@pytest.mark.asyncio
async def test_corrupt_saved_selection_recovers_to_five_automatic_skills(store):
    bot_id = await make_bot(store)
    token = current_tenant_id.set(OWNER)
    try:
        async with store() as db:
            db.add(WorkspaceSetting(id=service._key(bot_id), value={'selected_by': 'agent', 'skill_ids': FIRST[:3]}))
            await db.commit()
            profile = await service.get_agent_skills(db, bot_id)
            assert profile['selected_by'] == 'automatic'
            assert len(set(profile['skill_ids'])) == 5
    finally:
        current_tenant_id.reset(token)


@pytest.mark.asyncio
async def test_concurrent_first_choices_create_one_complete_profile(store):
    bot_id = await make_bot(store)
    token = current_tenant_id.set(OWNER)
    try:
        async def choose(ids):
            async with store() as db:
                return await service.select_agent_skills(db, bot_id, ids)
        await asyncio.gather(choose(FIRST), choose(SECOND))
        async with store() as db:
            profile = await service.get_agent_skills(db, bot_id)
            assert profile['skill_ids'] in (FIRST, SECOND)
            assert len(list((await db.execute(select(WorkspaceSetting))).scalars())) == 1
    finally:
        current_tenant_id.reset(token)


@pytest.mark.asyncio
async def test_registered_tool_targets_only_its_trusted_bot_and_never_grants_tools(store):
    bot_id, other_id = await make_bot(store), await make_bot(store)
    handlers, definitions = {}, {}
    def register(name, description, parameters, handler):
        handlers[name] = handler
        definitions[name] = parameters
    service.register_agent_skill_tools(SimpleNamespace(register=register), store)
    token = current_tenant_id.set(OWNER)
    try:
        assert definitions['choose_agent_skills']['properties']['skill_ids']['minItems'] == 5
        assert definitions['choose_agent_skills']['additionalProperties'] is False
        result = await handlers['choose_agent_skills']({'skill_ids': FIRST, 'bot_id': other_id}, bot_id)
        assert 'error' in result
        result = await handlers['choose_agent_skills']({'skill_ids': FIRST}, bot_id)
        assert result['bot_id'] == bot_id and result['selected_by'] == 'agent'
        discovery = await handlers['search_agent_skills']({'query': 'Python regression testing'}, bot_id)
        assert 1 <= len(discovery['skills']) <= 8
        async with store() as db:
            assert (await service.get_agent_skills(db, other_id))['selected_by'] == 'automatic'
            assert (await db.get(Bot, bot_id)).tools_enabled == ['none']
            assert (await db.get(Bot, other_id)).tools_enabled == ['none']
    finally:
        current_tenant_id.reset(token)
