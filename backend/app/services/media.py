"""Generate actual media in the persistent worker through its configured transport."""
import base64
import asyncio
from app.config import settings

MAX_ASSET_BYTES = 32 * 1024 * 1024

async def generate_media(kind: str, prompt: str, aspect_ratio='16:9', duration=4, image_provider=None):
    if not prompt.strip():
        raise ValueError('Describe the media you want to generate.')
    if kind != 'image':
        raise ValueError('Video generation is not available on the configured OmniRoute or direct model connection yet. No request was sent.')
    if image_provider == 'google':
        raise ValueError('Google image generation is not available on the configured OmniRoute or direct model connection yet. Choose OpenAI image generation.')
    if settings.OMNIROUTE_URL:
        from app.services import omniroute
        from app.services.usage import check_allowance, record
        await check_allowance()
        response = await omniroute.request('/responses', {
            'model': omniroute.model_id('openai', 'gpt-6.1-sol'),
            'input': f'Generate exactly one image, aspect ratio {aspect_ratio}. {prompt}',
            'tools': [{'type': 'image_generation'}],
            'tool_choice': {'type': 'image_generation'},
            'max_output_tokens': 1024, 'reasoning': {'effort': 'low'},
        })
        images = [item for item in response.get('output', []) if item.get('type') == 'image_generation_call' and item.get('result')]
        if not images:
            raise RuntimeError('The OmniRoute model returned no generated image.')
        data = base64.b64decode(images[0]['result'], validate=True)
        # Verify the returned bytes before offering an image download.
        from PIL import Image
        from io import BytesIO
        with Image.open(BytesIO(data)) as image:
            mime = Image.MIME.get(image.format)
            image.verify()
        if mime not in {'image/png', 'image/jpeg', 'image/webp'} or len(data) > MAX_ASSET_BYTES:
            raise ValueError('Generated image has an unsupported format or exceeds 32 MB.')
        await record('openai', 'gpt-6.1-sol', response.get('usage'))
        extension = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp'}[mime]
        return [{'name': f'generated-image-1.{extension}', 'mime': mime, 'data': base64.b64encode(data).decode()}]
    from openai import AsyncOpenAI
    from app.services.llm_gateway import completion_options
    from app.services.usage import check_allowance, record
    await check_allowance()
    connection = completion_options('gpt-6.1-sol', 'openai')
    size = {'16:9':'1536x1024', '9:16':'1024x1536', '1:1':'1024x1024'}.get(aspect_ratio,'1024x1024')
    async with AsyncOpenAI(api_key=connection['api_key'], base_url='https://api.openai.com/v1', max_retries=0) as client:
        response = await asyncio.wait_for(client.images.generate(
            model=settings.IMAGE_MODEL.removeprefix('openai/'), prompt=prompt, n=1, size=size, timeout=300,
        ), timeout=310)
    item = response.data[0] if response.data else None
    if not item or not item.b64_json:
        raise RuntimeError('The OpenAI image model returned no image data.')
    data = base64.b64decode(item.b64_json, validate=True)
    if len(data) > MAX_ASSET_BYTES:
        raise ValueError('Generated image exceeds 32 MB.')
    from PIL import Image
    from io import BytesIO
    with Image.open(BytesIO(data)) as image:
        mime = Image.MIME.get(image.format)
        image.verify()
    if mime not in {'image/png', 'image/jpeg', 'image/webp'}:
        raise ValueError('Generated image has an unsupported format.')
    await record('openai', settings.IMAGE_MODEL.removeprefix('openai/'), getattr(response, 'usage', None))
    extension = {'image/png':'png', 'image/jpeg':'jpg', 'image/webp':'webp'}[mime]
    return [{'name': f'generated-image-1.{extension}', 'mime': mime, 'data': base64.b64encode(data).decode()}]
