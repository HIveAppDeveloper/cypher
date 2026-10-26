import asyncio
from types import SimpleNamespace

import pytest

from app.db.tenancy import current_tenant_id
from app.services.fleet import ModelFleet, LLMGateway
from app.services.usage import active


def result(text='Verified from supplied evidence', **route):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text, tool_calls=None))],
                           usage=None, _hidden_params={'grokbot_route': route})


@pytest.mark.asyncio
async def test_parallel_duplicates_are_one_call_and_mutation_cannot_corrupt_cache(monkeypatch):
    started, release = asyncio.Event(), asyncio.Event()
    calls = []
    async def complete(**kwargs):
        calls.append(kwargs)
        started.set()
        await release.wait()
        return result(model='actual-backup', provider='openai', fallback=True, transport='omniroute')
    monkeypatch.setattr(LLMGateway, 'complete', complete)
    fleet = ModelFleet()
    args = {'skill_id': 'python.concurrency-review', 'task': 'Evidence: two writes overlap. Check ordering.'}
    first = asyncio.create_task(fleet.consult(args, 'bot'))
    await started.wait()
    second = asyncio.create_task(fleet.consult(args, 'bot'))
    await asyncio.sleep(0)
    release.set()
    a, b = await asyncio.gather(first, second)
    assert a == b and fleet.used == len(calls) == 1
    assert a['model'] == 'actual-backup' and a['fallback'] is True and a['provider'] == 'openai'
    a['findings'] = 'modified'
    assert (await fleet.consult(args, 'bot'))['findings'] != 'modified'
    call = calls[0]
    assert call['tools'] is None and call['options'].allow_tools is False
    assert call['options'].max_tokens == 768 and call['options'].reasoning_effort == 'low'
    assert 'Domain: Python' in call['messages'][0]['content']
    assert len(call['messages']) == 2 and call['messages'][1]['content'] == args['task']


@pytest.mark.asyncio
async def test_batch_two_slots_and_shared_three_call_budget(monkeypatch):
    active_count = max_active = calls = 0
    two_running, release = asyncio.Event(), asyncio.Event()
    async def complete(**kwargs):
        nonlocal active_count, max_active, calls
        calls += 1
        active_count += 1
        max_active = max(max_active, active_count)
        if active_count == 2:
            two_running.set()
        try:
            await release.wait()
            return result()
        finally:
            active_count -= 1
    monkeypatch.setattr(LLMGateway, 'complete', complete)
    fleet = ModelFleet()
    batch = asyncio.create_task(fleet.consult_many({'assignments': [
        {'specialty': 'research', 'task': f'Check independent item {i}.'} for i in range(3)]}, 'bot'))
    await asyncio.wait_for(two_running.wait(), 1)
    assert calls == active_count == 2
    release.set()
    answer = await batch
    assert max_active == 2 and calls == fleet.used == 3
    assert all('findings' in item for item in answer['results'])
    assert 'error' in await fleet.consult({'specialty': 'review', 'task': 'Fourth'}, 'bot')
    assert 'findings' in await fleet.consult({'specialty': 'research', 'task': 'Check independent item 0.'}, 'bot')
    assert calls == 3 and not fleet.pending


@pytest.mark.asyncio
async def test_tenant_task_and_bot_do_not_share_findings(monkeypatch):
    calls = []
    async def complete(**kwargs):
        calls.append(current_tenant_id.get())
        return result(str(calls[-1]))
    monkeypatch.setattr(LLMGateway, 'complete', complete)
    fleet = ModelFleet()
    args = {'specialty': 'research', 'task': 'Same task text'}
    tenant = current_tenant_id.set('owner-a')
    task = active.set(('task-a', None))
    try:
        assert (await fleet.consult(args, 'bot-a'))['findings'] == 'owner-a'
        current_tenant_id.set('owner-b')
        assert (await fleet.consult(args, 'bot-a'))['findings'] == 'owner-b'
        assert (await fleet.consult(args, 'bot-b'))['findings'] == 'owner-b'
    finally:
        active.reset(task)
        current_tenant_id.reset(tenant)
    assert calls == ['owner-a', 'owner-b', 'owner-b']


@pytest.mark.asyncio
async def test_invalid_batch_and_secrets_never_reach_gateway(monkeypatch):
    async def forbidden(**kwargs):
        pytest.fail('No provider call is permitted')
    monkeypatch.setattr(LLMGateway, 'complete', forbidden)
    fleet = ModelFleet()
    assert 'error' in await fleet.consult_many({'assignments': [
        {'specialty': 'review', 'task': 'Valid'}, {'skill_id': 'missing.id', 'task': 'Invalid'}]}, 'bot')
    for args in [None, {'specialty': [], 'task': 'x'}, {'specialty': 'review', 'task': ' '},
                 {'skill_id': 'python.summary', 'task': 'api_key=sk-test-secret-123456789012345'},
                 {'skill_id': 'python.summary', 'task': 'x'*12001}]:
        assert 'error' in await fleet.consult(args, 'bot')
    assert fleet.used == 0
    search = await fleet.search({'query': 'Python concurrency review'}, 'bot')
    assert search['catalog_size'] == 10000 and search['mode'] == 'local_catalog'
    assert fleet.used == 0


@pytest.mark.asyncio
async def test_timeout_and_failure_are_cached_without_raw_error_or_background_work(monkeypatch):
    from app.services import fleet as module
    monkeypatch.setattr(module, 'CONSULTATION_SECONDS', .02)
    cancelled = asyncio.Event()
    async def slow(**kwargs):
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()
    monkeypatch.setattr(LLMGateway, 'complete', slow)
    fleet = ModelFleet()
    args = {'specialty': 'research', 'task': 'Check supplied evidence'}
    answer = await fleet.consult(args, 'bot')
    assert 'error' in answer and cancelled.is_set() and not fleet.pending
    assert answer == await fleet.consult(args, 'bot') and fleet.used == 1
    async def fail(**kwargs):
        raise RuntimeError('PRIVATE-SECRET provider-body')
    monkeypatch.setattr(LLMGateway, 'complete', fail)
    error = await fleet.consult({'specialty': 'review', 'task': 'Check again'}, 'bot')
    assert 'PRIVATE' not in str(error)


@pytest.mark.asyncio
async def test_batch_cancellation_closes_all_provider_calls(monkeypatch):
    entered = asyncio.Event()
    running = 0
    async def slow(**kwargs):
        nonlocal running
        running += 1
        if running == 2:
            entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            running -= 1
    monkeypatch.setattr(LLMGateway, 'complete', slow)
    fleet = ModelFleet()
    task = asyncio.create_task(fleet.consult_many({'assignments': [
        {'specialty': 'review', 'task': str(i)} for i in range(3)]}, 'bot'))
    await asyncio.wait_for(entered.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert running == 0 and not fleet.pending


@pytest.mark.asyncio
async def test_specialist_tool_requests_are_rejected(monkeypatch):
    async def invalid(**kwargs):
        response = result('I acted')
        response.choices[0].message.tool_calls = [{'function': {'name': 'send_email'}}]
        return response
    monkeypatch.setattr(LLMGateway, 'complete', invalid)
    answer = await ModelFleet().consult({'specialty': 'review', 'task': 'Check supplied facts'}, 'bot')
    assert 'findings' not in answer and 'error' in answer
