"""Real PostgreSQL upgrade from the previous revision, using disposable data."""
import asyncio
import os

import pytest
from sqlalchemy import inspect, text


@pytest.mark.skipif(not os.getenv('GROKBOT_TEST_POSTGRES'), reason='Requires disposable PostgreSQL')
@pytest.mark.asyncio
async def test_previous_revision_adds_apple_tables_once_and_preserves_existing_rows(monkeypatch):
    from app.config import settings
    from app.db import bootstrap
    from app.db.session import Base, engine
    from app.models.bot import Bot
    from app.services import mcp_directory

    assert engine.url.database == 'cypher_apple_msp_test'
    schema = settings.DATABASE_SCHEMA
    assert schema.startswith('e2e_apple_') and Base.metadata.schema == schema
    apple = {'apple_link_challenges', 'apple_message_threads', 'apple_message_inbound', 'apple_message_outbox'}
    async def no_seed(_connection):
        return 0
    monkeypatch.setattr(mcp_directory, 'seed_directory_rows', no_seed)
    try:
        async with engine.begin() as conn:
            await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
            tables = [t for t in Base.metadata.sorted_tables if t.name not in apple]
            await conn.run_sync(lambda sync: Base.metadata.create_all(sync, tables=tables))
            await conn.execute(text(f'CREATE TABLE "{schema}".schema_revision (id INTEGER PRIMARY KEY, version VARCHAR(40) NOT NULL)'))
            await conn.execute(text(f'INSERT INTO "{schema}".schema_revision VALUES (1,\'2026-10-25-sourcing-outreach-v2\')'))
            await conn.execute(Bot.__table__.insert().values(id='preserved-agent', tenant_id='existing-owner',
                name='Existing agent', role='Assistant', system_prompt='Keep existing settings',
                llm_provider='openai', llm_model='gpt-6-luna', tools_enabled=[]))
        # API and worker can initialize concurrently; the existing advisory lock serializes upgrades.
        await asyncio.gather(bootstrap.initialize_database(), bootstrap.initialize_database())
        async with engine.connect() as conn:
            names = await conn.run_sync(lambda sync: set(inspect(sync).get_table_names(schema=schema)))
            assert apple <= names
            assert await conn.scalar(text(f'SELECT version FROM "{schema}".schema_revision WHERE id=1')) == '2026-10-26-apple-msp-v1'
            saved = (await conn.execute(text(f'SELECT name, system_prompt, tenant_id FROM "{schema}".bots WHERE id=\'preserved-agent\''))).one()
            assert tuple(saved) == ('Existing agent', 'Keep existing settings', 'existing-owner')
        def unexpected_upgrade(_connection):
            pytest.fail('A second startup must take the current-revision fast path.')
        monkeypatch.setattr(bootstrap, 'ensure_tenant_schema', unexpected_upgrade)
        await bootstrap.initialize_database()
    finally:
        async with engine.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        await engine.dispose()
