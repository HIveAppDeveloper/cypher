from sqlalchemy import Column, String, DateTime, JSON
from app.db.session import Base
class RuntimeHeartbeat(Base):
    __tablename__='runtime_heartbeats'
    name=Column(String,primary_key=True)
    updated_at=Column(DateTime,nullable=False)

class RuntimeCheck(Base):
    __tablename__='runtime_checks'
    name=Column(String,primary_key=True)
    status=Column(String,nullable=False)
    detail=Column(JSON,nullable=False)
    updated_at=Column(DateTime,nullable=False)
