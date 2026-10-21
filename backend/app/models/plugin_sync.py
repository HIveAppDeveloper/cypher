"""A tenant-owned catalog connection job, independent of browser lifetime."""
import uuid
from datetime import datetime
from sqlalchemy import Column, String, JSON, DateTime
from app.db.session import Base
from app.db.tenancy import TenantScoped


class PluginSync(Base, TenantScoped):
    __tablename__ = 'plugin_syncs'
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    status = Column(String(24), nullable=False, default='pending')
    results = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow)
