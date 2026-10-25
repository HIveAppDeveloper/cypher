"""Cypher-owned state only; never reads the upstream agent's global pipeline."""
from datetime import datetime
from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, JSON, String, Text, UniqueConstraint

from app.db.session import Base
from app.db.tenancy import TenantScoped


class SourcingOutreach(Base, TenantScoped):
    __tablename__ = 'sourcing_outreach'
    __table_args__ = (
        UniqueConstraint('tenant_id', 'request_id', name='uq_sourcing_outreach_request'),
        UniqueConstraint('tenant_id', 'digest', name='uq_sourcing_outreach_envelope'),
    )
    id = Column(String(36), primary_key=True, default=lambda: str(uuid4()))
    request_id = Column(String(36), nullable=False)
    digest = Column(String(64), nullable=False)
    provider = Column(String(12), nullable=False)
    account_id = Column(String(36), nullable=False)
    account_binding = Column(String(64), nullable=False)
    sender = Column(String(254), nullable=False)
    recipient = Column(String(254), nullable=False)
    subject = Column(String(200), nullable=False)
    body = Column(Text, nullable=False)
    status = Column(String(24), nullable=False, default='awaiting_approval')
    review_token = Column(String(80), nullable=False)
    review_expires_at = Column(DateTime, nullable=False)
    approved_at = Column(DateTime, nullable=True)
    approved_by = Column(String(255), nullable=True)
    not_before = Column(DateTime, nullable=True)
    attempted_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    gmail_draft_id = Column(String(256), nullable=True)
    detail = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)


class SourcingMailPolicy(Base, TenantScoped):
    __tablename__ = 'sourcing_mail_policy'
    __table_args__ = (UniqueConstraint('tenant_id', 'recipient', name='uq_sourcing_mail_policy_recipient'),)
    id = Column(String(64), primary_key=True)
    recipient = Column(String(254), nullable=False)
    held = Column(Boolean, nullable=False, default=False)
    suppressed = Column(Boolean, nullable=False, default=False)
    reason = Column(String(300), nullable=False, default='')
    history = Column(JSON, nullable=False, default=list)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)
