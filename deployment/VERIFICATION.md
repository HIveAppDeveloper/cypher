# Cloud verification — 20 October 2026

Production: https://open-grokbot-hiveapp.vercel.app

Runtime revision: `4c403e1121322d39f965fab24c2d11fb22b98f73`.

| Check | Observed result |
| --- | --- |
| Vercel production deployment | READY |
| Atlas PostgreSQL | Connected; app tables in isolated grokbot schema |
| Persistent cloud worker | Healthy at 19:19:37 and 19:20:55 UTC; final heartbeat age 3 seconds |
| Worker database session | Switched from transaction-pooled URL to equivalent native unpooled URL |
| GPT-6.1 Sol request | Reached gateway; blocked by HTTP 403 RestrictedModelsError requiring paid credits |
| DeepSeek V3.2 fallback | Same free-credit restriction; no successful model response |
| DeepWiki MCP | Actual read_wiki_structure call for vercel/ai passed at 19:19:22 UTC |
| Vercel variable inventory | 177 names; 43 configured values imported, remaining protected values need linking |
| Backend tests | 17 passed; provider HTTP is stubbed in the adapter regression test |
| Frontend | Production build and TypeScript checks passed |
| Latest visual review | Blocked by disconnected local browser; no new screenshot claimed |
| Image/video, Sandbox, complete agent workflow | Implemented, not verified live |

The backend service and worker are hosted in Vercel; the laptop is not their host. These short checks establish current readiness, not a long-duration reliability guarantee.

## What remains

Add paid credits to the Vercel team's AI Gateway, or configure a separately billed provider API key and direct provider mode. A ChatGPT subscription is separate from API billing. The app has an AI Gateway billing/access link in Workspace setup and explains credit restrictions in task failures. After funding, retry a small task and verify model replies before testing paid image/video or computer tools.

To start, open the app, type a task, and press Start task. The Agent lounge creates six specialist agents and shares their conversation. Open Connections for the one-click DeepWiki option, custom public HTTPS Streamable HTTP MCP servers, or the Vercel variable inventory. OAuth-only servers require an additional authorization flow.
