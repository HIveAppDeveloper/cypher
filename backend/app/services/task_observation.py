"""Content-free observations from existing task and usage records; no inference."""
from datetime import datetime, timezone

from sqlalchemy import and_, func, select

from app.models.execution import TaskExecution
from app.models.task import Task
from app.models.workspace import UsageEvent
from app.services.task_metrics import TERMINAL, _delta


async def task_observation(db, tenant, task_id):
    if not tenant:
        raise ValueError('A signed-in workspace is required.')
    row = (await db.execute(select(
        Task.id, Task.status, Task.created_at, Task.started_at, Task.completed_at,
        TaskExecution.attempts, TaskExecution.recoveries,
    ).outerjoin(TaskExecution, and_(TaskExecution.task_id == Task.id,
                                  TaskExecution.tenant_id == tenant))
        .where(Task.id == task_id, Task.tenant_id == tenant))).mappings().one_or_none()
    if row is None:
        return None
    usage = (await db.execute(select(
        UsageEvent.provider, UsageEvent.model, func.count().label('recorded_usage_events'),
        func.sum(UsageEvent.input_tokens).label('input_tokens'),
        func.sum(UsageEvent.output_tokens).label('output_tokens'),
        func.sum(UsageEvent.estimated_cost).label('recorded_estimated_cost'),
    ).where(UsageEvent.task_id == task_id, UsageEvent.tenant_id == tenant)
        .group_by(UsageEvent.provider, UsageEvent.model)
        .order_by(UsageEvent.provider, UsageEvent.model))).mappings().all()
    timings = {
        'queue_ms': _delta(row['started_at'], row['created_at']),
        'runtime_ms': _delta(row['completed_at'], row['started_at']),
        'total_ms': _delta(row['completed_at'], row['created_at']),
    }
    valid = (row['status'] in TERMINAL and all(v is not None for v in timings.values())
             and _delta(datetime.now(timezone.utc), row['completed_at']) is not None)
    return {
        'task_id': row['id'], 'status': row['status'],
        'created_at': row['created_at'], 'started_at': row['started_at'],
        'completed_at': row['completed_at'],
        'attempts': row['attempts'], 'recoveries': row['recoveries'],
        'lifecycle_valid': valid,
        'latency': {key: round(value, 2) if valid else None for key, value in timings.items()},
        'usage_by_model': [dict(item) for item in usage],
        'billing_verified': False, 'cost_provenance': 'legacy_unqualified',
        'limits': [
            'Usage rows count recorded responses, not all provider attempts or billed calls.',
            'Missing pricing may have been recorded as zero; zero does not prove free inference.',
            'Recorded cost is an unqualified estimate, not an invoice or verified price quote.',
            'Lifecycle includes retries and approval waits; it excludes browser network and rendering.',
            'Release identity must be captured separately; tasks do not store a deployment cohort.',
        ],
    }
