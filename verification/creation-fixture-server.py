"""Actual app/auth/proxy target with temporary SQLite and no lifespan or models."""
import asyncio
import importlib.abc
import importlib.util
import json
import os
from pathlib import Path
import socket
import sys

ROOT = Path(os.environ['CREATION_REPO'])
sys.path.insert(0, str(ROOT / 'backend'))
connect, connect_ex, getaddrinfo = socket.socket.connect, socket.socket.connect_ex, socket.getaddrinfo


def local(address):
    return not isinstance(address, tuple) or str(address[0]) in {'127.0.0.1', '::1', 'localhost'}


def local_connect(self, address):
    if not local(address):
        raise RuntimeError('Creation fixture blocks non-loopback socket egress')
    return connect(self, address)


def local_connect_ex(self, address):
    if not local(address):
        raise RuntimeError('Creation fixture blocks non-loopback socket egress')
    return connect_ex(self, address)


def local_dns(host, *args, **kwargs):
    if host not in {'127.0.0.1', '::1', 'localhost', None}:
        raise RuntimeError('Creation fixture blocks non-loopback DNS')
    return getaddrinfo(host, *args, **kwargs)


socket.socket.connect, socket.socket.connect_ex, socket.getaddrinfo = local_connect, local_connect_ex, local_dns

# Only these two creation modules differ between comparisons. All middleware,
# session plumbing and other API modules come from the same current checkout.
class CreationModules(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        overrides = os.environ.get('CREATION_BASELINE_MODULES')
        if overrides and fullname in {'app.schemas.bot', 'app.api.bots'}:
            source = Path(overrides) / (fullname.replace('.', '/') + '.py')
            return importlib.util.spec_from_file_location(fullname, source)
        return None


sys.meta_path.insert(0, CreationModules())
from app.main import app
from app.db.session import Base, engine, get_db
from app.models.bot import Bot
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
import uvicorn

state = {'posts': [], 'race_remaining': 0}
race_ready = asyncio.Event()


class ControlledSession(AsyncSession):
    async def execute(self, statement, *args, **kwargs):
        result = await super().execute(statement, *args, **kwargs)
        descriptions = getattr(statement, 'column_descriptions', [])
        name_read = any(item.get('entity') is Bot and item.get('name') == 'name' for item in descriptions)
        if name_read and state['race_remaining']:
            # A deterministic interleaving: each real SQLite SELECT finishes
            # before any of these requests inserts. No DB results are mocked.
            state['race_remaining'] -= 1
            if not state['race_remaining']:
                race_ready.set()
            await asyncio.wait_for(race_ready.wait(), 10)
        return result


sessions = async_sessionmaker(engine, class_=ControlledSession, expire_on_commit=False)


async def dependency():
    async with sessions() as session:
        yield session


app.dependency_overrides[get_db] = dependency


@app.middleware('http')
async def observe_creation(request, call_next):
    record = None
    if request.method == 'POST' and request.url.path == '/api/bots':
        record = {'tenant': request.headers.get('x-grokbot-user-id'), 'body': await request.json()}
        state['posts'].append(record)
    response = await call_next(request)
    if record is not None:
        record['status'] = response.status_code
    return response


@app.get('/__creation/state')
async def fixture_state():
    async with sessions() as session:
        rows = list((await session.execute(select(Bot))).scalars())
    return {'posts': state['posts'], 'bots': [{'id': row.id, 'name': row.name, 'tenant': row.tenant_id, 'status': row.status} for row in rows]}


@app.post('/__creation/race/{count}')
async def arm_race(count: int):
    if count < 2 or count > 8:
        raise ValueError('Only a small fixture barrier is supported')
    state['race_remaining'] = count
    race_ready.clear()
    return {'armed': count}


async def initialize():
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)


asyncio.run(initialize())
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.bind(('127.0.0.1', 0))
print(json.dumps({'port': sock.getsockname()[1]}), flush=True)
uvicorn.Server(uvicorn.Config(app, log_level='warning', lifespan='off')).run(sockets=[sock])
