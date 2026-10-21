# Reliable web research repair — 2026-10-21

## Outcome and acceptance criteria

A research request must reach the persisted worker, execute a real web search,
save provider-returned source URLs, and display a cited answer. An access-denied
page or a tool-free specialist must not be presented as proof that browsing is
unavailable or no matching information exists.

## Plan

1. Reproduce the screenshot failure from saved messages and inspect the current
   production source rather than deploying the older repair checkout.
2. Restore the authentication/image-chat repair lost in subsequent releases.
3. Add native Responses web search through the existing model connection;
   require a completed search call and actual returned source URLs.
4. Correct browser HTTP/challenge failures and remove the network-idle wait
   that can discard readable pages. Return page text with navigation.
5. Make current tool capabilities explicit during planning, keep tool-free
   specialists focused on supplied evidence, and render Markdown citations.
6. Run regression checks, preserve concurrent plugin/sidebar fixes, release,
   and verify real research and attachment handling in the hosted UI.

## Implementation

`search_web` belongs to the existing Browser category. It reuses fresh gateway
credentials, uses the existing GPT-6 Luna model for source retrieval, limits
native searches to two per call, bounds output and request duration, and saves
sources with the tool result. It sends the query, not the conversation history
or account credentials, to the search request. Raw provider errors are excluded
from chat. Search and ordinary model requests consume the existing provider
credits when users invoke them.

The coordinator is told its actual execution tools even during its planning
phase. Search evidence precedes optional specialist analysis. Existing messages
are preserved. React Markdown renders safe links, lists, emphasis, and tables;
raw HTML is ignored and Markdown image URLs do not load remote images.

The earlier image/authentication fix is reapplied on top of current main,
including capability-aware routing and attachment preservation. This avoids
reverting the newer website/OAuth plugins and dockable sidebar.

## Local validation

- Backend: 100 tests passed, including a real API/SQLite/worker/LiteLLM search
  round trip with only provider HTTP mocked, search failure cases, OIDC
  rotation, image persistence, OAuth flows, and goal/channel behavior.
- Attachment reader: four tests passed.
- Frontend production build, TypeScript checks, and diff checks passed.
- Live model catalog verified both existing chat models support web search.

Hosted verification evidence is recorded outside the source tree in the
task's `grokbot-repair` directory after release. These local tests do not by
themselves establish successful live provider search.

## API references

- https://vercel.com/docs/ai-gateway/models-and-providers/web-search
- https://developers.openai.com/api/docs/guides/tools-web-search
