"""Pair the app with direct Google/xAI credential checks, never a gateway fallback."""
import json
from datetime import datetime, timedelta
from unittest.mock import AsyncMock

import httpx
import pytest
from app.models.runtime import RuntimeCheck
from app.services import model_connections as service
from app.services.model_connections import direct_api_account_support as actual_support
from .test_model_connections import setup

PROVIDERS=('gemini','xai')

def ready(provider):
    _,slot,public,transport=service.API_ACCOUNT_CONTRACTS[provider]
    return {'state':'ready','provider':provider,'verification_scope':'provider_account',
            'connection_provider':provider,'connection_ref':slot,'public_model':public,
            'transport_model':transport,'model_access_verified':True}

def mock_control(monkeypatch,data):
    real=httpx.AsyncClient
    monkeypatch.setattr(httpx,'AsyncClient',lambda **kwargs:real(transport=httpx.MockTransport(lambda _:httpx.Response(200,json=data)),**kwargs))

@pytest.mark.asyncio
@pytest.mark.parametrize('provider',PROVIDERS)
@pytest.mark.parametrize('existing',[False,True])
async def test_unsupported_worker_cannot_mutate_or_queue_either_action(setup,monkeypatch,provider,existing):
    client,sessions,owner,other=setup
    probe=AsyncMock(return_value=False);monkeypatch.setattr(service,'direct_api_account_support',probe)
    before={'state':'ready','credentials_encrypted':'unchanged-encrypted-credential','active_route':{k:ready(provider)[k] for k in ('public_model','transport_model')},'request_id':'prior'}
    if existing:
        async with sessions() as db:
            db.add(RuntimeCheck(name=service.PREFIX+provider,status='completed',detail=before,updated_at=datetime.utcnow()-timedelta(minutes=1)));await db.commit()
    assert (await client.post(f'/api/runtime/model-connections/{provider}/verify',headers=other,json={'target':'provider_account'})).status_code==403
    assert probe.await_count==0
    for path,body in [('verify',{'target':'provider_account'}),('api-key',{'api_key':'synthetic-new-key-not-accepted'})]:
        response=await client.post(f'/api/runtime/model-connections/{provider}/{path}',headers=owner,json=body)
        assert response.status_code==503 and 'unchanged' in response.json()['detail']
    assert probe.await_args_list[0].args==(provider,)
    async with sessions() as db:
        row=await db.get(RuntimeCheck,service.PREFIX+provider)
        if existing:assert row.detail==before and row.status=='completed'
        else:assert row is None

@pytest.mark.asyncio
@pytest.mark.parametrize('provider',PROVIDERS)
@pytest.mark.parametrize('change,expected',[
    ({},True),({'version':True},False),({'version':2},False),
    ({'version':None},False),({'version':1.0},False),({'enabled':1},False),({'enabled':False},False),
    ({'provider':'claude'},False),({'state':'ready'},False),({'capabilities':None},False),
    ({'capabilities':{}},False),
])
async def test_capability_is_exact_versioned_provider_and_sends_no_credential(setup,monkeypatch,provider,change,expected):
    capability=service.API_ACCOUNT_CONTRACTS[provider][0]
    data={'state':change.get('state','supported'),'provider':change.get('provider',provider),
          'capabilities':change.get('capabilities',{capability:change.get('enabled',True),'version':change.get('version',1)})}
    seen=[];real=httpx.AsyncClient
    def respond(request):seen.append(request);return httpx.Response(200,json=data)
    monkeypatch.setattr(httpx,'AsyncClient',lambda **kwargs:real(transport=httpx.MockTransport(respond),**kwargs))
    assert await actual_support(provider) is expected
    assert len(seen)==1 and str(seen[0].url)=='https://router.example/api/internal/connections/check'
    assert json.loads(seen[0].content)=={'provider':provider,'action':'capabilities'}

@pytest.mark.asyncio
@pytest.mark.parametrize('provider',PROVIDERS)
@pytest.mark.parametrize('field',['provider','verification_scope','connection_provider','connection_ref','public_model','transport_model','model_access_verified'])
async def test_missing_identity_field_cannot_verify_an_account(setup,monkeypatch,provider,field):
    receipt=ready(provider);receipt.pop(field);mock_control(monkeypatch,receipt)
    for action in ['check','connect_api_key']:
        with pytest.raises(RuntimeError):await service.control_check({'provider':provider,'action':action,'verification_target':'provider_account'})

@pytest.mark.asyncio
@pytest.mark.parametrize('provider',PROVIDERS)
@pytest.mark.parametrize('changed',[
    {'provider':'claude'},{'verification_scope':'current_route'},
    {'connection_provider':'antigravity'},{'connection_provider':'xai-oauth'},
    {'connection_ref':'another-api-slot'},{'model_access_verified':1},
    {'transport_model':'agy/gemini-3.8-flash-low'},
    {'transport_model':'xao/grok-4.5'},{'public_model':'xai/grok-4.7'},
])
async def test_foreign_fallback_or_boolean_like_receipt_is_rejected(setup,monkeypatch,provider,changed):
    mock_control(monkeypatch,{**ready(provider),**changed})
    with pytest.raises(RuntimeError):await service.control_check({'provider':provider,'action':'check','verification_target':'provider_account'})

@pytest.mark.asyncio
@pytest.mark.parametrize('provider',PROVIDERS)
async def test_valid_receipt_is_sanitized_for_both_actions(setup,monkeypatch,provider):
    mock_control(monkeypatch,{**ready(provider),'message':'private-diagnostic','api_key':'private-key','verification_url':'https://accounts.google.com/private'})
    for action in ['check','connect_api_key']:
        result=await service.control_check({'provider':provider,'action':action,'verification_target':'provider_account'})
        assert result['state']=='ready' and 'private-' not in json.dumps(result) and 'verification_url' not in result

@pytest.mark.asyncio
@pytest.mark.parametrize('provider',PROVIDERS)
async def test_failed_strict_check_and_replacement_preserve_credential_and_route(setup,monkeypatch,provider):
    client,sessions,owner,_=setup
    from app.services.plugins import seal
    prior=seal('synthetic-existing-provider-key');route={k:ready(provider)[k] for k in ('public_model','transport_model')}
    async with sessions() as db:
        db.add(RuntimeCheck(name=service.PREFIX+provider,status='completed',detail={'state':'ready','credentials_encrypted':prior,'active_route':route},updated_at=datetime.utcnow()-timedelta(minutes=1)));await db.commit()
    for path,body in [('verify',{'target':'provider_account'}),('api-key',{'api_key':'synthetic-replacement-provider-key'})]:
        response=await client.post(f'/api/runtime/model-connections/{provider}/{path}',headers=owner,json=body)
        assert response.status_code==202
        with monkeypatch.context() as patch:
            mock_control(patch,{**ready(provider),'connection_ref':'foreign-slot'})
            assert await service.run_requested_check(sessions,AsyncMock())
        async with sessions() as db:
            row=await db.get(RuntimeCheck,service.PREFIX+provider)
            assert row.detail['credentials_encrypted']==prior and row.detail['active_route']==route
            assert row.status=='completed'
            row.updated_at=datetime.utcnow()-timedelta(minutes=1);await db.commit()

@pytest.mark.asyncio
@pytest.mark.parametrize('provider',PROVIDERS)
async def test_legacy_current_route_does_not_require_new_capability_or_account_receipt(setup,monkeypatch,provider):
    client,sessions,owner,_=setup
    probe=AsyncMock(return_value=False);monkeypatch.setattr(service,'direct_api_account_support',probe)
    response=await client.post(f'/api/runtime/model-connections/{provider}/verify',headers=owner,json={'target':'current_route'})
    assert response.status_code==202 and probe.await_count==0
    legacy={k:v for k,v in ready(provider).items() if k in {'state','public_model','transport_model'}}
    mock_control(monkeypatch,legacy)
    assert await service.control_check({'provider':provider,'action':'check','verification_target':'current_route'})==legacy
