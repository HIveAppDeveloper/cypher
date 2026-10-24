# Continuous cloud operation

The web app and agent worker are separate Vercel services. Closing the browser
does not stop queued tasks, goals, webhook delivery, or catalog connection jobs.
Two daemon instances run in iad1. A dedicated PostgreSQL session advisory lock
allows one leader; the second instance waits as a standby. Vercel restarts exited
daemon instances, and the worker supervisor reconnects after database/startup
failures with a bounded 2–30 second backoff.

## Crash recovery

Task attempts and execution steps live in PostgreSQL. Model replies and completed
tool results are saved before continuing. A replacement worker resumes the same
task and reuses saved steps. Recovery does not spend another scheduled goal run.
Messages use stable per-task event IDs to avoid duplicate replies after replay.

A model call times out after five minutes. Retryable execution failures back off
and stop after four task attempts. A running external write whose outcome cannot
be proven remains interrupted for review. Shell commands, browser actions,
messages, media generation and unknown MCP writes are never blindly repeated.
Legacy tasks with no checkpoints also require review. User cancellation remains
cancelled. Finite goal budgets and intervals remain in effect.

`GET /api/runtime` reports the active worker boot ID, start time, heartbeat age,
deployment identity and whether the worker matches the API release. A healthy
web deployment alone does not establish that the worker is ready.

## Plugin connections

`POST /api/plugins/catalog/sync` creates an authenticated, tenant-owned durable
job. The leader checks six catalog endpoints at a time without blocking goals.
Progress and connections survive closing the app or replacing the worker.
Existing paused connections and per-tool switches are preserved. Successful
MCP initialization and tool listing are labelled discovery, not execution tests.
Read-only smoke operations remain available through each connection’s Test tools.

The job connects public servers and explicitly mapped server credentials. All
other entries report account sign-in, API-key, setup or service-availability
requirements. OAuth grants from Codex, ChatGPT or another app are not portable
to this application. Vercel MCP requires an approved client callback; its rejection
is a provider approval requirement, not a successful connection.

To reuse a compatible key already available to this Vercel project, an operator
can set `GROKBOT_PLUGIN_CREDENTIALS` to an explicit mapping:

```json
{"https://official-provider.example/mcp":{"env":"PROVIDER_API_KEY","header":"x-api-key"}}
```

The mapping must use the provider’s verified official endpoint and documented
authentication header. Names from registry listings never select credentials.
These installation credentials are restricted to the legacy owner workspace;
other users supply their own grants. Stored keys and OAuth tokens are encrypted.
Never map database passwords, webhook secrets or another service’s tokens.

MCP execution validates tool arguments, preserves structured results and bounded
image/audio attachments, retries transient read-only transport errors, and does
not retry writes. Tool permissions and tenant boundaries apply on every call.

## Verification

The disposable-PostgreSQL integration test launches two real worker processes,
kills the leader with SIGKILL after a write checkpoint, and verifies standby
completion: two task attempts, one recovery, one goal run, one write and one final
reply. Run it with `GROKBOT_TEST_POSTGRES_URL` pointing only to a disposable DB:

```sh
PYTHONPATH=backend python -m pytest backend/tests/test_postgres_recovery.py -q -s
```

Vercel references: [daemon management](https://vercel.com/docs/daemons/managing-daemons)
and [MCP client requirements](https://vercel.com/docs/ai-tooling/vercel-mcp).
