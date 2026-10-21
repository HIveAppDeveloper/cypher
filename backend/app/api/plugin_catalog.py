"""Published connector discovery and durable browser authorization."""
import asyncio
import hashlib
import json
import os
import secrets
import time
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.models.plugin import Plugin, PluginAuthorization
from app.services.plugins import discover, validate_endpoint, http_client
from app.services.plugin_auth import DatabaseTokenStorage, FLOW_TTL, make_provider

router=APIRouter()
CATALOG_PATH=Path(__file__).parents[1]/'data'/'plugin_catalog.json'
PUBLIC_ORIGIN=os.getenv('GROKBOT_PUBLIC_URL','https://open-grokbot-hiveapp.vercel.app').rstrip('/')
CALLBACK_URL=PUBLIC_ORIGIN+'/api/plugin-oauth/callback'

def catalog():
    return json.loads(CATALOG_PATH.read_text()) if CATALOG_PATH.exists() else []

def hostname(value):
    parsed=urlsplit(value if '://' in value else 'https://'+value)
    if not parsed.hostname or parsed.username or parsed.password: raise HTTPException(422,'Enter a company website, such as vercel.com.')
    return parsed.hostname.lower().removeprefix('www.')

class Website(BaseModel):
    website:str=Field(min_length=3,max_length=1000)

@router.get('/catalog')
async def list_catalog():
    return catalog()

@router.post('/resolve')
async def resolve(body:Website):
    host=hostname(body.website.strip())
    matches=[item for item in catalog() if host in item.get('domains',[]) or host==urlsplit(item['url']).hostname]
    if matches:
        return matches[0]
    parsed=urlsplit(body.website.strip())
    if parsed.scheme=='https' and any(part in {'mcp','sse'} for part in parsed.path.split('/')):
        return {'id':'custom','name':host,'url':body.website.strip(),'description':'Custom MCP server','category':'Custom','domains':[host]}
    # Registry search is discovery only; accept exact publisher website/domain matches.
    try:
        async with http_client() as client:
            response=await client.get('https://registry.modelcontextprotocol.io/v0.1/servers',params={'search':host,'version':'latest','limit':50},timeout=6)
        if response.status_code==200:
            for entry in response.json().get('servers',[]):
                server=entry.get('server',{}); website=server.get('websiteUrl','')
                website_host=(urlsplit(website).hostname or '').removeprefix('www.')
                for remote in server.get('remotes',[]):
                    endpoint=remote.get('url',''); remote_host=urlsplit(endpoint).hostname or ''
                    if remote.get('type')=='streamable-http' and endpoint.startswith('https://') and not any(character in endpoint for character in '{}?') and (website_host==host or remote_host==host or remote_host in {'mcp.'+host,'api.'+host}):
                        return {'id':server.get('name',endpoint),'name':server.get('title') or host,'url':endpoint,'description':server.get('description','Published connector'),'category':'Custom','domains':[host],'source':'https://registry.modelcontextprotocol.io/'}
    except Exception:
        pass
    raise HTTPException(404,'We could not find a published connector for this website. Search the catalog, or use Advanced to add a server URL supplied by the company.')

class Begin(BaseModel):
    name:str=Field(min_length=1,max_length=80)
    url:str=Field(min_length=8,max_length=1000)
    approval_id:str|None=Field(default=None,max_length=36)
    reconnect:bool=False

@router.post('/authorize')
async def authorize(body:Begin,db:AsyncSession=Depends(get_db)):
    from app.api.device import require_device
    url=body.url.strip()
    try: await validate_endpoint(url)
    except (ValueError,OSError): raise HTTPException(422,'Use a public HTTPS connector URL. A company website belongs in the website lookup field.')
    await require_device(db,body.approval_id,'connect_plugin:'+url)
    existing=(await db.execute(select(Plugin).where(Plugin.url==url))).scalars().first()
    if existing and not body.reconnect: return {'status':'connected','plugin_id':existing.id,'name':existing.name}
    await db.execute(delete(PluginAuthorization).where(PluginAuthorization.status!='connected',PluginAuthorization.created_at<time.time()-FLOW_TTL))
    binding=secrets.token_urlsafe(32)
    row=PluginAuthorization(name=body.name.strip(),url=url,created_at=time.time(),binding_hash=hashlib.sha256(binding.encode()).hexdigest(),status='discovering',plugin_id=existing.id if existing else None)
    db.add(row);await db.commit();await db.refresh(row)
    provider=await make_provider(db,row,CALLBACK_URL)
    try:
        tools=await discover(url,auth=provider)
    except Exception:
        if row.status=='awaiting_login':
            return {'status':'awaiting_login','flow_id':row.id,'authorization_url':DatabaseTokenStorage(db,row).read()['authorization_url'],'binding':binding,'name':row.name}
        row.status='failed';await db.commit()
        raise HTTPException(422,'This service could not start automatic sign-in. It may require an API key, an administrator-installed app, or a different MCP endpoint. Your account has not been connected.')
    if not tools:
        row.status='failed';await db.commit();raise HTTPException(422,'The server connected but did not publish any tools.')
    plugin=existing or Plugin(name=row.name,url=url,tools=tools,enabled=True)
    if existing:
        old={tool['name']:tool.get('enabled',True) for tool in existing.tools}
        plugin.tools=[{**tool,'enabled':old.get(tool['name'],True)} for tool in tools]
        await db.execute(delete(PluginAuthorization).where(PluginAuthorization.plugin_id==plugin.id,PluginAuthorization.id!=row.id))
    else:db.add(plugin)
    await db.flush();row.plugin_id=plugin.id;row.status='connected';await db.commit()
    return {'status':'connected','flow_id':row.id,'plugin_id':plugin.id,'name':row.name}

class Callback(BaseModel):
    state:str=Field(min_length=16,max_length=200)
    code:str=Field(default='',max_length=4096)
    binding:str=Field(min_length=16,max_length=200)
    denied:bool=False
    issuer:str|None=Field(default=None,max_length=1000)

@router.post('/oauth/callback')
async def callback(body:Callback,db:AsyncSession=Depends(get_db)):
    row=(await db.execute(select(PluginAuthorization).where(PluginAuthorization.state_hash==hashlib.sha256(body.state.encode()).hexdigest()).with_for_update())).scalar_one_or_none()
    if not row or row.status!='awaiting_login' or time.time()-row.created_at>FLOW_TTL or not secrets.compare_digest(row.binding_hash or '',hashlib.sha256(body.binding.encode()).hexdigest()):
        raise HTTPException(400,'This sign-in link expired or belongs to a different browser. Start again from Plugins.')
    if body.denied:
        row.status='cancelled';row.payload=None;await db.commit();return {'status':'cancelled'}
    storage=DatabaseTokenStorage(db,row);saved=storage.read()
    if not body.code: raise HTTPException(400,'The service did not return a sign-in code.')
    if body.issuer and body.issuer.rstrip('/')!=(saved.get('oauth_metadata') or {}).get('issuer','').rstrip('/'):
        raise HTTPException(400,'The sign-in provider did not match the requested connection.')
    row.status='exchanging';await db.commit()
    try:
        provider=await make_provider(db,row)
        await provider._initialize()
        request=await provider._exchange_token_authorization_code(body.code,saved['verifier'])
        async with http_client() as client:
            response=await client.send(request)
        await provider._handle_token_response(response)
        tools=await discover(row.url,auth=provider)
        if not tools: raise ValueError('No tools')
        plugin=await db.get(Plugin,row.plugin_id) if row.plugin_id else None
        if row.plugin_id and not plugin:raise ValueError('The plugin was disconnected during sign-in.')
        if plugin:
            old={tool['name']:tool.get('enabled',True) for tool in plugin.tools}
            plugin.tools=[{**tool,'enabled':old.get(tool['name'],True)} for tool in tools]
            await db.execute(delete(PluginAuthorization).where(PluginAuthorization.plugin_id==plugin.id,PluginAuthorization.id!=row.id))
        else:
            plugin=Plugin(name=row.name,url=row.url,enabled=True,tools=tools);db.add(plugin)
        await db.flush()
        row.plugin_id=plugin.id;row.status='connected';row.state_hash=None;row.binding_hash=None
        clean=storage.read();clean.pop('verifier',None);clean.pop('authorization_url',None)
        from app.services.plugins import seal
        row.payload=seal(json.dumps(clean));await db.commit()
        return {'status':'connected','name':row.name,'plugin_id':plugin.id}
    except Exception:
        row.status='failed';row.state_hash=None;row.payload=None;await db.commit()
        raise HTTPException(422,'Sign-in was returned, but the connector could not be verified. Reconnect from Plugins; no connection was enabled.')

@router.get('/oauth/status/{flow_id}')
async def status(flow_id:UUID,db:AsyncSession=Depends(get_db)):
    row=await db.get(PluginAuthorization,str(flow_id))
    if not row: raise HTTPException(404,'Connection request not found.')
    state=row.status
    if state=='awaiting_login' and time.time()-row.created_at>FLOW_TTL:state='expired'
    return {'status':state,'name':row.name,'plugin_id':row.plugin_id}
