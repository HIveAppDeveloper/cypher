import json
from types import SimpleNamespace

import litellm
import pytest

from app.db.tenancy import current_tenant_id
from app.services.orchestrator import AgentOrchestrator, LLMGateway
from app.services.tools.registry import ToolRegistry
from .test_workspace_workflows import workspace, room


def test_github_and_skill_tools_respect_categories_and_replay_safety():
    registry = AgentOrchestrator().registry
    names = lambda category: {t['function']['name'] for t in registry.get_tools_for_bot(SimpleNamespace(tools_enabled=category))}
    for category in ('github', 'browser', 'research'):
        assert {'github_search', 'github_read'} <= names([category])
    assert 'github_read' not in names(['plugins'])
    assert {'choose_agent_skills', 'search_agent_skills'} <= names(['plugins'])
    assert registry.replay_safe('choose_agent_skills', {})
    assert registry.replay_safe('github_read', {})


@pytest.mark.asyncio
async def test_skill_choice_is_owned_write_approval_not_a_permission_upgrade(workspace, monkeypatch):
    from app.services import computer
    client, sessions = workspace
    cid = await room(client, 'approval-skill-owner')
    bot = (await client.get('/api/bots', headers={'x-grokbot-user-id': 'approval-skill-owner'})).json()[0]['id']
    observed = []
    async def deny(name, args, bot_id, replay_safe, **kwargs):
        observed.append((name, replay_safe))
        return False
    monkeypatch.setattr(computer, 'approve_tool', deny)
    runner = AgentOrchestrator()
    token = current_tenant_id.set('approval-skill-owner')
    try:
        result = await runner.registry.execute_tool('choose_agent_skills', {'skill_ids': [
            'python.execution-plan', 'python.reproduction', 'python.summary', 'python.quality-review', 'python.regression-check']}, bot)
        assert 'error' in result
        from app.services.agent_skills import get_agent_skills
        async with sessions() as db:
            assert (await get_agent_skills(db, bot))['persisted'] is False
    finally:
        current_tenant_id.reset(token)
    assert observed == [('choose_agent_skills', False)]


@pytest.mark.asyncio
async def test_agent_can_choose_five_skills_and_continue_as_full_tool_enabled_bot(workspace, monkeypatch):
    from app.services.agent_skills import get_agent_skills
    client, sessions = workspace
    cid = await room(client, 'choosing-owner')
    bot = (await client.get('/api/bots', headers={'x-grokbot-user-id': 'choosing-owner'})).json()[0]['id']
    ids = ['python.execution-plan', 'python.reproduction', 'python.quality-review', 'python.regression-check', 'python.summary']
    incoming = (await client.post(f'/api/conversations/{cid}/messages', headers={'x-grokbot-user-id': 'choosing-owner'},
        json={'sender_type': 'user', 'content': 'Review the supplied Python evidence. Choose useful skills.'})).json()
    calls = []
    async def complete(**kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            names = {t['function']['name'] for t in kwargs['tools']}
            assert {'choose_agent_skills', 'search_agent_skills', 'github_read', 'browse_url'} <= names
            assert 'five skill recipes' in kwargs['messages'][0]['content']
            msg = {'role': 'assistant', 'content': None, 'tool_calls': [{
                'id': 'choose-five', 'type': 'function', 'function': {'name': 'choose_agent_skills', 'arguments': json.dumps({'skill_ids': ids})}}]}
        else:
            saved = json.loads(kwargs['messages'][-1]['content'])
            assert saved['selected_by'] == 'agent' and saved['skill_ids'] == ids
            assert saved['permissions_unchanged'] is True
            msg = {'role': 'assistant', 'content': 'The five selected recipes support the supplied review; no external action was performed.'}
        return litellm.ModelResponse(choices=[{'message': msg}])
    monkeypatch.setattr(LLMGateway, 'complete', complete)
    token = current_tenant_id.set('choosing-owner')
    try:
        answer = await AgentOrchestrator().process_message(cid, 'Review the supplied Python evidence. Choose useful skills.',
            incoming_message_id=incoming['message_id'])
        async with sessions() as db:
            assert (await get_agent_skills(db, bot))['skill_ids'] == ids
    finally:
        current_tenant_id.reset(token)
    assert len(calls) == 2 and answer[-1]['message_type'] == 'text'
    assert all((msg.get('metadata') or {}).get('internal') for msg in answer[:-1])


@pytest.mark.asyncio
async def test_voice_reply_defers_skill_loading_selection_and_catalog_prompt(workspace, monkeypatch):
    from app.services import agent_skills
    client, _ = workspace
    cid = await room(client, 'voice-skill-owner')
    incoming = (await client.post(f'/api/conversations/{cid}/messages', headers={'x-grokbot-user-id': 'voice-skill-owner'},
        json={'sender_type': 'user', 'content': 'Explain the Python concurrency review briefly.', 'options': {'voice_mode': True}})).json()
    async def forbidden(*args):
        pytest.fail('Routine voice must not load or select five skill profiles')
    async def complete(**kwargs):
        system = kwargs['messages'][0]['content']
        assert 'Relevant internal skill recipes' not in system and 'five skill recipes' not in system
        assert 'defer skill selection' in system
        assert kwargs['options'].max_tokens == 1024
        return litellm.ModelResponse(choices=[{'message': {'role': 'assistant', 'content': 'Concurrent writes need an explicit ordering check.'}}])
    monkeypatch.setattr(agent_skills, 'prompt_for_bot', forbidden)
    monkeypatch.setattr(LLMGateway, 'complete', complete)
    token = current_tenant_id.set('voice-skill-owner')
    try:
        answer = await AgentOrchestrator().process_message(cid, 'Explain the Python concurrency review briefly.',
            incoming_message_id=incoming['message_id'], options={'voice_mode': True})
    finally:
        current_tenant_id.reset(token)
    assert answer[-1]['message_type'] == 'text'
