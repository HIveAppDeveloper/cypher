"""Opt-in cloud smoke checks, recorded once without exposing credentials."""
import asyncio
import logging
from datetime import datetime
from sqlalchemy import select
from app.db.session import AsyncSessionLocal
from app.models.runtime import RuntimeHeartbeat, RuntimeCheck
logger = logging.getLogger(__name__)

async def record(name):
    async with AsyncSessionLocal() as db:
        item = await db.get(RuntimeHeartbeat, name)
        if item: item.updated_at = datetime.utcnow()
        else: db.add(RuntimeHeartbeat(name=name, updated_at=datetime.utcnow()))
        await db.commit()

async def verify_cloud():
    async with AsyncSessionLocal() as db:
        if await db.get(RuntimeHeartbeat, 'cloud_check_finished_v3'): return
    from app.services.llm_gateway import LLMGateway
    from app.services.plugins import discover, session
    async def gateway():
        result = await LLMGateway.complete(messages=[{'role':'user','content':'Reply with exactly: Cloud model ready'}], provider='openai', model='gpt-6.1-sol', max_tokens=2048, reasoning_effort='low')
        if not result.choices[0].message.content: raise RuntimeError('Empty model reply')
    async def mcp():
        tools = await discover('https://mcp.deepwiki.com/mcp')
        if not any(t['name']=='read_wiki_structure' for t in tools): raise RuntimeError('Expected documentation tool unavailable')
        async with session('https://mcp.deepwiki.com/mcp') as client:
            result = await client.call_tool('read_wiki_structure', {'repoName':'vercel/ai'})
            if result.isError or not result.content: raise RuntimeError('MCP documentation tool failed')
        await record('mcp_tool_verified')
    for name, check in [('gateway',gateway),('mcp',mcp)]:
        try:
            async with asyncio.timeout(90): await check()
            await record(name+'_verified')
            await save_check(name,'passed',{})
            logger.info('Cloud self-check passed: %s', name)
        except Exception as error:
            await record(name+'_verification_failed')
            await save_check(name,'failed',safe_error(error))
            logger.warning('Cloud self-check failed: %s (%s)',name,type(error).__name__)
    await record('cloud_check_finished_v3')


def safe_error(error):
    import os,re
    message=str(error)
    secrets=[os.getenv('AI_GATEWAY_API_KEY',''),os.getenv('BACKEND_API_TOKEN','')]
    try:
        from vercel.oidc import get_vercel_oidc_token_sync
        secrets.append(get_vercel_oidc_token_sync())
    except Exception: pass
    for value in secrets:
        if value: message=message.replace(value,'[redacted]')
    message=re.sub(r'(?:sk-|vck_|eyJ)[A-Za-z0-9._-]{12,}','[redacted]',message)
    message=re.sub(r'https?://[^\s]+','[endpoint]',message)
    return {'type':type(error).__name__,'message':message[:1500]}

async def save_check(name,status,detail):
    async with AsyncSessionLocal() as db:
        item=await db.get(RuntimeCheck,name)
        if item:
            item.status=status; item.detail=detail; item.updated_at=datetime.utcnow()
        else: db.add(RuntimeCheck(name=name,status=status,detail=detail,updated_at=datetime.utcnow()))
        await db.commit()
