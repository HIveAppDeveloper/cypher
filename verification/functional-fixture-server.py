"""Real local API/database/worker; only provider output and maintenance are fixtures.

The launcher supplies a temporary database and explicitly synthetic service auth.
This file is never imported by a hosted application.
"""
import asyncio
from contextlib import asynccontextmanager, suppress
import json
import os
from pathlib import Path
import socket
import sys
import time
from types import SimpleNamespace

ROOT = Path(os.environ['FUNCTIONAL_REPO'])
sys.path.insert(0, str(ROOT / 'backend'))

# Defense in depth: neither provider SDKs nor a future fixture regression may
# contact a non-loopback destination, even if an inherited setting is missed.
connect, connect_ex, getaddrinfo = socket.socket.connect, socket.socket.connect_ex, socket.getaddrinfo


def local(address):
    return not isinstance(address, tuple) or str(address[0]) in {'127.0.0.1', '::1', 'localhost'}


def local_connect(self, address):
    if not local(address):
        raise RuntimeError('Functional fixture blocks non-loopback egress')
    return connect(self, address)


def local_connect_ex(self, address):
    if not local(address):
        raise RuntimeError('Functional fixture blocks non-loopback egress')
    return connect_ex(self, address)


def local_dns(host, *args, **kwargs):
    if host not in {'127.0.0.1', '::1', 'localhost', None}:
        raise RuntimeError('Functional fixture blocks non-loopback DNS')
    return getaddrinfo(host, *args, **kwargs)


socket.socket.connect, socket.socket.connect_ex, socket.getaddrinfo = local_connect, local_connect_ex, local_dns

from app.config import settings
from app.db.bootstrap import initialize_database
from app.db.session import AsyncSessionLocal, engine
from app.db.tenancy import current_tenant_id
from app.main import app
from app.models.bot import Bot
from app.models.conversation import Conversation
from app.models.execution import TaskExecution
from app.models.message import Message
from app.models.task import Task
from app.services import automation, computer, model_routing, plugin_sync, verification, worker, workspace
from app.services.llm_gateway import LLMGateway
from app.services.memory import MemoryManager
from sqlalchemy import select
import uvicorn

state = {'posts': [], 'calls': [], 'active': 0, 'providerCancelled': 0, 'startedAt': time.monotonic()}
hold = asyncio.Event()


async def no_actions(*args, **kwargs):
    return None


async def local_catalog(stop_event, *args, **kwargs):
    await stop_event.wait()


async def forbidden_cloud(*args, **kwargs):
    raise AssertionError('Functional fixtures cannot run cloud/model/catalog verification')


class SyntheticAuthFailure(RuntimeError):
    status_code = 401


async def completion(**kwargs):
    assert not kwargs.get('tools'), 'Functional audit must keep tools disabled'
    content = next((message['content'] for message in reversed(kwargs['messages']) if message['role'] == 'user'), '')
    assert isinstance(content, str), 'Functional chat uses only synthetic text'
    mode = 'hold' if 'fixture:hold' in content else 'auth-error' if 'fixture:auth-error' in content else 'reply'
    state['calls'].append({'tenant': current_tenant_id.get(), 'provider': kwargs.get('provider'),
                           'model': kwargs.get('model'), 'text': content, 'mode': mode})
    state['active'] += 1
    try:
        if mode == 'hold':
            try:
                await hold.wait()
            except asyncio.CancelledError:
                state['providerCancelled'] += 1
                raise
        if mode == 'auth-error':
            raise SyntheticAuthFailure('SYNTHETIC_PROVIDER_BODY_MUST_NOT_REACH_UI')
        text = 'Controlled local response: ' + content
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text, tool_calls=None))])
    finally:
        state['active'] -= 1


LLMGateway.complete = staticmethod(completion)
MemoryManager._get_redis = no_actions
computer.tick_commands = no_actions
automation.tick_goals = no_actions
automation.tick_deliveries = no_actions
workspace.tick_routines = no_actions
plugin_sync.run = local_catalog
verification.verify_cloud = forbidden_cloud
model_routing.gateway_catalog = forbidden_cloud
worker.POLL_SECONDS = .02
settings.REDIS_URL = None


@app.middleware('http')
async def observe(request, call_next):
    record = None
    if request.method == 'POST' and request.url.path.startswith('/api/'):
        try:
            body = await request.json()
        except json.JSONDecodeError:
            body = None
        record = {'path': request.url.path, 'tenant': request.headers.get('x-grokbot-user-id'),
                  'body': body, 'atMs': round((time.monotonic() - state['startedAt']) * 1000)}
        state['posts'].append(record)
    response = await call_next(request)
    if record is not None:
        record['status'] = response.status_code
    return response


@app.get('/__functional/state')
async def inspect_state():
    async with AsyncSessionLocal() as db:
        bots = list((await db.execute(select(Bot))).scalars())
        rooms = list((await db.execute(select(Conversation))).scalars())
        tasks = list((await db.execute(select(Task))).scalars())
        messages = list((await db.execute(select(Message))).scalars())
        executions = list((await db.execute(select(TaskExecution))).scalars())
    return {k: v for k, v in state.items() if k != 'startedAt'} | {
        'bots': [{'id': b.id, 'tenant': b.tenant_id, 'name': b.name, 'status': b.status} for b in bots],
        'rooms': [{'id': r.id, 'tenant': r.tenant_id, 'title': r.title} for r in rooms],
        'tasks': [{'id': t.id, 'tenant': t.tenant_id, 'conversation': t.conversation_id,
                   'status': t.status, 'description': t.description} for t in tasks],
        'messages': [{'id': m.id, 'tenant': m.tenant_id, 'conversation': m.conversation_id,
                      'sender': m.sender_type, 'content': m.content} for m in messages],
        'executions': [{'task': e.task_id, 'attempts': e.attempts, 'recoveries': e.recoveries} for e in executions],
    }


@asynccontextmanager
async def lifespan(application):
    await initialize_database(engine)
    application.state.database_ready = True
    stopped = asyncio.Event()
    runner = asyncio.create_task(worker.run_worker(stopped))
    try:
        yield
    finally:
        stopped.set()
        runner.cancel()
        with suppress(asyncio.CancelledError):
            await runner
        await engine.dispose()


app.router.lifespan_context = lifespan
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.bind(('127.0.0.1', 0))
print(json.dumps({'port': sock.getsockname()[1]}), flush=True)
uvicorn.Server(uvicorn.Config(app, log_level='warning', lifespan='on')).run(sockets=[sock])
