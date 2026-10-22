from uuid import UUID
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException
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

def public(plugin):
    from app.services.plugins import reveal
    from app.services.managed_connections import REFERENCE_PREFIX
    try:saved=reveal(plugin.credential) if plugin.credential else ''
    except ValueError:saved=''
    connection_id=saved.removeprefix(REFERENCE_PREFIX) if saved and saved.startswith(REFERENCE_PREFIX) else None
    return {'id': plugin.id, 'connection_id':connection_id, 'name': plugin.name, 'url': plugin.url, 'enabled': plugin.enabled, 'authenticated': bool(plugin.credential), 'tools': [{'name': t['name'], 'description': t['description'], 'enabled':t.get('enabled',True)} for t in plugin.tools]}

@router.get('')
async def list_plugins(db: AsyncSession = Depends(get_db)):
    from app.models.runtime import RuntimeCheck
    authenticated=set((await db.execute(select(PluginAuthorization.plugin_id).where(PluginAuthorization.status=='connected',PluginAuthorization.payload.is_not(None)))).scalars())
    output=[]
    for plugin in (await db.execute(select(Plugin))).scalars():
        item=public(plugin);item['authenticated']=item['authenticated'] or plugin.id in authenticated
        check=await db.get(RuntimeCheck,'plugin:'+plugin.id)
        item['verification']={'status':check.status,'detail':check.detail,'checked_at':check.updated_at.isoformat()+'Z'} if check else {'status':'not_tested'}
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
        from sqlalchemy import delete
        await db.execute(delete(PluginAuthorization).where(PluginAuthorization.plugin_id==str(id)))
        await db.delete(plugin); await db.commit()
    return {'status': 'disconnected'}

@router.post('/{id}/refresh')
async def refresh_tools(id:UUID,db:AsyncSession=Depends(get_db)):
    from app.services.plugins import reveal
    plugin=await db.get(Plugin,str(id))
    if not plugin:raise HTTPException(404,'Plugin not found')
    from app.services.plugins import connection_auth
    try:
        token,auth=await connection_auth(db,plugin)
        tools=await discover(plugin.url,token,auth=auth)
    except Exception:raise HTTPException(502,'Could not refresh tools. The saved connection was preserved.')
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
    from app.services.verification import save_check
    plugin=await db.get(Plugin,str(id))
    if not plugin or not plugin.enabled:raise HTTPException(409,'Enable the connection before testing it.')
    host=urlsplit(plugin.url).hostname
    examples={
        'mcp.deepwiki.com': [('read_wiki_structure',{'repoName':'vercel/ai'})],
        'learn.microsoft.com': [('microsoft_docs_search',{'query':'Azure Functions overview'})],
        'docs.mcp.cloudflare.com': [('search_cloudflare_documentation',{'query':'Workers overview'})],
        'mcp.linear.app': [('list_teams',{}),('list_projects',{})],
        'mcp.vercel.com': [('list_teams',{})],
        'api.githubcopilot.com': [('search_repositories',{'query':'repo:HIveAppDeveloper/open-grokbot','perPage':1})],
    }
    names={t['name'] for t in plugin.tools if t.get('enabled',True)}
    example=next(((name,args) for name,args in examples.get(host,[]) if name in names),None)
    if not example:
        # Protocol discovery alone is explicitly labelled, not a tool-call pass.
        from app.services.plugins import connection_auth
        try:
            token,auth=await connection_auth(db,plugin)
            tools=await discover(plugin.url,token,auth)
        except Exception:raise HTTPException(502,'The connection did not respond. Reconnect and check provider access.')
        return {'status':'discovered','tool_count':len(tools),'message':'Connection responded. No known read-only smoke operation is available; execution is not verified.'}
    started=time.monotonic()
    try:
        async with asyncio.timeout(45):
            result=await invoke(plugin.id,example[0],example[1])
        passed=result.get('success') is True
    except Exception:
        passed=False
    detail={'tool':example[0],'latency_ms':round((time.monotonic()-started)*1000),'message':'A read-only tool returned successfully.' if passed else 'The read-only test failed. Reconnect or check the service permissions.'}
    await save_check('plugin:'+plugin.id,'passed' if passed else 'failed',detail)
    return {'status':'passed' if passed else 'failed',**detail}
