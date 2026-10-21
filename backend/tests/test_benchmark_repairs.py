"""Regressions found by controlled production task runs, not model-quality mocks."""
import asyncio
import base64
import json
import subprocess
import sys
from contextlib import suppress
from uuid import uuid4
from types import SimpleNamespace
import pytest
from litellm import ModelResponse
from app.models.message import Message
from app.services import context, orchestrator, worker
from app.services.tools import artifacts
from app.services.tools.registry import ToolRegistry, rank_plugin_tools
from app.services.response_constraints import word_limit,word_count,steer_limit
from .test_workspace_workflows import workspace, room

A={'x-grokbot-user-id':'benchmark-owner'}
B={'x-grokbot-user-id':'benchmark-other'}


def export(root, path, limit=artifacts.MAX_FILE_BYTES):
    script=artifacts.EXPORT_SCRIPT.replace("pathlib.Path('/workspace')",f'pathlib.Path({str(root)!r})')
    result=subprocess.run([sys.executable,'-c',script,str(path),str(limit)],capture_output=True,text=True,check=True)
    return json.loads(result.stdout)


def test_export_preserves_large_binary_and_rejects_escape_directory_and_oversize(tmp_path):
    root=tmp_path/'workspace';root.mkdir()
    content=bytes(range(256))*300
    path=root/'deliverable.bin';path.write_bytes(content)
    assert base64.b64decode(export(root,path)['data'])==content
    assert 'error' in export(root,root)
    outside=tmp_path/'outside';outside.write_text('private outside file')
    (root/'escape').symlink_to(outside)
    assert 'error' in export(root,root/'escape')
    assert 'error' in export(root,path,limit=10)
    assert 'error' in export(root,root/'missing')


@pytest.mark.asyncio
async def test_publish_attachment_is_durable_download_with_owner_auth(workspace,monkeypatch):
    client,sessions=workspace
    cid=await room(client,'benchmark-owner')
    bid=(await client.get('/api/bots',headers=A)).json()[0]['id']
    assert (await client.put('/api/bots/'+bid,headers=A,json={'tools_enabled':['filesystem']})).status_code==200
    payload=b'<html>controlled deliverable</html>'
    def read(bot,script,path,limit):
        assert bot==bid and path=='/workspace/report.html'
        return {'exit_code':0,'output':json.dumps({'name':'report.html','data':base64.b64encode(payload).decode()})}
    monkeypatch.setattr(artifacts.SandboxManager,'read_artifact',read)
    seen=[]
    async def complete(**kw):
        if kw['messages'][-1]['role']=='tool':
            result=json.loads(kw['messages'][-1]['content']);seen.append(result)
            assert result['success'] and 'data' not in json.dumps(result)
            assert result['files'][0]['url'].startswith('/api/conversations/'+cid+'/attachments/')
            message={'role':'assistant','content':'Finished: '+result['files'][0]['url']}
        else:
            assert 'publish_file' in {t['function']['name'] for t in kw['tools']}
            message={'role':'assistant','tool_calls':[{'id':'publish','type':'function','function':{'name':'publish_file','arguments':json.dumps({'path':'/workspace/report.html'})}}]}
        return ModelResponse(choices=[{'message':message}])
    monkeypatch.setattr(orchestrator.LLMGateway,'complete',complete)
    accepted=await client.post('/api/conversations/'+cid+'/messages',headers=A,json={'sender_type':'user','content':'Create my report file'})
    runner=asyncio.create_task(worker.run_worker())
    try:
        for _ in range(200):
            jobs=(await client.get('/api/conversations/'+cid+'/tasks',headers=A)).json()
            if jobs[0]['status'] in {'completed','failed'}:break
            await asyncio.sleep(.02)
        assert jobs[0]['status']=='completed' and len(seen)==1
        messages=(await client.get('/api/conversations/'+cid+'/messages',headers=A)).json()
        generated=next(m for m in messages if m['content']=='Files ready')
        attachment=generated['metadata_json']['attachments'][0]
        assert 'data' not in attachment
        result=await client.get(attachment['url'],headers=A)
        assert result.content==payload
        assert result.headers['content-disposition'].startswith('attachment;')
        assert result.headers['x-content-type-options']=='nosniff'
        assert (await client.get(attachment['url'],headers=B)).status_code==404
        # The delivered snapshot does not need a live sandbox to be downloaded.
        def gone(*a):raise AssertionError('Attachment download touched sandbox')
        monkeypatch.setattr(artifacts.SandboxManager,'read_artifact',gone)
        assert (await client.get(attachment['url'],headers=A)).content==payload
    finally:
        runner.cancel()
        with suppress(asyncio.CancelledError):await runner


@pytest.mark.asyncio
async def test_export_error_never_claims_download(monkeypatch):
    def fail(*a):return {'exit_code':0,'output':json.dumps({'error':'File missing'})}
    monkeypatch.setattr(artifacts.SandboxManager,'read_artifact',fail)
    for path in ['/etc/passwd','relative.txt','/workspace/missing']:
        result=await artifacts.publish_file({'path':path},'agent')
        assert result['success'] is False and '_attachments' not in result


@pytest.mark.asyncio
async def test_bot_memory_survives_new_chat_and_is_not_visible_to_other_agents(workspace):
    from app.db.tenancy import current_tenant_id
    from app.services.workspace import knowledge_prompt
    client,sessions=workspace
    cid=await room(client,'benchmark-owner')
    bid=(await client.get('/api/bots',headers=A)).json()[0]['id']
    await room(client,'benchmark-other')
    foreign=(await client.get('/api/bots',headers=B)).json()[0]['id']
    registry=ToolRegistry();registry.register_default_tools()
    await context.register_context_tools(registry,cid,sessions)
    remember=registry._tools['remember_context']['handler']
    token=current_tenant_id.set('benchmark-owner')
    try:
        result=await remember({'name':'release preference','kind':'preference','content':'Cobalt Finch; three bullets Outcome, Evidence, Next','scope':'bot'},bid)
        assert result['saved'] and result['scope']=='bot' and result['available_in_new_chats']
        async with sessions() as db:
            assert 'Cobalt Finch' in await knowledge_prompt(db,bid)
            assert 'Cobalt Finch' not in await knowledge_prompt(db,'other-agent')
            assert await context.context_prompt(db,cid)==''
        assert 'error' in await remember({'name':'bad','kind':'preference','content':'private','scope':'bot'},foreign)
        assert 'error' in await remember({'name':'bad','kind':'preference','content':'password=privatevalue','scope':'bot'},bid)
        result=await remember({'name':'old behavior','kind':'fact','content':'Only in this conversation'},bid)
        assert not result['available_in_new_chats']
    finally:current_tenant_id.reset(token)
    other=current_tenant_id.set('benchmark-other')
    try:
        async with sessions() as db:assert 'Cobalt Finch' not in await knowledge_prompt(db,bid)
    finally:current_tenant_id.reset(other)
    fresh=(await client.post('/api/conversations',headers=A,json={'title':'Fresh memory check','bot_ids':[bid]})).json()['id']
    assert fresh!=cid
    notes=(await client.get('/api/workspace/knowledge',headers=A)).json()
    assert notes[0]['scope']=='bot:'+bid and 'Cobalt Finch' in notes[0]['content']


def test_plugin_search_keeps_service_and_exact_operation_in_scope():
    manifest=[{'service':'Linear','name':'list_projects','description':'list projects and deployments '*100},
              {'service':'Vercel','name':'search_vercel_documentation','description':'Search docs for projects and deployments'},
              {'service':'Vercel','name':'list_projects','description':'List projects'},
              {'service':'Vercel','name':'get_deployment','description':'Get a deployment'}]
    assert rank_plugin_tools(manifest,'Vercel list_projects')[0]['name']=='list_projects'
    assert all(t['service']=='Vercel' for t in rank_plugin_tools(manifest,'Vercel list_projects'))
    assert rank_plugin_tools(manifest,'get_deployment',service='Vercel')[0]['name']=='get_deployment'
    assert rank_plugin_tools(manifest,'list_projects',service='missing')==[]
    assert rank_plugin_tools(manifest,'list_projects')[0]['name']=='list_projects'


@pytest.mark.asyncio
async def test_browser_extraction_preserves_full_titles_after_long_menu(monkeypatch):
    from app.services.tools.browser import BrowserTool
    browser=BrowserTool()
    async def save(*a):pass
    monkeypatch.setattr(browser,'_save_state',save)
    monkeypatch.setattr(browser,'_load_state',lambda *a: asyncio.sleep(0,result=None))
    try:
        page=await browser._get_page('extraction-test')
        await page.set_content('<div class="page_inner"><nav>'+''.join(f'<a href="https://example.test/{n}">Menu {n}</a>' for n in range(120))+'</nav><main><article><a href="https://example.test/book" title="The full untruncated book title">The full...</a></article></main></div>')
        result=await browser.extract_content('Get the first book','extraction-test')
        assert result['success']
        assert result['links'][0]['title']=='The full untruncated book title'
        assert result['links'][0]['href']=='https://example.test/book'
        assert len(result['links'])<=100
    finally:await browser.close()


def test_explicit_word_budgets_count_visible_prose_and_follow_owner_steering():
    assert word_limit('Keep it under 180 words.')==179
    assert word_limit('At most 20 words')==20
    assert word_limit('Please analyze this') is None
    assert word_count('See [official Python sources](https://example.test/a-long-link).')==4
    assert steer_limit(179,'Make it longer and more detailed') is None
    assert steer_limit(179,'Use at most 40 words instead')==40
    assert steer_limit(179,'Also include the date')==179


@pytest.mark.asyncio
@pytest.mark.parametrize('always_long,iterations,expected',[(False,4,'completed'),(True,4,'failed'),(True,1,'failed')])
async def test_word_limit_revisions_are_bounded_and_only_publish_checked_reply(workspace,monkeypatch,always_long,iterations,expected):
    client,sessions=workspace;cid=await room(client,'benchmark-owner');calls=[]
    async def complete(**kw):
        calls.append(kw)
        if len(calls)>1:
            assert not kw.get('tools')
            assert 'Final-answer format check' in kw['messages'][-1]['content']
        text='one two three four five six seven eight nine ten eleven twelve' if always_long or len(calls)==1 else 'Verified [source](https://example.test/verified).'
        return ModelResponse(choices=[{'message':{'role':'assistant','content':text}}])
    monkeypatch.setattr(orchestrator.LLMGateway,'complete',complete)
    await client.post('/api/conversations/'+cid+'/messages',headers=A,json={'sender_type':'user','content':'Answer in at most 10 words.','options':{'max_iterations':iterations}})
    runner=asyncio.create_task(worker.run_worker())
    try:
        for _ in range(200):
            jobs=(await client.get('/api/conversations/'+cid+'/tasks',headers=A)).json()
            if jobs[0]['status'] in {'completed','failed'}:break
            await asyncio.sleep(.02)
        assert jobs[0]['status']==expected
        assert len(calls)<=(3 if iterations>1 else 1)
        messages=(await client.get('/api/conversations/'+cid+'/messages',headers=A)).json()
        assert not any('eleven twelve' in m['content'] for m in messages)
        if expected=='completed':assert any('https://example.test/verified' in m['content'] for m in messages)
    finally:
        runner.cancel()
        with suppress(asyncio.CancelledError):await runner
