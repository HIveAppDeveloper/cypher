"""Cloud health and rolling-release behavior, using real persisted jobs."""
import asyncio
from datetime import datetime, timedelta
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.config import settings
from app.db.session import Base, get_db
from app.main import app
from app.models.runtime import RuntimeHeartbeat, RuntimeCheck
from app.models.task import Task
from app.services import worker, verification, automation
from app.services.runtime_identity import same_release
from app.worker_main import drain_worker


@pytest_asyncio.fixture
async def cloud_db(tmp_path, monkeypatch):
    engine = create_async_engine(f'sqlite+aiosqlite:///{tmp_path}/cloud.db')
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async def dependency():
        async with sessions() as db: yield db
    app.dependency_overrides[get_db] = dependency
    for module in (worker, verification, automation):
        monkeypatch.setattr(module, 'AsyncSessionLocal', sessions)
    monkeypatch.setattr(worker, 'engine', engine)
    monkeypatch.setattr(worker, 'POLL_SECONDS', .01)
    monkeypatch.setattr(settings, 'BACKEND_API_TOKEN', '')
    monkeypatch.setattr(settings, 'REQUIRE_USER_AUTH', False)
    monkeypatch.setenv('VERCEL_DEPLOYMENT_ID', 'dpl_current')
    monkeypatch.setenv('VERCEL_GIT_COMMIT_SHA', 'current-commit')
    monkeypatch.setenv('VERCEL_ENV', 'production')
    monkeypatch.delenv('GROKBOT_VERIFY_CLOUD', raising=False)
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            yield client, sessions
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize('release,age,ready,matches', [
    ('dpl_current', 1, True, True),
    ('dpl_old', 1, False, False),
    ('dpl_current', 90, False, True),
    (None, 1, False, None),
])
async def test_runtime_reports_worker_release_and_stale_heartbeats(cloud_db, release, age, ready, matches):
    client, sessions = cloud_db
    async with sessions() as db:
        db.add(RuntimeHeartbeat(name='worker', updated_at=datetime.utcnow() - timedelta(seconds=age)))
        if release:
            db.add(RuntimeCheck(name='worker_release', status='running', detail={'deployment_id': release}, updated_at=datetime.utcnow()))
        await db.commit()
    response = await client.get('/api/runtime')
    assert response.status_code == 200
    result = response.json()
    assert result['worker'] is ready
    assert result['worker_version_matches'] is matches
    assert result['deployment'] == {'deployment_id': 'dpl_current', 'commit': 'current-commit', 'environment': 'production'}


@pytest.mark.asyncio
async def test_worker_persists_current_release_with_heartbeat(cloud_db):
    _, sessions = cloud_db
    await worker.heartbeat()
    async with sessions() as db:
        release = await db.get(RuntimeCheck, 'worker_release')
        assert release.detail['deployment_id'] == 'dpl_current'
        assert release.detail['commit'] == 'current-commit'
        assert await db.get(RuntimeHeartbeat, 'worker') is not None


@pytest.mark.asyncio
async def test_local_runtime_does_not_require_platform_release_metadata(cloud_db, monkeypatch):
    client, _ = cloud_db
    monkeypatch.delenv('VERCEL_DEPLOYMENT_ID')
    monkeypatch.delenv('VERCEL_GIT_COMMIT_SHA')
    await worker.heartbeat()
    result = (await client.get('/api/runtime')).json()
    assert result['worker'] is True
    assert result['worker_version_matches'] is None


def test_release_identity_prefers_deployment_over_commit():
    assert same_release({'deployment_id':'new', 'commit':'same'}, {'deployment_id':'old', 'commit':'same'}) is False
    assert same_release({'commit':'same'}, {'commit':'same'}) is True
    assert same_release({}, {}) is None


@pytest.mark.asyncio
async def test_shutdown_finishes_current_job_and_leaves_next_job_queued(cloud_db, monkeypatch):
    client, sessions = cloud_db
    bot = (await client.post('/api/bots', json={'name':'Cloud test', 'role':'Assistant', 'system_prompt':'Help.', 'llm_provider':'openai', 'llm_model':'gpt-6-luna'})).json()
    room = (await client.post('/api/conversations', json={'title':'Shutdown test', 'bot_ids':[bot['id']]})).json()
    jobs = []
    for text in ('first', 'second'):
        response = await client.post(f"/api/conversations/{room['id']}/messages", json={'sender_type':'user', 'content':text})
        assert response.status_code == 202
        jobs.append(response.json()['task_id'])
    entered, release, stop = asyncio.Event(), asyncio.Event(), asyncio.Event()
    async def execute(*args, **kwargs):
        entered.set()
        await release.wait()
        return [{'sender_type':'bot', 'content':'Completed before shutdown.'}]
    monkeypatch.setattr(worker, 'AgentOrchestrator', lambda: SimpleNamespace(process_message=execute))
    task = asyncio.create_task(worker.run_worker(stop_event=stop))
    try:
        await asyncio.wait_for(entered.wait(), 3)
        stop.set()
        release.set()
        await asyncio.wait_for(drain_worker(task, stop, timeout=3), 4)
        async with sessions() as db:
            assert (await db.get(Task, jobs[0])).status == 'completed'
            assert (await db.get(Task, jobs[1])).status == 'pending'
    finally:
        if not task.done(): task.cancel()


@pytest.mark.asyncio
async def test_shutdown_deadline_cancels_unfinished_execution():
    stop = asyncio.Event()
    task = asyncio.create_task(asyncio.Event().wait())
    stop.set()
    await drain_worker(task, stop, timeout=.01)
    assert task.cancelled()


@pytest.mark.asyncio
async def test_worker_failure_is_not_hidden():
    async def fail(): raise RuntimeError('worker failed')
    with pytest.raises(RuntimeError, match='worker failed'):
        await drain_worker(asyncio.create_task(fail()), asyncio.Event())


@pytest.mark.asyncio
async def test_unconfigured_redis_is_not_contacted(monkeypatch):
    import redis.asyncio as redis
    from app.services.memory import MemoryManager
    monkeypatch.setattr(settings, 'REDIS_URL', None)
    def unexpected(*args, **kwargs): raise AssertionError('No Redis endpoint is configured')
    monkeypatch.setattr(redis, 'from_url', unexpected)
    assert await MemoryManager()._get_redis() is None
