"""Google permissions remain separate from identity sign-in and from other app credentials."""
from fastapi import APIRouter,Depends,HTTPException,Request
from pydantic import BaseModel,Field
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.models.plugin import Plugin,PluginAuthorization
from app.services import google_workspace as google
from app.services.plugins import reveal
router=APIRouter()

@router.get('/status')
async def status(db:AsyncSession=Depends(get_db)):return await google.status(db)

class PermissionRequest(BaseModel):
 services:list[str]=Field(min_length=1,max_length=5)
 approval_id:str|None=Field(default=None,max_length=36)

@router.post('/authorize')
async def authorize(body:PermissionRequest,request:Request,db:AsyncSession=Depends(get_db)):
 return await google.begin(db,body.services,body.approval_id,request.headers.get("x-grokbot-public-origin"))

class Callback(BaseModel):
 state:str=Field(min_length=16,max_length=200)
 binding:str=Field(min_length=16,max_length=200)
 code:str=Field(default='',max_length=4096)
 denied:bool=False

@router.post('/callback')
async def callback(body:Callback,db:AsyncSession=Depends(get_db)):
 return await google.finish(db,body.state,body.binding,body.code,body.denied)

@router.delete('')
async def disconnect(db:AsyncSession=Depends(get_db)):
 row=await google.grant(db)
 if row:
  saved=google.DatabaseTokenStorage(db,row).read();token=saved.get('refresh_token') or saved.get('access_token')
  if token:
   async with google.client() as client:
    response=await client.post('https://oauth2.googleapis.com/revoke',data={'token':token})
   if response.status_code not in (200,400):raise HTTPException(502,'Google did not confirm revocation. Try disconnecting again.')
  if row.plugin_id:
   plugin=await db.get(Plugin,row.plugin_id)
   if plugin and reveal(plugin.credential)==google.REFERENCE:await db.delete(plugin)
  await db.delete(row);await db.commit()
 return {'status':'disconnected'}
