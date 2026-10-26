"""Paid-call reservations survive fresh workers, lost receipts and replay."""
import asyncio
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.db.tenancy import current_tenant_id
from app.models.task import Task
from app.models.execution import TaskExecution, ExecutionStep
from app.services.execution import ExecutionJournal
from app.services.fleet import ModelFleet, LLMGateway
from app.services.usage import active
from app.services import specialist_budget
from .test_workspace_workflows import workspace, room


async def make_task(client, sessions, owner):
    cid = await room(client, owner)
    bid = (await client.get('/api/bots', headers={'x-grokbot-user-id': owner})).json()[0]['id']
    token = current_tenant_id.set(owner)
    try:
        async with sessions() as db:
            task = Task(conversation_id=cid, bot_id=bid, title='review', description='review', status='running')
            db.add(task)
            await db.flush()
            db.add(TaskExecution(task_id=task.id, attempts=1, recoveries=0))
            await db.commit()
            return task.id, bid
    finally:
        current_tenant_id.reset(token)


def reply():
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='Checked supplied evidence', tool_calls=None))],
                           usage=None, _hidden_params={})


@pytest.mark.asyncio
async def test_completed_journal_replay_cannot_reset_three_consultation_cap(workspace, monkeypatch):
    client, sessions = workspace
    tid, bid = await make_task(client, sessions, 'recovery-owner')
    tenant = current_tenant_id.set('recovery-owner')
    usage = active.set((tid, sessions))
    calls = []
    async def complete(**kwargs):
        calls.append(kwargs)
        return reply()
    monkeypatch.setattr(LLMGateway, 'complete', complete)
    try:
        journal = ExecutionJournal(tid, sessions)
        first = ModelFleet()
        args = [{'specialty': 'review', 'task': f'Check PRIVATE supplied item {i}'} for i in range(3)]
        for i, request in enumerate(args):
            assert 'findings' in await journal.run(f'consult-{i}', 'consult_specialist', True,
                                                  lambda request=request: first.consult(request, bid))
        resumed = ModelFleet()
        for i, request in enumerate(args):
            await journal.run(f'consult-{i}', 'consult_specialist', True,
                              lambda request=request: resumed.consult(request, bid))
        assert resumed.used == 0  # Real outer journal replay never calls fleet.
        result = await journal.run('consult-3', 'consult_specialist', True,
            lambda: resumed.consult({'specialty': 'review', 'task': 'Fourth new check'}, bid))
        assert 'budget exhausted' in result['error'].lower() and len(calls) == 3
        # The persistent result itself also reuses across fleet instances.
        assert 'findings' in await ModelFleet().consult(args[0], bid)
        assert len(calls) == 3
        async with sessions() as db:
            rows = (await db.execute(select(ExecutionStep).where(ExecutionStep.name == specialist_budget.LEDGER_NAME))).scalars().all()
            assert len(rows) == 3 and all(row.status == 'completed' for row in rows)
            assert all('PRIVATE' not in str(row.output) and 'PRIVATE' not in row.key for row in rows)
    finally:
        active.reset(usage)
        current_tenant_id.reset(tenant)


@pytest.mark.asyncio
async def test_uncertain_reservation_is_spent_and_never_reissued_after_restart(workspace, monkeypatch):
    client, sessions = workspace
    tid, bid = await make_task(client, sessions, 'uncertain-owner')
    tenant = current_tenant_id.set('uncertain-owner')
    usage = active.set((tid, sessions))
    calls = []
    async def complete(**kwargs):
        calls.append(kwargs)
        return reply()
    monkeypatch.setattr(LLMGateway, 'complete', complete)
    args = {'specialty': 'review', 'task': 'Provider may have run before the process died'}
    try:
        key = specialist_budget.request_key('review', None, args['task'], bid)
        assert await specialist_budget.reserve((tid, sessions), key) is None
        from app.services.execution import retry_or_interrupt, unsafe_inflight
        async with sessions() as db:
            task = await db.get(Task, tid)
            assert await unsafe_inflight(db, tid) is None
            assert await retry_or_interrupt(db, task, immediate=True) == 'pending'
            await db.commit()
        # Simulate process loss between a committed reservation and receipt.
        result = await ModelFleet().consult(args, bid)
        assert 'uncertain outcome' in result['error'] and not calls
        for i in range(2):
            assert 'findings' in await ModelFleet().consult({'specialty': 'review', 'task': f'Other {i}'}, bid)
        denied = await ModelFleet().consult({'specialty': 'review', 'task': 'Fourth slot'}, bid)
        assert 'budget exhausted' in denied['error'].lower() and len(calls) == 2
        async with sessions() as db:
            db.add(ExecutionStep(task_id=tid, key='real-write', name='send_message',
                                 status='uncertain', replay_safe=False))
            await db.commit()
            assert await unsafe_inflight(db, tid) == 'send_message'
    finally:
        active.reset(usage)
        current_tenant_id.reset(tenant)


@pytest.mark.asyncio
async def test_concurrent_fresh_fleets_share_one_durable_cap(workspace, monkeypatch):
    client, sessions = workspace
    tid, bid = await make_task(client, sessions, 'parallel-owner')
    tenant = current_tenant_id.set('parallel-owner')
    usage = active.set((tid, sessions))
    calls = []
    async def complete(**kwargs):
        calls.append(kwargs)
        await asyncio.sleep(.01)
        return reply()
    monkeypatch.setattr(LLMGateway, 'complete', complete)
    try:
        results = await asyncio.gather(*(ModelFleet().consult({'specialty': 'review', 'task': f'Independent {i}'}, bid) for i in range(6)))
        assert len(calls) == 3
        assert sum('findings' in result for result in results) == 3
        assert sum('budget exhausted' in result.get('error', '').lower() for result in results) == 3
        # Wrong-tenant task IDs cannot reserve a slot or read an old finding.
        current_tenant_id.set('different-owner')
        assert 'error' in await ModelFleet().consult({'specialty': 'review', 'task': 'Independent 0'}, bid)
        assert len(calls) == 3
    finally:
        active.reset(usage)
        current_tenant_id.reset(tenant)


@pytest.mark.asyncio
async def test_lost_result_receipt_never_causes_a_second_provider_call(workspace, monkeypatch):
    client, sessions = workspace
    tid, bid = await make_task(client, sessions, 'receipt-owner')
    tenant = current_tenant_id.set('receipt-owner')
    usage = active.set((tid, sessions))
    calls = []
    async def complete(**kwargs):
        calls.append(kwargs)
        return reply()
    async def lost(*args):
        raise RuntimeError('Simulated receipt write loss')
    monkeypatch.setattr(LLMGateway, 'complete', complete)
    monkeypatch.setattr(specialist_budget, 'finish', lost)
    args = {'specialty': 'review', 'task': 'Check evidence'}
    try:
        assert 'findings' in await ModelFleet().consult(args, bid)
        assert 'uncertain outcome' in (await ModelFleet().consult(args, bid))['error']
        assert len(calls) == 1
    finally:
        active.reset(usage)
        current_tenant_id.reset(tenant)
