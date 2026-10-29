"""Meta's documented Model API, using only an explicitly verified owner token.

This adapter never uses Meta social grants, a browser login, a public Llama
route, ambient OpenAI keys, or a configurable third-party endpoint.
"""
import asyncio
import json

import httpx
from litellm import ModelResponse
from litellm.types.utils import ModelResponseStream

from app.services.model_routing import ModelCapabilityError, ModelConfigurationError

MODEL = 'muse-spark-1.3'
PUBLIC_MODEL = 'muse/'+MODEL
ENDPOINT = 'https://api.meta.ai/v1/chat/completions'
MAX_RESPONSE_BYTES = 2_000_000


class MuseError(RuntimeError):
    def __init__(self, status):
        self.status_code = status
        super().__init__(f'Meta Muse request failed (HTTP {status}).')


def require_token(key):
    if not isinstance(key, str) or not 20 <= len(key) <= 1000 or any(c.isspace() or ord(c) < 32 for c in key):
        raise ModelConfigurationError('Connect Meta Muse with your Model API token in Model access first.')


def validate(messages, model):
    if model != MODEL:
        raise ModelConfigurationError('Choose the supported Muse Spark 1.3 model.')
    if any(isinstance(m.get('content'), list) and any(not isinstance(p, dict) or p.get('type') != 'text' or not isinstance(p.get('text'), str) for p in m['content']) for m in messages):
        raise ModelCapabilityError('This Muse connection supports text and function tools. Choose another model for image, audio, video or PDF input; your files are preserved.')
    history(messages)


def history(messages):
    """Replay visible conversation and tool IDs without SDK-only response fields."""
    result = []
    for message in messages:
        role, content = message.get('role'), message.get('content')
        if role not in {'system', 'developer', 'user', 'assistant', 'tool'} or not (content is None or isinstance(content, (str, list))):
            raise ModelCapabilityError('Muse requires text messages and function tool results.')
        item = {'role': role, 'content': content}
        if role == 'assistant' and message.get('tool_calls'):
            calls = []
            try:
                for call in message['tool_calls']:
                    function = call['function']
                    if call.get('type') != 'function' or not all(isinstance(v, str) and v for v in (call['id'], function['name'], function['arguments'])):
                        raise ValueError()
                    calls.append({'id':call['id'], 'type':'function', 'function':{'name':function['name'], 'arguments':function['arguments']}})
            except (KeyError, TypeError, ValueError):
                raise ModelCapabilityError('Muse requires function calls with their original IDs and arguments.') from None
            item['tool_calls'] = calls
        if role == 'tool':
            if not message.get('tool_call_id'):
                raise ModelCapabilityError('Muse requires the matching function call ID for each tool result.')
            item['tool_call_id'] = message['tool_call_id']
        result.append(item)
    return result


def verified_token(records):
    """A queued replacement must never displace the last verified token."""
    from app.services.plugins import reveal
    row = next((r for r in records if r.name == 'model_connection:muse'), None)
    detail = row.detail or {} if row else {}
    encrypted = detail.get('credentials_encrypted') if detail.get('state') == 'ready' else None
    if row and row.status in {'pending', 'running'}:
        if detail.get('previous_key_state') == 'ready':
            encrypted = detail.get('previous_credentials_encrypted')
        elif detail.get('action') == 'check' and detail.get('verified_key') is True:
            encrypted = detail.get('credentials_encrypted')
    try:
        return reveal(encrypted) if encrypted else None
    except Exception:
        return None


def payload(messages, tools, model, generation, *, stream=False):
    validate(messages, model)
    # Translate only documented controls. Do not forward transport options or
    # unknown SDK fields to the provider.
    count = generation.get('max_completion_tokens', generation.get('max_tokens', 2048))
    if type(count) is not int or not 1 <= count <= 8192:
        raise ModelConfigurationError('Use a Muse output limit between 1 and 8192 tokens.')
    effort = generation.get('reasoning_effort') or 'low'
    effort = {'none': 'minimal', 'max': 'xhigh'}.get(effort, effort)
    if effort not in {'minimal', 'low', 'medium', 'high', 'xhigh'}:
        raise ModelConfigurationError('Choose a supported Muse thinking effort.')
    result = {'model': model, 'messages': history(messages), 'max_completion_tokens': count,
              'reasoning_effort': effort, 'stream': stream}
    if tools:
        if any(t.get('type') != 'function' for t in tools):
            raise ModelCapabilityError('Muse supports function tools on this connection.')
        result['tools'] = tools
    if generation.get('temperature') is not None:
        result['temperature'] = generation['temperature']
    return result


def _body(data, *, stream=False):
    if not isinstance(data, dict) or data.get('error') or data.get('model') != MODEL:
        raise MuseError(502)
    choices = data.get('choices')
    if not isinstance(choices, list) or len(choices) > 1 or any(not isinstance(c, dict) for c in choices) or (not choices and not (stream and data.get('usage'))):
        raise MuseError(502)
    if not stream:
        message = choices[0].get('message') or {}
        if not isinstance(message, dict) or message.get('role') != 'assistant' or not choices[0].get('finish_reason') or not (isinstance(message.get('content'), str) and message['content'].strip() or message.get('tool_calls')):
            raise MuseError(502)
    try:
        return ModelResponseStream(**data) if stream else ModelResponse(**data)
    except (ValueError, TypeError):
        raise MuseError(502) from None


async def complete(messages, tools, model, generation, api_key):
    require_token(api_key)
    body = payload(messages, tools, model, generation)
    try:
        async with asyncio.timeout(110), httpx.AsyncClient(timeout=110, follow_redirects=False) as client:
            async with client.stream('POST', ENDPOINT, headers={'Authorization': 'Bearer '+api_key}, json=body) as response:
                if response.status_code != 200:
                    raise MuseError(response.status_code)
                parts, size = [], 0
                async for part in response.aiter_bytes():
                    size += len(part)
                    if size > MAX_RESPONSE_BYTES:
                        raise MuseError(502)
                    parts.append(part)
        return _body(json.loads(b''.join(parts)))
    except (httpx.TimeoutException, TimeoutError):
        raise MuseError(504) from None
    except httpx.RequestError:
        raise MuseError(503) from None
    except (ValueError, TypeError):
        raise MuseError(502) from None


async def stream(messages, tools, model, generation, api_key):
    require_token(api_key)
    body = payload(messages, tools, model, generation, stream=True)
    try:
        async with asyncio.timeout(110), httpx.AsyncClient(timeout=110, follow_redirects=False) as client:
            async with client.stream('POST', ENDPOINT, headers={'Authorization': 'Bearer '+api_key, 'Accept': 'text/event-stream'}, json=body) as response:
                if response.status_code != 200:
                    raise MuseError(response.status_code)
                finished = False
                async for line in response.aiter_lines():
                    if len(line) > MAX_RESPONSE_BYTES:
                        raise MuseError(502)
                    if not line.startswith('data:'):
                        continue
                    value = line[5:].strip()
                    if value == '[DONE]':
                        if not finished:
                            raise MuseError(502)
                        return
                    item = _body(json.loads(value), stream=True)
                    finished |= any(choice.finish_reason is not None for choice in item.choices)
                    yield item
                if not finished:
                    raise MuseError(502)
    except (httpx.TimeoutException, TimeoutError):
        raise MuseError(504) from None
    except httpx.RequestError:
        raise MuseError(503) from None
    except (ValueError, TypeError):
        raise MuseError(502) from None
