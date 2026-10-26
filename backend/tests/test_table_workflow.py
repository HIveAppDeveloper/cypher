"""Data tool discovery and API→worker→uploaded CSV→analysis/chart→download."""
import asyncio
import base64
from contextlib import suppress
import io
import json
from types import SimpleNamespace

import litellm
from PIL import Image
import pytest

from app.services.tools.registry import ToolRegistry
from .test_workspace_workflows import workspace


@pytest.mark.parametrize('categories', [[], ['filesystem'], ['media'], ['charts'], ['visualization'], ['data'], ['analysis']])
def test_tool_is_discoverable_for_data_categories_and_replay_safe(categories):
    registry = ToolRegistry()
    registry.register_default_tools()
    tools = registry.get_tools_for_bot(SimpleNamespace(tools_enabled=categories))
    tool = next(t['function'] for t in tools if t['function']['name'] == 'analyze_table')
    assert {'attachment_index', 'metrics', 'chart_type'} <= set(tool['parameters']['properties'])
    assert registry.replay_safe('analyze_table', {'attachment_index': 0}) is True
    assert 'analyze_table' not in {t['function']['name'] for t in registry.get_tools_for_bot(SimpleNamespace(tools_enabled=['prospecting']))}


@pytest.mark.asyncio
async def test_upload_analysis_and_chart_complete_in_one_tool_call_and_two_model_turns(workspace, monkeypatch):
    from app.services import worker
    from app.services.llm_gateway import LLMGateway
    from app.services.sandbox import SandboxManager
    client, _ = workspace
    headers = {'x-grokbot-user-id': 'data-workflow-owner'}
    bot = (await client.post('/api/bots', headers=headers, json={
        'name': 'CSV analyst', 'role': 'Analyst', 'system_prompt': 'Analyze real supplied data.',
        'llm_provider': 'openai', 'llm_model': 'gpt-6-luna', 'tools_enabled': ['data']})).json()['id']
    room = (await client.post('/api/conversations', headers=headers, json={'title': 'CSV test', 'bot_ids': [bot]})).json()['id']
    calls, files = [], []

    def no_sandbox(*args, **kwargs):
        raise AssertionError('Data analysis must not start a sandbox')
    for method in ('create_sandbox', 'exec_in_sandbox', 'read_artifact'):
        monkeypatch.setattr(SandboxManager, method, no_sandbox)

    async def complete(**kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            assert 'analyze_table' in {t['function']['name'] for t in kwargs['tools']}
            response = {'role': 'assistant', 'content': None, 'tool_calls': [{
                'id': 'analyze-original-upload', 'type': 'function', 'function': {'name': 'analyze_table',
                'arguments': json.dumps({'attachment_index': 0, 'data_origin': 'user_provided',
                    'group_by': 'team', 'metrics': [{'column': 'revenue', 'operation': 'sum', 'name': 'total'}],
                    'chart_type': 'bar', 'chart_metric': 'total', 'title': 'Actual uploaded revenue'})}}]}
        else:
            result = json.loads(kwargs['messages'][-1]['content'])
            assert result['success'] and result['row_count'] == 3
            assert [(g['group'], g['metrics']['total']['value']) for g in result['groups']] == [('A', .3), ('B', .4)]
            files.extend(result['files'])
            response = {'role': 'assistant', 'content': f'A totals 0.3; B totals 0.4.\n![Revenue]({files[0]["url"]})'}
        return litellm.ModelResponse(choices=[{'index': 0, 'message': response, 'finish_reason': 'stop'}])

    monkeypatch.setattr(LLMGateway, 'complete', complete)
    accepted = await client.post(f'/api/conversations/{room}/messages', headers=headers, json={
        'sender_type': 'user', 'content': 'Calculate revenue by team and chart the totals from this CSV.',
        'options': {'routing': 'manual', 'max_iterations': 2}, 'attachments': [{
            'name': 'revenue.csv', 'mime': 'text/plain',
            'data': base64.b64encode(b'team,revenue\nA,0.1\nA,0.2\nB,0.4\n').decode()}]})
    assert accepted.status_code == 202
    runner = asyncio.create_task(worker.run_worker())
    try:
        async with asyncio.timeout(10):
            while True:
                tasks = (await client.get(f'/api/conversations/{room}/tasks', headers=headers)).json()
                if tasks[0]['status'] in {'completed', 'failed'}:
                    break
                await asyncio.sleep(.03)
        assert tasks[0]['status'] == 'completed'
        assert len(calls) == 2 and len(files) == 3
        for index, file in enumerate(files):
            response = await client.get(file['url'], headers=headers)
            assert response.status_code == 200
            assert (await client.get(file['url'], headers={'x-grokbot-user-id': 'other-owner'})).status_code == 404
            if index == 0:
                assert Image.open(io.BytesIO(response.content)).size == (1280, 820)
            elif index == 1:
                assert response.content.startswith(b'<svg')
            else:
                assert b'A,0.3' in response.content and b'B,0.4' in response.content
    finally:
        runner.cancel()
        with suppress(asyncio.CancelledError):
            await runner
