# Hive + Atlas Open GrokBot

The web interface uses the supplied light Grok Bot screenshot as its styling reference. Bot CRUD and chat use the real API; simulated replies and fake success fallbacks were removed. Jobs persist in the database. One persistent backend worker runs queued jobs; restart-interrupted jobs are marked `interrupted` rather than replaying external side effects.

## Deployment boundary

- Vercel: Next.js frontend (`frontend/`). It proxies `/api/*` to `GROKBOT_BACKEND_URL`.
- Trusted, always-on Docker host: FastAPI backend, one worker process, Redis, Docker sandbox containers.
- Hive native PostgreSQL connection: application state in the isolated `grokbot` schema.
- Atlas + Hive variables: imported with `ATLAS_` and `HIVE_` prefixes, without collisions. Having a credential does not create a tool integration for that service.
- Do not expose the backend directly to the Internet. Use an authenticated private network or gateway. Keep the Vercel frontend protected before connecting a runtime. The upstream app does not implement user accounts.

Prisma Accelerate URLs (`prisma://` or `prisma+postgres://`) do not work with Python asyncpg. Use the native PostgreSQL URL from Prisma Postgres. No Prisma ORM migration is run against Hive or Atlas.

## On the Docker host

Install Docker Desktop (Mac) or Docker Engine with Compose (Linux), Python 3.11+, Node.js, and the Vercel CLI. Then:

```bash
git clone https://github.com/HIveAppDeveloper/open-grokbot.git
cd open-grokbot
python3 -m pip install python-dotenv
cp .env.example .env
```

Export each project's variables separately, linked to your existing Vercel team:

```bash
mkdir -p .private/hive .private/atlas
cd .private/hive
npx vercel link --yes --project hive --scope team_UafepbgM7cD7FhLkcShYT9re
npx vercel env pull .env.export --environment=production --yes
cd ../atlas
npx vercel link --yes --project atlas --scope team_UafepbgM7cD7FhLkcShYT9re
npx vercel env pull .env.export --environment=production --yes
cd ../..
python3 scripts/import-vercel-envs.py --hive .private/hive/.env.export --atlas .private/atlas/.env.export
```

Vercel can omit production/preview Secret values from exports. Add omitted values directly on your trusted host; do not commit them or paste them into chat. Required overrides in `.env`:

```dotenv
GROKBOT_DATABASE_URL=postgresql://YOUR_NATIVE_HIVE_CONNECTION
LLM_PROVIDER=gemini
LLM_MODEL=gemini-2.5-flash
LLM_API_KEY=YOUR_PROVIDER_KEY_IF_NOT_IMPORTED
DATABASE_SCHEMA=grokbot
NEXT_PUBLIC_API_URL=
```

If reusing Atlas's database instead, put its native URL in `GROKBOT_DATABASE_URL`. The app uses one primary state database, not automatic dual writes. Both sets of imported variables remain available to backend integrations. Credentials are not passed to Docker sandboxes.

```bash
docker build -t open-grokbot-sandbox:latest ./sandbox
docker compose -f docker-compose.cloud.yml up --build -d
```

Open `http://localhost:3000`. Create a bot with provider `gemini` and your chosen model. Send a message; the worker persists and runs the job. Click `Start computer` to launch the Docker sandbox. The upstream tool registry enables all tools when the bot tools list is empty. Set explicit tool categories through the API to limit a bot. These tools execute without an approval UI, so run only on your own trusted private host.

## Vercel frontend

Import your fork into Vercel with Root Directory `frontend`. Set server-only `GROKBOT_BACKEND_URL` to your authenticated backend gateway. Leave `NEXT_PUBLIC_API_URL` unset so requests use the same-origin proxy. No Hive or Atlas secrets belong in `NEXT_PUBLIC_*` variables. The runtime must be reachable by Vercel, protected, and return the API routes above. Set `BACKEND_API_TOKEN` on the backend and the same secret as server-only `GROKBOT_BACKEND_API_TOKEN` on Vercel. The proxy forwards it as a Bearer token; backend API and WebSocket routes verify it. Keep frontend deployment protection enabled as well. Generate a dedicated random token on the private host, for example with `openssl rand -hex 32`.

## Checks performed

The production frontend build and Python API integration tests run locally. The integration test exercises real database persistence and queue execution with an explicitly mocked model response. It does not prove live provider access.

Live Hive database access, a live provider response, Docker sandbox execution and a full production deployment still need verification on the configured host. This environment does not have Docker; database DNS is restricted and Vercel hides Hive's Secret values.

## Limits

This is a repaired MVP, not feature parity with xAI Grok Bot. A screenshot does not supply its private runtime. There is no scheduler/routines UI, account-isolated authentication, secure interactive sign-in handoff, app catalog, voice recording, video input, or service-specific Hive/Atlas tools. Uploaded MP3/WAV files are supported as inputs for compatible models. The browser tool in the upstream project runs headless browser sessions on the backend; it is not a remote desktop protocol. Jobs are single-worker and interrupted jobs require review. Do not start multiple Uvicorn workers with this runner.

## Team rooms and multimodal input

Create at least two agents, then choose New beside Team rooms. Select 2–6 agents. Each sees shared history, can hand work to another participant using `HANDOFF[Name: task]`, and can participate in 1–4 discussion rounds. Each agent has at most two turns per round, limiting handoff loops. Controls adjust temperature, output tokens, tool steps, team rounds and typeface; they apply to the next submitted job.

Use the plus in the composer to attach PNG/JPEG/WebP, PDF, plain text, MP3 or WAV files. Maximum four files and 3 MB combined. Attachments persist with the message in the state database and are served through authenticated attachment routes. Raw payloads are excluded from message-list responses. The three newest attachment sets are resent to the model with recent history; older filenames remain references. Files are transmitted to the selected model provider. Input support varies by model. Video, recording, transcription fallback and generated media are not implemented.

Seven tests cover native connection normalization, input validation, API authentication, queued jobs, persisted messages, team handoff/shared history, and authenticated attachment retrieval. Provider calls in these tests are mocked.


## Managed Vercel backend (staged, not enabled)

`deployment/vercel.managed.json` defines the Next.js service, a private Python
container service, and one persistent agent-worker daemon. Services and Daemons
are Vercel Beta products. Copy this configuration to the repository root as
`vercel.json` and clear the project's Root Directory only after the production
runtime secrets are configured.

Required production variables:

| Variable | Purpose |
| --- | --- |
| GROKBOT_DATABASE_URL | Native PostgreSQL URL for the authorized database; Prisma Accelerate URLs are unsupported |
| DATABASE_SCHEMA | `grokbot` keeps agent tables separate from the existing app |
| BACKEND_API_TOKEN | Random private API token |
| GROKBOT_BACKEND_API_TOKEN | Same token, used by the frontend server proxy |
| RUN_EMBEDDED_WORKER | `false`; the daemon owns the worker loop |
| SANDBOX_BACKEND | `vercel` for hosted agent computers |
| LLM_USE_GATEWAY | `true` to use Vercel AI Gateway |
| AI_GATEWAY_API_KEY | Optional when a valid VERCEL_OIDC_TOKEN is available to the calling runtime |

The frontend receives BACKEND_INTERNAL_URL through a private service binding.
Do not manually populate it. AI Gateway maps Gemini models to the `google/`
provider namespace. No gateway credential is sent to the browser.

The worker holds a PostgreSQL advisory session lock, so a rolling deployment
waits for the previous worker to exit before claiming tasks. An interrupted task
is marked interrupted rather than replaying potentially completed tool actions.
A session-preserving native database endpoint is required for this lock; do not
use transaction-mode PgBouncer for the worker connection.

**Still required before enabling:** authorized native PostgreSQL credentials,
live gateway authentication verification, and live managed sandbox verification for
shell/file tools. Set SANDBOX_BACKEND=vercel on the managed deployment; it does
not require a nested Docker daemon. Browser tooling also requires the installed
Playwright runtime. A successful frontend build does not verify these services.


## Simple use and provider controls

Start a task directly from the home prompt; an Assistant and conversation are
created automatically. Or choose a ready-made role when adding an agent.
Custom model IDs are optional and live under Customize this agent.

OpenAI controls include a named model menu and a three-position model power
slider (GPT-4.1 mini, GPT-5.4 mini, GPT-5.4). GPT-5.4 choices show thinking effort.
Processing speed selects flex, default, or priority service. Priority is a
best-effort provider hint and may cost more. Unsupported reasoning settings are
not forwarded to other model families. Personal run preferences are stored in
this browser and copied into each persisted task; they are not account-wide.

Image/video output is generated through AI SDK for Python 0.8.0 (Beta), not an
illustrative UI. Defaults are IMAGE_MODEL=bfl/flux-2-pro and
VIDEO_MODEL=google/veo-3.1-fast-generate-001, verified in the gateway catalog on
2026-10-20. Change these server variables to compatible gateway model IDs.
Use AI_GATEWAY_API_KEY or Vercel OIDC access available to the actual worker.
Media uses gateway credentials even when chat uses a direct provider key.
Media generation tools can also be enabled for an agent, so it can choose when
to generate during a task. One returned asset per call is retained in PostgreSQL
(up to 32 MB), served through the authenticated attachment endpoint, and shown
as an image or playable MP4. This small-deployment implementation stores assets
in database JSON; a high-volume deployment should move them to private object
storage. Explicit image/video mode uses the text prompt, not uploaded reference
files. Video currently accepts landscape/portrait and 4, 6, or 8 seconds.
Live paid image/video generation remains unverified without runtime credentials.

For managed shell and file tools, set SANDBOX_BACKEND=vercel. The broker uses
vercel-sandbox 0.8.0 with Vercel OIDC, creates a persistent named VM per agent,
auto-resumes it for tool calls, and never injects the project's environment
variables into that VM. Sessions have a 10-minute limit; commands have a
5-minute limit. Stopping a computer preserves its snapshot according to the
provider retention policy. Docker is the default for existing self-hosted
installs. Browser tools continue to use Playwright in the hosted backend.
Managed sandbox access is covered by adapter tests with a mocked SDK, not a
live Sandbox provisioning test.
