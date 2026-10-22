"""Running chat cancellation through real API, queue, journal and worker.

SQLite is temporary; model responses and maintenance are local fixtures.
Network egress, Redis, cloud verification and external tools are unavailable.
"""
import asyncio
import ipaddress
import socket
import time
from contextlib import suppress
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import settings
from app.db.session import Base, get_db
from app.db.tenancy import current_tenant_id
from app.main import app
from app.models.execution import ExecutionStep, TaskExecution
from app.models.bot import Bot
from app.models.task import Task
from app.services import automation, orchestrator, verification, worker
from app.services.llm_gateway import LLMGateway
from app.services.execution import retry_or_interrupt
from .test_workspace_workflows import workspace, room


@pytest.mark.asyncio
@pytest.mark.parametrize("stop_race", ["monitor-cancel", "provider-error", "cleanup-error", "commit-error"])
async def test_running_chat_cancel_cleans_up_and_next_turn_recovers(tmp_path, monkeypatch, record_property, stop_race):
    engine = create_async_engine("sqlite+aiosqlite:///" + str(tmp_path / "chat-controls.db"))
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def dependency():
        async with sessions() as session:
            yield session

    # This fixture runs the actual worker lifecycle against only its temporary
    # state. Empty catalog/goal/routine/outbox tables cannot trigger actions.
    old_overrides = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = dependency
    for module in (worker, orchestrator, automation, verification):
        monkeypatch.setattr(module, "AsyncSessionLocal", sessions)
    monkeypatch.setattr(worker, "engine", engine)
    monkeypatch.setattr(worker, "POLL_SECONDS", .02)
    monkeypatch.setattr(settings, "REDIS_URL", None)
    monkeypatch.setattr(settings, "BACKEND_API_TOKEN", "synthetic-chat-control-backend-token")
    monkeypatch.setattr(settings, "REQUIRE_USER_AUTH", True)
    monkeypatch.setattr(app.state, "database_ready", True, raising=False)
    monkeypatch.delenv("GROKBOT_VERIFY_CLOUD", raising=False)
    # Keep maintenance out of this chat-only assertion. The queue claim,
    # execution journal, cancellation monitor and final writes remain real.
    from app.services import computer, plugin_sync, workspace, model_routing
    async def no_actions(*args, **kwargs): return None
    async def local_catalog(stop_event, *args, **kwargs): await stop_event.wait()
    async def forbidden_cloud(*args, **kwargs):
        raise AssertionError("Chat control fixtures must not run cloud/provider checks")
    monkeypatch.setattr(computer, "tick_commands", no_actions)
    monkeypatch.setattr(automation, "tick_goals", no_actions)
    monkeypatch.setattr(automation, "tick_deliveries", no_actions)
    monkeypatch.setattr(workspace, "tick_routines", no_actions)
    monkeypatch.setattr(plugin_sync, "run", local_catalog)
    monkeypatch.setattr(verification, "verify_cloud", forbidden_cloud)
    monkeypatch.setattr(model_routing, "gateway_catalog", forbidden_cloud)

    connect = socket.socket.connect
    def local_only(sock, address):
        if isinstance(address, tuple):
            try:
                allowed = ipaddress.ip_address(address[0]).is_loopback
            except ValueError:
                allowed = False
            if not allowed:
                raise AssertionError("Synthetic chat controls forbid nonloopback egress")
        return connect(sock, address)
    monkeypatch.setattr(socket.socket, "connect", local_only)

    started = asyncio.Event()
    cancelled = asyncio.Event()
    propagated = asyncio.Event()
    cleaned = asyncio.Event()
    hold = asyncio.Event()
    calls = []
    first_text = "Wait for my cancellation of this synthetic turn."
    second_text = "Reply to this fresh synthetic turn."
    async def completion(**kwargs):
        assert current_tenant_id.get() == "synthetic-chat-owner"
        assert not kwargs.get("tools")
        calls.append(kwargs["messages"][-1]["content"])
        if len(calls) == 1:
            assert calls[-1] == first_text
            started.set()
            try:
                await hold.wait()
                assert stop_race == "provider-error"
                raise TimeoutError("Synthetic provider failed immediately after Stop was accepted")
            except asyncio.CancelledError:
                cancelled.set()
                raise
            finally:
                cleaned.set()
        assert len(calls) == 2 and calls[-1] == second_text
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="Fresh turn recovered successfully.", tool_calls=None))])
    monkeypatch.setattr(LLMGateway, "complete", completion)

    # Observe the real process_message boundary, including its status cleanup.
    process_message = orchestrator.AgentOrchestrator.process_message
    async def observe_cancellation(*args, **kwargs):
        try:
            return await process_message(*args, **kwargs)
        except asyncio.CancelledError:
            propagated.set()
            raise
    monkeypatch.setattr(orchestrator.AgentOrchestrator, "process_message", observe_cancellation)
    if stop_race == "cleanup-error":
        async def failed_cleanup(*args):
            raise RuntimeError("Synthetic cancelled-status read failure")
        monkeypatch.setattr(orchestrator.AgentOrchestrator, "_release_cancelled_status", failed_cleanup)
    elif stop_race == "commit-error":
        release = orchestrator.AgentOrchestrator._release_cancelled_status
        async def failed_commit(self, db, bot):
            await release(self, db, bot)
            async def unavailable():
                raise RuntimeError("Synthetic cancelled-status commit failure")
            monkeypatch.setattr(db, "commit", unavailable)
        monkeypatch.setattr(orchestrator.AgentOrchestrator, "_release_cancelled_status", failed_commit)

    stopped = asyncio.Event()
    runner = None
    headers = {"authorization": "Bearer synthetic-chat-control-backend-token", "x-grokbot-user-id": "synthetic-chat-owner"}
    options = {"allow_tools": False, "routing": "manual", "provider": "openai", "model": "gpt-6-luna", "max_iterations": 1}
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture", headers=headers) as client:
            created = await client.post("/api/bots", json={"name": "Controlled cancellation fixture", "role": "Assistant", "system_prompt": "Answer only the supplied synthetic request.", "llm_provider": "openai", "llm_model": "gpt-6-luna", "tools_enabled": [], "memory_enabled": False})
            assert created.status_code == 200, created.text
            conversation = await client.post("/api/conversations", json={"title": "Synthetic chat controls", "bot_ids": [created.json()["id"]]})
            assert conversation.status_code == 200, conversation.text
            room = conversation.json()["id"]
            queued = await client.post(f"/api/conversations/{room}/messages", json={"sender_type": "user", "content": first_text, "options": options})
            assert queued.status_code == 202, queued.text
            first_id = queued.json()["task_id"]
            runner = asyncio.create_task(worker.run_worker(stopped))
            await asyncio.wait_for(started.wait(), 5)

            async def wait_status(task_id, expected):
                async with asyncio.timeout(5):
                    while True:
                        if runner.done():
                            await runner
                            raise AssertionError("Worker exited before the requested state")
                        response = await client.get(f"/api/conversations/{room}/tasks")
                        assert response.status_code == 200
                        state = next(row["status"] for row in response.json() if row["id"] == task_id)
                        if state == expected:
                            return
                        await asyncio.sleep(.01)

            # Await the real provider-start boundary; this is neither a pending
            # queue cancellation nor a stubbed task-status response.
            await wait_status(first_id, "running")
            forbidden = await client.post(f"/api/conversations/{room}/tasks/{first_id}/cancel", headers={"x-grokbot-user-id": "different-synthetic-owner"})
            assert forbidden.status_code == 404 and not cancelled.is_set()
            before_cancel = time.monotonic()
            response = await client.post(f"/api/conversations/{room}/tasks/{first_id}/cancel")
            assert response.status_code == 202 and response.json()["status"] == "cancel_requested"
            if stop_race == "provider-error":
                hold.set()
            else:
                await asyncio.wait_for(cancelled.wait(), 5)
                await asyncio.wait_for(propagated.wait(), 1)
            await asyncio.wait_for(cleaned.wait(), 1)
            await wait_status(first_id, "cancelled")
            cancel_seconds = time.monotonic() - before_cancel
            assert cancel_seconds < 5
            record_property("running_cancel_seconds", round(cancel_seconds, 3))
            print(f"RUNNING_CHAT_CANCEL_SECONDS[{stop_race}]={cancel_seconds:.3f}")
            messages = await client.get(f"/api/conversations/{room}/messages")
            assert messages.status_code == 200
            assert not any(message["sender_type"] == "bot" for message in messages.json())
            assert calls == [first_text]
            assert not runner.done()
            if stop_race in ("monitor-cancel", "provider-error"):
                async with sessions() as db:
                    assert (await db.get(Bot, created.json()["id"])).status == "idle"
                agents = await client.get("/api/bots")
                assert agents.status_code == 200
                assert next(agent["status"] for agent in agents.json() if agent["id"] == created.json()["id"]) == "idle"
                record_property("bot_status_after_cancel", "idle")

            before_recovery = time.monotonic()
            fresh = await client.post(f"/api/conversations/{room}/messages", json={"sender_type": "user", "content": second_text, "options": options})
            assert fresh.status_code == 202, fresh.text
            second_id = fresh.json()["task_id"]
            assert second_id != first_id
            await wait_status(second_id, "completed")
            recovery_seconds = time.monotonic() - before_recovery
            record_property("fresh_turn_recovery_seconds", round(recovery_seconds, 3))
            print(f"FRESH_CHAT_RECOVERY_SECONDS[{stop_race}]={recovery_seconds:.3f}")
            rows = (await client.get(f"/api/conversations/{room}/messages")).json()
            assert [row["content"] for row in rows if row["sender_type"] == "bot"] == ["Fresh turn recovered successfully."]
            assert calls == [first_text, second_text]
            async with sessions() as db:
                first = await db.get(Task, first_id)
                second = await db.get(Task, second_id)
                assert first.status == "cancelled" and second.status == "completed"
                assert not first.result.get("responses")
                attempts = dict((await db.execute(select(TaskExecution.task_id, TaskExecution.attempts))).all())
                assert attempts == {first_id: 1, second_id: 1}
                assert (await db.get(TaskExecution, first_id)).recoveries == 0
                if stop_race == "provider-error":
                    assert "in-flight external action" in first.result["note"]
            assert current_tenant_id.get() is None
    finally:
        stopped.set()
        if runner is not None:
            runner.cancel()
            with suppress(asyncio.CancelledError):
                await runner
        app.dependency_overrides.clear()
        app.dependency_overrides.update(old_overrides)
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("stopped_status", ["cancel_requested", "cancelled"])
async def test_stopped_recovery_preserves_action_receipts_and_uncertainty(workspace, stopped_status):
    client, sessions = workspace
    conversation_id = await room(client, "stopped-recovery-owner")
    bot_id = (await client.get("/api/bots", headers={"x-grokbot-user-id": "stopped-recovery-owner"})).json()[0]["id"]
    tenant = current_tenant_id.set("stopped-recovery-owner")
    try:
        async with sessions() as db:
            task = Task(conversation_id=conversation_id, bot_id=bot_id, title="Stopped synthetic work", description="No external operation", status=stopped_status, result={"request": {"synthetic": True}, "receipt": "synthetic-sent-id"})
            db.add(task)
            await db.flush()
            db.add(TaskExecution(task_id=task.id, attempts=1, recoveries=0))
            db.add_all([
                ExecutionStep(task_id=task.id, key="sent", name="send_email", status="completed", replay_safe=False, output={"receipt": "synthetic-sent-id"}),
                ExecutionStep(task_id=task.id, key="unknown", name="write_file", status="uncertain", replay_safe=False),
            ])
            await db.commit()
            assert await retry_or_interrupt(db, task, immediate=True) == "cancelled"
            await db.commit()
            assert task.result["receipt"] == "synthetic-sent-id"
            assert task.result["request"] == {"synthetic": True}
            assert "in-flight external action may already have completed" in task.result["note"]
            assert "outcome of write_file is unknown" in task.result["note"]
            state = await db.get(TaskExecution, task.id)
            assert state.attempts == 1 and state.recoveries == 0 and state.next_attempt_at is None
            assert (await db.get(ExecutionStep, (task.id, "sent"))).output == {"receipt": "synthetic-sent-id"}
            assert (await db.get(ExecutionStep, (task.id, "unknown"))).status == "uncertain"
    finally:
        current_tenant_id.reset(tenant)
