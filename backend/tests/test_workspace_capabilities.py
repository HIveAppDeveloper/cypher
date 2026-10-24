import json
from datetime import datetime,timedelta
from uuid import uuid4
from types import SimpleNamespace
import pytest
from sqlalchemy import select
from .test_workspace_workflows import workspace,room
from app.db.tenancy import current_tenant_id
from app.models.bot import Bot
from app.models.task import Task
from app.models.message import Message
from app.models.workspace import Routine,UsageEvent,Knowledge,ContextCheckpoint
from app.models.execution import ExecutionStep
from app.services import workspace as service,usage,orchestrator
from app.config import settings

A={'x-grokbot-user-id':'capability-owner-a'}
B={'x-grokbot-user-id':'capability-owner-b'}

@pytest.mark.asyncio
async def test_private_memory_skills_and_template_round_trip(workspace):
    client,sessions=workspace
    cid=await room(client,A['x-grokbot-user-id'])
    bots=(await client.get('/api/bots',headers=A)).json();bid=bots[0]['id']
    for scope,name,value in [('workspace','preferences','Keep it concise.'),('bot:'+bid,'private-note','Agent-only facts.')]:
        r=await client.post('/api/workspace/knowledge',headers=A,json={'scope':scope,'name':name,'content':value})
        assert r.status_code==201,r.text
    r=await client.post('/api/workspace/knowledge',headers=A,json={'kind':'skill','name':'brief','content':'Research {{company}} and verify sources.','parameters':['company']})
    assert r.status_code==201,r.text
    assert (await client.get('/api/workspace/knowledge',headers=B)).json()==[]
    assert (await client.post('/api/workspace/knowledge',headers=B,json={'scope':'bot:'+bid,'name':'attack','content':'no'})).status_code==404
    token=current_tenant_id.set(A['x-grokbot-user-id'])
    try:
        async with sessions() as db:
            assert 'Agent-only' in await service.knowledge_prompt(db,bid)
            assert 'Agent-only' not in await service.knowledge_prompt(db,'another-bot')
    finally:current_tenant_id.reset(token)
    queued=await client.post('/api/conversations/'+cid+'/messages',headers=A,json={'sender_type':'user','content':'/brief company="Example Corp"'})
    assert queued.status_code==202,queued.text
    async with sessions() as db:
        task=await db.get(Task,queued.json()['task_id'])
        assert 'Research Example Corp' in task.description
    bad=await client.post('/api/conversations/'+cid+'/messages',headers=A,json={'sender_type':'user','content':'/brief wrong=thing'})
    assert bad.status_code==422
    exported=(await client.get('/api/workspace/templates/'+bid+'/export',headers=A)).json()
    assert exported['memories']==[] and 'credential' not in exported['bot']
    shared=await client.post('/api/workspace/templates/'+bid+'/share',headers=A)
    assert shared.status_code==201,shared.text
    share_id=shared.json()['id']
    public=await client.get('/api/workspace/templates/shared/'+share_id,headers={'x-grokbot-user-id':''})
    assert public.status_code==200,public.text
    imported=await client.post('/api/workspace/templates/import',headers=B,json=exported)
    assert imported.status_code==201,imported.text
    assert (await client.get('/api/workspace/knowledge',headers=B)).json()==[]
    assert (await client.delete('/api/workspace/templates/shared/'+share_id,headers=B)).status_code==404
    assert (await client.delete('/api/workspace/templates/shared/'+share_id,headers=A)).status_code==200
    assert (await client.get('/api/workspace/templates/shared/'+share_id,headers={'x-grokbot-user-id':''})).status_code==404

@pytest.mark.asyncio
async def test_calendar_routine_recovery_notifications_and_usage_are_tenant_scoped(workspace,monkeypatch):
    client,sessions=workspace
    cid=await room(client,A['x-grokbot-user-id'])
    body={'conversation_id':cid,'name':'Daily brief','instructions':'Read the latest data and produce a brief.','schedule':'weekdays','at_time':'09:30','timezone':'America/New_York'}
    response=await client.post('/api/workspace/routines',headers=A,json=body)
    assert response.status_code==201,response.text
    rid=response.json()['id']
    assert (await client.post('/api/workspace/routines',headers=A,json={**body,'timezone':'Fake/Zone'})).status_code==422
    async with sessions() as db:
        routine=await db.get(Routine,rid);routine.next_run_at=datetime.utcnow()-timedelta(days=3);await db.commit()
    await service.tick_routines(sessions)
    await service.tick_routines(sessions)
    async with sessions() as db:
        tasks=(await db.execute(select(Task))).scalars().all()
        assert len(tasks)==1 and tasks[0].tenant_id==A['x-grokbot-user-id']
        task_id=tasks[0].id
    same=await client.post('/api/workspace/routines/'+rid+'/run',headers=A)
    assert same.json()['task_id']==task_id
    assert (await client.get('/api/workspace/routines',headers=B)).json()==[]
    token=current_tenant_id.set(A['x-grokbot-user-id'])
    try:
        async with sessions() as db:
            task=await db.get(Task,task_id);task.status='completed';task.result={**task.result,'responses':[{'content':'Verified daily brief.'}]}
            await service.notify_finished(db,task);await db.commit();await service.notify_finished(db,task);await db.commit()
        active=usage.active.set((task_id,sessions))
        try:
            async def catalog():return {'openai/gpt-6-luna':{'pricing':{'input':'0.000001','output':'0.000002'}}}
            from app.services import model_routing
            monkeypatch.setattr(settings,'OMNIROUTE_URL','https://router.example')
            monkeypatch.setattr(model_routing,'route_catalog',catalog)
            await usage.record('openai','gpt-6-luna',{'prompt_tokens':100,'completion_tokens':30})
            await client.patch('/api/workspace/settings',headers=A,json={'weekly_token_limit':100})
            with pytest.raises(usage.UsageLimitError):await usage.check_allowance()
        finally:usage.active.reset(active)
    finally:current_tenant_id.reset(token)
    assert len((await client.get('/api/workspace/notifications',headers=A)).json())==1
    assert (await client.get('/api/workspace/notifications',headers=B)).json()==[]
    total=(await client.get('/api/workspace/usage',headers=A)).json()
    assert total['tokens']==130 and total['estimated_cost']==pytest.approx(.00016)
    assert (await client.get('/api/workspace/usage',headers=B)).json()['tokens']==0


def test_calendar_uses_local_weekdays_and_dst():
    routine=SimpleNamespace(schedule='weekdays',at_time='09:30',timezone='America/New_York')
    assert service.next_run(routine,datetime(2026,10,23,14))==datetime(2026,10,26,13,30)
    assert service.next_run(routine,datetime(2026,10,30,14))==datetime(2026,11,2,14,30)

@pytest.mark.asyncio
async def test_mentions_replies_and_context_compaction_preserve_boundaries(workspace,monkeypatch):
    client,sessions=workspace
    cid=await room(client,A['x-grokbot-user-id'])
    bid=(await client.get('/api/bots',headers=A)).json()[0]['id']
    parent_id=str(uuid4())
    token=current_tenant_id.set(A['x-grokbot-user-id'])
    try:
        async with sessions() as db:
            db.add_all([Message(id=parent_id,conversation_id=cid,sender_type='user',content='Parent topic',metadata_json={}),Message(conversation_id=cid,sender_type='user',content='Unrelated room secret topic',metadata_json={})]);await db.commit()
    finally:current_tenant_id.reset(token)
    queued=await client.post('/api/conversations/'+cid+'/messages',headers=A,json={'sender_type':'user','content':'Discuss just the parent','reply_to_id':parent_id})
    assert queued.status_code==202,queued.text
    seen=[]
    async def complete(**kw):
        import litellm
        seen.extend(kw['messages'])
        return litellm.ModelResponse(choices=[{'message':{'role':'assistant','content':'Thread answer'}}])
    monkeypatch.setattr(orchestrator.LLMGateway,'complete',complete)
    token=current_tenant_id.set(A['x-grokbot-user-id'])
    try:
        result=await orchestrator.AgentOrchestrator().process_message(cid,'Discuss just the parent',incoming_message_id=queued.json()['message_id'],task_id=queued.json()['task_id'])
        text=json.dumps(seen)
        assert 'Parent topic' in text and 'Unrelated room secret topic' not in text
        assert result[-1]['metadata']['thread_root_id']==parent_id
        runner=orchestrator.AgentOrchestrator();calls=[]
        async def run(db,cid,bid,message):calls.append(bid);return []
        monkeypatch.setattr(runner,'_run_agent_loop',run)
        async with sessions() as db:
            bot=await db.get(Bot,bid)
            await runner._handle_group_chat(db,SimpleNamespace(id=cid),[bid],'@'+bot.name+' Please do this.','user',None)
        assert calls==[bid]
    finally:current_tenant_id.reset(token)
    bad=await client.post('/api/conversations/'+cid+'/messages',headers=B,json={'sender_type':'user','content':'cross-tenant','reply_to_id':parent_id})
    assert bad.status_code==404

@pytest.mark.asyncio
async def test_compaction_keeps_original_history_and_reuses_its_checkpoint(workspace,monkeypatch):
    client,sessions=workspace
    cid=await room(client,A['x-grokbot-user-id'])
    from app.services.compaction import compact_context
    from app.services.execution import ExecutionJournal
    import litellm
    calls=[]
    async def complete(**kwargs):
        calls.append(kwargs)
        return litellm.ModelResponse(choices=[{'message':{'role':'assistant','content':'The owner chose the verified plan. Follow-up: finish the report.'}}])
    monkeypatch.setattr(orchestrator.LLMGateway,'complete',complete)
    tenant=current_tenant_id.set(A['x-grokbot-user-id'])
    try:
        async with sessions() as db:
            start=datetime.utcnow()-timedelta(days=2)
            for i in range(25):db.add(Message(conversation_id=cid,sender_type='user',message_type='text',content=f'Older decision {i}',metadata_json={'attachments':[{'data':'DO_NOT_SUMMARIZE_ATTACHMENT','name':'file','mime':'text/plain'}]},created_at=start+timedelta(seconds=i)))
            visible=Message(id=str(uuid4()),conversation_id=cid,sender_type='user',content='Current topic',metadata_json={},created_at=start+timedelta(hours=1));db.add(visible);await db.commit()
            journal=ExecutionJournal(None,sessions)
            text=await compact_context(db,cid,visible,journal)
            assert 'verified plan' in text and len(calls)==1
            assert 'DO_NOT_SUMMARIZE_ATTACHMENT' not in json.dumps(calls[0]['messages'])
            assert len((await db.execute(select(Message))).scalars().all())==26
            again=await compact_context(db,cid,visible,journal)
            assert again==text and len(calls)==1
            assert await db.get(ContextCheckpoint,cid)
    finally:current_tenant_id.reset(tenant)

@pytest.mark.asyncio
async def test_browser_screenshot_is_sent_as_image_evidence_not_encoded_tool_text(workspace,monkeypatch):
    import base64,litellm
    from app.services.tools.registry import _browser_tool
    client,sessions=workspace
    cid=await room(client,A['x-grokbot-user-id'])
    queued=(await client.post('/api/conversations/'+cid+'/messages',headers=A,json={'sender_type':'user','content':'Inspect the current browser screenshot.'})).json()
    image=base64.b64encode(b'controlled image evidence').decode()
    async def screenshot(**kwargs):return {'success':True,'screenshot_base64':image,'title':'Controlled screen','url':'https://example.com'}
    monkeypatch.setattr(_browser_tool,'screenshot',screenshot)
    calls=[]
    async def complete(**kwargs):
        calls.append(kwargs)
        if len(calls)==1:
            message={'role':'assistant','content':None,'tool_calls':[{'id':'screen-call','type':'function','function':{'name':'browser_screenshot','arguments':'{}'}}]}
        else:
            history=kwargs['messages']
            assert history[-1]['role']=='user' and history[-1]['content'][1]['image_url']['url']=='data:image/png;base64,'+image
            assert history[-2]['role']=='tool' and image not in history[-2]['content']
            message={'role':'assistant','content':'Verified screen evidence.'}
        return litellm.ModelResponse(choices=[{'message':message}])
    monkeypatch.setattr(orchestrator.LLMGateway,'complete',complete)
    token=current_tenant_id.set(A['x-grokbot-user-id'])
    try:
        result=await orchestrator.AgentOrchestrator().process_message(cid,'Inspect the current browser screenshot.',incoming_message_id=queued['message_id'],task_id=queued['task_id'])
        assert result[-1]['content']=='Verified screen evidence.' and len(calls)==2
        async with sessions() as db:
            rows=(await db.execute(select(Message).where(Message.message_type=='tool_result'))).scalars().all()
            assert all('screenshot_base64' not in row.content for row in rows)
    finally:current_tenant_id.reset(token)

@pytest.mark.asyncio
async def test_delete_used_agent_preserves_records_and_removes_private_access(workspace,monkeypatch):
    client,sessions=workspace
    from app.api.bots import SandboxManager
    monkeypatch.setattr(SandboxManager,'stop_sandbox',lambda *args:None)
    cid=await room(client,A['x-grokbot-user-id']);bid=(await client.get('/api/bots',headers=A)).json()[0]['id']
    await client.post('/api/workspace/knowledge',headers=A,json={'scope':'bot:'+bid,'name':'private','content':'private memory'})
    queued=(await client.post('/api/conversations/'+cid+'/messages',headers=A,json={'sender_type':'user','content':'Controlled prior work'})).json()
    assert (await client.delete('/api/bots/'+bid,headers=A)).status_code==409
    async with sessions() as db:
        task=await db.get(Task,queued['task_id']);task.status='completed';await db.commit()
    assert (await client.delete('/api/bots/'+bid,headers=B)).status_code==200
    assert len((await client.get('/api/bots',headers=A)).json())==1
    assert (await client.delete('/api/bots/'+bid,headers=A)).status_code==200
    assert (await client.get('/api/bots',headers=A)).json()==[]
    assert (await client.get('/api/workspace/knowledge',headers=A)).json()==[]
    async with sessions() as db:
        assert await db.get(Task,queued['task_id'])
        assert (await db.get(Bot,bid)).status=='deleted'
    again=await client.post('/api/bots',headers=A,json={'name':'Workflow agent','role':'Assistant','system_prompt':'New agent','llm_provider':'openai','llm_model':'gpt-6-luna'})
    assert again.status_code==200,again.text

@pytest.mark.asyncio
async def test_orphan_routine_cannot_restart_or_interrupt_other_schedules(workspace):
    client,sessions=workspace
    from app.models.conversation import ConversationParticipant
    from sqlalchemy import delete
    cid=await room(client,A['x-grokbot-user-id'])
    made=await client.post('/api/workspace/routines',headers=A,json={'conversation_id':cid,'name':'Orphan recovery test','instructions':'Controlled test','interval_minutes':1})
    assert made.status_code==201,made.text
    id=made.json()['id']
    async with sessions() as db:
        await db.execute(delete(ConversationParticipant).where(ConversationParticipant.conversation_id==cid))
        routine=await db.get(Routine,id);routine.next_run_at=datetime.utcnow()-timedelta(minutes=1);await db.commit()
    await service.tick_routines(sessions)
    async with sessions() as db:
        routine=await db.get(Routine,id);assert routine.enabled is False and routine.next_run_at is None
    assert (await client.patch('/api/workspace/routines/'+id,headers=A,json={'enabled':True})).status_code==409
    assert (await client.post('/api/workspace/routines/'+id+'/run',headers=A)).status_code==409
    assert (await client.post('/api/workspace/routines',headers=A,json={'conversation_id':cid,'name':'Empty conversation','instructions':'No agent'})).status_code==409
