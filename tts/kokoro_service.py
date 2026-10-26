"""Private Vercel CPU service; no database access or external inference calls."""
import asyncio
from contextlib import asynccontextmanager
import hmac
import json
import logging
import os
from pathlib import Path
import re
import time
from typing import Literal

import anyio
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
import numpy as np
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

MAX_BODY = 12 * 1024
SAMPLE_RATE = 24000
log = logging.getLogger(__name__)


class Speech(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model: Literal["kokoro"] = "kokoro"
    input: str = Field(min_length=1, max_length=2000)
    voice: Literal["af_bella", "af_heart", "am_michael", "am_adam"] = "af_bella"
    response_format: Literal["pcm", "mp3"] = "pcm"
    speed: float = Field(default=1.0, ge=0.5, le=2.0)

    @field_validator("input")
    @classmethod
    def nonempty(cls, text):
        text = text.strip()
        if not text or not any(c.isalnum() for c in text):
            raise ValueError("Provide text to speak.")
        return text


def text_chunks(text):
    # Early, short first phrase reduces the initial inference work. Each chunk
    # must end at a word boundary; later chunks retain more prosodic context.
    remaining = text.strip()
    while remaining:
        limit = 60 if remaining == text.strip() else 180
        boundary = re.search(r"[.!?;:]\s+", remaining[:limit + 1])
        if boundary:
            end = boundary.end()
        elif len(remaining) <= limit:
            end = len(remaining)
        else:
            end = remaining.rfind(" ", 0, limit + 1)
            if end < 1:
                # A long word remains intact (the model splits phonemes).
                end = remaining.find(" ")
                if end < 1:
                    end = len(remaining)
        yield remaining[:end].strip()
        remaining = remaining[end:].strip()


def pcm16(audio):
    return (np.clip(np.asarray(audio), -1, 1) * 32767).astype("<i2").tobytes()


class AdmittedStream(StreamingResponse):
    def __init__(self, *args, admission, **kwargs):
        super().__init__(*args, **kwargs)
        self.admission = admission

    async def __call__(self, scope, receive, send):
        # This also runs when sending headers fails before the iterator starts.
        try:
            await super().__call__(scope, receive, send)
        finally:
            self.admission.release()


class Engine:
    def __init__(self):
        import onnxruntime as ort
        from kokoro_onnx import Kokoro

        root = Path(os.environ.get("KOKORO_MODEL_DIR", "/opt/models"))
        options = ort.SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        options.log_severity_level = 3
        session = ort.InferenceSession(
            str(root / "kokoro-v1.0.int8.onnx"),
            sess_options=options,
            providers=["CPUExecutionProvider"],
        )
        self.kokoro = Kokoro.from_session(session, str(root / "voices-v1.0.bin"))
        self.providers = session.get_providers()
        # Never log prompts, phonemes, audio, auth headers, or environment values.
        logging.getLogger("kokoro_onnx").disabled = True
        logging.getLogger("phonemizer").disabled = True
        for _ in range(3):
            self.synthesize("Ready.", "af_bella", 1.0)

    def synthesize(self, text, voice, speed):
        try:
            audio, rate = self.kokoro.create(text, voice=voice, speed=speed, lang="en-us")
        except Exception:
            # Upstream ValueErrors may include user text or phonemes.
            raise RuntimeError("Voice generation failed.") from None
        if rate != SAMPLE_RATE or len(audio) == 0:
            raise RuntimeError("No valid audio was generated.")
        return pcm16(audio)


async def in_thread(function, *args):
    # ONNX cannot interrupt an inference in progress. On disconnect wait for
    # that short chunk before releasing the instance's admission lock.
    task = asyncio.create_task(asyncio.to_thread(function, *args))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        try:
            with anyio.CancelScope(shield=True):
                await task
        finally:
            raise


def create_app(engine_factory=Engine):
    @asynccontextmanager
    async def lifespan(web):
        web.state.engine = await in_thread(engine_factory)
        yield

    web = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    admission = asyncio.Lock()

    def authorize(request):
        key = (os.environ.get("GROKBOT_BACKEND_API_TOKEN") or os.environ.get("BACKEND_API_TOKEN") or "").strip()
        if len(key) < 32:
            raise HTTPException(503, "Voice service authentication is not configured.")
        if not hmac.compare_digest(request.headers.get("authorization", "").encode(), ("Bearer " + key).encode()):
            raise HTTPException(401, "Unauthorized.")

    @web.exception_handler(HTTPException)
    async def error_handler(request, error):
        return JSONResponse({"detail": error.detail}, status_code=error.status_code, headers={"Cache-Control": "no-store"})

    @web.get("/health")
    async def health(request: Request):
        authorize(request)
        return JSONResponse({"ready": True, "model": "kokoro", "runtime": "onnx-cpu", "providers": web.state.engine.providers}, headers={"Cache-Control": "no-store"})

    @web.post("/v1/audio/speech")
    async def speech(request: Request):
        started = time.perf_counter()
        authorize(request)
        if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/json":
            raise HTTPException(415, "Send JSON.")
        raw = bytearray()
        async for block in request.stream():
            if len(raw) + len(block) > MAX_BODY:
                raise HTTPException(413, "Voice request is too large.")
            raw.extend(block)
        try:
            payload = Speech.model_validate(json.loads(raw))
        except (ValueError, ValidationError, RecursionError):
            raise HTTPException(400, "Invalid voice request; provide 1–2000 characters and a supported voice/format.") from None
        if admission.locked():
            raise HTTPException(429, "Voice instance is busy; try again.")
        await admission.acquire()
        engine = web.state.engine
        chunks = iter(text_chunks(payload.input))
        encoder = None
        try:
            if payload.response_format == "mp3":
                import lameenc
                encoder = lameenc.Encoder()
                encoder.set_bit_rate(64)
                encoder.set_in_sample_rate(SAMPLE_RATE)
                encoder.set_channels(1)
                encoder.set_quality(2)
            first = await in_thread(engine.synthesize, next(chunks), payload.voice, payload.speed)
            if encoder:
                first = encoder.encode(first)
                # MP3 can need several chunks before its encoder emits a frame.
                while not first:
                    following = next(chunks, None)
                    if following is None:
                        first = encoder.flush()
                        encoder = None
                        break
                    first = encoder.encode(await in_thread(engine.synthesize, following, payload.voice, payload.speed))
            first_audio_ms = (time.perf_counter() - started) * 1000
        except BaseException:
            admission.release()
            raise

        async def stream():
            try:
                yield bytes(first)
                for text in chunks:
                    if await request.is_disconnected():
                        return
                    audio = await in_thread(engine.synthesize, text, payload.voice, payload.speed)
                    data = encoder.encode(audio) if encoder else audio
                    if data:
                        yield bytes(data)
                if encoder:
                    tail = encoder.flush()
                    if tail:
                        yield bytes(tail)
            except Exception:
                # Do not turn an inference error into a successful partial clip.
                log.error("Kokoro audio stream failed")
                raise

        return AdmittedStream(stream(), admission=admission, media_type="audio/mpeg" if payload.response_format == "mp3" else "audio/pcm", headers={
            "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
            "X-Audio-Sample-Rate": str(SAMPLE_RATE), "X-Audio-Channels": "1",
            "X-Kokoro-Runtime": "onnx-cpu", "X-Server-First-Audio-Ms": f"{first_audio_ms:.3f}",
            "Server-Timing": f"tts_first_audio;dur={first_audio_ms:.3f}",
        })

    return web


app = create_app()
