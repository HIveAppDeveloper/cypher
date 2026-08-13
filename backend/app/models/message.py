from sqlalchemy import Column, String, Text, DateTime, ForeignKey, JSON

import uuid
import datetime
from app.db.session import Base
from sqlalchemy.orm import relationship

class Message(Base):
    __tablename__ = "messages"
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id = Column(String(36), ForeignKey("conversations.id"), nullable=False)
    sender_type = Column(String, nullable=False) # user, bot, system
    sender_bot_id = Column(String(36), ForeignKey("bots.id"), nullable=True)
    content = Column(Text, nullable=False)
    message_type = Column(String, nullable=False, default="text") # text, tool_call, tool_result, status_update, handoff
    metadata_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    
    conversation = relationship("Conversation", back_populates="messages")
