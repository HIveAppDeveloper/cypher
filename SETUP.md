# Open GrokBot deployment and operation

The managed deployment now uses the repository-root `vercel.json`. It is active configuration, not a staged template. It defines a Next.js frontend service, private Python container backend, an internal frontend-to-backend binding (`BACKEND_INTERNAL_URL`), and an `agent-worker` daemon running `python -m app.worker_main` with one instance in `iad1`, 2 GiB requested memory, and a 60-second termination grace period. The root rewrite sends public traffic to the frontend.

The authorized Atlas native PostgreSQL credential is configured as the primary state database, using the isolated `grokbot` schema. It is not automatic dual writing to Hive and Atlas. The deployed backend has successfully queried Atlas PostgreSQL and a live worker heartbeat has been observed. Revision `017457` adds opt-in model and MCP self-checks; their results are recorded separately from configuration status.

## Managed configuration

Configure secret values through the project's Vercel environment settings, keeping backend credentials out of browser-visible `NEXT_PUBLIC_*` variables. Both backend service and worker require the state database, model access, and compatible authentication/encryption configuration.

| Variable | Purpose |
| --- | --- |
| `GROKBOT_DATABASE_URL` | Native PostgreSQL URL for the authorized Atlas database. `prisma://` and `prisma+postgres://` Accelerate URLs are not asyncpg connections. |
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

The single runner uses a PostgreSQL advisory lock, including across rolling deployments. Startup marks abandoned running jobs interrupted rather than automatically replaying external side effects. Review interrupted work before resubmitting.

## Models, teams, and files

The main default is OpenAI GPT-6.1 Sol using the Responses API path. Agent lounge provisions Coordinator, Builder, Researcher, Writer, Reviewer, and Runner. The coordinator chooses up to three specialists, or two by default, then synthesizes their shared-history findings. Other team rooms support 2–6 agents with bounded rounds. Provider availability depends on the configured gateway/account; named model menus are not an access guarantee.

The composer accepts PNG/JPEG/WebP, PDF, UTF-8 text, MP3, and WAV, up to four files and 3 MB combined. Attachments persist in the database and are retrieved through authenticated routes; raw payloads are excluded from message-list responses. Recent attachment sets are resent with history. Files go to the selected provider. Media output uses the implemented image/video tools and provider credits. Video input, microphone recording, and transcription fallback are not provided.

## Remote MCP connections

Open Connections → MCP servers, supply a public HTTPS Streamable HTTP endpoint and optional bearer token, then Connect & enable. Discovery must advertise at least one tool. The app requires a private authentication/encryption secret of at least 32 characters before accepting a bearer credential. It stores the token encrypted, never returns it through the public listing, and exposes discovered tools to agents with Plugins enabled. Connections can be toggled or disconnected. OAuth-only services need their own connection flow. These tools can read or change external service data; enable only intended connections. The UI lists tool names and descriptions, not credentials.

## Local or Docker alternative

Use `.env.example` as a starting point. Set a native state database URL and explicit provider credentials or gateway authentication. Docker sandbox mode uses `SANDBOX_BACKEND=docker` and the `open-grokbot-sandbox:latest` image. Build it with `docker build -t open-grokbot-sandbox:latest ./sandbox`, then run the applicable Compose configuration. A local embedded worker is available through `RUN_EMBEDDED_WORKER=true`; do not run it alongside another runner unless protected by the PostgreSQL lock. Keep this deployment private and use stable backend authentication/encryption configuration.

## Evidence and limits

Sixteen backend tests passed with mocked model/provider and SDK interactions; the Next.js production build passed. These demonstrate implementation checks, not live cloud functionality. Database connectivity and worker readiness have been verified through the live protected runtime endpoint. Live provider/media calls, MCP execution, managed Sandbox access, and the complete user flow need separate evidence. Do not report the system as connected or always-on until those checks succeed. There is no scheduler/routines UI, account isolation, interactive browser sign-in handoff, or service-specific Hive/Atlas integration merely from importing configuration.
