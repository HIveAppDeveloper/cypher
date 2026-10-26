"""Authenticated Cypher review UI boundary; not registered as an agent tool."""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.services import sourcing_outreach as service

router = APIRouter(dependencies=[Depends(service.tenant)])


class Proposal(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_id: UUID
    provider: Literal['gmail']
    account_id: UUID
    recipient: EmailStr
    subject: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=20000)

    @field_validator('recipient', mode='before')
    @classmethod
    def single_address(cls, value):
        if not isinstance(value, str) or any(char in value for char in '\r\n\x00<>,; '):
            raise ValueError('Use one exact recipient address without display names or extra headers.')
        return value

    @field_validator('subject')
    @classmethod
    def safe_subject(cls, value):
        if any(ord(char) < 32 for char in value) or not value.strip():
            raise ValueError('Use a nonempty single-line subject.')
        return value

    @field_validator('body')
    @classmethod
    def safe_body(cls, value):
        if '\x00' in value or not value.strip():
            raise ValueError('Use a nonempty plain-text message.')
        return value


class DraftConfirmation(BaseModel):
    model_config = ConfigDict(extra='forbid')
    digest: str = Field(pattern=r'^[0-9a-f]{64}$')
    review_token: str = Field(min_length=32, max_length=80)
    confirmation: Literal['create_gmail_draft_exact_message_and_account']


class Policy(BaseModel):
    model_config = ConfigDict(extra='forbid')
    recipient: EmailStr
    held: bool
    suppressed: bool
    reason: str = Field(default='', max_length=300)


@router.post('')
async def propose(body: Proposal, db: AsyncSession = Depends(get_db)):
    return await service.propose(db, body)


@router.get('/accounts')
async def accounts(db: AsyncSession = Depends(get_db)):
    return await service.accounts(db)


@router.put('/policy')
async def set_policy(body: Policy, db: AsyncSession = Depends(get_db)):
    row = await service.policy(db, body.recipient)
    if row.suppressed and not body.suppressed:
        raise HTTPException(409, 'Suppression cannot be cleared here. An audited reinstatement flow is required.')
    from datetime import datetime
    row.history = [*(row.history or []), {
        'actor':service.tenant(), 'at':datetime.utcnow().isoformat()+'Z',
        'before':{'held':row.held,'suppressed':row.suppressed},
        'after':{'held':body.held,'suppressed':body.suppressed}, 'reason':body.reason,
    }]
    row.held, row.suppressed, row.reason = body.held, body.suppressed, body.reason
    row.updated_at = datetime.utcnow()
    await db.commit()
    return {'recipient':row.recipient, 'held':row.held, 'suppressed':row.suppressed, 'reason':row.reason}


@router.get('/{id}')
async def get(id: UUID, db: AsyncSession = Depends(get_db)):
    return await service.snapshot(db, await service.owned(db, id))


@router.post('/{id}/review')
async def review(id: UUID, db: AsyncSession = Depends(get_db)):
    return await service.review(db, id)


@router.post('/{id}/cancel')
async def cancel(id: UUID, db: AsyncSession = Depends(get_db)):
    return await service.cancel(db, id)


@router.post('/{id}/create-draft')
async def create_draft(id: UUID, body: DraftConfirmation, db: AsyncSession = Depends(get_db)):
    return await service.create_gmail_draft(db, id, body)
