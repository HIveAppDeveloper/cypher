# Cypher Apple Messages provider core

Status: source-only backend foundation. This is **not** an Apple-approved MSP,
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

## Intentionally inactive

No public webhook, account-link API, operator UI, outbound network call, worker
hook, app model registration, bootstrap revision, migration, environment change,
or new billing charge is enabled by this commit. Dispatch defaults to disabled.
There are no invented Apple payloads, certificate formats, or API endpoints.

These four model tables must be registered and created through the existing
advisory-locked additive bootstrap in the eventual reviewed integration; simply
importing this service is not a production migration. Existing data must remain.

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
4. Register additive tables, wire task-completion and outbox worker hooks, reconcile
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

The final backend suite passes 559 tests with seven PostgreSQL-gated skips. The
three new PostgreSQL-only cases are independently exercised in the fourteen-case
native-core PostgreSQL pass; four older PostgreSQL-gated cases are outside this
change. The task is explicitly flushed before an existing inbound event obtains
its immediate foreign-key reference, within the same transaction.

Apple transport/device proof is still required; it must not be inferred from
these local database/domain tests. The future operator API must verify business
staff authorization in addition to the core's tenant boundary; account ownership
alone is not a provider-staff role.
