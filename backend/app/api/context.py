from uuid import UUID
from typing import Literal
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.session import get_db
from app.models.conversation import Conversation
from app.models.context import ContextNote
from app.services.context import save_note
router=APIRouter()
class NoteInput(BaseModel):
    name:str=Field(min_length=1,max_length=100)
    kind:Literal['preference','fact','procedure']='preference'
    content:str=Field(min_length=1,max_length=2400)
def public(note):return {'id':note.id,'name':note.name,'kind':note.kind,'content':note.content,'source':note.source,'verified':note.verified,'evidence_task_id':note.evidence_task_id,'updated_at':note.updated_at}
@router.get('/{id}/context')
async def list_context(id:UUID,db:AsyncSession=Depends(get_db)):
    if not await db.get(Conversation,str(id)):raise HTTPException(404,'Conversation not found')
    return [public(n) for n in (await db.execute(select(ContextNote).where(ContextNote.conversation_id==str(id)).order_by(ContextNote.updated_at.desc()))).scalars().all()]
@router.post('/{id}/context',status_code=201)
async def add_context(id:UUID,body:NoteInput,db:AsyncSession=Depends(get_db)):
    if not await db.get(Conversation,str(id)):raise HTTPException(404,'Conversation not found')
    try:return public(await save_note(db,str(id),body.name,body.kind,body.content))
    except ValueError as e:raise HTTPException(422,str(e))
@router.delete('/{id}/context/{note_id}')
async def delete_context(id:UUID,note_id:UUID,db:AsyncSession=Depends(get_db)):
    note=await db.get(ContextNote,str(note_id))
    if not note or note.conversation_id!=str(id):raise HTTPException(404,'Note not found')
    await db.delete(note);await db.commit();return {'deleted':True}
