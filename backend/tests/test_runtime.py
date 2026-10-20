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
    monkeypatch.setattr(orchestrator,'AsyncSessionLocal',sessions)
    monkeypatch.setattr(LLMGateway,'complete',complete)
    from app.config import settings
    monkeypatch.setattr(settings, 'BACKEND_API_TOKEN', 'test-only-token')
    app.dependency_overrides[get_db]=get_session
    try:
        async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test',headers={'Authorization':'Bearer test-only-token'}) as client:
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

            conv=(await client.post('/api/conversations',json={'title':'Hive','bot_ids':[bot['id']]})).json()
            response=await client.post(f"/api/conversations/{conv['id']}/messages",json={'sender_type':'user','content':'Check the pipeline'})
            assert response.status_code==202,response.text
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
            assert editor_call['temperature']==.3 and editor_call['max_tokens']==512
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
    monkeypatch.setattr(llm_gateway.settings, "LLM_USE_GATEWAY", True)
    monkeypatch.setenv("VERCEL_OIDC_TOKEN", "test-oidc")
    monkeypatch.delenv("AI_GATEWAY_API_KEY", raising=False)
    options = llm_gateway.completion_options("gemini-2.5-flash", "gemini")
    assert options == {"model": "openai/google/gemini-2.5-flash", "api_base": "https://ai-gateway.vercel.sh/v1", "api_key": "test-oidc"}
    monkeypatch.setenv("AI_GATEWAY_API_KEY", "test-explicit")
    assert llm_gateway.completion_options("gpt-4o", "openai")["api_key"] == "test-explicit"
    monkeypatch.delenv("AI_GATEWAY_API_KEY")
    monkeypatch.delenv("VERCEL_OIDC_TOKEN")
    import pytest
    with pytest.raises(RuntimeError, match="credentials unavailable"):
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
    image = (await generate_media('image', 'An actual scene', '1:1'))[0]
    video = (await generate_media('video', 'A moving scene', '16:9', 6))[0]
    import base64
    assert base64.b64decode(image['data']) == b'image-bytes'
    assert video['mime'] == 'video/mp4'
    assert seen == [('An actual scene', '1:1'), ('A moving scene', 6)]
    with pytest.raises(ValueError, match='landscape or portrait'):
        await generate_media('video', 'Scene', '1:1')
