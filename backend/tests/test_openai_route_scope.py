"""Existing Codex route checks never certify hosted Cypher ChatGPT sign-in."""
import json
from copy import deepcopy
from datetime import datetime, timedelta
from unittest.mock import AsyncMock

import httpx
import pytest
from app.models.runtime import RuntimeCheck
from app.services import model_connections as service, plugins, omniroute
from .test_model_connections import setup

ROUTE={'public_model':'openai/gpt-6.1-sol','transport_model':'cx/gpt-6.1-sol'}

def saved(target='current_route'):
    return {'provider':'openai','action':'check','verification_target':target,'state':'ready',
            'active_route':ROUTE,'credentials_encrypted':'preserved-never-decrypted',
            'request_id':'existing-request','attempts':3}


@pytest.mark.asyncio
@pytest.mark.parametrize('status',[None,'completed','pending','running'])
async def test_unsupported_account_check_cannot_create_or_mutate_saved_queue_or_credentials(setup,monkeypatch,status):
    client,sessions,owner,other=setup
    before=saved()
    if status:
        async with sessions() as db:
            db.add(RuntimeCheck(name=service.PREFIX+'openai',status=status,detail=before,updated_at=datetime.utcnow()-timedelta(minutes=1)));await db.commit()
    def forbidden(*args,**kwargs):raise AssertionError('Unsupported scope must fail before credential or provider operations')
    monkeypatch.setattr(plugins,'cipher',forbidden)
    monkeypatch.setattr(service,'control_check',forbidden)
    assert (await client.post('/api/runtime/model-connections/openai/verify',headers=other,json={'target':'provider_account'})).status_code==403
    response=await client.post('/api/runtime/model-connections/openai/verify',headers=owner,json={'target':'provider_account'})
    assert response.status_code==422 and 'unchanged' in response.json()['detail']
    async with sessions() as db:
        row=await db.get(RuntimeCheck,service.PREFIX+'openai')
        if status:assert row.status==status and row.detail==before
        else:assert row is None


@pytest.mark.asyncio
async def test_worker_control_rejects_old_account_target_before_any_network_or_credentials(setup,monkeypatch):
    def forbidden(*args,**kwargs):raise AssertionError('No network or credential operation may precede this scope guard')
    monkeypatch.setattr(httpx,'AsyncClient',forbidden)
    monkeypatch.setattr(omniroute,'endpoint',forbidden)
    monkeypatch.setattr(omniroute,'headers',forbidden)
    with pytest.raises(RuntimeError,match='not supported'):
        await service.control_check({'provider':'openai','action':'check','verification_target':'provider_account'})


@pytest.mark.asyncio
@pytest.mark.parametrize('status',['pending','running'])
async def test_old_queued_or_recovered_account_check_preserves_route_and_credentials_without_decrypting(setup,monkeypatch,status):
    _,sessions,_,_=setup
    before=saved('provider_account')
    async with sessions() as db:
        db.add(RuntimeCheck(name=service.PREFIX+'openai',status=status,detail=before,updated_at=datetime.utcnow()-timedelta(minutes=1)));await db.commit()
    def forbidden(*args,**kwargs):raise AssertionError('Unsupported jobs cannot decrypt credentials or contact a provider')
    monkeypatch.setattr(plugins,'reveal',forbidden)
    monkeypatch.setattr(service,'control_check',forbidden)
    pulse=AsyncMock(side_effect=forbidden)
    if status=='pending':assert await service.run_requested_check(sessions,pulse)
    else:await service.recover_checks(sessions)
    assert pulse.await_count==0
    async with sessions() as db:
        row=await db.get(RuntimeCheck,service.PREFIX+'openai')
        assert row.status=='completed' and row.detail['state']=='unavailable'
        assert 'not supported' in row.detail['message']
        for key,value in before.items():
            if key!='state':assert row.detail[key]==value
        assert service.model_map([row])[ROUTE['public_model']]==ROUTE['transport_model']


@pytest.mark.parametrize('target',['provider_account','current_route'])
def test_stale_ready_account_target_is_presented_only_as_a_route_without_mutating_storage(target):
    detail=saved(target);before=deepcopy(detail)
    row=RuntimeCheck(name=service.PREFIX+'openai',status='completed',detail=detail,updated_at=datetime.utcnow())
    item=next(item for item in service.public_connections([row]) if item['id']=='openai')
    assert item['state']=='ready' and item['verified_model']=='gpt-6.1-sol'
    assert item['verification_target']==item['verification_scope']=='current_route'
    assert item['account_connected'] is False and item['access_label']=='Gateway model route'
    assert item['verification_url'] is None and 'does not connect a ChatGPT account' in item['message']
    assert 'preserved-never-decrypted' not in json.dumps(item)
    assert row.detail==before


def test_stale_openai_browser_challenge_is_never_decrypted_or_advertised(monkeypatch):
    detail={**saved('provider_account'),'state':'verification_required','verification_encrypted':'preserved-encrypted-challenge','verification_expires_at':(datetime.utcnow()+timedelta(minutes=5)).isoformat()+'Z'}
    def forbidden(*args,**kwargs):raise AssertionError('OpenAI route status must not decrypt or offer an old account challenge')
    monkeypatch.setattr(plugins,'reveal',forbidden)
    row=RuntimeCheck(name=service.PREFIX+'openai',status='completed',detail=detail,updated_at=datetime.utcnow())
    item=next(item for item in service.public_connections([row]) if item['id']=='openai')
    assert item['verification_url'] is None and item['account_connected'] is False
    assert item['verification_target']==item['verification_scope']=='current_route'
    assert row.detail==detail


@pytest.mark.asyncio
@pytest.mark.parametrize('explicit_target',[True,False])
async def test_legacy_current_route_remains_usable_without_claiming_a_new_account(setup,monkeypatch,explicit_target):
    client,sessions,owner,_=setup
    before={**saved(), 'credentials_encrypted':None}
    async with sessions() as db:
        db.add(RuntimeCheck(name=service.PREFIX+'openai',status='completed',detail=before,updated_at=datetime.utcnow()-timedelta(minutes=1)));await db.commit()
    body={'target':'current_route'} if explicit_target else {}
    queued=await client.post('/api/runtime/model-connections/openai/verify',headers=owner,json=body)
    assert queued.status_code==202 and queued.json()['verification_target']=='current_route'
    seen=[];real=httpx.AsyncClient
    def respond(request):
        seen.append(json.loads(request.content))
        return httpx.Response(200,json={'state':'ready',**ROUTE,'message':'Legacy route response'})
    with monkeypatch.context() as patch:
        patch.setattr(httpx,'AsyncClient',lambda **kwargs:real(transport=httpx.MockTransport(respond),**kwargs))
        assert await service.run_requested_check(sessions,AsyncMock())
    assert len(seen)==1 and seen[0]['verification_target']=='current_route' and 'api_key' not in seen[0]
    async with sessions() as db:
        row=await db.get(RuntimeCheck,service.PREFIX+'openai')
        assert row.detail['active_route']==ROUTE
    item=next(item for item in (await client.get('/api/runtime',headers=owner)).json()['model_connections'] if item['id']=='openai')
    assert item['state']=='ready' and item['verification_target']=='current_route' and item['account_connected'] is False
