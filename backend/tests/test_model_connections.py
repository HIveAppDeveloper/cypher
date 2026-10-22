import asyncio
import json
from datetime import datetime, timedelta
from unittest.mock import AsyncMock

import httpx
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.config import settings
from app.db.session import Base, get_db
from app.main import app
from app.api.auth import account_id_for
from app.models.runtime import RuntimeCheck
from app.services import model_connections as service, omniroute


@pytest_asyncio.fixture
async def setup(tmp_path, monkeypatch):
    engine = create_async_engine(f'sqlite+aiosqlite:///{tmp_path}/checks.sqlite')
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn: await conn.run_sync(Base.metadata.create_all)
    async def db():
        async with sessions() as session: yield session
    app.dependency_overrides[get_db] = db
    monkeypatch.setattr(app.state, 'database_ready', True, raising=False)
    for name, value in {'REQUIRE_USER_AUTH':True, 'LEGACY_OWNER_EMAIL':'owner@example.test', 'BACKEND_API_TOKEN':'private-backend-test-key-at-least-32-characters', 'OMNIROUTE_URL':'https://router.example', 'OMNIROUTE_API_KEY':'inference-test-key', 'OMNIROUTE_CONTROL_KEY':'owner-control-test-key', 'SECRET_KEY':'test-only-encryption-secret-at-least-32-characters'}.items(): monkeypatch.setattr(settings, name, value)
    from app.db import session
    monkeypatch.setattr(session, 'AsyncSessionLocal', sessions)
    owner = {'authorization':'Bearer private-backend-test-key-at-least-32-characters', 'x-grokbot-user-id':account_id_for('owner@example.test')}
    other = {**owner, 'x-grokbot-user-id':account_id_for('other@example.test')}
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='https://app.example') as client:
            yield client, sessions, owner, other
    finally:
        app.dependency_overrides.clear(); await engine.dispose()


@pytest.mark.asyncio
async def test_only_owner_can_queue_checks_and_no_challenge_or_key_leaks_to_other_tenants(setup, monkeypatch):
    client, sessions, owner, other = setup
    assert (await client.post('/api/runtime/model-connections/claude/verify', headers=other)).status_code == 403
    key = 'sk-ant-test-only-provider-key-123456'
    request = await client.post('/api/runtime/model-connections/claude/api-key', headers=owner, json={'api_key':key})
    assert request.status_code == 202 and key not in request.text
    async with sessions() as db:
        row = await db.get(RuntimeCheck, service.PREFIX+'claude'); request_id=row.detail['request_id']
        assert key not in json.dumps(row.detail) and row.detail['credentials_encrypted']
    duplicate = await client.post('/api/runtime/model-connections/claude/verify', headers=owner)
    assert duplicate.json()['status'] == 'pending'
    async with sessions() as db: assert (await db.get(RuntimeCheck, service.PREFIX+'claude')).detail['request_id'] == request_id
    seen=[]
    async def control(payload):
        seen.append(payload.copy());return {'state':'ready','public_model':'anthropic/claude-sonnet-5.5','transport_model':'anthropic/claude-sonnet-5-5','message':'A model response succeeded.'}
    monkeypatch.setattr(service, 'control_check', control)
    assert await service.run_requested_check(sessions, AsyncMock())
    assert seen[0]['api_key'] == key
    async with sessions() as db:
        row = await db.get(RuntimeCheck, service.PREFIX+'claude'); assert 'credentials_encrypted' not in row.detail
        assert service.model_map([row])['anthropic/claude-sonnet-5.5'] == 'anthropic/claude-sonnet-5-5'
    runtime = (await client.get('/api/runtime', headers=other)).json()
    assert not runtime['can_manage_model_connections'] and runtime['model_connections'] == [] and key not in json.dumps(runtime)
    await omniroute.refresh_model_routes()
    assert omniroute.model_id('anthropic','claude-sonnet-5.5') == 'anthropic/claude-sonnet-5-5'


@pytest.mark.asyncio
async def test_verification_link_is_encrypted_owner_only_expiring_and_never_enables_a_failed_route(setup, monkeypatch):
    client,sessions,owner,other=setup
    await client.post('/api/runtime/model-connections/claude/verify',headers=owner)
    url='https://accounts.google.com/v3/signin/challenge/test?nonce=private-verification-value'
    async def control(payload):return {'state':'verification_required','verification_url':url,'message':'Verify the Google account.'}
    monkeypatch.setattr(service,'control_check',control)
    await service.run_requested_check(sessions,AsyncMock())
    async with sessions() as db:
        row=await db.get(RuntimeCheck,service.PREFIX+'claude');assert url not in json.dumps(row.detail)
        assert 'anthropic/claude-sonnet-5.5' not in service.model_map([row])
    runtime=(await client.get('/api/runtime',headers=owner)).json()
    assert next(x for x in runtime['model_connections'] if x['id']=='claude')['verification_url']==url
    assert url not in (await client.get('/api/runtime',headers=other)).text
    async with sessions() as db:
        row=await db.get(RuntimeCheck,service.PREFIX+'claude');row.detail={**row.detail,'verification_expires_at':(datetime.utcnow()-timedelta(minutes=1)).isoformat()+'Z'};await db.commit()
    runtime=(await client.get('/api/runtime',headers=owner)).json()
    item=next(x for x in runtime['model_connections'] if x['id']=='claude')
    assert item['verification_url'] is None and 'expired' in item['message']
    for bad in ['https://accounts.google.com.evil.test/x','http://accounts.google.com/x','https://user@accounts.google.com/x','javascript:alert(1)']:
        assert service.safe_verification_url(bad) is None


@pytest.mark.asyncio
async def test_failed_new_key_preserves_working_route_and_crash_recovery_has_three_attempt_bound(setup,monkeypatch):
    client,sessions,owner,other=setup
    route={'public_model':'anthropic/claude-sonnet-5.5','transport_model':'anthropic/claude-sonnet-5-5'}
    async with sessions() as db:
        db.add(RuntimeCheck(name=service.PREFIX+'claude',status='completed',detail={'state':'ready','active_route':route},updated_at=datetime.utcnow()-timedelta(minutes=1)));await db.commit()
    await client.post('/api/runtime/model-connections/claude/api-key',headers=owner,json={'api_key':'invalid-but-long-enough-key-12345'})
    monkeypatch.setattr(service,'control_check',AsyncMock(return_value={'state':'sign_in_required','message':'Key rejected.'}))
    await service.run_requested_check(sessions,AsyncMock())
    async with sessions() as db:
        row=await db.get(RuntimeCheck,service.PREFIX+'claude');assert row.detail['active_route']==route
        row.status='running';row.detail={**row.detail,'attempts':1};await db.commit()
    await service.recover_checks(sessions)
    async with sessions() as db:
        row=await db.get(RuntimeCheck,service.PREFIX+'claude');assert row.status=='pending';row.status='running';row.detail={**row.detail,'attempts':3,'credentials_encrypted':'never-publish-this'};await db.commit()
    await service.recover_checks(sessions)
    async with sessions() as db:
        row=await db.get(RuntimeCheck,service.PREFIX+'claude');assert row.status=='failed' and 'credentials_encrypted' not in row.detail


@pytest.mark.asyncio
async def test_control_auth_and_verified_route_are_separate_from_inference_and_response_flags(monkeypatch):
    monkeypatch.setattr(settings,'OMNIROUTE_URL','https://router.example')
    monkeypatch.setattr(settings,'OMNIROUTE_API_KEY','inference-key')
    monkeypatch.setattr(settings,'OMNIROUTE_CONTROL_KEY','control-key')
    real=httpx.AsyncClient;seen=[]
    def respond(request):
        seen.append(request);assert request.headers['authorization']=='Bearer control-key';assert request.url.path=='/api/internal/connections/check'
        return httpx.Response(200,json={'state':'ready','public_model':'anthropic/claude-sonnet-5.5','transport_model':'unverified/fake'})
    monkeypatch.setattr(httpx,'AsyncClient',lambda **kwargs:real(transport=httpx.MockTransport(respond),**kwargs))
    with pytest.raises(RuntimeError,match='requested model'):await service.control_check({'provider':'claude','action':'check'})
    assert len(seen)==1
