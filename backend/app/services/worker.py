"""Single-leader persisted runner with bounded independent chat execution."""
import asyncio
import logging
import os
import time
import uuid
from contextlib import suppress
from datetime import datetime
from dataclasses import dataclass
from sqlalchemy import select, update, text
from app.db.session import AsyncSessionLocal, engine
from app.db.tenancy import current_tenant_id
from app.models.task import Task
from app.models.runtime import RuntimeCheck
from app.models.execution import TaskExecution
from app.services.execution import retry_or_interrupt, ExecutionSuperseded
from app.services.orchestrator import AgentOrchestrator
logger = logging.getLogger(__name__)
POLL_SECONDS = 2
MAX_ACTIVE_TASKS = 2
PROCESS_BOOT_ID = uuid.uuid4().hex
PROCESS_STARTED_AT = datetime.utcnow().isoformat()+'Z'

async def run_worker(stop_event=None):
    stop_event = stop_event or asyncio.Event()
    # Hold a dedicated Postgres session lock across the loop. During rolling
    # deployments the next worker waits until the old one exits; it cannot
    # claim the same pending task or interrupt another live worker's work.
    if engine.dialect.name == "postgresql":
        async with engine.connect() as lock_connection:
            # PostgreSQL waits for the active owner to release the lock. The
            # standby no longer sends a query every two seconds, all day.
            acquired = asyncio.create_task(lock_connection.scalar(text('SELECT pg_advisory_lock(1763000274)')))
            stopped = asyncio.create_task(stop_event.wait())
            try:
                await asyncio.wait({acquired,stopped},return_when=asyncio.FIRST_COMPLETED)
                if stop_event.is_set():
                    acquired.cancel()
                    with suppress(asyncio.CancelledError):await acquired
                    return
                await acquired
                await lock_connection.commit()
            finally:
                stopped.cancel()
                with suppress(asyncio.CancelledError):await stopped
            owner_pid = await lock_connection.scalar(text("SELECT pg_backend_pid()"))
            await lock_connection.commit()
            from app.db.wakeup import CHANNEL
            wake = asyncio.Event()
            raw = await lock_connection.get_raw_connection()
            driver = raw.driver_connection
            def notify(*args):wake.set()
            await driver.add_listener(CHANNEL,notify)
            try:
                await _run_with_catalog(lock_connection, owner_pid, stop_event, wake)
            finally:
                with suppress(Exception):
                    await driver.remove_listener(CHANNEL,notify)
                    await lock_connection.execute(text("SELECT pg_advisory_unlock(1763000274)"))
                    await lock_connection.commit()
    else:
        await _run_with_catalog(stop_event=stop_event)

async def _run_with_catalog(lock_connection=None, owner_pid=None, stop_event=None, wake=None):
    from app.services.plugin_sync import run
    catalog_task=asyncio.create_task(run(stop_event, AsyncSessionLocal))
    try:
        await _run_worker_loop(lock_connection, owner_pid, stop_event, wake)
    finally:
        catalog_task.cancel()
        with suppress(asyncio.CancelledError):await catalog_task

async def heartbeat():
    from app.models.runtime import RuntimeHeartbeat
    from app.services.verification import record
    from app.services.runtime_identity import runtime_identity
    async with AsyncSessionLocal() as db:
        if db.bind.dialect.name == 'postgresql':
            from sqlalchemy.dialects.postgresql import insert
            now = datetime.utcnow()
            values = [{'name':'worker','updated_at':now}]
            statement = insert(RuntimeHeartbeat).values(values)
            await db.execute(statement.on_conflict_do_update(index_elements=['name'],set_={'updated_at':statement.excluded.updated_at}))
            statement = insert(RuntimeCheck).values(name='worker_release',status='running',detail={**runtime_identity(),'boot_id':PROCESS_BOOT_ID,'boot_started_at':PROCESS_STARTED_AT},updated_at=now)
            await db.execute(statement.on_conflict_do_update(index_elements=['name'],set_={'detail':statement.excluded.detail,'updated_at':now}))
            await db.commit()
            return
        item = await db.get(RuntimeHeartbeat, "worker")
        if item is None:
            item = RuntimeHeartbeat(name="worker", updated_at=datetime.utcnow())
            db.add(item)
        else: item.updated_at = datetime.utcnow()
        release = await db.get(RuntimeCheck, 'worker_release')
        if release is None:
            db.add(RuntimeCheck(name='worker_release', status='running', detail={**runtime_identity(), 'boot_id':PROCESS_BOOT_ID, 'boot_started_at':PROCESS_STARTED_AT}, updated_at=datetime.utcnow()))
        else:
            release.detail = {**runtime_identity(), 'boot_id':PROCESS_BOOT_ID, 'boot_started_at':PROCESS_STARTED_AT}
            release.updated_at = datetime.utcnow()
        await db.commit()

async def _run_worker_loop(lock_connection=None, owner_pid=None, stop_event=None, wake=None):
    stop_event = stop_event or asyncio.Event()
    if stop_event.is_set(): return
    last_heartbeat = 0
    async def pulse():
        nonlocal last_heartbeat
        if time.monotonic() - last_heartbeat < (30 if lock_connection is not None else 5): return
        if lock_connection is not None:
            pid = await lock_connection.scalar(text("SELECT pg_backend_pid()"))
            await lock_connection.commit()
            if pid != owner_pid: raise ExecutionSuperseded("Worker lost its PostgreSQL session lock")
        await heartbeat()
        last_heartbeat = time.monotonic()
    # Only the lock owner recovers work. Completed steps are replayed from SQL;
    # ambiguous external writes still require review.
    async with AsyncSessionLocal() as db:
        from app.models.bot import Bot
        await db.execute(update(Bot).where(Bot.status=='working').values(status='idle'))
        abandoned = (await db.execute(select(Task).where(Task.status == 'running'))).scalars().all()
        for task in abandoned:
            owner=current_tenant_id.set(task.tenant_id)
            try:
                await retry_or_interrupt(db, task, immediate=True)
                if task.status in {'failed','interrupted'}:
                    from app.services.workspace import notify_finished
                    await notify_finished(db,task)
                await db.flush()
            finally:current_tenant_id.reset(owner)
        await db.execute(update(Task).where(Task.status == "cancel_requested").values(status="cancelled", completed_at=datetime.utcnow(), result={"note":"Worker restarted after cancellation. Review any in-flight external actions."}))
        await db.commit()
    async def run_checks(force=False):
        from app.services.verification import verify_cloud
        check = asyncio.create_task(verify_cloud(force=force))
        try:
            while not check.done():
                await pulse()
                await asyncio.wait({check}, timeout=5)
            await check
        finally:
            if not check.done():
                check.cancel()
                with suppress(asyncio.CancelledError): await check
    async with AsyncSessionLocal() as db:
        previous = await db.get(RuntimeCheck, 'check_request')
        if previous and previous.status == 'running':
            previous.status = 'pending'
            await db.commit()
    from app.services.model_connections import recover_checks
    await recover_checks(AsyncSessionLocal)
    from app.services.prospecting import recover as recover_prospecting
    await recover_prospecting(AsyncSessionLocal)
    if os.getenv("GROKBOT_VERIFY_CLOUD") == "true":
        await run_checks()
    from app.db.wakeup import wait_for_work
    from app.models.workspace import ComputerCommand
    async with AsyncSessionLocal() as db:
        await db.execute(update(ComputerCommand).where(ComputerCommand.status=='running').values(status='interrupted',payload='',result=None))
        await db.commit()
    # Only this scheduler touches the leader connection. Provider calls and
    # maintenance get their own tasks/sessions, never this asyncpg connection.
    active = {}
    maintenance = None
    next_maintenance = 0
    maintenance_requested = True
    try:
        while not stop_event.is_set() or active or maintenance is not None:
            await pulse()
            for execution in list(active):
                if execution.done():
                    await execution  # Lease loss must reach the supervisor.
                    del active[execution]
            if maintenance is not None and maintenance.done():
                did_work = await maintenance
                maintenance = None
                next_maintenance = time.monotonic() + (0 if did_work else (60 if lock_connection is not None else POLL_SECONDS))
            if not stop_event.is_set():
                if maintenance is None and (maintenance_requested or time.monotonic() >= next_maintenance):
                    maintenance = asyncio.create_task(_maintenance_pass())
                    maintenance_requested = False
                while len(active) < MAX_ACTIVE_TASKS:
                    busy_rooms = {claim.conversation_id for claim in active.values()}
                    busy_bots = set().union(*(claim.bot_ids for claim in active.values())) if active else set()
                    claim = await _claim_next_task(busy_rooms, busy_bots)
                    if claim is None:
                        break
                    execution = asyncio.create_task(_run_claimed_task(claim))
                    active[execution] = claim
            if stop_event.is_set():
                # Drain work already claimed, including any ambiguous external
                # maintenance write. The process supervisor owns the deadline.
                pending = [job for job in active if not job.done()]
                if maintenance is not None and not maintenance.done(): pending.append(maintenance)
                if pending: await asyncio.wait(pending, timeout=1)
            else:
                # A finished background pass is not a notification of new work;
                # treating both as the same event would continuously poll SQL.
                notification = asyncio.create_task(wait_for_work(wake, stop_event, 30 if lock_connection is not None else POLL_SECONDS))
                try:
                    pending = list(active) + ([maintenance] if maintenance is not None else [])
                    await asyncio.wait([notification, *pending], return_when=asyncio.FIRST_COMPLETED)
                    signaled = await notification if notification.done() else False
                finally:
                    if not notification.done(): notification.cancel()
                    with suppress(asyncio.CancelledError): await notification
                    # CancelledError from our child and cancellation of this
                    # scheduler can race at the same await. Preserve the latter.
                    if asyncio.current_task().cancelling(): raise asyncio.CancelledError
                maintenance_requested = maintenance_requested or signaled
    finally:
        pending = list(active) + ([maintenance] if maintenance is not None else [])
        for job in pending:
            if not job.done(): job.cancel()
        if pending: await asyncio.gather(*pending, return_exceptions=True)


@dataclass(frozen=True)
class _ClaimedTask:
    id: str
    tenant_id: str
    attempt: int
    conversation_id: str
    bot_ids: tuple[str, ...]


async def _claim_next_task(busy_rooms, busy_bots):
    from app.models.conversation import ConversationParticipant
    async with AsyncSessionLocal() as db:
        # Project metadata only: audio/video bytes are loaded once, by the job.
        query = select(Task.id, Task.tenant_id, Task.conversation_id, Task.bot_id, Task.created_at, Task.started_at).outerjoin(
            TaskExecution, TaskExecution.task_id == Task.id,
        ).where(Task.status == 'pending',
                (TaskExecution.next_attempt_at.is_(None)) | (TaskExecution.next_attempt_at <= datetime.utcnow()))
        if busy_rooms:
            query = query.where(Task.conversation_id.not_in(busy_rooms))
        if busy_bots:
            shared_rooms = select(ConversationParticipant.conversation_id).where(ConversationParticipant.bot_id.in_(busy_bots))
            query = query.where(Task.bot_id.not_in(busy_bots), Task.conversation_id.not_in(shared_rooms))
        row = (await db.execute(query.order_by(Task.created_at, Task.id).limit(1).with_for_update(of=Task, skip_locked=True))).first()
        if row is None:
            await db.commit()
            return None
        tenant = current_tenant_id.set(row.tenant_id)
        try:
            state = await db.get(TaskExecution, row.id)
            if state is None:
                state = TaskExecution(task_id=row.id, attempts=0, recoveries=0)
                db.add(state)
            state.attempts += 1
            state.next_attempt_at = None
            state.updated_at = datetime.utcnow()
            now = datetime.utcnow()
            await db.execute(update(Task).where(Task.id == row.id).values(status='running', started_at=row.started_at or now))
            members = list((await db.execute(select(ConversationParticipant.bot_id).where(ConversationParticipant.conversation_id == row.conversation_id))).scalars())
            # Keep the queued primary responder first; a set would randomize
            # the first bot for one-to-one and media responses.
            bot_ids = (row.bot_id, *(bot_id for bot_id in members if bot_id != row.bot_id))
            await db.commit()
            logger.info('Task admitted task_id=%s queue_wait_seconds=%.3f', row.id, max(0, (now-row.created_at).total_seconds()))
            return _ClaimedTask(row.id, row.tenant_id, state.attempts, row.conversation_id, bot_ids)
        finally:
            current_tenant_id.reset(tenant)


async def _maintenance_pass():
    # The scheduler continues heartbeats while this bounded single lane waits
    # for research, OAuth checks or delivery. Never share its lock connection.
    async def scheduler_owns_pulse(): pass
    from app.services.computer import tick_commands
    from app.services.prospecting import tick as tick_prospecting
    from app.services.investor_funnel import tick as tick_investor_funnel, tick_founder_archive
    await tick_commands(AsyncSessionLocal)
    prospecting_work = await tick_prospecting(AsyncSessionLocal)
    investor_work = await tick_investor_funnel(AsyncSessionLocal, scheduler_owns_pulse)
    archive_work = await tick_founder_archive(AsyncSessionLocal, scheduler_owns_pulse)
    async with AsyncSessionLocal() as db:
        check = await db.get(RuntimeCheck, 'check_request')
        requested = check is not None and check.status == 'pending'
        if requested:
            check.status = 'running'
            await db.commit()
    from app.services.model_connections import run_requested_check
    if requested:
        from app.services.verification import verify_cloud, save_check, safe_error
        try:
            await verify_cloud(force=True)
            await save_check('check_request', 'completed', {})
        except Exception as error:
            await save_check('check_request', 'failed', safe_error(error))
        return True
    if await run_requested_check(AsyncSessionLocal, scheduler_owns_pulse): return True
    from app.services.automation import tick_goals, tick_deliveries
    from app.services.workspace import tick_routines
    await tick_goals(AsyncSessionLocal)
    await tick_deliveries(AsyncSessionLocal)
    await tick_routines(AsyncSessionLocal)
    return bool(prospecting_work or investor_work or archive_work)


async def _run_claimed_task(claim):
    tenant_token = current_tenant_id.set(claim.tenant_id)
    try:
        async with AsyncSessionLocal() as db:
            task = await db.get(Task, claim.id)
            if task is None: return
            request = (task.result or {}).get('request', {})
            execution = asyncio.create_task(AgentOrchestrator().process_message(task.conversation_id, task.description, attachments=request.get('attachments', []), options=request.get('options', {}), goal_id=request.get('goal_id'), task_id=task.id, incoming_message_id=request.get('incoming_message_id'), execution_attempt=claim.attempt, participant_bot_ids=list(claim.bot_ids)))
            try:
                cancelled = False
                try:
                    while not execution.done():
                        await asyncio.wait({execution}, timeout=2)
                        if execution.done(): break
                        async with AsyncSessionLocal() as monitor:
                            current = await monitor.get(Task, task.id)
                            if current and current.status == 'cancel_requested':
                                execution.cancel()
                                with suppress(asyncio.CancelledError): await execution
                                cancelled = True
                                break
                    if cancelled:
                        task.status = 'cancelled'
                        task.result = {**(task.result or {}), 'note': 'Stopped future steps. An in-flight external action may already have completed.'}
                    else:
                        responses = await execution
                        task.status = response_status(responses)
                        task.result = {**(task.result or {}), 'responses': responses}
                finally:
                    if not execution.done():
                        execution.cancel()
                        with suppress(asyncio.CancelledError): await execution
            except (asyncio.CancelledError, ExecutionSuperseded):
                raise
            except Exception:
                logger.exception('Job failed: %s', task.id)
                await db.rollback()
                await db.refresh(task)
                await retry_or_interrupt(db, task)
                if task.status in {'failed', 'interrupted'}:
                    from app.services.workspace import notify_finished
                    await notify_finished(db, task)
                await db.commit()
                return
            with db.no_autoflush:
                owner = (await db.execute(select(TaskExecution.attempts).where(TaskExecution.task_id == task.id).with_for_update())).scalar_one()
                if owner != claim.attempt: raise ExecutionSuperseded('A replacement owns the task result.')
            task.completed_at = datetime.utcnow()
            if request.get('goal_id'):
                from app.models.automation import Goal
                goal = await db.get(Goal, request['goal_id'])
                if goal and not goal.completion_requested:
                    public = [r for r in (task.result or {}).get('responses', []) if not (r.get('metadata') or {}).get('internal') and r.get('sender_type') == 'bot']
                    if public: goal.last_summary = public[-1].get('content', '')[:2000]
            from app.services.automation import enqueue_delivery
            await enqueue_delivery(task.id, request.get('channel_id'), AsyncSessionLocal, db)
            from app.services.workspace import notify_finished
            await notify_finished(db, task)
            await db.commit()
    finally:
        current_tenant_id.reset(tenant_token)


def response_status(responses):
    public = [r for r in responses if not (r.get('metadata') or {}).get('internal')]
    if not public or any(r.get('message_type') == 'status_update' for r in public):
        return 'failed'
    return 'completed'
