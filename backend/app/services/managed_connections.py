"""Reuse project-linked provider grants without copying provider secrets.

Endpoint bindings and installation choices come from server configuration.
User subjects always come from the authenticated tenant, never request input.
"""
import hashlib
import json
import os
import secrets
import time
from urllib.parse import urlencode
from fastapi import HTTPException
from sqlalchemy import select, delete
from app.db.tenancy import current_tenant_id
from app.models.plugin import Plugin, PluginAuthorization
from app.services.plugins import seal, reveal, discover
from app.services.plugin_auth import DatabaseTokenStorage, FLOW_TTL

REFERENCE_PREFIX='grokbot-connect:'

def installation_owner(tenant=None):
    from app.config import settings
    tenant=tenant if tenant is not None else current_tenant_id.get()
    email=settings.LEGACY_OWNER_EMAIL.strip().lower()
    owner_id='email:'+hashlib.sha256(email.encode()).hexdigest() if email else None
    return tenant=='legacy-owner' or bool(owner_id and tenant==owner_id)


def configurations():
    items=json.loads(os.getenv('GROKBOT_MANAGED_CONNECTORS','[]'))
    return items if isinstance(items,list) else []


def configuration(url,connection_id=None):
    return next((item for item in configurations() if item['url'].rstrip('/')==url.rstrip('/') and (connection_id is None or item['id']==connection_id)),None)


def public_connections():
    owner=installation_owner()
    return [{'id':c['id'],'name':c['name'],'url':c['url'],'domains':c.get('domains',[]),
             'reuse_available':owner and bool(c.get('owner_installation')),
             'method':'managed'} for c in configurations() if owner or not c.get('owner_only')]


def request_parameters(config,force_refresh=False):
    from vercel.connect import ConnectAppTokenSubject,ConnectUserTokenSubject,ConnectOptions
    from vercel.oidc import get_vercel_oidc_token
    tenant=current_tenant_id.get()
    if not tenant:raise ValueError('An authenticated workspace is required.')
    if config.get('owner_only') and not installation_owner(tenant):raise ValueError('This connection is private to its owner.')
    params={'options':ConnectOptions(vercel_token=get_vercel_oidc_token,force_refresh=force_refresh)}
    if installation_owner(tenant) and config.get('owner_installation'):
        params.update(subject=ConnectAppTokenSubject(),installation_id=config['owner_installation'])
    else:
        params['subject']=ConnectUserTokenSubject(id='grokbot:'+tenant)
    return params


async def get_access(config,force_refresh=False):
    from vercel import connect
    params=request_parameters(config,force_refresh)
    return await connect.get_token(config['connector'],**params)


async def start_consent(config,return_url):
    from vercel import connect
    result=await connect.start_authorization(config['connector'],return_url=return_url,expires_in=FLOW_TTL,**request_parameters(config))
    return str(result.url)


async def credentials(plugin):
    """Resolve a fresh token for the exact configured provider endpoint."""
    saved=reveal(plugin.credential)
    if not saved or not saved.startswith(REFERENCE_PREFIX):return False,saved
    config=configuration(plugin.url,saved.removeprefix(REFERENCE_PREFIX))
    if not config:raise ValueError('This managed connection is no longer configured.')
    return True,await get_access(config)


async def matching_connection(db,url,config):
    """Different grants for one endpoint remain separate account connections."""
    rows=(await db.execute(select(Plugin).where(Plugin.url==url))).scalars().all()
    for plugin in rows:
        saved=reveal(plugin.credential)
        if saved==REFERENCE_PREFIX+config['id']:return plugin
    return None


async def save_connection(db,row,config,access):
    tools=await discover(row.url,access)
    if not tools:raise ValueError('The provider published no tools.')
    plugin=await db.get(Plugin,row.plugin_id) if row.plugin_id else await matching_connection(db,row.url,config)
    if row.plugin_id and not plugin:raise ValueError('The connection was removed during sign-in.')
    if not plugin:
        plugin=Plugin(name=row.name,url=row.url,enabled=True);db.add(plugin)
    else:plugin.name=row.name
    enabled={tool['name']:tool.get('enabled',True) for tool in (plugin.tools or [])}
    plugin.tools=[{**tool,'enabled':enabled.get(tool['name'],True)} for tool in tools]
    plugin.credential=seal(REFERENCE_PREFIX+config['id'])
    await db.flush()
    from app.models.runtime import RuntimeCheck
    stale=await db.get(RuntimeCheck,'plugin:'+plugin.id)
    if stale:await db.delete(stale)
    await db.execute(delete(PluginAuthorization).where(PluginAuthorization.plugin_id==plugin.id,PluginAuthorization.id!=row.id))
    row.plugin_id=plugin.id;row.status='connected';row.state_hash=None;row.binding_hash=None
    row.payload=seal(json.dumps({'managed_id':config['id']}));await db.commit()
    return {'status':'connected','flow_id':row.id,'plugin_id':plugin.id,'name':plugin.name}


async def reuse_authorized(db,config):
    """A background catalog job reuses grants but never starts hidden consent."""
    from vercel.connect import UserAuthorizationRequiredError,ConnectorInstallationRequiredError,InvalidGrantError,NoValidTokenError
    try:access=await get_access(config)
    except (UserAuthorizationRequiredError,ConnectorInstallationRequiredError,InvalidGrantError,NoValidTokenError):return None
    row=PluginAuthorization(name=config['name'],url=config['url'],created_at=time.time(),status='discovering')
    db.add(row);await db.commit();await db.refresh(row)
    try:return await save_connection(db,row,config,access)
    except Exception:
        await db.rollback();row=await db.get(PluginAuthorization,row.id);row.status='failed';await db.commit();raise


async def begin(db,name,url,config,existing=None):
    from vercel.connect import UserAuthorizationRequiredError,ConnectorInstallationRequiredError,InvalidGrantError,NoValidTokenError
    binding=secrets.token_urlsafe(32)
    row=PluginAuthorization(name=name,url=url,created_at=time.time(),binding_hash=hashlib.sha256(binding.encode()).hexdigest(),status='discovering',plugin_id=existing.id if existing else None,payload=seal(json.dumps({'managed_id':config['id']})))
    db.add(row);await db.commit();await db.refresh(row)
    try:
        try:access=await get_access(config,force_refresh=True)
        except (UserAuthorizationRequiredError,ConnectorInstallationRequiredError,InvalidGrantError,NoValidTokenError):
            state=row.id+'.'+secrets.token_urlsafe(32)
            origin=os.getenv('GROKBOT_PUBLIC_URL','https://open-grokbot-hiveapp.vercel.app').rstrip('/')
            return_url=origin+'/api/plugin-oauth/callback?'+urlencode({'managed':'1','state':state})
            authorization_url=await start_consent(config,return_url)
            row.status='awaiting_login';row.state_hash=hashlib.sha256(state.encode()).hexdigest();await db.commit()
            return {'status':'awaiting_login','flow_id':row.id,'name':row.name,'authorization_url':authorization_url,'binding':binding}
        return await save_connection(db,row,config,access)
    except Exception:
        await db.rollback();row=await db.get(PluginAuthorization,row.id)
        row.status='failed';row.payload=None;await db.commit()
        raise HTTPException(502,'This provider connection could not be verified. Your existing connection was preserved; retry sign-in or check provider permissions.')


async def finish(db,state,binding):
    row=(await db.execute(select(PluginAuthorization).where(PluginAuthorization.state_hash==hashlib.sha256(state.encode()).hexdigest()).with_for_update())).scalar_one_or_none()
    if not row or row.status!='awaiting_login' or time.time()-row.created_at>FLOW_TTL or not secrets.compare_digest(row.binding_hash or '',hashlib.sha256(binding.encode()).hexdigest()):
        raise HTTPException(400,'This sign-in request expired or belongs to another browser. Start again from Plugins.')
    saved=DatabaseTokenStorage(db,row).read();config=configuration(row.url,saved.get('managed_id'))
    if not config:raise HTTPException(400,'This provider is no longer configured.')
    try:
        access=await get_access(config,force_refresh=True)
        return await save_connection(db,row,config,access)
    except Exception:
        await db.rollback();row=await db.get(PluginAuthorization,row.id)
        row.status='failed';row.state_hash=None;row.payload=None;await db.commit()
        raise HTTPException(422,'The provider returned, but account access or tool discovery failed. Reconnect to retry.')
