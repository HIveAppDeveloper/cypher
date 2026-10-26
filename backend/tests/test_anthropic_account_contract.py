import json
from datetime import datetime, timedelta
from unittest.mock import AsyncMock

import httpx
import pytest
from app.models.runtime import RuntimeCheck
from app.services import model_connections as service
from app.services.model_connections import anthropic_account_support as actual_support
from .test_model_connections import setup

READY={'state':'ready','provider':'claude','verification_scope':'provider_account','connection_provider':'anthropic','connection_ref':'grokbot-anthropic-existing-api','public_model':'anthropic/claude-sonnet-5.5','transport_model':'anthropic/claude-sonnet-5-5','model_access_verified':True}

@pytest.mark.asyncio
async def test_unpaired_gateway_rejects_new_check_and_key_without_changing_saved_access(setup,monkeypatch):
    client,sessions,owner,other=setup
    probe=AsyncMock(return_value=False);monkeypatch.setattr(service,'anthropic_account_support',probe)
    before={'state':'ready','active_route':{'public_model':'anthropic/claude-sonnet-5.5','transport_model':'anthropic/claude-sonnet-5-5'},'request_id':'prior'}
    async with sessions() as db:
        db.add(RuntimeCheck(name=service.PREFIX+'claude',status='completed',detail=before,updated_at=datetime.utcnow()-timedelta(minutes=1)));await db.commit()
    assert (await client.post('/api/runtime/model-connections/claude/verify',headers=other,json={'target':'provider_account'})).status_code==403
    assert probe.await_count==0
    for path,body in [('verify',{'target':'provider_account'}),('api-key',{'api_key':'synthetic-new-api-key-not-accepted'})]:
        response=await client.post('/api/runtime/model-connections/claude/'+path,headers=owner,json=body)
        assert response.status_code==503 and 'unchanged' in response.json()['detail']
    async with sessions() as db:
        row=await db.get(RuntimeCheck,service.PREFIX+'claude');assert row.detail==before and row.status=='completed'

@pytest.mark.asyncio
@pytest.mark.parametrize('data,status,expected',[
    ({'state':'supported','provider':'claude','capabilities':{'anthropic_api_account_check':True,'version':1}},200,True),
    ({'state':'supported','provider':'claude','capabilities':{'anthropic_api_account_check':True,'version':True}},200,False),
    ({'state':'supported','provider':'claude','capabilities':{'anthropic_api_account_check':True,'version':2}},200,False),
    ({'state':'supported','provider':'gemini','capabilities':{'anthropic_api_account_check':True,'version':1}},200,False),
    ({'state':'supported','provider':'claude','capabilities':None},200,False),
    ({'detail':'old worker rejects capabilities'},422,False),
])
async def test_preflight_requires_actual_deployed_worker_version_and_never_sends_a_key(setup,monkeypatch,data,status,expected):
    seen=[]
    def respond(request):
        seen.append(request);return httpx.Response(status,json=data)
    real=httpx.AsyncClient;monkeypatch.setattr(httpx,'AsyncClient',lambda **kwargs:real(transport=httpx.MockTransport(respond),**kwargs))
    assert await actual_support() is expected
    assert len(seen)==1 and str(seen[0].url)=='https://router.example/api/internal/connections/check'
    assert json.loads(seen[0].content)=={'provider':'claude','action':'capabilities'}

@pytest.mark.asyncio
@pytest.mark.parametrize('changed',[
    {'transport_model':'agy/claude-sonnet-5-5-low'},
    {'transport_model':'cc/claude-sonnet-4-6'},
    {'connection_provider':'antigravity'},
    {'connection_provider':'claude'},
    {'connection_ref':''},
    {'connection_ref':'https://not-an-account.example/'},
    {'connection_ref':'another-anthropic-api'},
    {'model_access_verified':False},
    {'verification_scope':'current_route'},
    {'provider':'gemini'},
])
async def test_account_receipt_cannot_use_google_cli_other_accounts_or_missing_identity(setup,monkeypatch,changed):
    real=httpx.AsyncClient;monkeypatch.setattr(httpx,'AsyncClient',lambda **kwargs:real(transport=httpx.MockTransport(lambda _:httpx.Response(200,json={**READY,**changed})),**kwargs))
    with pytest.raises(RuntimeError):
        await service.control_check({'provider':'claude','action':'check','verification_target':'provider_account'})

@pytest.mark.asyncio
async def test_new_key_and_saved_api_checks_accept_only_sanitized_exact_identity(setup,monkeypatch):
    real=httpx.AsyncClient;monkeypatch.setattr(httpx,'AsyncClient',lambda **kwargs:real(transport=httpx.MockTransport(lambda _:httpx.Response(200,json={**READY,'message':'raw-secret-diagnostic','api_key':'raw-secret-key','verification_url':'https://accounts.google.com/private'})),**kwargs))
    for payload in [{'provider':'claude','action':'check','verification_target':'provider_account'},{'provider':'claude','action':'connect_api_key','api_key':'synthetic-key-not-sent-to-any-provider'}]:
        result=await service.control_check(payload)
        assert result['state']=='ready' and result['connection_provider']=='anthropic'
        assert 'raw-secret' not in json.dumps(result) and 'verification_url' not in result

@pytest.mark.asyncio
async def test_google_verification_link_cannot_finish_an_anthropic_api_check(setup,monkeypatch):
    real=httpx.AsyncClient;monkeypatch.setattr(httpx,'AsyncClient',lambda **kwargs:real(transport=httpx.MockTransport(lambda _:httpx.Response(200,json={'state':'verification_required','verification_url':'https://accounts.google.com/private'})),**kwargs))
    with pytest.raises(RuntimeError,match='Google verification'):
        await service.control_check({'provider':'claude','action':'check','verification_target':'provider_account'})

@pytest.mark.asyncio
async def test_cli_setup_token_is_rejected_before_preflight_or_queueing(setup,monkeypatch):
    client,sessions,owner,_=setup
    probe=AsyncMock(return_value=True);monkeypatch.setattr(service,'anthropic_account_support',probe)
    response=await client.post('/api/runtime/model-connections/claude/api-key',headers=owner,json={'api_key':'sk-ant-oat-synthetic-subscription-token'})
    assert response.status_code==422 and 'Console API key' in response.json()['detail']
    assert probe.await_count==0
    async with sessions() as db:assert await db.get(RuntimeCheck,service.PREFIX+'claude') is None
