"""Dedicated long-lived worker entrypoint for managed container deployments."""
import asyncio
import logging
import signal
from contextlib import suppress
from sqlalchemy.schema import CreateSchema
from sqlalchemy import text
from app.config import settings
from app.db.session import engine, Base
from app.services.worker import run_worker

async def main():
    async with engine.begin() as conn:
        if engine.dialect.name == "postgresql":
            await conn.execute(text("SELECT pg_advisory_xact_lock(1763000272)"))
            await conn.execute(CreateSchema(settings.DATABASE_SCHEMA, if_not_exists=True))
        await conn.run_sync(Base.metadata.create_all)
    task = asyncio.create_task(run_worker())
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, task.cancel)
    try:
        with suppress(asyncio.CancelledError):
            await task
    finally:
        await engine.dispose()

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
