"""Real row/advisory locks; opt in with an isolated disposable PostgreSQL URL."""
import asyncio
import os
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.models.runtime import RuntimeCheck
from app.services import provider_consent as consent, model_connections as models
from .test_model_connections import setup


@pytest.mark.asyncio
@pytest.mark.skipif(not os.getenv('GROKBOT_TEST_POSTGRES_URL'),reason='Requires disposable PostgreSQL')
async def test_concurrent_begin_and_callback_consume_one_flow_before_network_io(setup,monkeypatch):
    schema='e2e_provider_consent_'+uuid4().hex
    engine=create_async_engine(os.environ['GROKBOT_TEST_POSTGRES_URL'],connect_args={'server_settings':{'search_path':schema}})
    sessions=async_sessionmaker(engine,expire_on_commit=False)
    monkeypatch.setattr(consent,'owner',lambda:'synthetic-owner')
    monkeypatch.setattr(models,'require_owner',lambda:None)
    async def supported():return True
    monkeypatch.setattr(consent,'gateway_support',supported)
    entered=asyncio.Event();release=asyncio.Event();exchanges=[]
    async def exchange(request):
        exchanges.append(str(request.url));entered.set();await release.wait()
        return httpx.Response(200,json={'key':'sk-or-v1-'+'s'*48})
    real=httpx.AsyncClient;monkeypatch.setattr(httpx,'AsyncClient',lambda **kwargs:real(transport=httpx.MockTransport(exchange),**kwargs))
    try:
        async with engine.begin() as db:
            await db.execute(text(f'CREATE SCHEMA "{schema}"'))
            await db.run_sync(RuntimeCheck.__table__.create)
        async def begin():
            async with sessions() as db:return await consent.begin(db,'b'*43)
        choices=await asyncio.gather(begin(),begin())
        async with sessions() as db:
            rows=list((await db.execute(select(RuntimeCheck))).scalars())
            assert sorted(row.status for row in rows)==['awaiting','cancelled']
            active=next(row for row in rows if row.status=='awaiting')
            assert 'verifier_encrypted' not in next(row for row in rows if row.status=='cancelled').detail
            flow=next(item for item in choices if consent.PREFIX+item['flow_id']==active.name)
        state=parse_qs(urlsplit(flow['authorization_url']).query)['state'][0]
        async def finish():
            async with sessions() as db:return await consent.finish(db,flow['flow_id'],'b'*43,state,'synthetic-code')
        first=asyncio.create_task(finish());await asyncio.wait_for(entered.wait(),3)
        try:
            with pytest.raises(HTTPException) as overlapping:await asyncio.wait_for(begin(),3)
            assert overlapping.value.status_code==409
            with pytest.raises(HTTPException) as rejected:await asyncio.wait_for(finish(),3)
            assert rejected.value.status_code==409 and len(exchanges)==1
        finally:
            release.set()
        assert await first=={'status':'queued'}
        async with sessions() as db:
            assert (await db.get(RuntimeCheck,consent.PREFIX+flow['flow_id'])).status=='queued'
            assert (await db.get(RuntimeCheck,models.PREFIX+'openrouter')).status=='pending'
    finally:
        release.set()
        async with engine.begin() as db:await db.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        await engine.dispose()
