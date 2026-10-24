from datetime import datetime
from uuid import uuid4
from sqlalchemy import Column,String,Text,JSON,DateTime,Integer,Boolean,ForeignKey,Float,UniqueConstraint
from app.db.session import Base
from app.db.tenancy import TenantScoped


class Knowledge(Base,TenantScoped):
    __tablename__='workspace_knowledge'
    __table_args__=(UniqueConstraint('tenant_id','kind','scope','name',name='unique_workspace_knowledge'),)
    id=Column(String(36),primary_key=True,default=lambda:str(uuid4()))
    kind=Column(String(20),nullable=False)
    scope=Column(String(80),nullable=False,default='workspace')
    name=Column(String(100),nullable=False)
    content=Column(Text,nullable=False)
    parameters=Column(JSON,nullable=False,default=list)
    updated_at=Column(DateTime,nullable=False,default=datetime.utcnow)


class Routine(Base,TenantScoped):
    __tablename__='routines'
    id=Column(String(36),primary_key=True,default=lambda:str(uuid4()))
    conversation_id=Column(String(36),ForeignKey('conversations.id'),nullable=False)
    name=Column(String(100),nullable=False)
    instructions=Column(Text,nullable=False)
    schedule=Column(String(20),nullable=False,default='interval')
    interval_minutes=Column(Integer,nullable=False,default=60)
    at_time=Column(String(5),nullable=False,default='09:00')
    timezone=Column(String(80),nullable=False,default='UTC')
    enabled=Column(Boolean,nullable=False,default=True)
    next_run_at=Column(DateTime,nullable=True)
    last_task_id=Column(String(36),nullable=True)
    created_at=Column(DateTime,nullable=False,default=datetime.utcnow)


class WorkspaceSetting(Base,TenantScoped):
    __tablename__='workspace_settings'
    id=Column(String(255),primary_key=True)
    value=Column(JSON,nullable=False,default=dict)


class UsageEvent(Base,TenantScoped):
    __tablename__='model_usage'
    id=Column(String(36),primary_key=True,default=lambda:str(uuid4()))
    task_id=Column(String(36),nullable=True,index=True)
    provider=Column(String(40),nullable=False)
    model=Column(String(160),nullable=False)
    input_tokens=Column(Integer,nullable=False,default=0)
    output_tokens=Column(Integer,nullable=False,default=0)
    estimated_cost=Column(Float,nullable=False,default=0)
    created_at=Column(DateTime,nullable=False,default=datetime.utcnow,index=True)


class Notification(Base,TenantScoped):
    __tablename__='notifications'
    id=Column(String(36),primary_key=True,default=lambda:str(uuid4()))
    task_id=Column(String(36),nullable=True,index=True)
    conversation_id=Column(String(36),nullable=True)
    title=Column(String(200),nullable=False)
    detail=Column(Text,nullable=False)
    read=Column(Boolean,nullable=False,default=False)
    created_at=Column(DateTime,nullable=False,default=datetime.utcnow)


class ContextCheckpoint(Base,TenantScoped):
    __tablename__='context_checkpoints'
    conversation_id=Column(String(36),ForeignKey('conversations.id'),primary_key=True)
    content=Column(Text,nullable=False)
    through_at=Column(DateTime,nullable=False)
    through_id=Column(String(36),nullable=False)
    updated_at=Column(DateTime,nullable=False,default=datetime.utcnow)


class SharedTemplate(Base,TenantScoped):
    __tablename__='shared_templates'
    id=Column(String(64),primary_key=True)
    payload=Column(JSON,nullable=False)
    created_at=Column(DateTime,nullable=False,default=datetime.utcnow)


class ComputerControl(Base,TenantScoped):
    __tablename__='computer_controls'
    bot_id=Column(String(36),ForeignKey('bots.id'),primary_key=True)
    takeover_until=Column(DateTime,nullable=True)


class ComputerCommand(Base,TenantScoped):
    __tablename__='computer_commands'
    id=Column(String(36),primary_key=True,default=lambda:str(uuid4()))
    bot_id=Column(String(36),ForeignKey('bots.id'),nullable=False,index=True)
    action=Column(String(40),nullable=False)
    payload=Column(Text,nullable=False)
    status=Column(String(24),nullable=False,default='pending')
    result=Column(Text,nullable=True)
    created_at=Column(DateTime,nullable=False,default=datetime.utcnow)
    updated_at=Column(DateTime,nullable=False,default=datetime.utcnow)


class ToolApproval(Base,TenantScoped):
    __tablename__='tool_approvals'
    id=Column(String(36),primary_key=True)
    task_id=Column(String(36),ForeignKey('tasks.id'),nullable=False)
    bot_id=Column(String(36),ForeignKey('bots.id'),nullable=False)
    name=Column(String(100),nullable=False)
    arguments=Column(Text,nullable=False)
    status=Column(String(20),nullable=False,default='pending')
    created_at=Column(DateTime,nullable=False,default=datetime.utcnow)


class SharedFile(Base,TenantScoped):
    __tablename__='shared_files'
    __table_args__=(UniqueConstraint('tenant_id','name',name='unique_workspace_file'),)
    id=Column(String(36),primary_key=True,default=lambda:str(uuid4()))
    name=Column(String(200),nullable=False)
    content=Column(Text,nullable=False)
    updated_at=Column(DateTime,nullable=False,default=datetime.utcnow)


class LocalDevice(Base,TenantScoped):
    __tablename__='local_devices'
    id=Column(String(36),primary_key=True,default=lambda:str(uuid4()))
    name=Column(String(80),nullable=False)
    token_hash=Column(String(64),nullable=False,index=True)
    paired=Column(Boolean,nullable=False,default=False)
    scopes=Column(JSON,nullable=False,default=list)
    folders=Column(JSON,nullable=False,default=list)
    expires_at=Column(DateTime,nullable=True)
    last_seen_at=Column(DateTime,nullable=True)


class LocalDeviceJob(Base,TenantScoped):
    __tablename__='local_device_jobs'
    id=Column(String(36),primary_key=True,default=lambda:str(uuid4()))
    device_id=Column(String(36),ForeignKey('local_devices.id'),nullable=False,index=True)
    action=Column(String(30),nullable=False)
    payload=Column(Text,nullable=False)
    status=Column(String(30),nullable=False,default='pending')
    result=Column(Text,nullable=True)
    created_at=Column(DateTime,nullable=False,default=datetime.utcnow)
