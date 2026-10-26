# Cypher Apple Messages provider core

Status: source candidate with dormant account management. This is **not** an Apple-approved MSP,
Apple transport implementation, or working native messaging connection.

The provider belongs in Cypher's existing FastAPI backend and dedicated worker,
backed by its existing tenant-scoped PostgreSQL. There is no replacement app,
production database, separate cloud account, or SMS fallback.

## Implemented domain behavior

- A signed-in workspace can issue a ten-minute, single-use linking challenge.
  Only its SHA-256 hash is stored. A future Apple-authenticated transport binds
  that proof to the customer's opaque Apple identity and the chosen conversation.
- Opaque identities are encrypted using Cypher's existing secret-sealing service.
  Apple identity lookup does not expose the customer's phone number or email.
  One identity cannot silently migrate between tenants. Explicit unlink removes
  its external mapping and sealed identity without moving the old tenant's history.
- Verified incoming event IDs are durable and idempotent. Reused IDs with different
  content are rejected. Accepted messages and their bounded tasks are saved in
  the same transaction, scoped to the linked tenant. A queue/rate bound applies.
- STOP, UNSUBSCRIBE and conversation-ended events suppress pending messages.
  Further chat requires a new authenticated account link. Proactive task updates
  require a separate explicit opt-in; direct replies retain their originating thread.
- Asking for a person pauses bot replies, queues a customer acknowledgement and
  creates an operator notification. Further incoming text is retained in the
  linked conversation for a person. Operator replies have independent stable IDs.
- An outbox claim must commit before any future provider write. Crashed or ambiguous
  sends remain `sending`/`uncertain` for reconciliation, not automatic resend.
  Claims and opt-outs use the same thread-before-outbox locking order.
- Actual delivery references and reported costs can be recorded idempotently.
  Monetary values use decimal precision and an explicit currency. Missing prices
  stay null, not a zero-dollar invoice; later provider cost reporting can fill them.

The functions whose names contain `verified` are an internal trust boundary,
not HTTP authentication. A reviewed Apple transport must authenticate each
Apple envelope before calling them. The core alone cannot establish that trust.

## Same-runtime account API

The additive bootstrap registers four new tenant-scoped tables through the existing
API/worker advisory lock and revision path. It creates no replacement database,
changes no existing rows and requires no provider environment values. The prior
revision is upgraded once; concurrent startup and repeat startup are tested on
disposable PostgreSQL. Release remains the canonical owner's responsibility.

The existing authenticated backend boundary exposes `/api/apple-messages`:

- `GET /status` reports that linking, sending and the native transport are unavailable.
  It does not infer Apple approval from organization registration or an inquiry.
- `GET /threads?limit=50` returns at most 100 owned thread summaries without
  opaque IDs, hashes, secrets or message bodies.
- `PATCH /threads/{id}` accepts only an explicit boolean `updates_opt_in`.
  Withdrawal suppresses pending proactive updates while preserving direct replies.
  It cannot reactivate a closed, opted-out or human-controlled conversation.
- `DELETE /threads/{id}` closes the owned link, clears its encrypted external
  identity, and suppresses pending messages. Foreign IDs are indistinguishable
  from unknown IDs; old tenant history stays in its original workspace.
- `GET /usage?hours=720` aggregates owned message counts and reported costs over
  at most 744 hours by message creation time. Decimal amounts are strings, each
  currency is separate, and unreported prices are counted without assuming zero.
  This is reporting only, not an invoice or billing charge.

All routes require a workspace even when local user authentication is disabled,
retain the existing internal bearer-token boundary and return private/no-store
responses. No route grants provider staff authority or accepts Apple IDs from a
browser. A user cannot enable the transport by changing configuration here.

## Intentionally inactive

No public webhook, account-link creation API, operator UI, outbound network call,
worker hook, provider environment change or new billing charge is enabled.
Dispatch defaults to disabled.
There are no invented Apple payloads, certificate formats, or API endpoints.

The additive schema and account controls are safe preparation for the later
reviewed transport. They do not create an approved or working MSP. In-flight
claimed deliveries cannot be recalled by withdrawing consent; the transport
must handle its actual Apple cancellation/reconciliation contract.

## Required Apple integration work

Apple's [current FAQ](https://register.apple.com/resources/messages/messaging-documentation/faq)
requires an Apple-approved MSP and a live-human escalation path alongside
an automated agent. An organization registration is distinct from a Messages
for Business ID and an approved provider identity. The channel uses customer
opaque identifiers, not the business's ordinary telephone number.

The [account setup guide](https://register.apple.com/resources/messages/messaging-documentation/register-your-acct)
describes selecting an authorized MSP or its supplied Advanced configuration,
adding testers and verifying the provider connection. Do not configure a made-up
provider endpoint or present an unapproved platform as authorized.

Before activating this foundation:

1. Inspect the authenticated Apple account, its business/provider identities and
   actual approval status. Complete the MSP enrollment process with Apple.
2. Obtain Apple's authorized provider protocol and server authentication details.
   Implement its exact inbound verification, native outbound transport, receipts,
   connection verification and credentials lifecycle. Store credentials server-side.
3. Wire authenticated browser linking, customer identity verification and a real
   operator console/takeover flow. Add rich links, welcome/triage messages and
   required customer controls using Apple's actual supported payloads.
4. Wire task-completion and outbox worker hooks, reconcile
   ambiguous deliveries, and expose reported messaging costs separately in Usage.
5. Validate actual PostgreSQL concurrency, duplicate callbacks, STOP-versus-send,
   worker restart/reconciliation and cross-tenant isolation on disposable data.
6. Test native conversation, two-way chat, opt-in task update, human handoff and
   opt-out on approved test Apple devices. Submit the complete implementation for
   Apple's [Experience Review](https://register.apple.com/resources/messages/messaging-documentation/xp-review).
7. Release only through Cypher's canonical owner, preserving the production
   PostgreSQL/environment and verifying frontend/API/worker against one final release.

## Validation so far

Eleven synthetic core tests cover linking/expiry, tenant isolation, replay safety,
opt-out/end, human handoff, update consent/privacy, disabled dispatch, uncertain
sends, costs, rate bounds and unlink/relink history isolation. They use temporary
SQLite files, mocked identities and no real messaging or paid model calls. All eleven
also pass on a new Unix-socket-only PostgreSQL instance and a dedicated test database.
Three additional actual PostgreSQL cases pass for concurrent duplicate events,
exclusive delivery claims, and cross-tenant identity-link races. Test schemas and
the owned server/data directory are removed after execution.

The original foundation passed 559 tests with seven PostgreSQL-gated skips. The
server-preparation follow-up adds real HTTP authentication, strict input/consent,
foreign-ID privacy, durable disconnect, exact cost/unknown-price and content
redaction cases. An additional PostgreSQL race covers consent withdrawal versus
task-result queueing, and a PostgreSQL upgrade case proves concurrent startup
from the prior revision preserves existing data. Updated counts are recorded in
the server evidence receipt. The task is explicitly flushed before an existing inbound event obtains
its immediate foreign-key reference, within the same transaction.

Apple transport/device proof is still required; it must not be inferred from
these local database/domain tests. The future operator API must verify business
staff authorization in addition to the core's tenant boundary; account ownership
alone is not a provider-staff role.
