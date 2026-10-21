"""Dedicated long-lived worker entrypoint for managed container deployments."""
import asyncio
import logging
import signal
from contextlib import suppress
from app.db.session import engine
from app.services.worker import run_worker

async def main():
    from app.db.bootstrap import initialize_database
    await initialize_database()
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
