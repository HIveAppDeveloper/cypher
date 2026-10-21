"""Discover the entire catalog with bounded concurrency and durable progress.

No OAuth grants are copied between apps. Credential mappings must explicitly
bind a server URL to its own environment variable; registry text is untrusted.
"""
import asyncio
import json
import logging
import os
from datetime import datetime
from sqlalchemy import select
from app.db.session import AsyncSessionLocal
from app.db.tenancy import current_tenant_id
from app.models.plugin import Plugin
from app.models.plugin_sync import PluginSync
from app.services.plugins import discover, seal, credential_headers, authentication_failure


def mapped_credential(url, tenant_id):
    # Credentials imported into Vercel belong to the installation owner only.
    if tenant_id != 'legacy-owner': return None
    mapping = json.loads(os.getenv('GROKBOT_PLUGIN_CREDENTIALS', '{}')).get(url)
    if not mapping: return None
    value = os.getenv(mapping['env'])
    if not value: return None
    header = mapping.get('header', 'Authorization')
    token = value if header.lower() == 'authorization' else json.dumps({header:value})
    credential_headers(token)
    return token


async def connect_entry(item, sessions=None):
    sessions=sessions or AsyncSessionLocal
    async with sessions() as db:
        existing=(await db.execute(select(Plugin).where(Plugin.url==item['url']))).scalars().first()
        if existing and (item.get('auth')!='api_key' or existing.credential):
            return {'status':'connected' if existing.enabled else 'paused','plugin_id':existing.id,'tool_count':len(existing.tools),'message':'Existing connection preserved.'}
    token = mapped_credential(item['url'], current_tenant_id.get())
    if item.get('setup_note'):
        return {'status':'setup_required','message':item['setup_note']}
    if item.get('auth')=='api_key' and not token:
        return {'status':'key_required','message':'Add this service’s API key, or link its compatible server credential.'}
    if item['url'].rstrip('/')=='https://mcp.vercel.com' and not token:
        return {'status':'setup_required','message':'Vercel requires approval of this app’s OAuth callback before account access can connect. Existing Codex credentials are specific to Codex.'}
    try:
        tools=await discover(item['url'], token)
        if not tools:return {'status':'unavailable','message':'The server published no tools.'}
    except Exception as error:
        if authentication_failure(error) or item.get('auth')=='api_key':
            return {'status':'key_required' if item.get('auth')=='api_key' else 'sign_in_required','message':'Add this service’s API key.' if item.get('auth')=='api_key' else 'Connect your account using this provider’s sign-in.'}
        return {'status':'unavailable','message':'Tool discovery failed. Check the provider endpoint and required account setup.'}
    async with sessions() as db:
        # Idempotent when a browser connection finishes during catalog discovery.
        plugin=(await db.execute(select(Plugin).where(Plugin.url==item['url']))).scalars().first()
        if not plugin:
            plugin=Plugin(name=item['name'][:80],url=item['url'],tools=tools,credential=seal(token),enabled=True)
            db.add(plugin);await db.commit();await db.refresh(plugin)
        elif token and not plugin.credential:
            plugin.credential=seal(token)
            enabled={t['name']:t.get('enabled',True) for t in plugin.tools}
            plugin.tools=[{**t,'enabled':enabled.get(t['name'],True)} for t in tools]
            await db.commit()
        return {'status':'connected' if plugin.enabled else 'paused','plugin_id':plugin.id,'tool_count':len(plugin.tools),'credential_source':'server' if token else 'public','message':'Tools discovered; execution has not been tested.'}


def public(job, total):
    results=job.results or {}
    counts={}
    for result in results.values(): counts[result['status']]=counts.get(result['status'],0)+1
    return {'id':job.id,'status':job.status,'checked':len(results),'total':total,'counts':counts,'results':results,'updated_at':job.updated_at.isoformat()+'Z'}


async def tick(sessions=None):
    sessions=sessions or AsyncSessionLocal
    from app.api.plugin_catalog import catalog
    async with sessions() as db:
        job=(await db.execute(select(PluginSync).where(PluginSync.status.in_(('pending','running'))).order_by(PluginSync.created_at).limit(1))).scalar_one_or_none()
        if not job:return False
        tenant=job.tenant_id
        remaining=[item for item in catalog() if item['id'] not in job.results]
        job.status='running' if remaining else 'completed';await db.commit()
        job_id=job.id
    token=current_tenant_id.set(tenant)
    try:
        batch=remaining[:6]
        results=await asyncio.gather(*(connect_entry(item,sessions) for item in batch),return_exceptions=True)
        async with sessions() as db:
            job=await db.get(PluginSync,job_id)
            progress=dict(job.results)
            for item,result in zip(batch,results):
                progress[item['id']]=result if isinstance(result,dict) else {'status':'unavailable','message':'Connection could not be checked. Retry the catalog sync.'}
            job.results=progress;job.updated_at=datetime.utcnow()
            if len(remaining)<=len(batch):job.status='completed'
            await db.commit()
    finally:current_tenant_id.reset(token)
    return True


async def run(stop_event, sessions=None):
    while not stop_event.is_set():
        try:active=await tick(sessions)
        except Exception:
            logging.getLogger(__name__).exception('Catalog sync will retry from saved progress')
            active=False
        try:await asyncio.wait_for(stop_event.wait(),timeout=.1 if active else 5)
        except asyncio.TimeoutError:pass
