from sqlalchemy import MetaData
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from app.config import settings
from app.db.connection import engine_options

url, options = engine_options(settings.DATABASE_URL)
engine = create_async_engine(url, echo=False, **options)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
Base = declarative_base(metadata=MetaData(schema=settings.DATABASE_SCHEMA if engine.dialect.name == "postgresql" else None))
from app.db.tenancy import install_tenant_events
install_tenant_events()
from app.db import wakeup  # Register commit-bound work notifications.

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
