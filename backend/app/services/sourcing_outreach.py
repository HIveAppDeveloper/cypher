"""Create a reviewed Gmail draft for an authenticated Cypher workspace.

This service never sends email. Draft creation is a separate, explicit action
after the signed-in user confirms the exact recipient, account and message.
"""
import base64
import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.policy import SMTP

from fastapi import HTTPException
from pydantic import EmailStr, TypeAdapter
from sqlalchemy import select, text, update
from sqlalchemy.exc import IntegrityError

from app.db.tenancy import current_tenant_id
from app.models.plugin import Plugin, PluginAuthorization
from app.models.sourcing_outreach import SourcingMailPolicy, SourcingOutreach
from app.services import google_workspace as google
from app.services.plugin_auth import DatabaseTokenStorage

FLOW_REVISION = 'cypher-vc-gmail-draft-v1'
REVIEW_MINUTES = 10


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def envelope(provider, account_id, binding, sender, recipient, subject, body):
    return digest([tenant(), provider, account_id, binding, sender, recipient, subject, body, FLOW_REVISION])


def sender_address(value):
    try:
        if not isinstance(value, str) or any(char in value for char in '\r\n\x00<>,; '):
            raise ValueError()
        return str(TypeAdapter(EmailStr).validate_python(value))
    except ValueError:
        raise HTTPException(409, 'The connected Gmail account has no usable verified email address.') from None


def tenant():
    value = current_tenant_id.get()
    if not value:
        raise HTTPException(401, 'Sign in to prepare a Gmail draft.')
    return value


async def lock_key(db, key):
    # Tenant/digest and recipient policy locks serialize independently of the
    # number of API replicas. SQLite fixtures also exercise conditional claims.
    if db.bind.dialect.name == 'postgresql':
        value = int.from_bytes(hashlib.sha256(key.encode()).digest()[:8], 'big', signed=True)
        await db.execute(text('SELECT pg_advisory_xact_lock(:key)'), {'key': value})


async def account(db, provider, account_id):
    if provider != 'gmail':
        raise HTTPException(422, 'Choose a connected Gmail account to prepare this draft.')
    row = (await db.execute(select(PluginAuthorization).where(
        PluginAuthorization.id == account_id, PluginAuthorization.tenant_id == tenant(),
        PluginAuthorization.status == 'connected',
    ).execution_options(populate_existing=True))).scalar_one_or_none()
    if row is None:
        raise HTTPException(409, 'This Gmail account is not connected to your workspace.')
    try:
        saved = DatabaseTokenStorage(db, row).read()
        if not isinstance(saved, dict):
            raise ValueError()
    except Exception:
        raise HTTPException(409, 'Reconnect Gmail in Apps; its saved permission cannot be read.') from None
    plugin = await db.get(Plugin, row.plugin_id, populate_existing=True) if row.plugin_id else None
    if not plugin or not plugin.enabled or plugin.tenant_id != tenant():
        raise HTTPException(409, 'Enable the connected Gmail account in Apps before preparing a draft.')
    from app.services.plugins import is_google_workspace
    scopes = set(saved.get('scopes', []))
    tools = {item['name'] for item in plugin.tools if item.get('enabled', True)}
    if (row.url != google.GRANT_URL or not is_google_workspace(plugin)
            or not saved.get('subject') or not saved.get('email') or not saved.get('verified_at')
            or 'gmail' not in saved.get('groups', []) or 'gmail_compose_draft' not in tools
            or not scopes.intersection({google.PREFIX+'gmail.modify', google.PREFIX+'gmail.compose', 'https://mail.google.com/'})):
        raise HTTPException(409, 'This Gmail account needs draft access. Review its Google permissions in Apps.')
    sender = sender_address(saved['email'])
    identity = {'provider':provider, 'grant':row.id, 'subject':saved['subject'],
                'email':saved['email'], 'scopes':sorted(scopes), 'plugin':plugin.id}
    return row, saved, sender, digest(identity)


async def accounts(db):
    output = []
    for row in (await db.execute(select(PluginAuthorization).where(
        PluginAuthorization.tenant_id == tenant(), PluginAuthorization.status == 'connected',
        PluginAuthorization.url == google.GRANT_URL,
    ))).scalars():
        provider = 'gmail'
        try:
            _, _, sender, _ = await account(db, provider, row.id)
            output.append({'id':row.id, 'provider':provider, 'sender':sender, 'available':True})
        except HTTPException as error:
            output.append({'id':row.id, 'provider':provider, 'available':False, 'detail':error.detail})
    return {'accounts':output}


async def owned(db, id, lock=False):
    query = select(SourcingOutreach).where(SourcingOutreach.id == str(id), SourcingOutreach.tenant_id == tenant())
    if lock:
        query = query.with_for_update()
    row = (await db.execute(query.execution_options(populate_existing=True))).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, 'Outreach proposal not found.')
    return row


async def policy(db, recipient):
    key = digest([tenant(), recipient.lower()])
    await lock_key(db, 'sourcing-policy:'+key)
    row = (await db.execute(select(SourcingMailPolicy).where(
        SourcingMailPolicy.id == key, SourcingMailPolicy.tenant_id == tenant(),
    ).with_for_update())).scalar_one_or_none()
    if row is None:
        row = SourcingMailPolicy(id=key, recipient=recipient.lower())
        db.add(row)
        await db.flush()
    return row


def public(row, include_review_token=False):
    def wire(value):
        if isinstance(value, datetime):
            aware = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
            return aware.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')
        return value
    now = datetime.utcnow()
    output = {key:wire(getattr(row, key)) for key in (
        'id', 'provider', 'account_id', 'sender', 'recipient', 'subject', 'body',
        'status', 'digest', 'review_expires_at', 'approved_at', 'approved_by',
        'not_before', 'attempted_at', 'completed_at', 'gmail_draft_id', 'detail',
    )} | {'flow_revision':FLOW_REVISION, 'email_sent':False,
         'automatic_draft_creation':False, 'automatic_send':False, 'weekly_cron_enabled':False,
         'server_time':wire(now), 'review_expired':row.review_expires_at <= now}
    if include_review_token:
        output['review_token'] = row.review_token
    return output


async def snapshot(db, row, include_review_token=False):
    # Read only: no default policy insertion, nonce rotation or state transition.
    controls = (await db.execute(select(SourcingMailPolicy).where(
        SourcingMailPolicy.id == digest([tenant(), row.recipient.lower()]),
        SourcingMailPolicy.tenant_id == tenant(),
    ).execution_options(populate_existing=True))).scalar_one_or_none()
    held, suppressed = bool(controls and controls.held), bool(controls and controls.suppressed)
    expired = row.review_expires_at <= datetime.utcnow()
    review_state = row.status in {'awaiting_approval','held','expired','denied','failed'} or (row.status == 'queued' and expired)
    blocker = ('recipient_suppressed' if suppressed else 'recipient_held' if held
               else 'provider_attempt_exists' if row.attempted_at else 'proposal_state' if not review_state else None)
    return public(row, include_review_token) | {
        'recipient_policy':{'held':held, 'suppressed':suppressed},
        'review_eligible':blocker is None,
        'review_blocker':blocker,
        'creation_eligible':not held and not suppressed and not row.attempted_at and row.status=='awaiting_approval' and not expired,
    }


async def propose(db, data):
    if data.provider != 'gmail':
        raise HTTPException(422, 'Choose Gmail to prepare this draft.')
    _, _, sender, binding = await account(db, data.provider, str(data.account_id))
    content_hash = envelope(data.provider, str(data.account_id), binding, sender, data.recipient, data.subject, data.body)
    await lock_key(db, 'sourcing-envelope:'+content_hash)
    by_request = (await db.execute(select(SourcingOutreach).where(
        SourcingOutreach.tenant_id == tenant(), SourcingOutreach.request_id == str(data.request_id),
    ))).scalar_one_or_none()
    if by_request:
        if by_request.digest != content_hash:
            raise HTTPException(409, 'This request identifier belongs to different content or a different account.')
        return await snapshot(db, by_request)
    existing = (await db.execute(select(SourcingOutreach).where(
        SourcingOutreach.tenant_id == tenant(), SourcingOutreach.digest == content_hash,
    ))).scalar_one_or_none()
    if existing:
        return await snapshot(db, existing)
    controls = await policy(db, data.recipient)
    row = SourcingOutreach(request_id=str(data.request_id), digest=content_hash,
        provider=data.provider, account_id=str(data.account_id), account_binding=binding,
        sender=sender, recipient=data.recipient, subject=data.subject, body=data.body,
        status='held' if controls.held or controls.suppressed else 'awaiting_approval',
        review_token=secrets.token_urlsafe(32), review_expires_at=datetime.utcnow()+timedelta(minutes=REVIEW_MINUTES))
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        # A replica may have won the same request/envelope. Never return success
        # for a reused request ID with different content.
        existing = (await db.execute(select(SourcingOutreach).where(
            SourcingOutreach.tenant_id == tenant(), SourcingOutreach.request_id == str(data.request_id),
        ))).scalar_one_or_none()
        if existing and existing.digest != content_hash:
            raise HTTPException(409, 'This request identifier belongs to different content or a different account.') from None
        if not existing:
            existing = (await db.execute(select(SourcingOutreach).where(
                SourcingOutreach.tenant_id == tenant(), SourcingOutreach.digest == content_hash,
            ))).scalar_one()
        return await snapshot(db, existing)
    return await snapshot(db, row)


async def review(db, id):
    row = await owned(db, id, True)
    expired_queued = row.status == 'queued' and row.review_expires_at <= datetime.utcnow()
    if (row.status not in {'awaiting_approval', 'held', 'expired', 'denied', 'failed'} and not expired_queued) or row.attempted_at:
        raise HTTPException(409, 'This email cannot be confirmed again. Check Gmail Drafts before trying another.')
    controls = await policy(db, row.recipient)
    if controls.held or controls.suppressed:
        raise HTTPException(409, 'This recipient is on hold or opted out. Cypher cannot create a draft for them.')
    row.review_token = secrets.token_urlsafe(32)
    row.review_expires_at = datetime.utcnow()+timedelta(minutes=REVIEW_MINUTES)
    row.approved_at = row.not_before = row.approved_by = None
    row.status = 'awaiting_approval'
    await db.commit()
    return await snapshot(db, row, include_review_token=True)


async def cancel(db, id):
    row = await owned(db, id, True)
    if row.attempted_at or row.status in {'creating_draft', 'draft_unknown', 'unknown', 'draft_created'}:
        raise HTTPException(409, 'Gmail draft creation has started. Check Gmail Drafts before taking another action.')
    cancelled = await db.execute(update(SourcingOutreach).where(
        SourcingOutreach.id == row.id, SourcingOutreach.tenant_id == tenant(),
        SourcingOutreach.attempted_at.is_(None),
        SourcingOutreach.status.not_in(['creating_draft','draft_unknown','unknown','draft_created']),
    ).values(status='cancelled'))
    await db.commit()
    if cancelled.rowcount != 1:
        raise HTTPException(409, 'Gmail draft creation has started. Check Gmail Drafts before taking another action.')
    return await snapshot(db, await owned(db, id))


async def create_gmail_draft(db, id, confirmation):
    row = await owned(db, id, True)
    if row.status == 'draft_created' or row.attempted_at:
        return await snapshot(db, row)
    if row.status != 'awaiting_approval':
        raise HTTPException(409, 'Review this email again before creating its Gmail draft.')
    if (not secrets.compare_digest(confirmation.digest, row.digest)
            or not secrets.compare_digest(confirmation.review_token, row.review_token)):
        raise HTTPException(409, 'This email changed or the review expired. Review it again before creating a draft.')
    if row.review_expires_at <= datetime.utcnow():
        row.status = 'expired'; await db.commit(); return await snapshot(db, row)
    controls = await policy(db, row.recipient)
    if controls.held or controls.suppressed:
        row.status = 'held'; await db.commit()
        raise HTTPException(409, 'This recipient is on hold or opted out. No Gmail draft was created.')
    grant, _, sender, binding = await account(db, row.provider, row.account_id)
    if binding != row.account_binding or sender != row.sender:
        raise HTTPException(409, 'The Gmail account changed. Review the email again before creating a draft.')
    if envelope(row.provider,row.account_id,binding,sender,row.recipient,row.subject,row.body) != row.digest:
        raise HTTPException(409, 'The email changed. Review it again before creating a draft.')
    # The user's explicit button click is recorded durably before Gmail is called.
    claimed = await db.execute(update(SourcingOutreach).where(
        SourcingOutreach.id == row.id, SourcingOutreach.tenant_id == tenant(),
        SourcingOutreach.status == 'awaiting_approval', SourcingOutreach.attempted_at.is_(None),
        SourcingOutreach.review_expires_at > datetime.utcnow(),
    ).values(status='creating_draft', attempted_at=datetime.utcnow(), approved_at=datetime.utcnow(),
             approved_by=tenant(), not_before=datetime.utcnow()))
    await db.commit()  # Durable intent before creating the Gmail draft.
    if claimed.rowcount != 1:
        return await snapshot(db, await owned(db, id))
    await db.refresh(row)
    try:
        token = await google.access_token(db, grant)
        message = EmailMessage(policy=SMTP)
        message['From'], message['To'], message['Subject'] = row.sender, row.recipient, row.subject
        message['Message-ID'] = '<cypher-'+row.id+'@'+row.sender.rsplit('@', 1)[1]+'>'
        message.set_content(row.body)
        result = await google.api_request(token, 'POST', 'https://gmail.googleapis.com/gmail/v1/users/me/drafts',
            body={'message':{'raw':base64.urlsafe_b64encode(message.as_bytes()).decode()}})
        draft_id = result.get('id') if isinstance(result, dict) else None
        if not isinstance(draft_id, str) or not draft_id.strip() or len(draft_id) > 256:
            raise ValueError('Gmail did not return a draft ID')
        row.gmail_draft_id = draft_id
        row.status = 'draft_created'
        row.detail = {'code':'gmail_draft_created', 'message':'Gmail saved this as a draft. Cypher did not send the email.'}
    except HTTPException as error:
        row.status = 'failed' if error.status_code in {400,401,403,404,413,422,429} else 'draft_unknown'
        row.detail = {'code':'gmail_rejected' if row.status == 'failed' else 'draft_outcome_unknown',
                      'message':'Cypher could not confirm the draft. Check Gmail Drafts before trying again.'}
    except Exception:
        row.status = 'draft_unknown'
        row.detail = {'code':'draft_outcome_unknown', 'message':'Cypher could not confirm the draft. Check Gmail Drafts before trying again.'}
    # Cancellation/process death leaves creating_draft durable and non-reclaimable.
    row.completed_at = datetime.utcnow()
    await db.commit()
    return await snapshot(db, row)
