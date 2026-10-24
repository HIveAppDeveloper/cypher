from types import SimpleNamespace
import pytest
from app.schemas.input import RunOptions
from app.services.orchestrator import AgentOrchestrator
from .test_workspace_workflows import workspace

class BotsDB:
    def __init__(self,bots): self.bots=bots
    async def execute(self,*args,**kwargs): return SimpleNamespace(scalars=lambda:SimpleNamespace(all=lambda:self.bots))

def runner(voice):
    instance=AgentOrchestrator.__new__(AgentOrchestrator)
    instance.options=RunOptions(voice_mode=voice)
    bots=[SimpleNamespace(id='lead',name='Coordinator',role='Coordinator'),SimpleNamespace(id='review',name='Reviewer',role='Reviewer')]
    return instance,bots,BotsDB(bots)

@pytest.mark.asyncio
@pytest.mark.parametrize('voice',[False,True])
async def test_ordinary_group_chat_returns_direct_tool_enabled_result_without_a_second_round(voice):
    instance,bots,db=runner(voice);calls=[]
    async def run(db,cid,bid,message):calls.append(bid);return [{'content':'42','metadata':{}}]
    instance._run_agent_loop=run
    result=await instance._handle_group_chat(db,SimpleNamespace(id='room'),['lead','review'],'Compute 17 + 25.','user',None)
    assert calls==['lead'] and result[-1]['content']=='42'

@pytest.mark.asyncio
@pytest.mark.parametrize('voice',[False,True])
async def test_a_useful_direct_handoff_runs_the_specialist_and_final_verification_without_replanning(voice):
    instance,bots,db=runner(voice);calls=[]
    async def run(db,cid,bid,message):
        calls.append((bid,getattr(instance,'phase_instructions','')))
        if len(calls)==1:return [{'content':'HANDOFF[Reviewer: Independently check 17 + 25.]','metadata':{}}]
        if bid=='review':
            assert 'Independently check 17 + 25.' in message
            return [{'content':'42'}]
        return [{'content':'Verified 42.'}]
    instance._run_agent_loop=run
    result=await instance._handle_group_chat(db,SimpleNamespace(id='room'),['lead','review'],'Compute 17 + 25.','user',None)
    assert [bid for bid,_ in calls]==['lead','review','lead']
    assert all('Plan this task briefly' not in phase for _,phase in calls)
    assert result[-1]['content']=='Verified 42.'
    assert not instance.internal_activity and not instance.planning

@pytest.mark.asyncio
async def test_recovery_never_returns_an_old_internal_planning_receipt_as_the_final_answer():
    instance,bots,db=runner(False);calls=[]
    async def run(db,cid,bid,message):
        calls.append(bid)
        return [{'content':'Old cached plan','metadata':{'internal':True}}] if len(calls)==1 else [{'content':'Verified 42.','metadata':{}}]
    instance._run_agent_loop=run
    result=await instance._handle_group_chat(db,SimpleNamespace(id='room'),['lead','review'],'Compute 17 + 25.','user',None)
    assert calls==['lead','lead'] and result[-1]['content']=='Verified 42.'

@pytest.mark.asyncio
async def test_worker_participant_snapshot_excludes_later_members_without_changing_membership(workspace,monkeypatch):
    from app.db.tenancy import current_tenant_id
    from app.models.conversation import ConversationParticipant
    from app.services.llm_gateway import LLMGateway
    from sqlalchemy import select
    client,sessions=workspace;owner='claimed-members';headers={'x-grokbot-user-id':owner}
    agents=[]
    for name,role in [('Coordinator','Coordinator'),('Existing Researcher','Researcher'),('Late Builder','Builder')]:
        response=await client.post('/api/bots',headers=headers,json={'name':name,'role':role,'system_prompt':'Answer accurately.','llm_provider':'openai','llm_model':'gpt-6.1-sol'})
        assert response.status_code==200,response.text
        agents.append(response.json()['id'])
    cid=(await client.post('/api/conversations',headers=headers,json={'title':'Claim snapshot test','is_group':True,'bot_ids':agents[:2]})).json()['id']
    snapshot=list(agents[:2])
    added=await client.post('/api/conversations/'+cid+'/participants',params={'bot_id':agents[2]},headers=headers)
    assert added.status_code==200
    async def complete(**kwargs):return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='Snapshot respected.',tool_calls=None))])
    monkeypatch.setattr(LLMGateway,'complete',complete)
    prompt='@Late Builder, answer this.'
    incoming=(await client.post('/api/conversations/'+cid+'/messages',headers=headers,json={'sender_type':'user','content':prompt})).json()
    tenant=current_tenant_id.set(owner)
    try:
        result=await AgentOrchestrator().process_message(cid,prompt,incoming_message_id=incoming['message_id'],participant_bot_ids=snapshot)
        async with sessions() as db:
            members=(await db.execute(select(ConversationParticipant.bot_id).where(ConversationParticipant.conversation_id==cid))).scalars().all()
            assert set(members)==set(agents),'response filtering must not mutate ORM membership'
    finally:current_tenant_id.reset(tenant)
    assert result[-1]['sender_bot_id']==agents[0] and all(item['sender_bot_id']!=agents[2] for item in result)

@pytest.mark.asyncio
async def test_media_response_uses_the_claimed_first_bot_not_a_later_membership_order(workspace,monkeypatch):
    from app.db.tenancy import current_tenant_id
    from app.services import media
    client,_=workspace;owner='claimed-media';headers={'x-grokbot-user-id':owner};agents=[]
    for name in ['One','Two']:
        response=await client.post('/api/bots',headers=headers,json={'name':name,'role':'Assistant','system_prompt':'Answer accurately.','llm_provider':'openai','llm_model':'gpt-6.1-sol'})
        assert response.status_code==200,response.text
        agents.append(response.json()['id'])
    cid=(await client.post('/api/conversations',headers=headers,json={'title':'Media snapshot','bot_ids':agents,'is_group':True})).json()['id']
    async def generate(*args):return [{'name':'fixture.png','mime':'image/png','data':'eA=='}]
    monkeypatch.setattr(media,'generate_media',generate)
    incoming=(await client.post('/api/conversations/'+cid+'/messages',headers=headers,json={'sender_type':'user','content':'Create an icon.','options':{'output':'image'}})).json()
    tenant=current_tenant_id.set(owner)
    try:result=await AgentOrchestrator().process_message(cid,'Create an icon.',incoming_message_id=incoming['message_id'],options={'output':'image'},participant_bot_ids=[agents[1]])
    finally:current_tenant_id.reset(tenant)
    assert result[-1]['sender_bot_id']==agents[1]
