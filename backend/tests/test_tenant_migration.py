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
