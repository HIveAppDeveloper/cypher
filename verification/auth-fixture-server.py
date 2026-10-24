"""Actual Grokbot auth routes; external delivery and JWT verification stubbed."""
import asyncio
from datetime import datetime, timedelta
import json
import os
from pathlib import Path
import socket
import sys

sys.path.insert(0, str(Path(os.environ['CREATION_REPO']) / 'backend'))
connect, connect_ex, getaddrinfo = socket.socket.connect, socket.socket.connect_ex, socket.getaddrinfo


def allowed(address):
    return not isinstance(address, tuple) or str(address[0]) in {'127.0.0.1', '::1', 'localhost'}


def local_connect(self, address):
    if not allowed(address):
        raise RuntimeError('Auth fixture blocks non-loopback egress')
    return connect(self, address)


def local_connect_ex(self, address):
    if not allowed(address):
        raise RuntimeError('Auth fixture blocks non-loopback egress')
    return connect_ex(self, address)


def local_dns(host, *args, **kwargs):
    if host not in {'127.0.0.1', '::1', 'localhost', None}:
        raise RuntimeError('Auth fixture blocks non-loopback DNS')
    return getaddrinfo(host, *args, **kwargs)


socket.socket.connect, socket.socket.connect_ex, socket.getaddrinfo = local_connect, local_connect_ex, local_dns
from fastapi import HTTPException, Request
from app.main import app
from app.api import auth
from app.db.session import Base, engine, get_db
from app.models.email_auth import EmailLoginToken
from app.models.user import User
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker
import uvicorn

sessions = async_sessionmaker(engine, expire_on_commit=False)
state = {'mode': 'unconfigured', 'outbox': [], 'emailRequests': 0, 'googleVerifications': 0, 'sendAttempts': 0}
release_delivery = asyncio.Event()
original_sender = auth.send_magic_link


async def no_external_delivery(email, raw_token):
    state['sendAttempts'] += 1
    if state['mode'] == 'unconfigured':
        # Real missing-key branch, which must fail before any network request.
        return await original_sender(email, raw_token)
    if state['mode'] == 'failure':
        raise HTTPException(503, 'Synthetic email delivery unavailable.')
    if state['mode'] == 'hold':
        await asyncio.wait_for(release_delivery.wait(), 10)
    state['outbox'].append({'email': email, 'token': raw_token})


def no_external_google(credential):
    state['googleVerifications'] += 1
    if credential == 'SYNTHETIC_GOOGLE_VALID_ACCOUNT_0000':
        return {'sub': 'synthetic-google-subject', 'email': 'synthetic-google@gmail.com', 'email_verified': True, 'name': 'Synthetic Google Owner'}
    if credential == 'SYNTHETIC_GOOGLE_CONFLICT_ACCOUNT_0':
        return {'sub': 'synthetic-conflicting-google-subject', 'email': 'existing@example.test', 'email_verified': True}
    raise HTTPException(401, 'Synthetic credential rejected.')


auth.send_magic_link, auth.verify_google_credential = no_external_delivery, no_external_google


async def dependency():
    async with sessions() as session:
        yield session


app.dependency_overrides[get_db] = dependency


@app.middleware('http')
async def observe(request, call_next):
    if request.method == 'POST' and request.url.path == '/api/auth/email/request':
        state['emailRequests'] += 1
    return await call_next(request)


@app.get('/__auth/state')
async def inspect_state():
    async with sessions() as session:
        tokens = list((await session.execute(select(EmailLoginToken))).scalars())
        users = list((await session.execute(select(User))).scalars())
    raw = {item['token'] for item in state['outbox']}
    return {'emailRequests': state['emailRequests'], 'sendAttempts': state['sendAttempts'],
            'deliveryCount': len(state['outbox']), 'googleVerifications': state['googleVerifications'],
            'tokenCount': len(tokens), 'usedTokenCount': sum(bool(token.used) for token in tokens),
            'rawTokenStored': any(token.token_hash in raw for token in tokens),
            'users': [{'id': user.id, 'email': user.email, 'googleLinked': bool(user.google_subject)} for user in users]}


@app.post('/__auth/mode/{mode}')
async def mode(mode: str):
    assert mode in {'unconfigured', 'failure', 'success', 'hold'}
    state['mode'] = mode
    release_delivery.clear()
    return {'mode': mode}


@app.post('/__auth/release')
async def release():
    release_delivery.set()
    return {'released': True}


@app.post('/__auth/age/{seconds}')
async def age(seconds: int):
    assert 0 <= seconds <= 120
    async with sessions() as session:
        for token in (await session.execute(select(EmailLoginToken))).scalars():
            token.created_at -= timedelta(seconds=seconds)
        await session.commit()
    return {'agedSeconds': seconds}


@app.get('/__auth/link')
async def synthetic_link(email: str):
    # Test-only transient control data. Never write this token to results/logs.
    return next(item for item in reversed(state['outbox']) if item['email'] == email)


@app.post('/__auth/expire')
async def expire(request: Request):
    body = await request.json()
    async with sessions() as session:
        for token in (await session.execute(select(EmailLoginToken).where(EmailLoginToken.email == body['email']))).scalars():
            token.expires_at = datetime.utcnow() - timedelta(seconds=1)
        await session.commit()
    return {'expired': True}


async def initialize():
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    async with sessions() as session:
        session.add(User(id=auth.account_id_for('existing@example.test'), email='existing@example.test'))
        await session.commit()


asyncio.run(initialize())
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.bind(('127.0.0.1', 0))
print(json.dumps({'port': sock.getsockname()[1]}), flush=True)
uvicorn.Server(uvicorn.Config(app, log_level='warning', lifespan='off')).run(sockets=[sock])
