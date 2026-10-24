from pydantic import BaseModel, ConfigDict
from typing import List, Optional, Any, Dict
from uuid import UUID
from datetime import datetime

class TaskBase(BaseModel):
    title: str
    description: str
    bot_id: UUID

class TaskCreate(TaskBase):
    pass

class TaskResponse(TaskBase):
    id: UUID
    conversation_id: UUID
    status: str
    result: Optional[Dict[str, Any]] = None
    steps: List[Dict[str, Any]]
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    
    model_config = ConfigDict(from_attributes=True)
