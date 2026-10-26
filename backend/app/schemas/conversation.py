from pydantic import BaseModel, ConfigDict, Field
from typing import List, Optional
from uuid import UUID
from datetime import datetime
from app.services.team_limits import MAX_TEAM_AGENTS

class ConversationBase(BaseModel):
    title: str
    is_group: bool = False

class ConversationCreate(ConversationBase):
    bot_ids: List[UUID] = Field(default_factory=list, max_length=MAX_TEAM_AGENTS)

class ConversationResponse(ConversationBase):
    bot_ids: List[UUID] = []
    id: UUID
    created_at: datetime
    updated_at: datetime
    
    model_config = ConfigDict(from_attributes=True)
