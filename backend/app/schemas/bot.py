from pydantic import BaseModel, ConfigDict
from typing import List, Optional
from uuid import UUID
from datetime import datetime

class BotBase(BaseModel):
    name: str
    role: str
    description: Optional[str] = None
    avatar_url: Optional[str] = None
    system_prompt: str
    llm_provider: str
    llm_model: str
    tools_enabled: List[str] = []
    memory_enabled: bool = True

class BotCreate(BotBase):
    pass

class BotUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    description: Optional[str] = None
    avatar_url: Optional[str] = None
    system_prompt: Optional[str] = None
    llm_provider: Optional[str] = None
    llm_model: Optional[str] = None
    tools_enabled: Optional[List[str]] = None
    memory_enabled: Optional[bool] = None
    status: Optional[str] = None

class BotResponse(BotBase):
    id: UUID
    status: str
    container_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    
    model_config = ConfigDict(from_attributes=True)
