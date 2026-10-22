"""Opt-in cloud smoke checks, recorded once without exposing credentials."""
import asyncio
import logging
from datetime import datetime
from contextlib import suppress
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

async def verify_cloud(force=False):
    await ensure_starter_plugins()
    from app.config import settings
    finished_key = 'cloud_check_finished_omniroute_v1' if settings.OMNIROUTE_URL else 'cloud_check_finished_v7'
    async with AsyncSessionLocal() as db:
        finished = not force and await db.get(RuntimeHeartbeat, finished_key)
    if finished:
        await verify_media_cloud()
        return
    from app.services.llm_gateway import LLMGateway
    from app.services.plugins import discover, session
    async def gateway():
        result = await LLMGateway.complete(messages=[{'role':'user','content':'Reply with exactly: Cloud model ready'}], provider='openai', model='gpt-6.1-sol', max_tokens=2048, reasoning_effort='low')
        if not result.choices[0].message.content: raise RuntimeError('Empty model reply')
    async def fallback():
        result = await LLMGateway.complete(messages=[{'role':'user','content':'Reply with exactly: Cloud model ready'}], provider='openai', model='gpt-6-luna', max_tokens=512, reasoning_effort='low')
        if not result.choices[0].message.content: raise RuntimeError('Empty model reply')
    async def fleet():
        from app.services.fleet import ModelFleet
        result = await ModelFleet().consult({'specialty':'research','task':'Reply with exactly: Specialist ready'}, 'cloud-check')
        if 'findings' not in result: raise RuntimeError(str(result.get('error')))
        reply = await LLMGateway.complete(messages=[{'role':'user','content':'Summarize this specialist result in five words: '+result['findings']}], provider='openai', model='gpt-6.1-sol', max_tokens=1024, reasoning_effort='low')
        if not reply.choices[0].message.content: raise RuntimeError('Manager returned no synthesis')
    async def mcp():
        tools = await discover('https://mcp.deepwiki.com/mcp')
        if not any(t['name']=='read_wiki_structure' for t in tools): raise RuntimeError('Expected documentation tool unavailable')
        async with session('https://mcp.deepwiki.com/mcp') as client:
            result = await client.call_tool('read_wiki_structure', {'repoName':'vercel/ai'})
            if result.isError or not result.content: raise RuntimeError('MCP documentation tool failed')
        await record('mcp_tool_verified')
    async def browser():
        from app.services.tools.browser import BrowserTool
        tool = BrowserTool()
        try:
            result = await tool.navigate_to('https://example.com', session_id='cloud-verification')
            if not result.get('success') or result.get('title') != 'Example Domain':
                raise RuntimeError('Hosted browser could not read the test page')
        finally:
            await tool.close()
    async def computer():
        from uuid import uuid5, NAMESPACE_URL
        from app.services import managed_sandbox
        identity = str(uuid5(NAMESPACE_URL, 'open-grokbot/cloud-verification'))
        def execute():
            try:
                result = managed_sandbox.execute(identity, ['printf', 'Cloud computer ready'])
            except Exception:
                with suppress(Exception): managed_sandbox.stop(identity)
                raise
            managed_sandbox.stop(identity)
            if result['exit_code'] != 0 or result['output'] != 'Cloud computer ready':
                raise RuntimeError('Cloud computer command failed')
        await asyncio.to_thread(execute)
    async def run_one(name, check):
        try:
            await save_check(name,'running',{'transport':'omniroute' if settings.OMNIROUTE_URL else 'vercel' if settings.LLM_USE_GATEWAY else 'direct'})
            async with asyncio.timeout(90): await check()
            await record(name+'_verified')
            await save_check(name,'passed',{'transport':'omniroute' if settings.OMNIROUTE_URL else 'vercel' if settings.LLM_USE_GATEWAY else 'direct'} if name in {'gateway','fallback','fleet'} else {})
            logger.info('Cloud self-check passed: %s', name)
        except Exception as error:
            await record(name+'_verification_failed')
            await save_check(name,'failed',{'transport':'omniroute' if settings.OMNIROUTE_URL else 'vercel' if settings.LLM_USE_GATEWAY else 'direct',**safe_error(error)})
            logger.warning('Cloud self-check failed: %s (%s)',name,type(error).__name__)
    await asyncio.gather(*(run_one(name, check) for name, check in [('gateway',gateway),('fallback',fallback),('fleet',fleet),('mcp',mcp),('browser',browser),('computer',computer)]))
    await record(finished_key)
    await verify_media_cloud(force=force)


def safe_error(error):
    import os,re
    message=str(error)
    secrets=[os.getenv('AI_GATEWAY_API_KEY',''),os.getenv('BACKEND_API_TOKEN',''),os.getenv('OMNIROUTE_API_KEY',''),os.getenv('OMNIROUTE_PROTECTION_BYPASS','')]
    try:
        from vercel.oidc import get_vercel_oidc_token
        secrets.append(get_vercel_oidc_token())
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


async def verify_media_cloud(force=False):
    import os
    from app.config import settings
    if os.getenv('GROKBOT_VERIFY_MEDIA') != 'true': return
    finished_key = 'media_check_finished_omniroute_v1' if settings.OMNIROUTE_URL else 'media_check_finished_v1'
    transport = 'omniroute' if settings.OMNIROUTE_URL else 'vercel' if settings.LLM_USE_GATEWAY else 'direct'
    async with AsyncSessionLocal() as db:
        if not force and await db.get(RuntimeHeartbeat, finished_key): return
    from app.services.media import generate_media
    for name,kind,provider in [('media_openai','image','openai'),('media_google','image','google'),('media_video','video',None)]:
        await save_check(name,'running',{'transport':transport})
        try:
            files = await generate_media(kind, 'A single red paper boat on still water, simple studio composition, no text.', '16:9', 4, image_provider=provider)
            await save_check(name,'passed',{'transport':transport,'format':files[0]['mime'],'bytes':len(files[0]['data'])*3//4})
        except Exception as error:
            await save_check(name,'failed',{'transport':transport,**safe_error(error)})
    await record(finished_key)


async def ensure_starter_plugins():
    async with AsyncSessionLocal() as db:
        if await db.get(RuntimeHeartbeat, 'starter_plugins_finished_v1'): return
    from app.models.plugin import Plugin
    from app.services.plugins import discover
    result = []
    for name,url in [('DeepWiki','https://mcp.deepwiki.com/mcp'),('Microsoft Learn','https://learn.microsoft.com/api/mcp'),('Cloudflare Docs','https://docs.mcp.cloudflare.com/mcp')]:
        try:
            async with AsyncSessionLocal() as db:
                if (await db.execute(select(Plugin).where(Plugin.url == url))).scalars().first():
                    result.append({'name':name,'state':'existing'})
                    continue
            tools = await discover(url)
            if not tools: raise RuntimeError('No tools advertised')
            async with AsyncSessionLocal() as db:
                db.add(Plugin(name=name,url=url,tools=tools,enabled=True))
                await db.commit()
            result.append({'name':name,'state':'connected','tools':len(tools)})
        except Exception:
            result.append({'name':name,'state':'unavailable'})
    await save_check('starter_plugins','passed' if all(p['state']!='unavailable' for p in result) else 'failed',{'connections':result})
    await record('starter_plugins_finished_v1')
