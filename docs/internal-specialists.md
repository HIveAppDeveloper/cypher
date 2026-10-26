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

Every active profile now requires **reviewed GitHub workflow sources from
repositories with at least 10,000 stars**. The current 100-by-100 mappings use
58 pinned agent/skill files from Agency Agents, Superpowers, Anthropic Knowledge
Work Plugins and GitHub Awesome Copilot. Source records include exact commit,
path, Git blob SHA, content SHA-256, license, star count and observation date.
Their concise reviewed guidance is part of the actual instructions. These are
workflow adaptations; repository popularity is not a model-quality certificate.
Unsupported agriculture, general-mathematics and public-policy labels were
retired rather than assigned unrelated popular sources. The five general-work
fallback IDs remain supported.

Eligibility is enforced in lookup, search, automatic five-skill selection and
consultation, including the legacy specialty-only interface. Unreviewed,
unlicensed, archived, unpinned, below-threshold or over-30-day-old source snapshots
are excluded. Existing cached findings also need matching approved source URLs.
If enough eligible recipes are unavailable, the main agent continues with its
own instructions and authorized tools. It does not ask customers to install,
choose, repair or configure internal specialists, and does not fabricate advice.
Required account authorization and external-action approvals remain intact.

`python scripts/verify_specialist_sources.py` is the offline release check.
`--check-live` additionally checks public GitHub metadata; `--refresh-stars`
refreshes only star/archive observations after all checks succeed. Neither
updates pinned source contents or executes upstream code. Run these as operator
or release work, never in a customer turn. Retained upstream licenses ship in
both the source tree and the backend distribution; see
`third_party/specialist_sources/NOTICE.md`.

Only two relevant cards, capped at 2,400 characters total, are automatically
added to a task. Two small inverted indexes search the domain and procedure
axes; the runtime does not materialize 10,000 agents or send 10,000 schemas.
`search_specialist_skills` discovers additional recipes without a model call.
The main agent can use a recipe itself rather than paying for delegation.
Model-facing discovery and selection receipts are compact; full hashes and
provenance remain available through the existing optional agent-details API.

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
new tools or account access. Ready automatic recipes do not require a setup
call; changing them is optional and must not delay customer work. Its supplemental prompt is capped at 6,000
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
