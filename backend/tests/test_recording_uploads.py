import base64
import copy
import json
import shutil
import subprocess
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.config import settings
from app.db.tenancy import current_tenant_id
from app.services import attachments, multimedia, omniroute
from app.services.llm_gateway import LLMGateway
from app.services.model_routing import ModelCapabilityError
from app.services.orchestrator import AgentOrchestrator
from app.services.recordings import audio_only_mime, RecordingError
from .test_workspace_workflows import workspace, room


@pytest.fixture(params=['video/webm', 'video/mp4'])
def saved_webm(request):
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        pytest.skip('ffmpeg and ffprobe are required for real container fixtures')
    mime = request.param
    encoding = ['-c:a', 'libopus', '-f', 'webm'] if mime == 'video/webm' else ['-c:a', 'aac', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4']
    data = subprocess.run([
        'ffmpeg', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i',
        'sine=frequency=440:duration=0.25', *encoding, 'pipe:1',
    ], check=True, capture_output=True).stdout
    return {'name': 'saved-recording.'+mime.split('/')[1], 'mime': mime,
            'data': base64.b64encode(data).decode()}


@pytest.mark.asyncio
@pytest.mark.parametrize('trigger', ['Review the attached files.', 'Expanded skill: explain the attached recording.'])
async def test_file_only_saved_recording_reaches_final_model_and_native_playback(workspace, monkeypatch, saved_webm, trigger):
    client, _ = workspace
    owner = 'saved-recording-owner'
    headers = {'x-grokbot-user-id': owner}
    cid = await room(client, owner)
    phrase = 'The purple bicycle costs forty-seven dollars.'
    original = copy.deepcopy(saved_webm)
    calls = []
    monkeypatch.setattr(settings, 'OMNIROUTE_URL', 'https://router.example')

    async def speech(path, body):
        calls.append(path)
        assert path == '/audio/transcriptions'
        assert body['file']['mime'] == 'audio/mpeg'
        assert base64.b64decode(body['file']['data']) != base64.b64decode(original['data'])
        return {'text': phrase}

    async def complete(**kwargs):
        final = kwargs['messages'][-1]['content']
        assert phrase in json.dumps(final)
        assert json.dumps(kwargs['messages']).count(phrase) == 1
        assert trigger in json.dumps(final)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='Forty-seven dollars.', tool_calls=None))])

    monkeypatch.setattr(omniroute, 'request', speech)
    monkeypatch.setattr(LLMGateway, 'complete', complete)
    payload = {'sender_type': 'user', 'content': '', 'client_message_id': str(uuid4()), 'attachments': [saved_webm]}
    incoming = await client.post('/api/conversations/'+cid+'/messages', headers=headers, json=payload)
    assert incoming.status_code == 202
    tenant = current_tenant_id.set(owner)
    try:
        replies = await AgentOrchestrator().process_message(cid, trigger, incoming_message_id=incoming.json()['message_id'])
    finally:
        current_tenant_id.reset(tenant)
    assert replies[-1]['content'] == 'Forty-seven dollars.'
    assert calls == ['/audio/transcriptions']
    messages = (await client.get('/api/conversations/'+cid+'/messages', headers=headers)).json()
    uploaded = next(m for m in messages if m['id'] == incoming.json()['message_id'])
    file = uploaded['metadata_json']['attachments'][0]
    expected_mime = original['mime'].replace('video/', 'audio/')
    assert file['mime'] == expected_mime
    playback = await client.get(file['url'], headers=headers)
    assert playback.status_code == 200
    assert playback.headers['content-type'].startswith(expected_mime)
    assert playback.headers['content-disposition'].startswith('inline')
    assert playback.content == base64.b64decode(original['data'])
    # A retry still compares the original immutable attachment envelope.
    replay = await client.post('/api/conversations/'+cid+'/messages', headers=headers, json=payload)
    assert replay.status_code == 202 and replay.json()['task_id'] == incoming.json()['task_id']
    assert saved_webm == original


@pytest.mark.asyncio
async def test_saved_webm_classification_and_transcript_are_cached_without_rewriting_original(monkeypatch, saved_webm):
    monkeypatch.setattr(settings, 'OMNIROUTE_URL', 'https://router.example')
    source = copy.deepcopy(saved_webm)
    message = SimpleNamespace(metadata_json={'attachments': [source]})
    calls = []

    async def speech(path, body):
        calls.append(path)
        return {'text': 'A verifiable saved recording.'}

    monkeypatch.setattr(omniroute, 'request', speech)
    class DB:
        async def commit(self):
            pass
    first = await attachments.prepare_audio(DB(), message, [saved_webm])
    second = await attachments.prepare_audio(DB(), message, [saved_webm])
    from app.services.voice_policy import speech_request
    assert first == second and calls == ['/audio/transcriptions']
    assert speech_request(first) == speech_request(second) == 'A verifiable saved recording.'
    assert speech_request(list(second)) == ''  # Copies of provider files carry no authority.
    assert all(set(file) == {'name','mime','data'} for file in second)
    assert message.metadata_json['attachments'] == [source]
    assert message.metadata_json['attachment_mime_overrides'] == {'0': source['mime'].replace('video/', 'audio/')}


@pytest.mark.asyncio
async def test_recording_evidence_does_not_replace_a_specialists_assignment(workspace, monkeypatch, saved_webm):
    client, _ = workspace
    owner = 'recording-team-owner'
    headers = {'x-grokbot-user-id': owner}
    ids = []
    for role in ['Coordinator', 'Researcher']:
        bot = await client.post('/api/bots', headers=headers, json={
            'name': role, 'role': role, 'llm_provider': 'openai',
            'llm_model': 'gpt-6-luna', 'system_prompt': 'Verify the supplied recording evidence.', 'tools_enabled': []})
        assert bot.status_code == 200
        ids.append(bot.json()['id'])
    conversation = await client.post('/api/conversations', headers=headers, json={
        'title': 'Recording team fixture', 'is_group': True, 'bot_ids': ids})
    cid = conversation.json()['id']
    phrase = 'The verified recorded price is forty-seven dollars.'
    async def speech(file):
        return phrase
    monkeypatch.setattr(attachments, 'transcribe_audio', speech)
    calls = []
    async def complete(**kwargs):
        prompt = kwargs['messages'][0]['content']
        final = json.dumps(kwargs['messages'][-1]['content'])
        assert json.dumps(kwargs['messages']).count(phrase) == 1
        if 'Complete only your assigned part.' in prompt:
            assert 'Your concrete assignment' in final and 'Verify the recorded price' in final
            answer = 'The price is forty-seven dollars.'
            calls.append('specialist')
        elif 'The assigned specialist work has finished.' in prompt:
            assert phrase in final
            answer = 'Verified price: forty-seven dollars.'
            calls.append('synthesis')
        else:
            answer = 'HANDOFF[Researcher: Verify the recorded price.]'
            calls.append('lead')
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=answer, tool_calls=None))])
    monkeypatch.setattr(LLMGateway, 'complete', complete)
    incoming = await client.post('/api/conversations/'+cid+'/messages', headers=headers,
        json={'sender_type': 'user', 'content': '', 'attachments': [saved_webm]})
    assert incoming.status_code == 202
    tenant = current_tenant_id.set(owner)
    try:
        await AgentOrchestrator().process_message(cid, 'Review the attached files.', incoming_message_id=incoming.json()['message_id'])
    finally:
        current_tenant_id.reset(tenant)
    assert calls == ['lead', 'specialist', 'synthesis']


@pytest.mark.asyncio
async def test_actual_video_still_uses_visual_analysis(monkeypatch, tmp_path):
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        pytest.skip('ffmpeg is required')
    path = tmp_path/'video.webm'
    subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i',
                    'color=c=purple:s=160x120:d=0.25', '-c:v', 'libvpx', str(path)], check=True)
    data = path.read_bytes()
    assert audio_only_mime(data, 'video/webm') is None
    source = {'name': 'visual.webm', 'mime': 'video/webm', 'data': base64.b64encode(data).decode()}
    message = SimpleNamespace(metadata_json={'attachments': [source]})
    async def video(file):
        assert file == source
        return 'Verified purple video frames.'
    monkeypatch.setattr(multimedia, 'prepare_uploaded_video', video)
    class DB:
        async def commit(self):
            pass
    prepared = await attachments.prepare_audio(DB(), message, [source])
    assert 'video evidence' in prepared[0]['name']
    assert 'attachment_mime_overrides' not in message.metadata_json


@pytest.mark.parametrize('data', [b'', b'x'*(3*1024*1024+1), b'not a playable media container'])
def test_invalid_or_oversized_recordings_fail_before_transcription(data):
    with pytest.raises(RecordingError):
        audio_only_mime(data, 'video/webm')
