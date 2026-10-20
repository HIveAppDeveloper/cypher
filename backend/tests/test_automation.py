import hashlib,hmac,json
from datetime import datetime,timedelta
from types import SimpleNamespace
import pytest
import pytest_asyncio
from httpx import AsyncClient,ASGITransport,MockTransport,Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine,async_sessionmaker
from app.db.session import Base,get_db
from app.main import app
from app.models.bot import Bot
from app.models.conversation import Conversation,ConversationParticipant
from app.models.automation import Goal,Channel,Delivery
from app.models.task import Task
from app.services import automation,plugins
from app.config import settings

@pytest_asyncio.fixture
async def workspace(tmp_path,monkeypatch):
    engine=create_async_engine(f'sqlite+aiosqlite:///{tmp_path}/automation.db')
    sessions=async_sessionmaker(engine,expire_on_commit=False)
    async with engine.begin() as c:await c.run_sync(Base.metadata.create_all)
    async with sessions() as db:
        bot=Bot(name='Manager',role='Coordinator',system_prompt='Manage',llm_provider='openai',llm_model='gpt-6.1-sol',tools_enabled=['plugins']);db.add(bot);await db.flush()
        room=Conversation(title='Test',is_group=False);db.add(room);await db.flush();db.add(ConversationParticipant(conversation_id=room.id,bot_id=bot.id));await db.commit();rid=room.id
    async def dependency():
        async with sessions() as db:yield db
    app.dependency_overrides[get_db]=dependency
    monkeypatch.setattr(automation,'AsyncSessionLocal',sessions)
    monkeypatch.setattr(settings,'BACKEND_API_TOKEN','')
    monkeypatch.setattr(settings,'SECRET_KEY','a-test-key-that-is-longer-than-32-characters')
    try:
        async with AsyncClient(transport=ASGITransport(app=app),base_url='http://test') as client:yield client,sessions,rid
    finally:
        app.dependency_overrides.clear();await engine.dispose()

def goal_payload(room,**extra):return {'conversation_id':room,'title':'Verify','objective':'Return a checked result','success_criteria':'A verified result is returned','max_runs':2,**extra}

@pytest.mark.asyncio
async def test_goal_claim_completion_and_no_duplicate(workspace):
    client,sessions,room=workspace
    response=await client.post('/api/goals',json=goal_payload(room));assert response.status_code==201
    gid=response.json()['id']
    await automation.tick_goals();await automation.tick_goals()
    async with sessions() as db:
        g=await db.get(Goal,gid);assert g.runs==1
        task=await db.get(Task,g.last_task_id);assert task.result['request']['goal_id']==gid
        task.status='completed';g.completion_requested=True;g.last_summary='Verified';await db.commit()
    await automation.tick_goals()
    async with sessions() as db:assert (await db.get(Goal,gid)).status=='completed'

@pytest.mark.asyncio
async def test_failed_goal_blocks_until_explicit_resume_and_stops_at_limit(workspace):
    client,sessions,room=workspace
    gid=(await client.post('/api/goals',json=goal_payload(room))).json()['id'];await automation.tick_goals()
    async with sessions() as db:
        g=await db.get(Goal,gid);(await db.get(Task,g.last_task_id)).status='failed';await db.commit()
    await automation.tick_goals()
    async with sessions() as db:assert (await db.get(Goal,gid)).status=='blocked'
    assert (await client.patch('/api/goals/'+gid,json={'status':'active'})).status_code==200
    await automation.tick_goals()
    async with sessions() as db:
        g=await db.get(Goal,gid);assert g.runs==2;(await db.get(Task,g.last_task_id)).status='completed';await db.commit()
    await automation.tick_goals()
    async with sessions() as db:assert (await db.get(Goal,gid)).status=='limit_reached'
    assert (await client.patch('/api/goals/'+gid,json={'status':'active'})).status_code==409

@pytest.mark.asyncio
async def test_pause_cancels_pending_and_rejects_invalid_limits(workspace):
    client,sessions,room=workspace
    assert (await client.post('/api/goals',json=goal_payload(room,interval_minutes=1))).status_code==422
    gid=(await client.post('/api/goals',json=goal_payload(room))).json()['id'];await automation.tick_goals()
    assert (await client.patch('/api/goals/'+gid,json={'status':'paused'})).status_code==200
    async with sessions() as db:
        g=await db.get(Goal,gid);assert g.status=='paused';assert (await db.get(Task,g.last_task_id)).status=='cancelled'

@pytest.mark.asyncio
async def test_channel_auth_dedup_disable_and_secret_not_listed(workspace):
    client,sessions,room=workspace
    c=(await client.post('/api/channels',json={'name':'Input','conversation_id':room})).json();token=c['token']
    path=c['inbound_path'];data={'event_id':'event-1','text':'A test task'}
    assert (await client.post(path,json=data)).status_code==401
    headers={'X-Grokbot-Channel-Key':token}
    first=await client.post(path,json=data,headers=headers);assert first.status_code==202
    second=(await client.post(path,json=data,headers=headers)).json();assert second['status']=='duplicate' and second['task_id']==first.json()['task_id']
    listed=(await client.get('/api/channels')).json();assert 'token' not in listed[0] and 'signing_secret' not in listed[0]
    await client.patch('/api/channels/'+c['id'],json={'enabled':False})
    assert (await client.post(path,json={'event_id':'event-2','text':'No'},headers=headers)).status_code==401

@pytest.mark.asyncio
async def test_signed_delivery_excludes_internal_content_and_retries_are_bounded(workspace,monkeypatch):
    client,sessions,room=workspace
    async def validate(url):pass
    monkeypatch.setattr(automation,'validate_endpoint',validate);monkeypatch.setattr(plugins,'validate_endpoint',validate)
    from app.api import automation as api_automation
    monkeypatch.setattr(api_automation,'validate_endpoint',validate)
    c=(await client.post('/api/channels',json={'name':'Output','conversation_id':room,'webhook_url':'https://receiver.example/webhook'})).json()
    queued=(await client.post(c['inbound_path'],headers={'X-Grokbot-Channel-Key':c['token']},json={'event_id':'x','text':'Task'})).json()
    async with sessions() as db:
        task=await db.get(Task,queued['task_id']);task.status='completed';task.result={'responses':[{'sender_type':'bot','content':'Secret background','metadata':{'internal':True}},{'sender_type':'bot','content':'Finished'}]}
        await automation.enqueue_delivery(task.id,c['id'],db=db);await db.commit()
    calls=[]
    async def post(request):
        calls.append(request)
        expected='sha256='+hmac.new(c['token'].encode(),request.content,hashlib.sha256).hexdigest()
        assert request.headers['x-grokbot-signature']==expected
        assert json.loads(request.content)['text']=='Finished'
        return Response(503)
    monkeypatch.setattr(automation,'http_client',lambda:AsyncClient(transport=MockTransport(post)))
    for _ in range(4):
        async with sessions() as db:
            row=(await db.execute(select(Delivery))).scalar_one();row.next_attempt_at=datetime.utcnow()-timedelta(seconds=1);await db.commit()
        await automation.tick_deliveries()
    async with sessions() as db:
        d=(await db.execute(select(Delivery))).scalar_one();assert d.status=='failed' and d.attempts==3
    assert len(calls)==3 and len({r.headers['idempotency-key'] for r in calls})==1

@pytest.mark.asyncio
async def test_plugin_tool_disable_is_enforced_and_refresh_preserves_choice(workspace,monkeypatch):
    client,sessions,room=workspace
    from app.models.plugin import Plugin
    from app.services.tools.registry import ToolRegistry
    from app.api import plugins as plugin_api
    tools=[{'name':name,'description':'Test','schema':{'type':'object'}} for name in ['read','write']]
    async with sessions() as db:
        p=Plugin(name='Tools',url='https://tools.example/mcp',tools=tools,enabled=True);db.add(p);await db.commit();pid=p.id
    changed=await client.patch(f'/api/plugins/{pid}/tools/write',json={'enabled':False})
    assert changed.status_code==200 and not changed.json()['tools'][1]['enabled']
    async with sessions() as db:
        bot=(await db.execute(select(Bot))).scalar_one();registry=ToolRegistry();await registry.load_plugins(db,bot)
        assert len(registry.get_tools_for_bot(bot))==1
    from app.db import session as db_session
    monkeypatch.setattr(db_session,'AsyncSessionLocal',sessions)
    assert 'error' in await plugins.invoke(pid,'write',{})
    async def discover(*args):return tools+[{'name':'new','description':'New','schema':{'type':'object'}}]
    monkeypatch.setattr(plugin_api,'discover',discover)
    updated=(await client.post(f'/api/plugins/{pid}/refresh')).json()
    assert len(updated['tools'])==3 and not next(t for t in updated['tools'] if t['name']=='write')['enabled']

@pytest.mark.asyncio
async def test_goal_manager_cannot_spawn_nested_or_multiple_goals(workspace):
    client,sessions,room=workspace
    from app.services.tools.registry import ToolRegistry
    registry=ToolRegistry();await automation.register_goal_tools(registry,room,None,sessions)
    args={'title':'Follow up','objective':'Finish work','success_criteria':'Verified'}
    first=await registry.execute_tool('set_goal',args,'manager')
    assert first['success']
    assert 'error' in await registry.execute_tool('set_goal',args,'manager')
    nested=ToolRegistry();await automation.register_goal_tools(nested,room,first['goal']['id'],sessions)
    assert 'set_goal' not in nested._tools and 'complete_goal' in nested._tools
