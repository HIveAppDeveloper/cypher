# Paradee CPU voice candidate

The human user explicitly allowed a Kokoro-derived model. This candidate is
Paradee 8M v1.1, distilled from Kokoro-82M, with one voice (`af_heart`), English,
24 kHz mono PCM or streaming MP3. It identifies itself as `paradee-8m-v1.1` in
health, private response headers and the frontend provider header. Requests for
another model or voice fail before inference. It must not be labeled Kokoro-82M.

Upstream code: https://github.com/sahilmahendrakar/paradee/tree/606e16e12f53bc6dfb814fe89fef338726687161

Model revision: https://huggingface.co/sahilmahendrakar/Paradee-8M-v1.1/tree/330617ad1f097b4f6b02c103e54b39006c090b45

Both are Apache-2.0; notices are in `licenses/`. `download_paradee.py` pins and
verifies the upstream model/config and all native build headers. PocketFFT is
BSD-3-Clause; the ONNX Runtime headers are MIT.

## CPU changes

The build decodes constant weights once, precomputes static style projections
with deterministic float64 accumulation and one final float32 rounding, replaces
a 64-harmonic sine bank with its finite-series identity, expresses sparse
frequency interpolation directly, and replaces dense Fourier-basis convolutions
with native PocketFFT operators. Neural weights receive no further quantization.
The Python Fourier bridge and an additional integer neural variant were tested
and rejected. Build scripts refuse unexpected Fourier/interpolation graphs.

The model/session/G2P load once. A complete first word is synthesized before the
rest of the text; short function words stay with the following word. Subsequent
chunks are at most 180 characters at word/sentence boundaries. This is phrase
streaming; boundaries can change prosody. There is no audio cache, fake prefix,
silence injection, prompt persistence or external inference request. MP3 uses
64 kbps mono with LAME algorithm quality 5. First chunks have been decoded and
checked for nonzero speech energy, rather than counting headers as audio.

## Deployment contract

`vercel.json` selects `Dockerfile.paradee` for the private `kokoro` service. The
frontend keeps its existing provider unless `KOKORO_TTS_ENABLED=true`. The
reviewed derivative activation also needs `KOKORO_TTS_MODEL=paradee-8m-v1.1` in
the frontend environment. The image already selects that model for the service.
Missing/unsupported configuration fails closed; there is no silent fallback.

The native measurements require **Performance compute: two vCPUs / 4 GB**, with
`KOKORO_CPU_THREADS=2`. A one-CPU instance misses the target. CPU/memory sizing
is a dashboard service setting, not a `memory` entry in `vercel.json`; the owner
must confirm independent sizing of this service without changing other services.
https://vercel.com/kb/guide/vercel-services-fluid-compute

The existing server-only backend bearer token authenticates health and speech.
The public frontend route remains `POST /api/voice {"text":"..."}`, with existing
signed app-session checks, streaming cancellation and bounded request/timeout.
There is no public rewrite to the private model service. Its private contract is:

```json
{"model":"paradee-8m-v1.1","input":"Check pipeline latency.","voice":"af_heart","response_format":"mp3","speed":1}
```

Use the existing Cypher project and shared PostgreSQL/Prisma. This service does
not access a database. No schema, database, environment value, provider default
or alias has been changed by this source candidate. Canonical release owner:
`01a16f1c-f827-7ab0-ae4a-6bccbbb7eed2`. Integrate onto current main; do not deploy
the feature branch's historical base. Owner review, staged binding/auth/cancel
tests, exact frontend/API/worker parity and deployed latency precede activation.

## Verification and latency interpretation

`paradee-verification.json` records the final artifact, source hashes, benchmark
statistics and limitations. Raw measurements are under `evidence/`. Native cloud
measurements use disposable Vercel Sandbox in iad1, 2 vCPUs / 4 GB, authenticated
loopback HTTP, three real warmups, then 30 fresh requests per format. Each full
request text differs. No generated audio is reused. Server first-audio timing
includes validation, G2P, inference, PCM conversion and any MP3 encoding needed
to return a nonempty audio chunk. Client timing includes local HTTP transport.

These measurements are not a deployed Vercel Function/public gateway benchmark.
Longer first words, cold starts, scheduling and network distance can exceed
20 ms. The target is a qualified warm server-processing result, not an SLA.
Keep all samples, including slower tails, when reviewing the result.

Controlled-seed comparison to the upstream derivative checks shape, finite
samples and waveform similarity. A separate test verifies the sparse rewrite.
Eight actual PCM/MP3 service clips were decoded/transcribed by Whisper tiny.en;
this is a coarse intelligibility check, not human listening or a quality study.
The recognizer substitutes “the” for “this” in one sentence, also present with
the upstream model. Original and optimized outputs are not bit-identical due
to floating-point changes and the model's per-request random excitation.

The service suite covers authentication, bounded bodies, format/model/voice
validation, streaming, cancellation/admission recovery, and MP3 frames. The
frontend suite covers model identity, opt-in, auth, forwarding and cancellation.
The Linux/amd64 image is built and tested with real synthesis; a built local
Next route is tested using a synthetic local session. Those local checks do
not certify production user authentication or final release parity.

```sh
docker build --platform linux/amd64 -f tts/Dockerfile.paradee -t cypher-paradee tts
PYTHONPATH=tts python -m pytest tts/tests -q
# Authenticate via environment; never paste credentials into the command.
python tts/benchmark.py https://REVIEWED-ENDPOINT/v1/audio/speech --mode service --model paradee-8m-v1.1 --format pcm
python tts/benchmark.py https://REVIEWED-CYPHER/api/voice --mode cypher --format mp3
```

## Metered base cost

Verified official iad1 Function rates on 2026-10-26: $0.128 per active CPU-hour,
$0.0106 per GB-hour of provisioned memory while requests are in flight, and
$0.60 per million invocations, subject to the existing plan's credits. There
is no dedicated idle GPU/CPU reservation in this design. These are tariff
rates, not a measured invoice or a fixed cost per generation.
https://vercel.com/docs/functions/usage-and-pricing

For the model service, before credits/network/build/storage/frontend costs:
`CPU-seconds * 0.128 / 3600 + GB-seconds * 0.0106 / 3600 + invocations * 0.60 / 1e6`.
Two fully busy CPUs plus 4 GB for a continuous hour would be $0.2984; actual
Function usage scales with active work. Obtain real per-release usage before
claiming a per-request cost. Sandbox testing has separate memory pricing and
is stopped after evidence collection.
