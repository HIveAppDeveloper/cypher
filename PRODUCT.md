# Open GrokBot for Hive and Atlas

An owner-operated agent workspace with persistent shared conversations, a cloud worker, configurable models, media tools, and remote MCP connections. The supplied light Grok Bot screenshot guides visual appearance; its example conversations are not real product data or authorization to send messages. No pixel-exact or xAI feature-parity claim is made.

## Current product

The default entry point is a task prompt with Ask anything, Create an image, and Create a video. Agent creation starts from role presets with filled instructions, optional names, named model menus, and progressively disclosed custom configuration. OpenAI GPT-6.1 Sol is the main-conversation default; GPT-6 requests use the Responses API path, including through Vercel AI Gateway. Supported OpenAI controls expose model power, thinking effort, and processing tier without guaranteeing speed or model access.

The default Agent lounge contains six agents: Coordinator and Builder (GPT-6.1 Sol), Researcher (Gemini 3.5 Flash), Writer (Claude Sonnet 4.6), Reviewer (GPT-6.1 Sol), and Runner (GPT-6 Luna). An OpenAI coordinator delegates to at most three named specialists, falling back to two if no handoff is requested, then synthesizes their shared-history results. Other rooms support 2–6 agents and bounded discussion rounds. A prior production check verified a real Luna → Gemini group job; that does not verify every coordinator/provider combination.

Messages accept up to four files and 3 MB combined: PNG/JPEG/WebP, PDF, UTF-8 text, MP3, and WAV. Input support depends on the selected model. Image/video output tools exist; prior production checks verified OpenAI PNG, Gemini JPEG, and Veo MP4 output. Run controls configure response length, temperature where supported, tool-step limits, rounds, and main-panel typeface. Inter Variable is self-hosted. Jobs persist, expose cancellation, and report worker readiness through a database heartbeat. Cancellation stops future execution but cannot undo an external action already completed.

## Appearance, goals, and channels

The light Grok identity now uses larger translucent glass select popovers, with Radix keyboard behavior, 48px general triggers, and 50px options. Browser-local preferences immediately adjust accent, message text size, desktop message width, glass blur, agent-list density, and interface motion. Inter Variable remains the default, with main-panel typeface controls. Preferences do not imply cross-device account synchronization.

Cloud goals persist in the database and schedule finite runs in the hosted worker. Each goal specifies an objective, evidence-based completion criteria, room, Sol/Luna manager, interval (minimum 15 minutes), and run allowance. The UI offers 1–20 runs and 15–1440 minute intervals; the API permits intervals up to seven days. Defaults are three runs, one hour apart. At most ten goals may be active. Completion requires the completion tool and a successful task. Pause cancels pending work or requests running-task cancellation; failed/interrupted work blocks further runs until explicit resume/retry. Exhausted or completed goals cannot be resumed. Agent-created follow-up goals are limited to three runs, one per task, with no nested goals.

Webhook channels accept authenticated, deduplicated external tasks into a chosen room and optionally deliver finished results through a signed HTTPS outbox. Limits are ten new events per channel per minute, a workspace queue cap of 20 pending/running tasks, and three outbound delivery attempts. Channel keys are displayed once; signed delivery and service authentication remain distinct. Public frontend endpoints remain subject to Vercel deployment protection. Channels do not create private-app OAuth connections or bypass external account permissions.

## Connections

Remote Streamable HTTP MCP servers can be connected, discovered, refreshed, enabled/disabled, and disconnected. Individual advertised tools have separate enable switches. Optional bearer tokens are encrypted server-side; tools are available only to agents with Plugins enabled. Public HTTPS endpoints are required. OAuth-only connections need a separate flow. Connecting enables tools that may read or change the external service.

The Connections panel also lists Hive/Atlas Vercel variable names and configuration states, never secret values. The current deployment preparation imported 43 available values (35 retrieved individually plus eight earlier) and inventories 177 names; protected variables that could not be exported remain Needs link. Inventory is not proof of service integration or credential validity.

## Deployment and verification

The active repository-root `vercel.json` defines a Next.js frontend, private Python container backend, internal service binding, and a persistent worker daemon. The authorized Atlas native PostgreSQL credential is configured for isolated `grokbot` state. Hive and Atlas configuration retain separate prefixes; secrets stay server-side and are not injected into sandboxes. The managed Vercel Sandbox adapter handles shell/files; Docker remains an alternative and Playwright browsing runs on the hosted backend.

Production revision b473 previously verified database/worker operation, generated OpenAI PNG, Gemini JPEG, and Veo MP4 media, and a real GPT-6 Luna → Gemini group job. DeepWiki tool invocation was also verified. The former free-credit restriction is historical and no longer describes the current verified capability. The new glass controls, appearance preferences, goals, channels, and per-plugin tool controls have passed source checks (31 backend tests and the frontend production build), but have not yet been verified live. Prior live results do not prove the new workflows or every model, provider, sandbox, or connected service.

## Team-thread behavior

The existing shared team conversation is the default arrival surface, with individual agent conversations still available. Managers receive concise teammate-style instructions: own the outcome, use tools, coordinate privately, verify results, and report concrete blockers. Model and media settings remain available through Message options. Work indicators reflect actual task state rather than simulated conversation. Start computer uses the Vercel SDK's persistent sandbox name, with connection feedback and a stop action.

## Simplified conversation controls
The composer shows attachments, text, and send. Recent work, retained context, steering, output, and model controls are under Settings in the top toolbar. The sidebar Plugins entry opens a catalog and a dedicated Add plugin form for remote MCP servers. An authenticated model-provider failure explains the server-side credential setup needed; UI changes do not establish valid provider credentials.

## Website-based plugin connections and workspace layout
A company website resolves against a 100-entry source-backed connector catalog, then falls back to an exact-domain match in the public MCP registry. Published Streamable HTTP endpoints can begin the pinned MCP SDK’s OAuth discovery and dynamic registration flow. Consent pauses durably in PostgreSQL; a browser-bound HttpOnly cookie, state, issuer, PKCE, expiry, and one-use callback protect completion. Access and refresh tokens are encrypted. A plugin becomes enabled only after tools are discovered. Some providers require keys, client registration approval, paid plans, or unsupported authentication; catalog inclusion is not a successful connection or a universal one-click guarantee. The public callback origin defaults to the production GrokBot hostname and is configurable with GROKBOT_PUBLIC_URL.

The sidebar resizes on desktop, docks left/right by drag or button, collapses to icons, and remembers the layout in this browser. Keyboard resizing and a collapse shortcut are available. Agents can be pinned and filtered by actual working status; search covers names, roles, descriptions, and room titles. These controls do not change model capabilities or provider permissions.
