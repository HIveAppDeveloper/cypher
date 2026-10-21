"""Passwordless account creation and ownership binding."""

import hashlib
import os
import re
import secrets
from datetime import datetime, timedelta
from urllib.parse import quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.session import Base, get_db
from app.db.tenancy import TenantScoped, current_tenant_id
from app.models.email_auth import EmailLoginToken
from app.models.user import User

router = APIRouter()
LEGACY_TENANT_ID = "legacy-owner"


class EmailLoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)


def normalize_email(value: str) -> str:
    email = value.strip().lower()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email):
        raise HTTPException(status_code=422, detail="Enter a valid email address.")
    return email


def account_id_for(email: str) -> str:
    return "email:" + hashlib.sha256(email.encode("utf-8")).hexdigest()


async def send_magic_link(email: str, raw_token: str) -> None:
    key = os.getenv("GROKBOT_RESEND_API_KEY", "").strip()
    if not key:
        raise HTTPException(status_code=503, detail="Email sign-in is not configured yet.")
    link = f"{settings.GROKBOT_PUBLIC_URL.rstrip('/')}/api/auth/email/verify?token={quote(raw_token, safe='')}"
    payload = {
        "from": settings.GROKBOT_AUTH_FROM,
        "to": [email],
        "subject": "Your Open GrokBot sign-in link",
        "text": f"Open your workspace: {link}\n\nThis link expires in 15 minutes and works once. If you did not request it, ignore this email.",
        "html": f"<p>Open your Open GrokBot workspace.</p><p><a href=\"{link}\">Continue securely</a></p><p>This link expires in 15 minutes and works once.</p>",
    }
    try:
        async with httpx.AsyncClient(timeout=12, follow_redirects=False) as client:
            response = await client.post("https://api.resend.com/emails", headers={"Authorization": f"Bearer {key}"}, json=payload)
        if not response.is_success:
            raise HTTPException(status_code=503, detail="Email sign-in could not send a message right now.")
    except httpx.HTTPError as error:
        raise HTTPException(status_code=503, detail="Email sign-in is temporarily unavailable.") from error


@router.post("/email/request")
async def request_email_login(data: EmailLoginRequest, request: Request, db: AsyncSession = Depends(get_db)):
    email = normalize_email(data.email)
    now = datetime.utcnow()
    recent = (await db.execute(select(EmailLoginToken).where(EmailLoginToken.email == email, EmailLoginToken.created_at >= now - timedelta(seconds=60)).order_by(EmailLoginToken.created_at.desc()).limit(1))).scalar_one_or_none()
    if recent:
        return {"sent": True, "detail": "If that address can receive mail, a sign-in link is on its way."}
    raw_token = secrets.token_urlsafe(32)
    challenge = EmailLoginToken(email=email, token_hash=hashlib.sha256(raw_token.encode()).hexdigest(), expires_at=now + timedelta(minutes=max(5, min(30, settings.AUTH_MAGIC_LINK_TTL_MINUTES))))
    db.add(challenge)
    await db.commit()
    try:
        await send_magic_link(email, raw_token)
    except HTTPException:
        await db.delete(challenge)
        await db.commit()
        raise
    return {"sent": True, "detail": "If that address can receive mail, a sign-in link is on its way."}


@router.get("/email/verify")
async def verify_email_login(token: str, request: Request, db: AsyncSession = Depends(get_db)):
    if not isinstance(token, str) or not 32 <= len(token) <= 256:
        raise HTTPException(status_code=400, detail="That sign-in link is invalid or expired.")
    now = datetime.utcnow()
    digest = hashlib.sha256(token.encode()).hexdigest()
    challenge = (await db.execute(select(EmailLoginToken).where(EmailLoginToken.token_hash == digest, EmailLoginToken.used.is_(False), EmailLoginToken.expires_at > now).with_for_update())).scalar_one_or_none()
    if not challenge:
        raise HTTPException(status_code=400, detail="That sign-in link is invalid or expired.")
    email = normalize_email(challenge.email)
    owner = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    account_id = owner.id if owner else account_id_for(email)
    if owner is None:
        owner = User(id=account_id, email=email, display_name=email.split("@", 1)[0][:200])
        db.add(owner)
    # Retry ownership binding on a later verified sign-in if configuration was
    # added after the account was first created. Never assign legacy data to an
    # arbitrary first registrant.
    if settings.LEGACY_OWNER_EMAIL.strip().lower() == email:
        for mapper in Base.registry.mappers:
            model = mapper.class_
            if isinstance(model, type) and issubclass(model, TenantScoped):
                await db.execute(update(model).where(model.tenant_id == LEGACY_TENANT_ID).values(tenant_id=account_id).execution_options(skip_tenant_filter=True))
    challenge.used = True
    tenant_token = current_tenant_id.set(account_id)
    try:
        await db.commit()
    finally:
        current_tenant_id.reset(tenant_token)
    return {"id": account_id, "email": owner.email, "display_name": owner.display_name}


@router.get("/me")
async def current_user(request: Request, db: AsyncSession = Depends(get_db)):
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="Sign in again to finish setting up your account.")
    return {"id": user.id, "email": user.email, "display_name": user.display_name}
