# Cypher production release gate

The canonical source is `HIveAppDeveloper/cypher`. Release from the repository root with root `vercel.json`: frontend, private backend binding, and persistent agent worker. A Next.js build, Vercel READY state, or `/api/health` alone does not establish functional readiness. Preserve the existing canonical backend and PostgreSQL; never provision a replacement database for a release.

The canonical release owner stages and promotes. Other chats supply isolated commits and test evidence. Do not promote an older integration branch or move aliases during a release.

The existing owned repository was renamed from `HIveAppDeveloper/open-grokbot` to `HIveAppDeveloper/cypher`; its history is preserved. Git-triggered deployments are disabled in `vercel.json`, so a source push does not replace the tested production release. Explicit CLI staging and this promotion gate remain the release path. No Vercel project binding or production database is replaced by the repository rename.

For the first release after this source migration only, the gate accepts the exact verified rollback `dpl_H2PdKgtNyXzVyrQRe5HyuvfemkJP` / `2b2cec046aa6fcbf8197ecd6bf720acab6722198` with its historical VentureCruiter metadata. New candidates must identify `HIveAppDeveloper/cypher`; arbitrary builds from the old repository remain rejected.

## Stage and test the exact build

1. Integrate reviewed commits into a clean canonical checkout. Confirm intended team/project, source SHA and root Services/Daemons configuration. Use the shared canonical runtime manifest when present.
2. Stage production without assigning domains: `vercel deploy --prod --skip-domain --scope <intended-team>`. Use a reviewed installed CLI. Promoting a preview may rebuild it with different environment variables.
3. Confirm candidate metadata identifies the canonical repository and full source SHA. Git deployments supply these fields. For authorized CLI releases attach reviewed `githubCommitSha`, `githubOrg`, `githubRepo` metadata, and supply `VERCEL_GIT_COMMIT_SHA` consistently to frontend, backend, worker. All three runtimes must also receive `VERCEL_DEPLOYMENT_ID` and `VERCEL_ENV`. Missing provenance blocks the gate; never fabricate it for a dirty/unrelated checkout.
4. Load the following variables in a protected release environment. Credentials must not be command arguments or evidence-file contents.

| Variable | Meaning |
| --- | --- |
| `RELEASE_URL` | Exact immutable candidate origin returned by Vercel, no trailing slash |
| `RELEASE_DEPLOYMENT_ID` | Exact candidate `dpl_…` |
| `RELEASE_COMMIT` | Reviewed full 40-character SHA |
| `RELEASE_PREVIOUS_DEPLOYMENT_ID`, `RELEASE_PREVIOUS_COMMIT` | Explicit current known-good deployment and full SHA for activation preflight and rollback |
| `RELEASE_TEAM_ID`, `RELEASE_PROJECT_ID` | Intended existing team/project |
| `VERCEL_TOKEN` | Scoped metadata and promotion credential |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Protection bypass, if required |
| `RELEASE_SESSION_COOKIE` | Authorized test-account cookie for authenticated routes, if required |
| `RELEASE_REQUIRED_SERVICES` | Comma-separated flags; defaults to `model,model_control,backend_auth`; add `atlas_engine` when required by the release |

5. `node scripts/release-smoke.mjs` always performs strict full-stack verification. It checks public pages, frontend identity and binding, backend process, database query, worker heartbeat under 90 seconds, API/worker release parity, required services and bots/plugins/catalog/conversations. It never certifies an old worker as the new worker. It uses GET only. The intentional `/login` redirect is checked without following it or sending a session cookie.
6. Vercel activates Daemons **when a deployment becomes production**, not while it is merely staged with `--skip-domain`. This is documented in [How daemons work](https://vercel.com/docs/daemons#how-daemons-work) and [Deploying changes to a daemon](https://vercel.com/docs/daemons/managing-daemons#deploying-changes-to-a-daemon). Exact candidate worker parity is therefore a post-activation condition. The strict standalone smoke may intentionally fail on a staged build.
7. The canonical owner runs `node scripts/promote-release.mjs` for explicit two-phase activation. It verifies root Services/Daemons, intended team/project and canonical repo, exact candidate and rollback metadata, and both canonical aliases on the specified previous deployment. The activation preflight requires the candidate frontend/API/DB/services/routes to pass and a fresh worker with the **exact previous active deployment ID and SHA**. Its report is labeled `activation-preflight` with `candidate_worker_verified:false`; it is not a full-stack pass.
8. The wrapper rechecks aliases, promotes the exact candidate ID, and waits for strict candidate worker parity and live smoke on both canonical aliases. It retries at five-second intervals, at most 24 attempts and a 120-second convergence deadline evaluated between requests (individual requests retain bounded timeouts). No successful release result is returned before strict checks pass. On failure it requests rollback to the verified previous deployment, provided aliases still identify the candidate. If another release has replaced it, rollback is refused to avoid overriding that release. Rollback convergence still requires owner verification; the script never claims an unverified rollback is healthy.
9. Verify a real task, plugin tool and voice flow with existing audit fixtures, and scan runtime errors. Keep the same PostgreSQL; no database migration or environment rewriting is performed. During the daemon grace period old and new versions can briefly coexist, so preserve queue/schema compatibility. No rollout phase substitutes READY for functional health.

## Tests and remaining controls

`node --test scripts/release-smoke.test.mjs` covers the recorded HTTP-200/unconfigured outage, frontend-only configuration, wrong project/repo/commit, preview releases, alias substitution, stale or mismatched workers, failed DB, missing services, redirects, HTML in place of JSON and error payloads. Frontend tests execute the real provenance handler; backend cloud tests exercise HTTP runtime responses with persisted heartbeats. The release-contract workflow runs JavaScript checks without deployment credentials. Additional tests cover fresh previous-worker preflight, strict post-activation convergence, exact rollback, mandatory rollback identity and refusal to overwrite a concurrent release.

Configuration flags establish credentials are present, not provider acceptance. Real model/tool execution and consent checks remain necessary. Redis and unused MinIO settings remain optional.

This wrapper protects releases made through it. The canonical owner must enforce checks operationally or through Vercel Deployment Checks/branch policy and disable competing production auto-promotions. This commit does not change account policy, Git connection, project settings, database, or aliases. CI success alone does not test a deployed candidate.

## Content-free diagnostics for the next planned gate

The existing requests now retain one diagnostic row each: relative route path, monotonic `elapsed_ms` (request through body parsing, capped at one hour), numeric HTTP status when received, and a format-validated `x-vercel-id` as `vercel_id`. Exceptions retain only an allowlisted name/code and phase (`fetch`, `body`, or `response`); unknown names become `UnknownError`, unknown codes are omitted as null. Raw exception messages, causes/stacks, origins, URLs/queries, cookies, keys, full headers and response/user content are never copied into diagnostic rows. Malformed request IDs/provenance values are labeled `invalid` rather than echoed.

Only `/api/release` and `/api/runtime` add provenance snapshots: expected versus actual public deployment ID, full SHA and environment. Runtime snapshots distinguish the candidate API from the explicitly specified currently active worker during activation preflight. Missing values remain null. These diagnostics do not establish that a timeout was caused by a database outage or cold start.

Successful smoke reports include the rows in `routes`; failures expose the safe partial rows as `error.diagnostics`, and the standalone CLI prints those rows on failure. For an existing retry/check script, retain `error.diagnostics` alongside its existing safe failure label. Alternatively pass an optional synchronous `onDiagnostic(row)` sink to `smoke` or `guardedPromote`; each row is detached before delivery, and observer errors cannot change readiness outcomes. Keep the sink bounded to the existing attempt limit; it must not start requests or jobs.

The browser adapter may attach optional numeric `releaseTimings = { in_page_fetch_ms, bridge_ms }` to its returned Response or thrown error. Only finite nonnegative numbers up to one hour survive. `in_page_fetch_ms` is the duration actually measured inside the page (include body completion if that is what was measured); leave it absent if unavailable. `bridge_ms` is the whole outer SDK/adapter round trip and includes in-page work. These are relative durations, not synchronized cross-process timestamps or proof of a particular failure cause.

To measure the existing adapter without changing its request, options, timeout, result, error or call count:

```js
import { smoke, withBridgeTiming } from './scripts/release-smoke.mjs';
const result = await smoke(expected, {
  fetchImpl: withBridgeTiming(existingBrowserFetchAdapter),
  onDiagnostic: row => existingBoundedEvidence.push(row),
});
```

The wrapper preserves any available allowlisted in-page timing and adds the measured bridge duration. It tolerates frozen response/error objects by leaving timing absent. Do not substitute a new browser fetch mechanism, change the adapter's existing timeout, or add a page evaluation/probe to obtain optional timings. Use this instrumentation only on the release owner's **next already-planned bounded check**, not as an additional sweep.

All readiness rules, paths, redirects, 35-second request budgets, 24-attempt/120-second activation logic, five-second retry pauses, worker freshness/version requirements, alias guards and exact rollback behavior are unchanged. The diagnostics follow-up changes tooling only and does not modify application health timeouts, runtime environment, production aliases or PostgreSQL.
