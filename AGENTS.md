# Repository notes for automated/dev sessions

## Running this app in the sandbox

- `docker compose -f docker-compose.base44.yml up -d` is the development stack. The
  repository's own `docker-compose.yml` builds production images with the source
  baked in, so it cannot be used while editing.
- The stack runs from the bind-mounted source: `uvicorn --reload` for `backend/`
  and `next dev` for `frontend/`. Node dependencies live in the `web_node_modules`
  volume (seeded from the image), Python dependencies are baked into the backend
  image. Changing `frontend/package.json` or `backend/pyproject.toml` requires a
  rebuild: `docker compose -f docker-compose.base44.yml build`.
- The browser only needs port 3000. The Next.js app calls its own `/api/[...path]`
  proxy, which forwards to `BACKEND_INTERNAL_URL=http://backend:8000`; the API is
  not published on a host port. Use `http://localhost:3000/api/<route>` to test API
  routes from the sandbox.
- Backend health endpoint: `GET /health` on port 8000 inside the network.

## Non-obvious behaviour

- There are no migrations to run. `app/db/bootstrap.py` creates the `grokbot`
  schema and all tables on API startup under an advisory lock; `alembic/versions`
  contains no revisions.
- Redis is optional (`REDIS_URL` empty disables the cache). PostgreSQL owns state.
- `MINIO_*` settings exist but are unused; attachments are stored in the database.
- `REQUIRE_USER_AUTH` is `false` locally, so the workspace and API are open and no
  login is needed. With it enabled, `AUTH_SESSION_SECRET` (32+ chars) must be set.
- `/var/run/docker.sock` is mounted into the backend because the app manages agent
  sandbox containers through the host daemon; without it, deleting an agent fails
  with 503. The `open-grokbot-sandbox:latest` image is NOT built here, so starting
  an agent's computer container will fail until it is built
  (`docker build -t open-grokbot-sandbox:latest ./sandbox`).
- Agent tasks need a model route: set `LLM_API_KEY` (or `OPENAI_API_KEY`) through
  app secrets. In-app model connection management additionally needs OmniRoute
  (`OMNIROUTE_URL`, `OMNIROUTE_CONTROL_KEY`).

## Verifying

- `curl -s localhost:3000/` returns the workspace page, and
  `curl -s localhost:3000/api/bots` returns `[]` on a fresh database.
- `docker compose -f docker-compose.base44.yml ps` should show postgres, redis,
  backend and web healthy.
