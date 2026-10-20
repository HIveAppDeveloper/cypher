from uuid import UUID
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.models.plugin import Plugin
from app.services.plugins import discover, seal

router = APIRouter()
class ConnectPlugin(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    url: str = Field(min_length=8, max_length=1000)
    token: str = Field(default='', max_length=4096)
class TogglePlugin(BaseModel):
    enabled: bool

def public(plugin):
    return {'id': plugin.id, 'name': plugin.name, 'url': plugin.url, 'enabled': plugin.enabled, 'authenticated': bool(plugin.credential), 'tools': [{'name': t['name'], 'description': t['description'], 'enabled':t.get('enabled',True)} for t in plugin.tools]}

@router.get('')
async def list_plugins(db: AsyncSession = Depends(get_db)):
    return [public(p) for p in (await db.execute(select(Plugin))).scalars()]

@router.post('')
async def connect(data: ConnectPlugin, db: AsyncSession = Depends(get_db)):
    try:
        credential = seal(data.token.strip())
    except ValueError as error:
        raise HTTPException(status_code=503, detail=str(error))
    try:
        tools = await discover(data.url.strip(), data.token.strip() or None)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error))
    except Exception:
        raise HTTPException(status_code=502, detail='Could not connect to this MCP server. Check its HTTPS endpoint and bearer token.')
    if not tools:
        raise HTTPException(status_code=422, detail='This MCP server did not advertise any tools.')
    plugin = Plugin(name=data.name.strip(), url=data.url.strip(), credential=credential, tools=tools, enabled=True)
    db.add(plugin); await db.commit(); await db.refresh(plugin)
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
    if plugin: await db.delete(plugin); await db.commit()
    return {'status': 'disconnected'}

@router.post('/{id}/refresh')
async def refresh_tools(id:UUID,db:AsyncSession=Depends(get_db)):
    from app.services.plugins import reveal
    plugin=await db.get(Plugin,str(id))
    if not plugin:raise HTTPException(404,'Plugin not found')
    try:tools=await discover(plugin.url,reveal(plugin.credential))
    except Exception:raise HTTPException(502,'Could not refresh tools. The saved connection was preserved.')
    previous={t['name']:t.get('enabled',True) for t in plugin.tools}
    plugin.tools=[{**t,'enabled':previous.get(t['name'],True)} for t in tools]
    await db.commit();return public(plugin)

@router.patch('/{id}/tools/{tool_name}')
async def tool_state(id:UUID,tool_name:str,data:TogglePlugin,db:AsyncSession=Depends(get_db)):
    plugin=(await db.execute(select(Plugin).where(Plugin.id==str(id)).with_for_update())).scalar_one_or_none()
    if not plugin:raise HTTPException(404,'Plugin not found')
    if not any(t['name']==tool_name for t in plugin.tools):raise HTTPException(404,'Tool not found')
    plugin.tools=[{**t,'enabled':data.enabled} if t['name']==tool_name else t for t in plugin.tools]
    await db.commit();return public(plugin)
