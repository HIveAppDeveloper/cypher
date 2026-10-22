"""Actual public YouTube video/audio analysis, rather than caption-only browsing."""
import re
from urllib.parse import urlsplit, parse_qs


def youtube_url(value):
    parsed = urlsplit(str(value))
    if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError('Use a public HTTPS YouTube video URL.')
    host = (parsed.hostname or '').lower()
    if host == 'youtu.be':
        video = parsed.path.strip('/')
    elif host in {'youtube.com', 'www.youtube.com', 'm.youtube.com'}:
        video = parse_qs(parsed.query).get('v', [''])[0] if parsed.path == '/watch' else parsed.path.removeprefix('/shorts/') if parsed.path.startswith('/shorts/') else ''
    else:
        raise ValueError('This video tool supports public YouTube videos. Other sites may require a provider connection or an uploaded file.')
    if not re.fullmatch(r'[A-Za-z0-9_-]{11}', video):
        raise ValueError('Use a valid YouTube video link.')
    return 'https://www.youtube.com/watch?v=' + video


def input_tokens(usage, modality):
    if isinstance(usage, dict):
        if usage.get('modality') == modality:
            return int(usage.get('tokenCount', 0))
        return sum(input_tokens(value, modality) for value in usage.values())
    if isinstance(usage, list):
        return sum(input_tokens(value, modality) for value in usage)
    return 0


async def analyze_video(args, bot_id):
    """Analyze provider-confirmed video frames and speech; never substitute captions."""
    import asyncio
    import tempfile

    from app.config import settings
    from app.services.model_routing import ModelCapabilityError
    from app.services.video_sources import video_url, download_media
    from app.services.multimedia import inspect_media

    try:
        url = video_url(args.get('url', ''))
        question = str(args.get('question', 'Describe the video, spoken content and important timestamps.'))[:4000]

        # YouTube's native route avoids downloading a whole public video when
        # OmniRoute can process its URL directly. Require provider usage that
        # confirms actual video tokens before returning a successful result.
        if settings.OMNIROUTE_URL and url.startswith('https://www.youtube.com/'):
            from app.services import omniroute
            from app.services.usage import check_allowance, record

            await check_allowance()
            result = await omniroute.request('/video/analyses', {
                'model': 'gemini/gemini-3.8-flash',
                'url': url,
                'question': question,
            })
            usage = result.get('provider_usage') or {}
            await record('gemini', 'gemini-3.8-flash', {
                'prompt_tokens': usage.get('input_tokens', 0),
                'completion_tokens': usage.get('output_tokens', 0),
            })
            try:
                video_tokens = int(usage.get('video_tokens') or 0)
            except (TypeError, ValueError):
                video_tokens = 0
            if not result.get('video_processed') or video_tokens <= 0 or not result.get('analysis'):
                return {
                    'success': False,
                    'url': url,
                    'error': 'Actual video frame processing was not confirmed. Do not substitute captions.',
                }
            return {
                **result,
                'success': True,
                'url': url,
                'model': 'google/gemini-3.8-flash',
                'instruction': 'Cite this video URL and relevant timestamps. Separate observed content, speech, and the video’s claims from independently verified facts.',
            }

        # Instagram links and providers without native URL video ingestion use
        # the sampled-frame and timestamped-audio path. The model call in
        # inspect_media uses the configured OmniRoute or direct OpenAI route.
        with tempfile.TemporaryDirectory(prefix='grokbot-link-video-') as root:
            async with asyncio.timeout(600):
                path, audio = await download_media(url, root, bot_id)
                result = await inspect_media(path, question, audio_path=audio)
        return {
            'success': True,
            'url': url,
            **result,
            'instruction': 'Cite this URL and timestamps. State that visuals were sampled; separate observed content, speech, and independently verified facts.',
        }
    except (ValueError, ModelCapabilityError) as error:
        return {'success': False, 'error': str(error)}
    except TimeoutError:
        return {'success': False, 'error': 'Video analysis exceeded its time limit. Try a shorter clip; no caption was used as evidence.'}
    except Exception:
        return {'success': False, 'error': 'The video could not be analyzed through the configured OmniRoute or direct OpenAI connection. No caption was substituted for its frames or speech.'}
