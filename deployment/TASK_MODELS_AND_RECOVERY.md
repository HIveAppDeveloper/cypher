# Task models and conversation recovery

Automatic model selection is the default for chat, goals and channels. Set
`options.routing="manual"` to preserve an explicitly selected model. The
automatic selector examines the current user task, trusted bot role and input
modalities; it does not choose a model from instructions inside retrieved pages.

| Work | Primary model | Capacity backup |
| --- | --- | --- |
| General coordination | OpenAI GPT-6.1 Sol | GPT-6 Luna |
| Complex planning | OpenAI GPT-6 Astra | GPT-6.1 Sol |
| Coding and writing | Anthropic Claude Sonnet 5.5 | GPT-6.1 Sol |
| Research and visual inputs | Google Gemini 3.8 Flash | GPT-6.1 Sol |
| Mathematical/data analysis | DeepSeek V4.1 Flash | GPT-6.1 Sol |
| Independent review | SpaceXAI Grok 4.7 | GPT-6.1 Sol |
| Focused execution | OpenAI GPT-6 Luna | GPT-6.1 Sol |

Exact IDs and capabilities were checked against the live Gateway catalog on
2026-10-21. Every route retains the full request and allowed execution tools.
Backups are capability checked; unsupported attachments are never discarded.
Authentication and billing failures do not trigger another model behind the
same account. Completed answers include actual model-route metadata, including
fallbacks, available under Options. Routes are saved with durable model steps
so worker recovery does not infer a different route for an already saved step.

`analyze_video` sends public YouTube video input to the video-capable Gemini
model. It checks provider input-modality usage before reporting success; a
caption-only text result cannot pass as verified video analysis. At most two
analyses run per task. Other video sites may require authorized access or an
uploaded file; there is no claim of arbitrary private-video access.

## Production outage and transfer reduction

The production database rejected startup connections with an exceeded-quota
error. Its Neon console confirms that the Atlas project's monthly network
transfer allowance was exhausted. Chat polling selected complete message JSON,
including base64 media, before deleting those fields in Python. A large saved
video was consequently downloaded from the database repeatedly even when the
browser response contained only an attachment URL.

PostgreSQL chat queries now strip attachment data inside the database. The
combined sync endpoint accepts an `after_id` cursor and returns only new
messages. Asset contents are fetched through authenticated attachment routes
when actually requested. Desktop refresh slows while idle, backs off on errors,
pauses to a slower interval in hidden tabs and aborts superseded requests.

The standby worker blocks on a PostgreSQL advisory lock rather than polling it
every two seconds. Commit-bound PostgreSQL notifications wake the active worker
for new work; a periodic scan remains for recovery. Heartbeats, catalog scans,
maintenance queries and runtime checks use fewer database operations. Database
schema work is versioned rather than repeating full inspection on every API
cold start. No existing bot model settings are silently rewritten at startup.

Database startup failures keep the API process alive and return a sanitized
503 response with a retry delay. A quota failure retries initialization at most
once per five minutes per process. Restoring an exhausted provider allowance
still requires the provider account action; application retries cannot lift it.

## Validation

Six distinct primary text models returned actual responses with no model
fallback during live Gateway probes. The supplied 21-minute YouTube reference
was processed by Gemini with 85,272 video-input tokens and 32,292 audio-input
tokens. Its output is a requirements reference, not a claim that every feature
demonstrated is already implemented.

Disposable PostgreSQL checks cover schema migration, hard-killed worker
recovery without a duplicate external write, incremental chat sync, preservation
of original attachments and tenant isolation. Unit/integration coverage checks
task selection, model tool/input preservation, visible capacity fallback,
recoverable quota failure and rejection of caption-only video results.
