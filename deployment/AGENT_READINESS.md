# Public agent readiness

This change addresses the October 28 Is Agentic report for the canonical Cypher app. It is an application hosted on Vercel, not the Vercel product. The report's Vercel developer-search and Smithery usage attribution do not establish Cypher capabilities or registry publication.

## Routes and boundaries

- `/`: meaningful server-rendered public content when signed out with required authentication. A normal sign-in link preserves the internal return path and query. Signed-in and authentication-disabled workspace behavior remains unchanged.
- `/about`, `/contact`, `/privacy`, `/docs`, `/docs/api`, `/docs/auth`, `/docs/mcp`: public pages. Explicit `Accept: text/markdown` negotiation returns Markdown; HTML remains available. Both representations vary on Accept. `.md` alternatives are linked.
- `/llms.txt`, `/llms-full.txt`, `/robots.txt`, `/sitemap.xml`, `/openapi.json`: public discovery and documentation. Private workspace routes are excluded from the sitemap, discouraged from indexing, and not described as anonymous API capabilities. Robots rules are not authentication controls.
- Missing public routes return HTTP 404 with HTML or Markdown recovery text. API, static asset, and existing page precedence remain owned by Next.js routing.
- `/mcp`: stateless Streamable HTTP JSON-RPC for `search_cypher_docs` and `get_cypher_doc`. No credentials, session reads, private imports, network fetches, model requests, account tools, or task execution. GET returns 405 because SSE is not offered. POST notifications return empty 202. Initialize, ping, tool discovery, and tool calls return JSON.
- `/.well-known/mcp` and `/server.json`: MCP Registry schema-format manifest pointing to that docs-only server. This does not publish the server to a registry or authorize any external account.

The MCP transport checks Origin, Content-Type, required Accept media types, protocol version, JSON-RPC envelope, request identifiers, tool name, argument types, allowlisted document paths, and actual UTF-8 request size (32 KiB). A five-second whole-body deadline is below the route’s explicit fifteen-second maximum; arriving chunks do not restart it. A stalled upload or client abort returns 408 where the connection can still receive a response. Reader cancellation and its failures cannot delay that response, and timers/listeners are removed. It offers no credentialed cross-origin browser access. Direct non-browser clients require no authentication because all exposed data is authored public documentation.

## Content provenance

Product and task descriptions derive from PRODUCT.md and the existing workspace, goals, plugin, Google permission, and Meta permission handlers at base `10860033e1f592b9f7677ef8b804967b04feff43`. Privacy Markdown retains the existing Privacy page's data-use, storage, revocation, and model-provider statements. Support email is the address already published on `/privacy`. Product JSON-LD uses SoftwareApplication and a project contact point; there is no invented postal address, offer, review, corporate registration, or price. Original logo bytes, animation components, fonts, and CSS are unchanged.

## Verification

Installed Next 15.5.28 overwrites middleware Vary headers during HTML rendering. The narrow top-level Vercel headers apply only to the eight exact public document paths and retain Next’s RSC and encoding dimensions while adding standalone Accept. Local `next start` does not execute these platform headers: its HTML Vary check is a known failure, not a passed representation gate. Actual protected Vercel staging must verify exact comma-separated Accept on HTML and Markdown, plus retained RSC tokens on HTML, before production promotion. No private-path or Cache-Control policy is changed.

Run `npm test` and `npm run build` from `frontend`. The agent-readiness tests cover server-rendered content, metadata, signed-out/signed-in routing, return-query preservation, weighted Markdown selection, discovery, 404 status/body, MCP handshake, tools, malformed envelopes, bad Origin/protocol/content types, size limits, unknown tools and private-path rejection. An AST import-graph test keeps public MCP code closed over authored public text and checks for network/private-module escape paths.

Before promotion, verify the exact built candidate with HTTP requests for HTML and Markdown at each public page, `.md` aliases, HEAD, missing routes, the sitemap, robots, llms files, OpenAPI and both manifests. `verification/public-readiness.py` writes a fresh pass/fail report even when a check fails. It requires an exact Accept token, preserves failures, and compares canonical URLs with root-slash normalization. Validate the manifest against the official schema and use an official MCP client to initialize, list tools, search and retrieve a document. Check desktop/mobile light/dark and keyboard focus without provider, model or private task calls.

The canonical release owner alone handles integration, deployment and aliases. A final release still requires matching frontend/API/worker checks against the same deployment. Fetch an audit after deployment and compare its scan timestamp; a stored 31/100 report is not a rescore of this source.

## Remaining external decisions

Search indexing and ranking take time and cannot be promised by source changes. A business postal address requires a real, approved public address; it has deliberately been omitted. General external-host access to private workspace tasks needs a separately designed and authorized authentication interface. The docs-only MCP server does not grant that access or substitute for provider consent.
