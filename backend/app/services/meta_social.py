"""Explicit Meta social setup through the tenant's saved Windsor MCP grant."""
import asyncio
import json
import logging
from urllib.parse import urlsplit

from fastapi import HTTPException
from jsonschema import Draft202012Validator, ValidationError, SchemaError
from app.services import plugins

SERVICES={'facebook_organic':'Facebook Pages','instagram':'Instagram'}
ALLOWED_HOSTS={'onboard.windsor.ai','api.windsor.ai','mcp.windsor.ai','www.facebook.com','facebook.com','business.facebook.com','www.instagram.com','instagram.com','api.instagram.com'}
logger=logging.getLogger(__name__)
PHASES={'connection_auth','session_initialize','argument_validation','tool_call','payload_decode','connector_rows','authorization_check','session_close'}
ERROR_CLASSES={'ExceptionGroup','BaseExceptionGroup','HTTPException','TimeoutError','ReadTimeout','ConnectTimeout','PoolTimeout','HTTPStatusError','TransportError','ConnectError','ReadError','WriteError','RemoteProtocolError','LocalProtocolError','EndOfStream','BrokenResourceError','ClosedResourceError','ValueError','KeyError','TypeError','AttributeError','RuntimeError','ValidationError','SchemaError','McpError','InvalidToken','SignInRequired'}
HTTP_CATEGORIES={
    'The provider returned an unexpected connector catalog.':'catalog_shape',
    'The provider returned ambiguous connector metadata.':'catalog_ambiguous',
    'The provider returned unreadable connection metadata.':'metadata_json_invalid',
    'The provider returned too much connection metadata.':'metadata_too_large',
    'Windsor did not complete this connection request. Check its saved sign-in and try again.':'provider_tool_error',
    'The provider returned an unexpected authorization address. No access was changed.':'authorization_url_invalid',
    'The provider returned unreadable authorization guidance.':'authorization_notes_invalid',
    'Refresh Windsor tools to load its current connection format.':'argument_schema_invalid',
}


def failure_diagnostic(error,phase):
    """Only fixed categories reach logs; never messages, traceback or provider data."""
    stack=[error];leaves=[];visited=0
    while stack and visited<32:
        item=stack.pop();visited+=1
        children=getattr(item,'exceptions',None)
        if isinstance(children,(list,tuple)) and children:stack.extend(children[:8])
        else:leaves.append(item)
    def name(item):
        value=type(item).__name__
        return value if value in ERROR_CLASSES else 'UnknownError'
    categories=set()
    for item in leaves:
        if isinstance(item,HTTPException) and isinstance(item.detail,str) and item.detail in HTTP_CATEGORIES:
            categories.add(HTTP_CATEGORIES[item.detail])
    status=plugins.provider_status(error)
    return {'phase':phase if phase in PHASES else 'unknown','outer_class':name(error),
            'leaf_classes':sorted({name(item) for item in leaves}),
            'provider_status':status if type(status) is int and status in {400,401,403,404,408,409,422,429,500,502,503,504} else None,
            'local_http_categories':sorted(categories)}


def authorization_url(value):
    try:
        url=urlsplit(value)
        if (isinstance(value,str) and len(value)<=16000 and url.scheme=='https' and url.hostname in ALLOWED_HOSTS
                and not url.username and not url.password and url.port in (None,443)
                and not any(ord(c)<32 or ord(c)==127 for c in value)):
            return value
    except (ValueError,TypeError,AttributeError):pass
    raise HTTPException(502,'The provider returned an unexpected authorization address. No access was changed.')


def payload(result):
    if result.isError:raise HTTPException(502,'Windsor did not complete this connection request. Check its saved sign-in and try again.')
    data=getattr(result,'structuredContent',None)
    if data is None:
        parts=[part.text for part in result.content if part.type=='text']
        if sum(len(part) for part in parts)>2_000_000:raise HTTPException(502,'The provider returned too much connection metadata.')
        try:data=json.loads('\n'.join(parts))
        except (ValueError,TypeError):raise HTTPException(502,'The provider returned unreadable connection metadata.') from None
    if len(json.dumps(data,default=str))>2_000_000:raise HTTPException(502,'The provider returned too much connection metadata.')
    return data


def connector_rows(data):
    rows=data.get('connectors',data.get('data')) if isinstance(data,dict) else data
    # FastMCP wraps list-returning tools in structuredContent={"result": [...]},
    # while the backwards-compatible text content may still be the bare list.
    if isinstance(data,dict) and set(data)=={'result'} and isinstance(data['result'],list):rows=data['result']
    if not isinstance(rows,list) or len(rows)>2000:raise HTTPException(502,'The provider returned an unexpected connector catalog.')
    found={}
    for row in rows:
        if not isinstance(row,dict):continue
        identifier=row.get('id',row.get('connector'))
        if not isinstance(identifier,str) or identifier not in SERVICES:continue
        if identifier in found:raise HTTPException(502,'The provider returned ambiguous connector metadata.')
        accounts=row.get('accounts')
        if not isinstance(accounts,list) or len(accounts)>10000:
            found[identifier]=None
        else:
            identifiers=set()
            for account in accounts:
                account_id=account.get('id') if isinstance(account,dict) else account
                if type(account_id) not in (str,int) or not str(account_id).strip():
                    found[identifier]=None
                    break
                identifiers.add(str(account_id))
            else:found[identifier]=len(identifiers)
    return found


def provider_notes(value):
    if value is None:return ''
    if isinstance(value,list) and all(isinstance(item,str) for item in value):value='\n'.join(value)
    if not isinstance(value,str) or len(value)>8000:raise HTTPException(502,'The provider returned unreadable authorization guidance.')
    return value


async def connection_details(db,plugin,service=None):
    if not plugin:raise HTTPException(404,'Saved connection not found.')
    try:
        url=urlsplit(plugin.url)
        supported=url.scheme=='https' and url.hostname=='mcp.windsor.ai' and not url.username and not url.password and url.port in (None,443) and not url.query and not url.fragment
    except ValueError:supported=False
    if not supported:raise HTTPException(422,'Choose your saved Windsor.ai connection for Facebook and Instagram.')
    if not plugin.enabled:raise HTTPException(409,'Enable your Windsor connection before managing Meta permissions.')
    if service is not None and service not in SERVICES:raise HTTPException(422,'Choose Facebook Pages or Instagram.')
    registered={tool['name']:tool for tool in plugin.tools if tool.get('enabled',True)}
    required={'get_connectors'}|({'get_connector_connect_info'} if service else set())
    if not required<=registered.keys():raise HTTPException(409,'Refresh Windsor tools or enable its connection tools before continuing.')

    phase='connection_auth'
    async def call(client,name,arguments):
        nonlocal phase
        phase='argument_validation'
        try:Draft202012Validator(registered[name]['schema']).validate(arguments)
        except (KeyError,ValidationError,SchemaError):raise HTTPException(409,'Refresh Windsor tools to load its current connection format.') from None
        phase='tool_call'
        result=await client.call_tool(name,arguments)
        phase='payload_decode'
        return payload(result)

    try:
        async with asyncio.timeout(45):
            token,auth=await plugins.connection_auth(db,plugin)
            phase='session_initialize'
            validation_error=None;response=None
            async with plugins.session(plugin.url,token,auth=auth) as client:
                try:
                    data=await call(client,'get_connectors',{'include_not_yet_connected':True,'include_actions':False,'include_options':False})
                    phase='connector_rows';rows=connector_rows(data)
                    if service:
                        if service not in rows:raise HTTPException(409,'This Meta connector is not available in the current Windsor catalog.')
                        info=await call(client,'get_connector_connect_info',{'connector':service})
                        phase='authorization_check'
                        if not isinstance(info,dict) or info.get('auth_type')!='oauth':raise HTTPException(409,'This connector does not offer browser authorization in its current configuration.')
                        response={'service':service,'name':SERVICES[service],'authorization_url':authorization_url(info.get('connect_url')),'notes':provider_notes(info.get('notes')),'data_access_verified':False}
                    else:
                        response={'services':[{'id':identifier,'name':name,'available':identifier in rows,'account_count':rows.get(identifier),'status':'accounts_listed' if rows.get(identifier) else 'not_connected' if rows.get(identifier)==0 else 'unknown','data_access_verified':False} for identifier,name in SERVICES.items()]}
                except HTTPException as error:
                    # Exit MCP/AnyIO scopes normally. Otherwise their task groups
                    # can wrap our own validation error and erase its category.
                    validation_error=error
                phase='session_close'
            if validation_error:raise validation_error
            return response
    except HTTPException:raise
    except Exception as error:
        if plugins.authentication_failure(error):raise HTTPException(401,'Reconnect Windsor in Apps before managing Meta permissions.') from None
        if plugins.provider_status(error)==429:raise HTTPException(429,'Windsor is rate limited. Wait before trying again.',headers={'Retry-After':'60'}) from None
        logger.warning('meta_connection_failure %s',json.dumps(failure_diagnostic(error,phase),sort_keys=True))
        raise HTTPException(502,'Meta connection details could not load. Your existing permissions are unchanged.') from None
