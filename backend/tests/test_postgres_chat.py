"""Verify media stays in PostgreSQL during chat sync, including tenant isolation."""
import os,base64
from uuid import uuid4
import pytest,httpx
pytestmark=pytest.mark.skipif(not os.getenv('GROKBOT_TEST_POSTGRES'),reason='Requires disposable PostgreSQL')

@pytest.mark.asyncio
async def test_incremental_chat_sync_keeps_media_private_and_fetches_it_only_on_request():
    from app.main import app
    from app.db.bootstrap import initialize_database
    from app.db.session import engine
    from app.config import settings
    from sqlalchemy import text,event
    assert settings.DATABASE_SCHEMA.startswith('e2e_')
    await initialize_database()
    queries=[]
    def capture(conn,cursor,statement,parameters,context,many):queries.append(statement)
    event.listen(engine.sync_engine,'before_cursor_execute',capture)
    headers={'x-grokbot-user-id':'sync-owner'}
    if settings.BACKEND_API_TOKEN:headers['Authorization']='Bearer '+settings.BACKEND_API_TOKEN
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test',headers=headers) as client:
            b=await client.post('/api/bots',json={'name':'Sync '+uuid4().hex,'role':'Assistant','system_prompt':'Test','llm_provider':'openai','llm_model':'gpt-6-luna','tools_enabled':[]})
            assert b.status_code==200,b.text
            room=(await client.post('/api/conversations',json={'title':'Sync test','bot_ids':[b.json()['id']]})).json()['id']
            raw=b'original-private-asset'*5000
            first=await client.post(f'/api/conversations/{room}/messages',json={'sender_type':'user','content':'First','attachments':[{'name':'input.txt','mime':'text/plain','data':base64.b64encode(raw).decode()}]})
            assert first.status_code==202,first.text
            r=await client.get(f'/api/conversations/{room}/sync');assert r.status_code==200,r.text
            messages=r.json()['messages'];assert len(messages)==1
            file=messages[0]['metadata_json']['attachments'][0]
            assert 'data' not in file and 'original-private-asset' not in r.text
            assert any('jsonb_agg' in query for query in queries)
            downloaded=await client.get(file['url']);assert downloaded.content==raw
            cursor=messages[0]['id']
            assert (await client.get(f'/api/conversations/{room}/sync?after_id={cursor}')).json()['messages']==[]
            await client.post(f'/api/conversations/{room}/messages',json={'sender_type':'user','content':'Second'})
            assert [m['content'] for m in (await client.get(f'/api/conversations/{room}/sync?after_id={cursor}')).json()['messages']]==['Second']
            other=await client.get(f'/api/conversations/{room}/sync',headers={'x-grokbot-user-id':'another-owner'})
            assert other.json()=={'messages':[],'tasks':[]}
    finally:
        event.remove(engine.sync_engine,'before_cursor_execute',capture)
        async with engine.begin() as conn:await conn.execute(text(f'DROP SCHEMA "{settings.DATABASE_SCHEMA}" CASCADE'))
        await engine.dispose()
