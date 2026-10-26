import asyncio
from concurrent.futures import ThreadPoolExecutor
import json
import threading

from fastapi.testclient import TestClient
from starlette.requests import ClientDisconnect
import numpy as np
import pytest

from kokoro_service import AdmittedStream, Speech, create_app, in_thread, pcm16, text_chunks

KEY = "local-test-fixture-not-a-live-key-0000"
AUTH = {"Authorization": "Bearer " + KEY}


class FakeEngine:
    providers = ["CPUExecutionProvider"]

    def __init__(self):
        self.calls = []

    def synthesize(self, text, voice, speed):
        self.calls.append(text)
        return pcm16(np.sin(np.arange(4800) * 0.1) * 0.1)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("GROKBOT_BACKEND_API_TOKEN", KEY)
    with TestClient(create_app(FakeEngine)) as client:
        yield client


def test_auth_is_required_before_body_parsing(client):
    result = client.post("/v1/audio/speech", content=b"invalid" * 3000)
    assert result.status_code == 401
    assert client.get("/health").status_code == 401
    assert client.app.state.engine.calls == []


def test_missing_key_fails_closed(client, monkeypatch):
    monkeypatch.delenv("GROKBOT_BACKEND_API_TOKEN")
    monkeypatch.delenv("BACKEND_API_TOKEN", raising=False)
    assert client.post("/v1/audio/speech", headers=AUTH, json={"input": "Hello."}).status_code == 503


@pytest.mark.parametrize("payload", [{"input": ""}, {"input": "!"}, {"input": "a" * 2001}, {"input": "Hello.", "speed": float("inf")}, {"input": "Hello.", "voice": "../secret"}, {"input": "Hello.", "response_format": "wav"}])
def test_invalid_input_never_runs_inference(client, payload):
    # Raw JSON permits testing invalid/non-finite values without client filtering.
    result = client.post("/v1/audio/speech", headers={**AUTH, "Content-Type": "application/json"}, content=json.dumps(payload))
    assert result.status_code == 400
    assert client.app.state.engine.calls == []


def test_body_limit_without_content_length(client):
    data = iter([b'{"input":"', b"x" * 13000, b'"}'])
    result = client.post("/v1/audio/speech", headers={**AUTH, "Content-Type": "application/json"}, content=data)
    assert result.status_code == 413
    assert client.app.state.engine.calls == []


def test_health_reports_cpu_and_never_secrets(client):
    result = client.get("/health", headers=AUTH)
    assert result.json()["runtime"] == "onnx-cpu"
    assert KEY not in result.text


def test_pcm_is_raw_little_endian_mono_with_real_first_audio_timing(client):
    result = client.post("/v1/audio/speech", headers=AUTH, json={"input": "Hello. This is a second sentence."})
    assert result.status_code == 200
    assert result.headers["content-type"] == "audio/pcm"
    assert len(result.content) == 19200
    assert float(result.headers["x-server-first-audio-ms"]) > 0
    assert client.app.state.engine.calls == ["Hello.", "This is a second sentence."]
    assert pcm16([-1, 0, 1, 2]) == b"\x01\x80\x00\x00\xff\x7f\xff\x7f"


def test_mp3_is_encoded_audio_and_lock_is_released(client):
    for _ in range(2):
        result = client.post("/v1/audio/speech", headers=AUTH, json={"input": "Hello.", "response_format": "mp3"})
        assert result.status_code == 200
        assert result.headers["content-type"] == "audio/mpeg"
        assert len(result.content) > 100
        assert result.content[0] == 0xFF  # MPEG frame sync, no fake WAV header.


def test_chunks_preserve_words_and_order():
    text = "one " * 80 + "last"
    chunks = list(text_chunks(text))
    assert " ".join(chunks) == text
    assert len(chunks[0]) <= 60
    assert all(len(c) <= 180 for c in chunks)
    assert list(text_chunks("x" * 100)) == ["x" * 100]


def test_derivative_preserves_identity_voice_and_chunk_contract(monkeypatch):
    from paradee_engine import MODEL_ID, streaming_chunks
    class Derivative(FakeEngine):
        model_id = MODEL_ID
        chunks = staticmethod(streaming_chunks)
    monkeypatch.setenv("GROKBOT_BACKEND_API_TOKEN", KEY)
    with TestClient(create_app(Derivative)) as client:
        payload = {"model": MODEL_ID, "voice": "af_heart", "input": "Check pipeline latency."}
        assert client.post("/v1/audio/speech", headers=AUTH, json={**payload, "model": "kokoro"}).status_code == 400
        assert client.post("/v1/audio/speech", headers=AUTH, json={**payload, "voice": "af_bella"}).status_code == 400
        assert client.app.state.engine.calls == []
        result = client.post("/v1/audio/speech", headers=AUTH, json=payload)
        assert result.status_code == 200
        assert result.headers["x-tts-model"] == MODEL_ID
        assert client.get("/health", headers=AUTH).json()["model"] == MODEL_ID
        assert client.app.state.engine.calls == ["Check", "pipeline latency."]
    assert list(streaming_chunks("A fresh response.")) == ["A fresh", "response."]
    assert list(streaming_chunks("  Hi.  ")) == ["Hi."]
    text = "one " * 80 + "last"
    assert " ".join(streaming_chunks(text)) == text


def test_header_send_failure_releases_admission():
    async def scenario():
        lock = asyncio.Lock()
        await lock.acquire()
        async def body():
            yield b"audio"
        async def fail(message):
            raise OSError("disconnected before headers")
        async def receive():
            return {"type": "http.disconnect"}
        response = AdmittedStream(body(), admission=lock)
        with pytest.raises(ClientDisconnect):
            await response({"type": "http", "asgi": {"spec_version": "2.4"}}, receive, fail)
        assert not lock.locked()
    asyncio.run(scenario())


def test_cancellation_waits_for_running_inference_before_releasing():
    async def scenario():
        started = threading.Event()
        finished = threading.Event()
        def run():
            started.set()
            finished.wait(timeout=2)
        task = asyncio.create_task(in_thread(run))
        while not started.is_set():
            await asyncio.sleep(0)
        task.cancel()
        await asyncio.sleep(0)
        assert not task.done()
        finished.set()
        with pytest.raises(asyncio.CancelledError):
            await task
    asyncio.run(scenario())


def test_disconnect_stops_following_chunks_and_releases_instance(monkeypatch):
    monkeypatch.setenv("GROKBOT_BACKEND_API_TOKEN", KEY)
    async def scenario():
        app = create_app(FakeEngine)
        first_sent = asyncio.Event()
        body_read = False
        sent = []
        async def receive():
            nonlocal body_read
            if not body_read:
                body_read = True
                return {"type": "http.request", "body": b'{"input":"One. Two. Three."}'}
            await first_sent.wait()
            return {"type": "http.disconnect"}
        async def send(message):
            sent.append(message)
            if message["type"] == "http.response.body":
                first_sent.set()
                await asyncio.sleep(0)
        scope = {"type":"http", "asgi":{"version":"3.0", "spec_version":"2.3"}, "http_version":"1.1", "scheme":"http", "method":"POST", "path":"/v1/audio/speech", "raw_path":b"/v1/audio/speech", "query_string":b"", "headers":[(b"authorization",("Bearer "+KEY).encode()),(b"content-type",b"application/json")], "server":("test",80),"client":("test",1)}
        async with app.router.lifespan_context(app):
            await app(scope, receive, send)
            assert app.state.engine.calls == ["One."]
            assert sent[0]["status"] == 200
            # A subsequent request must not remain blocked by the cancelled clip.
            app.state.engine.calls.clear()
            body_read = False
            await app(scope, receive, send)
            assert app.state.engine.calls == ["One."]
    asyncio.run(scenario())


def test_concurrent_generation_is_rejected_without_blocking_health(monkeypatch):
    monkeypatch.setenv("GROKBOT_BACKEND_API_TOKEN", KEY)
    entered, release = threading.Event(), threading.Event()
    class BlockingEngine(FakeEngine):
        def synthesize(self, *args):
            entered.set()
            assert release.wait(timeout=5)
            return super().synthesize(*args)
    with TestClient(create_app(BlockingEngine)) as client, ThreadPoolExecutor() as pool:
        first = pool.submit(client.post, "/v1/audio/speech", headers=AUTH, json={"input":"Hello."})
        try:
            assert entered.wait(timeout=3)
            assert client.get("/health", headers=AUTH).status_code == 200
            assert client.post("/v1/audio/speech", headers=AUTH, json={"input":"Later."}).status_code == 429
        finally:
            release.set()
        assert first.result(timeout=3).status_code == 200
        assert client.post("/v1/audio/speech", headers=AUTH, json={"input":"Recovered."}).status_code == 200
