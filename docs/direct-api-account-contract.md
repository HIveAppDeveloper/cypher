# Google and Grok API-account verification

This app counterpart requires the paired private worker before accepting an
explicit `provider_account` check or an API-key enrollment. Legacy
`current_route` behavior is unchanged. Direct local API-key verification uses
the same documented response-model requirement without a worker preflight.
It introduces no database schema, environment, provider-default or alias change.

An owner-control POST with `{provider, action:"capabilities"}` must return the
same provider, `state:"supported"`, the respective capability below exactly
`true`, and `capabilities.version` exactly integer `1`. Boolean or floating
versions are rejected. This probe sends no API credential. Unsupported, malformed
or unavailable workers return 503 before a saved row, key, request ID or queue is
changed. Existing owner, valid-key and encryption checks precede this probe.

| Provider | Capability | Fixed credential slot | Public model | Transport model |
| --- | --- | --- | --- | --- |
| `gemini` | `gemini_api_account_check` | `grokbot-gemini-existing-api` | `google/gemini-3.8-flash` | `gemini/gemini-3.8-flash` |
| `xai` | `xai_api_account_check` | `grokbot-xai-existing-api` | `xai/grok-4.5` | `xai/grok-4.5` |

These exact model IDs match the app's `PROVIDERS`, `ROUTES`, and research/review
profile registry. Matching that registry does not prove provider availability.
The paired worker must use the supplied or fixed-slot API credential directly
at the fixed official provider endpoint, require usable content and the exact
response model, and preserve credentials on failed checks or concurrent changes.
No account, OAuth, AGY, public, or generic loopback fallback can certify this
API credential. Enrollment uses compare-and-swap; stored-key checks revalidate
the unchanged active provider/apikey slot after the response.

Both actions accept `ready` only with `provider` and `connection_provider` equal
to the request, `verification_scope:"provider_account"`, the exact fixed
`connection_ref`, exact public/transport models above, and
`model_access_verified:true`. Missing fields, integer `1` instead of Boolean
`true`, foreign slots, or native account transports fail verification.
Returned provider messages, credentials and browser verification URLs are never
forwarded. Failure receipts use fixed app text. Existing route/key preservation
and stale-result guards remain in the durable worker.

The direct self-host path uses its existing fixed official endpoint and the
submitted or encrypted app-saved credential. It also requires the exact
`modelVersion`/`model`, rejects thought-only Google text, and returns the registry
transport ID after success. Missing/wrong model responses cannot replace a
working saved credential. It requires no remote worker capability. Its saved
app credential is distinct from the native worker's fixed slot.

Google's [GenerateContentResponse reference](https://ai.google.dev/api/generate-content#generatecontentresponse)
defines `modelVersion` as the version used for the response. The
[xAI Chat Completions reference](https://docs.x.ai/developers/rest-api-reference/inference/chat-completions)
defines `model` as the model ID used. No undocumented resolved alias or version
suffix is accepted. If a real response differs, verification must fail until an
explicit mapping is reviewed; broad prefix matching is insufficient.

Authoring checks use synthetic HTTP receipts and temporary SQLite only. No live
provider request, credential enrollment, deployment or production database
operation was performed. The canonical release owner must review the exact
paired worker source and verify final frontend/API/worker parity before the
explicit live checks.
