"""Content-free monotonic timings for audio tasks, scoped per coroutine."""
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps
from inspect import signature
from time import perf_counter
import logging
from uuid import UUID

_current = ContextVar('voice_metrics', default=None)
_gateway_jobs = ContextVar('voice_gateway_jobs', default=None)
_continuation = ContextVar('voice_continuation', default=False)
logger = logging.getLogger(__name__)

@contextmanager
def voice_continuation(enabled):
    """Server scope entered only after a live voice turn has real speech."""
    token = _continuation.set(bool(enabled))
    try:
        yield
    finally:
        _continuation.reset(token)

def is_voice_continuation():
    return _continuation.get()

def remember_gateway_job(path, value):
    jobs = _gateway_jobs.get()
    if jobs is None or path not in {'/chat/completions', '/responses', '/audio/transcriptions'}:
        return
    try:
        job_id = str(UUID(value))
        if job_id != value.lower():
            return
    except (ValueError, TypeError, AttributeError):
        return
    entry = {'job_id': job_id, 'stage': 'speech' if path == '/audio/transcriptions' else 'model'}
    if entry not in jobs and len(jobs) < 32:
        jobs.append(entry)

def gateway_jobs():
    return [dict(job) for job in (_gateway_jobs.get() or [])]

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
        jobs_token = _gateway_jobs.set([])
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
                _gateway_jobs.reset(jobs_token)
                _current.reset(token)
    return run
