"""Same-runtime, private account controls; no Apple or model network calls."""
from datetime import datetime, timedelta
from decimal import Decimal
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select

from app.config import settings
from app.db.session import get_db
from app.main import app
from app.models.apple_messages import AppleOutbox, AppleThread
from app.services import apple_messages as service
from .test_apple_messages_core import workspace, linked, incoming

TOKEN = 'synthetic-apple-api-internal-token-for-tests'


@pytest_asyncio.fixture
async def client(workspace, monkeypatch):
    sessions, _ = workspace
    async def dependency():
        async with sessions() as db:
            yield db
    app.dependency_overrides[get_db] = dependency
    monkeypatch.setattr(settings, 'BACKEND_API_TOKEN', TOKEN)
    monkeypatch.setattr(settings, 'REQUIRE_USER_AUTH', True)
    monkeypatch.setattr(app.state, 'database_ready', True, raising=False)
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test',
                                    headers={'Authorization': 'Bearer ' + TOKEN}) as http:
            yield http
    finally:
        app.dependency_overrides.clear()


def owner(name='owner-a'):
    return {'x-grokbot-user-id': name}


@pytest.mark.asyncio
async def test_readiness_requires_internal_auth_and_workspace_even_in_local_mode(client, monkeypatch):
    path = '/api/apple-messages/status'
    assert (await client.get(path)).status_code == 401
    assert (await client.get(path, headers={**owner(), 'Authorization': 'Bearer wrong'})).status_code == 401
    monkeypatch.setattr(settings, 'REQUIRE_USER_AUTH', False)
    assert (await client.get(path)).status_code == 401
    result = await client.get(path, headers=owner())
    assert result.status_code == 200
    assert result.headers['cache-control'] == 'private, no-store'
    assert result.json()['can_send'] is result.json()['can_link'] is False
    assert result.json()['apple_approval_verified'] is False
    # No unverified native ingress or endpoint that lets a customer send as staff.
    for suffix in ('events', 'link', 'send', 'human-reply'):
        assert (await client.post('/api/apple-messages/' + suffix, headers=owner(), json={})).status_code == 404


@pytest.mark.asyncio
async def test_lists_are_bounded_private_and_foreign_controls_are_indistinguishable(client, workspace):
    sessions, rooms = workspace
    own, _ = await linked(sessions, rooms)
    await linked(sessions, rooms, opaque='opaque-second')
    foreign, _ = await linked(sessions, rooms, owner='owner-b', opaque='opaque-foreign')
    response = await client.get('/api/apple-messages/threads?limit=1', headers=owner())
    assert response.status_code == 200 and response.json()['has_more'] is True
    assert len(response.json()['threads']) == 1
    for hidden in ('opaque', 'sealed', 'business-id', 'token_hash', 'owner-a', foreign):
        assert hidden not in response.text
    assert (await client.get('/api/apple-messages/threads?limit=101', headers=owner())).status_code == 422
    assert (await client.get('/api/apple-messages/threads?limit=0', headers=owner())).status_code == 422
    for thread_id in (foreign, str(uuid4())):
        assert (await client.patch('/api/apple-messages/threads/'+thread_id, headers=owner(),
                                  json={'updates_opt_in': True})).status_code == 404
        assert (await client.delete('/api/apple-messages/threads/'+thread_id, headers=owner())).status_code == 404
    assert (await client.delete('/api/apple-messages/threads/'+own, headers=owner('owner-b'))).status_code == 404


@pytest.mark.asyncio
async def test_consent_withdrawal_suppresses_only_proactive_updates_and_cannot_reverse_stop(client, workspace):
    sessions, rooms = workspace
    thread_id, _ = await linked(sessions, rooms, updates=True)
    with service.tenant_scope('owner-a'):
        async with sessions() as db:
            thread = await service._owned_thread(db, thread_id)
            direct = await service._queue(db, thread, 'task:direct', 'PRIVATE direct reply')
            update = await service._queue(db, thread, 'update:proactive', 'PRIVATE task update')
            await db.commit()
            direct_id, update_id = direct.id, update.id
    path = '/api/apple-messages/threads/' + thread_id
    for invalid in ({'updates_opt_in': 'true'}, {'updates_opt_in': 1},
                    {'updates_opt_in': True, 'state': 'active'}, {}):
        assert (await client.patch(path, headers=owner(), json=invalid)).status_code == 422
    result = await client.patch(path, headers=owner(), json={'updates_opt_in': False})
    assert result.status_code == 200 and result.json()['updates_opt_in'] is False
    with service.tenant_scope('owner-a'):
        async with sessions() as db:
            assert (await db.get(AppleOutbox, update_id)).status == 'suppressed'
            assert (await db.get(AppleOutbox, direct_id)).status == 'pending'
    await incoming(sessions, 'STOP')
    assert (await client.patch(path, headers=owner(), json={'updates_opt_in': True})).status_code == 409
    result = await client.get('/api/apple-messages/threads', headers=owner())
    assert result.json()['threads'][0]['state'] == 'opted_out'
    assert result.json()['threads'][0]['updates_opt_in'] is False


@pytest.mark.asyncio
async def test_disconnect_is_durable_suppresses_pending_and_releases_only_owned_identity(client, workspace):
    sessions, rooms = workspace
    thread_id, _ = await linked(sessions, rooms, updates=True)
    foreign, _ = await linked(sessions, rooms, owner='owner-b', opaque='opaque-foreign')
    response = await client.delete('/api/apple-messages/threads/'+thread_id, headers=owner())
    assert response.status_code == 200 and response.json()['state'] == 'closed'
    assert response.json()['updates_opt_in'] is False
    assert (await client.delete('/api/apple-messages/threads/'+thread_id, headers=owner())).status_code == 200
    with service.tenant_scope(None):
        async with sessions() as db:
            assert (await db.get(AppleThread, thread_id)).sealed_opaque_id == ''
            assert (await db.get(AppleThread, foreign)).state == 'active'
            states = (await db.scalars(select(AppleOutbox.status).where(AppleOutbox.thread_id == thread_id))).all()
            assert states and set(states) == {'suppressed'}
    assert (await incoming(sessions, 'Must not be accepted', opaque='opaque-foreign'))['disposition'] == 'queued'
    with pytest.raises(ValueError, match='Link this Apple conversation'):
        await incoming(sessions, 'Must not be accepted')


@pytest.mark.asyncio
async def test_usage_keeps_unknown_prices_null_and_currencies_separate_without_content(client, workspace):
    sessions, rooms = workspace
    thread_id, _ = await linked(sessions, rooms)
    foreign, _ = await linked(sessions, rooms, owner='owner-b', opaque='opaque-foreign')
    for name, tid, amounts in [('owner-a', thread_id, [('USD', '0.10000001'), ('USD', '0.20000002'),
                                                      ('EUR', '0.4'), (None, None)]),
                               ('owner-b', foreign, [('USD', '999')])]:
        with service.tenant_scope(name):
            async with sessions() as db:
                for currency, amount in amounts:
                    db.add(AppleOutbox(thread_id=tid, source_id=str(uuid4()), body='PRIVATE message', status='sent',
                        provider_reference='PRIVATE reference', currency=currency,
                        reported_cost=Decimal(amount) if amount else None))
                db.add(AppleOutbox(thread_id=tid, source_id='old', body='PRIVATE OLD', status='sent',
                    currency='USD', reported_cost=Decimal('888'), created_at=datetime.utcnow()-timedelta(days=40)))
                await db.commit()
    response = await client.get('/api/apple-messages/usage', headers=owner())
    assert response.status_code == 200 and response.headers['cache-control'] == 'private, no-store'
    result = response.json()
    assert result['message_counts']['sent'] == 4 and result['unreported_sent_messages'] == 1
    assert result['reported_provider_costs'] == [
        {'currency': 'EUR', 'amount': '0.40000000', 'messages': 1},
        {'currency': 'USD', 'amount': '0.30000003', 'messages': 2}]
    assert result['is_invoice'] is False and result['billing_status'] == 'reporting_only'
    assert all(value not in response.text for value in ('PRIVATE', '999', '888', foreign, thread_id, 'owner-'))
    empty = (await client.get('/api/apple-messages/usage', headers=owner('empty-owner'))).json()
    assert empty['reported_provider_costs'] == [] and empty['message_counts'] == {}
    for hours in (0, 745):
        assert (await client.get('/api/apple-messages/usage?hours='+str(hours), headers=owner())).status_code == 422
