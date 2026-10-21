from sqlalchemy import Column, String, Text, DateTime, ForeignKey, JSON

import uuid
import datetime
from app.db.session import Base
from app.db.tenancy import TenantScoped

class Task(Base, TenantScoped):
    __tablename__ = "tasks"
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id = Column(String(36), ForeignKey("conversations.id"), nullable=False)
    bot_id = Column(String(36), ForeignKey("bots.id"), nullable=False)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    status = Column(String, default="pending") # pending, running, waiting_approval, completed, failed, cancelled
    result = Column(JSON, nullable=True)
    steps = Column(JSON, nullable=True, default=list)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
