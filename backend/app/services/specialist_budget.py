"""Crash-safe specialist reservations in existing tenant execution-step storage.

Reserve before inference. A lost outcome consumes a slot and is never reissued;
only a completed ledger result can be reused. No request text is stored here.
"""
import hashlib
import json
from datetime import datetime

from sqlalchemy import func, select, text

from app.db.tenancy import current_tenant_id
from app.models.execution import ExecutionStep
from app.models.task import Task

LEDGER_NAME = 'specialist_consultation_v1'
MAX_DURABLE_CONSULTATIONS = 3


def request_key(role, skill_id, task, bot_id):
    encoded = json.dumps([str(bot_id), role, skill_id, task], ensure_ascii=False, separators=(',', ':'))
    return 'specialist:v1:' + hashlib.sha256(encoded.encode()).hexdigest()


async def reserve(usage, key):
    task_id, sessions = usage
    tenant = current_tenant_id.get() or 'legacy-owner'
    async with sessions() as db:
        # SQLite has no FOR UPDATE. Acquire its writer reservation before any
        # read, so concurrent fresh workers cannot both observe free slots.
        if db.get_bind().dialect.name == 'sqlite':
            await db.execute(text('BEGIN IMMEDIATE'))
        owner = await db.scalar(select(Task.id).where(
            Task.id == task_id, Task.tenant_id == tenant,
        ).with_for_update())
        if owner is None:
            raise ValueError('Task not found in this workspace.')
        existing = await db.scalar(select(ExecutionStep).where(
            ExecutionStep.task_id == task_id, ExecutionStep.key == key,
            ExecutionStep.tenant_id == tenant,
        ))
        if existing is not None:
            if existing.status == 'completed' and isinstance(existing.output, dict):
                return existing.output
            return {'error': 'An earlier specialist consultation has an uncertain outcome and will not be repeated.',
                    'instruction': 'Use the verified evidence already available; do not retry this consultation.'}
        count = await db.scalar(select(func.count()).select_from(ExecutionStep).where(
            ExecutionStep.task_id == task_id, ExecutionStep.tenant_id == tenant,
            ExecutionStep.name == LEDGER_NAME,
        ))
        if count >= MAX_DURABLE_CONSULTATIONS:
            return {'error': 'Specialist budget exhausted. Finish using the evidence already available.'}
        db.add(ExecutionStep(task_id=task_id, key=key, tenant_id=tenant,
                             name=LEDGER_NAME, status='running', replay_safe=True, output=None))
        # This is an idempotent reservation, not an external write intent.
        # Generic recovery may revisit it; reserve() will never repeat inference
        # for a running/uncertain row. Unrelated unsafe tool guards stay intact.
        # Commit the reservation BEFORE a provider request. A crash cannot
        # reset the count even if the enclosing tool journal has no result.
        await db.commit()
        return None


async def finish(usage, key, answer):
    task_id, sessions = usage
    tenant = current_tenant_id.get() or 'legacy-owner'
    async with sessions() as db:
        row = await db.scalar(select(ExecutionStep).where(
            ExecutionStep.task_id == task_id, ExecutionStep.key == key,
            ExecutionStep.tenant_id == tenant, ExecutionStep.name == LEDGER_NAME,
        ).with_for_update())
        if row is None or row.status != 'running':
            return
        row.output = answer
        row.status = 'completed'
        row.updated_at = datetime.utcnow()
        await db.commit()
