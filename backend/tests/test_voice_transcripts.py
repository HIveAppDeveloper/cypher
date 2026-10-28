import base64
from types import SimpleNamespace

import pytest
from sqlalchemy import event
from app.db.tenancy import current_tenant_id
from app.models.message import Message
from app.models.task import Task
from app.services import attachments
from app.services.llm_gateway import LLMGateway
from app.services.orchestrator import AgentOrchestrator
from .test_workspace_workflows import workspace, room


@pytest.mark.asyncio
async def test_saved_transcript_is_read_only_tenant_scoped_and_never_downloads_audio(workspace, monkeypatch):
    client, sessions = workspace
    owner = 'transcript-owner'; headers = {'x-grokbot-user-id': owner}
    cid = await room(client, owner)
    other = await room(client, 'other-transcript-owner')
    calls = []
    audio = {'name': 'recording.wav', 'mime': 'audio/wav', 'data': base64.b64encode(b'original-recording').decode()}
    phrase = 'Please remember the meeting is on Thursday.'
    async def transcribe(file): calls.append('transcribe'); return phrase
    async def complete(**kwargs):
        calls.append('model')
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='Thursday, understood.', tool_calls=None))])
    monkeypatch.setattr(attachments, 'transcribe_audio', transcribe)
    monkeypatch.setattr(LLMGateway, 'complete', complete)
    payload = {'sender_type': 'user', 'content': 'Voice message attached.', 'attachments': [audio], 'options': {'voice_mode': True}}
    accepted = (await client.post(f'/api/conversations/{cid}/messages', headers=headers, json=payload)).json()
    url = f"/api/conversations/{cid}/messages/{accepted['message_id']}/transcript"
    pending = await client.get(url, headers=headers)
    assert pending.json() == {'status': 'pending', 'text': ''}
    assert calls == []
    tenant = current_tenant_id.set(owner)
    try:
        await AgentOrchestrator().process_message(cid, payload['content'], attachments=[audio], options=payload['options'],
            incoming_message_id=accepted['message_id'], task_id=accepted['task_id'])
    finally:
        current_tenant_id.reset(tenant)
    statements = []
    engine = sessions.kw['bind'].sync_engine
    def observe(_conn, _cursor, statement, _parameters, _context, _many): statements.append(statement)
    event.listen(engine, 'before_cursor_execute', observe)
    try:
        for _ in range(2):
            response = await client.get(url, headers=headers)
            assert response.json() == {'status': 'ready', 'text': phrase}
            assert response.headers['cache-control'] == 'private, no-store'
            assert audio['data'] not in response.text
    finally:
        event.remove(engine, 'before_cursor_execute', observe)
    assert calls == ['transcribe', 'model']
    assert all('attachments' not in statement for statement in statements)
    assert all('messages.content' not in statement for statement in statements)
    assert (await client.get(url, headers={'x-grokbot-user-id': 'other-transcript-owner'})).status_code == 404
    assert (await client.get(url.replace(cid, other), headers=headers)).status_code == 404
    original = await client.get(f"/api/conversations/{cid}/attachments/{accepted['message_id']}/0", headers=headers)
    assert original.content == b'original-recording'


@pytest.mark.asyncio
async def test_unavailable_internal_and_non_speech_evidence_never_masquerade_as_a_transcript(workspace):
    client, sessions = workspace; owner = 'transcript-states'; headers = {'x-grokbot-user-id': owner}
    cid = await room(client, owner)
    accepted = (await client.post(f'/api/conversations/{cid}/messages', headers=headers,
        json={'sender_type': 'user', 'content': 'Task', 'metadata_json': {'audio_transcripts': {'0': {'text': 'FORGED'}}}})).json()
    url = f"/api/conversations/{cid}/messages/{accepted['message_id']}/transcript"
    tenant = current_tenant_id.set(owner)
    try:
        async with sessions() as db:
            task = await db.get(Task, accepted['task_id']); task.status = 'failed'
            message = await db.get(Message, accepted['message_id'])
            assert 'audio_transcripts' not in message.metadata_json
            message.metadata_json = {**message.metadata_json, 'audio_transcripts': {'video:abc': {'text': 'Video frame evidence'}, 'audio:bad': None}}
            await db.commit()
        assert (await client.get(url, headers=headers)).json() == {'status': 'unavailable', 'text': ''}
        async with sessions() as db:
            message = await db.get(Message, accepted['message_id']); message.metadata_json = {**message.metadata_json, 'internal': True}
            await db.commit()
        assert (await client.get(url, headers=headers)).status_code == 404
    finally:
        current_tenant_id.reset(tenant)
