"""Prepare uploaded audio once, preserving the original file and cached transcript."""
import asyncio
import base64
from app.config import settings
from app.services.model_routing import ModelCapabilityError, gateway_catalog


async def transcribe_audio(file):
    data = base64.b64decode(file['data'], validate=True)
    if settings.OMNIROUTE_API_BASE:
        raise ModelCapabilityError('This OmniRoute connection does not expose audio transcription. Your original file is saved.')
    if settings.LLM_USE_GATEWAY and not settings.OMNIROUTE_API_BASE:
        import ai
        from ai.types.messages import FilePart
        model = settings.AUDIO_TRANSCRIPTION_MODEL
        item = (await gateway_catalog()).get(model)
        if not item or item.get('type') != 'transcription':
            raise ModelCapabilityError('Audio transcription is not available in the configured model catalog. Your original file is saved.')
        result = await asyncio.wait_for(ai.ops.transcribe(ai.get_model(model), FilePart(data=data, media_type=file['mime'], filename=file['name'])), timeout=90)
        text = result.value.text
    else:
        from openai import AsyncOpenAI
        from app.services.llm_gateway import completion_options
        connection = completion_options('gpt-6.1-sol', 'openai')
        async with AsyncOpenAI(api_key=connection['api_key'], base_url=connection.get('api_base', 'https://api.openai.com/v1'), default_headers=connection.get('extra_headers'), max_retries=0) as client:
            result = await client.audio.transcriptions.create(model=settings.AUDIO_TRANSCRIPTION_MODEL.removeprefix('openai/'), file=(file['name'], data, file['mime']), timeout=90)
        text = result.text
    if not text.strip():
        raise ModelCapabilityError('No speech could be transcribed from this audio. Your original file is saved; send a clearer recording or text.')
    return text.strip()


async def prepare_audio(db, message, files):
    """Only the attachment sets included in this task reach a transcription model."""
    metadata = dict(message.metadata_json or {})
    cached = dict(metadata.get('audio_transcripts') or {})
    prepared = []
    for index, file in enumerate(files):
        if not file['mime'].startswith('audio/'):
            prepared.append(file)
            continue
        key = str(index)
        if key not in cached:
            cached[key] = {'text': await transcribe_audio(file), 'model': settings.AUDIO_TRANSCRIPTION_MODEL}
            metadata['audio_transcripts'] = dict(cached)
            message.metadata_json = dict(metadata)
            await db.commit()
        prepared.append({'name': file['name']+' (speech transcript)', 'mime': 'text/plain', 'data': base64.b64encode(cached[key]['text'].encode()).decode()})
    return prepared
