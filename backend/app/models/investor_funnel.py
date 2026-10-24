"""Tenant-owned VC matching runs and the shared public SEC source snapshot."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, Date, DateTime, Float, Integer, JSON, LargeBinary, String, Text

from app.db.session import Base
from app.db.tenancy import TenantScoped


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class InvestorMatchRun(Base, TenantScoped):
    __tablename__ = "investor_match_runs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    direction = Column(String(32), nullable=False, default="investors_for_thesis")
    thesis = Column(JSON, nullable=False)
    limit = Column(Integer, nullable=False, default=15)
    candidate_limit = Column(Integer, nullable=False, default=80)
    status = Column(String(24), nullable=False, default="pending", index=True)
    phase = Column(String(24), nullable=False, default="queued")
    candidates = Column(JSON, nullable=False, default=list)
    cursor = Column(Integer, nullable=False, default=0)
    results = Column(JSON, nullable=False, default=list)
    events = Column(JSON, nullable=False, default=list)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=utcnow)
    completed_at = Column(DateTime, nullable=True)


class InvestorUniverseSnapshot(Base):
    """Compressed, shared cache of public SEC-derived firm data."""

    __tablename__ = "investor_universe_snapshots"

    id = Column(String(32), primary_key=True, default="current")
    payload = Column(LargeBinary, nullable=False)
    firm_count = Column(Integer, nullable=False, default=0)
    quarters = Column(JSON, nullable=False, default=list)
    built_at = Column(DateTime, nullable=False, default=utcnow)


class FounderLead(Base):
    """Shared, searchable people and issuer evidence from public SEC Form D filings."""

    __tablename__ = "founder_leads"

    id = Column(String(64), primary_key=True)
    person_name = Column(String(240), nullable=False, index=True)
    company_name = Column(String(600), nullable=False, index=True)
    company_key = Column(String(64), nullable=False, index=True)
    person_key = Column(String(64), nullable=False, index=True)
    cik = Column(String(20), nullable=True, index=True)
    accession = Column(String(32), nullable=False, index=True)
    filing_date = Column(Date, nullable=True, index=True)
    industry = Column(String(160), nullable=True, index=True)
    city = Column(String(120), nullable=True)
    state = Column(String(80), nullable=True, index=True)
    roles = Column(JSON, nullable=False, default=list)
    title = Column(String(240), nullable=False, default="")
    founder_signal = Column(Boolean, nullable=False, default=False, index=True)
    founder_evidence = Column(String(500), nullable=False, default="")
    founder_evidence_date = Column(Date, nullable=True)
    founder_evidence_url = Column(String(600), nullable=True)
    offering_amount_usd = Column(Float, nullable=True)
    amount_sold_usd = Column(Float, nullable=True)
    filing_count = Column(Integer, nullable=False, default=1)
    source_quarters = Column(JSON, nullable=False, default=list)
    source_url = Column(String(600), nullable=False)
    refreshed_at = Column(DateTime, nullable=False, default=utcnow)


class InvestorMatchLabel(Base, TenantScoped):
    """Per-workspace feedback on a matched VC firm."""

    __tablename__ = "investor_match_labels"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    firm_id = Column(String(80), nullable=False, index=True)
    label = Column(Integer, nullable=False)
    note = Column(String(500), nullable=False, default="")
    updated_at = Column(DateTime, nullable=False, default=utcnow)
