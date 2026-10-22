# Grokbot usability follow-up

This branch repairs reproduced interface failures and simplifies agent creation. It is separate from the released PR4 and parallel plugin/provider work. No follow-up production deployment is approved or performed.

- Home task drafts survive agent navigation, are scoped to the signed-in account ID in tab storage, and clear only after acceptance without deleting a newer draft.
- Initial conversation failures expose Reconnect; repeated clicks coalesce, online events recover immediately, server Retry-After is respected, and drafts/history remain. Expired sessions offer Sign in; quota details remain visible.
- Creation starts with role, optional name and the selected-model summary. Model controls, instructions and tools remain under Customize. Invalid instructions open and receive focus. Request keys and provider defaults remain unchanged.
- Workspace search ignores composition Enter; Jump to latest honors the app motion preference as well as the OS preference.
- Mobile task controls have44px targets and12px labels, with the model on a full row. Startup shows actual pending-request feedback. The Google widget is constrained by CSS without changing its SDK or authentication configuration.

## Evidence

Reconciled against upstream `912eb6df8fa0967f0412318a0e5cc4d29788b481`, preserving the parallel plugin/provider commits without editing their files. 272backendtests and52frontendtests passed, including12actual effect/handler regressions. Production compilation, lint/types, six-page generation and route traces passed.12offline login layout cases cover320/390/768/1440px with the observed fixed-width SDK structure; they do not execute Google sign-in. [Local real-stack results](functional-results.json) contain13passed cases using actual Next cookie/proxy routes, FastAPI, temporarySQLite and the actual queue/journal/worker with controlled inference. [Mac browser observations](ux-results.json) record exact dimensions, counters and limits.

All screenshots here are synthetic fixtures, with no real account history. [Desktop](ux-screenshots/desktop-conversation-1440x1000.jpg), [mobile home](ux-screenshots/mobile-home-390x844.jpg), [creation before](ux-screenshots/mobile-create-before.jpg), [creation after](ux-screenshots/mobile-create-after.jpg), [instructions error](ux-screenshots/mobile-instructions-error.jpg), [send recovery](ux-screenshots/mobile-send-recovery.jpg), [reconnect](ux-screenshots/mobile-reconnect.jpg). The real-stack JPEGs show controlled worker output; Mac JPEGs show the UI fixture.

The observed live Google callback points from open-grokbot.vercel.app to the older open-grokbot-hiveapp.vercel.app deployment. [Read-only observation](live-signin-observation.json) records this release/configuration blocker. No login was submitted and no provider setting, callback allowlist, credential or alias was changed. Do not claim live auth/model correctness from these local tests.

Run Node tests from frontend with `node --test tests/*.test.mjs`, and `npm run build`. Run `python verification/login-layout.py` using the project environment and Chromium. Run `python verification/functional-browser.py` using the project environment; it creates isolated temporary fixtures and blocks external egress. The original creation/auth harnesses retain their own instructions. No paid calls are required.
