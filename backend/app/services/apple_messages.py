"""Same-runtime MSP core, NOT an Apple wire protocol or approved MSP.

Only a future authenticated, reviewed Apple transport may call the *_verified
functions. Nothing here registers an HTTP route, worker hook, model import,
scheduler, or outbound transport. Callers own transaction commit/rollback.
"""
import hashlib
import json
import re
import secrets
from contextlib import contextmanager
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from uuid import NAMESPACE_URL, uuid4, uuid5
from sqlalchemy import func, select, text, update
from app.db.tenancy import current_tenant_id
from app.models.apple_messages import AppleInbound, AppleLinkChallenge, AppleOutbox, AppleThread
from app.models.conversation import Conversation, ConversationParticipant
from app.models.message import Message
from app.models.task import Task
from app.models.workspace import Notification


@contextmanager
def tenant_scope(tenant):
    token = current_tenant_id.set(tenant)
    try:
        yield
    finally:
        current_tenant_id.reset(token)


def _owner():
    owner = current_tenant_id.get()
    if not owner:
        raise ValueError('An authenticated workspace is required.')
    return owner


def _identifier(value, limit):
    if not isinstance(value, str) or not value.strip() or len(value) > limit or any(ord(c) < 32 for c in value):
        raise ValueError('Invalid messaging identifier.')
    return value


def _hash(value):
    return hashlib.sha256(value.encode()).hexdigest()


async def _identity_lock(db, identity):
    if db.bind.dialect.name == 'postgresql':
        await db.execute(text('SELECT pg_advisory_xact_lock(:key)'), {'key': int(_hash(identity)[:15], 16)})


async def _owned_thread(db, thread_id):
    return (await db.execute(select(AppleThread).where(
        AppleThread.id == thread_id, AppleThread.tenant_id == _owner()
    ).with_for_update())).scalar_one_or_none()


async def create_link_challenge(db, conversation_id, *, updates_opt_in=False):
    owner = _owner()
    if not isinstance(updates_opt_in, bool):
        raise ValueError('Update notifications require an explicit true or false choice.')
    room = await db.scalar(select(Conversation.id).where(Conversation.id == conversation_id, Conversation.tenant_id == owner))
    participant = await db.scalar(select(ConversationParticipant.bot_id).where(
        ConversationParticipant.conversation_id == conversation_id, ConversationParticipant.tenant_id == owner).limit(1))
    if not room or not participant:
        raise ValueError('Choose an existing workspace with an agent.')
    code = secrets.token_urlsafe(32)
    db.add(AppleLinkChallenge(token_hash=_hash(code), conversation_id=conversation_id,
        updates_opt_in=bool(updates_opt_in), expires_at=datetime.utcnow() + timedelta(minutes=10)))
    await db.flush()
    return code


async def link_verified_customer(db, *, code, business_id, opaque_id):
    """Owner code + Apple-authenticated opaque identity; never accept browser IDs."""
    business_id = _identifier(business_id, 128)
    opaque_id = _identifier(opaque_id, 1024)
    challenge = (await db.execute(select(AppleLinkChallenge).where(
        AppleLinkChallenge.token_hash == _hash(_identifier(code, 128))
    ).with_for_update().execution_options(skip_tenant_filter=True))).scalar_one_or_none()
    if not challenge or challenge.consumed_at or challenge.expires_at <= datetime.utcnow():
        raise ValueError('This account-linking code is invalid or expired.')
    await _identity_lock(db, business_id + '\0' + opaque_id)
    identity_hash = _hash(opaque_id)
    thread = (await db.execute(select(AppleThread).where(
        AppleThread.business_id == business_id, AppleThread.opaque_hash == identity_hash
    ).with_for_update().execution_options(skip_tenant_filter=True))).scalar_one_or_none()
    if thread and thread.tenant_id != challenge.tenant_id:
        raise ValueError('This Apple identity is already linked. Unlink it in its workspace first.')
    with tenant_scope(challenge.tenant_id):
        room = await db.scalar(select(Conversation.id).where(
            Conversation.id == challenge.conversation_id, Conversation.tenant_id == challenge.tenant_id))
        if not room:
            raise ValueError('The linked workspace no longer exists.')
        if not thread:
            from app.services.plugins import seal
            thread = AppleThread(business_id=business_id, opaque_hash=identity_hash,
                sealed_opaque_id=seal(opaque_id), conversation_id=room)
            db.add(thread)
        thread.conversation_id = room
        thread.state = 'active'
        thread.updates_opt_in = challenge.updates_opt_in
        challenge.consumed_at = datetime.utcnow()
        await db.flush()
        await _queue(db, thread, 'link:' + challenge.token_hash,
            'I’m Cypher, an automated assistant. Your workspace is linked. Send a task to chat, ask for a person for help, or send STOP to stop messages.')
    return thread


async def unlink(db, thread_id):
    thread = await _owned_thread(db, thread_id)
    if not thread:
        raise ValueError('Messaging conversation not found.')
    thread.state = 'closed'
    thread.updates_opt_in = False
    # Release the external identity without transferring the old tenant’s history.
    thread.opaque_hash = _hash('unlinked:' + thread.id)
    thread.sealed_opaque_id = ''
    await _suppress(db, thread)


async def _suppress(db, thread, *, automatic_only=False):
    condition = [AppleOutbox.thread_id == thread.id, AppleOutbox.tenant_id == thread.tenant_id, AppleOutbox.status == 'pending']
    if automatic_only:
        condition.append(~AppleOutbox.source_id.startswith('human:'))
    await db.execute(update(AppleOutbox).where(*condition).values(status='suppressed'))


async def _queue(db, thread, source_id, body):
    if thread.state in {'closed', 'opted_out'}:
        return None
    old = await db.scalar(select(AppleOutbox).where(AppleOutbox.thread_id == thread.id, AppleOutbox.source_id == source_id))
    if old:
        if old.body != body:
            raise ValueError('This outgoing message identifier was already used.')
        return old
    row = AppleOutbox(thread_id=thread.id, source_id=source_id, body=body[:20000])
    db.add(row)
    await db.flush()
    return row


async def accept_verified_event(db, *, business_id, opaque_id, event_id, body='', ended=False):
    """Apple-authenticated envelope only. Private API integration remains gated."""
    business_id = _identifier(business_id, 128)
    opaque_id = _identifier(opaque_id, 1024)
    event_id = _identifier(event_id, 128)
    if not isinstance(body, str) or len(body) > 6000 or (not ended and not body.strip()):
        raise ValueError('Use a nonempty message of up to 6000 characters.')
    thread = (await db.execute(select(AppleThread).where(
        AppleThread.business_id == business_id, AppleThread.opaque_hash == _hash(opaque_id)
    ).with_for_update().execution_options(skip_tenant_filter=True))).scalar_one_or_none()
    if not thread:
        raise ValueError('Link this Apple conversation from an authenticated Cypher workspace first.')
    with tenant_scope(thread.tenant_id):
        digest = _hash(json.dumps([body, ended]))
        previous = await db.scalar(select(AppleInbound).where(AppleInbound.thread_id == thread.id, AppleInbound.event_id == event_id))
        if previous:
            if previous.payload_hash != digest:
                raise ValueError('This incoming event identifier was already used.')
            return {'disposition': previous.disposition, 'task_id': previous.task_id, 'duplicate': True}
        row = AppleInbound(thread_id=thread.id, event_id=event_id, payload_hash=digest, disposition='ignored')
        db.add(row)
        command = body.strip().casefold()
        if ended or command in {'stop', 'unsubscribe'}:
            thread.state = 'closed' if ended else 'opted_out'
            thread.updates_opt_in = False
            await _suppress(db, thread)
            row.disposition = thread.state
        elif thread.state in {'closed', 'opted_out'}:
            row.disposition = 'ignored'
        elif command in {'agent', 'human', 'person', 'talk to a person'}:
            thread.state = 'human_requested'
            row.disposition = 'human_requested'
            await _suppress(db, thread)
            db.add(Notification(id=str(uuid5(NAMESPACE_URL, 'apple-handoff:' + thread.id + ':' + event_id)),
                conversation_id=thread.conversation_id, title='Apple Messages: human requested',
                detail='A customer requested a person. Automated replies are paused for this conversation.'))
            await _queue(db, thread, 'handoff:' + event_id,
                'You’ve requested a person. Automated replies are paused, and your request is in the team’s queue.')
        elif thread.state in {'human_requested', 'human'}:
            row.disposition = 'human'
            db.add(Message(conversation_id=thread.conversation_id, sender_type='user', content=body,
                metadata_json={'source': 'apple_messages', 'apple_thread_id': thread.id}))
        else:
            recent = await db.scalar(select(func.count()).select_from(AppleInbound).where(
                AppleInbound.thread_id == thread.id, AppleInbound.created_at > datetime.utcnow() - timedelta(minutes=1)))
            queued = await db.scalar(select(func.count()).select_from(Task).where(Task.status.in_(['pending', 'running'])))
            if recent > 10 or queued >= 20:
                raise ValueError('The workspace message queue is full. Try again shortly.')
            participant = await db.scalar(select(ConversationParticipant.bot_id).where(
                ConversationParticipant.conversation_id == thread.conversation_id).limit(1))
            if not participant:
                raise ValueError('The linked workspace needs an agent.')
            message_id = str(uuid4())
            task = Task(id=str(uuid4()), conversation_id=thread.conversation_id, bot_id=participant,
                title=body[:100], description=body, status='pending', result={'request': {
                    'incoming_message_id': message_id, 'apple_thread_id': thread.id,
                    'options': {'routing': 'auto', 'provider': 'openai', 'model': 'gpt-6.1-sol',
                        'max_tokens': 2048, 'max_iterations': 8, 'reasoning_effort': 'low', 'team_rounds': 1}}})
            db.add(task)
            db.add(Message(id=message_id, conversation_id=thread.conversation_id, sender_type='user', content=body,
                metadata_json={'task_id': task.id, 'source': 'apple_messages', 'apple_thread_id': thread.id}))
            row.task_id = task.id
            row.disposition = 'queued'
        await db.flush()
        return {'disposition': row.disposition, 'task_id': row.task_id, 'duplicate': False}


async def queue_task_result(db, task):
    if task.tenant_id != _owner() or task.status not in {'completed', 'failed', 'interrupted', 'cancelled'}:
        return
    origin = (task.result or {}).get('request', {}).get('apple_thread_id')
    threads = (await db.execute(select(AppleThread).where(
        AppleThread.tenant_id == task.tenant_id, AppleThread.conversation_id == task.conversation_id,
        AppleThread.state == 'active').with_for_update())).scalars().all()
    public = [r.get('content', '') for r in (task.result or {}).get('responses', [])
        if r.get('sender_type') == 'bot' and not (r.get('metadata') or {}).get('internal')]
    body = ('Finished: ' if task.status == 'completed' else 'Needs attention: ') + task.title[:160]
    if public:
        body += '\n' + '\n'.join(public)[:1800]
    for thread in threads:
        if thread.id == origin or thread.updates_opt_in:
            await _queue(db, thread, 'task:' + task.id, body)


async def queue_human_reply(db, thread_id, *, body, client_message_id):
    thread = await _owned_thread(db, thread_id)
    if not thread or thread.state in {'closed', 'opted_out'}:
        raise ValueError('This conversation is unavailable or has opted out.')
    if not isinstance(body, str) or not body.strip() or len(body) > 6000:
        raise ValueError('Use a nonempty reply of up to 6000 characters.')
    thread.state = 'human'
    await _suppress(db, thread, automatic_only=True)
    return await _queue(db, thread, 'human:' + _identifier(client_message_id, 128), body)


async def claim_outbound(db, *, apple_transport_approved=False):
    # No default sending. Approval and a reviewed native transport are separate gates.
    if not apple_transport_approved:
        return None
    candidate = await db.scalar(select(AppleOutbox).where(AppleOutbox.status == 'pending')
        .order_by(AppleOutbox.created_at, AppleOutbox.id).limit(1).execution_options(skip_tenant_filter=True))
    if not candidate:
        return None
    with tenant_scope(candidate.tenant_id):
        # Match the incoming/opt-out lock order: thread first, then outbox.
        thread = await _owned_thread(db, candidate.thread_id)
        row = await db.scalar(select(AppleOutbox).where(AppleOutbox.id == candidate.id,
            AppleOutbox.status == 'pending').with_for_update(skip_locked=True))
        if not row:
            return None
        if not thread or thread.state in {'closed', 'opted_out'}:
            row.status = 'suppressed'
            return None
        row.status = 'sending'
        row.attempted_at = datetime.utcnow()
        await db.flush()
    # Caller MUST commit this claim before performing any provider write.
    # A crash/timeout leaves 'sending' for reconciliation, never an automatic resend.
    return row


def _reported_cost(cost, currency):
    if cost is None:
        if currency is not None:
            raise ValueError('Currency requires a reported cost.')
        return None
    try:
        amount = Decimal(str(cost))
    except InvalidOperation:
        raise ValueError('Use a finite, nonnegative reported provider cost.') from None
    if not amount.is_finite() or amount < 0 or amount > Decimal('9999999999') or not re.fullmatch('[A-Z]{3}', currency or ''):
        raise ValueError('Use a finite, nonnegative provider cost and ISO currency.')
    if amount != amount.quantize(Decimal('.00000001')):
        raise ValueError('Reported costs support up to eight decimal places.')
    return amount


async def settle_outbound(db, message_id, *, provider_reference=None, cost=None, currency=None):
    amount = _reported_cost(cost, currency)
    row = await db.scalar(select(AppleOutbox).where(AppleOutbox.id == message_id,
        AppleOutbox.tenant_id == _owner()).with_for_update())
    if not row:
        raise ValueError('Outgoing message not found.')
    if row.status == 'sent' and row.provider_reference == provider_reference:
        if amount is not None:
            if row.reported_cost is not None and (row.reported_cost != amount or row.currency != currency):
                raise ValueError('A different provider cost is already recorded; reconcile it explicitly.')
            row.reported_cost = amount
            row.currency = currency
        return row
    if row.status not in {'sending', 'uncertain'}:
        raise ValueError('Only a claimed outgoing message can be settled.')
    if provider_reference is None:
        if amount is not None:
            raise ValueError('Reported cost requires a provider delivery reference.')
        row.status = 'uncertain'
        return row
    reference = _identifier(provider_reference, 256)
    row.status = 'sent'
    row.provider_reference = reference
    row.reported_cost = amount
    row.currency = currency
    return row
