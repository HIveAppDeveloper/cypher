import uuid
from sqlalchemy import Column, String, Text, Boolean, JSON, Float
from app.db.session import Base

class Plugin(Base):
    __tablename__ = 'plugins'
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(80), nullable=False)
    url = Column(Text, nullable=False)
    credential = Column(Text, nullable=True)
    enabled = Column(Boolean, nullable=False, default=True)
    tools = Column(JSON, nullable=False, default=list)

class PluginAuthorization(Base):
    __tablename__ = 'plugin_authorizations'
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(80), nullable=False)
    url = Column(Text, nullable=False)
    payload = Column(Text, nullable=True)
    state_hash = Column(String(64), nullable=True, unique=True)
    binding_hash = Column(String(64), nullable=True)
    status = Column(String(24), nullable=False, default='discovering')
    created_at = Column(Float, nullable=False)
    plugin_id = Column(String(36), nullable=True)
