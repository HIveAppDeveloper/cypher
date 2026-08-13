from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey

import uuid
import datetime
from app.db.session import Base
from sqlalchemy.orm import relationship

class Conversation(Base):
    __tablename__ = "conversations"
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    title = Column(String, nullable=False)
    is_group = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
    
    participants = relationship("ConversationParticipant", back_populates="conversation")
    messages = relationship("Message", back_populates="conversation")

class ConversationParticipant(Base):
    __tablename__ = "conversation_participants"
    
    conversation_id = Column(String(36), ForeignKey("conversations.id"), primary_key=True)
    bot_id = Column(String(36), ForeignKey("bots.id"), primary_key=True)
    joined_at = Column(DateTime, default=datetime.datetime.utcnow)
    
    conversation = relationship("Conversation", back_populates="participants")
