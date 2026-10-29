# Meta Muse connection candidate — 2026-10-28

Source candidate refreshed on 2026-10-29 against canonical main `619dc45946c367ba27ee3447bba2c08fdb8c7d31`. Original candidate `b2eb97139fbd647f9ea07f2f8124e26b84b5533f` is preserved; its exact 14-path patch cherry-picked without conflicts. This document is not a live acceptance receipt.

## Customer flow

The installation owner opens Settings → Model access → Meta Muse → Connect Muse, enters a Meta **Model API** token in the masked field, and chooses Verify and save token. A durable worker sends one short verification request (up to 256 generated tokens, minimal reasoning) to Meta. A successful response from exactly `muse-spark-1.3` enables that token; submitting or opening setup does not mark it verified. The token is encrypted during the queued check as well as after verification, and is never returned to the browser. A previously verified token remains active during replacement and is restored if replacement fails. Other customers cannot manage/read the shared credential.

Choose **Meta Muse → Muse Spark 1.3** in the conversation's manual model settings. Existing automatic profiles, specialist defaults, grants, other conversations, public Llama diagnostics and database contents are unchanged. This is a shared installation connection, following the app's existing owner-only model credential policy; it is not a separate per-customer subscription vault.

Muse requests use Meta's official endpoint, not the lower OmniRoute adapter, ambient SDK keys, Meta social grants, or a browser login. Text and function tools are supported by this first adapter. Visible conversation history and original function-call IDs/results are replayed. Unsupported image/audio/video/PDF parts fail before inference and are kept. Private reasoning is not preserved between turns on Chat Completions. No Responses API, images, search grounding or file capability is claimed. Existing declared fallback policy is unchanged. Missing/unverified Muse credentials are a hard stop before fallback; provider errors follow existing retry/fallback rules.

Usage tokens from the provider response go through the existing allowance/accounting path. Streaming records reported usage when received and closes its request on cancellation. The adapter does not invent missing streaming usage or prices. The UI explains that Meta credits apply and that cost estimates can be unavailable; a zero estimate is not proof of free use. No latency or savings claim is made.

## Gemini subscription support

Personal Gemini subscription pass-through is **not implemented or approved for the hosted, shared Cypher service**. This statement is specific to hosted Cypher, rather than every third-party client. No OAuth client/scopes, cookie/token imports, CLI wrappers or API-key substitution were added to fulfill that request. Existing independent API and route diagnostics remain available. Enterprise/Cloud use needs separate supported authentication and billing.

Google’s [official October 29 clarification](https://discuss.ai.google.dev/t/supported-gemini-subscription-access-for-a-third-party-vs-code-extension/189889/4) supports personal Free, Pro and Ultra accounts for single-user interactive development through custom ACP clients that launch Google’s **unmodified official `antigravity-acp` binary**, using its built-in `oauth-personal` flow. Authentication and local credential storage stay with the official agent, as described in [Google’s authentication documentation](https://antigravity.google/docs/install/#agent-configuration-authtype). This qualifies the earlier broad third-party-access answer. It does not establish approval for a hosted multi-user consumer-subscription proxy or extracting credentials into Cypher; that distinction is our application of the stated single-user scope. No ACP adapter is included in this Muse release, and Plus is not expressly named in the new clarification.

## Primary sources checked 2026-10-28; Google clarification rechecked 2026-10-29

- [Meta Chat Completions](https://dev.meta.ai/docs/protocols/chat-completions): official `https://api.meta.ai/v1/chat/completions`, bearer Model API token, `muse-spark-1.3`, roles, SSE, full visible history, function-tool results and supported controls. Short excerpt: “When an `assistant` message contains `tool_calls`, send one `tool` message per call with the matching `tool_call_id`”.
- [Meta Chat Completions API reference](https://dev.meta.ai/docs/api-reference/chat-completions): “Reasoning is not carried across turns on this endpoint”.
- [Meta quickstart](https://dev.meta.ai/docs/quickstart): Model API token is a distinct developer credential, not Facebook/Instagram authorization.
- [Google official thread, October 19 answer and October 29 clarification](https://discuss.ai.google.dev/t/supported-gemini-subscription-access-for-a-third-party-vs-code-extension/189889/4): the new official answer permits the unmodified official ACP agent for “your own single-user interactive development”. Do not cite the October 19 blanket answer without this qualification. This is not a hosted Cypher approval; API/Vertex entitlements remain separate.
- [Google Antigravity FAQ](https://antigravity.google/docs/faq), [ACP authentication](https://antigravity.google/docs/install/#agent-configuration-authtype), and [official ACP release notes](https://antigravity.google/docs/changelog/): distinguish the official personal ACP agent/sign-in from unsupported third-party credential use, wrapped headless CLI agents, and separate programmatic SDK authentication. The FAQ’s generic restrictions alone do not override the later explicit ACP clarification.

## Validation and release gate

Offline provider contract tests use synthetic tokens and `httpx.MockTransport`; database tests use disposable SQLite. They cover owner isolation, encryption, worker/local dispatch, successful and rejected credentials, queued replacement continuity, strict model identity, visible tool-loop replay, wrong/empty responses, endpoint pinning, redirect/error redaction, unsupported input, usage, cancellation and truncated SSE. UI tests cover masked token entry, clearing, queued state and truthful Gemini guidance. React review and the scoped Impeccable detector were applied; detector output was `[]`. No browser-based visual acceptance or live Meta token/model request has been performed in this source-only lane.

The canonical release owner must review this separate candidate, build/release API and worker from the same exact revision and verify both existing app aliases against that revision/shared PostgreSQL. Then use a legitimate owner token entered securely in the deployed app for a bounded real verification and one accepted tool-enabled conversation. Do not replay paid tasks or expose the token in handoff evidence. This candidate must not be represented as deployed, connected, faster, cheaper or fully provider-tested before those receipts exist.

### Candidate checks

- Backend: `python -m pytest tests/test_model_connections.py tests/test_muse.py tests/test_task_models.py tests/test_model_preflight.py -q --disable-warnings` → **48 passed** with a disposable SQLite URL. Includes the actual queue → encrypted row → worker → two-turn gateway/function-result path against the offline HTTP provider fixture.
- Frontend: `node --test tests/model-connections.test.mjs tests/gateway-connections.test.mjs` → **24 passed**.
- Frontend production build: `npm run build` → **pass** (existing multiple-lockfile root warning retained).
- Scoped Impeccable detection: ModelConnections.tsx + ModelControls.tsx → `[]`; manual React review found no introduced effects, dependencies or accessibility control regression.
- Existing Impeccable product/design metadata has stale context/schema/sidecar/build-path findings. Refresh is separate work; no design metadata repair was bundled into this functional change.

### October 29 release refresh

The exact original patch applied cleanly on `619dc45946c367ba27ee3447bba2c08fdb8c7d31`. A second source review traced the setup form → owner-guarded queue → worker → encrypted token read → native Meta adapter → task response/usage path. No production/provider calls were made by this source lane.

Current-base validation: **55 passed** in the model/connection/preflight/worker-scheduling suite; **428 passed** in the full frontend suite after the setup regression fix; production build passed including compile, type checks and all 19 static pages. The complete current-base backend suite passed **915 tests, 9 gated skips**. The original preserved `b2eb971` separately passed **905 backend tests, 9 gated skips** and **420 frontend tests** on its older base; those are not claimed as the current integrated release's full-suite results.

Review finding fixed after the release owner allocated the two additional WorkspaceSetup/test paths: direct-transport setup had excluded Muse in its Gemini/xAI filter, although the canonical OmniRoute transport displayed it. The new boundary regression first failed with actual `gemini,xai` versus expected `gemini,xai,muse`; the one-line filter repair then passed direct/gateway and nonowner cases. Final source scope is 16 paths, with no other broad settings changes. The scoped three-component detector returned `[]`; manual React review found no new hooks, effects, requests or dependencies from the one-line filter repair. This refresh remains a candidate, not proof of a working live token.

The release owner was notified of fresh human authorization to review, deploy and actually test Muse on October 29. Further deployment was temporarily queued behind a separately reported live-app performance/connection UX issue. This does not cancel the Muse request or establish live provider success. Secure owner token presence, stage/final same-release gates, real model verification and a bounded tool conversation remain required.

### Independent review and documentation correction

The release owner reported independent exact `e55fc88608fa435aa8de37a931e5b7bcd8b74cff` source audit CLEAR and 39 independently passing offline tests on October 29. The reviewer requested the separately committed Google ACP clarification above. This correction changes this document only; Muse implementation, scopes, credentials, runtime defaults and deployment state are unchanged. The review is not live Meta acceptance.
