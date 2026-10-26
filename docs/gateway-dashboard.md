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

`GatewayConnections` and `lib/gateway-connections.mjs` provide six discovery entries: ChatGPT, Claude, Gemini, Grok, OpenRouter, and Meta. Search matches provider/company names; Connected requires real `account_connected === true` and excludes preview fixtures. Provider-owned account/key destinations are distinct from authorization. Opening a provider website connects nothing.

The original Claude/Codex **Connect → provider sign-in → allow → return** objective is **not complete**. This branch has no native subscription account sign-in adapter for those providers. Cards show **Account sign-in unavailable** and **View setup** unless a supported runtime action or API-key option is actually advertised. These are not working/prepared adapters or adapters merely awaiting deployment. Optional OpenRouter consent source exists separately in `cypher-provider-consent` (`acc7f4c`, lower `cb1c090`); it is not integrated here or deployed by this work.

- **Browser sign-in:** requires an owner-authorized runtime record with `can_connect === true` and `connect_url` exactly `/api/model-connections/{known-provider-id}/begin`. The browser posts only to that same-origin path and accepts the returned authorization URL only on the provider's explicit HTTPS host allowlist, without credentials/nondefault port. It never invents OAuth from a name or redirects Connect to OmniRoute.
- **API key:** supported records with `can_add_api_key === true` use existing `/api/runtime/model-connections/{provider}/api-key`, with owner permission, ready worker, and no preview. The password field clears on submission. The existing server encrypts and checks the key before replacing a working connection. API billing is separate from chat subscriptions.
- **Model check:** existing `/api/runtime/model-connections/{provider}/verify` queues an explicit check that may consume quota. The UI requires a pending/running response before reporting a queued check. Unsupported verification is labeled unavailable. Passive refresh never verifies access.
- **Setup:** unsupported entries show inline requirements, provider-owned key links where applicable, and honest limits. Meta consumer login is explicitly distinguished from Llama-compatible API access.

**Account connected** requires `account_connected === true`; saved `state: ready` alone says **Route available**. Checking and actionable failure states retain explicit text. Preview always says **Preview**, including synthetic ready records. A route check, catalog entry, or logo is not an authorized account.

## Hosting: computer pairing or the whole app

Hosting offers two modes, each with local, AWS, and Azure choices.

### Connect a computer

This adds approved tools through existing `/api/local-device/` endpoints while the app/history remain in the cloud. AWS/Azure options point to machines the user controls and provider guides. The UI reads devices, explicitly creates codes, cancels pairing, and confirms saved-device disconnection.

Device ID, code format, and future expiry are checked. Codes remain in component memory and a read-only password field, clear on expiry/pairing/account change, and are neither put in companion commands nor persisted in browser storage. The companion command limits access to the Cypher folder and leaves shell off. Each action retains local companion approval; pairing is not blanket shell permission. Preview does not create, revoke, or enumerate real devices.

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
| `GET /api/workspace/runs` | Up to 100 task IDs, statuses, start/completion times | Task history is not provider request logs; presentation excludes prompts, titles, outputs, arbitrary fields. |

Failed reads clear stale resource data and offer retry. A 401 requests sign-in. Invalid/missing metrics say **Unavailable**; numeric zero stays zero. Missing times say **Not recorded**. Worker readiness/release match stay separate. **Read at** records a refresh attempt, not provider verification.

Routing, fallbacks, caching, budgets, logs, latency, and rate-limit settings are unavailable from these reads. Advanced links remain optional for an owner in OmniRoute mode; provider setup stays in Cypher. Management URLs pass the existing exact-host HTTPS allowlist for `omniroute-cloud-ten.vercel.app` or `omniroute-cloud-hiveapp.vercel.app`, approved paths, and default port. Private runtime URLs, credentials, bindings, and bypass headers never enter the client. Connect tools derives only an illustrative `/v1` endpoint from an approved origin; it issues no key and proves no client connection. No second inference/MCP service or native desktop binary is added.

## Preview and release limits

Unauthenticated loopback preview is separate from sign-in. When local forwarding/session configuration is absent, `/login` offers **Open gateway preview**, labels samples, and creates no session. Public/auth-required configurations never receive that fallback. Existing configured Google/email login remains, without claiming successful mail delivery or provider consent.

Canonical source is `HIveAppDeveloper/cypher`, integration branch `main`, Vercel project `cypher`, submission URL `https://cypher-agent.vercel.app`. Preserve shared production PostgreSQL data and environment values. Read `CYPHER_SHARED_RUNTIME.md` before runtime changes/release. Ready changes go to release-owner chat `01a16f1c-f827-7ab0-ae4a-6bccbbb7eed2` (**Polish and deploy VentureCruiter**); production aliases belong to that owner. Frontend, API, and worker require verification against the same final release before completion is claimed.

## Bounded verification evidence

Documentation checked the final route, dashboard, connections/hosting/deployment/logo components, helpers/CSS, explicit origin opt-in, setup wizard, and logo attribution/license against incumbent guidance. Product/design authority files were preserved. Obsolete green-shell/reused-setup-dialog descriptions are replaced here; no global design drift was repaired.

Reported final implementation evidence: all 312 frontend tests and the production build passed after the action-copy change. Four Python setup tests passed, and actual Docker Compose configuration resolution validated unique project/schema isolation. These are source checks, not provider, email, provisioning, or full Linux-startup verification.

`.impeccable/review/` contains desktop, mobile, user-900px, Hosting, deployment, Azure, and Claude captures with synthetic sample states. The independent finish review returned **FIX**: catalog availability-label wording was **RESOLVED** with valid three-viewport recaptures, while native Claude/Codex adapters remain **UNRESOLVED** as a technical dependency. No regressions were observed from the catalog correction. The original provider connection objective remains incomplete, not merely awaiting deployment. No production environment/database/alias/cloud operations, real provider authorization, or email delivery were performed by this work.
