"""Contract tests use synthetic text and mocked inference; no model calls."""
import asyncio
import hashlib
import hmac
import json
import time
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from starlette.requests import Request

from app.api import atlas_engine as engine
from app.config import settings
from app.db.tenancy import current_tenant_id
from app.main import app
from app.services.llm_gateway import LLMGateway, completion_options
from app.services import llm_gateway

PATH = "/api/integrations/atlas/v1/chat"
KEY = "synthetic-engine-signing-key-32-characters"
ORIGINAL_STREAM = LLMGateway.stream


def payload(**kwargs):
    return {"version": 1, "requestId": str(uuid4()), "principal": {"tenantId": "atlas-user:alice", "actorId": "alice"}, "recipient": "gemini", "messages": [{"role": "user", "content": "Synthetic question"}], **kwargs}


def signed(body, timestamp=None):
    raw = body if isinstance(body, bytes) else json.dumps(body, separators=(",", ":")).encode()
    timestamp = str(int(time.time())) if timestamp is None else str(timestamp)
    signature = hmac.new(KEY.encode(), b"v1\n" + timestamp.encode() + b"\n" + raw, hashlib.sha256).hexdigest()
    return raw, {"content-type": "application/json", "x-atlas-engine-timestamp": timestamp, "x-atlas-engine-signature": signature}


async def normal_stream(*args, **kwargs):
    yield {"choices": [{"delta": {"content": "Synthetic "}, "finish_reason": None}]}
    yield {"choices": [{"delta": {"content": "answer."}, "finish_reason": "stop"}]}


@pytest.fixture(autouse=True)
def config(monkeypatch):
    monkeypatch.setattr(settings, "GROKBOT_ATLAS_ENGINE_ENABLED", True)
    monkeypatch.setattr(settings, "ATLAS_ENGINE_SIGNING_KEY", KEY)
    monkeypatch.setattr(settings, "GROKBOT_ATLAS_ENGINE_PROVIDER", "gemini")
    monkeypatch.setattr(settings, "GROKBOT_ATLAS_ENGINE_MODEL", "gemini-3.8-flash")
    monkeypatch.setattr(settings, "GROKBOT_ATLAS_ENGINE_ADMISSION", "local-memory")
    monkeypatch.setattr(settings, "GROKBOT_ATLAS_ENGINE_ALLOW_LOCAL_ADMISSION", True)
    monkeypatch.setattr(settings, "GROKBOT_PUBLIC_URL", "http://localhost:3000")
    for name in ("VERCEL", "VERCEL_ENV", "VERCEL_DEPLOYMENT_ID", "NODE_ENV"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(settings, "BACKEND_API_TOKEN", "private-backend-token")
    monkeypatch.setattr(settings, "REQUIRE_USER_AUTH", True)
    monkeypatch.setattr(engine, "admission", engine.Admission())
    monkeypatch.setattr(LLMGateway, "stream", normal_stream)


@pytest_asyncio.fixture
async def client():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as value:
        yield value


async def post(client, body=None, **kwargs):
    raw, headers = signed(payload() if body is None else body)
    return await client.post(PATH, content=raw, headers=headers, **kwargs)


@pytest.mark.asyncio
async def test_signed_json_and_stream_preserve_protocol(client, monkeypatch):
    captured = []
    async def stream(messages, **kwargs):
        captured.append((messages, kwargs, current_tenant_id.get()))
        async for chunk in normal_stream():
            yield chunk
    monkeypatch.setattr(LLMGateway, "stream", stream)
    response = await post(client)
    assert response.status_code == 200, response.text
    assert response.json() == {"type": "result", "result": {"content": "Synthetic answer.", "toolCalls": []}, "model": "gemini-3.8-flash"}
    response = await post(client, payload(stream=True))
    frames = [json.loads(line) for line in response.text.splitlines()]
    assert [frame["type"] for frame in frames] == ["token", "token", "result"]
    assert response.headers["content-type"].startswith("application/x-ndjson")
    assert isinstance(captured[0][1].pop("deadline"), float)
    assert captured[0][1] == {"tools": None, "provider": "gemini", "model": "gemini-3.8-flash", "direct": True, "max_tokens": 1200}
    assert captured[0][2] == "atlas-engine:atlas-user:alice"
    assert current_tenant_id.get() is None
    assert engine.admission.active == {}


@pytest.mark.asyncio
async def test_opt_in_and_separate_auth_do_not_widen_other_routes(client, monkeypatch):
    monkeypatch.setattr(settings, "GROKBOT_ATLAS_ENGINE_ENABLED", False)
    assert (await post(client)).json()["code"] == "engine_disabled"
    monkeypatch.setattr(settings, "GROKBOT_ATLAS_ENGINE_ENABLED", True)
    assert (await client.post(PATH, json=payload(), headers={"authorization": "Bearer private-backend-token", "x-grokbot-user-id": "alice"})).status_code == 401
    raw, headers = signed(payload())
    assert (await client.post("/api/bots", content=raw, headers=headers)).status_code == 401
    assert (await client.post(PATH + "/extra", content=raw, headers=headers)).status_code == 401
    assert (await client.get(PATH, headers=headers)).status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["body", "signature", "stale", "future", "missing"])
async def test_tampered_missing_and_expired_signatures_fail_before_inference(client, monkeypatch, change):
    async def forbidden(*args, **kwargs):
        raise AssertionError("Inference must not run")
        yield
    monkeypatch.setattr(LLMGateway, "stream", forbidden)
    raw, headers = signed(payload(), int(time.time()) - 90 if change == "stale" else int(time.time()) + 90 if change == "future" else None)
    if change == "body": raw = raw.replace(b"alice", b"other")
    if change == "signature": headers["x-atlas-engine-signature"] = "0" * 64
    if change == "missing": headers.pop("x-atlas-engine-signature")
    assert (await client.post(PATH, content=raw, headers=headers)).status_code == 401


@pytest.mark.asyncio
async def test_replay_is_rejected_and_another_principal_is_isolated(client, monkeypatch):
    raw, headers = signed(payload())
    assert (await client.post(PATH, content=raw, headers=headers)).status_code == 200
    replay = await client.post(PATH, content=raw, headers=headers)
    assert replay.status_code == 409 and replay.json()["code"] == "request_replayed"
    observed = []
    async def stream(messages, **kwargs):
        observed.append(current_tenant_id.get())
        await asyncio.sleep(.01)
        yield {"choices": [{"delta": {"content": messages[0]["content"]}, "finish_reason": "stop"}]}
    monkeypatch.setattr(LLMGateway, "stream", stream)
    one = payload(messages=[{"role": "user", "content": "Only Alice"}])
    two = payload(principal={"tenantId": "atlas-user:bob", "actorId": "bob"}, messages=[{"role": "user", "content": "Only Bob"}])
    results = await asyncio.gather(post(client, one), post(client, two))
    assert [r.json()["result"]["content"] for r in results] == ["Only Alice", "Only Bob"]
    assert set(observed) == {"atlas-engine:atlas-user:alice", "atlas-engine:atlas-user:bob"}
    assert current_tenant_id.get() is None


@pytest.mark.asyncio
@pytest.mark.parametrize("patch", [{"model": "evil/model"}, {"api_base": "https://unapproved.test"}, {"version": True}, {"maxTokens": True}, {"maxTokens": 4097}, {"timeoutMs": 99}, {"stream": "true"}, {"requestId": "not-a-uuid"}])
async def test_invalid_contract_fields_do_not_run(client, patch):
    response = await post(client, payload(**patch))
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_request"


@pytest.mark.asyncio
async def test_recipient_mismatch_never_uses_fallback(client, monkeypatch):
    monkeypatch.setattr(settings, "LLM_FALLBACK_MODEL", "gpt-6-luna")
    response = await post(client, payload(recipient="openai"))
    assert response.status_code == 409
    assert response.json()["code"] == "recipient_mismatch"


@pytest.mark.asyncio
async def test_duplicate_keys_and_oversize_fail(client):
    raw, headers = signed(b'{"version":1,"version":1}')
    assert (await client.post(PATH, content=raw, headers=headers)).status_code == 400
    raw, headers = signed(b"x" * (engine.MAX_BODY_BYTES + 1))
    assert (await client.post(PATH, content=raw, headers=headers)).status_code == 413


@pytest.mark.asyncio
async def test_large_atlas_attachment_and_77_tool_corpus_fit(client, monkeypatch):
    tools = [{"type": "function", "function": {"name": f"atlas_tool_{n}", "description": "Synthetic function description. " * 8, "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "additionalProperties": False}}} for n in range(77)]
    seen = []
    async def stream(messages, **kwargs):
        seen.append((messages, kwargs["tools"]))
        async for chunk in normal_stream(): yield chunk
    monkeypatch.setattr(LLMGateway, "stream", stream)
    body = payload(messages=[{"role": "system", "content": "Synthetic briefing"}, {"role": "user", "content": "A" * 93000}], tools=tools)
    assert len(signed(body)[0]) < engine.MAX_BODY_BYTES
    assert (await post(client, body)).status_code == 200
    assert len(seen[0][0][1]["content"]) == 93000 and len(seen[0][1]) == 77


@pytest.mark.asyncio
async def test_tool_intents_and_opaque_signatures_are_not_executed(client, monkeypatch):
    body = payload(tools=[{"type": "function", "function": {"name": "read_source", "parameters": {"type": "object"}}}])
    async def stream(messages, **kwargs):
        yield {"choices": [{"delta": {"tool_calls": [{"index": 0, "id": "call-1", "function": {"name": "read_source", "arguments": '{"id":'}, "extra_content": {"google": {"thought_signature": "opaque-synthetic"}}}]}}]}
        yield {"choices": [{"delta": {"tool_calls": [{"index": 0, "function": {"arguments": '"source-1"}'}}]}, "finish_reason": "tool_calls"}]}
    monkeypatch.setattr(LLMGateway, "stream", stream)
    response = await post(client, body)
    assert response.status_code == 200, response.text
    call = response.json()["result"]["toolCalls"][0]
    assert call == {"id": "call-1", "name": "read_source", "arguments": '{"id":"source-1"}', "extra": {"google": {"thought_signature": "opaque-synthetic"}}}
    body["requestId"] = str(uuid4())
    body["messages"] += [{"role": "assistant", "content": "", "tool_calls": [{"id": call["id"], "type": "function", "function": {"name": call["name"], "arguments": call["arguments"]}, "extra_content": call["extra"]}]}, {"role": "tool", "content": "Synthetic allowed source", "tool_call_id": call["id"]}]
    monkeypatch.setattr(LLMGateway, "stream", normal_stream)
    assert (await post(client, body)).status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize("messages", [[{"role": "tool", "tool_call_id": "orphan", "content": "x"}], [{"role": "assistant", "content": "", "tool_calls": [{"id": "one", "type": "function", "function": {"name": "x", "arguments": "{}"}}]}, {"role": "user", "content": "interleaved"}], [{"role": "user", "content": "x", "tool_call_id": "one"}]])
async def test_invalid_tool_sequences_fail_before_provider(client, messages):
    assert (await post(client, payload(messages=messages))).status_code == 400


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["unknown_tool", "incomplete_json", "incomplete_stream", "length", "too_many", "oversize", "huge_token"])
async def test_invalid_or_truncated_results_never_become_tool_intents(client, monkeypatch, kind):
    async def stream(messages, **kwargs):
        if kind in {"oversize", "huge_token"}:
            yield {"choices": [{"delta": {"content": "x" * (65537 if kind == "oversize" else 500000)}, "finish_reason": "stop"}]}
            return
        if kind == "incomplete_stream":
            yield {"choices": [{"delta": {"content": "partial"}}]}
            return
        yield {"choices": [{"delta": {"tool_calls": [{"index": 8 if kind == "too_many" else 0, "id": "one", "function": {"name": "unknown" if kind == "unknown_tool" else "read_source", "arguments": "{" if kind == "incomplete_json" else "{}"}}]}, "finish_reason": "length" if kind == "length" else "tool_calls"}]}
    monkeypatch.setattr(LLMGateway, "stream", stream)
    response = await post(client, payload(tools=[{"type": "function", "function": {"name": "read_source", "parameters": {"type": "object"}}}], stream=True))
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[-1]["type"] == "error"
    assert not any(e["type"] == "result" for e in events)
    if kind in {"oversize", "huge_token"}: assert len(events) == 1


@pytest.mark.asyncio
async def test_output_field_boundaries_match_atlas(client, monkeypatch):
    async def stream(messages, **kwargs):
        yield {"choices": [{"delta": {"content": "x" * 65536}, "finish_reason": "stop"}]}
    monkeypatch.setattr(LLMGateway, "stream", stream)
    assert (await post(client)).status_code == 200
    async def eight_calls(messages, **kwargs):
        yield {"choices": [{"delta": {"tool_calls": [{"index": n, "id": str(n), "function": {"name": "source", "arguments": "{}"}} for n in range(8)]}, "finish_reason": "tool_calls"}]}
    monkeypatch.setattr(LLMGateway, "stream", eight_calls)
    response = await post(client, payload(tools=[{"type": "function", "function": {"name": "source", "parameters": {}}}]))
    assert len(response.json()["result"]["toolCalls"]) == 8


@pytest.mark.asyncio
async def test_timeout_closes_provider_and_returns_safe_error(client, monkeypatch):
    closed = []
    async def stalled(*args, **kwargs):
        try:
            await asyncio.sleep(5)
            yield
        finally: closed.append(True)
    monkeypatch.setattr(LLMGateway, "stream", stalled)
    response = await post(client, payload(timeoutMs=100))
    assert response.status_code == 504 and response.json()["code"] == "engine_timeout"
    assert closed == [True] and engine.admission.active == {}


@pytest.mark.asyncio
async def test_cancelled_iterator_closes_provider_and_resets_tenant(monkeypatch):
    closed = []
    async def provider(*args, **kwargs):
        try:
            yield {"choices": [{"delta": {"content": "first"}}]}
            await asyncio.sleep(5)
        finally: closed.append(True)
    monkeypatch.setattr(LLMGateway, "stream", provider)
    source = engine.events(engine.ChatInput.model_validate(payload()))
    assert (await anext(source))["type"] == "token"
    await source.aclose()
    assert closed == [True] and current_tenant_id.get() is None


@pytest.mark.asyncio
async def test_provider_errors_are_redacted(client, monkeypatch):
    async def provider(*args, **kwargs):
        raise RuntimeError("secret-provider-key private customer content https://internal-service.test")
        yield
    monkeypatch.setattr(LLMGateway, "stream", provider)
    response = await post(client)
    assert response.status_code == 502
    assert "secret-provider-key" not in response.text and "customer" not in response.text and "internal-service" not in response.text


@pytest.mark.asyncio
async def test_stalled_upload_and_missing_headers_are_bounded(monkeypatch):
    monkeypatch.setattr(engine, "BODY_TIMEOUT_SECONDS", .02)
    called = []
    async def receive():
        called.append(True)
        await asyncio.sleep(5)
    scope = {"type": "http", "method": "POST", "path": PATH, "headers": [(b"content-type", b"application/json")]}
    response = await engine.chat(Request(scope, receive=receive))
    assert response.status_code == 401 and called == []
    _, headers = signed(payload())
    scope["headers"] = [(k.encode(), v.encode()) for k, v in headers.items()]
    response = await engine.chat(Request(scope, receive=receive))
    assert response.status_code == 408 and called == [True]


def test_per_principal_concurrency_is_bounded_without_storing_prompts():
    guard = engine.Admission()
    one, two, three = [engine.ChatInput.model_validate(payload()) for _ in range(3)]
    now = int(time.time())
    assert guard.claim(one, now) is None and guard.claim(two, now) is None
    assert guard.claim(three, now) == (429, "engine_busy")
    guard.release(one)
    assert guard.claim(three, now) is None
    assert "Synthetic question" not in repr(guard.seen)


@pytest.mark.parametrize("provider,model,base", [("gemini", "gemini-3.8-flash", "https://generativelanguage.googleapis.com/v1alpha"), ("openai", "gpt-6-luna", "https://api.openai.com/v1"), ("anthropic", "claude-sonnet-5.5", "https://api.anthropic.com"), ("deepseek", "deepseek-v4.1-flash", "https://api.deepseek.com")])
def test_direct_recipient_pins_official_base_even_with_hostile_environment(monkeypatch, provider, model, base):
    monkeypatch.setattr(settings, "LLM_API_BASE", "https://unapproved-router.invalid")
    monkeypatch.setattr(settings, "LLM_API_KEY", "generic-must-not-be-reused")
    for name in ["OPENAI_API_BASE", "OPENAI_BASE_URL", "GEMINI_API_BASE", "ANTHROPIC_API_BASE", "DEEPSEEK_API_BASE"]:
        monkeypatch.setenv(name, "https://unapproved-router.invalid")
    key_name = {"gemini": "GEMINI_API_KEY", "openai": "OPENAI_API_KEY", "anthropic": "ANTHROPIC_API_KEY", "deepseek": "DEEPSEEK_API_KEY"}[provider]
    monkeypatch.setenv("HIVE_" + key_name, "synthetic-provider-key")
    options = completion_options(model, provider, direct=True)
    assert options["api_base"] == base and options["api_key"] == "synthetic-provider-key"


@pytest.mark.asyncio
async def test_response_start_failure_releases_admission_before_iteration(monkeypatch):
    raw, headers = signed(payload(stream=True))
    scope = {"type": "http", "method": "POST", "path": PATH, "asgi": {"spec_version": "2.4"}, "headers": [(k.encode(), v.encode()) for k, v in headers.items()]}
    async def receive(): return {"type": "http.request", "body": raw, "more_body": False}
    response = await engine.chat(Request(scope, receive=receive))
    assert sum(engine.admission.active.values()) == 1
    async def send(message):
        assert message["type"] == "http.response.start"
        raise RuntimeError("Synthetic client left before response")
    with pytest.raises(RuntimeError): await response(scope, receive, send)
    assert engine.admission.active == {}


@pytest.mark.asyncio
async def test_nonstream_disconnect_cancels_inflight_model_and_releases(monkeypatch):
    closed = []
    async def provider(*args, **kwargs):
        try:
            await asyncio.sleep(5)
            yield
        finally: closed.append(True)
    monkeypatch.setattr(LLMGateway, "stream", provider)
    raw, headers = signed(payload())
    scope = {"type": "http", "method": "POST", "path": PATH, "headers": [(k.encode(), v.encode()) for k, v in headers.items()]}
    first = True
    async def receive():
        nonlocal first
        if first:
            first = False
            return {"type": "http.request", "body": raw, "more_body": False}
        await asyncio.sleep(.02)
        return {"type": "http.disconnect"}
    response = await engine.chat(Request(scope, receive=receive))
    assert response.status_code == 499 and closed == [True]
    assert engine.admission.active == {}


@pytest.mark.asyncio
async def test_gateway_stream_forwards_limit_and_closes_actual_wrapper(monkeypatch):
    closed, options = [], []
    class ProviderStream:
        def __aiter__(self): return self
        async def __anext__(self): return {"choices": [{"delta": {"content": "synthetic"}}]}
        async def aclose(self): closed.append(True)
    async def completion(**kwargs):
        options.append(kwargs)
        return ProviderStream()
    async def capable(*args): pass
    monkeypatch.setattr(llm_gateway.litellm, "acompletion", completion)
    monkeypatch.setattr(llm_gateway, "validate_capabilities", capable)
    monkeypatch.setattr(llm_gateway, "completion_options", lambda *args, **kwargs: {"model": "fixture", "api_key": "synthetic"})
    source = ORIGINAL_STREAM([{"role": "user", "content": "Synthetic"}], provider="gemini", model="gemini-3.8-flash", direct=True, max_tokens=17)
    await anext(source)
    await source.aclose()
    assert closed == [True]
    assert options[0]["max_tokens"] == 17 and options[0]["num_retries"] == 0


@pytest.mark.asyncio
async def test_expired_original_deadline_never_starts_provider(monkeypatch):
    called = []
    def forbidden(*args, **kwargs):
        called.append(True)
        return normal_stream()
    monkeypatch.setattr(LLMGateway, "stream", forbidden)
    source = engine.events(engine.ChatInput.model_validate(payload()), asyncio.get_running_loop().time() - 1)
    frames = [frame async for frame in source]
    assert frames == [engine.error("engine_timeout", "The inference deadline was reached.", True)]
    assert called == [] and current_tenant_id.get() is None


@pytest.mark.asyncio
async def test_admission_delay_consumes_inference_budget_before_first_model_call(client, monkeypatch):
    acquire = engine.acquire_admission
    async def delayed(*args, **kwargs):
        result = await acquire(*args, **kwargs)
        await asyncio.sleep(.12)
        return result
    called = []
    def forbidden(*args, **kwargs):
        called.append(True)
        return normal_stream()
    monkeypatch.setattr(engine, "acquire_admission", delayed)
    monkeypatch.setattr(LLMGateway, "stream", forbidden)
    response = await post(client, payload(timeoutMs=100))
    assert response.status_code == 504
    assert called == [] and engine.admission.active == {}


@pytest.mark.asyncio
async def test_gateway_rechecks_original_deadline_after_capability_preflight(monkeypatch):
    called = []
    async def completion(**kwargs):
        called.append(True)
        raise AssertionError("Expired inference must not be submitted")
    async def capable(*args): pass
    monkeypatch.setattr(llm_gateway.litellm, "acompletion", completion)
    monkeypatch.setattr(llm_gateway, "validate_capabilities", capable)
    monkeypatch.setattr(llm_gateway, "completion_options", lambda *args, **kwargs: {"model": "fixture", "api_key": "synthetic"})
    source = ORIGINAL_STREAM([{"role": "user", "content": "Synthetic"}], provider="gemini", model="gemini-3.8-flash", direct=True, deadline=asyncio.get_running_loop().time() - 1)
    with pytest.raises(TimeoutError): await anext(source)
    assert called == []
