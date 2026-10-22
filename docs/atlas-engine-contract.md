# Atlas inference contract, version 1

Status: implementation draft, disabled by default. No deployment, credentials,
provider calls or real user-data transfers are established by these tests.

Atlas owns identity, context retrieval, organization permissions, tool execution
and action receipts. Grokbot performs one stateless inference hop and returns
text or offered function intents. It does not execute tools, read the Atlas
database, inherit browser credentials or keep conversation history. Hive calls
Atlas's search boundary; it does not create another chat interface.

## Request and authentication

`POST /api/integrations/atlas/v1/chat` accepts uncompressed JSON. The exact Next
route forwards the original bytes to the private backend. Ordinary API routes
retain their session and backend-token gates. Vercel deployment protection is
unchanged and remains a separate access prerequisite.

Required headers:

- `x-atlas-engine-timestamp`: canonical Unix seconds, valid within 60 seconds.
- `x-atlas-engine-signature`: lowercase hex HMAC-SHA256 of the UTF-8 bytes
  `v1\n<timestamp>\n<raw request body>`, using the scoped signing key.

Body:

```json
{
  "version": 1,
  "requestId": "59f57f20-3197-45e1-bad9-86844948aace",
  "principal": { "tenantId": "atlas-user:synthetic-user", "actorId": "synthetic-user" },
  "recipient": "gemini",
  "messages": [{ "role": "user", "content": "Synthetic fixture question" }],
  "tools": [{ "type": "function", "function": { "name": "read_source", "description": "Read an authorized source", "parameters": { "type": "object" } } }],
  "maxTokens": 1200,
  "timeoutMs": 10000,
  "stream": true
}
```

Atlas derives the principal from its verified actor; a browser organization
claim never grants access. The signing service is trusted to assert that
principal. Unsigned user-id headers, session cookies and the ordinary backend
bearer do not authenticate this endpoint. The body cannot select a model,
provider endpoint, key or fallback. The required `recipient` must match the
backend's dedicated provider configuration before inference begins.

Requests are at most 262,144 bytes, 100 messages and 160 tool specifications.
Each message may carry 131,072 characters so Atlas's 90,000-character attachment
budget remains usable within the aggregate byte limit. OpenAI function-call
messages and matching `tool_call_id` results must form a complete sequence;
opaque `extra_content` thought signatures are preserved. Unknown fields,
duplicate JSON keys, nonfinite numbers and malformed sequences fail with 400.
An upload has a five-second deadline. Output allowance is 1–4096 tokens and the
inference deadline is 100–30,000 ms. The proxy has a 35-second stream deadline.

## Response

`stream: false` returns JSON. `stream: true` returns newline-delimited JSON,
without buffering, containing zero or more token frames and exactly one final
result or safe error:

```json
{"type":"token","text":"A piece of the answer"}
{"type":"result","result":{"content":"The complete answer","toolCalls":[{"id":"call-1","name":"read_source","arguments":"{}","extra":{"google":{"thought_signature":"opaque"}}}]},"model":"configured-model-id"}
{"type":"error","code":"engine_timeout","message":"The inference deadline was reached.","retryable":true}
```

`extra` is optional. Tool names must have been offered in this inference hop;
their arguments must be complete JSON objects. Limits are eight tool intents,
32,768 characters per argument string, 65,536 answer characters, and 120 KiB of
aggregate serialized result data. Token frames split at 4096 characters. An
empty, truncated, oversized, malformed or unfinished provider response returns
an error and never a completed tool intent. Raw provider errors, prompts, keys
and internal addresses are not returned. The recipient uses its official API
origin directly, ignoring global routing and provider API-base overrides. No
other model/provider is tried automatically.

Client disconnect, cancellation and deadline expiry close the provider iterator
and release the local admission slot. The stream releases admission even if
the connection disappears before its first body frame. There are at most two
in-flight requests per principal and 16 per process. A bounded, short-lived
process-local nonce store rejects replay with 409; it stores identifiers only.
Replay protection and concurrency limits are not distributed across instances.
A shared admission/nonce store is required before claiming those guarantees
across a scaled deployment. The endpoint cannot perform actions even if the
same signed request reaches separate instances.

## Configuration and activation

Keep `GROKBOT_ATLAS_ENGINE_ENABLED=false` by default. Enabling a test deployment
requires that flag on both frontend and backend, a backend-only
`ATLAS_ENGINE_SIGNING_KEY` of at least 32 bytes, and dedicated
`GROKBOT_ATLAS_ENGINE_PROVIDER` / `GROKBOT_ATLAS_ENGINE_MODEL` settings. Providers
are restricted to Gemini, OpenAI, Anthropic and DeepSeek with reviewed Grokbot
model IDs. Only the selected provider's corresponding existing server-side key
is used. Generic gateway credentials and `LLM_API_KEY` are not reused here.

Atlas's opt-in consumer uses `ATLAS_COMPANION_ENGINE=grokbot`,
`GROKBOT_ENGINE_URL`, the matching `ATLAS_ENGINE_SIGNING_KEY`, and
`ATLAS_ENGINE_MODEL_RECIPIENT`. Do not put signing keys in client variables.
The current Hive Gemini-only consent does not authorize adding Atlas, Grokbot
or another provider. Real production activation requires explicit disclosure
and approval of the complete recipient chain, applicable user consent, existing
authorized access, and deployment approval. Do not change SSO protection or
generate new credentials to make a test pass. Rollback is disabling the feature
flags and restoring Atlas's existing engine selection; no migration is needed.

## Verification

Backend: `python -m pytest tests/test_atlas_engine.py` from `backend/`, using the
project Python dependencies. Frontend: `node --test
tests/atlas-engine-proxy.test.mjs` from `frontend/` with Node 24 or newer, plus
the production frontend build. All contract fixtures are synthetic and provider
streams are mocked. These tests do not verify live provider availability,
production Vercel access, multi-instance admission, live OAuth or production
data sharing.
