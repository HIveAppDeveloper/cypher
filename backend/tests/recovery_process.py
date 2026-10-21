"""Subprocess fixture: a real worker, PostgreSQL lock, and hard process death."""
import asyncio,json,os,sys
from pathlib import Path
import httpx,litellm
from sqlalchemy import select,text
from app.db.bootstrap import initialize_database
from app.db.session import AsyncSessionLocal,engine
from app.main import app
from app.models.automation import Goal
from app.models.task import Task
from app.models.execution import TaskExecution
from app.models.message import Message
from app.services import orchestrator,worker
from app.services.memory import MemoryManager
from app.services.tools.registry import ToolRegistry

folder=Path(sys.argv[2]);mode=sys.argv[1]

async def main():
    assert os.environ['DATABASE_SCHEMA'].startswith('e2e_')
    if mode=='seed':
        await initialize_database()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test',headers={'Authorization':'Bearer '+os.environ['BACKEND_API_TOKEN'],'x-grokbot-user-id':'crash-test'}) as client:
            b=await client.post('/api/bots',json={'name':'Crash recovery fixture','role':'Assistant','system_prompt':'Finish the controlled test.','tools_enabled':['filesystem'],'llm_provider':'openai','llm_model':'gpt-6-luna'})
            assert b.status_code==200,b.text
            r=await client.post('/api/conversations',json={'title':'Recovery fixture','bot_ids':[b.json()['id']]})
            assert r.status_code==200,r.text
            g=await client.post('/api/goals',json={'conversation_id':r.json()['id'],'title':'Crash test','objective':'Write once, recover, complete.','success_criteria':'One write and a completed goal.','max_runs':1,'manager_model':'gpt-6-luna'})
            assert g.status_code==201,g.text
            (folder/'ids.json').write_text(json.dumps({'goal':g.json()['id'],'room':r.json()['id']}))
    elif mode in ('leader','standby'):
        async def no_redis(self):return None
        MemoryManager._get_redis=no_redis
        original=ToolRegistry.register_default_tools
        def register(self):
            original(self)
            async def write(args,bot):
                path=folder/'writes.txt';path.write_text(path.read_text()+'write\n' if path.exists() else 'write\n')
                return {'success':True,'content':'Written once.'}
            self._tools['write_file']['handler']=write
        ToolRegistry.register_default_tools=register
        async def complete(**kwargs):
            messages=kwargs['messages']
            tools=[m for m in messages if m['role']=='tool']
            if not tools:name,args='write_file',{'path':'/workspace/test.txt','content':'once'}
            elif len(tools)==1:
                if mode=='leader':
                    (folder/'ready').write_text('write checkpoint persisted')
                    await asyncio.Event().wait()
                name,args='complete_goal',{'evidence':'Recovered after SIGKILL; one write.'}
            else:
                return litellm.ModelResponse(choices=[{'index':0,'message':{'role':'assistant','content':'RECOVERY VERIFIED'},'finish_reason':'stop'}])
            return litellm.ModelResponse(choices=[{'index':0,'message':{'role':'assistant','tool_calls':[{'id':'call_'+name,'type':'function','function':{'name':name,'arguments':json.dumps(args)}}]},'finish_reason':'tool_calls'}])
        orchestrator.LLMGateway.complete=complete
        worker.POLL_SECONDS=.1
        from app.worker_main import main as serve
        await serve()
    elif mode=='verify':
        ids=json.loads((folder/'ids.json').read_text())
        async with AsyncSessionLocal() as db:
            goal=await db.get(Goal,ids['goal']);task=await db.get(Task,goal.last_task_id);state=await db.get(TaskExecution,task.id)
            messages=list((await db.execute(select(Message).where(Message.conversation_id==ids['room']))).scalars())
            report={'goal_status':goal.status,'goal_runs':goal.runs,'task_status':task.status,'attempts':state.attempts,'recoveries':state.recoveries,'writes':len((folder/'writes.txt').read_text().splitlines()),'final_messages':sum(m.content=='RECOVERY VERIFIED' for m in messages),'write_calls':sum(m.message_type=='tool_call' and (m.metadata_json or {}).get('tool_name')=='write_file' for m in messages)}
            print(json.dumps(report),flush=True)
            assert report['goal_status']=='completed' and report['task_status']=='completed'
            assert report['goal_runs']==report['writes']==report['final_messages']==1
            assert report['attempts']==2 and report['recoveries']==1
    elif mode=='drop':
        async with engine.begin() as conn:await conn.execute(text('DROP SCHEMA "'+os.environ['DATABASE_SCHEMA']+'" CASCADE'))
    await engine.dispose()

asyncio.run(main())
