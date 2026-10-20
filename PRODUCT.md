# Open GrokBot for Hive and Atlas

An owner-operated agent workspace with persistent shared conversations, a cloud worker, configurable models, media tools, and remote MCP connections. The supplied light Grok Bot screenshot guides visual appearance; its example conversations are not real product data or authorization to send messages. No pixel-exact or xAI feature-parity claim is made.

## Current product

The default entry point is a task prompt with Ask anything, Create an image, and Create a video. Agent creation starts from role presets with filled instructions, optional names, named model menus, and progressively disclosed custom configuration. OpenAI GPT-6.1 Sol is the main-conversation default; GPT-6 requests use the Responses API path, including through Vercel AI Gateway. Supported OpenAI controls expose model power, thinking effort, and processing tier without guaranteeing speed or model access.

The default Agent lounge contains six agents: Coordinator and Builder (GPT-6.1 Sol), Researcher (Gemini 3.5 Flash), Writer (Claude Sonnet 4.6), Reviewer (GPT-6.1 Sol), and Runner (GPT-6 Luna). An OpenAI coordinator delegates to at most three named specialists, falling back to two if no handoff is requested, then synthesizes their shared-history results. Other rooms support 2–6 agents and bounded discussion rounds. These are implemented orchestration behaviors, not proof of successful live calls.

Messages accept up to four files and 3 MB combined: PNG/JPEG/WebP, PDF, UTF-8 text, MP3, and WAV. Input support depends on the selected model. Image/video output tools exist; live generation remains unverified. Run controls configure response length, temperature where supported, tool-step limits, rounds, and main-panel typeface. Inter Variable is self-hosted. Jobs persist, expose cancellation, and report worker readiness through a database heartbeat. Cancellation stops future execution but cannot undo an external action already completed.

## Connections

Remote Streamable HTTP MCP servers can be connected, discovered, enabled/disabled, and disconnected. Optional bearer tokens are encrypted server-side; tools are available only to agents with Plugins enabled. Public HTTPS endpoints are required. OAuth-only connections need a separate flow. Connecting enables tools that may read or change the external service.

The Connections panel also lists Hive/Atlas Vercel variable names and configuration states, never secret values. The current deployment preparation imported eight available values and inventories 177 names; protected variables that could not be exported remain Needs link. Inventory is not proof of service integration or credential validity.

## Deployment and verification

The active repository-root `vercel.json` defines a Next.js frontend, private Python container backend, internal service binding, and a persistent worker daemon. The authorized Atlas native PostgreSQL credential is configured for isolated `grokbot` state. Hive and Atlas configuration retain separate prefixes; secrets stay server-side and are not injected into sandboxes. The managed Vercel Sandbox adapter handles shell/files; Docker remains an alternative and Playwright browsing runs on the hosted backend.

At this documentation checkpoint, deployment from revision `f2e345` is building; there is no confirmed successful live runtime. Fifteen mocked-backend tests and the Next.js production build passed. Those checks do not verify production database connectivity, a live worker heartbeat, provider access, media generation, MCP tools, or sandbox execution. API/database/worker readiness are separate from successful model and tool calls. Cloud execution must continue without the user's laptop once the hosted services are deployed and verified.
