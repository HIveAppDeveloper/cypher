"""Checkpoint external calls before/after execution; never guess write outcomes."""
import copy
import json
from datetime import datetime, timedelta
from sqlalchemy import select
from app.models.execution import ExecutionStep, TaskExecution

MAX_ATTEMPTS = 4


class RecoveryReviewRequired(RuntimeError):
    pass


class RetryTask(RuntimeError):
    pass


class ExecutionJournal:
    def __init__(self, task_id, sessions):
        self.task_id, self.sessions = task_id, sessions

    async def cached(self, key):
        if not self.task_id: return False, None
        async with self.sessions() as db:
            step = await db.get(ExecutionStep, (self.task_id, key))
            return (True, copy.deepcopy(step.output)) if step and step.status == 'completed' else (False, None)

    async def run(self, key, name, replay_safe, operation):
        if not self.task_id: return await operation()
        async with self.sessions() as db:
            step = await db.get(ExecutionStep, (self.task_id, key))
            if step and step.status == 'completed': return copy.deepcopy(step.output)
            if step and not step.replay_safe and step.status in ('running', 'uncertain'):
                raise RecoveryReviewRequired(f'The outcome of {step.name} is unknown. Review it before retrying.')
            if step is None:
                step = ExecutionStep(task_id=self.task_id, key=key, name=name, status='running', replay_safe=replay_safe)
                db.add(step)
            else:
                step.status = 'running'
                step.updated_at = datetime.utcnow()
            await db.commit()  # Intent must be durable before an external action.
        try:
            result = await operation()
        except Exception:
            async with self.sessions() as db:
                step = await db.get(ExecutionStep, (self.task_id, key))
                step.status = 'retryable' if replay_safe else 'uncertain'
                step.updated_at = datetime.utcnow()
                await db.commit()
            raise
        # Cancellation/process death leaves the durable running intent intact.
        result = json.loads(json.dumps(result, default=str))
        async with self.sessions() as db:
            step = await db.get(ExecutionStep, (self.task_id, key))
            step.output, step.status, step.updated_at = result, 'completed', datetime.utcnow()
            await db.commit()
        return copy.deepcopy(result)


async def unsafe_inflight(db, task_id):
    return (await db.execute(select(ExecutionStep.name).where(
        ExecutionStep.task_id == task_id, ExecutionStep.replay_safe.is_(False),
        ExecutionStep.status.in_(('running', 'uncertain')),
    ).limit(1))).scalar_one_or_none()


async def retry_or_interrupt(db, task, *, immediate=False):
    """The same task resumes; a crash never consumes another goal run."""
    state = await db.get(TaskExecution, task.id)
    unsafe = await unsafe_inflight(db, task.id)
    if state is None or unsafe:
        task.status = 'interrupted'
        task.completed_at = datetime.utcnow()
        detail = f'The outcome of {unsafe} is unknown; review before resuming.' if unsafe else 'This older task has no recovery checkpoints; review before resuming.'
    elif state.attempts >= MAX_ATTEMPTS:
        task.status = 'failed'
        task.completed_at = datetime.utcnow()
        detail = 'Automatic recovery exhausted four attempts. Review the task and connection status.'
    else:
        state.recoveries += 1
        state.next_attempt_at = datetime.utcnow() + timedelta(seconds=0 if immediate else min(60, 2 ** max(1, state.attempts)))
        state.updated_at = datetime.utcnow()
        task.status = 'pending'
        task.completed_at = None
        detail = 'Recovering automatically from saved execution steps.'
    if state: state.last_error = detail
    task.result = {**(task.result or {}), 'recovery': {'message': detail, 'attempts': state.attempts if state else 0}}
    return task.status
