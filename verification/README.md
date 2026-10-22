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

## Actual browser agent-creation comparison

`creation-browser.py` opens temporary Chromium contexts against full Next production builds. It submits the actual `BotCreator` form through the application's signed-cookie check and `/api/bots` Next proxy to the real FastAPI route and a temporary SQLite database. It does not replace the UI, API response, or database query result.

From the workspace root, with Grokbot's backend dependencies, Playwright Chromium, and frontend dependencies already installed:

```sh
CREATION_WORKSPACE="$PWD" \
CREATION_BASELINE_REF=35ca34e \
CREATION_FIXED_REF=<commit-containing-the-creation-fix> \
/path/to/backend/.venv/bin/python open-grokbot/verification/creation-browser.py
```

Both application trees are pinned to `CREATION_FIXED_REF` (default `HEAD`). The baseline replaces only four frontend creation files and the two creation API/schema modules with `CREATION_BASELINE_REF`. This isolates the creation change while keeping the same actual cookie/proxy/auth code. The harness uses fresh local dependency copies because Next standalone tracing follows directory symlinks. macOS must allow Chromium's local Mach-port startup and loopback listening.

Seven cases run for each version: unmodified default preset, empty instructions collapsed inside Customize, an actually committed response deliberately lost before reaching the browser (named and unnamed retries), two same-tick native form submissions, four concurrent optional-name creations, and cookie/tenant isolation. The concurrent case holds four real SQLite name SELECT results at a fixture barrier before allowing the inserts; the data and route are real, with deterministic scheduling.

The captured comparison in [creation-browser-results.json](creation-browser-results.json) reproduced these local symptoms:

| Interaction | Before the fix | After the fix |
| --- | --- | --- |
| Default preset | Creates one Assistant | Creates one Assistant |
| Clear Instructions, collapse Customize, press Create | Native validation prevents submit; no POST or inline error | Submit reaches inline validation; no POST |
| Retry after a successful unnamed response is lost | Two agents | Same agent ID, one agent |
| Retry after a successful named response is lost | Misleading name-conflict 409 | Same agent ID, 200 |
| Two same-tick submits | Two POSTs | One POST |
| Four concurrent optional names | One created; three 409s | Four distinct names; four 200s |
| Unsigned cookie / forged tenant header | 401 / no cross-tenant rows | 401 / no cross-tenant rows |

The original production Create Agent failure remains unconfirmed. This establishes concrete local failures and fixes, not the cause of that earlier report. The first fixed-UI screenshot also exposed an error below the scroll viewport; persistent error visibility is a separate UI acceptance check. The browser suite tests signed synthetic sessions, not Google/email login. It neither activates models nor starts application workers/lifespan. Environment variables are allowlisted, Node and Python egress is limited to loopback, and Chromium uses a temporary profile plus default-deny proxy/DNS/request routing. No production credentials or user data enter the fixture.

The harness writes request-shaped JSON evidence, source hashes, screenshots, and build/server logs to `<workspace>/verification/`. The JSON contains synthetic prompts and request UUIDs, never session cookies or signing values. Both captured production builds include `/api/integrations/atlas/v1/chat`; the browser cases exercise the separate authenticated agent-creation proxy path.

## Synthetic login and session verification

`auth-browser.py` builds a fresh frontend copy and runs the actual login page, Next auth handlers/cookies/proxy, backend auth/ownership routes, and temporary SQLite. Only outbound email delivery and Google credential verification are substituted with explicit synthetic stubs. The Google SDK request is blocked, so the configured widget metadata and script-failure/email-fallback state are observable without contacting Google. This is **not** verification of a real Google or email-provider login.

```sh
CREATION_WORKSPACE="$PWD" \
/path/to/backend/.venv/bin/python open-grokbot/verification/auth-browser.py

# Fast checks that require neither Chromium nor a listening server:
cd open-grokbot/frontend
node --test tests/auth-routes.test.mjs tests/email-login.test.mjs
```

The captured [auth-browser-results.json](auth-browser-results.json) records 16 passing browser cases and a production build: Google absent/configured-but-blocked states; email unconfigured and delivery-failure recovery; pending-control disabling/double-submit coalescing; resend timing; cookie creation; one-use/expired magic links and hashed token storage; tenant isolation; Google CSRF rejection and third-party-account ownership conflict; a synthetic successful Google callback; and logout. A 390×844 touch-emulated case checks input focus, keyboard Tab to submit, 44px control targets, no horizontal overflow, and an on-screen recoverable email-unavailable error. Cookie flags are checked (`HttpOnly`, `Secure`, `SameSite=Lax`, seven-day `Max-Age`), and the resulting cookie is consumed by the real app/protected backend routes. Twelve additional client/Next-handler tests cover signed-session expiry/tampering, configuration errors, callback redirects, CSRF, and logout.

The actual browser run found a recoverable mismatch: the email UI allowed Resend after 30 seconds, but the backend deduplicates for 60 seconds. At 31 seconds the old UI made another request, displayed success, and produced no new synthetic delivery. The UI now waits through that same 60-second window and shows the remaining time; at 62 seconds the next request records a new synthetic delivery. No server limit or recipient policy was widened.

Both callbacks currently ignore `returnTo` and land at `/`; the tests establish that an external `returnTo` cannot redirect away, not that deep-link navigation is implemented. Session values, raw magic-link tokens, and synthetic credentials are not written to result artifacts. The harness allowlists environment variables, blocks Node/Python external network access, and runs temporary Chromium profiles with default-deny proxy/DNS/request rules. It never sends an email, grants OAuth access, activates a provider, starts workers, or reads production data. Screenshots/logs are written to `<workspace>/verification/`; captured viewports are desktop 1280×900 and mobile emulation 390×844. Safari and a real device/software keyboard remain unverified.
