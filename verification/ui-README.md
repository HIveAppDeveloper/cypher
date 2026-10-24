# Grokbot workspace verification

The October 22 UI uses the current official Grok home and bot workspace as a visual reference while keeping Open GrokBot branding and its own assets. The redesign is local code; no pixel accuracy or feature parity is claimed.

Build and run the synthetic API fixture:

```sh
cd frontend
npm run build
node --test tests/quick-start.test.mjs tests/bot-creation.test.mjs tests/attachments.test.mjs tests/conversations.test.mjs
cd ..
node verification/ui-fixture.mjs
```

The fixture prints its loopback API port and serves the production frontend at `http://127.0.0.1:4317`. It inherits an allowlist of environment variables, uses the existing loopback-only Node guard, and invokes no model, database, worker, credential, OAuth grant, or external service. UI API state lives only in process memory. Use Ctrl-C to stop it. Do not expose it publicly.

Set its scenario by posting JSON to the printed API port at `/__ui/scenario`: `{"mode":"home"}`, `{"mode":"conversation","failNext":true}`, `{"mode":"loading"}`, or `{"mode":"sync-error"}`. `/__ui/state` reports only synthetic request counters and content. `ui-attachment.txt` is disposable synthetic text for staging/removal checks. The fixture simulates API behavior; it is not evidence of backend authorization or provider execution.

The connected Mac browser was used to inspect actual 1440×1000 and 390×844 screenshots and DOM states. Checks covered empty and populated conversations, delayed loading, a failed send with retained draft and stable retry ID, repeated send/create clicks, visible collapsed-instruction validation, steering, Stop, attachment staging/removal, keyboard search/Enter/Escape, draft restoration after navigation, and readable connector/appearance dialogs. A single correction batch resolved mobile toolbar clipping and moved creation validation into the persistent action footer. The frontend build and 20 focused tests passed. Separate creation and authentication harnesses provide real route/auth/request-shape evidence.

Local screenshot/report artifacts live in the task workspace's `verification/grokbot-ui/` directory. `results.json` records dimensions, assertions and limits. The official reference is cropped to the empty main surface. A separate production observation screenshot contains private account/history information, is mode 0600, and must not be committed or published.
