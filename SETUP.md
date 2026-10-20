# Open GrokBot deployment and operation

The managed deployment now uses the repository-root `vercel.json`. It is active configuration, not a staged template. It defines a Next.js frontend service, private Python container backend, an internal frontend-to-backend binding (`BACKEND_INTERNAL_URL`), and an `agent-worker` daemon running `python -m app.worker_main` with one instance in `iad1`, 2 GiB requested memory, and a 60-second termination grace period. The root rewrite sends public traffic to the frontend.

The authorized Atlas native PostgreSQL credential is configured as the primary state database, using the isolated `grokbot` schema. It is not automatic dual writing to Hive and Atlas. Use the unpooled native connection for the worker’s session-level advisory lock: a transaction-pooler URL cannot preserve the required session affinity. The replacement deployment is ready and its fresh worker heartbeat has been verified; longer-term stability remains under observation.

## Managed configuration

Configure secret values through the project's Vercel environment settings, keeping backend credentials out of browser-visible `NEXT_PUBLIC_*` variables. Both backend service and worker require the state database, model access, and compatible authentication/encryption configuration.

| Variable | Purpose |
| --- | --- |
| `GROKBOT_DATABASE_URL` | Unpooled native PostgreSQL URL for the authorized Atlas database; the worker requires stable session affinity. `prisma://` and `prisma+postgres://` Accelerate URLs are not asyncpg connections. |
| `DATABASE_SCHEMA=grokbot` | Isolated application schema; initialized on startup with advisory locking. |
| `RUN_EMBEDDED_WORKER=false` | Keep the API container from starting a second runner when the daemon owns execution. |
| `BACKEND_API_TOKEN` | Backend bearer authentication and encryption-key source for stored MCP credentials. Keep stable while those credentials exist. |
| `GROKBOT_BACKEND_API_TOKEN` | Matching server-only frontend proxy token. |
| `LLM_USE_GATEWAY=true` | Route configured models through Vercel AI Gateway. |
| `AI_GATEWAY_API_KEY` or Vercel OIDC | Server-side gateway authentication. Configuration alone does not establish model access or credit. |
| `GROKBOT_VERIFY_CLOUD=true` | Opt-in one-time GPT-6.1 Sol response and public DeepWiki MCP discovery checks; stores timestamps, never secrets. |
| `SANDBOX_BACKEND=vercel` | Managed Vercel Sandbox shell/file adapter; Docker is the default alternative. |

The frontend automatically prefers its internal service binding. A separately hosted backend may instead use server-only `GROKBOT_BACKEND_URL`. Leave `NEXT_PUBLIC_API_URL` unset for the same-origin proxy. Keep deployment protection enabled: the app has backend bearer authentication but no account-isolated user system. Backend APIs should remain private. Playwright Chromium is installed in the backend container for hosted browser tools. Project environment secrets are not injected into shell/file sandboxes.

Forty-three available Hive/Atlas values were imported under separate prefixes; an inventory records 177 variable names. The Connections → Vercel variables view shows names and Configured/Needs link states only. Protected values that Vercel would not export still need to be linked through authorized project configuration. Never infer a working service integration from a variable name.

## Verify after the build completes

1. Open Workspace setup. The runtime check verifies the database and reports the worker's last heartbeat. A heartbeat younger than 30 seconds marks the worker ready; API reachability alone is insufficient.
2. Start a small text task in Agent lounge. Confirm persisted user messages, queued/running/completed status, actual model replies, specialist contributions, and final coordinator synthesis.
3. Test an enabled tool, then reload the conversation to verify persistence. Verify managed sandbox, browser, media generation, and each connected MCP service independently; none is proven by a text reply.
4. Cancel a queued and a running task. Pending tasks can cancel immediately; running jobs request cancellation and stop future steps. An in-flight external action may already have completed.
5. Confirm the hosted worker continues with the browser closed. The daemon configuration expresses this deployment intent; only live observation establishes operation.

The single runner uses PostgreSQL advisory lock `1763000274`, including across rolling deployments, and checks the owning backend PID to detect lost session affinity. This replaces the prior key to avoid a legacy pooled-session lock. A stale heartbeat must not be shown as a healthy worker. Startup marks abandoned running jobs interrupted rather than automatically replaying external side effects. Review interrupted work before resubmitting.

## Models, teams, and files

The main default is OpenAI GPT-6.1 Sol using the Responses API path. Agent lounge provisions Coordinator, Builder, Researcher, Writer, Reviewer, and Runner. The coordinator chooses up to three specialists, or two by default, then synthesizes their shared-history findings. Other team rooms support 2–6 agents with bounded rounds. Provider availability depends on the configured gateway/account; named model menus are not an access guarantee.

The composer accepts PNG/JPEG/WebP, PDF, UTF-8 text, MP3, and WAV, up to four files and 3 MB combined. Attachments persist in the database and are retrieved through authenticated routes; raw payloads are excluded from message-list responses. Recent attachment sets are resent with history. Files go to the selected provider. Media output uses the implemented image/video tools and provider credits. Video input, microphone recording, and transcription fallback are not provided.

## Remote MCP connections

Open Connections → MCP servers, supply a public HTTPS Streamable HTTP endpoint and optional bearer token, then Connect & enable. Discovery must advertise at least one tool. The app requires a private authentication/encryption secret of at least 32 characters before accepting a bearer credential. It stores the token encrypted, never returns it through the public listing, and exposes discovered tools to agents with Plugins enabled. Connections can be toggled or disconnected. OAuth-only services need their own connection flow. These tools can read or change external service data; enable only intended connections. The UI lists tool names and descriptions, not credentials.

## Local or Docker alternative

Use `.env.example` as a starting point. Set a native state database URL and explicit provider credentials or gateway authentication. Docker sandbox mode uses `SANDBOX_BACKEND=docker` and the `open-grokbot-sandbox:latest` image. Build it with `docker build -t open-grokbot-sandbox:latest ./sandbox`, then run the applicable Compose configuration. A local embedded worker is available through `RUN_EMBEDDED_WORKER=true`; do not run it alongside another runner unless protected by the PostgreSQL lock. Keep this deployment private and use stable backend authentication/encryption configuration.

## Appearance and glass controls

Appearance preferences are stored in this browser’s local storage and applied immediately. Defaults are Rose accent, 16px message text, 88% desktop message width, 24px glass blur, comfortable roster density, and enabled interface animations. Text size spans 14–22px, width 60–100%, and blur 0–40px. Reset appearance restores those defaults. OS reduced-motion preference disables the select entrance animation; the in-app motion switch disables interface animation and transitions. Glass selects use Radix focus, typeahead, and keyboard selection rather than browser-native option rendering.

## Bounded cloud goals

Open Goals and specify the desired outcome, measurable completion criteria, workspace, manager, interval, and maximum runs. The first run is due immediately; later runs are persisted and scheduled by the hosted worker, without keeping the browser open. A healthy worker is required. UI intervals range 15 minutes–24 hours; the API allows up to seven days. Runs are finite (1–20, default three); at most ten goals can be active. The manager’s completion tool records evidence, and completion is finalized only after its task succeeds. Pause stops pending work or requests cancellation; in-flight external effects cannot be undone. Failed/interrupted executions block the goal until reviewed and explicitly resumed, within its remaining allowance. Restart does not replay interrupted effects. Agent-created follow-ups are limited to three runs, one goal per task, no nested goals. A live browser-created Luna goal completed successfully with one run and recorded completion evidence.

## Webhook channels

Create a channel with an existing room, Sol or Luna manager, and optional public HTTPS result destination. Save the displayed key immediately; it is not shown again. Incoming requests use `POST /api/channels/{id}/events`, `X-Grokbot-Channel-Key`, and JSON containing a unique `event_id` plus `text`. Repeated IDs return the original task instead of queueing another. The app accepts at most ten new events per channel per minute and rejects channel work when the workspace already has 20 pending/running tasks.

Frontend channel endpoints remain behind Vercel deployment protection; an external sender must also provide the deployment’s automation bypass header when protection requires it. A channel key does not bypass that layer. The channel does not grant private-app login/OAuth or permission to access another service.

Finished results use the database outbox. Outgoing payloads contain `task.finished`, task ID, status, and result text; they are signed with HMAC-SHA256 using the channel key in `X-Grokbot-Signature: sha256=…`, plus an `Idempotency-Key`. Verify the signature against raw request bytes and deduplicate deliveries at the receiver. The outbox makes at most three attempts with increasing retry delays. Disabling a channel stops new intake and skips pending delivery. Use Run connection test and Delivery log to inspect actual task/delivery status; queueing a test does not establish delivery success. A live browser-created channel queued and completed its Luna connection test. External outgoing delivery remains covered by mocked signature/retry tests, rather than a live third-party receiver.

MCP connections now expose per-tool enable switches and Refresh tools. A failed refresh preserves the saved connection. Enabling a connection is not equivalent to enabling all tools, and private accounts still require supported service authentication.

## Opt-in cloud smoke checks

Set `GROKBOT_VERIFY_CLOUD=true` to run the worker's cloud smoke checks once per check-version marker (`cloud_check_finished_v4` currently). Checks request a small GPT-6.1 Sol reply, probe a DeepSeek V3.2 fallback, discover DeepWiki tools, and invoke `read_wiki_structure` for `vercel/ai`. Results are persisted in `RuntimeCheck` with status, timestamp, and safe diagnostic detail, and exposed through the protected runtime response. The diagnostic sanitizer redacts credentials and endpoint strings. Checks use provider access and may incur usage; they are not a substitute for a complete agent/tool workflow. Retaining the finished marker prevents repeated checks on ordinary worker restarts.

## Evidence and limits

Production revision b473 previously verified database/worker operation, generated OpenAI PNG, Gemini JPEG, and Veo MP4 media, and a real GPT-6 Luna → Gemini group job. DeepWiki tool invocation was also verified. The former free-credit restriction is historical and no longer describes the current verified capability. The glass controls and appearance preferences were verified in production at desktop and mobile widths, including keyboard selection and preference persistence. A browser-created cloud goal and channel connection test both completed through the hosted worker. Source checks passed 31 backend tests and the frontend production build; per-plugin tool controls and signed outgoing delivery have automated coverage. Prior live results do not prove the new workflows or every model, provider, sandbox, or connected service.
