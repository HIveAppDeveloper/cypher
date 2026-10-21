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
    from app.services.managed_connections import public_connections
    items=catalog();urls={item['url'].rstrip('/') for item in items}
    for c in public_connections():
        if c['url'].rstrip('/') not in urls:
            items.append({'id':'managed-'+c['id'],'name':c['name'].split(' · ')[0],'url':c['url'],'description':'Connect your account with managed sign-in. Existing authorized connections are reused.','category':'Development','domains':c['domains'],'auth':'auto','source':'https://vercel.com/docs/connect'})
            urls.add(c['url'].rstrip('/'))
    return items

@router.get('/available-connections')
async def available_connections():
    from app.services.managed_connections import public_connections
    return public_connections()

class SyncInput(BaseModel):
    approval_id:str|None=Field(default=None,max_length=36)

@router.post('/catalog/sync',status_code=202)
async def sync_catalog(body:SyncInput,db:AsyncSession=Depends(get_db)):
    from app.api.device import require_device
    from app.models.plugin_sync import PluginSync
    from app.services.plugin_sync import public
    await require_device(db,body.approval_id,'connect_plugin:catalog')
    job=(await db.execute(select(PluginSync).where(PluginSync.status.in_(('pending','running'))))).scalars().first()
    if not job:
        job=PluginSync();db.add(job);await db.commit();await db.refresh(job)
    return public(job,len(await list_catalog()))

@router.get('/catalog/sync')
async def sync_status(db:AsyncSession=Depends(get_db)):
    from app.models.plugin_sync import PluginSync
    from app.services.plugin_sync import public
    job=(await db.execute(select(PluginSync).order_by(PluginSync.created_at.desc()).limit(1))).scalar_one_or_none()
    return public(job,len(await list_catalog())) if job else None

@router.post('/resolve')
async def resolve(body:Website):
    host=hostname(body.website.strip())
    matches=[item for item in await list_catalog() if host in item.get('domains',[]) or host==urlsplit(item['url']).hostname]
    if matches:
        return matches[0]
    parsed=urlsplit(body.website.strip())
    if parsed.scheme=='https' and any(part in {'mcp','sse'} for part in parsed.path.split('/')):
        try:await validate_endpoint(body.website.strip())
        except (ValueError,OSError):raise HTTPException(422,'Use a public HTTPS connector address without a token or query string.')
        return {'id':'custom','name':host,'url':body.website.strip(),'description':'Custom MCP server','category':'Custom','domains':[host]}
    try:await validate_endpoint('https://'+host)
    except ValueError:raise HTTPException(422,'Use a public company website. Private network addresses are not supported.')
    except OSError:raise HTTPException(404,'This website could not be found. Check its address and try again.')
    from app.services.website_connectors import published_connector
    published=await published_connector(host,http_client)
    if published:return published
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
                    if remote.get('type')=='streamable-http' and endpoint.startswith('https://') and not any(character in endpoint for character in '{}?') and (remote_host==host or remote_host.endswith('.'+host)):
                        return {'id':server.get('name',endpoint),'name':server.get('title') or host,'url':endpoint,'description':server.get('description','Published connector'),'category':'Custom','domains':[host],'source':'https://registry.modelcontextprotocol.io/'}
    except Exception:
        pass
    raise HTTPException(404,'We could not find a published connector for this website. Search the catalog, or use Advanced to add a server URL supplied by the company.')

class Begin(BaseModel):
    name:str=Field(min_length=1,max_length=80)
    url:str=Field(min_length=8,max_length=1000)
    approval_id:str|None=Field(default=None,max_length=36)
    reconnect:bool=False
    connection_id:str|None=Field(default=None,max_length=80)

@router.post('/authorize')
async def authorize(body:Begin,db:AsyncSession=Depends(get_db)):
    from app.api.device import require_device
    url=body.url.strip()
    try: await validate_endpoint(url)
    except (ValueError,OSError): raise HTTPException(422,'Use a public HTTPS connector URL. A company website belongs in the website lookup field.')
    await require_device(db,body.approval_id,'connect_plugin:'+url)
    from app.services import managed_connections
    config=managed_connections.configuration(url,body.connection_id)
    if body.connection_id and not config:raise HTTPException(422,'Choose an available connection for this provider.')
    existing=await managed_connections.matching_connection(db,url,config) if config else (await db.execute(select(Plugin).where(Plugin.url==url))).scalars().first()
    if existing and not body.reconnect: return {'status':'connected','plugin_id':existing.id,'name':existing.name}
    await db.execute(delete(PluginAuthorization).where(PluginAuthorization.status!='connected',PluginAuthorization.created_at<time.time()-FLOW_TTL))
    if config:return await managed_connections.begin(db,body.name.strip(),url,config,existing)
    await db.execute(delete(PluginAuthorization).where(PluginAuthorization.status!='connected',PluginAuthorization.created_at<time.time()-FLOW_TTL))
    binding=secrets.token_urlsafe(32)
    row=PluginAuthorization(name=body.name.strip(),url=url,created_at=time.time(),binding_hash=hashlib.sha256(binding.encode()).hexdigest(),status='discovering',plugin_id=existing.id if existing else None)
    db.add(row);await db.commit();await db.refresh(row)
    provider=await make_provider(db,row,CALLBACK_URL)
    try:
        tools=await discover(url,auth=provider)
    except Exception as error:
        if row.status=='awaiting_login':
            return {'status':'awaiting_login','flow_id':row.id,'authorization_url':DatabaseTokenStorage(db,row).read()['authorization_url'],'binding':binding,'name':row.name}
        row.status='failed';await db.commit()
        def rejected_redirect(error):
            return 'invalid_redirect_uri' in str(error) or any(rejected_redirect(child) for child in getattr(error,'exceptions',[])) or bool(error.__cause__ and rejected_redirect(error.__cause__))
        if rejected_redirect(error):
            raise HTTPException(422,'This provider requires approval for this app’s callback address before sign-in can work. Ask the provider to approve '+CALLBACK_URL+'. The service has not been connected.')
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

class ManagedCallback(BaseModel):
    state:str=Field(min_length=16,max_length=200)
    binding:str=Field(min_length=16,max_length=200)

@router.post('/managed/callback')
async def managed_callback(body:ManagedCallback,db:AsyncSession=Depends(get_db)):
    from app.services.managed_connections import finish
    return await finish(db,body.state,body.binding)

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

class CancelAuthorization(BaseModel):
    flow_id:UUID
    binding:str=Field(min_length=16,max_length=200)

@router.post('/oauth/cancel')
async def cancel_authorization(body:CancelAuthorization,db:AsyncSession=Depends(get_db)):
    row=(await db.execute(select(PluginAuthorization).where(PluginAuthorization.id==str(body.flow_id)).with_for_update())).scalar_one_or_none()
    if not row or not secrets.compare_digest(row.binding_hash or '',hashlib.sha256(body.binding.encode()).hexdigest()):
        raise HTTPException(400,'This sign-in request does not belong to this browser.')
    if row.status not in {'awaiting_login','discovering'}:
        raise HTTPException(409,'Sign-in is already finishing or has ended. Check Connected for the result.')
    row.status='cancelled';row.payload=None;row.state_hash=None;row.binding_hash=None;await db.commit()
    return {'status':'cancelled'}
