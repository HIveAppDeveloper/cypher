import uuid
from sqlalchemy import Column, String, Text, Boolean, JSON
from app.db.session import Base

class Plugin(Base):
    __tablename__ = 'plugins'
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(80), nullable=False)
    url = Column(Text, nullable=False)
    credential = Column(Text, nullable=True)
    enabled = Column(Boolean, nullable=False, default=True)
    tools = Column(JSON, nullable=False, default=list)
