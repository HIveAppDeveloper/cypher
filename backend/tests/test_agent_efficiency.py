from types import SimpleNamespace
import json

import pytest
import litellm

from app.schemas.input import RunOptions
from app.services.agent_efficiency import effective_run
from app.services.team_selection import relevant_bots
from .test_workspace_workflows import workspace, room


def test_fast_path_is_closed_set_and_preserves_explicit_and_complex_requests():
    original = RunOptions()
    run, specialty = effective_run(original, 'general', 'Hello!', {'text'}, history_size=1)
    assert specialty == 'execution' and run.max_tokens == 256 and run.reasoning_effort == 'low'
    assert run.allow_tools is False and original.allow_tools is True and original.max_tokens == 2048
    for options in [RunOptions(routing='manual'), RunOptions(reasoning_effort='high'),
                    RunOptions(model='gpt-6.1-sol'), RunOptions(provider='openai'), RunOptions(voice_mode=True)]:
        run, specialty = effective_run(options, 'general', 'Hello', {'text'})
        assert specialty == 'general' and run.max_tokens == options.max_tokens and run.allow_tools == options.allow_tools
        if options.reasoning_effort:
            assert run.reasoning_effort == options.reasoning_effort
    for text in ['ok', 'got it', 'Hello, please delete the files', 'What is the safe drug dose?', 'Calculate 22 * 41']:
        run, specialty = effective_run(original, 'general', text, {'text'})
        assert specialty == 'general' and run.max_tokens == 2048 and run.allow_tools is True
    assert effective_run(original, 'general', 'Hello', {'text', 'image'})[1] == 'general'
    assert effective_run(original, 'general', 'Hello', {'text'}, history_size=2)[1] == 'general'
    assert effective_run(original, 'planning', 'Hello', {'text'})[1] == 'planning'
    assert effective_run(RunOptions(routing='manual'), 'coding', 'Fix Python', {'text'})[0].reasoning_effort is None
    assert effective_run(original, 'analysis', 'Analyze the hypothesis', {'text'})[0].reasoning_effort is None


def test_roster_retrieval_is_bounded_and_uses_specific_names_and_roles():
    bots = [SimpleNamespace(id=str(i), name=f'Agent {i}', role='General') for i in range(200)]
    bots[-1].name = 'Security Engineer'
    bots[-1].role = 'Security Reviewer'
    selected = relevant_bots(bots, 'Security review', lead=bots[0])
    assert len(selected) == 8 and selected[0] is bots[0] and selected[1] is bots[-1]
    assert len({b.id for b in selected}) == 8
    assert relevant_bots(bots, '@Security Engineer inspect this', limit=1) == [bots[-1]]


@pytest.mark.asyncio
async def test_large_room_uses_one_relevant_lead_without_running_two_hundred(monkeypatch):
    from app.services.orchestrator import AgentOrchestrator
    bots = [SimpleNamespace(id=str(i), name=f'Agent {i}', role='General') for i in range(200)]
    bots[-1].name, bots[-1].role = 'Data Analyst', 'Analytics'
    class Result:
        def scalars(self): return self
        def all(self): return bots
    class DB:
        async def execute(self, statement): return Result()
    runner = AgentOrchestrator.__new__(AgentOrchestrator)
    runner.options = RunOptions()
    calls = []
    async def run(db, cid, bid, message):
        calls.append(bid)
        return [{'content': 'Only the supplied analytics evidence was reviewed.'}]
    runner._run_agent_loop = run
    await runner._handle_group_chat(DB(), SimpleNamespace(id='room'), [b.id for b in bots], 'Check analytics evidence', 'user', None)
    assert calls == ['199']
    assert len(runner.team_roster) < 3000 and '200 agents' in runner.team_roster
    calls.clear()
    await runner._handle_group_chat(DB(), SimpleNamespace(id='room'), [b.id for b in bots], '@Agent 42 inspect', 'user', None)
    assert calls == ['42']


@pytest.mark.asyncio
async def test_worker_receives_selected_skill_recipes_without_extra_model_calls(workspace, monkeypatch):
    from app.services.orchestrator import AgentOrchestrator, LLMGateway
    from app.db.tenancy import current_tenant_id
    client, _ = workspace
    cid = await room(client, 'skill-owner')
    incoming = await client.post(f'/api/conversations/{cid}/messages', headers={'x-grokbot-user-id': 'skill-owner'},
        json={'sender_type': 'user', 'content': 'Review Python concurrency race evidence: two writes can overlap.', 'options': {'allow_tools': False}})
    assert incoming.status_code == 202
    calls = []
    async def complete(**kwargs):
        calls.append(kwargs)
        assert 'python.concurrency-review' in kwargs['messages'][0]['content']
        assert kwargs['tools'] is None
        return litellm.ModelResponse(choices=[{'message': {'role': 'assistant', 'content': 'This needs an ordering check; no code was executed.'}}])
    monkeypatch.setattr(LLMGateway, 'complete', complete)
    tenant = current_tenant_id.set('skill-owner')
    try:
        answer = await AgentOrchestrator().process_message(cid, 'Review Python concurrency race evidence: two writes can overlap.',
            incoming_message_id=incoming.json()['message_id'], options={'allow_tools': False})
    finally:
        current_tenant_id.reset(tenant)
    assert len(calls) == 1 and answer[-1]['content'].startswith('This needs')


@pytest.mark.asyncio
async def test_new_conversation_greeting_avoids_plugin_discovery_and_tool_payload(workspace, monkeypatch):
    from app.services.orchestrator import AgentOrchestrator, LLMGateway
    from app.db.tenancy import current_tenant_id
    client, _ = workspace
    cid = await room(client, 'fast-owner')
    incoming = (await client.post(f'/api/conversations/{cid}/messages', headers={'x-grokbot-user-id': 'fast-owner'},
        json={'sender_type': 'user', 'content': 'Hello!'})).json()
    runner = AgentOrchestrator()
    async def no_plugins(*args):
        pytest.fail('A fresh greeting needs no plugin discovery')
    monkeypatch.setattr(runner.registry, 'load_plugins', no_plugins)
    calls = []
    async def complete(**kwargs):
        calls.append(kwargs)
        assert kwargs['tools'] is None
        assert kwargs['model'] == 'gpt-6-luna'
        assert kwargs['options'].max_tokens == 256 and kwargs['options'].reasoning_effort == 'low'
        return litellm.ModelResponse(choices=[{'message': {'role': 'assistant', 'content': 'Hello! What would you like to do?'}}])
    monkeypatch.setattr(LLMGateway, 'complete', complete)
    tenant = current_tenant_id.set('fast-owner')
    try:
        await runner.process_message(cid, 'Hello!', incoming_message_id=incoming['message_id'])
    finally:
        current_tenant_id.reset(tenant)
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_live_direction_restores_budget_tools_and_route_after_greeting(workspace, monkeypatch):
    from app.services.orchestrator import AgentOrchestrator, LLMGateway
    from app.db.tenancy import current_tenant_id
    client, _ = workspace
    cid = await room(client, 'steering-owner')
    incoming = (await client.post(f'/api/conversations/{cid}/messages', headers={'x-grokbot-user-id': 'steering-owner'},
        json={'sender_type': 'user', 'content': 'Hello!'})).json()
    runner = AgentOrchestrator()
    checks = calls = loads = 0
    async def directions(*args):
        nonlocal checks
        checks += 1
        return [SimpleNamespace(content='Updated direction: Review the Python concurrency bug.')] if checks == 2 else []
    async def plugins(*args):
        nonlocal loads
        loads += 1
    async def complete(**kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            assert kwargs['options'].max_tokens == 256 and kwargs['tools'] is None
        else:
            assert kwargs['options'].max_tokens == 2048 and kwargs['options'].allow_tools is True
            assert kwargs['tools'] and kwargs['model'] != 'gpt-6-luna'
            assert 'Updated direction:' in json.dumps(kwargs['messages'])
        return litellm.ModelResponse(choices=[{'message': {'role': 'assistant', 'content': 'Checked the supplied information.'}}])
    monkeypatch.setattr(runner, '_new_directions', directions)
    monkeypatch.setattr(runner.registry, 'load_plugins', plugins)
    monkeypatch.setattr(LLMGateway, 'complete', complete)
    tenant = current_tenant_id.set('steering-owner')
    try:
        await runner.process_message(cid, 'Hello!', incoming_message_id=incoming['message_id'])
    finally:
        current_tenant_id.reset(tenant)
    assert calls == 2 and loads == 1
