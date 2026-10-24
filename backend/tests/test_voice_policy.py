import base64
import json
from types import SimpleNamespace
import pytest
from app.schemas.input import RunOptions
from app.services.voice_policy import voice_options, requests_teammates
from app.db.tenancy import current_tenant_id
from app.models.message import Message
from app.services import attachments
from app.services.orchestrator import AgentOrchestrator
from app.services.llm_gateway import LLMGateway
from .test_workspace_workflows import workspace, room


def test_voice_defaults_do_not_change_text_options_or_explicit_effort():
    text=RunOptions(max_tokens=4096,reasoning_effort='high')
    assert voice_options(text) is text
    spoken=voice_options(RunOptions(voice_mode=True,max_tokens=4096))
    assert spoken.max_tokens==1024 and spoken.reasoning_effort=='none'
    assert voice_options(RunOptions(voice_mode=True,reasoning_effort='high')).reasoning_effort=='high'


def test_voice_preserves_explicit_teammates_and_team_directives():
    bots=[SimpleNamespace(id='lead',name='Coordinator',role='Coordinator'),SimpleNamespace(id='review',name='Backend Check Reviewer',role='Reviewer')]
    for text in ('Ask Reviewer to check my answer.','Ask Backend Check Reviewer.','Coordinate the team to verify this.'):
        assert requests_teammates(text,bots,bots[0])
    assert not requests_teammates('What is seventeen plus twenty-five?',bots,bots[0])


@pytest.mark.asyncio
@pytest.mark.parametrize('mode,provider,model',[('auto','openai','gpt-6.1-sol'),('manual','openai','gpt-6.1-sol')])
async def test_real_voice_request_is_transcribed_once_keeps_tools_and_respects_manual_model(workspace,monkeypatch,mode,provider,model):
    client,sessions=workspace
    owner='voice-policy-'+mode
    cid=await room(client,owner)
    prompt='Voice message attached. Please respond directly to what I said in the recording.'
    phrase='Repeat exactly: silver maple.'
    audio={'name':'fixture.webm','mime':'audio/webm','data':base64.b64encode(b'synthetic-audio').decode()}
    transcribed=[];calls=[]
    async def transcribe(file): transcribed.append(file['name']);return phrase
    async def complete(**kwargs):
        calls.append(kwargs)
        assert kwargs['provider']==provider and kwargs['model']==model
        assert kwargs['options'].max_tokens==1024
        assert kwargs['options'].voice_mode
        assert phrase in json.dumps(kwargs['messages'][-1]['content'])
        assert json.dumps(kwargs['messages']).count(phrase)==1
        assert 'one to three short sentences' in kwargs['messages'][0]['content']
        assert 'consult_specialist' in [t['function']['name'] for t in kwargs['tools']]
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='silver maple',tool_calls=None))])
    monkeypatch.setattr(attachments,'transcribe_audio',transcribe)
    monkeypatch.setattr(LLMGateway,'complete',complete)
    options={'voice_mode':True,'routing':mode,'provider':'openai','model':'gpt-6.1-sol','max_tokens':4096}
    accepted=(await client.post('/api/conversations/'+cid+'/messages',headers={'x-grokbot-user-id':owner},json={'sender_type':'user','content':prompt,'attachments':[audio],'options':options})).json()
    tenant=current_tenant_id.set(owner)
    try:
        replies=await AgentOrchestrator().process_message(cid,prompt,attachments=[audio],options=options,incoming_message_id=accepted['message_id'])
        async with sessions() as db:
            saved=await db.get(Message,accepted['message_id'])
            metrics=saved.metadata_json['voice_timings']
            assert metrics['worker_total_ms']>=metrics['agent_loop_ms']>=0
            assert metrics['queue_to_context_ms']>=0
            assert all(isinstance(value,(int,float)) for value in metrics.values())
            assert saved.metadata_json['attachments']==[audio]
    finally:current_tenant_id.reset(tenant)
    assert replies[-1]['content']=='silver maple'
    assert transcribed==['fixture.webm'] and len(calls)==1


@pytest.mark.asyncio
async def test_short_voice_group_request_skips_unnecessary_planner_but_keeps_tool_loop(workspace,monkeypatch):
    client,_=workspace;owner='voice-fast-group';headers={'x-grokbot-user-id':owner}
    bots=[]
    for role in ('Researcher','Coordinator','Reviewer'):
        response=await client.post('/api/bots',headers=headers,json={'name':role,'role':role,'system_prompt':'Answer accurately.','llm_provider':'openai','llm_model':'gpt-6.1-sol','tools_enabled':['plugins']})
        bots.append(response.json()['id'])
    cid=(await client.post('/api/conversations',headers=headers,json={'title':'Voice test','is_group':True,'bot_ids':bots})).json()['id']
    phrase='Reply exactly: silver maple.'
    audio={'name':'fixture.webm','mime':'audio/webm','data':base64.b64encode(b'synthetic-audio').decode()}
    transcribed=[];calls=[]
    async def transcribe(file):transcribed.append(file['name']);return phrase
    async def complete(**kwargs):
        calls.append(kwargs)
        assert 'Plan this task briefly' not in kwargs['messages'][0]['content']
        assert kwargs['provider']=='openai' and kwargs['model']=='gpt-6.1-sol'
        assert kwargs['tools'] and 'consult_specialist' in [t['function']['name'] for t in kwargs['tools']]
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='silver maple',tool_calls=None))])
    monkeypatch.setattr(attachments,'transcribe_audio',transcribe);monkeypatch.setattr(LLMGateway,'complete',complete)
    prompt='Voice message attached.';options={'voice_mode':True}
    accepted=(await client.post('/api/conversations/'+cid+'/messages',headers=headers,json={'sender_type':'user','content':prompt,'attachments':[audio],'options':options})).json()
    tenant=current_tenant_id.set(owner)
    try: replies=await AgentOrchestrator().process_message(cid,prompt,attachments=[audio],options=options,incoming_message_id=accepted['message_id'])
    finally:current_tenant_id.reset(tenant)
    assert replies[-1]['sender_bot_id']==bots[1]
    assert len(calls)==1 and transcribed==['fixture.webm']

@pytest.mark.asyncio
async def test_fast_voice_executes_real_enabled_tool_before_claiming_result(workspace,monkeypatch):
    client,_=workspace;owner='voice-tool-owner';cid=await room(client,owner)
    audio={'name':'fixture.webm','mime':'audio/webm','data':base64.b64encode(b'synthetic-audio').decode()}
    phrase='Read the saved conversation context and report whether anything is saved.'
    counts={'stt':0,'model':0};receipts=[]
    async def transcribe(file): counts['stt']+=1;return phrase
    async def complete(**kwargs):
        counts['model']+=1
        assert kwargs['provider']=='openai' and kwargs['model']=='gpt-6.1-sol'
        assert kwargs['tools'] and json.dumps(kwargs['messages']).count(phrase)==1
        if counts['model']==1:
            message={'role':'assistant','content':None,'tool_calls':[{'id':'voice-context-call','type':'function','function':{'name':'list_context','arguments':json.dumps({'scope':'conversation'})}}]}
        else:
            assert kwargs['messages'][-1]['role']=='tool'
            receipts.append(kwargs['messages'][-1]['content'])
            assert 'error' not in receipts[-1].lower()
            message={'role':'assistant','content':'There is no saved conversation context.','tool_calls':None}
        import litellm
        return litellm.ModelResponse(choices=[{'index':0,'message':message,'finish_reason':'stop'}])
    monkeypatch.setattr(attachments,'transcribe_audio',transcribe);monkeypatch.setattr(LLMGateway,'complete',complete)
    options={'voice_mode':True};prompt='Voice message attached.'
    accepted=(await client.post('/api/conversations/'+cid+'/messages',headers={'x-grokbot-user-id':owner},json={'sender_type':'user','content':prompt,'attachments':[audio],'options':options})).json()
    tenant=current_tenant_id.set(owner)
    try: replies=await AgentOrchestrator().process_message(cid,prompt,attachments=[audio],options=options,incoming_message_id=accepted['message_id'])
    finally:current_tenant_id.reset(tenant)
    assert counts=={'stt':1,'model':2} and receipts
    assert replies[-1]['content']=='There is no saved conversation context.'
