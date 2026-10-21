"""API → tenant scheduler → worker → tools → signed outbox integration."""
import asyncio
import hashlib
import hmac
import json
from contextlib import suppress
from datetime import datetime, timedelta
from types import SimpleNamespace

import httpx
import litellm
import pytest
import pytest_asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.config import settings
from app.db.session import Base, get_db
from app.db.tenancy import current_tenant_id
from app.main import app
from app.models.automation import Goal, Channel, Delivery
from app.models.task import Task
from app.services import automation, worker, orchestrator, verification
from app.services.memory import MemoryManager

TOKEN = 'test-only-internal-token-more-than-32-characters'


@pytest_asyncio.fixture
async def workspace(tmp_path, monkeypatch):
    engine = create_async_engine(f'sqlite+aiosqlite:///{tmp_path}/workflows.db')
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn: await conn.run_sync(Base.metadata.create_all)
    async def dependency():
        async with sessions() as session: yield session
    async def no_redis(self): return None
    app.dependency_overrides[get_db] = dependency
    for module in (automation, worker, orchestrator, verification):
        monkeypatch.setattr(module, 'AsyncSessionLocal', sessions)
    monkeypatch.setattr(MemoryManager, '_get_redis', no_redis)
    monkeypatch.setattr(worker, 'POLL_SECONDS', .02)
    monkeypatch.setattr(settings, 'BACKEND_API_TOKEN', TOKEN)
    monkeypatch.setattr(settings, 'REQUIRE_USER_AUTH', True)
    monkeypatch.delenv('GROKBOT_VERIFY_CLOUD', raising=False)
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test', headers={'Authorization': 'Bearer '+TOKEN}) as client:
            yield client, sessions
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


async def room(client, user):
    headers = {'x-grokbot-user-id': user}
    response = await client.post('/api/bots', headers=headers, json={'name': 'Workflow agent', 'role': 'Assistant', 'system_prompt': 'Use the requested tools and verify results.', 'llm_provider': 'openai', 'llm_model': 'gpt-6-luna', 'tools_enabled': ['browser', 'plugins']})
    assert response.status_code == 200, response.text
    response = await client.post('/api/conversations', headers=headers, json={'title': 'Controlled workflow tests', 'bot_ids': [response.json()['id']]})
    assert response.status_code == 200, response.text
    return response.json()['id']


@pytest.mark.asyncio
async def test_goals_keep_each_owner_through_scheduler_worker_and_completion(workspace, monkeypatch):
    client, sessions = workspace
    users = ['test-user-a', 'test-user-b']
    rooms = [await room(client, user) for user in users]
    goals = []
    for user, rid in zip(users, rooms):
        response = await client.post('/api/goals', headers={'x-grokbot-user-id': user}, json={'conversation_id': rid, 'title': 'Verify '+user, 'objective': 'Return a verified result and call complete_goal.', 'success_criteria': 'The result is recorded.', 'max_runs': 1, 'manager_model': 'gpt-6-luna'})
        assert response.status_code == 201, response.text
        goals.append(response.json()['id'])
    seen = []
    async def complete(**kwargs):
        tenant = current_tenant_id.get()
        assert tenant in users
        seen.append(tenant)
        if kwargs['messages'][-1]['role'] != 'tool':
            message = {'role': 'assistant', 'content': None, 'tool_calls': [{'id': 'call_complete', 'type': 'function', 'function': {'name': 'complete_goal', 'arguments': json.dumps({'evidence': 'Verified '+tenant})}}]}
        else:
            message = {'role': 'assistant', 'content': 'Verified '+tenant}
        return litellm.ModelResponse(choices=[{'index': 0, 'message': message, 'finish_reason': 'stop'}])
    monkeypatch.setattr(orchestrator.LLMGateway, 'complete', complete)
    await automation.tick_goals(sessions)
    async with sessions() as db:
        tasks = list((await db.execute(select(Task))).scalars())
        assert {t.tenant_id for t in tasks} == set(users)
    runner = asyncio.create_task(worker.run_worker())
    try:
        for _ in range(200):
            async with sessions() as db:
                states = list((await db.execute(select(Goal.status))).scalars())
            if states == ['completed', 'completed']: break
            await asyncio.sleep(.03)
        assert states == ['completed', 'completed']
        assert set(seen) == set(users)
        for user, gid in zip(users, goals):
            own = (await client.get('/api/goals', headers={'x-grokbot-user-id': user})).json()
            assert len(own) == 1 and own[0]['id'] == gid and own[0]['last_summary'] == 'Verified '+user
    finally:
        runner.cancel()
        with suppress(asyncio.CancelledError): await runner
    assert current_tenant_id.get() is None


@pytest.mark.asyncio
async def test_external_channel_key_auth_dedup_and_owner_signed_delivery(workspace, monkeypatch):
    client, sessions = workspace
    rid = await room(client, 'channel-owner')
    async def public_url(url): pass
    monkeypatch.setattr(automation, 'validate_endpoint', public_url)
    from app.api import automation as api
    monkeypatch.setattr(api, 'validate_endpoint', public_url)
    response = await client.post('/api/channels', headers={'x-grokbot-user-id': 'channel-owner'}, json={'name': 'Controlled channel', 'conversation_id': rid, 'manager_model': 'gpt-6-luna', 'webhook_url': 'https://receiver.example/result'})
    assert response.status_code == 201, response.text
    channel = response.json()
    path = channel['inbound_path']
    payload = {'event_id': 'one-event', 'text': 'Return Channel connected.'}
    assert (await client.post(path, json=payload)).status_code == 401
    headers = {'X-Grokbot-Channel-Key': channel['token']}
    accepted = await client.post(path, headers=headers, json=payload)
    assert accepted.status_code == 202, accepted.text
    duplicate = await client.post(path, headers=headers, json=payload)
    assert duplicate.json() == {'status': 'duplicate', 'task_id': accepted.json()['task_id']}
    assert (await client.get('/api/channels')).status_code == 401
    assert (await client.get('/api/channels', headers={'x-grokbot-user-id': 'other-user'})).json() == []
    async with sessions() as db:
        task = await db.get(Task, accepted.json()['task_id'])
        assert task.tenant_id == 'channel-owner'
        task.status = 'completed'
        task.result = {'responses': [{'sender_type': 'bot', 'content': 'Channel connected.'}, {'sender_type': 'system', 'content': 'PRIVATE INTERNAL RESULT', 'metadata': {'internal': True}}]}
        await db.commit()
    token = current_tenant_id.set('channel-owner')
    try: await automation.enqueue_delivery(task.id, channel['id'], sessions)
    finally: current_tenant_id.reset(token)
    requests = []
    def received(request):
        requests.append(request)
        expected = 'sha256='+hmac.new(channel['token'].encode(), request.content, hashlib.sha256).hexdigest()
        assert request.headers['x-grokbot-signature'] == expected
        assert 'PRIVATE' not in request.content.decode()
        assert json.loads(request.content)['text'] == 'Channel connected.'
        return httpx.Response(200)
    monkeypatch.setattr(automation, 'http_client', lambda: httpx.AsyncClient(transport=httpx.MockTransport(received)))
    await automation.tick_deliveries(sessions)
    assert len(requests) == 1 and current_tenant_id.get() is None
    async with sessions() as db:
        delivery = (await db.execute(select(Delivery))).scalar_one()
        assert delivery.tenant_id == 'channel-owner' and delivery.status == 'delivered'
    await client.patch('/api/channels/'+channel['id'], headers={'x-grokbot-user-id': 'channel-owner'}, json={'enabled': False})
    assert (await client.post(path, headers=headers, json={'event_id': 'disabled', 'text': 'No task'})).status_code == 401


@pytest.mark.asyncio
async def test_verified_existing_owner_can_recover_legacy_data(workspace, monkeypatch):
    from app.models.email_auth import EmailLoginToken
    from app.models.user import User
    from app.api.auth import account_id_for
    from app.models.bot import Bot
    client, sessions = workspace
    monkeypatch.setattr(settings, 'LEGACY_OWNER_EMAIL', 'owner@example.test')
    await room(client, 'legacy-owner')
    token = 'controlled-magic-link-token-for-test-only'
    uid = account_id_for('owner@example.test')
    async with sessions() as db:
        db.add(User(id=uid, email='owner@example.test'))
        db.add(EmailLoginToken(email='owner@example.test', token_hash=hashlib.sha256(token.encode()).hexdigest(), expires_at=datetime.utcnow()+timedelta(minutes=5)))
        await db.commit()
    result = await client.get('/api/auth/email/verify', params={'token': token})
    assert result.status_code == 200, result.text
    own = await client.get('/api/bots', headers={'x-grokbot-user-id': uid})
    assert len(own.json()) == 1
    assert (await client.get('/api/bots', headers={'x-grokbot-user-id': 'stranger'})).json() == []
    assert (await client.get('/api/auth/email/verify', params={'token': token})).status_code == 400


@pytest.mark.asyncio
async def test_participant_changes_cannot_attach_another_owners_room_or_agent(workspace):
    client, sessions = workspace
    own_room = await room(client, 'participant-owner')
    foreign_room = await room(client, 'different-owner')
    own_bot = (await client.get('/api/bots', headers={'x-grokbot-user-id': 'participant-owner'})).json()[0]['id']
    foreign_bot = (await client.get('/api/bots', headers={'x-grokbot-user-id': 'different-owner'})).json()[0]['id']
    headers = {'x-grokbot-user-id': 'participant-owner'}
    for conversation, bot in [(foreign_room, own_bot), (own_room, foreign_bot)]:
        response = await client.post(f'/api/conversations/{conversation}/participants', params={'bot_id': bot}, headers=headers)
        assert response.status_code == 404, response.text
    response = await client.post(f'/api/conversations/{own_room}/participants', params={'bot_id': own_bot}, headers=headers)
    assert response.status_code == 409, response.text


@pytest.mark.asyncio
async def test_queued_document_does_not_read_future_audio_and_transcript_is_cached(workspace, monkeypatch):
    import base64
    import ai
    from app.models.message import Message
    from app.services.model_routing import required_modalities
    client, sessions = workspace
    headers = {'x-grokbot-user-id': 'attachment-owner'}
    rid = await room(client, 'attachment-owner')
    audio = {'name': 'recording.wav', 'mime': 'audio/wav', 'data': base64.b64encode(b'controlled-audio-bytes').decode()}
    first = (await client.post(f'/api/conversations/{rid}/messages', headers=headers, json={'sender_type': 'user', 'content': 'Read the PDF only.', 'attachments': [{'name': 'document.pdf', 'mime': 'application/pdf', 'data': base64.b64encode(b'%PDF-controlled').decode()}]})).json()
    second = (await client.post(f'/api/conversations/{rid}/messages', headers=headers, json={'sender_type': 'user', 'content': 'Listen to FUTURE-AUDIO-REQUEST.', 'attachments': [audio]})).json()
    monkeypatch.setattr(settings, 'LLM_USE_GATEWAY', True)
    from app.services import attachments
    async def catalog():return {settings.AUDIO_TRANSCRIPTION_MODEL: {'type': 'transcription'}}
    monkeypatch.setattr(attachments, 'gateway_catalog', catalog)
    transcribed = []
    async def transcribe(model, file):
        assert file.data == b'controlled-audio-bytes' and file.media_type == 'audio/wav'
        transcribed.append(model.id)
        return SimpleNamespace(value=SimpleNamespace(text='The verification code is 729416.'))
    monkeypatch.setattr(ai.ops, 'transcribe', transcribe)
    calls = []
    async def complete(**kwargs):
        messages = kwargs['messages']
        serialized = json.dumps(messages)
        assert 'input_audio' not in serialized
        assert messages[-1] == {'role': 'user', 'content': ['Read the PDF only.', 'Listen to FUTURE-AUDIO-REQUEST.', 'Listen again.'][len(calls)]}
        if not calls:
            assert required_modalities(messages) == {'text', 'pdf'}
            assert 'FUTURE-AUDIO-REQUEST' not in serialized
            assert transcribed == []
        else:
            assert '729416' in serialized
        calls.append(messages)
        return litellm.ModelResponse(choices=[{'index': 0, 'message': {'role': 'assistant', 'content': 'Checked.'}, 'finish_reason': 'stop'}])
    monkeypatch.setattr(orchestrator.LLMGateway, 'complete', complete)
    tenant = current_tenant_id.set('attachment-owner')
    try:
        for incoming, prompt in [(first, 'Read the PDF only.'), (second, 'Listen to FUTURE-AUDIO-REQUEST.'), (second, 'Listen again.')]:
            await orchestrator.AgentOrchestrator().process_message(rid, prompt, incoming_message_id=incoming['message_id'])
    finally:current_tenant_id.reset(tenant)
    assert len(calls) == 3 and len(transcribed) == 1
    async with sessions() as db:
        saved = await db.get(Message, second['message_id'])
        assert saved.metadata_json['attachments'][0] == audio
        assert saved.metadata_json['audio_transcripts']['0']['text'].endswith('729416.')
