# Cypher loading UX — October 24, 2026

Built from canonical release revision `92eaeb0` on `codex/cypher-fast-loading-ux-20261024`. This is a frontend-only change. It does not create or configure a database, change aliases, or deploy another app.

## Changes

- Eight secondary panels load on demand. Markdown parsing loads only for an agent response; readable message text is shown while its chunk arrives. The composer and existing binary branding remain eager.
- Shared ghost placeholders cover the route, agents, team rooms, messages, recent work, services, the MCP directory, workspace library, goals and channels. Accessible status text is separate from hidden decorative shapes; animation honors OS and app preferences.
- Route errors offer retry/home recovery; panel chunk failures offer Close and Reload Cypher while keeping the underlying conversation. Native dialog focus and Escape remain available.
- Pending lists no longer display false empty states. Recent work reserves its height, reports failures and supports retry. Late startup room responses respect a user choosing New task.
- While the plugin panel is open, runtime health is checked on entry, every 30 seconds and on return/online. Disconnected state warns that saved connections and past tool tests may be stale; saved data is retained. Background/overlapping health checks are skipped and listeners/timers are cleaned up. Past verification wording is explicitly historical.

## Measurements and validation

Production builds: `/workspace` first-load JS **230 kB → 155 kB (~33% less)**. Browser observed initial script encoded bytes **228,689 → 154,411** on localhost. One local FCP sample was 468 ms before and 204 ms after, but cache/server warmup and host conditions differ: this is not a production speed guarantee or controlled benchmark. No production web-vitals claim is made.

`npm run build` passes. `node --test tests/*.test.mjs` passes **133 tests**, including five new regression checks for pending/empty semantics, startup navigation, recent-work retry and accessible placeholders. Existing attachment, auth, provider-consent, draft/recovery and conversation checks pass. Impeccable detector returns `[]`; `git diff --check` passes.

Browser fixtures use the actual production Next build and local `fixture.py` through the normal API proxy, without real accounts, model calls, external actions, or production database access. Desktop 1440×1000 and mobile 390×844 captures show loading → populated conversations, plugin loading, and saved-service retention during a simulated runtime outage. Browser check confirms New task remains selected after slow startup, mobile body width stays 390 px, closing the tools dialog restores the Connect tools trigger, a blocked Computer chunk shows recoverable error UI with the conversation retained, and OS reduced motion yields `animation-name: none` for skeletons. Mobile plugin dialog width is 374 px in a 390 px viewport.

Original Cypher intro and lens assets were preserved. The existing app data/backend remain authoritative. Integrate the commit into the one canonical release and rebuild there, preserving concurrent voice, sidebar and plugin-isolation fixes.

## Reproduce local UI cases

Start `python3 verification/fast-loading-ux/fixture.py`, then from frontend run `BACKEND_INTERNAL_URL=http://127.0.0.1:3219 npm run start -- -p 3218` after building. POST `/__state` on port 3219 with `delay`, `error`, and `lounge` fields. The fixture rejects mutation requests except its own local control endpoint.

Use the normal canonical backend and database for submission; the fixture is exclusively a local UI test service.

## Canonical integration after explicit deploy request

The user subsequently requested deployment. Ported onto canonical `5a5ae55` (central voice stage, progressive/cancel-safe playback, plugin isolation, role labels, promotion gate and 143 prior tests). Conflict resolution retained the canonical ChatPanel verbatim except its LoadingState import and replacement of the old loading text; all voice/session controls and grouping are preserved. Canonical plugin catalog/category layout is retained, with only placeholder and stale-status additions. Existing test fixtures keep canonical voice and hostname stubs while adding the new placeholders/lazy panel stubs.

Combined `node --test tests/*.test.mjs`: **148 passed**. Combined production `npm run build`: **passed**, `/workspace` first-load JS **155 kB**. The original 230 kB comparison and screenshots above describe the earlier base, not a fresh canonical-before benchmark. See canonical-build.log and canonical-tests.log. Backend, release gate, runtime configuration, aliases and database are unchanged by this patch. Deployment remains with the canonical release owner.
