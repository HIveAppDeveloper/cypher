"""Queue admission against temporary SQL state; no model or external actions."""
import asyncio
from contextlib import suppress
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.db.tenancy import current_tenant_id
from app.config import settings
from app.models.task import Task
from app.services import worker, prospecting, investor_funnel, plugin_sync
from .test_cloud_runtime import cloud_db


async def create_room(client, name, bot_ids=None):
    if bot_ids is None:
        bot = await client.post('/api/bots', json={'name': name, 'role': 'Assistant', 'system_prompt': 'Synthetic scheduler fixture.', 'llm_provider': 'openai', 'llm_model': 'gpt-6-luna'})
        assert bot.status_code == 200, bot.text
        bot_ids = [bot.json()['id']]
    response = await client.post('/api/conversations', json={'title': name, 'bot_ids': bot_ids, 'is_group': len(bot_ids) > 1})
    assert response.status_code == 200, response.text
    return response.json()['id'], bot_ids


async def queue(client, room, content):
    result = await client.post(f'/api/conversations/{room}/messages', json={'sender_type': 'user', 'content': content})
    assert result.status_code == 202, result.text
    return result.json()['task_id']


async def stop_runner(runner, stop):
    stop.set()
    try:
        with suppress(asyncio.CancelledError):
            await asyncio.wait_for(asyncio.shield(runner), 3)
    finally:
        if not runner.done():
            runner.cancel()
            with suppress(asyncio.CancelledError): await runner


def local_maintenance(monkeypatch):
    async def idle(*args, **kwargs): return False
    async def catalog(stop, *args): await stop.wait()
    monkeypatch.setattr(prospecting, 'tick', idle)
    monkeypatch.setattr(investor_funnel, 'tick', idle)
    monkeypatch.setattr(investor_funnel, 'tick_founder_archive', idle)
    monkeypatch.setattr(plugin_sync, 'run', catalog)


@pytest.mark.asyncio
async def test_long_independent_job_does_not_block_chat_and_capacity_is_bounded(cloud_db, monkeypatch):
    client, sessions = cloud_db
    local_maintenance(monkeypatch)
    rooms = [(await create_room(client, f'Worker {i}'))[0] for i in range(3)]
    entered = [asyncio.Event() for _ in rooms]
    release = asyncio.Event()
    seen = []
    async def execute(conversation_id, *args, **kwargs):
        index = rooms.index(conversation_id)
        seen.append((index, current_tenant_id.get()))
        entered[index].set()
        await release.wait()
        return [{'sender_type': 'bot', 'content': 'Synthetic result'}]
    monkeypatch.setattr(worker, 'AgentOrchestrator', lambda: SimpleNamespace(process_message=execute))
    ids = [await queue(client, room, f'Job {i}') for i, room in enumerate(rooms)]
    stop = asyncio.Event()
    runner = asyncio.create_task(worker.run_worker(stop))
    try:
        await asyncio.wait_for(entered[0].wait(), 3)
        # An event barrier holds the first provider indefinitely. This proves
        # independent admission, rather than comparing flaky wall-clock times.
        await asyncio.wait_for(entered[1].wait(), 1)
        assert not release.is_set() and not entered[2].is_set()
        async with sessions() as db:
            assert (await db.get(Task, ids[0])).status == 'running'
            assert (await db.get(Task, ids[1])).status == 'running'
            assert (await db.get(Task, ids[2])).status == 'pending'
        release.set()
        await asyncio.wait_for(entered[2].wait(), 3)
        assert all(tenant == 'legacy-owner' for _, tenant in seen)
    finally:
        release.set()
        await stop_runner(runner, stop)


@pytest.mark.asyncio
async def test_bulk_maintenance_cannot_hold_up_a_new_chat(cloud_db, monkeypatch):
    client, sessions = cloud_db
    local_maintenance(monkeypatch)
    maintenance_entered, maintenance_release, chat_entered = asyncio.Event(), asyncio.Event(), asyncio.Event()
    async def slow_read(*args):
        maintenance_entered.set()
        await maintenance_release.wait()
        return False
    monkeypatch.setattr(prospecting, 'tick', slow_read)
    async def execute(*args, **kwargs):
        chat_entered.set()
        return [{'sender_type': 'bot', 'content': 'Synthetic result'}]
    monkeypatch.setattr(worker, 'AgentOrchestrator', lambda: SimpleNamespace(process_message=execute))
    room, _ = await create_room(client, 'Interactive during archive read')
    stop = asyncio.Event()
    runner = asyncio.create_task(worker.run_worker(stop))
    try:
        await asyncio.wait_for(maintenance_entered.wait(), 3)
        await queue(client, room, 'Respond while the bulk network read is still waiting')
        await asyncio.wait_for(chat_entered.wait(), 1)
        assert not maintenance_release.is_set()
    finally:
        maintenance_release.set()
        await stop_runner(runner, stop)


@pytest.mark.asyncio
async def test_conversation_fifo_and_shared_group_bots_stay_serial(cloud_db, monkeypatch):
    client, sessions = cloud_db
    local_maintenance(monkeypatch)
    room_a, bots_a = await create_room(client, 'First bot')
    _, bots_b = await create_room(client, 'Second bot')
    group, _ = await create_room(client, 'Group', bots_a + bots_b)
    shared_room, _ = await create_room(client, 'Same secondary group bot', bots_b)
    independent, _ = await create_room(client, 'Independent bot')
    group_entered, group_release, independent_entered = asyncio.Event(), asyncio.Event(), asyncio.Event()
    shared_entered = asyncio.Event()
    order = []
    async def execute(conversation_id, content, **kwargs):
        order.append(content)
        if content == 'group first':
            group_entered.set()
            await group_release.wait()
        elif content == 'shared secondary':
            shared_entered.set()
        elif conversation_id == independent:
            independent_entered.set()
        return [{'sender_type': 'bot', 'content': 'Synthetic result'}]
    monkeypatch.setattr(worker, 'AgentOrchestrator', lambda: SimpleNamespace(process_message=execute))
    await queue(client, group, 'group first')
    stop = asyncio.Event()
    runner = asyncio.create_task(worker.run_worker(stop))
    try:
        await asyncio.wait_for(group_entered.wait(), 3)
        await queue(client, group, 'group second')
        await queue(client, shared_room, 'shared secondary')
        await queue(client, independent, 'independent')
        await asyncio.wait_for(independent_entered.wait(), 1)
        assert not shared_entered.is_set() and 'group second' not in order
        group_release.set()
        await asyncio.wait_for(shared_entered.wait(), 3)
        assert order.index('group first') < order.index('group second') < order.index('shared secondary')
    finally:
        group_release.set()
        await stop_runner(runner, stop)


@pytest.mark.asyncio
async def test_parallel_jobs_keep_separate_tenant_context_and_sql_visibility(cloud_db, monkeypatch):
    client, sessions = cloud_db
    local_maintenance(monkeypatch)
    monkeypatch.setattr(settings, 'REQUIRE_USER_AUTH', True)
    monkeypatch.setattr(settings, 'BACKEND_API_TOKEN', 'synthetic-scheduler-token-more-than-32-characters')
    client.headers['authorization'] = 'Bearer ' + settings.BACKEND_API_TOKEN
    expected = {}
    for tenant in ('scheduler-owner-a', 'scheduler-owner-b'):
        client.headers['x-grokbot-user-id'] = tenant
        room, _ = await create_room(client, tenant)
        expected[room] = tenant
        await queue(client, room, 'Synthetic independent tenant job')
    entered, release = asyncio.Event(), asyncio.Event()
    seen = []
    async def execute(conversation_id, *args, **kwargs):
        tenant = current_tenant_id.get()
        async with sessions() as db:
            visible = list((await db.execute(select(Task))).scalars())
            seen.append((tenant, expected[conversation_id], [row.tenant_id for row in visible]))
        if len(seen) == 2: entered.set()
        await release.wait()
        assert current_tenant_id.get() == tenant
        return [{'sender_type': 'bot', 'content': 'Synthetic result'}]
    monkeypatch.setattr(worker, 'AgentOrchestrator', lambda: SimpleNamespace(process_message=execute))
    stop = asyncio.Event()
    runner = asyncio.create_task(worker.run_worker(stop))
    try:
        await asyncio.wait_for(entered.wait(), 3)
        assert {tenant for tenant, _, _ in seen} == set(expected.values())
        assert all(tenant == owner and visible == [tenant] for tenant, owner, visible in seen)
        assert current_tenant_id.get() is None
    finally:
        release.set()
        await stop_runner(runner, stop)


@pytest.mark.asyncio
async def test_idle_maintenance_completion_does_not_continuously_poll_sql(cloud_db, monkeypatch):
    local_maintenance(monkeypatch)
    runs = []
    entered = asyncio.Event()
    async def maintenance():
        runs.append(True)
        entered.set()
        return False
    monkeypatch.setattr(worker, '_maintenance_pass', maintenance)
    class Leader:
        async def scalar(self, *args): return 1
        async def commit(self): pass
    stop = asyncio.Event()
    runner = asyncio.create_task(worker._run_worker_loop(Leader(), 1, stop, asyncio.Event()))
    try:
        await asyncio.wait_for(entered.wait(), 3)
        await asyncio.sleep(.05)
        assert len(runs) == 1
    finally:
        await stop_runner(runner, stop)


@pytest.mark.asyncio
async def test_cancelling_one_parallel_job_leaves_the_other_running(cloud_db, monkeypatch):
    client, sessions = cloud_db
    local_maintenance(monkeypatch)
    rooms = [(await create_room(client, f'Cancel isolation {i}'))[0] for i in range(2)]
    entered = [asyncio.Event(), asyncio.Event()]
    cancelled = [asyncio.Event(), asyncio.Event()]
    release = asyncio.Event()
    async def execute(conversation_id, *args, **kwargs):
        index = rooms.index(conversation_id)
        entered[index].set()
        try:
            await release.wait()
        except asyncio.CancelledError:
            cancelled[index].set()
            raise
        return [{'sender_type': 'bot', 'content': 'Synthetic result'}]
    monkeypatch.setattr(worker, 'AgentOrchestrator', lambda: SimpleNamespace(process_message=execute))
    ids = [await queue(client, room, 'Synthetic cancellable job') for room in rooms]
    stop = asyncio.Event()
    runner = asyncio.create_task(worker.run_worker(stop))
    try:
        await asyncio.wait_for(asyncio.gather(*(event.wait() for event in entered)), 3)
        response = await client.post(f'/api/conversations/{rooms[0]}/tasks/{ids[0]}/cancel')
        assert response.status_code == 202, response.text
        await asyncio.wait_for(cancelled[0].wait(), 3)
        assert not cancelled[1].is_set()
        async with sessions() as db:
            assert (await db.get(Task, ids[1])).status == 'running'
    finally:
        release.set()
        await stop_runner(runner, stop)


@pytest.mark.asyncio
async def test_scheduler_cancel_during_notification_cleanup_is_not_swallowed(cloud_db, monkeypatch):
    from app.db import wakeup
    local_maintenance(monkeypatch)
    cleanup, release = asyncio.Event(), asyncio.Event()
    async def notification(*args):
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            cleanup.set()
            await release.wait()
            raise
    async def maintenance(): return False
    monkeypatch.setattr(wakeup, 'wait_for_work', notification)
    monkeypatch.setattr(worker, '_maintenance_pass', maintenance)
    stop = asyncio.Event()
    runner = asyncio.create_task(worker._run_worker_loop(stop_event=stop))
    try:
        await asyncio.wait_for(cleanup.wait(), 3)
        runner.cancel()
        with pytest.raises(asyncio.CancelledError):
            await asyncio.wait_for(asyncio.shield(runner), .5)
        assert runner.cancelled()
    finally:
        release.set()
        await stop_runner(runner, stop)
