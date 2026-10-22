# Historical image-chat repair notes — 2026-10-21

This records an earlier Vercel AI Gateway implementation. Current model inference uses OmniRoute or a direct provider API; these route and OIDC assumptions are superseded.

## Target and isolation

- Live app: https://open-grokbot-hiveapp.vercel.app/
- Source: https://github.com/HIveAppDeveloper/open-grokbot, `main` at `a9e7e19971be672cffbf80a69286156ae5cf3fa7`.
- Repair branch: `fix/image-chat-validation`, isolated clone in this task workspace. The upstream Mac clone at `/Users/boaznovik/open-grokbot` is a different repository (`ishandutta2007/open-grokbot`) and was not modified.
- Vercel: team `hiveapp`, project `open-grokbot` (`prj_9ogAU0O7roLSchWUmzGwsjIinyFM`), Python container backend and persistent `agent-worker` daemon, Next.js frontend.
- Read-only recheck at 2026-10-21 01:55 UTC: production alias now resolves to READY deployment `dpl_6DZumbpvAAq6bEG7FnvUx7iKjcnD`, immutable URL https://open-grokbot-fka98i5uv-hiveapp.vercel.app/, still at base `a9e7e19971be672cffbf80a69286156ae5cf3fa7`. This is the pre-existing newer release, not this repair.
- The earlier scratch task's `ProviderPanel.tsx` and separate coordinator/agent backup routes are absent from this `main`. This repair does not modify that other scratch environment; reconcile its unpublished changes before combining the work.
- No push, PR, production deployment, credential creation, permission change or paid inference was performed. Remote `main` still matched the base when checked after implementation.

## Evidence and diagnosis

The active deployment when investigation began was `dpl_2gaQaN7rDnC2vWCrmXyGYtXktHzH`, built from `cccc751c253bc785e3913ab7051b14caefc51170`. Vercel daemon logs at 2026-10-21 01:05:12 and 01:09:52 UTC recorded LiteLLM `AuthenticationError` with Gateway authentication rejection for Coordinator. These log records were labelled **info/daemon**, so an error-level-only search missed them. Two newer production builds from `a9e7e19` were already in progress before this work; this repair did not initiate them.

Project variable metadata showed no explicit `AI_GATEWAY_API_KEY`; the code used Vercel OIDC. Source inspection of the installed `vercel-oidc` SDK showed that the old `get_vercel_oidc_token_sync` alias returns ambient environment tokens without checking expiry. A regression test reproduces the old accessor returning an expired startup token, then verifies the replacement `get_vercel_oidc_token` selects the unexpired rotating-file token and follows the next rotation. This is a verified code defect and a likely explanation of the long-running daemon's authentication failures. The live daemon's token contents were not inspected, and restored production authentication is not yet proven.

The public Gateway catalog was retrieved without credentials or inference. On this date both `openai/gpt-6.1-sol` and `openai/gpt-6-luna` advertised text/image/PDF input, text output and tools. They did not advertise audio input. The screenshot's Model ID field is part of the uploaded picture; it does not prove the chat bot had an empty model ID.

The Library reference `libfile_c3ef351248a48191b234b3d67c2e257f` was materialized onto this Mac, verified as a readable 131011-byte, 1442×724 PNG, and visually inspected before UI changes.

## Changes

- Use the expiry-aware SDK accessor and pin the tested OIDC SDK version. Keep explicit-key precedence and reject missing provider authentication before inference.
- Validate model IDs, availability, file modalities and tool support. Optional compatible backup routing is bounded to one attempt; auth, billing and invalid inputs never fan out. File bytes remain intact through every route.
- Persist attachments in the same queue transaction, reject reuse of a message UUID with different files, and reject media-generation requests that would ignore attached inputs.
- Report specific, sanitized authentication, model, capability, quota and outage errors with a private-log reference. Failed jobs remain failed.
- Bound preview width and height, preserve aspect ratio, add an accessible enlarged viewer and image-load error state. Bound file reads and handle aborts. Restore browser settings after hydration to avoid mismatched initial markup.
- Align `.env.example` with the existing chat model policy.
- Add per-request `allow_tools=false` for bounded read-only probes. It omits tool definitions and refuses any unsolicited tool call before execution; existing request defaults are preserved.

## Verification

| Boundary | Evidence |
| --- | --- |
| Backend regression suite | 61 tests passed. Includes real FastAPI/SQLite/worker → LiteLLM Responses adapter → mocked provider HTTP → persisted result. Text, image, missing/invalid model/auth, image-preserving fallback, unsupported backup, terminal auth/billing/400, failed-job behavior and disabled-tool enforcement exercised. |
| File reader | Four Node tests passed: byte preservation, abort, stalled read timeout, empty/failed read recovery. |
| Frontend | Next.js production build, lint/type phase and `git diff --check` passed. No console errors appeared after the repaired page reload. |
| Browser text flow | Sent from the actual local composer through frontend proxy, backend, database, worker and real adapter. The response visibly identified itself as a fake transport result. |
| Image persistence and rendering | Original reference submitted through the actual local API; worker sent one image through the real adapter to the mock transport. Persisted authenticated attachment loaded after browser reload. |
| Browser file selection | Resolved in a fresh local conversation after confirming no pending attachment or job. The supported chooser accepted `/tmp/grokbot-local-picker-test.png`, a byte-identical copy of the reference. Composer showed its file chip, sent successfully, worker completed, and the saved authenticated attachment loaded after reload. GET returned 131011 bytes with SHA-256 `601e4f9e1c0a000838c235818b2c25c92e192cc5d75d9e8800786cb11de1fa5f`, matching the original. No permission change or paid inference occurred. |
| Wide layout | 1440×900: preview 279.98×140.58 px, loaded successfully, no document horizontal overflow. |
| Narrow layout | 390×844: preview 219.98×110.45 px, loaded successfully, no document horizontal overflow. Enlarged dialog 366×247.71 px; Escape closed it and restored focus to Open image. |
| Error UI | Actual local composer request forced a mocked 401. Visible result explained authentication failure, retained the saved files/message and displayed reference `b6d1a0c700d9`; no success response was fabricated. |

Local browser screenshots are in the task workspace's `verification/` directory: `wide.jpg`, `narrow.jpg`, `image-viewer.jpg`, `auth-error.jpg`, `file-picker-success.jpg`. The test harness and local test DB are outside the source repository and contain no real model credentials.

## Remaining limits

The first workspace-path chooser transfer stalled, and native picker inspection was interrupted. A later fresh chooser test with the identical PNG in `/tmp` passed the complete local browser upload round trip; the earlier browser automation/path issue was not attributed to production code. No browser permissions were changed. The local image round trip used fake inference HTTP, so it does not establish that a real vision model read the screenshot's contents.

Release and a genuine text/image inference check remain pending separate approval. After an approved release, verify the worker reads a current rotating OIDC token, run one text and one image request, inspect actual returned content and worker logs, and repeat after the startup token expires. If the platform does not provide a rotating token file, configuration work is still required; do not silently mint a key or change permissions.

Existing warnings remain: backend datetime deprecations and dependency warnings; npm reported pre-existing dependency audit findings during installation. The design detector only flagged the incumbent Inter typeface, which the established design explicitly preserves. Existing product/design context predates the current skill schema; `init` and `document` can refresh those records separately.
