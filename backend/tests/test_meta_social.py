import json
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from app.db.tenancy import current_tenant_id
from app.models.plugin import Plugin
from app.services import plugins
from .test_workspace_workflows import workspace

PRIVATE_ACCOUNT='private-account-do-not-publish'
CATALOG={'connectors':[{'id':'facebook_organic','accounts':[{'id':PRIVATE_ACCOUNT,'name':'Private page'}]},{'id':'instagram','accounts':[]},{'id':'instagram_public','accounts':[{'id':'not-an-authorized-instagram-account'}]}]}

async def saved(sessions,**changes):
    context=current_tenant_id.set('meta-owner')
    try:
        async with sessions() as db:
            row=Plugin(name='Windsor.ai',url='https://mcp.windsor.ai/',enabled=True,credential='unchanged-encrypted-grant',tools=[{'name':'get_connectors','enabled':True,'schema':{'type':'object'}},{'name':'get_connector_connect_info','enabled':True,'schema':{'type':'object','properties':{'connector':{'type':'string'}},'required':['connector'],'additionalProperties':False}}],**changes)
            db.add(row);await db.commit();return row.id
    finally:current_tenant_id.reset(context)

def provider(monkeypatch,catalog=CATALOG,info=None,failure=None,text=False):
    calls=[]
    @asynccontextmanager
    async def session(*_,**__):
        class Client:
            async def call_tool(self,name,args):
                calls.append((name,args))
                if failure:raise failure
                data=catalog if name=='get_connectors' else info
                return SimpleNamespace(isError=False,structuredContent=None if text else data,content=[SimpleNamespace(type='text',text=json.dumps(data))] if text else [])
        yield Client()
    monkeypatch.setattr(plugins,'session',session)
    monkeypatch.setattr(plugins,'connection_auth',AsyncMock(return_value=('synthetic-oauth',None)))
    return calls

@pytest.mark.asyncio
async def test_inspect_is_explicit_tenant_owned_and_returns_counts_without_private_assets(workspace,monkeypatch):
    client,sessions=workspace;pid=await saved(sessions);calls=provider(monkeypatch)
    path=f'/api/plugins/{pid}/meta/inspect'
    assert (await client.get(path,headers={'x-grokbot-user-id':'meta-owner'})).status_code==405
    assert (await client.post(path,headers={'x-grokbot-user-id':'foreign-owner'})).status_code==404
    assert not calls
    response=await client.post(path,headers={'x-grokbot-user-id':'meta-owner'})
    assert response.status_code==200
    items={item['id']:item for item in response.json()['services']}
    assert items['facebook_organic']['status']=='accounts_listed' and items['facebook_organic']['account_count']==1
    assert items['instagram']['status']=='not_connected' and items['instagram']['account_count']==0
    assert all(item['data_access_verified'] is False for item in items.values())
    assert PRIVATE_ACCOUNT not in response.text and 'Private page' not in response.text and 'instagram_public' not in response.text
    assert calls==[('get_connectors',{'include_not_yet_connected':True,'include_actions':False,'include_options':False})]

@pytest.mark.asyncio
async def test_allow_uses_exact_discovered_connector_and_preserves_provider_notes_verbatim(workspace,monkeypatch):
    client,sessions=workspace;pid=await saved(sessions)
    notes='Select only the Pages you want to share.\nKeep the requested permissions selected.'
    url='https://onboard.windsor.ai/connect?connector=facebook_organic&state=synthetic'
    calls=provider(monkeypatch,info={'auth_type':'oauth','connect_url':url,'notes':notes})
    response=await client.post(f'/api/plugins/{pid}/meta/authorize',headers={'x-grokbot-user-id':'meta-owner'},json={'service':'facebook_organic'})
    assert response.status_code==200 and response.json()['authorization_url']==url
    assert response.headers['cache-control']=='private, no-store' and response.headers['referrer-policy']=='no-referrer'
    assert response.json()['notes']==notes and response.json()['data_access_verified'] is False
    assert [name for name,_ in calls]==['get_connectors','get_connector_connect_info']
    assert calls[-1][1]=={'connector':'facebook_organic'}
    context=current_tenant_id.set('meta-owner')
    try:
        async with sessions() as db:assert (await db.get(Plugin,pid)).credential=='unchanged-encrypted-grant'
    finally:current_tenant_id.reset(context)

@pytest.mark.asyncio
async def test_missing_connector_cannot_be_guessed_and_public_instagram_is_not_a_grant(workspace,monkeypatch):
    client,sessions=workspace;pid=await saved(sessions)
    calls=provider(monkeypatch,catalog={'connectors':[{'id':'instagram_public','accounts':[{'id':'public'}]}]})
    response=await client.post(f'/api/plugins/{pid}/meta/authorize',headers={'x-grokbot-user-id':'meta-owner'},json={'service':'instagram'})
    assert response.status_code==409 and len(calls)==1

@pytest.mark.asyncio
@pytest.mark.parametrize('url',['http://onboard.windsor.ai/','https://onboard.windsor.ai.evil.test/','https://user:secret@onboard.windsor.ai/','https://onboard.windsor.ai:444/','javascript:alert(1)'])
async def test_provider_authorization_addresses_fail_closed(workspace,monkeypatch,url):
    client,sessions=workspace;pid=await saved(sessions)
    provider(monkeypatch,info={'auth_type':'oauth','connect_url':url,'notes':None})
    response=await client.post(f'/api/plugins/{pid}/meta/authorize',headers={'x-grokbot-user-id':'meta-owner'},json={'service':'instagram'})
    assert response.status_code==502 and url not in response.text

@pytest.mark.asyncio
@pytest.mark.parametrize('mode',['disabled','wrong_endpoint','disabled_tool','unregistered_tool'])
async def test_only_enabled_registered_windsor_tools_can_run(workspace,monkeypatch,mode):
    client,sessions=workspace;pid=await saved(sessions);calls=provider(monkeypatch)
    context=current_tenant_id.set('meta-owner')
    try:
        async with sessions() as db:
            row=await db.get(Plugin,pid)
            if mode=='disabled':row.enabled=False
            elif mode=='wrong_endpoint':row.url='https://mcp.windsor.ai.evil.test/'
            elif mode=='disabled_tool':row.tools=[{**tool,'enabled':False} for tool in row.tools]
            else:row.tools=[]
            await db.commit()
    finally:current_tenant_id.reset(context)
    response=await client.post(f'/api/plugins/{pid}/meta/inspect',headers={'x-grokbot-user-id':'meta-owner'})
    assert response.status_code in {409,422} and not calls

@pytest.mark.asyncio
async def test_text_results_are_supported_and_malformed_account_shape_stays_unknown(workspace,monkeypatch):
    client,sessions=workspace;pid=await saved(sessions)
    provider(monkeypatch,catalog={'connectors':[{'id':'instagram','accounts':[{'name':'no-id'}]}]},text=True)
    response=await client.post(f'/api/plugins/{pid}/meta/inspect',headers={'x-grokbot-user-id':'meta-owner'})
    item=next(item for item in response.json()['services'] if item['id']=='instagram')
    assert item['status']=='unknown' and item['account_count'] is None and item['data_access_verified'] is False

@pytest.mark.asyncio
@pytest.mark.parametrize('status,expected',[(401,401),(429,429),(503,502)])
async def test_provider_failures_are_sanitized_without_changing_the_saved_grant(workspace,monkeypatch,status,expected):
    client,sessions=workspace;pid=await saved(sessions)
    error=httpx.HTTPStatusError('secret raw provider response',request=httpx.Request('POST','https://mcp.windsor.ai/'),response=httpx.Response(status))
    provider(monkeypatch,failure=error)
    response=await client.post(f'/api/plugins/{pid}/meta/inspect',headers={'x-grokbot-user-id':'meta-owner'})
    assert response.status_code==expected and 'secret' not in response.text

@pytest.mark.asyncio
async def test_full_catalog_is_filtered_before_agent_output_truncation_and_never_claims_account_access(workspace,monkeypatch):
    client,sessions=workspace;pid=await saved(sessions)
    catalog={'connectors':CATALOG['connectors']+[{'id':'unrelated-'+str(index),'name':'private-unrelated-name'*40,'accounts':[{'id':'private-unrelated-account'}]} for index in range(400)]}
    assert len(json.dumps(catalog))>20000
    provider(monkeypatch,catalog=catalog)
    response=await client.post(f'/api/plugins/{pid}/meta/inspect',headers={'x-grokbot-user-id':'meta-owner'})
    assert response.status_code==200 and len(response.json()['services'])==2
    assert 'private-unrelated' not in response.text and all(not item['data_access_verified'] for item in response.json()['services'])
