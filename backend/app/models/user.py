import datetime

from sqlalchemy import Column, DateTime, String

from app.db.session import Base


class User(Base):
    __tablename__ = "users"

    id = Column(String(255), primary_key=True)
    email = Column(String(254), nullable=False, unique=True, index=True)
    display_name = Column(String(200), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow)
