"""One database upgrade path for both the API and the dedicated worker."""
from sqlalchemy import text
from sqlalchemy.schema import CreateSchema

from app.config import settings
from app.db.session import Base, engine
from app.db.migrations import ensure_tenant_schema


async def initialize_database(database_engine=None):
    import app.models  # Register every table before inspecting legacy schemas.
    database_engine = database_engine or engine
    async with database_engine.begin() as connection:
        if database_engine.dialect.name == "postgresql":
            await connection.execute(text("SELECT pg_advisory_xact_lock(1763000272)"))
            await connection.execute(CreateSchema(settings.DATABASE_SCHEMA, if_not_exists=True))
            schema = settings.DATABASE_SCHEMA
            from app.services.atlas_admission import initialize_admission_schema
            await initialize_admission_schema(connection)
            await connection.execute(text(f'CREATE TABLE IF NOT EXISTS "{schema}".schema_revision (id INTEGER PRIMARY KEY, version VARCHAR(40) NOT NULL)'))
            if await connection.scalar(text(f'SELECT version FROM "{schema}".schema_revision WHERE id=1')) == '2026-10-25-sourcing-outreach-v2':
                return
        await connection.run_sync(ensure_tenant_schema)
        await connection.run_sync(Base.metadata.create_all)
        await connection.run_sync(ensure_investor_funnel_schema)
        await connection.run_sync(ensure_sourcing_outreach_schema)
        from app.services.mcp_directory import seed_directory_rows
        await seed_directory_rows(connection)
        if database_engine.dialect.name == 'postgresql':
            await connection.execute(text(f'INSERT INTO "{schema}".schema_revision (id,version) VALUES (1,\'2026-10-25-sourcing-outreach-v2\') ON CONFLICT (id) DO UPDATE SET version=EXCLUDED.version'))


def ensure_investor_funnel_schema(connection):
    from sqlalchemy import inspect
    from app.db.session import Base

    schema = Base.metadata.schema
    inspector = inspect(connection)
    if "investor_match_runs" not in set(inspector.get_table_names(schema=schema)):
        return
    columns = {column["name"] for column in inspector.get_columns("investor_match_runs", schema=schema)}
    if "direction" in columns:
        return
    table = Base.metadata.tables.get(f"{schema}.investor_match_runs" if schema else "investor_match_runs")
    formatted = connection.dialect.identifier_preparer.format_table(table, use_schema=bool(schema))
    connection.exec_driver_sql(f"ALTER TABLE {formatted} ADD COLUMN direction VARCHAR(32) NOT NULL DEFAULT 'investors_for_thesis'")


def ensure_sourcing_outreach_schema(connection):
    from sqlalchemy import inspect
    from app.db.session import Base

    schema = Base.metadata.schema
    inspector = inspect(connection)
    if 'sourcing_outreach' not in set(inspector.get_table_names(schema=schema)):
        return
    columns = {column['name'] for column in inspector.get_columns('sourcing_outreach', schema=schema)}
    if 'gmail_draft_id' in columns:
        return
    table = Base.metadata.tables.get(f'{schema}.sourcing_outreach' if schema else 'sourcing_outreach')
    formatted = connection.dialect.identifier_preparer.format_table(table, use_schema=bool(schema))
    connection.exec_driver_sql(f'ALTER TABLE {formatted} ADD COLUMN gmail_draft_id VARCHAR(256)')
