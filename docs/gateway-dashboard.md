# Cypher gateway dashboard — additive surface

This document describes the local `/gateway` frontend candidate reviewed on October 26, 2026. It extends the existing Cypher workspace with an operational view of the same runtime, provider connections, workspace consumption, and task history. It is a source-only review candidate; it does not establish a deployment or working provider access.

## Existing design authority

[`PRODUCT.md`](../PRODUCT.md), [`DESIGN.md`](../DESIGN.md), and `.impeccable/design.json` remain the incumbent product and design authorities. This surface inherits Cypher's system typography, restrained hierarchy, opaque surfaces, compact navigation, explicit recovery states, and existing identity asset. The green treatment below is a scoped operational variant implemented by `gateway.css`, confined to the gateway shell. It does not replace the monochrome workspace world, revise global tokens, or authorize recoloring other screens. Acceptance of this candidate variant belongs to release review.

The route uses the existing `/cypher-mark.svg` asset with Cypher text and a small GATEWAY descriptor. Provider marks are initials, rather than new provider logos or connection guarantees. The shell inherits its font family; code inherits the existing `--font-mono`. The route explicitly declares `color-scheme: light` and has no gateway-specific dark palette; the workspace's broader appearance support must not be inferred for this surface.

### Observed local values

These values are extracted from `frontend/src/app/gateway/gateway.css`. Only the first three entries are named CSS custom properties; the other entries are existing local literals, documented here without adding global tokens.

| Role | CSS source value | Application |
| --- | --- | --- |
| Ink | `--gw-ink: #334238` | Default gateway text |
| Muted text | `--gw-muted: #626f65` | Supporting copy and labels |
| Separator | `--gw-line: #dfe5dd` | Panel boundaries and shell dividers |
| Canvas / panel | `#f7f8f5` / `#fff` | Quiet outer surface and opaque panels |
| Sidebar / active navigation | `#142019` / `#2b4433` | Persistent navigation and selected destination |
| Primary action / hover / text | `#27432e` / `#365e3b` / `#f1f8e9` | Provider/setup action |
| Usage bar | `#779c65` | Relative recorded provider token consumption |
| Positive status | `#edf5e6` fill, `#d0e1c6` border, `#456539` text | Confirmed readiness and saved verification |
| Attention status | `#faf4e0` fill, `#eadcb8` border, `#826429` text | Failed tasks and provider attention states |
| Error | `#fff5ed` fill, `#ecd5c2` border, `#86582e` text | Read failures with retry |
| Keyboard focus | `3px solid #8caf94`, `3px` offset | Buttons, links, and inputs |

The shell body is (13px), with a (1.5) line height. The desktop page heading is (28px/550), line height (1.25), tracking (-.035em); section headings use (14px/550). Supporting copy generally uses (10–12px). Metrics use tabular numerals and a (27px/500) desktop value. Button corners are (6px); principal panels and the metric strip are (9px); navigation rows are (5px). Tonal surfaces and thin borders supply depth. The copy toast alone uses the local shadow `0 6px 24px #203c2130`.

### Composition and responsive behavior

The fixed, full-viewport shell places a (228px) sidebar beside a separately scrolling content area. The desktop topbar is (66px), content padding is (34px), and main content is capped at (1530px). Overview leads with a four-column metric strip, then usage and runtime-route panels, provider summaries, recent tasks, and integration guidance. There is no inference console embedded in this view.

Breakpoints exist at (1600px), (1200px), (1000px), (780px), and (650px). At (1000px) the overview becomes one column, metrics and provider summaries become two columns, and the cost callout hides. At (650px) navigation becomes an off-canvas modal drawer, the topbar becomes (59px), and main padding becomes (25px 18px). Tables retain horizontal scrolling within their own wrapper. The drawer marks closed navigation inert, makes background content inert while open, traps Tab, closes with Escape or the shade, and restores prior focus. OS reduced motion suppresses transitions and animations. This source behavior is distinct from a comprehensive assistive-technology audit.

## Route, authentication, and owner boundary

`frontend/src/app/gateway/page.tsx` is a force-dynamic server route. It reads the signed `grokbot_session` cookie through the existing authentication helper. When `REQUIRE_USER_AUTH === 'true'`, a missing or invalid session redirects to `/login?returnTo=%2Fgateway`. Existing local development behavior when authentication is disabled is preserved. This addition creates no new sign-in system.

The server passes the session subject as `accountId` and keys the dashboard by that subject. Account changes/unmounts invalidate and abort old reads; late responses cannot replace a newer account's view. Requests continue through the existing same-origin authenticated API path.

The dashboard displays shared model-connection records and management actions only when the runtime returns `can_manage_model_connections === true`. Advanced gateway links additionally require `model_transport === 'omniroute'` and an approved public URL. The existing backend remains authoritative: runtime responses omit model-connection records from non-owners, and the existing queued connection checks call `require_owner()`. Hiding a control is not an authorization mechanism on its own.

## Data contract and honest states

The dashboard refreshes on mount, every (30 seconds), and through Refresh/Retry. It issues only these three read requests itself, with `cache: 'no-store'`:

| Existing endpoint | Displayed evidence | Limits |
| --- | --- | --- |
| `GET /api/runtime` | Transport, configured route IDs, model configuration, database/worker readiness, worker heartbeat age and release match, owner permission, saved provider-check states/times | The frontend expects `connected: true` from the existing runtime proxy. Configured routes are deduplicated; they are not a complete discovery catalog or evidence of successful inference. |
| `GET /api/workspace/usage` | Week-to-date input/output tokens, recorded estimated cost, per-model/provider rows, weekly token allowance and reset time | Workspace-scoped accounting; estimates are not invoices, and a zero estimate does not prove free access. Provider totals sum finite nonnegative recorded values and sort by token count. |
| `GET /api/workspace/runs` | Up to 100 recent task IDs, status, start time, completion time; overview takes the first five | Task history is not provider request logging. The presentation helper projects only `id`, `status`, `created_at`, and `completed_at`, excluding titles, prompts, output, and arbitrary fields. |

The three reads settle independently. A failed read clears that resource's stale data and shows a retryable error. A 401 asks the user to sign in again. A runtime payload without `connected: true`, a usage payload without a model-row array, or a non-array task response is treated as unavailable. Unknown, negative, nonfinite, or nonnumeric headline metrics render as **Unavailable**, while a recorded numeric zero remains zero. The provider aggregation helper ignores invalid numeric contributions; it is a display summary, not a data-quality certification.

Readiness labels have bounded meanings:

- **Cloud API connected** means an accepted runtime response, not that every provider or tool works.
- **Ready** on Cloud worker reflects the runtime's worker readiness boolean; the separate heartbeat age and release-match result provide context.
- **Configured** describes the runtime's model configuration. It does not mean a model call succeeded.
- **Verified** on a provider card represents a saved `ready` check and its recorded time, not a live availability guarantee. Attention states retain text such as Verification needed, Sign-in needed, Access denied, Review billing, and Rate limited.
- Runtime readiness rows distinguish **Confirmed**, **Not confirmed**, and **Unavailable**. Missing timestamps read **Not recorded**. Empty usage and task lists have explicit empty states.
- The footer's **Read at** time records the completed refresh attempt; it is not a successful provider-check timestamp. The static status-dot styling does not override these textual states.

Current routing strategy, fallback order, cache policy, gateway budgets, provider logs, request latency, and rate-limit configuration are not returned by these read APIs. The page states that they are unavailable locally and offers native OmniRoute links when permitted. It does not invent values or add local editors for them.

## Existing connection and setup flows

The Providers view reuses `ModelConnections`; Overview/Providers setup actions and the Usage setup action open the existing `WorkspaceSetup` dialog. This preserves existing provider sign-in, Google verification, API-key submission, queued worker checks, and setup behavior rather than implementing a second credential flow.

Passive dashboard refresh reads saved data and sends no provider verification request. An explicit **Check access**, **Check again**, or API-key verification action in `ModelConnections` uses the existing POST endpoints under `/api/runtime/model-connections/{provider}/verify` or `/api-key`; it sends a short model request and may consume provider quota. Worker readiness gates those actions. Opening a Google verification link alone never marks the connection verified. `WorkspaceSetup` retains its own existing reads, explicit cloud-check/model-test actions, and deployment guidance; opening it must not be described as this dashboard provisioning infrastructure or performing all those actions automatically.

## Public management URL boundary

The server checks `OMNIROUTE_DASHBOARD_URL`, falling back to `OMNIROUTE_URL`, through `publicGatewayManagementUrl()`. Only HTTPS URLs on the exact hosts `omniroute-cloud-ten.vercel.app` and `omniroute-cloud-hiveapp.vercel.app` are accepted. The default HTTPS port is permitted; other ports, user information, query strings, fragments, and unrecognized paths are rejected. Accepted input paths are `/`, `/v1`, and `/dashboard/providers` (including the URL parser's empty-path case). The output is always the approved origin plus `/dashboard/providers`.

The route never forwards a raw private runtime URL, credential, service binding, or protection-bypass header into the dashboard. The client presents the approved management link only for an installation owner in OmniRoute mode; external dashboard anchors use `noopener noreferrer`. A failed URL check yields no inferred destination. The public URL's allowlist membership is a safety boundary in source, not a new live verification of that deployment.

Connect tools derives `/v1` from that same gated public origin and offers an illustrative OpenAI-compatible client snippet. It issues no key and makes no inference/model-list request from the dashboard. Credentials and deployment access remain prerequisites supplied through the existing owner process.

## Integration and release limits

Advanced routing, fallbacks, load balancing, caching, budgets, provider analytics, and subscription sign-in stay in the existing native OmniRoute dashboard. This candidate adds no Node inference service, database, alternate production application, or second MCP server. Its MCP paragraph points to the installed OmniRoute version's supported configuration. Desktop access means opening the cloud page or using browser shortcut/Add to Dock behavior; no native desktop binary or newly verified desktop/MCP integration is included.

The existing shared production PostgreSQL and environment values must be preserved. Canonical source remains `HIveAppDeveloper/cypher`, integration branch `main`, Vercel project `cypher`, and submission URL `https://cypher-agent.vercel.app`. Follow `CYPHER_SHARED_RUNTIME.md` before runtime changes or release. The sole release owner is chat `01a16f1c-f827-7ab0-ae4a-6bccbbb7eed2` (**Polish and deploy VentureCruiter**). This local work is handed to that owner for review and any production alias action. Final frontend, API, and worker parity against one release remains a release gate.

## Bounded verification evidence

Sources reviewed: incumbent product/design documents; the gateway server route, stylesheet, dashboard component and presentation helpers; existing `ModelConnections`/`WorkspaceSetup`; and backend owner-check/runtime source. No incumbent design-system file was edited for this extension.

The local evidence directory is `/Users/boaznovik/Documents/Codex/2026-10-26/gateway-verification`. `fixture.mjs` supplies synthetic provider names, usage, task history, and readiness. The inspected `desktop.png`, `mobile.png`, and `providers-desktop.png` are **first-viewport captures only**. They support a bounded layout review at desktop/mobile sizes; their apparently ready providers, costs, and worker state are fixture values. They do not demonstrate the lower page, all tabs, real authentication/consent, provider execution, cloud readiness, or an end-to-end integration.

The focused command `node --test tests/gateway-dashboard.test.mjs tests/gateway-dashboard-component.test.mjs` passed **11/11 tests** from `frontend/`. Coverage includes the URL boundary, numeric handling, configured-route deduplication, task-content exclusion, exact read endpoints, non-owner management suppression, stale-account/unmount response handling, failed-refresh state clearing, and closed mobile navigation/Escape focus restoration. Existing local logs also record a successful frontend production build (`build-final.txt`) and a **291/291** frontend-suite pass (`frontend-tests-recheck.txt`); those are recorded local source checks, not cloud verification. No real provider call or production deployment was performed by this documentation review.

## Local preview sign-in repair

The follow-up login change keeps an explicitly unauthenticated loopback preview separate from real account sign-in. When `REQUIRE_USER_AUTH=false` on localhost and the local authentication forwarding/session configuration is missing, `/login` offers **Open gateway preview** and labels its data as samples. It does not show an email form that cannot send. The continuation stays internal and cannot loop back to `/login`; no session is created.

Public or auth-required environments never receive this preview fallback. A real unconfigured sign-in service shows an unavailable/retry state. When backend forwarding and session signing are configured, the existing Google sign-in, email fallback, callback URI, and signed-in return behavior remain in place. Configuration presence is not evidence of successful mail delivery or provider authorization. The change does not send an email, modify an environment value, or weaken a production authentication check.

The final follow-up frontend suite passed 298 tests, including six new readiness/page cases. Its production build passed. Built local browser checks at 1024×900 and 390×844 confirmed the removed email input, readable primary link, no horizontal overflow, and navigation to `/gateway`. These are local fixture results; production integration remains the release owner's responsibility.
