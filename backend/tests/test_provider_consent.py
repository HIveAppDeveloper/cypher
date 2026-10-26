import base64
import hashlib
import json
import time
from datetime import datetime
from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from sqlalchemy import select
from app.models.runtime import RuntimeCheck
from app.services import provider_consent as consent, model_connections as models, plugins, omniroute
from .test_model_connections import setup

BINDING='b'*43
KEY='sk-or-v1-'+'s'*48

async def start(client,owner):
    response=await client.post('/api/runtime/model-connections/openrouter/consent/start',headers=owner,json={'binding':BINDING})
    assert response.status_code==200
    data=response.json();state=parse_qs(urlsplit(data['authorization_url']).query)['state'][0]
    return data,state

def callback(data,state,**changes):
    return {'flow_id':data['flow_id'],'binding':BINDING,'state':state,'code':'synthetic-authorization-code',**changes}

@pytest.mark.asyncio
async def test_consent_is_owner_only_and_fails_before_redirect_when_gateway_is_unpaired(setup,monkeypatch):
    client,sessions,owner,other=setup
    support=AsyncMock(return_value=False);monkeypatch.setattr(consent,'gateway_support',support)
    assert (await client.post('/api/runtime/model-connections/openrouter/consent/start',headers=other,json={'binding':BINDING})).status_code==403
    assert support.await_count==0
    response=await client.post('/api/runtime/model-connections/openrouter/consent/start',headers=owner,json={'binding':BINDING})
    assert response.status_code==503 and 'unchanged' in response.json()['detail']
    async with sessions() as db:assert not list((await db.execute(select(RuntimeCheck).where(RuntimeCheck.name.startswith(consent.PREFIX)))).scalars())

@pytest.mark.asyncio
async def test_s256_flow_keeps_verifier_encrypted_and_binds_owner_browser_and_fixed_callback(setup,monkeypatch):
    client,sessions,owner,other=setup
    monkeypatch.setattr(consent,'gateway_support',AsyncMock(return_value=True))
    data,state=await start(client,owner)
    query=parse_qs(urlsplit(data['authorization_url']).query)
    assert query['callback_url']==[consent.CALLBACK] and query['code_challenge_method']==['S256']
    async with sessions() as db:
        row=await db.get(RuntimeCheck,consent.PREFIX+data['flow_id'])
        verifier=plugins.reveal(row.detail['verifier_encrypted'])
        assert verifier not in json.dumps(row.detail) and state not in json.dumps(row.detail)
        assert query['code_challenge']==[base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')]
    requests=[]
    def unexpected(request):requests.append(request);raise AssertionError('Invalid callback must not exchange')
    real=httpx.AsyncClient;monkeypatch.setattr(httpx,'AsyncClient',lambda **kwargs:real(transport=httpx.MockTransport(unexpected),**kwargs))
    path='/api/runtime/model-connections/openrouter/consent/finish'
    assert (await client.post(path,headers=other,json=callback(data,state))).status_code==403
    assert (await client.post(path,headers=owner,json=callback(data,state,binding='c'*43))).status_code==400
    assert (await client.post(path,headers=owner,json=callback(data,'different-state'))).status_code==400
    assert not requests

@pytest.mark.asyncio
async def test_allow_exchange_queues_encrypted_key_once_and_only_account_identity_can_finish(setup,monkeypatch):
    client,sessions,owner,_=setup
    monkeypatch.setattr(consent,'gateway_support',AsyncMock(return_value=True))
    data,state=await start(client,owner);seen=[]
    def exchange(request):
        seen.append((str(request.url),json.loads(request.content)))
        assert str(request.url)=='https://openrouter.ai/api/v1/auth/keys'
        return httpx.Response(200,json={'key':KEY})
    real=httpx.AsyncClient;monkeypatch.setattr(httpx,'AsyncClient',lambda **kwargs:real(transport=httpx.MockTransport(exchange),**kwargs))
    path='/api/runtime/model-connections/openrouter/consent/finish'
    response=await client.post(path,headers=owner,json=callback(data,state))
    assert response.status_code==200 and response.json()=={'status':'queued'}
    assert len(seen)==1 and seen[0][1]['code_challenge_method']=='S256'
    assert (await client.post(path,headers=owner,json=callback(data,state))).status_code==409
    assert len(seen)==1
    async with sessions() as db:
        flow=await db.get(RuntimeCheck,consent.PREFIX+data['flow_id']);record=await db.get(RuntimeCheck,models.PREFIX+'openrouter')
        assert 'verifier_encrypted' not in flow.detail and record.detail['credentials_encrypted']
        assert KEY not in json.dumps(record.detail) and 'synthetic-authorization-code' not in json.dumps(flow.detail)
    status_path='/api/runtime/model-connections/openrouter/consent/'+data['flow_id']
    assert (await client.get(status_path,headers=owner)).json()['status']=='saving'
    async def enrolled(payload):
        assert payload['api_key']==KEY and payload['action']=='connect_api_key'
        return {'state':'connected','account_connected':True,'message':'Account connected; model unverified.'}
    monkeypatch.setattr(models,'control_check',enrolled)
    assert await models.run_requested_check(sessions,AsyncMock())
    status=(await client.get(status_path,headers=owner)).json()
    assert status['status']=='connected' and status['account_connected'] is True and status['model_access_verified'] is False
    runtime=(await client.get('/api/runtime',headers=owner)).json()
    assert KEY not in json.dumps(runtime)
    item=next(item for item in runtime['model_connections'] if item['id']=='openrouter')
    assert item['account_connected'] and item['model_access_verified'] is False
    async with sessions() as db:
        record=await db.get(RuntimeCheck,models.PREFIX+'openrouter')
        assert 'credentials_encrypted' not in record.detail and 'active_route' not in record.detail

@pytest.mark.asyncio
async def test_expired_superseded_and_denied_flows_never_exchange(setup,monkeypatch):
    client,sessions,owner,_=setup
    monkeypatch.setattr(consent,'gateway_support',AsyncMock(return_value=True))
    first,old_state=await start(client,owner);second,state=await start(client,owner)
    path='/api/runtime/model-connections/openrouter/consent/finish'
    assert (await client.post(path,headers=owner,json=callback(first,old_state))).status_code==409
    denied=await client.post(path,headers=owner,json=callback(second,state,denied=True,code=''))
    assert denied.json()['status']=='cancelled'
    third,state=await start(client,owner)
    async with sessions() as db:
        row=await db.get(RuntimeCheck,consent.PREFIX+third['flow_id']);row.detail={**row.detail,'expires_at':time.time()-1};await db.commit()
    assert (await client.post(path,headers=owner,json=callback(third,state))).status_code==409

@pytest.mark.asyncio
async def test_connected_enrollment_contract_cannot_be_replaced_by_model_ready_or_raw_metadata(setup,monkeypatch):
    calls=[]
    def respond(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200,json={'state':'ready','public_model':'fake-model','api_key':KEY,'message':KEY})
    real=httpx.AsyncClient;monkeypatch.setattr(httpx,'AsyncClient',lambda **kwargs:real(transport=httpx.MockTransport(respond),**kwargs))
    with pytest.raises(RuntimeError,match='verified state'):
        await models.control_check({'provider':'openrouter','action':'connect_api_key','api_key':KEY})
    assert len(calls)==1

@pytest.mark.asyncio
@pytest.mark.parametrize('payload,expected',[
    ({'state':'supported','provider':'openrouter','capabilities':{'openrouter_consent_enrollment':True,'version':1}},True),
    ({'state':'supported','provider':'openrouter','capabilities':{'openrouter_consent_enrollment':True,'version':True}},False),
    ({'state':'supported','provider':'openrouter','capabilities':{'openrouter_consent_enrollment':True,'version':2}},False),
    ({'state':'supported','provider':'claude','capabilities':{'openrouter_consent_enrollment':True,'version':1}},False),
    ({'state':'supported','provider':'openrouter','capabilities':None},False),
])
async def test_preflight_requires_the_exact_deployed_worker_capability(setup,monkeypatch,payload,expected):
    seen=[]
    def respond(request):
        seen.append(json.loads(request.content))
        return httpx.Response(200,json=payload)
    real=httpx.AsyncClient;monkeypatch.setattr(httpx,'AsyncClient',lambda **kwargs:real(transport=httpx.MockTransport(respond),**kwargs))
    assert await consent.gateway_support() is expected
    assert seen==[{'provider':'openrouter','action':'capabilities'}]

@pytest.mark.asyncio
async def test_account_enrollment_sanitizes_lower_response_without_claiming_model_readiness(setup,monkeypatch):
    def respond(request):
        return httpx.Response(200,json={'state':'connected','provider':'openrouter','account_connected':True,'model_access_verified':False,'verification_scope':'provider_account','connection_ref':'grokbot-openrouter-existing-api','public_model':'untrusted','message':KEY,'api_key':KEY})
    real=httpx.AsyncClient;monkeypatch.setattr(httpx,'AsyncClient',lambda **kwargs:real(transport=httpx.MockTransport(respond),**kwargs))
    result=await models.control_check({'provider':'openrouter','action':'connect_api_key','api_key':KEY})
    assert result['state']=='connected' and result['account_connected'] is True
    assert KEY not in json.dumps(result) and 'public_model' not in result and 'connection_ref' not in result

@pytest.mark.asyncio
async def test_failed_key_exchange_cannot_change_existing_account_or_queue_a_check(setup,monkeypatch):
    client,sessions,owner,_=setup
    monkeypatch.setattr(consent,'gateway_support',AsyncMock(return_value=True))
    async with sessions() as db:
        db.add(RuntimeCheck(name=models.PREFIX+'openrouter',status='passed',updated_at=datetime.utcnow(),detail={'provider':'openrouter','state':'connected','account_connected':True,'request_id':'prior'}));await db.commit()
    data,state=await start(client,owner)
    real=httpx.AsyncClient;monkeypatch.setattr(httpx,'AsyncClient',lambda **kwargs:real(transport=httpx.MockTransport(lambda request:httpx.Response(200,json={'key':'not-a-valid-openrouter-key'})),**kwargs))
    result=await client.post('/api/runtime/model-connections/openrouter/consent/finish',headers=owner,json=callback(data,state))
    assert result.json()=={'status':'failed'}
    async with sessions() as db:
        row=await db.get(RuntimeCheck,models.PREFIX+'openrouter');assert row.detail['request_id']=='prior' and row.detail['account_connected'] is True

@pytest.mark.asyncio
async def test_runtime_exposes_only_the_internal_explicit_connection_entry_without_provider_io(setup,monkeypatch):
    client,_,owner,other=setup
    probe=AsyncMock(side_effect=AssertionError('Runtime reads cannot preflight or enroll'))
    monkeypatch.setattr(consent,'gateway_support',probe)
    data=(await client.get('/api/runtime',headers=owner)).json()
    item=next(item for item in data['model_connections'] if item['id']=='openrouter')
    assert item['can_connect'] is True and item['connect_url']=='/api/model-connections/openrouter/begin'
    assert item['connect_method']=='authorization_code_pkce' and item['model_access_verified'] is False
    assert probe.await_count==0
    assert (await client.get('/api/runtime',headers=other)).json()['model_connections']==[]
    monkeypatch.setattr(models,'remote_control_available',lambda:False)
    item=next(item for item in models.public_connections([]) if item['id']=='openrouter')
    assert item['can_connect'] is False and item['connect_url'] is None
