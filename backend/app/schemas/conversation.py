from pydantic import BaseModel, ConfigDict
from typing import List, Optional
from uuid import UUID
from datetime import datetime

class ConversationBase(BaseModel):
    title: str
    is_group: bool = False

class ConversationCreate(ConversationBase):
    bot_ids: List[UUID] = []

class ConversationResponse(ConversationBase):
    id: UUID
    created_at: datetime
    updated_at: datetime
    
    model_config = ConfigDict(from_attributes=True)
