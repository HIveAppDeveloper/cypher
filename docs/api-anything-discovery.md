# API Anything MCP discovery

Cypher uses API Anything's public catalog as the first discovery source behind
the existing `/api/plugins/registry/search` endpoint. Valid MCP interfaces appear
as ordinary discovery results. The existing explicit Connect, authorization and
tool-verification steps still decide whether a connection works.

Reference: [goodnight000/api-anything](https://github.com/goodnight000/api-anything),
commit `3495ffe8af1d586b95142a76e4902070fc59c935`, `src/registry-api.ts` and
`registry/src/worker.ts`. The adapter uses the documented read-only
`GET https://api-anything-registry.forth-site.workers.dev/v1/search?q=…&limit=20`.
It does not run the desktop installer described in INSTALL.md.

Only `interfaces` with kind `mcp`, positive confirmation counts, a concrete HTTPS
URL on the listed domain, and no credentials/query/fragment are offered. OpenAPI
documents and learned website operations are not mislabeled as MCP servers.
Discovery does not claim a working transport, sign-in or verified tools.

API Anything gets two seconds within the existing overall eight-second first-page
budget. Empty, unavailable, malformed or oversized responses fall back to the
official MCP Registry, with a four-second first-page allowance. If that registry
fails or times out, the already-packaged public MCP directory supplies matching
results, explicitly labeled as saved listings with their snapshot timestamp.
It does not copy historical protocol checks into a claim of current access.
Existing official pagination cursors continue to use that registry directly;
an unavailable later page is never replaced with a repeated saved first page.
Successful API Anything responses, including empty results, have a
bounded process-local 60-second cache; no production database migration is needed.

No learned operations, account sessions, browser learning, uploads, reports,
background verification or automatic connections run through this integration.
Only the user's explicit discovery query is sent to the public catalog. Full,
bare and protocol-relative URL hints are reduced to a public hostname before
either catalog request or caching, so login codes are not forwarded. Malformed
or nonpublic URL hints are rejected. Pagination shares the same eight-second budget.

The October 29 live probe returned HTTP 200 for `linear.app`, `notion.so` and
`hacker-news`. The first two had no matches; Hacker News had two website operations
and no MCP interfaces. Those observations prove catalog access, not that API
Anything currently lists every MCP service. A real local adapter probe reached both
catalogs but timed out at the official registry; the existing deployed official-only
search for `linear` also returned HTTP 503. These failures motivated the saved-directory
fallback. They are not recorded as successful live discovery.
