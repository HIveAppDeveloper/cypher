"""Dedicated long-lived worker entrypoint for managed container deployments."""
import asyncio
import logging
import signal
from contextlib import suppress
from app.db.session import engine
from app.services.worker import run_worker

async def drain_worker(task, stop_event, timeout=50):
    """Finish current work before the platform's 60-second shutdown deadline."""
    stopped = asyncio.create_task(stop_event.wait())
    try:
        await asyncio.wait({task, stopped}, return_when=asyncio.FIRST_COMPLETED)
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=timeout)
        except asyncio.TimeoutError:
            logging.getLogger(__name__).warning('Worker shutdown deadline reached; stopping current execution.')
            task.cancel()
            with suppress(asyncio.CancelledError): await task
    finally:
        stopped.cancel()
        with suppress(asyncio.CancelledError): await stopped
        if not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError): await task

async def main():
    from app.db.bootstrap import initialize_database
    await initialize_database(engine)
    stop_event = asyncio.Event()
    task = asyncio.create_task(run_worker(stop_event=stop_event))
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop_event.set)
    try:
        with suppress(asyncio.CancelledError):
            await drain_worker(task, stop_event)
    finally:
        await engine.dispose()

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
