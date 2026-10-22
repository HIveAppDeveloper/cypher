"""Scoped inference for Atlas. No tools, user-data reads or actions run here.

Atlas authenticates people and authorizes every tool locally. This boundary
accepts only that trusted service's signed, bounded text/function protocol.
Only hash admission metadata is persisted. It selects one configured direct
model recipient; neither the body nor the global fallback pool picks a route.
"""
import asyncio
import hashlib
import hmac
import json
import re
import time
from collections import OrderedDict
from contextlib import suppress
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from app.config import settings
from app.db.tenancy import current_tenant_id
from app.services.llm_gateway import LLMGateway, model_selection
from app.services.model_routing import ModelConfigurationError, ModelCapabilityError
from app.services.atlas_admission import AdmissionDenied, AdmissionUnavailable, DurableAdmission, local_admission_allowed
from app.db.session import AsyncSessionLocal, engine as database_engine

router = APIRouter()
MAX_BODY_BYTES = 256 * 1024
MAX_OUTPUT_BYTES = 120 * 1024
MAX_INFLIGHT = 16
MAX_PER_PRINCIPAL = 2
MAX_REPLAYS = 4096
SKEW_SECONDS = 60
BODY_TIMEOUT_SECONDS = 5
NAME = r"^[A-Za-z_][A-Za-z0-9_-]{0,127}$"
HEADERS = {"cache-control": "private, no-store", "x-content-type-options": "nosniff"}


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Principal(StrictModel):
    tenantId: str = Field(min_length=1, max_length=200, pattern=r"^[A-Za-z0-9:_-]+$")
    actorId: str = Field(min_length=1, max_length=200, pattern=r"^[A-Za-z0-9:_-]+$")


class FunctionCall(StrictModel):
    name: str = Field(pattern=NAME)
    arguments: str = Field(max_length=32768)


class ToolCall(StrictModel):
    id: str = Field(min_length=1, max_length=200)
    type: Literal["function"]
    function: FunctionCall
    # Opaque provider thought signatures, echoed only within this request.
    extra_content: dict[str, Any] | None = None


class Message(StrictModel):
    role: Literal["system", "user", "assistant", "tool"]
    content: str | None = Field(default="", max_length=131072)
    tool_calls: list[ToolCall] | None = Field(default=None, max_length=32)
    tool_call_id: str | None = Field(default=None, min_length=1, max_length=200)

    @model_validator(mode="after")
    def valid_tool_role(self):
        if self.role != "assistant" and self.tool_calls is not None:
            raise ValueError("Only assistant messages may carry tool calls")
        if (self.role == "tool") != (self.tool_call_id is not None):
            raise ValueError("Tool results must identify their call")
        if self.content is None and self.role != "assistant":
            raise ValueError("Only assistant tool calls may have null content")
        return self


class FunctionSpec(StrictModel):
    name: str = Field(pattern=NAME)
    description: str = Field(default="", max_length=8000)
    parameters: dict[str, Any]


class ToolSpec(StrictModel):
    type: Literal["function"]
    function: FunctionSpec


class ChatInput(StrictModel):
    version: Literal[1]
    requestId: str = Field(min_length=36, max_length=36)
    principal: Principal
    recipient: Literal["gemini", "openai", "anthropic", "deepseek"]
    messages: list[Message] = Field(min_length=1, max_length=100)
    tools: list[ToolSpec] | None = Field(default=None, max_length=160)
    maxTokens: int = Field(default=1200, ge=1, le=4096)
    timeoutMs: int = Field(default=10000, ge=100, le=30000)
    stream: bool = False

    @model_validator(mode="after")
    def valid_protocol(self):
        if str(UUID(self.requestId)) != self.requestId:
            raise ValueError("requestId must be a canonical UUID")
        names = [tool.function.name for tool in self.tools or []]
        if len(names) != len(set(names)):
            raise ValueError("Tool names must be unique")
        pending = set()
        for message in self.messages:
            if message.role == "tool":
                if message.tool_call_id not in pending:
                    raise ValueError("Orphan or duplicate tool result")
                pending.remove(message.tool_call_id)
                continue
            if pending:
                raise ValueError("Tool calls must be answered before the next turn")
            if message.tool_calls:
                ids = [call.id for call in message.tool_calls]
                if len(ids) != len(set(ids)):
                    raise ValueError("Tool call ids must be unique")
                pending.update(ids)
        if pending:
            raise ValueError("Tool results are missing")
        return self


class ProtocolError(ValueError):
    pass


class Admission:
    """Explicit local-fixture guard only, never a production fallback.

    Production uses DurableAdmission even when its database is unavailable.
    """
    def __init__(self):
        self.seen = OrderedDict()
        self.active: dict[tuple[str, str], int] = {}

    def claim(self, body: ChatInput, timestamp: int) -> tuple[int, str] | None:
        now = time.time()
        for key, expires in list(self.seen.items()):
            if expires < now:
                del self.seen[key]
        principal = (body.principal.tenantId, body.principal.actorId)
        nonce = (*principal, body.requestId)
        if nonce in self.seen:
            return 409, "request_replayed"
        if len(self.seen) >= MAX_REPLAYS or sum(self.active.values()) >= MAX_INFLIGHT or self.active.get(principal, 0) >= MAX_PER_PRINCIPAL:
            return 429, "engine_busy"
        self.seen[nonce] = timestamp + SKEW_SECONDS + 1
        self.active[principal] = self.active.get(principal, 0) + 1
        return None

    def release(self, body: ChatInput):
        principal = (body.principal.tenantId, body.principal.actorId)
        left = self.active.get(principal, 1) - 1
        if left:
            self.active[principal] = left
        else:
            self.active.pop(principal, None)


admission = Admission()
durable_admission = DurableAdmission(AsyncSessionLocal, database_engine)


async def acquire_admission(body: ChatInput, timestamp: int, raw: bytes):
    if settings.GROKBOT_ATLAS_ENGINE_ADMISSION == "local-memory":
        if not local_admission_allowed():
            raise AdmissionUnavailable("Local admission is restricted to explicit local tests")
        denied = admission.claim(body, timestamp)
        if denied:
            raise AdmissionDenied(*denied)
        async def release():
            admission.release(body)
        return release
    lease = await durable_admission.acquire(tenant_id=body.principal.tenantId, actor_id=body.principal.actorId, request_id=body.requestId, raw_body=raw, timeout_ms=body.timeoutMs)
    async def release():
        await durable_admission.release(lease)
    return release


class LeasedStreamingResponse(StreamingResponse):
    """Release admission even if the connection dies before iteration starts."""
    def __init__(self, *args, on_close, **kwargs):
        super().__init__(*args, **kwargs)
        self.on_close = on_close

    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            await self.on_close()


def error(code: str, message: str, retryable=False):
    return {"type": "error", "code": code, "message": message, "retryable": retryable}


def failure(status: int, code: str, message: str, retryable=False):
    return JSONResponse(error(code, message, retryable), status_code=status, headers={**HEADERS, **({"retry-after": "1"} if status == 429 else {})})


def signature_time(timestamp: str | None, signature: str | None) -> int | None:
    if not timestamp or not re.fullmatch(r"[1-9][0-9]{8,11}", timestamp):
        return None
    if not signature or not re.fullmatch(r"[0-9a-f]{64}", signature):
        return None
    instant = int(timestamp)
    if abs(time.time() - instant) > SKEW_SECONDS:
        return None
    return instant


def verified_signature(raw: bytes, timestamp: str | None, signature: str | None, key: str) -> int | None:
    instant = signature_time(timestamp, signature)
    if instant is None:
        return None
    expected = hmac.new(key.encode(), b"v1\n" + timestamp.encode() + b"\n" + raw, hashlib.sha256).hexdigest()
    return instant if hmac.compare_digest(signature, expected) else None


def get(value, name, default=None):
    return value.get(name, default) if isinstance(value, dict) else getattr(value, name, default)


async def events(body: ChatInput, deadline: float | None = None):
    """Generate token frames and exactly one final result or safe error.

    Closing/cancelling this iterator closes the provider iterator. A partial
    function call, missing terminal chunk or length limit never becomes a tool
    intent that Atlas could execute.
    """
    tenant = current_tenant_id.set("atlas-engine:" + body.principal.tenantId)
    provider = settings.GROKBOT_ATLAS_ENGINE_PROVIDER
    model = settings.GROKBOT_ATLAS_ENGINE_MODEL
    source = None
    try:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + body.timeoutMs / 1000 if deadline is None else deadline
        if loop.time() >= deadline:
            raise TimeoutError()
        messages = [message.model_dump(exclude_none=True) for message in body.messages]
        tools = [tool.model_dump() for tool in body.tools] if body.tools else None
        allowed = {tool.function.name for tool in body.tools or []}
        if loop.time() >= deadline:
            raise TimeoutError()
        source = LLMGateway.stream(messages, tools=tools, provider=provider, model=model, direct=True, deadline=deadline, max_tokens=body.maxTokens)
        text = ""
        calls: dict[int, dict[str, Any]] = {}
        finished = None
        async with asyncio.timeout_at(deadline):
            async for chunk in source:
                choices = get(chunk, "choices", []) or []
                if not choices:
                    continue
                choice = choices[0]
                reason = get(choice, "finish_reason")
                if reason:
                    finished = reason
                delta = get(choice, "delta", {}) or {}
                content = get(delta, "content")
                if content is not None and not isinstance(content, str):
                    raise ProtocolError("Unexpected content")
                if content:
                    text += content
                    if len(text) > 65536:
                        raise ProtocolError("Answer exceeded limit")
                for call in get(delta, "tool_calls", []) or []:
                    index = get(call, "index")
                    if not isinstance(index, int) or isinstance(index, bool) or index < 0 or index >= 8:
                        raise ProtocolError("Unexpected tool index")
                    current = calls.setdefault(index, {"id": "", "name": "", "arguments": ""})
                    function = get(call, "function", {}) or {}
                    for key, value in (("id", get(call, "id")), ("name", get(function, "name")), ("arguments", get(function, "arguments"))):
                        if value is not None:
                            if not isinstance(value, str):
                                raise ProtocolError("Unexpected tool field")
                            current[key] += value
                    if len(current["arguments"]) > 32768:
                        raise ProtocolError("Tool arguments exceeded limit")
                    extra = get(call, "extra_content")
                    if extra is not None:
                        if not isinstance(extra, dict):
                            raise ProtocolError("Unexpected provider baggage")
                        current["extra"] = extra
                if len(json.dumps({"content": text, "toolCalls": list(calls.values())}).encode()) > MAX_OUTPUT_BYTES:
                    raise ProtocolError("Output exceeded limit")
                if content:
                    for offset in range(0, len(content), 4096):
                        yield {"type": "token", "text": content[offset:offset + 4096]}
        if finished not in {"stop", "tool_calls"}:
            raise ProtocolError("Incomplete provider response")
        result_calls = []
        for index in sorted(calls):
            call = calls[index]
            if not call["id"] or len(call["id"]) > 200 or call["name"] not in allowed or len(call["arguments"]) > 32768:
                raise ProtocolError("Invalid tool intent")
            try:
                args = json.loads(call["arguments"])
            except (ValueError, TypeError):
                raise ProtocolError("Incomplete tool arguments")
            if not isinstance(args, dict):
                raise ProtocolError("Tool arguments must be an object")
            result_calls.append(call)
        if len({call["id"] for call in result_calls}) != len(result_calls):
            raise ProtocolError("Duplicate tool intents")
        if not text.strip() and not result_calls:
            raise ProtocolError("Empty provider response")
        yield {"type": "result", "result": {"content": text, "toolCalls": result_calls}, "model": model}
    except TimeoutError:
        yield error("engine_timeout", "The inference deadline was reached.", True)
    except (ModelConfigurationError, ModelCapabilityError):
        yield error("engine_unavailable", "The selected inference route is unavailable.")
    except ProtocolError:
        yield error("engine_protocol_error", "The inference response was incomplete or invalid.", True)
    except Exception as exc:
        # Provider exceptions can contain API keys, prompts, or endpoint URLs.
        # Only a safe status class crosses the boundary; never stringify them.
        retryable = get(exc, "status_code") in {408, 429, 500, 502, 503, 504}
        yield error("engine_unavailable", "The selected inference route is unavailable.", retryable)
    finally:
        try:
            if source is not None:
                with suppress(Exception):
                    async with asyncio.timeout(2):
                        await source.aclose()
        finally:
            current_tenant_id.reset(tenant)


@router.post("/chat")
async def chat(request: Request):
    if not settings.GROKBOT_ATLAS_ENGINE_ENABLED:
        return failure(503, "engine_disabled", "The Atlas inference integration is disabled.")
    key = settings.ATLAS_ENGINE_SIGNING_KEY
    provider, model = settings.GROKBOT_ATLAS_ENGINE_PROVIDER, settings.GROKBOT_ATLAS_ENGINE_MODEL
    if len(key.encode()) < 32 or provider not in {"gemini", "openai", "anthropic", "deepseek"} or not model:
        return failure(503, "engine_not_configured", "The Atlas inference integration is not configured.")
    try:
        model_selection(model, provider)
    except ModelConfigurationError:
        return failure(503, "engine_not_configured", "The Atlas inference route is not configured.")
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json" or request.headers.get("content-encoding"):
        return failure(415, "invalid_content_type", "Use an uncompressed JSON request.")
    if signature_time(request.headers.get("x-atlas-engine-timestamp"), request.headers.get("x-atlas-engine-signature")) is None:
        return failure(401, "invalid_signature", "The inference request could not be authenticated.")
    raw = bytearray()
    try:
        async with asyncio.timeout(BODY_TIMEOUT_SECONDS):
            async for piece in request.stream():
                raw.extend(piece)
                if len(raw) > MAX_BODY_BYTES:
                    return failure(413, "request_too_large", "The inference request exceeds its size limit.")
    except TimeoutError:
        return failure(408, "request_timeout", "The request body did not arrive before its deadline.", True)
    timestamp = verified_signature(bytes(raw), request.headers.get("x-atlas-engine-timestamp"), request.headers.get("x-atlas-engine-signature"), key)
    if timestamp is None:
        return failure(401, "invalid_signature", "The inference request could not be authenticated.")
    try:
        # Strict parsing rejects NaN/Infinity and duplicate JSON keys, including
        # duplicate principals that different service parsers could interpret.
        def pairs(entries):
            result = {}
            for name, value in entries:
                if name in result:
                    raise ValueError("Duplicate key")
                result[name] = value
            return result
        data = json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Invalid constant")))
        if not isinstance(data, dict) or type(data.get("version")) is not int:
            raise ValueError("Invalid version")
        body = ChatInput.model_validate(data)
    except (ValidationError, ValueError, TypeError, UnicodeDecodeError, RecursionError):
        return failure(400, "invalid_request", "The inference request does not match contract version 1.")
    if body.recipient != provider:
        return failure(409, "recipient_mismatch", "The configured inference recipient does not match the request.")
    # Count admission/queue time and any process pause against the original
    # inference budget. A delayed worker must not start under an expired lease.
    inference_deadline = asyncio.get_running_loop().time() + body.timeoutMs / 1000
    try:
        release_admission = await acquire_admission(body, timestamp, bytes(raw))
    except AdmissionDenied as denied:
        status, code = denied.status, denied.code
        return failure(status, code, "The inference request was already used." if status == 409 else "The inference engine is busy.", status == 429)
    except AdmissionUnavailable:
        return failure(503, "engine_admission_unavailable", "Shared inference admission could not be confirmed.", True)
    released = False
    async def release_once():
        nonlocal released
        if not released:
            released = True
            try:
                await release_admission()
            except AdmissionUnavailable:
                # Leave the lease to its bounded expiry. Never repeat a model
                # call because only release/bookkeeping could not be confirmed.
                import logging
                logging.getLogger(__name__).warning("Atlas inference admission release unavailable")

    async def owned_events():
        source = events(body, inference_deadline)
        try:
            async for event in source:
                yield event
        finally:
            try:
                await source.aclose()
            finally:
                await release_once()

    if body.stream:
        async def lines():
            source = owned_events()
            try:
                async for event in source:
                    yield (json.dumps(event, separators=(",", ":")) + "\n").encode()
            finally:
                await source.aclose()
        return LeasedStreamingResponse(lines(), on_close=release_once, media_type="application/x-ndjson", headers={**HEADERS, "x-accel-buffering": "no"})

    async def collect():
        result = None
        source = owned_events()
        try:
            async for event in source:
                if event["type"] != "token":
                    result = event
        finally:
            await source.aclose()
        return result

    async def disconnected():
        # The body is fully consumed. Await the real ASGI disconnect instead
        # of polling is_disconnected(), whose cancelled AnyIO scopes can swallow
        # task cancellation when a response has already finished.
        while (await request.receive())["type"] != "http.disconnect":
            await asyncio.sleep(0)

    inference = asyncio.create_task(collect())
    watcher = asyncio.create_task(disconnected())
    try:
        done, _ = await asyncio.wait({inference, watcher}, return_when=asyncio.FIRST_COMPLETED)
        if inference not in done:
            inference.cancel()
            with suppress(asyncio.CancelledError):
                await inference
            return failure(499, "request_cancelled", "The inference request was cancelled.")
        result = inference.result()
        status = 200 if result["type"] == "result" else 504 if result["code"] == "engine_timeout" else 502
        return JSONResponse(result, status_code=status, headers=HEADERS)
    finally:
        if not inference.done():
            inference.cancel()
            with suppress(asyncio.CancelledError):
                await inference
        watcher.cancel()
        with suppress(asyncio.CancelledError):
            await watcher
        await release_once()
