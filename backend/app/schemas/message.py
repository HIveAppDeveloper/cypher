from pydantic import BaseModel, ConfigDict
from typing import Optional, Any, Dict
from uuid import UUID
from datetime import datetime

class MessageBase(BaseModel):
    sender_type: str
    sender_bot_id: Optional[UUID] = None
    content: str
    message_type: str = "text"
    metadata_json: Optional[Dict[str, Any]] = None

class MessageCreate(MessageBase):
    pass

class MessageResponse(MessageBase):
    id: UUID
    conversation_id: UUID
    created_at: datetime
    
    model_config = ConfigDict(from_attributes=True)
