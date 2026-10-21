import pytest
from types import SimpleNamespace
from sqlalchemy import MetaData, Table, Column, String
from sqlalchemy.dialects.postgresql import dialect
from app.db import migrations


def test_existing_postgres_table_migration_never_coerces_table_to_boolean(monkeypatch):
    metadata=MetaData(schema='grokbot')
    Table('bots',metadata,Column('name',String),Column('tenant_id',String))
    fake_base=SimpleNamespace(metadata=metadata,registry=SimpleNamespace(mappers=[]))
    inspector=SimpleNamespace(get_table_names=lambda schema:['bots'],get_unique_constraints=lambda name,schema:[{'column_names':['name'],'name':'bots_name_key'}])
    monkeypatch.setattr(migrations,'Base',fake_base)
    monkeypatch.setattr(migrations,'inspect',lambda connection:inspector)
    statements=[]
    connection=SimpleNamespace(dialect=dialect(),exec_driver_sql=statements.append)
    migrations.ensure_tenant_schema(connection)
    assert any('DROP CONSTRAINT' in sql for sql in statements)
    assert any('tenant_id' in sql and 'CREATE UNIQUE INDEX' in sql for sql in statements)


@pytest.mark.asyncio
async def test_actual_lifespan_keeps_fastapi_app_and_starts_with_optional_redis_down(tmp_path,monkeypatch):
    import asyncio
    import redis.asyncio as aioredis
    from sqlalchemy.ext.asyncio import create_async_engine
    from app import main
    from app.config import settings
    from app.services import worker
    class RedisUnavailable:
        async def ping(self):raise ConnectionError('optional redis unavailable')
        async def close(self):pass
    async def idle_worker():await asyncio.Event().wait()
    engine=create_async_engine(f'sqlite+aiosqlite:///{tmp_path}/startup.db')
    monkeypatch.setattr(main,'engine',engine)
    monkeypatch.setattr(aioredis,'from_url',lambda *a,**k:RedisUnavailable())
    monkeypatch.setattr(worker,'run_worker',idle_worker)
    monkeypatch.setattr(settings,'SANDBOX_BACKEND','vercel')
    async with main.lifespan(main.app):
        assert main.app.state.redis is None
        assert main.app.state.docker_client is None
