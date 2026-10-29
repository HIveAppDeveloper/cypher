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
official MCP Registry. Existing official pagination cursors continue to use that
registry directly. Successful catalog responses, including empty results, have a
bounded process-local 60-second cache; no production database migration is needed.

No learned operations, account sessions, browser learning, uploads, reports,
background verification or automatic connections run through this integration.
Only the user's explicit discovery query is sent to the public catalog; URLs are
reduced to a hostname so login codes in query strings are not forwarded there.

The October 29 live probe returned HTTP 200 for `linear.app`, `notion.so` and
`hacker-news`. The first two had no matches; Hacker News had two website operations
and no MCP interfaces. Those observations prove catalog access, not that API
Anything currently lists every MCP service. The official fallback retains coverage.
