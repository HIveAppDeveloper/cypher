from sqlalchemy import Column, String, Text, Boolean, DateTime, JSON

import uuid
import datetime
from app.db.session import Base

class Bot(Base):
    __tablename__ = "bots"
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, unique=True, nullable=False)
    role = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    avatar_url = Column(String, nullable=True)
    system_prompt = Column(Text, nullable=False)
    llm_provider = Column(String, nullable=False)
    llm_model = Column(String, nullable=False)
    tools_enabled = Column(JSON, nullable=False, default=list)
    memory_enabled = Column(Boolean, default=True)
    status = Column(String, default="offline") # idle, working, waiting, error, offline
    container_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
