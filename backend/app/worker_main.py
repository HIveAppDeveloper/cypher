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
    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop_event.set)
    try:
        await supervise_worker(stop_event)
    finally:
        await engine.dispose()


async def supervise_worker(stop_event, minimum_delay=2, maximum_delay=30):
    """Recover from startup, database, and runner failures without a browser."""
    from app.db.bootstrap import initialize_database
    failures = 0
    while not stop_event.is_set():
        started = asyncio.get_running_loop().time()
        try:
            await initialize_database(engine)
            await drain_worker(asyncio.create_task(run_worker(stop_event=stop_event)), stop_event)
            if stop_event.is_set(): return
            raise RuntimeError('Worker loop exited unexpectedly')
        except asyncio.CancelledError:
            raise
        except Exception as error:
            failures = 0 if asyncio.get_running_loop().time() - started > 60 else failures + 1
            delay = min(maximum_delay, minimum_delay * 2 ** min(failures - 1, 5))
            logging.getLogger(__name__).error('Worker stopped (%s); restarting in %s seconds', type(error).__name__, delay)
            await engine.dispose()
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=delay)
            except asyncio.TimeoutError:
                pass

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
