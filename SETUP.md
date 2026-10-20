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
