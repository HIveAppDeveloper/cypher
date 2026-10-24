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
async def test_waiting_goals_do_not_starve_due_work_or_completion(workspace):
    _,sessions,room=workspace
    from app.db.tenancy import current_tenant_id
    # Ten goals are permitted per workspace, so the worker's global batch must
    # make progress beyond those belonging to the first workspace.
    async with sessions() as db:
        bot=(await db.execute(select(Bot))).scalar_one()
        for i in range(10):
            pending=Task(conversation_id=room,bot_id=bot.id,title='Waiting',description='Waiting',status='pending')
            db.add(pending);await db.flush()
            db.add(Goal(**goal_payload(room,title=f'Waiting {i}'),last_task_id=pending.id,runs=1,next_run_at=datetime.utcnow()-timedelta(hours=1)))
        await db.commit()
    owner=current_tenant_id.set('another-workspace')
    try:
        async with sessions() as db:
            bot=Bot(name='Another manager',role='Coordinator',system_prompt='Manage',llm_provider='openai',llm_model='gpt-6-luna',tools_enabled=[])
            other_room=Conversation(title='Another workspace',is_group=False)
            db.add_all([bot,other_room]);await db.flush()
            db.add(ConversationParticipant(conversation_id=other_room.id,bot_id=bot.id))
            due=Goal(**goal_payload(other_room.id,title='Due now'))
            finished=Task(conversation_id=other_room.id,bot_id=bot.id,title='Finished',description='Finished',status='completed')
            db.add_all([due,finished]);await db.flush()
            complete=Goal(**goal_payload(other_room.id,title='Record completion'),runs=1,last_task_id=finished.id,completion_requested=True,next_run_at=datetime.utcnow()+timedelta(days=1))
            db.add(complete);await db.commit();due_id=due.id;complete_id=complete.id
    finally:current_tenant_id.reset(owner)
    await automation.tick_goals(sessions)
    async with sessions() as db:
        due=await db.get(Goal,due_id)
        assert due.runs==1 and due.last_task_id
        assert (await db.get(Task,due.last_task_id)).tenant_id=='another-workspace'
        assert (await db.get(Goal,complete_id)).status=='completed'
        waiting=(await db.execute(select(Goal).where(Goal.title.startswith('Waiting')))).scalars().all()
        assert len(waiting)==10 and all(g.runs==1 for g in waiting)

@pytest.mark.asyncio
async def test_future_goals_do_not_consume_the_due_batch(workspace):
    _,sessions,room=workspace
    async with sessions() as db:
        for i in range(10):
            db.add(Goal(**goal_payload(room,title=f'Future {i}'),next_run_at=datetime.utcnow()+timedelta(days=1)))
        due=Goal(**goal_payload(room,title='Due after future goals'))
        db.add(due);await db.commit();gid=due.id
    await automation.tick_goals(sessions)
    async with sessions() as db:
        assert (await db.get(Goal,gid)).runs==1
        future=(await db.execute(select(Goal).where(Goal.title.startswith('Future')))).scalars().all()
        assert all(g.runs==0 for g in future)

@pytest.mark.asyncio
async def test_goal_claim_completion_and_no_duplicate(workspace):
    client,sessions,room=workspace
    response=await client.post('/api/goals',json=goal_payload(room));assert response.status_code==201
    gid=response.json()['id']
    await automation.tick_goals();await automation.tick_goals()
    async with sessions() as db:
        g=await db.get(Goal,gid);assert g.runs==1
        task=await db.get(Task,g.last_task_id);assert task.result['request']['goal_id']==gid
        assert task.result['request']['options']['routing']=='manual'
        assert task.result['request']['options']['model']=='gpt-6.1-sol'
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
    async with sessions() as db:
        queued=await db.get(Task,first.json()['task_id'])
        assert queued.result['request']['options']['routing']=='manual'
        assert queued.result['request']['options']['model']=='gpt-6.1-sol'
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
        assert {t['function']['name'] for t in registry.get_tools_for_bot(bot)} == {'plugin_search','plugin_call'}
        found = await registry.execute_tool('plugin_search', {'query':'Tools'}, bot.id)
        assert [t['name'] for t in found['tools']] == ['read']
        assert 'error' in await registry.execute_tool('plugin_call', {'plugin_id':pid,'tool_name':'write','arguments':{}}, bot.id)
    from app.db import session as db_session
    monkeypatch.setattr(db_session,'AsyncSessionLocal',sessions)
    assert 'error' in await plugins.invoke(pid,'write',{})
    async def discover(*args, **kwargs):return tools+[{'name':'new','description':'New','schema':{'type':'object'}}]
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

@pytest.mark.asyncio
async def test_live_direction_replaces_outdated_answer_and_rejects_finished_work(workspace,monkeypatch):
    from app.services import orchestrator
    from app.services.llm_gateway import LLMGateway
    client,sessions,room=workspace
    monkeypatch.setattr(orchestrator,'AsyncSessionLocal',sessions)
    queued=await client.post(f'/api/conversations/{room}/messages',json={'sender_type':'user','content':'Make a plan','options':{'steering':'Keep it practical.'}})
    task_id=queued.json()['task_id']
    calls=[]
    async def complete(**kwargs):
        calls.append(kwargs['messages'][:])
        assert 'Keep it practical.' in kwargs['messages'][0]['content']
        if len(calls)==1:
            response=await client.post(f'/api/conversations/{room}/tasks/{task_id}/steer',json={'instruction':'Focus only on a one-day plan.'})
            assert response.status_code==202,response.text
            content='Outdated month-long plan.'
        else:
            assert kwargs['messages'][-1]['content']=='Updated direction: Focus only on a one-day plan.'
            content='One-day plan, checked.'
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content,tool_calls=None))])
    monkeypatch.setattr(LLMGateway,'complete',complete)
    result=await orchestrator.AgentOrchestrator().process_message(room,'Make a plan',options={'steering':'Keep it practical.'},task_id=task_id)
    assert len(calls)==2
    assert [r['content'] for r in result]==['One-day plan, checked.']
    async with sessions() as db:
        task=await db.get(Task,task_id);task.status='completed';await db.commit()
    assert (await client.post(f'/api/conversations/{room}/tasks/{task_id}/steer',json={'instruction':'Too late'})).status_code==409

@pytest.mark.asyncio
async def test_durable_context_procedure_evidence_and_forgetting(workspace):
    from app.services.context import save_note,context_prompt
    client,sessions,room=workspace
    path=f'/api/conversations/{room}/context'
    note=(await client.post(path,json={'name':'Writing','kind':'preference','content':'Use short factual sentences.'})).json()
    assert (await client.get(path)).json()[0]['id']==note['id']
    assert (await client.post(path,json={'name':'Secret','content':'password=do-not-store-this'})).status_code==422
    async with sessions() as db:
        assert 'Use short factual sentences.' in await context_prompt(db,room)
        with pytest.raises(ValueError,match='evidence'):
            await save_note(db,room,'Routine','procedure','A checked procedure.','agent')
        bot=(await db.execute(select(ConversationParticipant.bot_id).where(ConversationParticipant.conversation_id==room))).scalar_one()
        task=Task(conversation_id=room,bot_id=bot,title='Verified',description='Checked',status='completed');db.add(task);await db.commit()
        procedure=await save_note(db,room,'Routine','procedure','A checked procedure.','agent',task.id)
        assert procedure.verified
    assert (await client.delete(path+'/'+note['id'])).status_code==200
    assert all(n['id']!=note['id'] for n in (await client.get(path)).json())

@pytest.mark.asyncio
async def test_browser_state_encrypted_and_restored(workspace,monkeypatch):
    from app.db import session as session_module
    from app.models.context import BrowserSession
    from app.services.tools.browser import BrowserTool
    client,sessions,room=workspace
    monkeypatch.setattr(session_module,'AsyncSessionLocal',sessions)
    async with sessions() as db:bid=(await db.execute(select(ConversationParticipant.bot_id).where(ConversationParticipant.conversation_id==room))).scalar_one()
    state={'cookies':[{'name':'session','value':'private-test-cookie','domain':'example.com','path':'/'}],'origins':[]}
    class Context:
        async def storage_state(self):return state
    browser=BrowserTool();browser._contexts[bid]=Context()
    await browser._save_state(bid)
    async with sessions() as db:assert 'private-test-cookie' not in (await db.get(BrowserSession,bid)).state
    assert await BrowserTool()._load_state(bid)==state

@pytest.mark.asyncio
async def test_device_approval_signature_action_binding_and_replay(workspace,monkeypatch):
    import hashlib,cbor2
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import hashes
    from app.api.device import encode,ORIGIN,RP_ID
    from app.models.context import DeviceCredential
    from app.api import plugins as plugin_api
    client,sessions,room=workspace
    private=ec.generate_private_key(ec.SECP256R1());numbers=private.public_key().public_numbers()
    cred=encode(b'a-device-credential')
    async with sessions() as db:
        db.add(DeviceCredential(id=cred,public_key=encode(cbor2.dumps({1:2,3:-7,-1:1,-2:numbers.x.to_bytes(32,'big'),-3:numbers.y.to_bytes(32,'big')})),sign_count=0));await db.commit()
    assert (await client.get('/api/device/status')).json()['enrolled']
    assert (await client.post('/api/device/challenge',json={'purpose':'register'})).status_code==409
    url='https://example.com/mcp'
    assert (await client.post('/api/plugins',json={'name':'Test','url':url})).status_code==403
    challenge=(await client.post('/api/device/challenge',json={'purpose':'connect_plugin:'+url})).json()
    client_data=json.dumps({'type':'webauthn.get','challenge':challenge['options']['challenge'],'origin':ORIGIN}).encode()
    auth_data=hashlib.sha256(RP_ID.encode()).digest()+bytes([5])+(1).to_bytes(4,'big')
    signature=private.sign(auth_data+hashlib.sha256(client_data).digest(),ec.ECDSA(hashes.SHA256()))
    payload={'challenge_id':challenge['challenge_id'],'credential':{'id':cred,'rawId':cred,'type':'public-key','response':{'clientDataJSON':encode(client_data),'authenticatorData':encode(auth_data),'signature':encode(signature),'userHandle':None}}}
    response=await client.post('/api/device/verify',json=payload)
    assert response.status_code==200,response.text
    approval=response.json()['approval_id']
    assert (await client.post('/api/device/verify',json=payload)).status_code==400
    async def discover(*args):return [{'name':'lookup','description':'Test','schema':{'type':'object'}}]
    monkeypatch.setattr(plugin_api,'discover',discover)
    assert (await client.post('/api/plugins',json={'name':'Wrong','url':'https://other.example/mcp','approval_id':approval})).status_code==403
    assert (await client.post('/api/plugins',json={'name':'Test','url':url,'approval_id':approval})).status_code==200
    assert (await client.post('/api/plugins',json={'name':'Replay','url':url,'approval_id':approval})).status_code==403
