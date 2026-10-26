# Provider connection handoff

This candidate adds optional OpenRouter consent. It does not connect or transfer
Google, ChatGPT/Codex, Claude, Meta or Grok subscriptions. Named providers remain
the priority, with only actually supported methods enabled. Meta model access and
Facebook/Instagram permissions are separate grants.

## Paired release

The app must be reviewed with gateway source
`cb1c090b3cb91cf3aabfe840d84ed11fa90faaab`, whose lower contract is
`cloud/OPENROUTER_OAUTH_CONTRACT.md`. An explicit Connect request preflights the
existing private gateway worker lane. Only this response permits consent:

```json
{"state":"supported","provider":"openrouter","capabilities":{"openrouter_consent_enrollment":true,"version":1}}
```

No catalogue load or polling starts provider authorization, probes models, or
enrolls an account. The preflight transport queues operational metadata in the
existing PostgreSQL/worker lane; its capability dispatcher does not read or write
provider credentials. An older gateway fails before a provider page is opened.

## Browser contract

- `POST /api/model-connections/openrouter/begin` with `{returnTo:"/..."}` requires
  an existing Cypher session and canonical same-origin request. Response contains
  only `authorization_url`, pointing directly to `https://openrouter.ai/auth`.
- A signed, expiring HttpOnly cookie binds the flow, session subject and browser.
  The encrypted PKCE verifier and state/binding hashes live in existing
  `RuntimeCheck` rows. These rows are global, so explicit installation-owner and
  row-owner checks are required independently of tenant ORM filtering.
- The fixed callback is
  `https://cypher-agent.vercel.app/api/model-connections/openrouter/callback`.
  It exchanges the code server-side, strips raw callback parameters and redirects
  to `/connect/models?result=queued&flow=<uuid>&returnTo=<relative-path>`.
- OpenRouter denial can omit state. That case never exchanges a code, clears the
  browser binding and returns cancelled; the unused encrypted verifier expires.
- `GET /api/model-connections/openrouter/status?flow=<uuid>` returns owner-only,
  private/no-store metadata. Query parameters alone cannot claim success. The
  exact durable worker request must complete with `account_connected:true`.
- Codes, verifiers and keys are never returned in status, URLs or browser storage.
  A consumed flow cannot exchange twice. A callback after sign-out, account
  switching or expiry cannot exchange. Flow cancellation does not disconnect any
  existing provider.

OpenRouter enrollment checks account-key metadata and persists it in the existing
encrypted native gateway slot. It sends no model inference. A connected result
always has `model_access_verified:false`; it changes no model route/default.
OpenRouter credits are separate from provider subscriptions. A failed exchange or
enrollment preserves the existing native account. No database, environment,
production alias or gateway runtime is provisioned by this candidate.

## Native named-provider work

Do not point Connect to the gateway dashboard or fabricate a registered Cypher
callback. The installed native Claude adapter uses a provider code screen;
hosted Codex needs its supported device flow rather than a localhost callback.
Those methods need a separate reviewed, capability-gated lower adapter and
authenticated Cypher endpoints. They are not enabled by this candidate. The
gateway catalog must not advertise `can_connect:true` for an unimplemented
method. Existing API-key methods and explicitly labeled public-route checks
remain available where supported.

The gateway catalog may reuse the paired OpenRouter button/endpoint; native
providers should use the same `/api/model-connections/{id}/begin` convention
only after their precise method contract has been implemented and reviewed.

## Verification boundary

Tests use synthetic codes/keys, mocked fixed provider endpoints and isolated
temporary databases. They cover owner/session/browser binding, PKCE, expiry,
replay, capability shape, safe metadata, duplicate clicks, unmounts and polling.
They do not establish live provider consent, subscription eligibility, model
access or frontend/API/worker release parity. Production verification belongs to
the canonical release owner using the existing shared database.

Provider reference: [OpenRouter OAuth PKCE](https://openrouter.ai/docs/guides/overview/auth/oauth).
