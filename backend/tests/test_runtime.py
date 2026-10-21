import os
import asyncio
import importlib.util
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

os.environ['LITELLM_LOCAL_MODEL_COST_MAP'] = 'True'
os.environ['GROKBOT_DATABASE_URL'] = 'sqlite+aiosqlite://'
from app.db.connection import engine_options
from app.config import Settings
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.schema import CreateTable
import pytest

def test_native_postgres_tls_and_prisma_parameters():
    url, options = engine_options('postgresql://user:p%40ss@db.example/test?sslmode=require&pgbouncer=true&connection_limit=1&schema=public')
    assert url.drivername == 'postgresql+asyncpg'
    assert url.password == 'p@ss'
    assert options['connect_args']['ssl'] == 'require'
    assert not {'pgbouncer','connection_limit','schema','sslmode'} & set(url.query)

@pytest.mark.parametrize('url',['prisma://proxy.example/?api_key=fake','prisma+postgres://proxy.example/?api_key=fake'])
def test_prisma_proxy_fails_clearly(url):
    with pytest.raises(ValueError,match='native'):
        engine_options(url)

def test_namespaced_config_and_cors(monkeypatch):
    monkeypatch.delenv('GROKBOT_DATABASE_URL')
    monkeypatch.setenv('HIVE_DATABASE_URL','postgresql://hive/db')
    monkeypatch.setenv('ATLAS_DATABASE_URL','postgresql://atlas/db')
    monkeypatch.setenv('CORS_ORIGINS','http://localhost:3000,https://example.com')
    s=Settings(_env_file=None)
    assert s.DATABASE_URL == 'postgresql://hive/db'
    assert len(s.CORS_ORIGINS)==2
    with pytest.raises(ValueError): Settings(_env_file=None,DATABASE_SCHEMA='public; DROP SCHEMA public')

@pytest.mark.asyncio
async def test_persisted_job_and_messages(tmp_path,monkeypatch):
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from app.db.session import Base
    from app.main import app
    from app.db.session import get_db
    from app.services import worker, orchestrator
    from app.services.llm_gateway import LLMGateway
    engine=create_async_engine(f'sqlite+aiosqlite:///{tmp_path}/test.db')
    sessions=async_sessionmaker(engine,expire_on_commit=False)
    async with engine.begin() as conn: await conn.run_sync(Base.metadata.create_all)
    async def get_session():
        async with sessions() as session: yield session
    async def complete(**kwargs):
        assert kwargs['messages'][-1]['content']=='Check the pipeline'
        message=SimpleNamespace(content='Pipeline checked.',tool_calls=None)
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])
    monkeypatch.setattr(worker,'AsyncSessionLocal',sessions)
    from app.services import verification
    monkeypatch.setattr(verification,'AsyncSessionLocal',sessions)
    monkeypatch.delenv('GROKBOT_VERIFY_CLOUD',raising=False)
    monkeypatch.setattr(orchestrator,'AsyncSessionLocal',sessions)
    monkeypatch.setattr(LLMGateway,'complete',complete)
    from app.config import settings
    monkeypatch.setattr(settings, 'BACKEND_API_TOKEN', 'test-only-token-32-characters-minimum')
    app.dependency_overrides[get_db]=get_session
    try:
        async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test',headers={'Authorization':'Bearer test-only-token-32-characters-minimum'}) as client:
            assert (await client.get('/api/bots', headers={'Authorization':''})).status_code == 401
            response=await client.post('/api/bots',json={'name':'Hive Reach','role':'Outreach','system_prompt':'Research first.','llm_provider':'gemini','llm_model':'gemini-2.5-flash'})
            assert response.status_code==200,response.text
            bot=response.json()
            assert (await client.get('/api/bots/'+bot['id'])).status_code==200
            duplicate = await client.post('/api/bots', json={'name':'Hive Reach','role':'Outreach','system_prompt':'Research first.','llm_provider':'gemini','llm_model':'gemini-2.5-flash'})
            assert duplicate.status_code == 409 and 'already in use' in duplicate.json()['detail']
            defaults = {'name':'','role':'Assistant','system_prompt':'Help.','llm_provider':'gemini','llm_model':'gemini-2.5-flash'}
            first = (await client.post('/api/bots',json=defaults)).json()
            second = (await client.post('/api/bots',json=defaults)).json()
            assert first['name'] == 'Assistant' and second['name'] == 'Assistant 2'
            lounge = (await client.post('/api/teams/default')).json()
            again = (await client.post('/api/teams/default')).json()
            assert lounge['id'] == again['id'] and len(lounge['bot_ids']) == 6
            from app.api import plugins as plugin_api
            async def fake_discover(url, token):
                assert token == 'private-plugin-token'
                return [{'name':'lookup','description':'Look up a record','schema':{'type':'object','properties':{}}}]
            monkeypatch.setattr(plugin_api, 'discover', fake_discover)
            connection = await client.post('/api/plugins', json={'name':'Example MCP','url':'https://example.com/mcp','token':'private-plugin-token'})
            assert connection.status_code == 200
            plugin = connection.json()
            assert plugin['authenticated'] and 'credential' not in plugin and 'private-plugin-token' not in connection.text
            from app.models.plugin import Plugin
            async with sessions() as private_db:
                saved = await private_db.get(Plugin, plugin['id'])
                assert saved.credential != 'private-plugin-token'
                from app.services.plugins import reveal
                assert reveal(saved.credential) == 'private-plugin-token'
            toggled = await client.patch('/api/plugins/' + plugin['id'], json={'enabled':False})
            assert toggled.json()['enabled'] is False
            assert (await client.delete('/api/plugins/' + plugin['id'])).status_code == 200

            conv=(await client.post('/api/conversations',json={'title':'Hive','bot_ids':[bot['id']]})).json()
            client_id=str(uuid4())
            response=await client.post(f"/api/conversations/{conv['id']}/messages",json={'sender_type':'user','content':'Check the pipeline','client_message_id':client_id})
            assert response.status_code==202,response.text
            immediate=(await client.get(f"/api/conversations/{conv['id']}/messages")).json()
            assert len(immediate)==1 and immediate[0]['id']==client_id
            repeated=await client.post(f"/api/conversations/{conv['id']}/messages",json={'sender_type':'user','content':'Check the pipeline','client_message_id':client_id})
            assert repeated.json()['task_id']==response.json()['task_id']
            assert len((await client.get(f"/api/conversations/{conv['id']}/tasks")).json())==1
            assert (await client.get(f"/api/conversations/{conv['id']}/tasks")).json()[0]['status']=='pending'
            # Job survives request completion and is picked up by a separately started worker.
            task=asyncio.create_task(worker.run_worker())
            for _ in range(100):
                await asyncio.sleep(.03)
                jobs=(await client.get(f"/api/conversations/{conv['id']}/tasks")).json()
                if jobs[0]['status'] in ('completed','failed'): break
            assert jobs[0]['status']=='completed',jobs
            task.cancel()
            try: await task
            except asyncio.CancelledError: pass
            messages=(await client.get(f"/api/conversations/{conv['id']}/messages")).json()
            assert [m['content'] for m in messages]==['Pipeline checked.','Check the pipeline']
            older=(await client.get(f"/api/conversations/{conv['id']}/messages?before_id={messages[0]['id']}")).json()
            assert [m['content'] for m in older]==['Check the pipeline']
            extra = (await client.post(f"/api/conversations/{conv['id']}/messages", json={'sender_type':'user','content':'Do not execute this cancelled task'})).json()
            cancelled = await client.post(f"/api/conversations/{conv['id']}/tasks/{extra['task_id']}/cancel")
            assert cancelled.status_code == 202 and cancelled.json()['status'] == 'cancelled'
            assert (await client.get(f"/api/conversations/{conv['id']}/messages?before_id={uuid4()}")).status_code==404
            assert (await client.post(f'/api/conversations/{uuid4()}/messages',json={'sender_type':'user','content':'x'})).status_code==404
            assert (await client.get(f"/api/conversations/{conv['id']}/messages?limit=-1")).status_code==422
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()

def test_multimodal_validation_and_wire_content():
    import base64
    from app.schemas.message import MessageCreate
    from app.schemas.input import content_parts
    raw=base64.b64encode(b'brief text').decode()
    request=MessageCreate(sender_type='user',content='',attachments=[{'name':'brief.txt','mime':'text/plain','data':raw}])
    assert 'brief text' in content_parts('',[a.model_dump() for a in request.attachments])[1]['text']
    with pytest.raises(ValueError):
        MessageCreate(sender_type='user',content='x',attachments=[{'name':'bad.png','mime':'image/png','data':'not base64'}])
    with pytest.raises(ValueError):
        MessageCreate(sender_type='user',content='x',options={'team_rounds':100})

@pytest.mark.asyncio
async def test_team_handoff_shares_context_and_preserves_attachment(tmp_path,monkeypatch):
    import base64
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from app.db.session import Base, get_db
    from app.main import app
    from app.services import worker, orchestrator
    from app.services.llm_gateway import LLMGateway
    engine=create_async_engine(f'sqlite+aiosqlite:///{tmp_path}/team.db')
    sessions=async_sessionmaker(engine,expire_on_commit=False)
    async with engine.begin() as conn: await conn.run_sync(Base.metadata.create_all)
    async def get_session():
        async with sessions() as session: yield session
    seen=[]
    async def complete(**kwargs):
        seen.append(kwargs)
        is_a='RESEARCH_ROLE' in kwargs['messages'][0]['content']
        content='HANDOFF[Editor: review the attached brief]' if is_a else 'The team review is complete.'
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content,tool_calls=None))])
    monkeypatch.setattr(worker,'AsyncSessionLocal',sessions)
    from app.services import verification
    monkeypatch.setattr(verification,'AsyncSessionLocal',sessions)
    monkeypatch.delenv('GROKBOT_VERIFY_CLOUD',raising=False)
    monkeypatch.setattr(orchestrator,'AsyncSessionLocal',sessions)
    monkeypatch.setattr(LLMGateway,'complete',complete)
    app.dependency_overrides[get_db]=get_session
    task=None
    try:
        async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test') as client:
            ids=[]
            for name,prompt in [('Researcher','RESEARCH_ROLE'),('Editor','EDITOR_ROLE')]:
                response=await client.post('/api/bots',json={'name':name,'role':name,'system_prompt':prompt,'llm_provider':'gemini','llm_model':'gemini-2.5-flash','tools_enabled':['none']})
                ids.append(response.json()['id'])
            room=(await client.post('/api/conversations',json={'title':'Review room','is_group':True,'bot_ids':ids})).json()
            payload={'sender_type':'user','content':'Read the brief','attachments':[{'name':'brief.txt','mime':'text/plain','data':base64.b64encode(b'Revenue grew 12 percent.').decode()}],'options':{'team_rounds':1,'temperature':.3,'max_iterations':2,'max_tokens':512}}
            assert (await client.post(f"/api/conversations/{room['id']}/messages",json=payload)).status_code==202
            task=asyncio.create_task(worker.run_worker())
            for _ in range(100):
                await asyncio.sleep(.03)
                jobs=(await client.get(f"/api/conversations/{room['id']}/tasks")).json()
                if jobs[0]['status'] in ('completed','failed'): break
            assert jobs[0]['status']=='completed'
            assert len(seen)==2
            editor_call=next(c for c in seen if 'EDITOR_ROLE' in c['messages'][0]['content'])
            assert any(isinstance(m['content'],str) and 'Teammate Researcher' in m['content'] for m in editor_call['messages'])
            assert editor_call['options'].temperature==.3 and editor_call['options'].max_tokens==512
            rows=(await client.get(f"/api/conversations/{room['id']}/messages")).json()
            incoming=next(m for m in rows if m['sender_type']=='user')
            a=incoming['metadata_json']['attachments'][0]
            assert 'data' not in a and a['url'].endswith('/0')
            download=await client.get(a['url'])
            assert download.content==b'Revenue grew 12 percent.'
            assert (await client.get(a['url'].replace(room['id'],str(uuid4())))).status_code==404
            from app.services import media
            async def fake_media(kind, prompt, aspect_ratio, duration):
                assert kind == 'video' and duration == 4
                return [{'name': 'result.mp4', 'mime': 'video/mp4', 'data': base64.b64encode(b'persisted-video').decode()}]
            monkeypatch.setattr(media, 'generate_media', fake_media)
            queued = (await client.post(f"/api/conversations/{room['id']}/messages", json={'sender_type': 'user', 'content': 'Make a video', 'options': {'output': 'video'}})).json()
            for _ in range(100):
                await asyncio.sleep(.03)
                tasks = (await client.get(f"/api/conversations/{room['id']}/tasks")).json()
                video_task = next(t for t in tasks if t['id'] == queued['task_id'])
                if video_task['status'] in ('completed', 'failed'): break
            assert video_task['status'] == 'completed'
            output = (await client.get(f"/api/conversations/{room['id']}/messages")).json()
            video_message = next(m for m in output if m['content'] == 'Your video is ready.')
            file = video_message['metadata_json']['attachments'][0]
            assert file['mime'] == 'video/mp4' and 'data' not in file
            assert (await client.get(file['url'])).content == b'persisted-video'
    finally:
        if task:
            task.cancel()
            try: await task
            except asyncio.CancelledError: pass
        app.dependency_overrides.clear()
        await engine.dispose()


def test_gateway_model_mapping_and_credentials(monkeypatch):
    from app.services import llm_gateway
    import vercel.oidc
    from app.services.model_routing import ModelConfigurationError
    monkeypatch.setattr(vercel.oidc, 'get_vercel_oidc_token', lambda: __import__('os').getenv('VERCEL_OIDC_TOKEN'))
    monkeypatch.setattr(llm_gateway.settings, "LLM_USE_GATEWAY", True)
    monkeypatch.setenv("VERCEL_OIDC_TOKEN", "test-oidc")
    monkeypatch.delenv("AI_GATEWAY_API_KEY", raising=False)
    options = llm_gateway.completion_options("gpt-6-luna", "openai")
    assert options == {"model": "openai/responses/openai/gpt-6-luna", "api_base": "https://ai-gateway.vercel.sh/v1", "api_key": "test-oidc"}
    monkeypatch.setenv("AI_GATEWAY_API_KEY", "test-explicit")
    assert llm_gateway.completion_options("gpt-6.1-sol", "openai")["api_key"] == "test-explicit"
    monkeypatch.delenv("AI_GATEWAY_API_KEY")
    monkeypatch.delenv("VERCEL_OIDC_TOKEN")
    import pytest
    with pytest.raises(ModelConfigurationError, match="credentials unavailable"):
        llm_gateway.completion_options()


def test_supported_generation_settings(monkeypatch):
    from app.services import llm_gateway
    from app.schemas.input import RunOptions
    opts = RunOptions(reasoning_effort='high', service_tier='priority', max_tokens=1024)
    monkeypatch.setattr(llm_gateway.settings, 'LLM_USE_GATEWAY', True)
    gpt = llm_gateway.generation_options(opts, 'openai', 'gpt-5.4')
    assert gpt['reasoning_effort'] == 'high'
    assert 'temperature' not in gpt
    assert gpt['extra_body']['providerOptions']['gateway']['serviceTier'] == 'priority'
    gemini = llm_gateway.generation_options(opts, 'gemini', 'gemini-2.5-flash')
    assert 'reasoning_effort' not in gemini and 'extra_body' not in gemini
    assert gemini['temperature'] == .5
    monkeypatch.setattr(llm_gateway.settings, 'LLM_USE_GATEWAY', False)
    assert llm_gateway.generation_options(opts, 'openai', 'gpt-4.1-mini')['service_tier'] == 'priority'


@pytest.mark.asyncio
async def test_media_generation_returns_real_file_parts(monkeypatch):
    import ai
    from types import SimpleNamespace
    from ai.types.messages import FilePart
    from app.services.media import generate_media
    seen = []
    async def fake_image(model, prompt, params):
        seen.append((prompt, params.aspect_ratio))
        return SimpleNamespace(value=[FilePart(data=b'image-bytes', media_type='image/png')])
    async def fake_video(model, prompt, params):
        seen.append((prompt, params.duration))
        return SimpleNamespace(value=[FilePart(data=b'video-bytes', media_type='video/mp4')])
    monkeypatch.setattr(ai.ops, 'generate_image', fake_image)
    monkeypatch.setattr(ai.ops, 'generate_video', fake_video)
    image = (await generate_media('image', 'Scene', '1:1'))[0]
    video = (await generate_media('video', 'Scene', '16:9', 6))[0]
    assert image['mime'] == 'image/png' and video['mime'] == 'video/mp4'
    assert seen == [('Scene',None),('Scene',6)]


def test_disallowed_models_rejected_before_network():
    from app.services.llm_gateway import completion_options
    for provider, model in [('gemini', 'invented-model'), ('openai', 'unknown-model'), ('openai', 'openai/gpt-6.1-sol')]:
        with pytest.raises(ValueError, match='configured task model'):
            completion_options(model, provider)


def test_managed_computer_uses_isolated_named_vm(monkeypatch):
    from vercel.sandbox.sync import SyncSandboxClient
    from app.services.sandbox import SandboxManager
    from app.config import settings
    from vercel.sandbox._internal.sync_runtime import SyncSandbox
    assert hasattr(SyncSandbox, 'name')
    assert not hasattr(SyncSandbox, 'id')
    calls = []
    class Box:
        name = 'sandbox-test'
        def run_process(self, command, args, **kwargs):
            calls.append((command, args, kwargs))
            return SimpleNamespace(returncode=0, stdout='ran', stderr='')
        def stop(self): calls.append('stop')
    class Client:
        def get_or_create_sandbox(self, **kwargs):
            calls.append(kwargs)
            return Box(), True
        def get_sandbox(self, **kwargs):
            calls.append(kwargs)
            return Box()
        def close(self): calls.append('close')
    monkeypatch.setattr(SyncSandboxClient, 'create', lambda: Client())
    monkeypatch.setattr(settings, 'SANDBOX_BACKEND', 'vercel')
    bot_id = str(uuid4())
    assert SandboxManager.create_sandbox(bot_id) == 'sandbox-test'
    assert SandboxManager.exec_in_sandbox(bot_id, ['printf', 'hello'])['output'] == 'ran'
    SandboxManager.stop_sandbox(bot_id)
    creations = [c for c in calls if isinstance(c, dict) and 'env' in c]
    assert all(c['env'] == {} and c['persistent'] and c['name'] == 'grokbot-' + bot_id for c in creations)
    assert any(isinstance(c, tuple) and c[0] == 'printf' and c[2]['kill_after'] == 300 for c in calls)
    assert 'stop' in calls


@pytest.mark.asyncio
async def test_file_write_preserves_quotes_and_heredoc_text(monkeypatch):
    import base64, shlex
    from app.services.sandbox import SandboxManager
    from app.services.tools.filesystem import FileSystemTool
    calls = []
    def execute(bot_id, command):
        calls.append(command)
        return {'exit_code': 0, 'output': ''}
    monkeypatch.setattr(SandboxManager, 'exec_in_sandbox', execute)
    content = "it's literal\nGROKBOT_EOF\n$(must-not-run)\n"
    result = await FileSystemTool().write_file(str(uuid4()), "/workspace/it's.txt", content)
    assert result['success']
    assert calls[0][:2] == ['bash', '-lc']
    assert base64.b64encode(content.encode()).decode() in calls[0][2]
    assert shlex.quote("/workspace/it's.txt") in calls[0][2]
    assert '$(must-not-run)' not in calls[0][2]


@pytest.mark.asyncio
async def test_mcp_rejects_private_and_insecure_endpoints(monkeypatch):
    from app.services.plugins import validate_endpoint
    import socket
    monkeypatch.setattr(socket,'getaddrinfo',lambda *a,**k:[(socket.AF_INET,socket.SOCK_STREAM,6,'',('127.0.0.1',443))])
    for url in ['http://example.com/mcp','https://localhost/mcp','https://example.com/mcp?token=secret']:
        with pytest.raises(ValueError): await validate_endpoint(url)


def test_sol61_uses_responses_bridge(monkeypatch):
    from app.services import llm_gateway
    monkeypatch.setattr(llm_gateway.settings,'LLM_USE_GATEWAY',True)
    monkeypatch.setenv('AI_GATEWAY_API_KEY','test-only')
    options=llm_gateway.completion_options('gpt-6.1-sol','openai')
    assert options['model']=='openai/responses/openai/gpt-6.1-sol'


@pytest.mark.asyncio
async def test_coordinator_delegates_and_synthesizes_shared_work(tmp_path, monkeypatch):
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from app.db.session import Base
    from app.models.bot import Bot
    from app.models.conversation import Conversation, ConversationParticipant
    from app.services import orchestrator
    from app.services.llm_gateway import LLMGateway
    engine = create_async_engine(f'sqlite+aiosqlite:///{tmp_path}/coordinator.db')
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn: await conn.run_sync(Base.metadata.create_all)
    monkeypatch.setattr(orchestrator, 'AsyncSessionLocal', sessions)
    seen=[]
    async def complete(**kwargs):
        seen.append(kwargs)
        system = kwargs['messages'][0]['content']
        if 'Plan this task briefly' in system:
            content='HANDOFF[Researcher: check the source]'
        elif 'The specialist turns have finished' in system:
            assert any('Verified source evidence' in str(m['content']) for m in kwargs['messages'])
            content='Final synthesis from verified evidence.'
        else: content='Verified source evidence.'
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content,tool_calls=None))])
    monkeypatch.setattr(LLMGateway,'complete',complete)
    try:
        async with sessions() as db:
            bots=[Bot(name='Coordinator',role='Coordinator',llm_provider='openai',llm_model='gpt-6.1-sol',system_prompt='Lead.',tools_enabled=['none']), Bot(name='Researcher',role='Researcher',llm_provider='gemini',llm_model='gemini-3.5-flash',system_prompt='Find evidence.',tools_enabled=['none'])]
            db.add_all(bots); await db.flush()
            room=Conversation(title='Agent lounge',is_group=True);db.add(room);await db.flush()
            for bot in bots:db.add(ConversationParticipant(conversation_id=room.id,bot_id=bot.id))
            await db.commit(); cid=room.id
        response=await orchestrator.AgentOrchestrator().process_message(cid,'Check this claim')
        assert [call['provider'] for call in seen]==['openai','gemini','openai']
        assert response[-1]['content']=='Final synthesis from verified evidence.'
    finally: await engine.dispose()


def test_plugin_credentials_require_private_key(monkeypatch):
    from app.config import settings
    from app.services.plugins import seal
    monkeypatch.setattr(settings, 'BACKEND_API_TOKEN', '')
    monkeypatch.setattr(settings, 'SECRET_KEY', 'local-only-change-before-exposure')
    assert seal('') is None
    with pytest.raises(ValueError, match='32 characters'):
        seal('a-private-token')

@pytest.mark.asyncio
async def test_real_responses_bridge_with_mcp_dependency(monkeypatch):
    """Exercise LiteLLM's real adapter imports and wire mapping; HTTP alone is stubbed."""
    import json,httpx,litellm
    from litellm.llms.custom_httpx.http_handler import AsyncHTTPHandler
    from litellm.llms.custom_httpx import llm_http_handler
    def respond(request):
        body=json.loads(request.content)
        assert request.url.path.endswith('/responses')
        assert body['model']=='openai/gpt-6.1-sol'
        return httpx.Response(200,json={'id':'resp_test','object':'response','created_at':1,'status':'completed','model':'openai/gpt-6.1-sol','output':[{'id':'msg_test','type':'message','status':'completed','role':'assistant','content':[{'type':'output_text','text':'Adapter ready','annotations':[]}]}], 'usage':{'input_tokens':4,'output_tokens':3,'total_tokens':7}})
    handler=AsyncHTTPHandler(transport=httpx.MockTransport(respond))
    monkeypatch.setattr(llm_http_handler,'get_async_httpx_client',lambda **kwargs:handler)
    try:
        response=await litellm.acompletion(model='openai/responses/openai/gpt-6.1-sol',messages=[{'role':'user','content':'Test'}],api_key='test-only',api_base='https://example.test/v1',max_tokens=2048,reasoning_effort='low')
        assert response.choices[0].message.content=='Adapter ready'
    finally:
        await handler.client.aclose()

@pytest.mark.asyncio
async def test_cloud_check_requests_persist_and_run_without_browser(tmp_path, monkeypatch):
    from contextlib import suppress
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from app.db.session import Base, get_db
    from app.main import app
    from app.config import settings
    from app.models.runtime import RuntimeCheck
    from app.services import worker, verification
    engine=create_async_engine(f'sqlite+aiosqlite:///{tmp_path}/checks.db')
    sessions=async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection: await connection.run_sync(Base.metadata.create_all)
    async def session():
        async with sessions() as db: yield db
    calls=[]
    async def verify(force=False): calls.append(force)
    monkeypatch.setattr(worker,'AsyncSessionLocal',sessions)
    monkeypatch.setattr(verification,'AsyncSessionLocal',sessions)
    monkeypatch.setattr(verification,'verify_cloud',verify)
    monkeypatch.setattr(settings,'BACKEND_API_TOKEN','cloud-test-token-with-at-least-32-characters')
    monkeypatch.delenv('GROKBOT_VERIFY_CLOUD',raising=False)
    app.dependency_overrides[get_db]=session
    runner=None
    try:
        async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test',headers={'Authorization':'Bearer '+settings.BACKEND_API_TOKEN}) as client:
            assert (await client.post('/api/runtime/checks')).status_code==202
            assert (await client.post('/api/runtime/checks')).json()['status']=='pending'
        runner=asyncio.create_task(worker._run_worker_loop())
        for _ in range(100):
            async with sessions() as db:
                item=await db.get(RuntimeCheck,'check_request')
                if item.status=='completed': break
            await asyncio.sleep(.02)
        assert item.status=='completed' and calls==[True]
        async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test',headers={'Authorization':'Bearer '+settings.BACKEND_API_TOKEN}) as client:
            assert (await client.post('/api/runtime/checks')).status_code==429
    finally:
        if runner:
            runner.cancel()
            with suppress(asyncio.CancelledError): await runner
        app.dependency_overrides.clear()
        await engine.dispose()


@pytest.mark.asyncio
async def test_authenticated_requests_scope_vercel_headers(monkeypatch):
    from app.main import app
    from app.config import settings
    from httpx import ASGITransport, AsyncClient
    from vercel.headers import get_headers
    monkeypatch.setattr(settings,'BACKEND_API_TOKEN','test-auth-token')
    async def probe(): return {'context': (get_headers() or {}).get('x-vercel-oidc-token')}
    app.add_api_route('/api/context-probe',probe)
    try:
        async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test') as client:
            a,b=await asyncio.gather(*(client.get('/api/context-probe',headers={'Authorization':'Bearer test-auth-token','x-vercel-oidc-token':value}) for value in ('fake-a','fake-b')))
            assert a.json()['context']=='fake-a' and b.json()['context']=='fake-b'
            assert (await client.get('/api/context-probe')).status_code==401
        assert get_headers() is None
    finally:
        app.router.routes[:]=[route for route in app.router.routes if getattr(route,'endpoint',None) is not probe]

@pytest.mark.asyncio
async def test_fleet_bounds_cache_and_no_recursive_tools(monkeypatch):
    from app.services.fleet import ModelFleet
    from app.services import fleet
    from types import SimpleNamespace
    monkeypatch.setattr(fleet, 'completion_options', lambda *a, **kw: {'model':'test'})
    calls=[]
    async def complete(**kw):
        calls.append(kw)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='Finding'))],usage=None)
    monkeypatch.setattr(fleet.litellm, 'acompletion', complete)
    manager=ModelFleet()
    first=await manager.consult({'specialty':'research','task':'Test'},'bot')
    assert first == await manager.consult({'specialty':'research','task':'Test'},'bot')
    for role in ['writing','analysis']:
        assert 'findings' in await manager.consult({'specialty':role,'task':'Test'},'bot')
    assert 'error' in await manager.consult({'specialty':'research','task':'Another'},'bot')
    assert len(calls)==3 and all('tools' not in c and c['max_tokens']==1024 and c['num_retries']==0 for c in calls)


def test_recovered_internal_failure_does_not_fail_final_answer():
    from app.services.worker import response_status
    error={'message_type':'status_update','metadata':{'internal':True}}
    answer={'message_type':'text','content':'Finished'}
    assert response_status([error,answer]) == 'completed'
    assert response_status([error]) == 'failed'
    assert response_status([answer,{'message_type':'status_update'}]) == 'failed'

@pytest.mark.asyncio
async def test_google_image_chat_output_is_attached(monkeypatch):
    from app.services.media import generate_media
    from app.services import llm_gateway
    from types import SimpleNamespace
    import openai
    seen=[]
    class Client:
        def __init__(self, **kwargs): self.chat=SimpleNamespace(completions=self)
        async def __aenter__(self): return self
        async def __aexit__(self,*args): pass
        async def create(self, **kwargs):
            seen.append(kwargs)
            return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(model_dump=lambda:{'images':[{'image_url':{'url':'data:image/png;base64,aW1hZ2U='}}]}))])
    monkeypatch.setattr(openai,'AsyncOpenAI',Client)
    monkeypatch.setattr(llm_gateway,'completion_options',lambda *args:{'api_key':'test','api_base':'https://test.invalid'})
    monkeypatch.setattr(llm_gateway.settings,'LLM_USE_GATEWAY',True)
    files=await generate_media('image','A scene',image_provider='google')
    assert files[0]['mime']=='image/png' and files[0]['data']=='aW1hZ2U='
    assert seen[0]['model']=='google/gemini-3.1-flash-image-preview'
    assert seen[0]['extra_body']['modalities']==['text','image']

@pytest.mark.asyncio
async def test_starter_plugins_install_once_and_preserve_disabled(tmp_path,monkeypatch):
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from sqlalchemy import select
    from app.db.session import Base
    from app.models.plugin import Plugin
    from app.services import verification
    engine=create_async_engine(f'sqlite+aiosqlite:///{tmp_path}/starters.db')
    sessions=async_sessionmaker(engine,expire_on_commit=False)
    async with engine.begin() as conn: await conn.run_sync(Base.metadata.create_all)
    async with sessions() as db:
        db.add(Plugin(name='DeepWiki',url='https://mcp.deepwiki.com/mcp',enabled=False,tools=[])); await db.commit()
    calls=[]
    async def discover(url):
        calls.append(url)
        return [{'name':'docs','description':'Read docs','schema':{'type':'object'}}]
    from app.services import plugins
    monkeypatch.setattr(verification,'AsyncSessionLocal',sessions)
    monkeypatch.setattr(plugins,'discover',discover)
    try:
        await verification.ensure_starter_plugins()
        await verification.ensure_starter_plugins()
        async with sessions() as db:
            rows=(await db.execute(select(Plugin))).scalars().all()
            assert len(rows)==3 and not next(p for p in rows if p.name=='DeepWiki').enabled
        assert len(calls)==2
    finally: await engine.dispose()
