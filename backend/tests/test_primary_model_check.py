from types import SimpleNamespace
import pytest
from sqlalchemy import select
from app.models.runtime import RuntimeCheck
from app.services import verification, llm_gateway
from .test_workspace_workflows import workspace


@pytest.mark.asyncio
async def test_release_check_calls_only_model_once_and_records_real_status(workspace, monkeypatch):
    _, sessions = workspace
    monkeypatch.setenv('GROKBOT_VERIFY_MODEL_ONCE', 'test-release')
    calls = []
    async def complete(**kwargs):
        calls.append(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='Model connection ready'))])
    monkeypatch.setattr(llm_gateway.LLMGateway, 'complete', complete)
    await verification.verify_primary_model_once()
    await verification.verify_primary_model_once()
    assert len(calls) == 1 and 'tools' not in calls[0]
    async with sessions() as db:
        check = await db.get(RuntimeCheck, 'gateway')
        assert check.status == 'passed' and check.detail['release_check'] == 'test-release'


@pytest.mark.asyncio
async def test_model_failure_is_recorded_without_stopping_worker(workspace, monkeypatch):
    _, sessions = workspace
    monkeypatch.setenv('GROKBOT_VERIFY_MODEL_ONCE', 'failed-release')
    async def complete(**_): raise RuntimeError('Connection unavailable')
    monkeypatch.setattr(llm_gateway.LLMGateway, 'complete', complete)
    await verification.verify_primary_model_once()
    async with sessions() as db:
        check = await db.get(RuntimeCheck, 'gateway')
        assert check.status == 'failed'
