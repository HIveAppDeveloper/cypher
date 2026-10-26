"""Authenticated Gmail-draft review flow with a synthetic provider boundary."""
import asyncio
import base64
import json
from email import policy
from email.parser import BytesParser
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import settings
from app.db.session import Base, get_db
from app.db.tenancy import current_tenant_id
from app.main import app
from app.models.sourcing_outreach import SourcingOutreach
from app.models.plugin import Plugin, PluginAuthorization
from app.services import google_workspace as google
from app.services import sourcing_outreach as service
from app.services.plugins import reveal, seal


@pytest_asyncio.fixture
async def stack(tmp_path, monkeypatch):
    engine = create_async_engine('sqlite+aiosqlite:///' + str(tmp_path / 'sourcing-outreach.db'))
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    monkeypatch.setattr(settings, 'REQUIRE_USER_AUTH', True)
    monkeypatch.setattr(settings, 'BACKEND_API_TOKEN', 'test-sourcing-outreach-internal-token')

    async def dependency():
        async with sessions() as db:
            yield db

    app.dependency_overrides[get_db] = dependency
    headers = {
        'authorization': 'Bearer test-sourcing-outreach-internal-token',
        'x-grokbot-user-id': 'fixture-vc-owner',
    }
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url='http://test', headers=headers,
    ) as client:
        yield client, sessions
    app.dependency_overrides.clear()
    await engine.dispose()


def provider_fixtures(monkeypatch):
    calls = []
    sender = 'investor@example.com'

    async def connected_account(_db, provider, account_id):
        assert provider == 'gmail'
        return SimpleNamespace(id=account_id), {'email': sender, 'subject': 'fixture-google-user'}, sender, 'fixture-binding'

    async def access_token(_db, _grant):
        return 'synthetic-access-token'

    async def gmail_request(token, method, url, *, body=None):
        assert token == 'synthetic-access-token'
        calls.append((method, url, body))
        return {'id': 'synthetic-gmail-draft-id'}

    monkeypatch.setattr(service, 'account', connected_account)
    monkeypatch.setattr(google, 'access_token', access_token)
    monkeypatch.setattr(google, 'api_request', gmail_request)
    return calls


def proposal_payload(*, recipient='founder@example.com'):
    return {
        'request_id': str(uuid4()),
        'provider': 'gmail',
        'account_id': str(uuid4()),
        'recipient': recipient,
        'subject': 'A question about your company',
        'body': 'Hello Founder, I would like to learn more about your work.',
    }


async def prepare_and_review(client, payload):
    response = await client.post('/api/sourcing/outreach', json=payload)
    assert response.status_code == 200, response.text
    proposal = response.json()
    assert proposal['status'] == 'awaiting_approval'
    assert proposal['email_sent'] is False
    reviewed = await client.post(f"/api/sourcing/outreach/{proposal['id']}/review")
    assert reviewed.status_code == 200, reviewed.text
    return proposal, reviewed.json()


@pytest.mark.asyncio
async def test_gmail_draft_requires_exact_explicit_review_and_never_sends(stack, monkeypatch):
    client, _sessions = stack
    calls = provider_fixtures(monkeypatch)
    payload = proposal_payload()

    proposal, reviewed = await prepare_and_review(client, payload)
    assert calls == [], 'Preparing or reviewing a proposal must not contact Gmail.'
    assert reviewed['review_token']
    assert reviewed['recipient'] == payload['recipient']

    endpoint = f"/api/sourcing/outreach/{proposal['id']}/create-draft"
    invalid = {
        'digest': reviewed['digest'],
        'review_token': reviewed['review_token'],
        'confirmation': 'send this email',
    }
    response = await client.post(endpoint, json=invalid)
    assert response.status_code == 422, response.text
    assert calls == [], 'Invalid confirmation must not contact Gmail.'

    confirmed = {
        'digest': reviewed['digest'],
        'review_token': reviewed['review_token'],
        'confirmation': 'create_gmail_draft_exact_message_and_account',
    }
    response = await client.post(endpoint, json=confirmed)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['status'] == 'draft_created'
    assert result['gmail_draft_id'] == 'synthetic-gmail-draft-id'
    assert result['email_sent'] is False
    assert len(calls) == 1

    method, url, body = calls[0]
    assert method == 'POST'
    assert url == 'https://gmail.googleapis.com/gmail/v1/users/me/drafts'
    assert '/send' not in url
    raw = body['message']['raw']
    raw += '=' * (-len(raw) % 4)
    message = BytesParser(policy=policy.default).parsebytes(base64.urlsafe_b64decode(raw))
    assert message['To'] == payload['recipient']
    assert message['From'] == 'investor@example.com'
    assert message['Subject'] == payload['subject']
    assert message.get_content().strip() == payload['body']

    async with _sessions() as db:
        saved = (await db.execute(select(SourcingOutreach).where(SourcingOutreach.id == proposal['id']))).scalar_one()
        assert saved.status == 'draft_created'
        assert saved.gmail_draft_id == 'synthetic-gmail-draft-id'


@pytest.mark.asyncio
async def test_recipient_change_after_review_invalidates_confirmation(stack, monkeypatch):
    client, sessions = stack
    calls = provider_fixtures(monkeypatch)
    payload = proposal_payload()
    proposal, reviewed = await prepare_and_review(client, payload)
    assert calls == []

    tenant = current_tenant_id.set('fixture-vc-owner')
    try:
        async with sessions() as db:
            saved = (await db.execute(select(SourcingOutreach).where(SourcingOutreach.id == proposal['id']))).scalar_one()
            saved.recipient = 'different-founder@example.net'
            await db.commit()
    finally:
        current_tenant_id.reset(tenant)

    response = await client.post(f"/api/sourcing/outreach/{proposal['id']}/create-draft", json={
        'digest': reviewed['digest'],
        'review_token': reviewed['review_token'],
        'confirmation': 'create_gmail_draft_exact_message_and_account',
    })
    assert response.status_code == 409, response.text
    assert calls == [], 'A recipient changed since review must never reach Gmail.'


async def connected_gmail_grant(sessions, *, tenant_id='fixture-vc-owner', status='connected', plugin_enabled=True, scopes=None, subject='fixture-google-subject'):
    import time
    context = current_tenant_id.set(tenant_id)
    try:
        async with sessions() as db:
            plugin = Plugin(
                id=str(uuid4()), tenant_id=tenant_id, name='Google Workspace', url=google.plugin_url(),
                credential=seal(google.REFERENCE), enabled=plugin_enabled,
                tools=[{'name':'gmail_compose_draft','enabled':True}],
            )
            db.add(plugin)
            await db.flush()
            saved = {
                'subject':subject, 'email':'investor@example.com', 'verified_at':time.time(),
                'groups':['gmail'], 'scopes':scopes if scopes is not None else [google.PREFIX+'gmail.modify'],
            }
            grant = PluginAuthorization(
                id=str(uuid4()), tenant_id=tenant_id, name='Google permissions', url=google.GRANT_URL,
                payload=seal(json.dumps(saved)), status=status, created_at=time.time(), plugin_id=plugin.id,
            )
            db.add(grant)
            await db.commit()
            return grant.id
    finally:
        current_tenant_id.reset(context)


def block_gmail_provider(monkeypatch):
    calls=[]
    async def access_token(*_args, **_kwargs):
        calls.append('access_token')
        raise AssertionError('Gmail access must not be requested in authorization tests.')
    async def api_request(*_args, **_kwargs):
        calls.append('api_request')
        raise AssertionError('Gmail API must not be called in authorization tests.')
    monkeypatch.setattr(google, 'access_token', access_token)
    monkeypatch.setattr(google, 'api_request', api_request)
    return calls


@pytest.mark.asyncio
@pytest.mark.parametrize(('case','tenant_id','status','plugin_enabled','scopes'), [
    ('foreign tenant', 'another-vc-workspace', 'connected', True, [google.PREFIX+'gmail.modify']),
    ('revoked grant', 'fixture-vc-owner', 'revoked', True, [google.PREFIX+'gmail.modify']),
    ('disabled plugin', 'fixture-vc-owner', 'connected', False, [google.PREFIX+'gmail.modify']),
    ('missing draft scope', 'fixture-vc-owner', 'connected', True, []),
])
async def test_real_account_rejects_unusable_grants_before_gmail(stack, monkeypatch, case, tenant_id, status, plugin_enabled, scopes):
    client, _sessions = stack
    calls=block_gmail_provider(monkeypatch)
    grant_id=await connected_gmail_grant(
        _sessions, tenant_id=tenant_id, status=status, plugin_enabled=plugin_enabled, scopes=scopes,
    )
    payload=proposal_payload()
    payload['account_id']=grant_id

    response=await client.post('/api/sourcing/outreach',json=payload)
    assert response.status_code==409, f'{case}: {response.text}'
    assert calls==[], f'{case} must fail before requesting Gmail credentials or calling Gmail.'


@pytest.mark.asyncio
async def test_real_account_binding_change_blocks_confirmed_draft_before_gmail(stack, monkeypatch):
    client, sessions=stack
    calls=block_gmail_provider(monkeypatch)
    grant_id=await connected_gmail_grant(sessions)
    payload=proposal_payload()
    payload['account_id']=grant_id
    proposal, reviewed=await prepare_and_review(client,payload)
    assert calls==[]

    context=current_tenant_id.set('fixture-vc-owner')
    try:
        async with sessions() as db:
            grant=await db.get(PluginAuthorization,grant_id)
            saved=json.loads(reveal(grant.payload))
            saved['subject']='different-google-account-subject'
            grant.payload=seal(json.dumps(saved))
            await db.commit()
    finally:
        current_tenant_id.reset(context)

    response=await client.post(f"/api/sourcing/outreach/{proposal['id']}/create-draft",json={
        'digest':reviewed['digest'],
        'review_token':reviewed['review_token'],
        'confirmation':'create_gmail_draft_exact_message_and_account',
    })
    assert response.status_code==409, response.text
    assert 'Gmail account changed' in response.text
    assert calls==[], 'A changed Google binding must be rejected before Gmail is contacted.'


@pytest.mark.asyncio
async def test_concurrent_draft_retry_does_not_start_a_second_provider_attempt(stack, monkeypatch):
    client, _sessions=stack
    provider_calls=[]
    access_calls=[]
    provider_started=asyncio.Event()
    allow_provider_to_finish=asyncio.Event()

    async def connected_account(_db, provider, account_id):
        assert provider=='gmail'
        return SimpleNamespace(id=account_id), {'email':'investor@example.com','subject':'fixture-google-user'}, 'investor@example.com', 'fixture-binding'

    async def access_token(_db, grant):
        access_calls.append(grant.id)
        provider_started.set()
        await allow_provider_to_finish.wait()
        return 'synthetic-access-token'

    async def gmail_request(token, method, url, *, body=None):
        assert token=='synthetic-access-token'
        provider_calls.append((method,url,body))
        return {'id':'single-concurrent-draft'}

    monkeypatch.setattr(service,'account',connected_account)
    monkeypatch.setattr(google,'access_token',access_token)
    monkeypatch.setattr(google,'api_request',gmail_request)

    payload=proposal_payload()
    proposal,reviewed=await prepare_and_review(client,payload)
    endpoint=f"/api/sourcing/outreach/{proposal['id']}/create-draft"
    confirmation={
        'digest':reviewed['digest'],
        'review_token':reviewed['review_token'],
        'confirmation':'create_gmail_draft_exact_message_and_account',
    }
    first=asyncio.create_task(client.post(endpoint,json=confirmation))
    try:
        await asyncio.wait_for(provider_started.wait(),timeout=3)
        second=await client.post(endpoint,json=confirmation)
        assert second.status_code==200, second.text
        assert second.json()['status']=='creating_draft'
        assert len(access_calls)==1,'the second request must observe the durable in-progress claim'
        assert provider_calls==[],'only the first request may proceed to the Gmail API step'
    finally:
        allow_provider_to_finish.set()

    first_response=await asyncio.wait_for(first,timeout=5)
    assert first_response.status_code==200, first_response.text
    assert first_response.json()['status']=='draft_created'
    assert first_response.json()['gmail_draft_id']=='single-concurrent-draft'
    assert len(provider_calls)==1
    duplicate=await client.post(endpoint,json=confirmation)
    assert duplicate.status_code==200, duplicate.text
    assert duplicate.json()['status']=='draft_created'
    assert len(provider_calls)==1,'a retry after completion must return the saved result without another provider attempt'
