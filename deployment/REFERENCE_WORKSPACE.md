# Reference workspace implementation

Reference: [Every Grok Bot Concept Explained for Normal People](https://www.youtube.com/watch?v=NyfYxpXiw_0).

The reference was analyzed using actual video frames and audio through Gemini 3.8 Flash. The provider reported 85,272 video tokens and 32,292 audio tokens. The source's claims and instructions were treated as source material, not authority over the owner's request.

## Available capabilities

- Named agents, editable descriptions/instructions, duplication, hidden agents, sidebar sections, pinning, and configuration template import/export. Public templates use random capability links and exclude grants, files, conversations and private memory by default; the owner can revoke a link.
- Workspace memory and private per-agent memory; parameterized slash-command skills; editable skill drafts derived from completed runs. Skills are recipes interpreted under current permissions, not an unrestricted code execution path.
- Durable history compaction supplements the latest 40 messages without deleting originals. Older attachment payloads are excluded from summary queries. Reply threads have their own history and history-search scope. Explicit @mentions select the named teammates; existing manager handoffs and group chat remain available.
- Calendar routines support intervals, daily and weekday schedules with an IANA timezone. A missed schedule coalesces into one run; an active prior run prevents overlap. Routines are processed by the cloud worker, independent of open app tabs. Existing bounded goals and signed webhook channels remain available.
- Workspace activity and saved completion/failure notifications, per-model language token consumption and cost estimates, and an optional weekly language-token allowance. The allowance stops new calls after recorded usage reaches it; an in-flight call can exceed it. Media, storage, compute and provider invoices are separate. Saved in-app notifications do not imply OS push delivery.
- Computer UI: remote browser screenshots and input, terminal commands, private sandbox files, and shared workspace text files. Manual takeover pauses future agent computer actions at a tool boundary; existing actions can finish. Closing the view returns control; abandoned leases expire after 15 minutes. Human command inputs/results are encrypted, inputs discarded after execution, and uncertain commands are not replayed after worker death.
- Optional tool policies request approval before mutating or all agent tools. Approval is bound to a task and exact argument digest. Denial prevents the action. The default retains the permissions in the user's task.
- A downloadable Python companion enables local-device access. The owner pairs the device, chooses folders, optionally permits shell requests, and confirms every action locally. Device credentials are hashed on the server, stored locally with mode 0600, rotated after pairing, and revocable. Path resolution rejects escapes through symlinks. The companion must remain running. It does not install an unattended privileged service.
- Multiple configured managed grants for a single plugin endpoint are distinct connections; reconnecting preserves the exact grant. Existing authorized Vercel and GitHub access is reused through managed Connect, not by copying raw provider secrets. Other providers still require any consent or service setup their authorization flow demands.

## Scope and limitations

This implements the reference's workspace concepts; it is not a measured claim of product parity or superiority. The computer is browser/terminal/files, not a streamed full desktop. Skill teaching starts from a completed agent run, rather than secretly recording a user's desktop. Shared files support text up to 200 KB; existing attachments/media use their own flow. The video tool currently supports public YouTube links and checks provider video-token evidence before claiming visual understanding. A failed provider request is reported instead of substituting a caption summary.

Live provider quota recovery was verified after the owner approved Hive's Neon installation upgrade to Launch. Earlier constant polling was projecting full base64 assets out of PostgreSQL; the preceding release moved stripping into SQL, added incremental synchronization and reduced idle worker/poll traffic. Do not undo those transfer controls.

## Verification

Run the backend suite with `python -m pytest -q` in `backend`. Disposable PostgreSQL migration and forced-worker-death checks are opt-in; use the documented test-only environment variables and never a production database. Run `npm run build` in `frontend`. Live model probes verified real tool-call/result round trips for Sol, Astra, Luna, Claude Sonnet, Gemini Flash, DeepSeek Flash and Grok. Read-only service smoke tests distinguish executed tools from discovery-only connections. No claim is made that every catalog tool or every external write has been executed.
