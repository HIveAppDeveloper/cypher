"""Generate actual media in the persistent worker using Vercel's Python SDK."""
import asyncio
import base64
from app.config import settings

MAX_ASSET_BYTES = 32 * 1024 * 1024

async def generate_media(kind: str, prompt: str, aspect_ratio='16:9', duration=4):
    import ai
    if not prompt.strip():
        raise ValueError('Describe the media you want to generate.')
    if kind == 'image':
        result = await asyncio.wait_for(ai.ops.generate_image(ai.get_model(settings.IMAGE_MODEL), prompt, params=ai.ops.ImageParams(n=1, aspect_ratio=aspect_ratio)), timeout=300)
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
