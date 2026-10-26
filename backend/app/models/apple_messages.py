"""Additive same-runtime storage; native transport remains unavailable."""
from datetime import datetime
from uuid import uuid4
from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Numeric, String, Text, UniqueConstraint
from app.db.session import Base
from app.db.tenancy import TenantScoped


class AppleLinkChallenge(Base, TenantScoped):
    __tablename__ = 'apple_link_challenges'
    token_hash = Column(String(64), primary_key=True)
    conversation_id = Column(String(36), ForeignKey('conversations.id'), nullable=False)
    updates_opt_in = Column(Boolean, nullable=False, default=False)
    expires_at = Column(DateTime, nullable=False)
    consumed_at = Column(DateTime)


class AppleThread(Base, TenantScoped):
    __tablename__ = 'apple_message_threads'
    __table_args__ = (UniqueConstraint('business_id', 'opaque_hash'),)
    id = Column(String(36), primary_key=True, default=lambda: str(uuid4()))
    business_id = Column(String(128), nullable=False)
    opaque_hash = Column(String(64), nullable=False)
    sealed_opaque_id = Column(Text, nullable=False)
    conversation_id = Column(String(36), ForeignKey('conversations.id'), nullable=False)
    state = Column(String(24), nullable=False, default='active')
    updates_opt_in = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class AppleInbound(Base, TenantScoped):
    __tablename__ = 'apple_message_inbound'
    __table_args__ = (UniqueConstraint('thread_id', 'event_id'),)
    id = Column(String(36), primary_key=True, default=lambda: str(uuid4()))
    thread_id = Column(String(36), ForeignKey('apple_message_threads.id'), nullable=False)
    event_id = Column(String(128), nullable=False)
    payload_hash = Column(String(64), nullable=False)
    disposition = Column(String(24), nullable=False)
    task_id = Column(String(36), ForeignKey('tasks.id'))
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class AppleOutbox(Base, TenantScoped):
    __tablename__ = 'apple_message_outbox'
    __table_args__ = (UniqueConstraint('thread_id', 'source_id'),)
    id = Column(String(36), primary_key=True, default=lambda: str(uuid4()))
    thread_id = Column(String(36), ForeignKey('apple_message_threads.id'), nullable=False)
    source_id = Column(String(160), nullable=False)
    body = Column(Text, nullable=False)
    status = Column(String(24), nullable=False, default='pending')
    attempted_at = Column(DateTime)
    provider_reference = Column(String(256))
    # Null means unreported. It must never be displayed as a zero-dollar invoice.
    reported_cost = Column(Numeric(18, 8))
    currency = Column(String(3))
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
