"""One database upgrade path for both the API and the dedicated worker."""
from sqlalchemy import text, update, or_
from sqlalchemy.schema import CreateSchema

from app.config import settings
from app.db.session import Base, engine
from app.db.migrations import ensure_tenant_schema


async def initialize_database(database_engine=None):
    import app.models  # Register every table before inspecting legacy schemas.
    from app.models.bot import Bot
    database_engine = database_engine or engine
    async with database_engine.begin() as connection:
        if database_engine.dialect.name == "postgresql":
            await connection.execute(text("SELECT pg_advisory_xact_lock(1763000272)"))
            await connection.execute(CreateSchema(settings.DATABASE_SCHEMA, if_not_exists=True))
        await connection.run_sync(ensure_tenant_schema)
        await connection.run_sync(Base.metadata.create_all)
        await connection.execute(update(Bot).where(or_(Bot.llm_provider != 'openai', Bot.llm_model.notin_(['gpt-6.1-sol', 'gpt-6-luna']))).values(llm_provider='openai', llm_model='gpt-6.1-sol'))
