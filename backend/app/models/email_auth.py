import datetime
import uuid

from sqlalchemy import Boolean, Column, DateTime, String, UniqueConstraint

from app.db.session import Base


class EmailLoginToken(Base):
    __tablename__ = "email_login_tokens"
    __table_args__ = (UniqueConstraint("token_hash", name="uq_email_login_token_hash"),)

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String(254), nullable=False, index=True)
    token_hash = Column(String(64), nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False, index=True)
    used = Column(Boolean, nullable=False, default=False, index=True)
    created_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow, index=True)
