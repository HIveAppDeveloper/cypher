"""Generate actual media in the persistent worker using Vercel's Python SDK."""
import asyncio
import base64
from app.config import settings

MAX_ASSET_BYTES = 32 * 1024 * 1024

async def generate_media(kind: str, prompt: str, aspect_ratio='16:9', duration=4, image_provider=None):
    if settings.OMNIROUTE_API_BASE:
        raise ValueError('This OmniRoute connection does not expose image or video generation.')
    import ai
    if not prompt.strip():
        raise ValueError('Describe the media you want to generate.')
    if kind == 'image' and image_provider == 'google':
        # Gemini image output uses Chat Completions, not the image-only endpoint.
        from openai import AsyncOpenAI
        from app.services.llm_gateway import completion_options
        auth = completion_options('gpt-6.1-sol', 'openai')
        if not settings.LLM_USE_GATEWAY:
            raise ValueError('Google image generation requires the configured AI Gateway connection.')
        async with AsyncOpenAI(api_key=auth['api_key'], base_url=auth['api_base'], max_retries=0) as client:
            response = await client.chat.completions.create(
                model=settings.GOOGLE_IMAGE_MODEL,
                messages=[{'role':'user','content':f'Generate exactly one image with aspect ratio {aspect_ratio}. '+prompt}],
                extra_body={'modalities':['text','image']}, timeout=300)
        images = response.choices[0].message.model_dump().get('images') or []
        from types import SimpleNamespace
        parts = []
        for item in images[:1]:
            url = item.get('image_url', {}).get('url', '')
            if not url.startswith('data:image/') or ';base64,' not in url:
                raise ValueError('Google returned an unsupported image response.')
            header, data = url.split(';base64,', 1)
            parts.append(SimpleNamespace(data=data, media_type=header.removeprefix('data:')))
        result = SimpleNamespace(value=parts)
    elif kind == 'image':
        size = {'16:9':'1536x1024', '9:16':'1024x1536', '1:1':'1024x1024'}.get(aspect_ratio,'1024x1024')
        params = ai.ops.ImageParams(n=1, size=size) if settings.IMAGE_MODEL.startswith('openai/') else ai.ops.ImageParams(n=1, aspect_ratio=aspect_ratio)
        result = await asyncio.wait_for(ai.ops.generate_image(ai.get_model(settings.IMAGE_MODEL), prompt, params=params), timeout=300)
    elif kind == 'video':
        if aspect_ratio == '1:1':
            raise ValueError('Choose landscape or portrait for this video model.')
        result = await asyncio.wait_for(ai.ops.generate_video(ai.get_model(settings.VIDEO_MODEL), prompt, params=ai.ops.VideoParams(n=1, aspect_ratio=aspect_ratio, duration=duration)), timeout=900)
    else:
        raise ValueError('Unsupported media output')
    if not result.value:
        raise RuntimeError('The model returned no media.')
    files = []
    for index, item in enumerate(result.value[:1]):
        data = item.data if isinstance(item.data, bytes) else base64.b64decode(item.data)
        mime = item.media_type
        allowed = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4'}
        if mime not in allowed or len(data) > MAX_ASSET_BYTES:
            raise ValueError('Generated media has an unsupported format or exceeds 32 MB.')
        files.append({'name': f'generated-{kind}-{index + 1}.{allowed[mime]}', 'mime': mime, 'data': base64.b64encode(data).decode()})
    return files
