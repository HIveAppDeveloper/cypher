import asyncio,json
from datetime import datetime,timedelta
from types import SimpleNamespace
from uuid import uuid4
import pytest
from sqlalchemy import select
from .test_workspace_workflows import workspace,room
from app.db.tenancy import current_tenant_id
from app.models.task import Task
from app.models.workspace import ComputerCommand,ComputerControl,ToolApproval
from app.services import computer,usage
from app.services.plugins import reveal

A={'x-grokbot-user-id':'computer-a'}
B={'x-grokbot-user-id':'computer-b'}

@pytest.mark.asyncio
async def test_owner_takeover_command_round_trip_and_encrypted_inputs(workspace,monkeypatch):
    client,sessions=workspace
    await room(client,'computer-a')
    bid=(await client.get('/api/bots',headers=A)).json()[0]['id']
    base='/api/computer/'+bid
    assert (await client.post(base+'/commands',headers=A,json={'action':'type','text':'private input'})).status_code==409
    assert (await client.post(base+'/control',headers=B,json={'takeover':True})).status_code==404
    assert (await client.post(base+'/control',headers=A,json={'takeover':True})).status_code==200
    response=await client.post(base+'/commands',headers=A,json={'action':'type','text':'private input'})
    assert response.status_code==202,response.text
    command_id=response.json()['id']
    async with sessions() as db:
        row=await db.get(ComputerCommand,command_id)
        assert 'private input' not in row.payload and 'private input' in reveal(row.payload)
    seen=[]
    async def execute(row,args):seen.append((current_tenant_id.get(),row.action,args['text']));return {'success':True,'title':'Controlled page'}
    monkeypatch.setattr(computer,'execute_command',execute)
    await computer.tick_commands(sessions);await computer.tick_commands(sessions)
    assert seen==[('computer-a','type','private input')]
    result=(await client.get(base+'/commands/'+command_id,headers=A)).json()
    assert result['status']=='completed' and result['result']['title']=='Controlled page'
    assert (await client.get(base+'/commands/'+command_id,headers=B)).status_code==404
    async with sessions() as db:assert (await db.get(ComputerCommand,command_id)).payload==''
    await client.post(base+'/control',headers=A,json={'takeover':False})
    assert (await client.post(base+'/commands',headers=A,json={'action':'screenshot'})).status_code==409

@pytest.mark.asyncio
async def test_write_approval_really_blocks_execution_until_owner_decides(workspace):
    client,sessions=workspace
    cid=await room(client,'computer-a');bid=(await client.get('/api/bots',headers=A)).json()[0]['id']
    task_id=(await client.post('/api/conversations/'+cid+'/messages',headers=A,json={'sender_type':'user','content':'Write a file'})).json()['task_id']
    await client.patch('/api/workspace/settings',headers=A,json={'tool_approval':'writes'})
    async with sessions() as db:
        task=await db.get(Task,task_id);task.status='running';await db.commit()
    tenant=current_tenant_id.set('computer-a');context=usage.active.set((task_id,sessions))
    try:
        assert await computer.approve_tool('read_file',{},bid,True)
        gate=asyncio.create_task(computer.approve_tool('write_file',{'path':'/workspace/test'},bid,False))
        pending=[]
        for _ in range(100):
            pending=(await client.get('/api/computer/approvals/pending',headers=A)).json()
            if pending:break
            await asyncio.sleep(.01)
        assert len(pending)==1 and not gate.done()
        id=pending[0]['id']
        assert (await client.post('/api/computer/approvals/'+id,headers=B,json={'approved':True})).status_code==404
        assert (await client.post('/api/computer/approvals/'+id,headers=A,json={'approved':False})).status_code==200
        assert await asyncio.wait_for(gate,4) is False
    finally:usage.active.reset(context);current_tenant_id.reset(tenant)

@pytest.mark.asyncio
async def test_shared_files_are_available_to_same_workspace_and_not_other_users(workspace):
    client,sessions=workspace
    assert (await client.post('/api/computer/shared/files',headers=A,json={'name':'brief.md','content':'Verified workspace evidence'})).status_code==200
    files=(await client.get('/api/computer/shared/files',headers=A)).json();assert len(files)==1
    assert (await client.get('/api/computer/shared/files',headers=B)).json()==[]
    assert (await client.get('/api/computer/shared/files/'+files[0]['id'],headers=B)).status_code==404
    tenant=current_tenant_id.set('computer-a');context=usage.active.set(('test',sessions))
    try:
        result=await computer.shared_files_tool({'action':'read','name':'brief.md'},'same-owner-agent')
        assert result['content']=='Verified workspace evidence'
    finally:usage.active.reset(context);current_tenant_id.reset(tenant)
