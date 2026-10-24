"""Prepare original uploads for connected models without dropping their evidence."""
import asyncio
import base64
from app.config import settings
from app.services.model_routing import ModelCapabilityError


async def transcribe_audio(file):
    try:
        data=base64.b64decode(file['data'],validate=True)
        if not 0<len(data)<=3*1024*1024:raise ValueError()
    except (KeyError,ValueError) as error:
        raise ModelCapabilityError('This recording is not valid audio data. Your original audio is saved.') from error
    if settings.OMNIROUTE_URL:
        from app.services import omniroute
        from app.services.recordings import normalize_recording, RecordingError
        try:
            speech_data, mime, extension = await asyncio.to_thread(normalize_recording, data, file['mime'])
        except RecordingError as error:
            raise ModelCapabilityError(str(error) + ' Your original audio is saved.') from error
        speech_file = {**file, 'mime': mime, 'data': base64.b64encode(speech_data).decode()}
        if extension:
            speech_file['name'] = file['name'].rsplit('.', 1)[0] + '.' + extension
        result = await omniroute.request('/audio/transcriptions', {'model':'omniroute/whisper-base-local','file':speech_file})
        text = result.get('text', '').strip()
        if not text:
            raise ModelCapabilityError('No speech was detected in this audio. Your original audio is saved.')
        return text
    from openai import AsyncOpenAI
    from app.services.llm_gateway import completion_options
    connection = completion_options('gpt-6.1-sol', 'openai')
    if connection.get('api_base') not in (None, 'https://api.openai.com/v1'):
        raise ModelCapabilityError('Audio transcription needs the direct OpenAI API connection. Your original audio is saved.')
    async with AsyncOpenAI(api_key=connection['api_key'], base_url='https://api.openai.com/v1', max_retries=0) as client:
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
    # Render PDF pages rather than passing an unsupported file part through an
    # OpenAI-compatible translator. The original remains the downloadable source.
    if any(file['mime']=='application/pdf' for file in files):
        from app.services.multimedia import prepare_documents
        files = await asyncio.to_thread(prepare_documents, files)
    for index, file in enumerate(files):
        if file['mime'].startswith('video/'):
            from app.services.multimedia import prepare_uploaded_video
            key = 'video:' + __import__('hashlib').sha256(file['data'].encode()).hexdigest()
            if key not in cached:
                cached[key] = {'text':await prepare_uploaded_video(file), 'model':'omniroute/video-frames-and-speech'}
                metadata['audio_transcripts'] = dict(cached);message.metadata_json = dict(metadata);await db.commit()
            prepared.append({'name':file['name']+' (video evidence)', 'mime':'text/plain','data':base64.b64encode(cached[key]['text'].encode()).decode()})
            continue
        if not file['mime'].startswith('audio/'):
            prepared.append(file)
            continue
        key = 'audio:' + __import__('hashlib').sha256(file['data'].encode()).hexdigest() if settings.OMNIROUTE_URL else str(index)
        if key not in cached:
            cached[key] = {'text': await transcribe_audio(file), 'model': 'omniroute/whisper-base-local' if settings.OMNIROUTE_URL else settings.AUDIO_TRANSCRIPTION_MODEL}
            metadata['audio_transcripts'] = dict(cached)
            message.metadata_json = dict(metadata)
            await db.commit()
        prepared.append({'name': file['name']+' (speech transcript)', 'mime': 'text/plain', 'data': base64.b64encode(cached[key]['text'].encode()).decode()})
    return prepared
