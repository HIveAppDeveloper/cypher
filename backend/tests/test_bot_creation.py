"""Offline agent-creation retries, validation and workspace boundaries."""
import asyncio
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.config import settings
from app.db.session import Base, get_db
from app.main import app
from app.models.bot import Bot


@pytest_asyncio.fixture
async def client(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/creation.db")
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def dependency():
        async with sessions() as session:
            yield session

    monkeypatch.setattr(settings, "BACKEND_API_TOKEN", "offline-agent-creation-token")
    monkeypatch.setattr(settings, "REQUIRE_USER_AUTH", True)
    app.dependency_overrides[get_db] = dependency
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test",
            headers={"Authorization": "Bearer offline-agent-creation-token", "x-grokbot-user-id": "creation-owner"},
        ) as api:
            yield api, sessions
    finally:
        app.dependency_overrides.pop(get_db, None)
        await engine.dispose()


def payload(**changes):
    return {"name": "", "role": "Researcher", "system_prompt": "Verify sources.",
            "llm_provider": "openai", "llm_model": "gpt-6.1-sol",
            "tools_enabled": ["browser"], "client_request_id": str(uuid4()), **changes}


@pytest.mark.asyncio
@pytest.mark.parametrize("name", ["", "A named researcher"])
async def test_response_loss_retry_returns_the_created_agent(client, name):
    api, sessions = client
    body = payload(name=name)
    first = await api.post("/api/bots", json=body)
    repeated = await api.post("/api/bots", json=body)
    assert first.status_code == repeated.status_code == 200
    assert first.json()["id"] == repeated.json()["id"]
    async with sessions() as session:
        assert await session.scalar(select(func.count()).select_from(Bot)) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("changes", [{"system_prompt": "Changed request."}, {"name": "Researcher"}])
async def test_retry_key_rejects_changed_input_without_a_second_agent(client, changes):
    api, _ = client
    body = payload()
    first = await api.post("/api/bots", json=body)
    assert first.status_code == 200
    changed = await api.post("/api/bots", json={**body, **changes})
    assert changed.status_code == 409
    assert len((await api.get("/api/bots")).json()) == 1


@pytest.mark.asyncio
async def test_retry_keys_are_scoped_to_authenticated_workspace(client):
    api, _ = client
    body = payload()
    first = await api.post("/api/bots", json=body)
    other = await api.post("/api/bots", json=body, headers={"x-grokbot-user-id": "another-owner"})
    assert first.status_code == other.status_code == 200
    assert first.json()["id"] != other.json()["id"]
    visible = (await api.get("/api/bots")).json()
    assert [row["id"] for row in visible] == [first.json()["id"]]


@pytest.mark.asyncio
async def test_concurrent_optional_names_and_repeated_key_create_once(client):
    api, _ = client
    repeated = payload()
    responses = await asyncio.gather(*[api.post("/api/bots", json=body) for body in [repeated, repeated, payload(), payload()]])
    assert all(response.status_code == 200 for response in responses), [response.text for response in responses]
    assert responses[0].json()["id"] == responses[1].json()["id"]
    assert {row["name"] for row in (await api.get("/api/bots")).json()} == {"Researcher", "Researcher 2", "Researcher 3"}


@pytest.mark.asyncio
@pytest.mark.parametrize("changes", [{"role": "   "}, {"system_prompt": "\n\t"}, {"system_prompt": "a" * 20001}, {"llm_model": " "}, {"client_request_id": "invalid-key"}])
async def test_invalid_creation_is_rejected_before_persisting(client, changes):
    api, _ = client
    response = await api.post("/api/bots", json=payload(**changes))
    assert response.status_code == 422
    assert (await api.get("/api/bots")).json() == []


@pytest.mark.asyncio
async def test_named_conflict_can_be_corrected_and_legacy_clients_still_create(client):
    api, _ = client
    body = payload(name="Existing name")
    assert (await api.post("/api/bots", json=body)).status_code == 200
    second = payload(name="Existing name")
    assert (await api.post("/api/bots", json=second)).status_code == 409
    assert (await api.post("/api/bots", json={**second, "name": "Different name"})).status_code == 200
    legacy = payload()
    del legacy["client_request_id"]
    first = await api.post("/api/bots", json=legacy)
    second = await api.post("/api/bots", json=legacy)
    assert first.status_code == second.status_code == 200
    assert first.json()["id"] != second.json()["id"]


@pytest.mark.asyncio
async def test_deleted_agent_retry_cannot_recreate_it(client):
    api, sessions = client
    body = payload()
    first = await api.post("/api/bots", json=body)
    async with sessions() as session:
        agent = await session.get(Bot, first.json()["id"])
        agent.status = "deleted"
        agent.name = "deleted-" + agent.id
        await session.commit()
    assert (await api.post("/api/bots", json=body)).status_code == 409
    assert (await api.get("/api/bots")).json() == []
