"""Content-free monotonic timings for audio tasks, scoped per coroutine."""
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
from inspect import signature
from time import perf_counter
import logging

_current = ContextVar('voice_metrics', default=None)
logger = logging.getLogger(__name__)

def note(name, value):
    metrics = _current.get()
    if metrics is not None:
        metrics[name] = round(value, 2)

@contextmanager
def stage(name):
    metrics = _current.get()
    if metrics is None:
        yield
        return
    started = perf_counter()
    try:
        yield
    finally:
        metrics[name + '_ms'] = round(metrics.get(name + '_ms', 0) + (perf_counter() - started) * 1000, 2)
        metrics[name + '_calls'] = metrics.get(name + '_calls', 0) + 1

def timed(name):
    def decorate(function):
        @wraps(function)
        async def run(*args, **kwargs):
            with stage(name):
                return await function(*args, **kwargs)
        return run
    return decorate

def audio_task(function):
    parameters = signature(function)
    @wraps(function)
    async def run(*args, **kwargs):
        bound = parameters.bind(*args, **kwargs).arguments
        files = bound.get('attachments') or []
        if not any(str(file.get('mime', '')).startswith('audio/') for file in files):
            return await function(*args, **kwargs)
        metrics = {}
        token = _current.set(metrics)
        started = perf_counter()
        try:
            return await function(*args, **kwargs)
        finally:
            note('worker_total_ms', (perf_counter() - started) * 1000)
            try:
                await args[0]._persist_voice_metrics(metrics)
            except Exception:
                # Never fail a task or log source audio/transcripts/provider bodies.
                logger.warning('Voice timing persistence unavailable')
            finally:
                _current.reset(token)
    return run
