from uuid import UUID
from typing import Literal
from cryptography.fernet import InvalidToken
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.models.plugin import Plugin, PluginAuthorization
from app.services.plugins import discover, seal

router = APIRouter()
class ConnectPlugin(BaseModel):
    approval_id: str | None = Field(default=None,max_length=36)
    name: str = Field(min_length=1, max_length=80)
    url: str = Field(min_length=8, max_length=1000)
    token: str = Field(default='', max_length=4096)
    auth_header: str = Field(default='Authorization',pattern=r'^[A-Za-z][A-Za-z0-9-]{0,63}$')
class TogglePlugin(BaseModel):
    enabled: bool
class MetaSocialAuthorization(BaseModel):
    service: Literal['facebook_organic','instagram']

@router.post('/{id}/meta/inspect')
async def inspect_meta_permissions(id:UUID,response:Response,db:AsyncSession=Depends(get_db)):
    from app.services.meta_social import connection_details
    response.headers['Cache-Control']='private, no-store'
    response.headers['Referrer-Policy']='no-referrer'
    return await connection_details(db,await db.get(Plugin,str(id)))

@router.post('/{id}/meta/authorize')
async def authorize_meta_permissions(id:UUID,body:MetaSocialAuthorization,response:Response,db:AsyncSession=Depends(get_db)):
    from app.services.meta_social import connection_details
    response.headers['Cache-Control']='private, no-store'
    response.headers['Referrer-Policy']='no-referrer'
    return await connection_details(db,await db.get(Plugin,str(id)),body.service)

def public(plugin):
    from app.services.plugins import reveal
    from app.services.managed_connections import REFERENCE_PREFIX
    damaged=False
    try:saved=reveal(plugin.credential) if plugin.credential else ''
    except (InvalidToken, ValueError):saved='';damaged=True
    connection_id=saved.removeprefix(REFERENCE_PREFIX) if saved and saved.startswith(REFERENCE_PREFIX) else None
    return {'id': plugin.id, 'connection_id':connection_id, 'provider':'google' if saved=='grokbot-google-workspace' else None, 'name': plugin.name, 'url': plugin.url, 'enabled': plugin.enabled, 'authenticated': bool(saved), 'connection_state':'sign_in_required' if damaged else 'paused' if not plugin.enabled else 'saved' if saved else 'public', 'tools': [{'name': t['name'], 'description': t.get('description',''), 'enabled':t.get('enabled',True)} for t in (plugin.tools or [])]}

@router.get('')
async def list_plugins(db: AsyncSession = Depends(get_db)):
    from app.models.runtime import RuntimeCheck
    from app.services.plugin_auth import DatabaseTokenStorage
    authenticated=set();damaged=set()
    for authorization in (await db.execute(select(PluginAuthorization).where(PluginAuthorization.status=='connected',PluginAuthorization.payload.is_not(None)))).scalars():
        try:
            saved=DatabaseTokenStorage(db,authorization).read()
            if saved.get('tokens') or saved.get('access_token') or saved.get('managed_id'):
                authenticated.add(authorization.plugin_id)
            else:damaged.add(authorization.plugin_id)
        except (InvalidToken, ValueError, AttributeError, TypeError):
            damaged.add(authorization.plugin_id)
    saved_plugins=(await db.execute(select(Plugin))).scalars().all()
    check_names=['plugin:'+plugin.id for plugin in saved_plugins]
    checks={check.name:check for check in (await db.execute(select(RuntimeCheck).where(RuntimeCheck.name.in_(check_names)))).scalars()} if check_names else {}
    output=[]
    for plugin in saved_plugins:
        item=public(plugin);item['authenticated']=item['authenticated'] or plugin.id in authenticated
        if plugin.id in damaged:item['connection_state']='sign_in_required'
        elif plugin.id in authenticated and plugin.enabled and item['connection_state']!='sign_in_required':item['connection_state']='saved'
        check=checks.get('plugin:'+plugin.id)
        item['verification']={'status':check.status,'detail':check.detail,'checked_at':check.updated_at.isoformat()+'Z'} if check else {'status':'not_tested'}
        if item['connection_state']=='sign_in_required':
            item['authenticated']=False
            item['verification']={'status':'failed','detail':{'code':'sign_in_required','message':'This saved connection needs sign-in again. Reconnect it in Plugins.'}}
        output.append(item)
    return output

@router.post('')
async def connect(data: ConnectPlugin, db: AsyncSession = Depends(get_db)):
    if data.auth_header.strip().lower() == 'cookie':
        raise HTTPException(status_code=422, detail='Browser session cookies cannot be used as API keys. Use provider sign-in or a provider-issued API token.')
    from app.api.device import require_device
    await require_device(db,data.approval_id,'connect_plugin:'+data.url.strip())
    try:
        import json
        from app.services.plugins import credential_headers
        token=data.token.strip()
        saved_token=token if data.auth_header.lower()=='authorization' else json.dumps({data.auth_header:token}) if token else ''
        credential_headers(saved_token)
        credential = seal(saved_token)
    except ValueError as error:
        raise HTTPException(status_code=503, detail=str(error))
    try:
        tools = await discover(data.url.strip(), saved_token or None)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error))
    except Exception:
        raise HTTPException(status_code=502, detail='Could not connect to this MCP server. Check its HTTPS endpoint and bearer token.')
    if not tools:
        raise HTTPException(status_code=422, detail='This MCP server did not advertise any tools.')
    plugin=(await db.execute(select(Plugin).where(Plugin.url==data.url.strip()).with_for_update())).scalars().first()
    if plugin:
        from sqlalchemy import delete
        enabled={t['name']:t.get('enabled',True) for t in plugin.tools}
        plugin.name=data.name.strip();plugin.credential=credential;plugin.enabled=True
        plugin.tools=[{**t,'enabled':enabled.get(t['name'],True)} for t in tools]
        await db.execute(delete(PluginAuthorization).where(PluginAuthorization.plugin_id==plugin.id))
    else:
        plugin=Plugin(name=data.name.strip(),url=data.url.strip(),credential=credential,tools=tools,enabled=True)
        db.add(plugin)
    await db.flush()
    from app.models.runtime import RuntimeCheck
    stale=await db.get(RuntimeCheck,'plugin:'+plugin.id)
    if stale:await db.delete(stale)
    await db.commit();await db.refresh(plugin)
    return public(plugin)

@router.patch('/{id}')
async def toggle(id: UUID, data: TogglePlugin, db: AsyncSession = Depends(get_db)):
    plugin = await db.get(Plugin, str(id))
    if not plugin: raise HTTPException(status_code=404, detail='Plugin not found')
    plugin.enabled = data.enabled
    await db.commit()
    return public(plugin)

@router.delete('/{id}')
async def disconnect(id: UUID, db: AsyncSession = Depends(get_db)):
    plugin = await db.get(Plugin, str(id))
    if plugin:
        from app.services.plugins import is_google_workspace
        if is_google_workspace(plugin):
            from app.api.google_workspace import disconnect as disconnect_google
            return await disconnect_google(db)
        from sqlalchemy import delete
        await db.execute(delete(PluginAuthorization).where(PluginAuthorization.plugin_id==str(id)))
        await db.delete(plugin); await db.commit()
    return {'status': 'disconnected'}

async def connection_snapshot(db,plugin):
    authorizations=select(PluginAuthorization.id).where(PluginAuthorization.plugin_id==plugin.id,PluginAuthorization.status=='connected')
    return plugin.url,plugin.credential,frozenset((await db.execute(authorizations)).scalars())


async def lock_current_connection(db,id,snapshot):
    # Never hold a row lock during provider I/O. Recheck identity and tool
    # choices afterwards; ordinary token refresh retains its authorization ID.
    plugin=(await db.execute(select(Plugin).where(Plugin.id==str(id)).with_for_update().execution_options(populate_existing=True))).scalar_one_or_none()
    if not plugin:raise HTTPException(404,'Plugin not found')
    if await connection_snapshot(db,plugin)!=snapshot:
        raise HTTPException(409,'This connection changed while the request was running. Retry it.')
    return plugin


@router.post('/{id}/refresh')
async def refresh_tools(id:UUID,db:AsyncSession=Depends(get_db)):
    plugin=await db.get(Plugin,str(id))
    if not plugin:raise HTTPException(404,'Plugin not found')
    snapshot=await connection_snapshot(db,plugin)
    from app.services import google_workspace as google
    from app.services.plugins import is_google_workspace
    if is_google_workspace(plugin):
        row=await google.grant(db)
        if not row:raise HTTPException(401,'Reconnect Google to refresh its tools.')
        allowed=google.allowed_tools(google.DatabaseTokenStorage(db,row).read())
        tools=[{k:t[k] for k in ('name','description','schema','read_only')} for t in allowed]
    else:
        from app.services.plugins import connection_auth
        try:
            token,auth=await connection_auth(db,plugin)
            tools=await discover(plugin.url,token,auth=auth)
        except Exception as error:
            from app.services.plugins import authentication_failure
            if authentication_failure(error):raise HTTPException(401,'This saved connection needs sign-in again. Reconnect it in Plugins.') from None
            raise HTTPException(502,'Could not refresh tools. The saved connection was preserved.') from None
    plugin=await lock_current_connection(db,id,snapshot)
    previous={t['name']:t.get('enabled',True) for t in plugin.tools}
    plugin.tools=[{**t,'enabled':previous.get(t['name'],True)} for t in tools]
    from app.models.runtime import RuntimeCheck
    stale=await db.get(RuntimeCheck,'plugin:'+plugin.id)
    if stale:await db.delete(stale)
    await db.commit();return public(plugin)

@router.patch('/{id}/tools/{tool_name}')
async def tool_state(id:UUID,tool_name:str,data:TogglePlugin,db:AsyncSession=Depends(get_db)):
    plugin=(await db.execute(select(Plugin).where(Plugin.id==str(id)).with_for_update())).scalar_one_or_none()
    if not plugin:raise HTTPException(404,'Plugin not found')
    if not any(t['name']==tool_name for t in plugin.tools):raise HTTPException(404,'Tool not found')
    plugin.tools=[{**t,'enabled':data.enabled} if t['name']==tool_name else t for t in plugin.tools]
    await db.commit();return public(plugin)


class AccountSetup(BaseModel):
    name:str=Field(min_length=1,max_length=80)
    signup_url:str=Field(min_length=8,max_length=1000)
    email:str=Field(min_length=3,max_length=254,pattern=r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
    approval_id:str|None=Field(default=None,max_length=36)
@router.post('/account-setup',status_code=202)
async def account_setup(body:AccountSetup,db:AsyncSession=Depends(get_db)):
    from app.api.device import require_device
    from app.services.plugins import validate_endpoint
    from app.api.teams import default_team
    from app.api.messages import send_message
    from app.schemas.message import MessageCreate
    await require_device(db,body.approval_id,'setup_account:'+body.signup_url.strip())
    try:await validate_endpoint(body.signup_url.strip())
    except ValueError as e:raise HTTPException(422,str(e))
    room=await default_team(db)
    prompt=(f'Set up my account for {body.name} at {body.signup_url} using my authorized email {body.email}. '
            'Use available browser tools and real authorized identity only. Check the actual signup flow. '
            'Do not invent profile information, accept paid plans, bypass CAPTCHA, or claim OAuth consent or email verification without completing it. '
            'Do not put passwords or tokens in chat, tool arguments, or memory. Prefer supported OAuth or passwordless login. '
            'If inbox access, consent, or a human-only step is unavailable, report the exact blocker and the next link. '
            'Do not send unrelated messages. Verify account state before reporting success. Creating an account does not automatically connect its MCP server.')
    return await send_message(room['id'],MessageCreate(sender_type='user',content=prompt,options={'model':'gpt-6-luna','provider':'openai','reasoning_effort':'low','max_iterations':8,'max_tokens':2048}),db)


@router.post('/{id}/test')
async def test_connection(id:UUID,db:AsyncSession=Depends(get_db)):
    """Run a known read-only smoke operation; never guess a write tool."""
    import time, asyncio
    from urllib.parse import urlsplit
    from app.services.plugins import invoke
    plugin=await db.get(Plugin,str(id))
    if not plugin or not plugin.enabled:raise HTTPException(409,'Enable the connection before testing it.')
    snapshot=await connection_snapshot(db,plugin)
    from app.services.plugins import is_google_workspace
    host=urlsplit(plugin.url).hostname
    google_tests=[('gmail_users_getProfile',{}),('calendar_calendarList_list',{'maxResults':1}),('drive_about_get',{'fields':'user(emailAddress)'}),('tasks_tasklists_list',{'maxResults':1}),('people_people_connections_list',{'resourceName':'people/me','personFields':'names','pageSize':1})] if is_google_workspace(plugin) else []
    examples={
        'mcp.deepwiki.com': [('read_wiki_structure',{'repoName':'vercel/ai'})],
        'learn.microsoft.com': [('microsoft_docs_search',{'query':'Azure Functions overview'})],
        'docs.mcp.cloudflare.com': [('search_cloudflare_documentation',{'query':'Workers overview'})],
        'mcp.linear.app': [('list_teams',{}),('list_projects',{})],
        'mcp.vercel.com': [('list_teams',{})],
        'mcp.lovable.dev': [('get_me',{}),('list_workspaces',{})],
        'api.githubcopilot.com': [('search_repositories',{'query':'repo:HIveAppDeveloper/open-grokbot','perPage':1})],
        'jobherder.com': [('get_pricing',{})],
        'mcp.windsor.ai': [('get_connectors',{'include_actions':False,'include_options':False})],
    }
    names={t['name'] for t in plugin.tools if t.get('enabled',True)}
    example=next(((name,args) for name,args in (google_tests or examples.get(host,[])) if name in names),None)
    started=time.monotonic()
    async def finish(status, message, http_status=200, **detail):
        current=await lock_current_connection(db,id,snapshot)
        if not current.enabled or (example and example[0] not in {t['name'] for t in current.tools if t.get('enabled',True)}):
            raise HTTPException(409,'The connection or tested tool was paused or changed. Retry after reviewing its settings.')
        result={'message':message,'latency_ms':round((time.monotonic()-started)*1000),**detail}
        # Save in the same transaction as the identity check so reconnects and
        # disconnects cannot invalidate it between validation and persistence.
        from datetime import datetime
        from app.models.runtime import RuntimeCheck
        check=await db.get(RuntimeCheck,'plugin:'+str(id))
        if check:
            check.status=status;check.detail=result;check.updated_at=datetime.utcnow()
        else:db.add(RuntimeCheck(name='plugin:'+str(id),status=status,detail=result,updated_at=datetime.utcnow()))
        await db.commit()
        if http_status != 200:raise HTTPException(http_status,message)
        return {'status':status,**result}
    if not google_tests and urlsplit(plugin.url).scheme != 'https':
        message=('Connect Gmail through Google apps to use its authorized tools.' if host=='gmail.com' else
                 'This saved website is not a hosted MCP connection. Reconnect it using a supported provider or HTTPS server link.')
        return await finish('failed',message,code='unsupported_endpoint')
    if not example:
        # Protocol discovery alone is explicitly labelled, not a tool-call pass.
        from app.services.plugins import connection_auth
        try:
            async with asyncio.timeout(45):
                token,auth=await connection_auth(db,plugin)
                tools=await discover(plugin.url,token,auth)
        except Exception as error:
            from app.services.plugins import authentication_failure
            if authentication_failure(error):
                return await finish('failed','This saved connection needs sign-in again. Reconnect it in Plugins.',http_status=401,code='sign_in_required')
            return await finish('failed','The connection did not respond. Retry or reconnect to check provider access.',code='unavailable')
        if not tools:
            return await finish('failed','This server did not return any tools. Refresh or reconnect it before using it.',code='no_tools',tool_count=0)
        return await finish('discovered','Tools discovered. Execution has not been tested for this service.',tool_count=len(tools))
    code=None
    mode=None
    source_url=None
    try:
        async with asyncio.timeout(45):
            result=await invoke(plugin.id,example[0],example[1])
        passed=result.get('success') is True
        code=result.get('code')
        mode=result.get('verification_mode')
        source_url=result.get('source_url')
    except Exception:
        passed=False
    message='A read-only tool returned successfully.' if passed else 'The read-only test failed. Reconnect or check the service permissions.'
    if code=='invalid_provider_output':message='The provider returned output that does not match its published tool schema.'
    elif code=='sign_in_required':message='This saved connection needs sign-in again. Reconnect it in Plugins.'
    elif code=='rate_limited':message='Google usage or rate limits were reached. Wait before retrying; your saved connection is unchanged.'
    elif code=='google_access_denied':message='Google denied this operation. Check API and organization settings; your saved connection is unchanged.'
    detail={'tool':example[0]}
    if passed and mode=='public_website_fallback':
        return await finish('fallback','The public website returned information. The MCP tool is still unavailable.',
                            **detail,verification_mode=mode,source_url=source_url)
    if code in {'invalid_provider_output','sign_in_required','rate_limited','google_access_denied'}:detail['code']=code
    if code=='rate_limited':detail.update(retryable=True,provider_status=429)
    return await finish('passed' if passed else 'failed',message,**detail)
