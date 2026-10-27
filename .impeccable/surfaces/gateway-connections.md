# Gateway connections — surface brief

Source candidate: `/gateway`, October 26, 2026. Ordinary extension of the incumbent Cypher world. Authority remains `PRODUCT.md`, `DESIGN.md`, and `.impeccable/design.json`; implementation and limits are in `docs/gateway-dashboard.md`.

## THESIS

Find a recognizable provider and use its honest supported action within Cypher. The default Connections view should feel as direct and professional as an internal MCP catalog. Discovery, setup, account authorization, and model-route availability remain distinct.

## OWN-WORLD

Inherit Cypher's warm gray/white surfaces, graphite actions, platform typography, compact navigation, opaque panels, restrained borders, and explicit recovery states. Keep the existing Cypher identity; real provider/hosting SVGs come from MIT-licensed Lobe Icons pinned at `49a2130`. Provider color belongs to its identifying asset; chrome stays neutral and green is semantic status only. Logos never establish access.

The route is light-only. Some upstream provider marks retain color, unlike incumbent grayscale connection-image guidance. These scoped facts do not rewrite global tokens or create a second identity.

## STORY

Search/filter → focused inline detail → supported provider-owned allow or existing key action → server-confirmed status. Browser authorization requires an owner-authorized runtime's exact same-origin begin path. All external OmniRoute dashboard links are removed, including advanced tabs; native policy controls are unavailable from the API and the approved integration endpoint is illustrative only. Claude offers a Console API key, not subscription login. Its third-party subscription sign-in is unsupported under [Anthropic's credential-use guidance](https://code.claude.com/docs/en/legal-and-compliance), distinct from the unmodified Claude Code binary. Hosted Sign in with ChatGPT was submitted once and awaits approval; no approved client or working hosted OAuth exists, and native CLI registration is not reused. The original one-click subscription objective remains incomplete.

Hosting follows mode → platform → explicitly reviewed setup. Computer pairing adds approved tools to the existing workspace. Whole-app setup generates a separate installation on local hardware or an existing AWS/Azure machine with the user's own dedicated database/gateway. Neither provisions cloud machines nor imports production credentials/data. Preview disables account/device writes and never turns synthetic ready into connected.

Companion setup uses the validated build-time `CANONICAL_APP_ORIGIN`: HTTPS download from that app and an explicit `--server`, with shell-specific Unix/PowerShell quoting. Canonical cloud remains the default. HTTP loopback shows an HTTPS requirement, hides the command/download, and disables pairing creation; the submit handler also blocks POST for forced submission. The companion CLI/backend/environment/defaults are unchanged.

## FIRST VIEWPORT

Show Connections, brief explanation, search, category filters, and catalog immediately. Three columns on desktop, two at the recorded 900px viewport, one at 390px. Compact sidebar and sticky topbar support navigation. The signature is recognizable provider selection followed by focused inline detail with a return action, without a giant setup dialog. Hosting separates pairing from whole-app installation before platform selection.

## FORM

Scoped `connections.css` overrides the original shell: white cards with 12px corners, 17px provider titles, muted 13px description copy, and a 30px page title (28px mobile). Inherit the font; add no typeface. Search has explicit placeholder/focus treatment. Main mobile actions have 44px targets; filters remain reachable in a horizontal row. Preserve neutral focus outlines, password masking, empty/error states, and OS reduced-motion behavior.

Outside preview, eligible providers enter Connected through explicit `account_connected: true` or ready `provider_account` verification with `account`/`api_key` access. OpenAI and Meta are always excluded, even for stale account-shaped payloads; explicit `account_connected: false`, current-route target/scope, and public access also exclude a record. Account labels use those same eligibility rules. OpenAI and Meta always request/acknowledge `current_route` in both connection components. OpenAI says Test gateway route / Route available / Gateway model route and never claims ChatGPT account proof; Claude/Gemini/Grok API checks remain `provider_account`. Preview always says Preview. Claude API-key status never implies subscription sign-in. Queued checks require strict target acknowledgement and checking/new `checked_at` evidence before completion; requests time out with recovery copy. Pairing codes are masked, memory-only, and expiring. API-key writes require runtime support, owner permission, and worker readiness. Setup commands are reviewable instructions, not proof of working containers/email/models.

Activity labels the existing `created_at` value **Created**, preserving its actual meaning.

## Finish evidence and remaining work

Checked current connection/hosting/dashboard/helper sources and incumbent guidance, preserving global product/design files. Reported current checks: 21 focused tests, all 367 frontend tests, and production build passed after the five-file OpenAI route-scope change. Earlier companion-origin/HTTPS and Created-label corrections remain. Backend unchanged: prior combined source through `ac176bf` passed 771 tests/four normal PostgreSQL skips. A separate owner-prepared OpenAI backend guard is not composed here or covered by that run. Frozen lower `5e450ec` previously passed 50 local and 34 strict-account Linux Node 22 tests with networking disabled; owner independently ran 40 affected tests. Offline direct-route tests, four Python setup tests, and Compose project/schema-isolation evidence remain bounded source checks. Earlier fixture Claude-key submission was synthetic; no real provider call or persisted credential was used.

Lower full-image packaging is now verified with actual production `cloud/Dockerfile.browser` and the pinned incumbent base digest beginning `13e446` on Linux amd64. Nine copied-source hashes and three pure version-1 capabilities passed in read-only/network-none mode with Node entrypoint overridden, Node 26.12.0/native 3.8.52. Evidence: `gateway-verification/lower-production-image-verification.json`. This proves packaging/offline capability loading, not native account startup, database access, provider inference, live access, or deployment. Owned containers/images/context were removed without shared-cache/parent-image pruning.

The earlier independent **FIX** verdict resolved availability wording. A bounded follow-up **SHIP** verdict approves the five-file frontend correction only, with no material defect in the controlled desktop/mobile fixtures; it does not certify live provider access. Native subscription access remains unresolved and the original one-click objective incomplete, not merely awaiting deployment. Optional OpenRouter consent source in `cypher-provider-consent` remains separate. Strict lower-adapter `5e450ec` is paired with owner app `ac176bf` in source review, but not deployed. No real provider authentication, mail delivery, full native-image startup, or production release is claimed. Release completion requires frontend, API, and worker on the exact same final release with matching worker heartbeat/release and owner-authorized verification.

The later companion/HTTP-loopback guard, activity-label, and OpenAI route-scope changes have source/documentation review only. New browser approval remains pending; there is no new visual capture or live pairing claim, and the earlier SHIP verdict does not cover these later edits. No actual OpenAI app client/native flow exists here; the original one-click subscription objective remains incomplete.
