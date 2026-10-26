# Internal specialists

Cypher's main agent retrieves relevant instructions automatically and decides
whether independent advice is useful. The user continues to talk to one main
agent. Existing enabled execution tools and account authorization remain with
the real Bot agent; an internal consultation has no external tools.

The catalog contains **10,000 composable profiles: 100 evidence domains × 100
distinct procedures**. These are reusable instructional profiles, not 10,000
independently trained or individually validated models. IDs such as
`python.concurrency-review`, `databases.migration-plan` and
`email-writing.rewrite` resolve on demand. Each profile combines a domain's
evidence/verification requirements with a concrete procedure and deliverable.

Only two relevant cards, capped at 2,400 characters total, are automatically
added to a task. Two small inverted indexes search the domain and procedure
axes; the runtime does not materialize 10,000 agents or send 10,000 schemas.
`search_specialist_skills` discovers additional recipes without a model call.
The main agent can use a recipe itself rather than paying for delegation.

`consult_specialist` accepts its existing specialty/task arguments or a
discovered `skill_id` and task. `consult_specialists` accepts one to three
independent assignments and runs at most two simultaneously. Both share three
unique consultations per task. Identical in-flight requests coalesce, repeated
results are reused only within the same tenant/task/bot context, and cancellation
closes provider calls. A consultation has a 45-second deadline including its
slot wait, a 768-output-token cap and low reasoning effort. All calls use the
existing gateway, allowance, usage accounting and configured fallback policy.
Failures return a safe limitation for the main agent to handle; there is no
recursive delegation or background retry loop.

Queued tasks reserve each unique consultation in the existing execution-step
ledger before inference. Reservations and completed results survive worker
retries. A lost or running receipt consumes its slot and is not reissued; the
main agent continues with its other evidence. Three reservations exhaust the
task's budget even after outer tool steps replay on a fresh worker. Uncertain
external-write recovery checks remain unchanged.

Routine automatic routes use low reasoning when no effort was selected.
Complex analysis, coding, planning and review retain their existing defaults.
Only a closed-set greeting in a fresh text-only conversation gets the existing
smaller execution route, a 256-output-token cap and no plugin discovery/tool
schemas. Voice, attachments, contextual replies, manual routing and explicit
model/effort choices do not take that fast path. A new user direction restores
the normal budget, enabled tools and relevant route.

Large real-Bot rooms expose up to eight relevant roster cards and use a lead
plus at most three useful handoffs rather than running every member. Explicit
named mentions retain existing routing behavior. Each selected real Bot still
runs its own configured agent loop and authorized tools; a room's membership
count is never presented as the number of agents that actually participated.

Each full Bot can keep five distinct profile IDs in its existing tenant-scoped
workspace settings. Automatic initial recipes are labeled as automatic; an
actual `choose_agent_skills` call records the agent's choice. Selection is an
idempotent metadata write under the normal write-approval policy and grants no
new tools or account access. Its supplemental prompt is capped at 6,000
characters. Fresh greeting and live-voice fast paths skip this extra load and
defer selection rather than adding setup calls before a spoken reply.

Public GitHub search/read tools are available to enabled browser, research or
GitHub categories. They use bounded credential-free GETs. Private repository
access, authenticated code search and writes use the existing tenant-owned
GitHub plugin grant and authorization checks. No all-repository permission is
inferred from a public read.

Run `python scripts/benchmark_specialists.py` from `backend/` for local retrieval
timing and context/cap measurements. This benchmark sends no model request and
does not measure end-to-end chat latency or billed savings. Lower token caps,
duplicate reuse, local retrieval and overlapping independent consultations
reduce avoidable work; production speed/cost still needs measured comparison
on the final release.

`GET /api/workspace/runs/metrics` separately exposes current-workspace task
latency aggregates without task text or IDs. Its response states the cohort,
cap, truncation, exclusions and sample counts; p99 is withheld below 100 valid
observations. Lifecycle runtime includes retries and approval waits. Existing
audio stages overlap and are not additive. Tool durations, standalone model
queue time and browser-to-play latency are not inferred from missing data.

The catalog creates no Bot rows or database schema. Skill choices use only the
existing settings table. No production environment or credential is changed.
Production promotion and exact frontend/API/worker validation
belong to the existing canonical release owner.
