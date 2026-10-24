# Cypher production release gate

The canonical source is `sodikjonismoilov/VentureCruiter`. Release from the repository root with root `vercel.json`: frontend, private backend binding, and persistent agent worker. A Next.js build, Vercel READY state, or `/api/health` alone does not establish functional readiness. Preserve the existing canonical backend and PostgreSQL; never provision a replacement database for a release.

The canonical release owner stages and promotes. Other chats supply isolated commits and test evidence. Do not promote an older integration branch or move aliases during a release.

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
| `RELEASE_TEAM_ID`, `RELEASE_PROJECT_ID` | Intended existing team/project |
| `VERCEL_TOKEN` | Scoped metadata and promotion credential |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Protection bypass, if required |
| `RELEASE_SESSION_COOKIE` | Authorized test-account cookie for authenticated routes, if required |
| `RELEASE_REQUIRED_SERVICES` | Comma-separated flags; defaults to `model,model_control,backend_auth`; add `atlas_engine` when required by the release |

5. Run `node scripts/release-smoke.mjs` for read-only verification. It checks public pages, frontend identity and binding, backend process, database query, worker heartbeat under 90 seconds, API/worker release parity, required service configuration and bots/plugins/catalog/conversations contracts. Frontend, API and worker must report the exact candidate ID and SHA. It uses GET only, without task creation or model billing. The intentional `/login` redirect is validated exactly and never followed, so the old live build cannot satisfy candidate tests.
6. The canonical owner runs `node scripts/promote-release.mjs`. This validates local root Services/Daemons configuration and authenticated Vercel metadata (team lookup, project, canonical repo, SHA, immutable URL, production target, READY), then repeats live smoke before promoting **the exact tested ID**. No alias commands or mutable branch URL are used. Failed checks never invoke promotion. Investigate cold starts or worker convergence and rerun; do not weaken parity checks.
7. After promotion, rerun read-only smoke against each canonical alias with the same ID/SHA expectations. Verify a real task, plugin tool and voice flow with existing audit fixtures, and scan runtime errors. A failure requires the canonical owner to investigate or roll back; this gate does not choose rollback releases or move domains silently.

## Tests and remaining controls

`node --test scripts/release-smoke.test.mjs` covers the recorded HTTP-200/unconfigured outage, frontend-only configuration, wrong project/repo/commit, preview releases, alias substitution, stale or mismatched workers, failed DB, missing services, redirects, HTML in place of JSON and error payloads. Frontend tests execute the real provenance handler; backend cloud tests exercise HTTP runtime responses with persisted heartbeats. The release-contract workflow runs JavaScript checks without deployment credentials.

Configuration flags establish credentials are present, not provider acceptance. Real model/tool execution and consent checks remain necessary. Redis and unused MinIO settings remain optional.

This wrapper protects releases made through it. The canonical owner must enforce checks operationally or through Vercel Deployment Checks/branch policy and disable competing production auto-promotions. This commit does not change account policy, Git connection, project settings, database, or aliases. CI success alone does not test a deployed candidate.
