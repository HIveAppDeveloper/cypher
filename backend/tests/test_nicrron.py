import json

import httpx
import pytest

from app.config import settings
from app.services import nicrron, omniroute
from app.services.llm_gateway import model_selection
from app.services.model_routing import ModelConfigurationError


def _reset_catalog(monkeypatch):
    monkeypatch.setattr(nicrron, "_catalog", {})
    monkeypatch.setattr(nicrron, "_catalog_at", 0.0)
    monkeypatch.setattr(nicrron, "_catalog_checked_at", None)
    monkeypatch.setattr(nicrron, "_route_model_ids", set())
    monkeypatch.setattr(nicrron, "_route_checked_at", 0.0)
    monkeypatch.setattr(nicrron, "_enrollment_attempted_at", 0.0)


def _configure(monkeypatch, *, key="nicrron-test-key-do-not-return"):
    monkeypatch.setattr(settings, "NICRRON_API_KEY", key)
    monkeypatch.setattr(settings, "OMNIROUTE_URL", "https://omniroute.test")
    monkeypatch.setattr(settings, "OMNIROUTE_API_KEY", "omniroute-inference-test-key")
    monkeypatch.setattr(settings, "OMNIROUTE_CONTROL_KEY", "omniroute-control-test-key")
    monkeypatch.setattr(settings, "OMNIROUTE_PROTECTION_BYPASS", "vercel-bypass-test")


def _mock_provider(monkeypatch, handler):
    real_client = httpx.AsyncClient
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        nicrron.httpx,
        "AsyncClient",
        lambda **kwargs: real_client(transport=transport, **kwargs),
    )


def _route_payload(ids):
    return {"data": [{"id": model_id} for model_id in ids]}


def test_model_selection_accepts_catalog_shaped_nicrron_routes_only_with_omniroute(monkeypatch):
    _configure(monkeypatch)
    selected = model_selection('anthropic/claude-opus-5-5', 'nicrron')
    assert selected == ('nicrron', 'anthropic/claude-opus-5-5')

    with pytest.raises(ModelConfigurationError):
        model_selection('../../not-a-model', 'nicrron')

    monkeypatch.setattr(settings, 'NICRRON_API_KEY', '')
    with pytest.raises(ModelConfigurationError):
        model_selection('anthropic/claude-opus-5-5', 'nicrron')

    monkeypatch.setattr(settings, 'NICRRON_API_KEY', 'nicrron-test-key-never-live')
    monkeypatch.setattr(settings, 'OMNIROUTE_URL', '')
    with pytest.raises(ModelConfigurationError):
        model_selection('anthropic/claude-opus-5-5', 'nicrron')


@pytest.mark.asyncio
async def test_catalog_returns_only_active_chat_models_and_never_sends_key(monkeypatch):
    secret = "nicrron-test-key-do-not-return"
    _configure(monkeypatch, key=secret)
    _reset_catalog(monkeypatch)
    calls = []

    async def route_request(path, payload=None):
        calls.append((path, payload))
        assert path == "/models"
        return _route_payload([
            "nicrron/anthropic/claude-sonnet-5-5",
            "openai/gpt-6.1-sol",
            "nicrron/../../unsafe",
        ])

    monkeypatch.setattr(omniroute, "request", route_request)
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
                    {"id": "anthropic/claude-haiku-4-5", "name": "Unrouted", "modality": "chat"},
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
    assert result["checked_at"] and len(requests) == 1 and len(calls) == 1
    assert secret not in json.dumps(result)

    # Cache hits keep the picker responsive without another provider catalog call.
    cached = await nicrron.model_catalog()
    assert cached == result and len(requests) == 1
    assert (await nicrron.require_chat_model("anthropic/claude-sonnet-5-5"))["id"] == "anthropic/claude-sonnet-5-5"


@pytest.mark.asyncio
async def test_catalog_is_unavailable_safely_and_unknown_models_are_rejected(monkeypatch):
    _configure(monkeypatch)
    _reset_catalog(monkeypatch)
    calls = []

    async def route_request(path, payload=None):
        calls.append(path)
        return _route_payload(["nicrron/anthropic/claude-sonnet-5-5"])

    monkeypatch.setattr(omniroute, "request", route_request)
    provider_calls = []

    def handler(request):
        provider_calls.append(request)
        return httpx.Response(200, json={"data": [{"id": "anthropic/claude-sonnet-5-5", "modality": "chat"}]})

    _mock_provider(monkeypatch, handler)
    with pytest.raises(nicrron.NicrronError) as error:
        await nicrron.require_chat_model("unknown/model")
    assert error.value.status_code == 404
    assert len(provider_calls) == 2  # Cached catalog, then one refresh for new IDs.

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
async def test_catalog_enrolls_with_owner_control_and_exposes_only_omniroute_models(monkeypatch):
    secret = "nicrron-private-provider-key"
    control_key = "omniroute-control-test-key"
    inference_key = "omniroute-inference-test-key"
    _configure(monkeypatch, key=secret)
    _reset_catalog(monkeypatch)
    connected = False
    route_calls = []

    async def route_request(path, payload=None):
        nonlocal connected
        route_calls.append(path)
        assert path == "/models"
        return _route_payload(["nicrron/anthropic/claude-opus-5-5"] if connected else [])

    monkeypatch.setattr(omniroute, "request", route_request)
    requests = []

    def handler(request):
        nonlocal connected
        requests.append(request)
        if request.method == "POST":
            assert request.url == "https://omniroute.test/api/internal/connections/check"
            assert request.headers["authorization"] == f"Bearer {control_key}"
            assert request.headers["x-vercel-protection-bypass"] == "vercel-bypass-test"
            assert inference_key not in request.headers["authorization"]
            body = json.loads(request.content)
            assert body == {"provider": "nicrron", "action": "connect_api_key", "api_key": secret}
            connected = True
            return httpx.Response(
                200,
                json={
                    "state": "ready",
                    "public_model": "nicrron/anthropic/claude-opus-5-5",
                    "transport_model": "nicrron/anthropic/claude-opus-5-5",
                },
            )
        assert request.method == "GET" and request.url == "https://api.nicrron.ai/v1/models"
        assert "authorization" not in request.headers
        return httpx.Response(
            200,
            json={
                "data": [
                    {"id": "anthropic/claude-opus-5-5", "name": "Claude Opus 5.5", "modality": "chat"},
                    {"id": "anthropic/claude-sonnet-5-5", "name": "Sonnet is not routed", "modality": "chat"},
                ]
            },
        )

    _mock_provider(monkeypatch, handler)
    result = await nicrron.model_catalog(refresh=True)
    assert result["status"] == "ready"
    assert [item["id"] for item in result["models"]] == ["anthropic/claude-opus-5-5"]
    assert route_calls == ["/models", "/models"]
    assert len(requests) == 2
    assert secret not in json.dumps(result)
    assert control_key not in json.dumps(result)
    assert inference_key not in json.dumps(result)


@pytest.mark.asyncio
async def test_connection_probe_runs_through_omniroute_and_returns_only_safe_status(monkeypatch):
    secret = "nicrron-private-probe-key"
    _configure(monkeypatch, key=secret)
    _reset_catalog(monkeypatch)
    requests = []

    async def route_request(path, payload=None):
        requests.append((path, payload))
        if path == "/models":
            return _route_payload(["nicrron/anthropic/claude-opus-5-5"])
        assert path == "/chat/completions"
        assert payload["model"] == "nicrron/anthropic/claude-opus-5-5"
        assert payload["max_tokens"] == 16 and payload["stream"] is False
        return {"choices": [{"message": {"content": "Connection verified."}}]}

    monkeypatch.setattr(omniroute, "request", route_request)
    result = await nicrron.test_connection()
    assert result == {"state": "ready", "message": "Nicrron returned a live model response through OmniRoute."}
    assert secret not in json.dumps(result)
    assert [path for path, _ in requests] == ["/models", "/chat/completions"]


@pytest.mark.asyncio
async def test_connection_probe_requires_non_empty_omniroute_response(monkeypatch):
    _configure(monkeypatch)
    _reset_catalog(monkeypatch)

    async def route_request(path, payload=None):
        if path == "/models":
            return _route_payload(["nicrron/anthropic/claude-opus-5-5"])
        return {"choices": [{"message": {"content": "  "}}]}

    monkeypatch.setattr(omniroute, "request", route_request)
    result = await nicrron.test_connection()
    assert result["state"] == "unavailable"
    assert "OmniRoute" in result["message"]


@pytest.mark.asyncio
async def test_existing_omniroute_route_can_be_checked_without_control_key(monkeypatch):
    _configure(monkeypatch)
    monkeypatch.setattr(settings, "OMNIROUTE_CONTROL_KEY", "")
    _reset_catalog(monkeypatch)

    async def route_request(path, payload=None):
        if path == "/models":
            return _route_payload(["nicrron/anthropic/claude-opus-5-5"])
        return {"choices": [{"message": {"content": "Connection verified."}}]}

    monkeypatch.setattr(omniroute, "request", route_request)
    result = await nicrron.test_connection()
    assert result == {"state": "ready", "message": "Nicrron returned a live model response through OmniRoute."}
