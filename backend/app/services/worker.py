"""Single-worker persisted job runner for the persistent backend host."""
import asyncio
import logging
from datetime import datetime
from sqlalchemy import select, update
from app.db.session import AsyncSessionLocal
from app.models.task import Task
from app.services.orchestrator import AgentOrchestrator
logger = logging.getLogger(__name__)
POLL_SECONDS = 1

async def run_worker():
    # Do not replay interrupted side effects automatically.
    async with AsyncSessionLocal() as db:
        await db.execute(update(Task).where(Task.status == "running").values(status="interrupted", completed_at=datetime.utcnow(), result={"error": "Backend restarted during execution; review before resubmitting."}))
        await db.commit()
    while True:
        async with AsyncSessionLocal() as db:
            task = (await db.execute(select(Task).where(Task.status == "pending").order_by(Task.created_at).limit(1))).scalar_one_or_none()
            if task is None:
                await asyncio.sleep(POLL_SECONDS)
                continue
            task.status = "running"
            task.started_at = datetime.utcnow()
            await db.commit()
            try:
                responses = await AgentOrchestrator().process_message(task.conversation_id, task.description)
                task.status = "failed" if any(r.get("message_type") == "status_update" for r in responses) else "completed"
                task.result = {"responses": responses}
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Job failed: %s", task.id)
                task.status = "failed"
                task.result = {"error": "Execution failed; inspect private backend logs."}
            task.completed_at = datetime.utcnow()
            await db.commit()
