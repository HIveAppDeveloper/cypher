# Kokoro on the existing Cypher Vercel project

This is the Vercel-only alternative requested after the initial Modal plan. It
runs the upstream Kokoro-82M v1.0 int8 ONNX export on **CPU**, with no Modal or
RunPod account. It does not implement GPU acceleration or establish a 20 ms
time-to-first-audio guarantee. The live Vercel AI Gateway catalog was checked on
2026-10-26 and contained no Kokoro model, so this service hosts the model itself.

The existing Cypher PostgreSQL/Prisma configuration remains unchanged. This
service performs no database operations, creates no tables, stores no clips or
prompts, and needs no separate database. User/workspace data remains in the
existing app. Do not replace that database or copy a different project's URL.

## Service and authentication

`vercel.json` adds a `kokoro` container service rooted here and a private binding
`KOKORO_INTERNAL_URL` on the Next.js frontend. It adds no public rewrite to this
service. The service requires a server-only bearer token on both routes, reusing
the existing `GROKBOT_BACKEND_API_TOKEN` (or legacy `BACKEND_API_TOKEN`). Missing
or short tokens fail closed. Binding URLs and bearer tokens must never reach
browser bundles, API response bodies or logs.

* `GET /health`: authenticated readiness and explicit `onnx-cpu` identity.
* `POST /v1/audio/speech`: JSON `{"model":"kokoro","input":"Hello.","voice":"af_bella","response_format":"pcm"}`.
* Raw PCM is signed 16-bit little-endian, mono, 24 kHz, with no WAV header.
* `response_format: "mp3"` streams real LAME-encoded MP3 for the existing Cypher
  audio element/MSE playback path. Encoding can add first-audio delay.
* Input is bounded to 2000 characters and 12 KiB, voices are allowlisted, speed
  is bounded to 0.5–2.0. One generation per instance; extra concurrent requests
  return 429. No request queue is held in application memory.
* The first phrase is short; later phrases retain more context. Chunk boundaries
  can affect prosody. This is phrase streaming, not incremental neural decoding.
* Disconnection stops subsequent chunks. An already running ONNX call completes
  before the instance admission lock is released. No overlapping inference is
  allowed after a cancellation. Client timeouts are bounded by the existing
  voice route's 20-second timeout.

Weights are downloaded during image build, not per request, and verified against
the SHA-256 values in `download_models.py`. Model + voices total 120,575,669 bytes.
The model/session initializes once per container, followed by one nonblank
warmup inference. Repeating an identical CPU warmup three times delayed cold
starts without compiling a different graph. Dependencies and licenses are
recorded alongside the service; the Docker image carries the license notices.

## Opt-in and release

`KOKORO_TTS_ENABLED` must be exactly `true` before `/api/voice` uses the service.
Without it, the existing ElevenLabs provider remains selected. A missing Kokoro
binding or bearer token returns 503 when opted in; no silent provider fallback.
The browser request remains `POST /api/voice {"text":"..."}` and the response
remains progressive `audio/mpeg`. Existing app-session authentication is preserved.

Release through the canonical owner, chat `01a16f1c-f827-7ab0-ae4a-6bccbbb7eed2`.
This source candidate does not itself change production environment values,
aliases, databases or provider defaults. The owner must stage the exact source
on the existing `cypher` project, verify the Linux container build and private
binding, opt in on a reviewed candidate, then verify frontend/API/worker parity
before promotion. Test signed-in success, signed-out rejection, first MP3 bytes
before the clip completes, Stop after headers, and cold/warm latency.
No credentials or additional database are needed from the user for this path.

## Reproduce locally

Use Python 3.12 and an isolated virtual environment. Install `requirements.lock.txt`,
plus `pytest==9.1.1` and `httpx==0.28.1` for the tests. Run:

```sh
PYTHONPATH=tts python -m pytest tts/tests -q
KOKORO_MODEL_DIR=/your/ignored/model-cache python tts/download_models.py
# Set a local-only fixture GROKBOT_BACKEND_API_TOKEN securely before starting.
PYTHONPATH=tts uvicorn kokoro_service:app --host 127.0.0.1 --port 8953
python tts/benchmark.py http://127.0.0.1:8953/v1/audio/speech --mode service --format pcm
python tts/benchmark.py http://127.0.0.1:8953/v1/audio/speech --mode service --format mp3
```

`benchmark.py` fully consumes each clip and measures the first actual audio byte,
not response headers. It performs three real warmups and reports every sample,
including the server's first-audio measurement. For `/api/voice`, use the default
`--mode cypher` and a securely configured `CYPHER_BENCH_COOKIE` containing a valid
app session. Redirects are refused to avoid forwarding authentication elsewhere.
Do not publish tokens or session cookies in commands, reports or screenshots.

`local-verification.json` records the initial candidate's local measurements only. Isolated synthesis of
the benchmark sentence took 1101–1130 ms, with 3.508 seconds of initialization and
warmup and 467,369,984 bytes peak process RSS. Actual local HTTP medians were
2363.255 ms PCM and 2487.520 ms MP3. The built Next.js proxy also returned valid
MP3 through a synthetic signed session. These results **do not meet 20 ms** and
are not measurements of the Vercel runtime. The follow-up
`latency-investigation.json` records actual Linux/amd64 container builds and CPU
experiments. Docker Desktop was started for these disposable tests; its image
builds and real HTTP MP3 output now pass locally. Deployed Vercel binding,
playback and latency remain unverified; release belongs to the canonical owner.

Two fresh-container runs per variant, each limited to one CPU and 2 GB, measured
median container-start-to-first-audio of 17,387.776 ms before and 10,132.636 ms
after the warmup fix (41.73% less). These include process startup and actual
MP3 generation under local AMD64 emulation. They are diagnostic samples, not a
Vercel benchmark or percentile estimate; warm inference still exceeds 20 ms.

Profiling put more than 99% of warm synthesis time inside ONNX inference.
Neither HTTP nor JSON processing explained the delay. A shorter first chunk
reduced first-audio time in local emulation but made complete-clip generation
slower, so it was rejected. Increasing thread count helped FP32 on the Mac, but
Vercel's standard instance has one vCPU; these results do not justify increasing
the entire project's CPU/memory allocation. No benchmark-only phrase, silence,
fake audio header or cache-hit-only result is used to claim a 20 ms success.

## Cost and scaling

Vercel Container Runtime and Services are currently beta. They scale down when
idle; cold instances must reload the ONNX session and repeat warmups. Do not use
periodic keepalive requests to disguise cold starts or claim zero idle costs
from a warmed continuously running instance.

Published `iad1` Fluid compute rates checked 2026-10-26 are $0.128 per active
CPU-hour and $0.0106 per provisioned GB-hour, plus invocation, service-request
and transfer charges. Those are base rates, **not a verified per-generation
price**. Actual cost depends on deployed memory allocation, measured CPU time,
clip length, concurrency, cold starts and the team's included credits. Do not
infer Vercel billing from the Mac's memory RSS or wall time.

Official references:

* https://vercel.com/docs/services/bindings
* https://vercel.com/docs/services/pricing
* https://vercel.com/docs/functions/runtimes/container
* https://vercel.com/docs/functions/usage-and-pricing
* https://ai-gateway.vercel.sh/v1/models
* https://huggingface.co/hexgrad/Kokoro-82M
* https://github.com/thewh1teagle/kokoro-onnx
