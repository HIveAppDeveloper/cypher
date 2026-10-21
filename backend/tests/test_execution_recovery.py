import asyncio
from contextlib import suppress
from datetime import datetime
import pytest
from app.models.execution import ExecutionStep, TaskExecution
from app.models.task import Task
from app.services.execution import ExecutionJournal, RecoveryReviewRequired, retry_or_interrupt
from app.db.tenancy import current_tenant_id
from .test_workspace_workflows import workspace, room


@pytest.mark.asyncio
async def test_checkpoint_replay_and_ambiguous_write_are_different(workspace):
    client,sessions=workspace
    rid=await room(client,'recovery-owner')
    bot=(await client.get('/api/bots',headers={'x-grokbot-user-id':'recovery-owner'})).json()[0]['id']
    token=current_tenant_id.set('recovery-owner')
    try:
        async with sessions() as db:
            task=Task(conversation_id=rid,bot_id=bot,title='recover',description='recover',status='running',result={'request':{'goal_id':'preserved'}})
            db.add(task);await db.flush()
            db.add(TaskExecution(task_id=task.id,attempts=1,recoveries=0));await db.commit()
        journal=ExecutionJournal(task.id,sessions)
        calls=[]
        async def external():calls.append(1);return {'success':True,'value':[1]}
        result=await journal.run('done','write_file',False,external)
        result['value'].append(2)
        assert await journal.run('done','write_file',False,external)=={'success':True,'value':[1]}
        assert len(calls)==1
        async def interrupted():raise asyncio.CancelledError()
        with pytest.raises(asyncio.CancelledError):await journal.run('read','search_web',True,interrupted)
        async with sessions() as db:
            row=await db.get(Task,task.id)
            assert await retry_or_interrupt(db,row,immediate=True)=='pending'
            assert row.result['request']['goal_id']=='preserved'
            await db.commit()
        assert await journal.run('read','search_web',True,external)=={'success':True,'value':[1]}
        with pytest.raises(asyncio.CancelledError):await journal.run('unknown','send_email',False,interrupted)
        with pytest.raises(RecoveryReviewRequired):await journal.run('unknown','send_email',False,external)
        async with sessions() as db:
            row=await db.get(Task,task.id)
            assert await retry_or_interrupt(db,row)=='interrupted'
            assert 'send_email' in row.result['recovery']['message']
    finally:current_tenant_id.reset(token)


@pytest.mark.asyncio
async def test_worker_supervisor_recovers_database_startup_and_exits_on_stop(monkeypatch):
    from app import worker_main
    from app.db import bootstrap
    stopped=asyncio.Event();calls=[]
    async def initialize(_engine):
        calls.append('initialize')
        if len(calls)==1:raise ConnectionError('offline')
    async def runner(stop_event):calls.append('run');stop_event.set()
    monkeypatch.setattr(bootstrap,'initialize_database',initialize)
    monkeypatch.setattr(worker_main,'run_worker',runner)
    await asyncio.wait_for(worker_main.supervise_worker(stopped,minimum_delay=.001,maximum_delay=.002),2)
    assert calls==['initialize','initialize','run']
