from sqlalchemy import Column, String, DateTime
from app.db.session import Base
class RuntimeHeartbeat(Base):
    __tablename__='runtime_heartbeats'
    name=Column(String,primary_key=True)
    updated_at=Column(DateTime,nullable=False)
