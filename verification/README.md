# Grokbot → Atlas → Hive wire verification

This suite runs the actual Hive rank adapter and consent checks, Atlas signed search route and engine client, Grokbot Next proxy, and Grokbot FastAPI app/middleware/engine endpoint over ephemeral `127.0.0.1` HTTP ports. It substitutes only the model stream with synthetic responses. A small Node server hosts the real Request/Response handlers without starting Next. Hive's canonical Atlas URL is redirected to that loopback server without altering the signed bytes.

Use sibling checkouts containing the integration changes:

```
workspace/
  open-grokbot/
  atlas/
  hive/
```

Install each repository's dependencies. Use Node 24+ (the resolver uses `node:module.registerHooks`) and Python 3.12+ with Grokbot's backend dependencies. The test resolver uses the TypeScript package already installed in Atlas. From the workspace root:

```sh
WIRE_TEST_WORKSPACE="$PWD" \
WIRE_TEST_PYTHON="/path/to/backend/.venv/bin/python" \
node --import ./open-grokbot/verification/register-hooks.mjs \
  ./open-grokbot/verification/wire-contract.mjs
```

`WIRE_TEST_PYTHON` defaults to `python3`. The harness also works from `workspace/verification/` with the same environment. macOS sandbox execution must permit local loopback listening; no external network permission is required by the suite.

The harness writes `<workspace>/verification/results.json` and prints each case. It tests Unicode and tool-intent streaming, raw-body HMAC tampering/expiry/replay, JSON completion, principal isolation, cancellation and provider iterator cleanup, redacted errors, separate consent requirements and revocation, source-only ranking, and unknown-source rejection. A provider deliberately stays open during cancellation checks so cleanup is observable.

All signing values and users in the harness are fixed synthetic fixtures. No production environment files are copied. The harness removes database/provider/Vercel credentials from its environment before importing the applications, and blocks non-loopback `fetch` in Node plus socket/DNS egress in the Python fixture. The backend app lifespan is disabled so no worker, database initialization or scheduled job starts.

This is a contract and transport test. It does not verify a hosted deployment, actual OAuth/login, authoritative production database behavior, distributed replay protection, real model accuracy/latency, mobile focus, or competitor superiority. It starts at Hive's adapter with a synthetic verified-user auth object; the discovery HTTP handler's role/project/visibility checks are tested separately in Hive. It does not activate any production consent or sharing configuration.
