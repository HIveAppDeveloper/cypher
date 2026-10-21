"""Durable task attempts and cached model/tool steps."""
from datetime import datetime
from sqlalchemy import Column, String, Integer, DateTime, Boolean, JSON, ForeignKey
from app.db.session import Base
from app.db.tenancy import TenantScoped


class TaskExecution(Base, TenantScoped):
    __tablename__ = 'task_executions'
    task_id = Column(String(36), ForeignKey('tasks.id'), primary_key=True)
    attempts = Column(Integer, nullable=False, default=0)
    recoveries = Column(Integer, nullable=False, default=0)
    next_attempt_at = Column(DateTime, nullable=True)
    last_error = Column(String(500), nullable=True)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class ExecutionStep(Base, TenantScoped):
    __tablename__ = 'execution_steps'
    task_id = Column(String(36), ForeignKey('tasks.id'), primary_key=True)
    key = Column(String(250), primary_key=True)
    name = Column(String(160), nullable=False)
    status = Column(String(24), nullable=False)
    replay_safe = Column(Boolean, nullable=False)
    output = Column(JSON, nullable=True)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)
