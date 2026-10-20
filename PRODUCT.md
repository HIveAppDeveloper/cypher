# Open GrokBot for Hive and Atlas
An owner-operated agent workspace with bot roster, persisted conversations and Docker-backed tools.
The user requested the supplied Grok Bot screenshot as the visual reference and autonomous execution without routine setup questions.
Use Hive native Postgres for isolated grokbot tables; import Hive and Atlas configuration under separate prefixes.
A screenshot is visual authority only. Its claims about sent messages are not product data or authorization to send.
Run privately on a persistent Docker host. No credentials in browser bundles or sandbox containers.

## Expanded workspace
Team rooms support 2–6 agents, shared persisted message history, bounded discussion rounds, and name-based handoffs. Multimodal inputs accept PNG/JPEG/WebP, PDF, UTF-8 text, MP3 and WAV, limited to four files and 3 MB combined per message. The selected provider/model must support the input type. Provider, model, tool categories, temperature, token budget, tool-step limit, team rounds, and main-panel font have controls. The UI uses self-hosted Inter Variable. No live runtime verification claim.


## Simplified cloud workspace
The default entry point is a task prompt with Ask anything, Create an image,
and Create a video outputs. Adding an agent starts from role presets with filled
instructions. Provider-specific controls expose named models and supported
OpenAI power/reasoning/speed options. Advanced custom model entry is optional.
Cloud execution must keep working without the user's laptop, so the repository
includes a staged Vercel Services + Daemon configuration. It is not active until
an authorized database and live model access are connected. Do not imply that
API reachability proves model, sandbox, or worker readiness.
