"""Run separately against a disposable PostgreSQL instance, never production."""
import os
from uuid import uuid4

import pytest
from sqlalchemy import text, inspect

pytestmark = pytest.mark.skipif(not os.getenv('GROKBOT_TEST_POSTGRES'), reason='Requires disposable PostgreSQL')


@pytest.mark.asyncio
async def test_legacy_postgres_schema_upgrades_idempotently_for_api_and_worker():
    from app.db.bootstrap import initialize_database
    from app.db.session import engine, Base
    from app.config import settings
    schema = settings.DATABASE_SCHEMA
    assert schema.startswith('e2e_'), 'Use an isolated test schema.'
    async with engine.begin() as conn:
        await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
        await conn.execute(text(f'''CREATE TABLE "{schema}".bots (
          id VARCHAR(36) PRIMARY KEY, name VARCHAR NOT NULL UNIQUE,
          role VARCHAR NOT NULL, description TEXT, avatar_url VARCHAR,
          system_prompt TEXT NOT NULL, llm_provider VARCHAR NOT NULL,
          llm_model VARCHAR NOT NULL, tools_enabled JSON NOT NULL,
          memory_enabled BOOLEAN, status VARCHAR, container_id VARCHAR,
          created_at TIMESTAMP, updated_at TIMESTAMP)'''))
        await conn.execute(text(f'''INSERT INTO "{schema}".bots
          (id,name,role,system_prompt,llm_provider,llm_model,tools_enabled)
          VALUES (:id,'Legacy agent','Assistant','Help','openai','gpt-6-luna','[]')'''), {'id': str(uuid4())})
    try:
        await initialize_database()
        await initialize_database()
        async with engine.connect() as conn:
            assert await conn.scalar(text(f'SELECT tenant_id FROM "{schema}".bots')) == 'legacy-owner'
            columns = await conn.run_sync(lambda sync: {c['name'] for c in inspect(sync).get_columns('goals', schema=schema)})
            assert 'tenant_id' in columns
            # A name is unique within a workspace, not across the installation.
            await conn.execute(text(f'''INSERT INTO "{schema}".bots
              (id,name,role,system_prompt,llm_provider,llm_model,tools_enabled,tenant_id)
              VALUES (:id,'Legacy agent','Assistant','Help','openai','gpt-6-luna','[]','another-user')'''), {'id': str(uuid4())})
            await conn.commit()
    finally:
        async with engine.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await engine.dispose()
