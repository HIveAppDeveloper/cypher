"""Loopback fixture: actual Grokbot app and middleware, model stream replaced only."""
import asyncio
import json
import os
import re
import socket
import sys
from pathlib import Path

ROOT = Path(os.environ.get('WIRE_TEST_WORKSPACE', Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(ROOT / 'open-grokbot/backend'))
os.environ.update({
    'LITELLM_LOCAL_MODEL_COST_MAP': 'True',
    'GROKBOT_DATABASE_URL': 'sqlite+aiosqlite://',
    'RUN_EMBEDDED_WORKER': 'false',
    'GROKBOT_ATLAS_ENGINE_ENABLED': 'true',
    'ATLAS_ENGINE_SIGNING_KEY': 'synthetic-engine-signing-key-0000000000000000',
    'GROKBOT_ATLAS_ENGINE_PROVIDER': 'gemini',
    'GROKBOT_ATLAS_ENGINE_MODEL': 'gemini-3.8-flash',
    'BACKEND_API_TOKEN': 'synthetic-backend-proxy-token',
    'REQUIRE_USER_AUTH': 'true',
})
# Prevent accidental egress even if a future fixture unexpectedly starts a provider call.
connect = socket.socket.connect
connect_ex = socket.socket.connect_ex
getaddrinfo = socket.getaddrinfo
def loopback_address(address):
    return not isinstance(address, tuple) or str(address[0]) in {'127.0.0.1', '::1', 'localhost'}
def loopback_connect(self, address):
    if not loopback_address(address):
        raise RuntimeError('Wire verification blocks non-loopback egress')
    return connect(self, address)
def loopback_connect_ex(self, address):
    if not loopback_address(address):
        raise RuntimeError('Wire verification blocks non-loopback egress')
    return connect_ex(self, address)
def loopback_getaddrinfo(host, *args, **kwargs):
    if host not in {'127.0.0.1', '::1', 'localhost', None}:
        raise RuntimeError('Wire verification blocks non-loopback DNS')
    return getaddrinfo(host, *args, **kwargs)
socket.socket.connect = loopback_connect
socket.socket.connect_ex = loopback_connect_ex
socket.getaddrinfo = loopback_getaddrinfo

from app.services.llm_gateway import LLMGateway
from app.db.tenancy import current_tenant_id
from app.main import app
import uvicorn

state = {'calls': [], 'closed': 0}

async def fake_stream(messages, tools=None, provider=None, model=None, **options):
    user = '\n'.join(message.get('content') or '' for message in messages if message.get('role') == 'user')
    state['calls'].append({'tenant': current_tenant_id.get(), 'provider': provider, 'model': model, 'maxTokens': options.get('max_tokens'), 'toolCount': len(tools or []), 'mode': 'slow' if 'fixture:slow' in user else 'error' if 'fixture:provider-error' in user else 'normal'})
    try:
        if 'fixture:provider-error' in user:
            raise RuntimeError('SYNTHETIC_PROVIDER_SECRET_MUST_NOT_LEAK')
        if 'fixture:slow' in user:
            yield {'choices': [{'delta': {'content': 'Partial synthetic answer '}, 'finish_reason': None}]}
            await asyncio.sleep(10)
        if 'fixture:tools' in user:
            name = tools[0]['function']['name']
            yield {'choices': [{'delta': {'tool_calls': [{'index': 0, 'id': 'fixture-call-1', 'function': {'name': name, 'arguments': '{"query":'}}]}, 'finish_reason': None}]}
            yield {'choices': [{'delta': {'tool_calls': [{'index': 0, 'function': {'arguments': '"synthetic"}'}}]}, 'finish_reason': 'tool_calls'}]}
            return
        ids = list(dict.fromkeys(re.findall(r'"id"\s*:\s*"(s\d+)"', user)))
        if ids:
            selected = ['s999'] if 'fixture:ranking-injection' in user else list(reversed(ids))
            answer = json.dumps({'sourceIds': selected}, ensure_ascii=False, separators=(',', ':'))
        else:
            answer = 'Synthetic answer ✓ — café'
        # Fragment Unicode and the JSON answer at the model delta boundary.
        for text in [answer[:5], answer[5:17], answer[17:]]:
            if text:
                yield {'choices': [{'delta': {'content': text}, 'finish_reason': None}]}
        yield {'choices': [{'delta': {}, 'finish_reason': 'stop'}]}
    finally:
        state['closed'] += 1

LLMGateway.stream = staticmethod(fake_stream)

@app.get('/__fixture/state')
async def fixture_state():
    from app.api.atlas_engine import admission
    return {**state, 'active': sum(admission.active.values())}

sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.bind(('127.0.0.1', 0))
print(json.dumps({'port': sock.getsockname()[1]}), flush=True)
uvicorn.Server(uvicorn.Config(app, log_level='warning', lifespan='off')).run(sockets=[sock])
