import json

import httpx
import pytest

from app.config import settings
from app.services import nicrron


def _reset_catalog(monkeypatch):
    monkeypatch.setattr(nicrron, "_catalog", {})
    monkeypatch.setattr(nicrron, "_catalog_at", 0.0)
    monkeypatch.setattr(nicrron, "_catalog_checked_at", None)


def _mock_provider(monkeypatch, handler):
    real_client = httpx.AsyncClient
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        nicrron.httpx,
        "AsyncClient",
        lambda **kwargs: real_client(transport=transport, **kwargs),
    )


@pytest.mark.asyncio
async def test_catalog_returns_only_active_chat_models_and_never_sends_key(monkeypatch):
    secret = "nicrron-test-key-do-not-return"
    monkeypatch.setattr(settings, "NICRRON_API_KEY", secret)
    _reset_catalog(monkeypatch)
    requests = []

    def handler(request):
        requests.append(request)
        assert request.method == "GET"
        assert request.url == "https://api.nicrron.ai/v1/models"
        assert "authorization" not in request.headers
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": "anthropic/claude-sonnet-5-5",
                        "name": "Claude Sonnet 5.5",
                        "description": "Text model",
                        "modality": "chat",
                        "deprecated": False,
                        "context_length": 200000,
                        "pricing": {"prompt": "0.000003", "completion": 0.000015},
                        "providers": ["anthropic"],
                    },
                    {"id": "openai/gpt-image-2", "name": "Image", "modality": "image"},
                    {"id": "vendor/retired", "name": "Retired", "modality": "chat", "deprecated": True},
                    {"id": "../../unsafe", "name": "Unsafe", "modality": "chat"},
                ]
            },
        )

    _mock_provider(monkeypatch, handler)
    result = await nicrron.model_catalog(refresh=True)
    assert result["provider"] == "nicrron"
    assert result["configured"] is True and result["status"] == "ready"
    assert [item["id"] for item in result["models"]] == ["anthropic/claude-sonnet-5-5"]
    assert result["models"][0]["pricing"] == {"prompt": "0.000003", "completion": "1.5e-05"}
    assert result["checked_at"] and len(requests) == 1
    assert secret not in json.dumps(result)

    # Cache hits keep the model picker responsive without another catalog call.
    cached = await nicrron.model_catalog()
    assert cached == result and len(requests) == 1
    assert (await nicrron.require_chat_model("anthropic/claude-sonnet-5-5"))["id"] == "anthropic/claude-sonnet-5-5"


@pytest.mark.asyncio
async def test_catalog_is_unavailable_safely_and_unknown_models_are_rejected(monkeypatch):
    monkeypatch.setattr(settings, "NICRRON_API_KEY", "server-test-key")
    _reset_catalog(monkeypatch)
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"data": [{"id": "openai/gpt-6-luna", "modality": "chat"}]})

    _mock_provider(monkeypatch, handler)
    with pytest.raises(nicrron.NicrronError) as error:
        await nicrron.require_chat_model("unknown/model")
    assert error.value.status_code == 404
    assert len(calls) == 2  # Cached catalog, then one refresh for new IDs.

    monkeypatch.setattr(settings, "NICRRON_API_KEY", "")
    unavailable = await nicrron.model_catalog(refresh=True)
    assert unavailable == {
        "provider": "nicrron",
        "configured": False,
        "status": "not_configured",
        "models": [],
        "checked_at": None,
    }


@pytest.mark.asyncio
async def test_connection_probe_uses_server_key_and_returns_only_safe_status(monkeypatch):
    secret = "nicrron-private-probe-key"
    monkeypatch.setattr(settings, "NICRRON_API_KEY", secret)
    requests = []

    def handler(request):
        requests.append(request)
        assert request.method == "POST"
        assert request.url == "https://api.nicrron.ai/v1/chat/completions"
        assert request.headers["authorization"] == f"Bearer {secret}"
        payload = json.loads(request.content)
        assert payload["model"] == "nicrron/fastest"
        assert payload["max_tokens"] == 16 and payload["stream"] is False
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "Connection verified."}}]},
        )

    _mock_provider(monkeypatch, handler)
    result = await nicrron.test_connection()
    assert result == {"state": "ready", "message": "Nicrron returned a live model response."}
    assert secret not in json.dumps(result) and len(requests) == 1
