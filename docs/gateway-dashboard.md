# Cypher gateway dashboard — internal provider catalog

This describes the local `/gateway` source candidate on October 26, 2026. The default **Connections** view is a searchable provider catalog with focused setup details inside Cypher. Hosting separates adding a computer to the existing workspace from running a new installation of the whole app. This is source-only work; it establishes no deployment, authorized provider account, email delivery, or successful full Linux startup.

## Design authority and scope

[`PRODUCT.md`](../PRODUCT.md), [`DESIGN.md`](../DESIGN.md), and [`.impeccable/design.json`](../.impeccable/design.json) remain the incumbent authorities. This ordinary extension preserves those files. Its surface direction is in [`.impeccable/surfaces/gateway-connections.md`](../.impeccable/surfaces/gateway-connections.md).

`connections.css`, imported after `gateway.css`, replaces the earlier candidate's green navigation/actions with warm neutral surfaces, white cards, graphite actions, and the existing platform font stack. Green is a semantic connected-state signal. The route retains the existing Cypher asset and explicitly uses a light color scheme; a gateway-specific dark palette is not implemented.

Provider/hosting marks are original SVG bytes from LobeHub's MIT-licensed Lobe Icons, pinned at `49a2130`, with README and LICENSE in `frontend/public/provider-logos/`. They identify products without implying endorsement, grants, or model access. Some retain provider color, whereas incumbent connection guidance describes grayscale imagery. That scoped distinction is documented without changing the global system.

### Observed composition and values

Connections opens with title, search, All providers / Subscriptions / API providers / Connected filters, then a three-column grid. At 1150px and below it becomes two columns; at 650px and below it becomes one. The recorded 900px view has two columns and 390px has one. Detail replaces the catalog inline with a return action and focused heading; it does not open a large setup dialog.

The shell has a compact sidebar, sticky white topbar, and separately scrolling content. Main content is capped at 1250px with desktop padding of 36px 40px, reduced at narrower breakpoints. Existing mobile navigation retains inert background/closed-navigation handling, Tab trapping, Escape dismissal, and focus restoration.

| Local role | Observed source value | Use |
| --- | --- | --- |
| Ink / muted / separator | `#242423` / `#666660` / `#e5e5e0` | Neutral hierarchy and boundaries |
| Canvas / sidebar / card | `#fafaf8` / `#f1f1ee` / `#fff` | Opaque flat surfaces |
| Primary action | `#292927`, white text | Supported setup actions |
| Connected status | `#eaf2ec` fill, `#346344` text | Explicit server-reported account connection |
| Page / card / description type | 30px / 17px / 13px | Page title becomes 28px on mobile |
| Card radius / padding | 12px / 23px | Card padding becomes 21px at narrower widths |
| Keyboard focus | 2px neutral outline, 4px offset | Buttons, links, inputs, summaries |

Inputs have explicit placeholder contrast and password masking where appropriate. Main mobile actions have at least 44px targets; filters use a scrollable row with 42px targets. Detail reveal runs only when OS reduced motion is inactive; the inherited shell also suppresses animation/transitions for reduced motion. This is not a comprehensive assistive-technology audit.

## Route, authentication, and owner boundary

`frontend/src/app/gateway/page.tsx` is force-dynamic and reads the existing signed `grokbot_session` cookie. With `REQUIRE_USER_AUTH=true`, missing/invalid sessions redirect to `/login?returnTo=%2Fgateway`. There is no new sign-in system. Account changes/unmounts invalidate and abort old reads; late responses cannot replace a newer account's view. Requests use the existing same-origin authenticated proxy.

Shared model records/actions require runtime `can_manage_model_connections === true`. Backend owner authorization remains authoritative; hidden controls are not authorization. Worker readiness gates API-key verification and model checks. Preview disables those writes.

## Provider catalog and supported actions

`GatewayConnections` and `lib/gateway-connections.mjs` provide six discovery entries: ChatGPT, Claude, Gemini, Grok, OpenRouter, and Meta. Search matches provider/company names. Outside preview, eligible providers qualify for Connected through `account_connected === true`, or a ready `provider_account` check with `account`/`api_key` access. OpenAI and Meta are always excluded, including stale payloads claiming account kind, provider-account target, or `account_connected: true`. Explicit `account_connected: false`, current-route target/scope, and public access also exclude a record. A public fallback or generic ready route alone does not qualify. Provider-owned account/key destinations are distinct from authorization. Opening a provider website connects nothing.

The original one-click Claude/Codex **Connect → provider sign-in → allow → return** subscription objective remains **incomplete**. Claude is now an API-provider entry: use a Claude Console API key with separate API billing. Third-party Claude subscription sign-in in this gateway is unsupported under Anthropic's [authentication and credential-use guidance](https://code.claude.com/docs/en/legal-and-compliance); its separate allowance for end users signing into an unmodified Claude Code binary does not establish a gateway subscription adapter.

Cypher's hosted Sign in with ChatGPT application was submitted once and is pending approval. There is no approved hosted client or working hosted OAuth flow. Native CLI client registrations are not reused. ChatGPT says **ChatGPT approval required**; Claude says **Claude API key**. Neither is a prepared subscription adapter merely awaiting deployment. Optional OpenRouter consent source remains separate in `cypher-provider-consent`; frozen strict lower-adapter source `5e450ec` is separately reviewed and not deployed. These sources do not establish integrated or live provider consent here.

- **Browser sign-in:** requires an owner-authorized runtime record with `can_connect === true` and `connect_url` exactly `/api/model-connections/{known-provider-id}/begin`. The browser posts only to that same-origin path and accepts the returned authorization URL only on the provider's explicit HTTPS host allowlist, without credentials/nondefault port. It never invents OAuth from a name or redirects Connect to OmniRoute.
- **API key:** supported records with `can_add_api_key === true` use existing `/api/runtime/model-connections/{provider}/api-key`, with owner permission, ready worker, and no preview. The password field clears on submission. The existing server encrypts and checks the key before replacing a working connection. API billing is separate from chat subscriptions.
- **Model check:** existing `/api/runtime/model-connections/{provider}/verify` queues an explicit check that may consume quota. Both `GatewayConnections` and `ModelConnections` always request and require acknowledgement of `current_route` for OpenAI and Meta. Claude, Gemini, and Grok API-account checks remain `provider_account`. A queued check is not reported finished until saved state has passed through checking or has a changed `checked_at`. Requests have a 35-second timeout with an unconfirmed-status recovery message. Unsupported verification is labeled unavailable. Passive refresh never verifies access.
- **Setup:** unsupported entries show inline requirements, provider-owned key links where applicable, and honest limits. Meta consumer login is explicitly distinguished from Llama-compatible API access.

**Account connected**, **API key verified**, and **Account route verified** require the same eligible-access rules as Connected. OpenAI therefore cannot acquire an account label from stale account-shaped data. Its action is **Test gateway route**, its successful readiness says **Route available**, and model details say **Gateway model route**. These test the configured gateway route, never a ChatGPT account or subscription. Public access says **Public route available**. Claude API-key verification does not claim a connected Pro/Max subscription. Checking/failure states remain explicit. Preview always says **Preview**, including synthetic ready records. A route check, catalog entry, or logo is not itself account authorization.

The backend owner is preparing a separate OpenAI route-only guard; that newer guard is not composed into this candidate yet. The frontend correction must not be described as completed backend enforcement or a native OpenAI sign-in flow.

Explicit Claude, Gemini and Grok API-account checks require the paired worker's provider-specific version-1 capability before queue mutation, then exact provider/slot/model/scope and Boolean model-access receipts. Strict worker checks use the selected fixed API slot and official destination without gateway fallback; failed or concurrent replacement checks preserve the newer credential. Direct-only Gemini/Grok self-host verification also requires the documented exact `modelVersion`/`model`. Offline integration tests cover the durable saved key reaching the real `LLMGateway` direct path, with exact model/key/tools, no catalog or fallback call, no network, and zero retries. The separate lower source `5e450ec` and owner app `ac176bf` passed source pairing review; this is not deployment or real provider proof. See [the direct account contract](direct-api-account-contract.md).

## Hosting: computer pairing or the whole app

Hosting offers two modes, each with local, AWS, and Azure choices.

### Connect a computer

This adds approved tools through existing `/api/local-device/` endpoints while the app/history remain in the cloud. AWS/Azure options point to machines the user controls and provider guides. The UI reads devices, explicitly creates codes, cancels pairing, and confirms saved-device disconnection.

Device ID, code format, and future expiry are checked. Codes remain in component memory and a read-only password field, clear on expiry/pairing/account change, and are neither put in companion commands nor persisted in browser storage. The companion command limits access to the Cypher folder and leaves shell off. Each action retains local companion approval; pairing is not blanket shell permission. Preview does not create, revoke, or enumerate real devices.

`GatewayHosting` obtains commands from `companionSetup(CANONICAL_APP_ORIGIN)`, using the validated build-time app origin rather than request headers. The helper requires an exact HTTPS origin and generates the companion download from that same app plus an explicit `--server` argument. Unix and PowerShell commands each escape single-quoted values for their own shell. The canonical cloud origin remains the default; an explicit valid self-hosted build origin selects that installation. This frontend correction does not change the companion CLI, backend, environment values, or their defaults.

An HTTP loopback app can still run locally, but computer pairing requires HTTPS. In that configuration the UI shows an HTTPS requirement notice, hides the companion command/download, and disables Create pairing code. The submit handler independently rejects the action before any POST, including forced form submission. It does not silently pair the local app with the canonical cloud workspace.

### Host the whole app

`GatewayDeployment` offers `/setup/cypher_host.py` as a download and commands for the user's local hardware or existing AWS EC2/Azure Linux machine. It does **not** provision cloud machines, create accounts, configure DNS, or guarantee provider/email access. Users supply Docker Compose, Git, Python 3.10+, their own dedicated direct PostgreSQL URL, and their own gateway/key. Public cloud setup additionally requires a domain, owner email, and Resend key with verified sender.

The wizard creates a **new directory**, unique Compose project, and unique application schema. Directory permissions are `0700`; `.env` is exclusively created at `0600`. Existing destinations are refused. No existing cloud environment, database data, accounts, or provider grants are imported/migrated. The user reviews settings before explicitly starting containers.

Compose runs frontend, private API, and worker; the cloud profile adds Caddy HTTPS. Local frontend binds to loopback. API and supplied database are not exposed as public host ports. Local mode is loopback-only with local auth disabled; public cloud requires email sign-in. No Docker socket is mounted; agent-managed Docker computers need a separate sandbox.

The wizard clones canonical `HIveAppDeveloper/cypher` branch `main` and stops before startup if it lacks self-hosted-origin support; it does not patch older source to bypass that check. `NEXT_PUBLIC_SELF_HOSTED_ORIGIN` is an explicit compile-time operator setting. Missing/invalid values retain `https://cypher-agent.vercel.app`. The parser accepts HTTPS origins or HTTP loopback and rejects credentials, non-root paths, queries, fragments, and surrounding whitespace. Request headers never choose callback/sign-in origin. Request-hostname inspection for preview detection does not select that origin.

## Read data and advanced controls

Shared reads refresh on mount, every 30 seconds, and through Refresh/Retry, independently with `cache: 'no-store'`:

| Existing endpoint | Evidence | Limit |
| --- | --- | --- |
| `GET /api/runtime` | Transport/configuration, database/worker readiness, heartbeat/release match, owner permission, saved provider states | Acceptance requires `connected: true`; configuration is not inference or consent. |
| `GET /api/workspace/usage` | Week-to-date tokens, estimated cost, allowance/reset, per-model/provider rows | Workspace estimates are not invoices; zero does not prove free access. |
| `GET /api/workspace/runs` | Up to 100 task IDs, statuses, creation/completion times | Activity labels `created_at` as **Created**, not Started. Task history is not provider request logs; presentation excludes prompts, titles, outputs, arbitrary fields. |

Failed reads clear stale resource data and offer retry. A 401 requests sign-in. Invalid/missing metrics say **Unavailable**; numeric zero stays zero. Missing times say **Not recorded**. Worker readiness/release match stay separate. **Read at** records a refresh attempt, not provider verification.

Routing, fallbacks, caching, budgets, logs, latency, and rate-limit settings are unavailable from these reads. All external OmniRoute dashboard/management links have been removed, including from advanced tabs. Controls are read-only/unavailable here; provider setup remains in Cypher. The existing exact-host HTTPS URL allowlist still bounds the approved public origin used for the illustrative `/v1` integration endpoint. Private runtime URLs, credentials, bindings, and bypass headers never enter the client. The example issues no key and proves no client connection. The public integration-documentation link is documentation, not a dashboard connection flow. No second inference/MCP service or native desktop binary is added.

## Preview and release limits

Unauthenticated loopback preview is separate from sign-in. When local forwarding/session configuration is absent, `/login` offers **Open gateway preview**, labels samples, and creates no session. Public/auth-required configurations never receive that fallback. Existing configured Google/email login remains, without claiming successful mail delivery or provider consent.

Canonical source is `HIveAppDeveloper/cypher`, integration branch `main`, Vercel project `cypher`, submission URL `https://cypher-agent.vercel.app`. Preserve shared production PostgreSQL data and environment values. Read `CYPHER_SHARED_RUNTIME.md` before runtime changes/release. Ready changes go to release-owner chat `01a16f1c-f827-7ab0-ae4a-6bccbbb7eed2` (**Polish and deploy VentureCruiter**); production aliases belong to that owner. Frontend, API, and worker must be verified against the exact same final release, including the worker heartbeat/release match and owner-authorized verification path, before release completion is claimed. A source merge or frontend build alone does not satisfy that gate.

## Bounded verification evidence

Documentation checked the final route, dashboard, connections/hosting/deployment/logo components, helpers/CSS, explicit origin opt-in, setup wizard, and logo attribution/license against incumbent guidance. Product/design authority files were preserved. Obsolete green-shell/reused-setup-dialog descriptions are replaced here; no global design drift was repaired.

Reported current implementation evidence: 21 focused tests, all 367 frontend tests, and the production build passed after the five-file OpenAI route-scope correction. The earlier companion-origin/HTTPS and Created-label changes remain. The backend is unchanged by this follow-up; its prior combined suite through `ac176bf` passed 771 tests with four normal PostgreSQL skips using disposable SQLite and empty provider settings. The newer owner-prepared OpenAI backend guard is not included in that result or this candidate. Frozen lower source `5e450ec` previously passed 50 local regressions and 34 strict account tests on Linux Node 22 with networking disabled; the provider owner independently ran 40 affected lower tests and cleared exact source pairing. Earlier four Python setup tests and actual Compose configuration resolution validated unique project/schema isolation.

Full lower-image packaging is now verified separately: the actual production `cloud/Dockerfile.browser`, pinned to the incumbent `vcr.vercel.com` base digest beginning `13e446`, built for Linux amd64. Nine copied-source hashes matched; a read-only, network-disabled container with an overridden Node entrypoint confirmed the three pure version-1 provider capabilities on Node 26.12.0/native 3.8.52. Evidence: [lower-production-image-verification.json](../../gateway-verification/lower-production-image-verification.json). The account worker was not started, no database was opened, and no provider request was made. Owned containers/images/context were removed without pruning shared caches or parent images. This proves packaging and offline capability loading, not native account startup, provider inference, live access, deployment, or release parity.

`.impeccable/review/` contains the earlier desktop/mobile/user-900px and focused Hosting/deployment/Azure/Claude fixture captures. The earlier independent **FIX** verdict resolved catalog availability wording. A bounded follow-up review returned **SHIP** for the five-file frontend correction only, with no material defect in the supplied desktop/mobile controlled fixtures. This does not approve live provider access or the whole cloud release. Earlier synthetic Next API/fixture checks submitted one dummy Claude key, confirmed the input cleared, and observed the queued check complete. No real provider call or persisted credential was used. The original subscription connection objective remains incomplete. No production environment/database/alias/cloud operations, real provider authorization, or email delivery were performed by this work.

The later self-hosted companion-origin, HTTP-loopback pairing guard, Created-label, and OpenAI route-scope changes were checked in source and documentation. New browser approval remains pending; no new visual capture or live pairing is claimed, and the earlier SHIP verdict does not approve these later edits.
