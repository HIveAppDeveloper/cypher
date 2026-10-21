from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column,String,Text,DateTime,ForeignKey,Boolean
from app.db.session import Base
from app.db.tenancy import TenantScoped
class ContextNote(Base, TenantScoped):
    __tablename__='context_notes'
    id=Column(String(36),primary_key=True,default=lambda:str(uuid4()))
    conversation_id=Column(String(36),ForeignKey('conversations.id'),nullable=False,index=True)
    name=Column(String(100),nullable=False)
    kind=Column(String(20),nullable=False,default='preference')
    content=Column(Text,nullable=False)
    source=Column(String(20),nullable=False,default='owner')
    evidence_task_id=Column(String(36),nullable=True)
    verified=Column(Boolean,default=False,nullable=False)
    updated_at=Column(DateTime,default=datetime.utcnow,nullable=False)
class BrowserSession(Base, TenantScoped):
    __tablename__='browser_sessions'
    bot_id=Column(String(36),ForeignKey('bots.id'),primary_key=True)
    state=Column(Text,nullable=False)
    updated_at=Column(DateTime,default=datetime.utcnow,nullable=False)

from sqlalchemy import Integer
class DeviceCredential(Base, TenantScoped):
    __tablename__='device_credentials'
    id=Column(String(1400),primary_key=True)
    public_key=Column(Text,nullable=False)
    sign_count=Column(Integer,default=0,nullable=False)
class DeviceChallenge(Base, TenantScoped):
    __tablename__='device_challenges'
    id=Column(String(36),primary_key=True,default=lambda:str(uuid4()))
    challenge=Column(Text,nullable=False)
    purpose=Column(String(1200),nullable=False)
    expires_at=Column(DateTime,nullable=False)
    used=Column(Boolean,default=False,nullable=False)
