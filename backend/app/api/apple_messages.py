"""Workspace management only. No Apple ingress, transport or operator privilege."""
from datetime import datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, StrictBool
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.db.tenancy import current_tenant_id
from app.models.apple_messages import AppleOutbox, AppleThread
from app.services import apple_messages as service


def workspace():
    owner = current_tenant_id.get()
    if not owner:
        raise HTTPException(401, 'Sign in to continue.')
    return owner


def private_response(response: Response):
    response.headers['Cache-Control'] = 'private, no-store'


router = APIRouter(dependencies=[Depends(workspace), Depends(private_response)])


class UpdateConsent(BaseModel):
    model_config = ConfigDict(extra='forbid')
    updates_opt_in: StrictBool


def snapshot(thread):
    # Never expose Apple identity hashes, encrypted identifiers or message bodies.
    return {'id': thread.id, 'conversation_id': thread.conversation_id,
            'state': thread.state, 'updates_opt_in': thread.updates_opt_in,
            'created_at': thread.created_at.isoformat() + 'Z'}


@router.get('/status')
async def status():
    return {'channel': 'apple_messages_for_business',
            'native_transport_available': False, 'can_link': False, 'can_send': False,
            'setup_state': 'provider_integration_required',
            'apple_approval_verified': False,
            'required_steps': ['apple_msp_onboarding', 'authorized_transport',
                               'staffed_human_handoff', 'device_testing_and_experience_review']}


@router.get('/threads')
async def threads(limit: int = Query(50, ge=1, le=100), db: AsyncSession = Depends(get_db)):
    rows = (await db.scalars(select(AppleThread).where(AppleThread.tenant_id == workspace())
            .order_by(AppleThread.created_at.desc(), AppleThread.id).limit(limit + 1))).all()
    return {'threads': [snapshot(row) for row in rows[:limit]], 'has_more': len(rows) > limit}


@router.patch('/threads/{thread_id}')
async def update_consent(thread_id: UUID, body: UpdateConsent, db: AsyncSession = Depends(get_db)):
    try:
        row = await service.set_updates_opt_in(db, str(thread_id), body.updates_opt_in)
    except LookupError as error:
        raise HTTPException(404, str(error)) from None
    except ValueError as error:
        raise HTTPException(409, str(error)) from None
    await db.commit()
    return snapshot(row)


@router.delete('/threads/{thread_id}')
async def disconnect(thread_id: UUID, db: AsyncSession = Depends(get_db)):
    # Lock lookup before revocation; foreign and unknown IDs have the same result.
    row = await service._owned_thread(db, str(thread_id))
    if row is None:
        raise HTTPException(404, 'Messaging conversation not found.')
    await service.unlink(db, row.id)
    await db.commit()
    return snapshot(row)


@router.get('/usage')
async def usage(hours: int = Query(720, ge=1, le=744), db: AsyncSession = Depends(get_db)):
    owner, now = workspace(), datetime.utcnow()
    start = now - timedelta(hours=hours)
    scope = (AppleOutbox.tenant_id == owner, AppleOutbox.created_at >= start, AppleOutbox.created_at <= now)
    counts = (await db.execute(select(AppleOutbox.status, func.count()).where(*scope)
                              .group_by(AppleOutbox.status))).all()
    costs = (await db.execute(select(AppleOutbox.currency, func.sum(AppleOutbox.reported_cost), func.count())
                .where(*scope, AppleOutbox.status == 'sent', AppleOutbox.reported_cost.is_not(None),
                       AppleOutbox.currency.is_not(None)).group_by(AppleOutbox.currency))).all()
    missing = await db.scalar(select(func.count()).select_from(AppleOutbox).where(
        *scope, AppleOutbox.status == 'sent', AppleOutbox.reported_cost.is_(None)))
    return {'from': start.isoformat() + 'Z', 'to': now.isoformat() + 'Z',
            'message_counts': dict(counts), 'unreported_sent_messages': missing,
            'reported_provider_costs': [{'currency': currency, 'amount': format(amount, '.8f'),
                                         'messages': count} for currency, amount, count in sorted(costs)],
            'window_basis': 'message_created_at', 'billing_status': 'reporting_only', 'is_invoice': False}
