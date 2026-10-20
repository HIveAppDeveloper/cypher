import uuid
from datetime import datetime
from sqlalchemy import Column,String,Text,Integer,Boolean,DateTime,ForeignKey,UniqueConstraint
from app.db.session import Base

class Goal(Base):
    __tablename__='goals'
    id=Column(String(36),primary_key=True,default=lambda:str(uuid.uuid4()))
    conversation_id=Column(String(36),ForeignKey('conversations.id'),nullable=False)
    title=Column(String(120),nullable=False)
    objective=Column(Text,nullable=False)
    success_criteria=Column(Text,nullable=False)
    manager_model=Column(String(80),nullable=False,default='gpt-6.1-sol')
    status=Column(String(24),nullable=False,default='active')
    interval_minutes=Column(Integer,nullable=False,default=60)
    max_runs=Column(Integer,nullable=False,default=3)
    runs=Column(Integer,nullable=False,default=0)
    next_run_at=Column(DateTime,nullable=True,default=datetime.utcnow)
    last_task_id=Column(String(36),nullable=True)
    completion_requested=Column(Boolean,nullable=False,default=False)
    last_summary=Column(Text,nullable=True)
    created_at=Column(DateTime,nullable=False,default=datetime.utcnow)

class Channel(Base):
    __tablename__='channels'
    id=Column(String(36),primary_key=True,default=lambda:str(uuid.uuid4()))
    name=Column(String(80),nullable=False)
    conversation_id=Column(String(36),ForeignKey('conversations.id'),nullable=False)
    manager_model=Column(String(80),nullable=False,default='gpt-6.1-sol')
    enabled=Column(Boolean,nullable=False,default=True)
    token_hash=Column(String(64),nullable=False)
    signing_secret=Column(Text,nullable=False)
    webhook_url=Column(Text,nullable=True)
    created_at=Column(DateTime,nullable=False,default=datetime.utcnow)

class ChannelEvent(Base):
    __tablename__='channel_events'
    __table_args__=(UniqueConstraint('channel_id','event_id'),)
    id=Column(String(36),primary_key=True,default=lambda:str(uuid.uuid4()))
    channel_id=Column(String(36),ForeignKey('channels.id'),nullable=False)
    event_id=Column(String(128),nullable=False)
    task_id=Column(String(36),nullable=False)
    created_at=Column(DateTime,nullable=False,default=datetime.utcnow)

class Delivery(Base):
    __tablename__='channel_deliveries'
    __table_args__=(UniqueConstraint('channel_id','task_id'),)
    id=Column(String(36),primary_key=True,default=lambda:str(uuid.uuid4()))
    channel_id=Column(String(36),ForeignKey('channels.id'),nullable=False)
    task_id=Column(String(36),ForeignKey('tasks.id'),nullable=False)
    status=Column(String(24),nullable=False,default='pending')
    attempts=Column(Integer,nullable=False,default=0)
    next_attempt_at=Column(DateTime,nullable=False,default=datetime.utcnow)
    detail=Column(Text,nullable=True)
