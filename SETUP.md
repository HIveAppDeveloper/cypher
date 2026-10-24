# Open GrokBot deployment and operation

The managed deployment now uses the repository-root `vercel.json`. It is active configuration, not a staged template. It defines a Next.js frontend service, private Python container backend, an internal frontend-to-backend binding (`BACKEND_INTERNAL_URL`), and an `agent-worker` daemon running `python -m app.worker_main` with one instance in `iad1`, 2 GiB requested memory, and a 60-second termination grace period. The root rewrite sends public traffic to the frontend.

The authorized Atlas native PostgreSQL credential is configured as the primary state database, using the isolated `grokbot` schema. It is not automatic dual writing to Hive and Atlas. Use the unpooled native connection for the worker’s session-level advisory lock: a transaction-pooler URL cannot preserve the required session affinity. The replacement deployment is ready and its fresh worker heartbeat has been verified; longer-term stability remains under observation.

The production app is https://open-grokbot-hiveapp.vercel.app. Sign in with your verified email or a configured Google account. Your Mac and browser can be closed after a job is queued: the Vercel daemon executes it and PostgreSQL retains the result. Sandboxes run in Vercel, without a local Docker daemon.

## Managed configuration

Configure secret values through the project's Vercel environment settings, keeping backend credentials out of browser-visible `NEXT_PUBLIC_*` variables. Both backend service and worker require the state database, model access, and compatible authentication/encryption configuration.

| Variable | Purpose |
| --- | --- |
| `GROKBOT_DATABASE_URL` | Unpooled native PostgreSQL URL for the authorized Atlas database; the worker requires stable session affinity. `prisma://` and `prisma+postgres://` Accelerate URLs are not asyncpg connections. |
| `DATABASE_SCHEMA=grokbot` | Isolated application schema; initialized on startup with advisory locking. |
| `RUN_EMBEDDED_WORKER=false` | Keep the API container from starting a second runner when the daemon owns execution. |
| `BACKEND_API_TOKEN` | Backend bearer authentication and encryption-key source for stored MCP credentials. Keep stable while those credentials exist. |
| `GROKBOT_BACKEND_API_TOKEN` | Matching server-only frontend proxy token. |
| `OMNIROUTE_URL` | Existing cloud OmniRoute origin. Model requests use this route when configured. |
| `OMNIROUTE_API_KEY` | Server-only inference key reused from the authorized OmniRoute connection. |
| `OMNIROUTE_CONTROL_KEY` | Private provider-check key. Set the same value as `OMNIROUTE_CLOUD_CONTROL_KEY` in the connected OmniRoute Cloud project. |
| `OMNIROUTE_DASHBOARD_URL` | Optional browser URL for the OmniRoute Providers page; if omitted, Cypher opens `/providers` on the configured OmniRoute origin. Keep that Vercel project protected by SSO. |
| `OMNIROUTE_PROTECTION_BYPASS` | Server-only deployment access secret, when the OmniRoute deployment is protected. Redirects never receive it. |
| `OMNIROUTE_MODEL_MAP` | Optional JSON map of GrokBot model IDs to native OmniRoute model IDs when names differ. Exact IDs are enabled only when they appear in OmniRoute's live catalog. |
| `GROKBOT_VERIFY_CLOUD=true` | Opt-in model, agent-fleet, MCP, browser, and computer checks; stores timestamps, never secrets. |
| `SANDBOX_BACKEND=vercel` | Managed Vercel Sandbox shell/file adapter; Docker is the default alternative. |
| `REQUIRE_USER_AUTH=true` | Require a verified account for private workspace APIs. |
| `AUTH_SESSION_SECRET` | Stable server-only secret signing account sessions. |
| `GROKBOT_PUBLIC_URL` | Stable production origin for email sign-in links. |
| `REDIS_URL` | Optional cache endpoint; leave unset in the managed PostgreSQL deployment. |

The frontend automatically prefers its internal service binding. A separately hosted backend may instead use server-only `GROKBOT_BACKEND_URL`. Leave `NEXT_PUBLIC_API_URL` unset for the same-origin proxy. Production uses Vercel Standard Protection: preview and generated deployment URLs require Vercel access, while stable production domains reach the app's own account sign-in. Private APIs require a valid signed session, and the internal backend additionally requires its bearer token. Playwright Chromium is installed in the backend container for hosted browser tools. Project environment secrets are not injected into shell/file sandboxes.

Forty-three available Hive/Atlas values were imported under separate prefixes; an inventory records 177 variable names. The Connections → Vercel variables view shows names and Configured/Needs link states only. Protected values that Vercel would not export still need to be linked through authorized project configuration. Never infer a working service integration from a variable name.

## Verify after the build completes

1. Open Workspace setup. The runtime check verifies the database, worker heartbeat, and release identity. A fresh heartbeat from a different deployment reports the worker as updating rather than ready. Missing release metadata is reported as unknown. Also inspect `vercel daemons inspect agent-worker --project open-grokbot --scope hiveapp --json` and compare its deployment with production; a READY web build alone does not prove the daemon rolled out.
2. Start a small text task in Agent lounge. Confirm persisted user messages, queued/running/completed status, actual model replies, specialist contributions, and final coordinator synthesis.
3. Test an enabled tool, then reload the conversation to verify persistence. Verify managed sandbox, browser, media generation, and each connected MCP service independently; none is proven by a text reply.
4. Cancel a queued and a running task. Pending tasks can cancel immediately; running jobs request cancellation and stop future steps. An in-flight external action may already have completed.
5. Confirm the hosted worker continues with the browser closed. The daemon configuration expresses this deployment intent; only live observation establishes operation.

The single runner uses PostgreSQL advisory lock `1763000274`, including across rolling deployments, and checks the owning backend PID to detect lost session affinity. This replaces the prior key to avoid a legacy pooled-session lock. A stale heartbeat must not be shown as a healthy worker. Startup marks abandoned running jobs interrupted rather than automatically replaying external side effects. Review interrupted work before resubmitting.

On shutdown, the worker stops claiming jobs and lets the current execution finish for up to 50 seconds within Vercel's 60-second grace period. Work exceeding the deadline is interrupted and requires review. The next worker handles queued jobs after acquiring the database lock.

## Models, teams, and files

The main default is OpenAI GPT-6.1 Sol through OmniRoute. The OmniRoute Providers page is the place to authorize subscription accounts: Codex for ChatGPT, Claude Code for Claude, Antigravity for Google/Gemini, and xAI OAuth for Grok where the deployed OmniRoute build supports it. Cypher calls the shared OmniRoute gateway key; subscription OAuth tokens remain in OmniRoute. A subscription does not become a vendor-issued API key. Exact model IDs are checked against OmniRoute's authenticated live catalog; aliases with different native IDs need an explicit map. If an automatic specialist has no configured route or lacks a requested capability, GrokBot can use that specialist's declared fallback. Each response records the model route that actually ran. Agent lounge provisions Coordinator, Builder, Researcher, Writer, Reviewer, and Runner. The coordinator delegates up to three concrete, separate assignments, specialists receive their own assignment, and the coordinator synthesizes their findings. Other team rooms use bounded rounds.

The composer accepts PNG/JPEG/WebP, PDF, UTF-8 text, common audio formats, and MP4/WebM/MOV, up to four files and 3 MB combined. Attachments persist in the database and are retrieved through authenticated routes; raw payloads are excluded from message-list responses. PDFs are rendered page by page; audio and video speech are transcribed; video uploads and public YouTube/Instagram links can be analyzed with timestamped sampled frames. These paths require a compatible OmniRoute model or direct OpenAI connection and return a specific error when the route cannot process the input. OpenAI image generation uses OmniRoute or the direct OpenAI API. Video generation is not offered.

Chat checks OmniRoute's authenticated live catalog (cached for five minutes) or direct-provider capability metadata before inference. Unsupported files produce an explicit error; files are never removed to make a text-only model run. OmniRoute models need the required image and tool capabilities for those requests. PDFs remain attached when the selected route cannot read them. Audio is transcribed only through the configured direct OpenAI connection; OmniRoute audio transcription is not enabled. Generated image bytes are validated before attaching them. A catalog outage stops the request with a recovery message.

`LLM_FALLBACK_MODEL` and optional `LLM_FALLBACK_PROVIDER` enable one explicit backup within the chat model policy. No backup is enabled by default. A backup must support the complete request, including tools and every included file modality. Bounded failover handles temporary provider outages or model unavailability; authentication, billing, permission, and invalid-request errors stop immediately. Route selections are recorded in private logs. Generation settings are rebuilt for the selected route.

For a bounded read-only connectivity probe, send `allow_tools=false` in message options, use text output and one iteration. This removes tool definitions and rejects any returned tool call before execution. Do not treat a bot's empty `tools_enabled` list as a tool-free configuration: the existing registry interprets it as all tools, and ordinary OpenAI managers also receive built-in specialist/memory/goal tools. Normal requests retain their prior behavior.

Vercel OIDC credentials are used only for authorized Vercel Connect integrations. Model inference uses OmniRoute or the configured provider API directly; deployment OIDC tokens are not model keys.

Attachment previews are capped at 280 px on desktop and 220 px on narrow screens, preserving aspect ratio. Open image shows a viewport-bounded viewer with native keyboard dismissal. Interrupted or stalled file reads return an actionable error instead of leaving the composer busy. `npm --prefix frontend run test:attachments` exercises file-read recovery (Node 22.6+); the backend suite runs with `LITELLM_LOCAL_MODEL_COST_MAP=True python -m pytest backend/tests -q` after installing the backend and pytest/pytest-asyncio in an isolated environment.

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

Use the stable production origin for external channel events. It accepts the channel key without a browser session or Vercel bypass. Preview and generated deployment URLs still require deployment protection access. The channel does not grant private-app login/OAuth or permission to access another service.

Finished results use the database outbox. Outgoing payloads contain `task.finished`, task ID, status, and result text; they are signed with HMAC-SHA256 using the channel key in `X-Grokbot-Signature: sha256=…`, plus an `Idempotency-Key`. Verify the signature against raw request bytes and deduplicate deliveries at the receiver. The outbox makes at most three attempts with increasing retry delays. Disabling a channel stops new intake and skips pending delivery. Use Run connection test and Delivery log to inspect actual task/delivery status; queueing a test does not establish delivery success. A live browser-created channel queued and completed its Luna connection test. External outgoing delivery remains covered by mocked signature/retry tests, rather than a live third-party receiver.

MCP connections now expose per-tool enable switches and Refresh tools. A failed refresh preserves the saved connection. Enabling a connection is not equivalent to enabling all tools, and private accounts still require supported service authentication.

## Opt-in cloud smoke checks

Set `GROKBOT_VERIFY_CLOUD=true` to run the worker's cloud smoke checks once per transport-specific version marker. Checks request small Sol and Luna replies, consult a specialist and synthesize its answer, invoke a DeepWiki tool, open a hosted browser page, and execute a cloud computer command. Workspace setup → Verify models and tools queues a fresh run in the worker, including media checks when enabled. Old transport results are never displayed as proof for a new connection. Results are persisted in `RuntimeCheck` with status, timestamp, and safe diagnostic detail, and exposed through the protected runtime response. The diagnostic sanitizer redacts credentials and endpoint strings. Checks use provider access and may incur usage; they are not a substitute for a complete agent/tool workflow. Retaining the finished marker prevents repeated checks on ordinary worker restarts.

## Evidence and limits

Production revision b473 previously verified database/worker operation, generated OpenAI PNG, Gemini JPEG, and Veo MP4 media, and a real GPT-6 Luna → Gemini group job. DeepWiki tool invocation was also verified. The former free-credit restriction is historical and no longer describes the current verified capability. The glass controls and appearance preferences were verified in production at desktop and mobile widths, including keyboard selection and preference persistence. A browser-created cloud goal and channel connection test both completed through the hosted worker. Source checks passed 31 backend tests and the frontend production build; per-plugin tool controls and signed outgoing delivery have automated coverage. Prior live results do not prove the new workflows or every model, provider, sandbox, or connected service.

## Steering the team

Open Steer your team in a conversation. Set the desired outcome, constraints, working pace, and reply style, then Use for next messages. The saved brief is local to this browser and conversation. Quick pass/Balanced/Think it through set low/medium/high thinking effort on future requests. Written spending constraints are model instructions, not hard billing enforcement. When work is queued or running, Send direction to current work persists a visible update for that task. The worker reads it between model/tool steps and reconsiders unexecuted tool calls or an outdated answer. An in-flight external action cannot be recalled; an image/video request must be cancelled and reissued instead. Completed/stopping tasks reject direction changes. A task accepts at most ten changes within its existing iteration limit.

## Immediate messages, files, and memory

The composer adds an optimistic message immediately and persists the user message in the queue transaction. A client UUID reconciles that bubble with the server copy and makes retries with the same identifier return the original task. Failed sends preserve text and file references. IME composition does not trigger Enter-to-send. Attachments support drag-and-drop and extension-based MIME fallback; selecting a file switches to text/multimodal processing so a previous image/video output choice cannot ignore it. Four files and 3 MB combined remain the enforced limits.

Context & memory stores up to 30 inspectable notes per conversation in PostgreSQL, recalls the latest 20 within a 12,000-character prompt budget, and lets users edit or forget entries. Managers can search older public messages. Agent-authored reusable procedures need a completed task from the same conversation as evidence. This is retained context and procedures, not model retraining. Browser cookies and local storage are encrypted under the app secret and restored on a later browser session; password-like extracted form values are redacted. Provider expiry or revocation can still require another login.

## Device approval and account setup

Connections → Accounts & device approval can register one platform passkey on the stable app origin. New plugin connections then require an actual WebAuthn user-verification signature. Challenges expire, are single-use, and approvals bind to the exact plugin URL. Synced passkeys can work on another device. This is extra approval for the private owner workspace, not a replacement for Vercel access protection or a multi-user identity system. Device enrollment cannot be completed by a remote agent without the user's authenticator.

Start account setup queues a Luna-managed browser task with an explicit service URL and account email. It does not imply an account was created, a paid plan was accepted, a CAPTCHA was bypassed, or OAuth was granted. Unsupported human-only steps are reported as blockers. Gmail app OAuth credentials and a mailbox grant are absent. Resend's production receiving credential remains unconfigured after automatic approval review blocked storing an account-wide credential. Existing ChatGPT app sessions are not exported into this application.

## Hosted Lovable sign-in

Lovable restricts automatic registration for hosted callbacks. Its advertised client-metadata flow also rejects unapproved client domains. Either request callback approval from Lovable or register a custom client in **Workspace settings → API keys & OAuth → OAuth clients** as a workspace owner/admin.

Register each production callback, for example `https://open-grokbot-hiveapp.vercel.app/api/plugin-oauth/callback` and `https://open-grokbot.vercel.app/api/plugin-oauth/callback`. Select `offline`, `projects:read`, `projects:write`, `workspaces:read`, and `workspaces:write` for the MCP tools; project/workspace scopes require Business or Enterprise. Users still review and authorize access.

Set `LOVABLE_OAUTH_CLIENT_ID` on the backend and worker. For a Web server client, also set the encrypted `LOVABLE_OAUTH_CLIENT_SECRET`; a public PKCE client uses only the ID. Redeploy, then reconnect Lovable. The SDK handles PKCE, token exchange and refresh; client credentials and tokens stay encrypted in storage. No client is registered automatically in the user's Lovable workspace.

Official instructions: [Lovable OAuth clients](https://docs.lovable.dev/features/oauth-clients).
