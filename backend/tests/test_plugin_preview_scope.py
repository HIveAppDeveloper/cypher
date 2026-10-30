"""Selected-account preview stays tenant-scoped and read-only end to end."""
from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import select

from app.db.tenancy import current_tenant_id
from app.models.conversation import ConversationParticipant
from app.models.execution import TaskExecution
from app.models.plugin import Plugin
from app.models.task import Task
from app.services import plugins, worker
from .test_workspace_workflows import room, workspace


SCHEMA = {'type': 'object', 'properties': {}}


def service(name, tools, *, enabled=True):
    return Plugin(name=name, url=f'https://{name.lower().replace(" ", "-")}.example/mcp',
                  credential='synthetic-grant', enabled=enabled, tools=tools)


@pytest.mark.asyncio
async def test_selected_preview_executes_only_selected_read_only_account(workspace, monkeypatch):
    from app.services.tools.registry import ToolRegistry
    from app.db import session as database
    _, sessions = workspace
    tenant = current_tenant_id.set('preview-scope-owner')
    approvals, provider_calls = [], []
    monkeypatch.setattr(plugins, 'reveal', lambda _credential: 'synthetic-token')
    monkeypatch.setattr(database, 'AsyncSessionLocal', sessions)
    async def approve(name, arguments, bot_id, replay_safe, force=False):
        approvals.append((name, replay_safe))
        return True
    async def connection_auth(db, plugin):
        return 'synthetic-token', None
    @asynccontextmanager
    async def provider_session(url, token, auth):
        provider_calls.append((url, token, auth))
        class Client:
            async def call_tool(self, tool_name, arguments):
                provider_calls.append((tool_name, arguments))
                return SimpleNamespace(content=[SimpleNamespace(type='text', text='Synthetic profile data')],
                                       isError=False, structuredContent=None)
        yield Client()
    monkeypatch.setattr('app.services.computer.approve_tool', approve)
    monkeypatch.setattr(plugins, 'connection_auth', connection_auth)
    monkeypatch.setattr(plugins, 'session', provider_session)
    try:
        async with sessions() as db:
            chosen = service('GitHub Work', [
                {'name': 'read_profile', 'description': 'Read the current profile', 'schema': SCHEMA, 'read_only': True},
                {'name': 'delete_project', 'description': 'Delete a project', 'schema': SCHEMA, 'read_only': False},
                {'name': 'misannotated_tool', 'description': 'Untrusted string annotation', 'schema': SCHEMA, 'read_only': 'false'},
            ])
            sibling = service('GitHub Personal', [
                {'name': 'read_profile', 'description': 'Read the current profile', 'schema': SCHEMA, 'read_only': True},
            ])
            db.add_all([chosen, sibling])
            await db.commit()
            bot = SimpleNamespace(tools_enabled=['browser', 'plugins'])
            registry = ToolRegistry()
            await registry.load_plugins(db, bot, plugin_scope_id=chosen.id)

            assert {tool['function']['name'] for tool in registry.get_scoped_plugin_tools()} == {'plugin_search', 'plugin_call'}
            assert {(tool['plugin_id'], tool['name']) for tool in registry._plugin_manifest} == {(chosen.id, 'read_profile')}
            found = await registry.execute_tool('plugin_search', {'query': ''}, 'synthetic-agent')
            assert {(tool['plugin_id'], tool['name']) for tool in found['tools']} == {(chosen.id, 'read_profile')}

            before = len(approvals)
            denied_search = await registry.execute_tool('plugin_search', {'query': 'read_profile', 'plugin_id': sibling.id}, 'synthetic-agent')
            denied_sibling = await registry.execute_tool('plugin_call', {'plugin_id': sibling.id, 'tool_name': 'read_profile', 'arguments': {}}, 'synthetic-agent')
            denied_write = await registry.execute_tool('plugin_call', {'plugin_id': chosen.id, 'tool_name': 'delete_project', 'arguments': {}}, 'synthetic-agent')
            assert denied_search['code'] == 'preview_scope_denied'
            assert denied_sibling['code'] == denied_write['code'] == 'preview_scope_denied'
            assert len(approvals) == before, 'scope denials must happen before approval prompts'
            assert provider_calls == []

            result = await registry.execute_tool('plugin_call', {'plugin_id': chosen.id, 'tool_name': 'read_profile', 'arguments': {'section': 'me'}}, 'synthetic-agent')
            assert result['success'] is True
            assert provider_calls == [('https://github-work.example/mcp', 'synthetic-token', None),
                                      ('read_profile', {'section': 'me'})]

            # Normal unscoped chats still see account variants and ask approval for writes.
            await registry.load_plugins(db, SimpleNamespace(tools_enabled=['plugins']))
            assert {tool['plugin_id'] for tool in registry._plugin_manifest} == {chosen.id, sibling.id}
            write_approvals = []
            async def deny_write_approval(name, arguments, bot_id, replay_safe, force=False):
                write_approvals.append((name, replay_safe))
                return False
            monkeypatch.setattr('app.services.computer.approve_tool', deny_write_approval)
            result = await registry.execute_tool('plugin_call', {'plugin_id': chosen.id, 'tool_name': 'delete_project', 'arguments': {}}, 'synthetic-agent')
            assert 'error' in result and write_approvals == [('plugin_call', False)]
            assert len(provider_calls) == 2

            # Empty tool settings preserve the existing allow-all convention.
            await registry.load_plugins(db, SimpleNamespace(tools_enabled=[]))
            all_tools = {tool['function']['name'] for tool in registry.get_tools_for_bot(SimpleNamespace(tools_enabled=[]))}
            assert {'plugin_search', 'plugin_call'} <= all_tools
            # A nonempty list that omits plugins continues to disable the router.
            await registry.load_plugins(db, SimpleNamespace(tools_enabled=['browser']))
            assert not any(name.startswith('plugin_') for name in registry._tools)
    finally:
        current_tenant_id.reset(tenant)


@pytest.mark.asyncio
async def test_missing_disabled_foreign_and_write_only_connections_fail_closed(workspace, monkeypatch):
    from app.services.tools.registry import ToolRegistry
    _, sessions = workspace
    monkeypatch.setattr(plugins, 'reveal', lambda _credential: 'synthetic-token')
    calls, approvals = [], []
    async def invoke(*args):
        calls.append(args)
        return {'success': True, 'content': 'Should not run'}
    async def approve(*args, **kwargs):
        approvals.append(args)
        return True
    monkeypatch.setattr(plugins, 'invoke', invoke)
    monkeypatch.setattr('app.services.computer.approve_tool', approve)

    owner = current_tenant_id.set('preview-scope-owner')
    try:
        async with sessions() as db:
            disabled = service('Disabled account', [{'name': 'read_profile', 'schema': SCHEMA, 'read_only': True}], enabled=False)
            write_only = service('Write only account', [{'name': 'create_record', 'schema': SCHEMA, 'read_only': False}])
            restricted = service('Restricted account', [{'name': 'read_profile', 'schema': SCHEMA, 'read_only': True}])
            db.add_all([disabled, write_only, restricted])
            await db.commit()
            disabled_id, write_only_id, restricted_id = disabled.id, write_only.id, restricted.id
        foreign = current_tenant_id.set('another-workspace')
        try:
            async with sessions() as db:
                foreign_plugin = service('Foreign account', [{'name': 'read_profile', 'schema': SCHEMA, 'read_only': True}])
                db.add(foreign_plugin)
                await db.commit()
                foreign_id = foreign_plugin.id
        finally:
            current_tenant_id.reset(foreign)

        unavailable_ids = [str(uuid4()), disabled_id, foreign_id, write_only_id]
        async with sessions() as db:
            registry = ToolRegistry()
            for plugin_id in unavailable_ids:
                await registry.load_plugins(db, SimpleNamespace(tools_enabled=[]), plugin_scope_id=plugin_id)
                found = await registry.execute_tool('plugin_search', {'query': ''}, 'synthetic-agent')
                denied = await registry.execute_tool('plugin_call', {'plugin_id': plugin_id, 'tool_name': 'read_profile', 'arguments': {}}, 'synthetic-agent')
                assert found['code'] == 'preview_scope_unavailable'
                assert denied['code'] == 'preview_scope_denied'
            other_calls = []
            async def other_handler(arguments, bot_id):
                other_calls.append((arguments, bot_id))
                return {'success': True}
            registry.register('other_tool', 'Synthetic unrelated tool.', {'type':'object'}, other_handler)
            await registry.load_plugins(db, SimpleNamespace(tools_enabled=['browser']), plugin_scope_id=restricted_id)
            found = await registry.execute_tool('plugin_search', {'query': ''}, 'synthetic-agent')
            denied = await registry.execute_tool('plugin_call', {'plugin_id': restricted_id, 'tool_name': 'read_profile', 'arguments': {}}, 'synthetic-agent')
            other = await registry.execute_tool('other_tool', {}, 'synthetic-agent')
            assert found['code'] == 'preview_scope_unavailable'
            assert denied['code'] == other['code'] == 'preview_scope_denied'
            assert not other_calls, 'a scoped preview cannot execute unrelated registered tools'
            assert len(registry.get_scoped_plugin_tools()) == 2, 'router tools explain the block without exposing a provider manifest'
        no_tenant = current_tenant_id.set(None)
        try:
            async with sessions() as db:
                registry = ToolRegistry()
                await registry.load_plugins(db, SimpleNamespace(tools_enabled=[]), plugin_scope_id=foreign_id)
                found = await registry.execute_tool('plugin_search', {'query': ''}, 'synthetic-agent')
                assert found['code'] == 'preview_scope_unavailable'
        finally:
            current_tenant_id.reset(no_tenant)
        assert calls == [] and approvals == []
    finally:
        current_tenant_id.reset(owner)


@pytest.mark.asyncio
async def test_preview_rechecks_auth_tool_and_enabled_state_before_and_after_approval(workspace, monkeypatch):
    from app.db import session as database
    from app.services.tools.registry import ToolRegistry
    _, sessions = workspace
    owner = current_tenant_id.set('preview-revalidation-owner')
    monkeypatch.setattr(plugins, 'reveal', lambda credential: 'synthetic-token' if credential else None)
    monkeypatch.setattr(database, 'AsyncSessionLocal', sessions)
    calls, approvals = [], []
    mutate_after_approval = {'value': False}

    async def connection_auth(db, plugin):
        return 'synthetic-token', None

    @asynccontextmanager
    async def provider_session(url, token, auth):
        class Client:
            async def call_tool(self, tool_name, arguments):
                calls.append((url, token, tool_name, arguments))
                return SimpleNamespace(content=[SimpleNamespace(type='text', text='Current synthetic data')],
                                       isError=False, structuredContent=None)
        yield Client()

    async def update_connection(connection_id, **changes):
        async with sessions() as update_db:
            plugin = await update_db.get(Plugin, connection_id)
            for key, value in changes.items():
                setattr(plugin, key, value)
            await update_db.commit()

    async def approve(name, arguments, bot_id, replay_safe, force=False):
        approvals.append((name, replay_safe))
        if name == 'plugin_call' and mutate_after_approval['value']:
            await update_connection(connection_id, tools=[{'name':'read_profile','schema':SCHEMA,'read_only':False}])
        return True

    monkeypatch.setattr(plugins, 'connection_auth', connection_auth)
    monkeypatch.setattr(plugins, 'session', provider_session)
    monkeypatch.setattr('app.services.computer.approve_tool', approve)
    try:
        async with sessions() as db:
            connection = service('Recheck account', [{'name':'read_profile','schema':SCHEMA,'read_only':True}])
            db.add(connection)
            await db.commit()
            connection_id = connection.id
            registry = ToolRegistry()
            await registry.load_plugins(db, SimpleNamespace(tools_enabled=['plugins']), plugin_scope_id=connection_id)


        # Revocation after discovery must deny the call without asking approval.
        await update_connection(connection_id, credential=None)
        denied_auth = await registry.execute_tool('plugin_call', {'plugin_id':connection_id,'tool_name':'read_profile','arguments':{}}, 'synthetic-agent')
        assert denied_auth['code'] == 'preview_scope_denied'
        assert approvals == [] and calls == []

        # A changed or malformed read-only annotation is caught before approval.
        await update_connection(connection_id, credential='synthetic-grant', tools=[{'name':'read_profile','schema':SCHEMA,'read_only':'false'}])
        denied_annotation = await registry.execute_tool('plugin_call', {'plugin_id':connection_id,'tool_name':'read_profile','arguments':{}}, 'synthetic-agent')
        assert denied_annotation['code'] == 'preview_scope_denied'
        assert approvals == [] and calls == []

        # Current connection enablement is also rechecked after discovery.
        await update_connection(connection_id, tools=[{'name':'read_profile','schema':SCHEMA,'read_only':True}], enabled=False)
        denied_disabled = await registry.execute_tool('plugin_call', {'plugin_id':connection_id,'tool_name':'read_profile','arguments':{}}, 'synthetic-agent')
        assert denied_disabled['code'] == 'preview_scope_denied'
        assert approvals == [] and calls == []

        # A settings change while approval is pending is checked again by the
        # direct handler and invocation guard before any provider request.
        await update_connection(connection_id, enabled=True)
        mutate_after_approval['value'] = True
        denied_after_approval = await registry.execute_tool('plugin_call', {'plugin_id':connection_id,'tool_name':'read_profile','arguments':{}}, 'synthetic-agent')
        assert denied_after_approval['code'] == 'preview_scope_denied'
        assert approvals == [('plugin_call', True)] and calls == []

        raw_handler = await registry._tools['plugin_call']['handler'](
            {'plugin_id':connection_id,'tool_name':'read_profile','arguments':{}}, 'synthetic-agent')
        assert raw_handler['code'] == 'preview_scope_denied' and calls == []
        direct = await plugins.invoke(connection_id, 'read_profile', {}, preview_scope_id=connection_id)
        assert direct['code'] == 'preview_scope_denied' and calls == []

        await update_connection(connection_id, tools=[{'name':'read_profile','schema':SCHEMA,'read_only':True}])
        mutate_after_approval['value'] = False
        live = await plugins.scoped_preview_snapshot(connection_id, connection_id)
        assert live and [tool['name'] for tool in live['tools']] == ['read_profile'], live
        result = await registry.execute_tool('plugin_call', {'plugin_id':connection_id,'tool_name':'read_profile','arguments':{}}, 'synthetic-agent')
        assert result['success'] is True, result
        assert calls == [('https://recheck-account.example/mcp','synthetic-token','read_profile',{})]
    finally:
        current_tenant_id.reset(owner)


@pytest.mark.asyncio
async def test_preview_scope_is_saved_and_forwarded_to_worker(workspace, monkeypatch):
    client, sessions = workspace
    owner = 'preview-task-owner'
    conversation_id = await room(client, owner)
    plugin_id = str(uuid4())
    invalid_media = await client.post(
        f'/api/conversations/{conversation_id}/messages',
        headers={'x-grokbot-user-id': owner},
        json={'sender_type':'user','content':'Do not turn a scoped preview into image generation',
              'options':{'allow_tools':True,'plugin_scope_id':plugin_id,'output':'image'}},
    )
    assert invalid_media.status_code == 422
    response = await client.post(
        f'/api/conversations/{conversation_id}/messages',
        headers={'x-grokbot-user-id': owner},
        json={'sender_type': 'user', 'content': 'Preview my connected account',
              'options': {'allow_tools': True, 'plugin_scope_id': plugin_id}},
    )
    assert response.status_code == 202, response.text
    task_id = response.json()['task_id']
    seen = {}

    class CapturingOrchestrator:
        async def process_message(self, *args, **kwargs):
            seen.update(kwargs)
            return [{'sender_type': 'bot', 'content': 'Synthetic preview complete'}]

    monkeypatch.setattr(worker, 'AgentOrchestrator', CapturingOrchestrator)
    tenant = current_tenant_id.set(owner)
    try:
        async with sessions() as db:
            task = await db.get(Task, task_id)
            assert task.result['request']['options']['plugin_scope_id'] == plugin_id
            bot_id = await db.scalar(select(ConversationParticipant.bot_id).where(ConversationParticipant.conversation_id == conversation_id))
            db.add(TaskExecution(task_id=task_id, attempts=1, recoveries=0))
            await db.commit()
        claim = SimpleNamespace(id=task_id, tenant_id=owner, attempt=1, conversation_id=conversation_id,
                                bot_ids=[bot_id])
        await worker._run_claimed_task(claim)
        assert seen['options']['plugin_scope_id'] == plugin_id
        async with sessions() as db:
            finished = await db.get(Task, task_id)
            assert finished.status == 'completed'
    finally:
        current_tenant_id.reset(tenant)


def test_plugin_scope_option_requires_a_uuid():
    from pydantic import ValidationError
    from app.schemas.input import RunOptions
    with pytest.raises(ValidationError):
        RunOptions(plugin_scope_id='not-a-connection-id')
    valid = str(uuid4())
    assert RunOptions(plugin_scope_id=valid).plugin_scope_id == valid
    with pytest.raises(ValidationError):
        RunOptions(plugin_scope_id=valid, output='image')
