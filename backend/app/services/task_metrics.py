"""Read-only, tenant-scoped task latency aggregates; never fetch task contents."""
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
import math

from sqlalchemy import and_, select

from app.models.execution import TaskExecution
from app.models.message import Message
from app.models.task import Task

TERMINAL = {'completed', 'failed', 'cancelled', 'interrupted'}
STATUSES = TERMINAL | {'pending', 'running', 'waiting_approval', 'cancel_requested'}
STAGES = ('worker_total_ms', 'queue_to_context_ms', 'context_load_ms', 'plugin_load_ms',
          'model_gateway_ms', 'model_provider_ms', 'voice_prepare_ms',
          'transcription_total_ms', 'normalize_ms', 'stt_provider_ms', 'agent_loop_ms')
PERCENTILE_MINIMUMS = {'p50': 2, 'p90': 10, 'p95': 20, 'p99': 100}


def distribution(values):
    values = sorted(v for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)
                    and math.isfinite(v) and v >= 0)
    n = len(values)
    result = {'count': n, 'mean_ms': round(sum(values)/n, 2) if n else None,
              'max_ms': round(values[-1], 2) if n else None}
    for label, minimum in PERCENTILE_MINIMUMS.items():
        p = int(label[1:])/100
        result[label+'_ms'] = round(values[math.ceil(p*n)-1], 2) if n >= minimum else None
    return result


def _delta(end, start):
    if not isinstance(end, datetime) or not isinstance(start, datetime):
        return None
    def utc(value):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    ms = (utc(end)-utc(start)).total_seconds()*1000
    return ms if ms >= 0 else None


def aggregate(rows, *, now, since, cap, has_more):
    statuses, excluded = Counter(), Counter()
    timings = defaultdict(lambda: defaultdict(list))
    stages = defaultdict(lambda: defaultdict(list))
    attempts = recoveries = 0
    for row in rows:
        status = row['status'] if row['status'] in STATUSES else 'other'
        statuses[status] += 1
        attempts += max(0, row.get('attempts') or 0)
        recoveries += max(0, row.get('recoveries') or 0)
        if status not in TERMINAL:
            excluded['nonterminal'] += 1
            continue
        created, started, completed = row['created_at'], row['started_at'], row['completed_at']
        queue, runtime, total = _delta(started, created), _delta(completed, started), _delta(completed, created)
        # Require a coherent complete lifecycle; do not mix partial durations
        # into percentiles with different denominators.
        if any(value is None for value in (queue, runtime, total)) or _delta(now, completed) is None:
            excluded['missing_or_invalid_lifecycle'] += 1
            continue
        timings[status]['queue_ms'].append(queue)
        timings[status]['runtime_ms'].append(runtime)
        timings[status]['total_ms'].append(total)
        measured = row.get('voice_timings')
        if isinstance(measured, dict):
            for name in STAGES:
                value = measured.get(name)
                if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0:
                    stages[status][name].append(value)
    return {
        'window': {'since': since.isoformat()+'Z', 'until': now.isoformat()+'Z', 'cohort': 'tasks_created_in_window'},
        'scope': 'current_workspace', 'units': 'milliseconds',
        'sample': {'count': len(rows), 'cap': cap, 'truncated': has_more,
                   'selection': 'newest_created_first', 'status_counts': dict(sorted(statuses.items())),
                   'excluded_from_lifecycle': dict(sorted(excluded.items()))},
        'attempts': attempts, 'recoveries': recoveries,
        'latency_by_status': {status: {name: distribution(timings[status][name])
                                     for name in ('queue_ms', 'runtime_ms', 'total_ms')} for status in sorted(TERMINAL)},
        'measured_audio_stages_by_status': {status: {name: distribution(values) for name, values in sorted(items.items())}
                                           for status, items in sorted(stages.items())},
        'method': {'percentiles': 'nearest_rank', 'minimum_samples': PERCENTILE_MINIMUMS,
                   'limits': [
                       'Percentile minimums ensure rank resolution, not statistical confidence.',
                       'A truncated cohort represents only the newest tasks; it is not the full-window distribution.',
                       'Queue is creation to first worker start; runtime includes retries, approval waits and outages.',
                       'Audio stages exist only where recorded, may overlap, and must not be summed.',
                       'Recorded audio stages describe the latest recorded attempt, not every recovered attempt.',
                       'Model gateway time includes provider/queue waits; no separate model-queue or tool duration is recorded.',
                       'Tasks do not record a deployment cohort here; a window may span multiple releases.',
                       'Browser upload, network, rendering and playback time are not measured here.',
                       'Status groups are separate; no failures or unfinished tasks are counted as successful latency.',
                   ]},
    }


async def task_metrics(db, tenant, *, hours=24, cap=5000, now=None):
    if not tenant:
        raise ValueError('A signed-in workspace is required.')
    if not 1 <= hours <= 168 or not 1 <= cap <= 10000:
        raise ValueError('Use a 1–168 hour window and a cap of 1–10000 tasks.')
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is not None:
        now = now.astimezone(timezone.utc)
    now = now.replace(tzinfo=None)
    since = now-timedelta(hours=hours)
    # Explicit tenant predicates supplement ORM tenancy for projected columns
    # and every join. Never select Task.result, text, step outputs or files.
    statement = select(
        Task.status, Task.created_at, Task.started_at, Task.completed_at,
        TaskExecution.attempts, TaskExecution.recoveries,
        Message.metadata_json['voice_timings'].label('voice_timings'),
    ).select_from(Task).outerjoin(TaskExecution, and_(
        TaskExecution.task_id == Task.id, TaskExecution.tenant_id == tenant,
    )).outerjoin(Message, and_(
        Message.id == Task.result['request']['incoming_message_id'].as_string(),
        Message.tenant_id == tenant, Message.conversation_id == Task.conversation_id,
    )).where(Task.tenant_id == tenant, Task.created_at >= since, Task.created_at <= now).order_by(
        Task.created_at.desc(), Task.id.desc()).limit(cap+1)
    rows = (await db.execute(statement)).mappings().all()
    return aggregate(rows[:cap], now=now, since=since, cap=cap, has_more=len(rows) > cap)
