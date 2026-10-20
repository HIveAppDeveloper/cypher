from pydantic import BaseModel, ConfigDict, Field, model_validator
import base64
from app.schemas.input import Attachment, RunOptions, MAX_TOTAL_BYTES
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
    client_message_id: UUID | None = None
    attachments: list[Attachment] = Field(default_factory=list, max_length=4)
    options: RunOptions = Field(default_factory=RunOptions)

    @model_validator(mode='after')
    def total_size(self):
        if sum(len(base64.b64decode(a.data)) for a in self.attachments) > MAX_TOTAL_BYTES:
            raise ValueError('Combined attachments exceed 3 MB')
        return self

class MessageResponse(MessageBase):
    id: UUID
    conversation_id: UUID
    created_at: datetime
    
    model_config = ConfigDict(from_attributes=True)
