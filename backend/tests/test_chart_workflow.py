"""Actual API -> persisted task -> worker -> chart -> authenticated downloads.

Only the model response is controlled. Chart rendering and storage are real.
"""
import asyncio
from contextlib import suppress
import io
import json

import litellm
from PIL import Image
import pytest

from .test_workspace_workflows import workspace


@pytest.mark.asyncio
async def test_requested_chart_survives_worker_and_downloads_remain_tenant_scoped(workspace,monkeypatch):
    from app.services import worker
    from app.services.llm_gateway import LLMGateway
    client,_=workspace
    headers={'x-grokbot-user-id':'chart-owner'}
    bot=await client.post('/api/bots',headers=headers,json={
        'name':'Chart test','role':'Analyst','system_prompt':'Produce the requested chart.',
        'llm_provider':'openai','llm_model':'gpt-6-luna','tools_enabled':['media']})
    assert bot.status_code==200
    room=(await client.post('/api/conversations',headers=headers,json={'title':'Chart workflow test','bot_ids':[bot.json()['id']]})).json()['id']
    returned_files=[]
    async def complete(**kwargs):
        messages=kwargs['messages']
        if messages[-1]['role']!='tool':
            assert 'create_chart' in {tool['function']['name'] for tool in kwargs['tools']}
            message={'role':'assistant','content':None,'tool_calls':[{
                'id':'requested-chart','type':'function','function':{'name':'create_chart','arguments':json.dumps({
                    'title':'Actual supplied revenue','chart_type':'bar','labels':['Q1','Q2'],
                    'series':[{'name':'Revenue','values':[10,15]}],'data_origin':'user_provided'})}}]}
        else:
            receipt=json.loads(messages[-1]['content'])
            assert receipt['success'] is True
            assert '_attachments' not in receipt
            returned_files.extend(receipt['files'])
            assert len(returned_files)==3
            message={'role':'assistant','content':f'![Actual supplied revenue]({returned_files[0]["url"]})\n\n[CSV]({returned_files[2]["url"]})'}
        return litellm.ModelResponse(choices=[{'index':0,'message':message,'finish_reason':'stop'}])
    monkeypatch.setattr(LLMGateway,'complete',complete)
    accepted=await client.post(f'/api/conversations/{room}/messages',headers=headers,json={
        'sender_type':'user','content':'Chart Q1 10 and Q2 15.','options':{'allow_tools':True,'routing':'manual','max_iterations':2}})
    assert accepted.status_code==202
    runner=asyncio.create_task(worker.run_worker())
    try:
        async with asyncio.timeout(10):
            while True:
                jobs=(await client.get(f'/api/conversations/{room}/tasks',headers=headers)).json()
                if jobs[0]['status'] in {'completed','failed'}:break
                await asyncio.sleep(.03)
        assert jobs[0]['status']=='completed'
        history=(await client.get(f'/api/conversations/{room}/messages',headers=headers)).json()
        assert any('![Actual supplied revenue]' in message['content'] for message in history)
        for index,item in enumerate(returned_files):
            response=await client.get(item['url'],headers=headers)
            assert response.status_code==200
            assert (await client.get(item['url'],headers={'x-grokbot-user-id':'other-chart-owner'})).status_code==404
            if index==0:assert Image.open(io.BytesIO(response.content)).size==(1280,820)
            if index==1:assert response.content.startswith(b'<svg')
            if index==2:assert b'Q1,10.0' in response.content and b'Q2,15.0' in response.content
    finally:
        runner.cancel()
        with suppress(asyncio.CancelledError):await runner
