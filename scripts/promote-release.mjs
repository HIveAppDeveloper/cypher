import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { smoke, expectedFromEnv, headersFromEnv } from './release-smoke.mjs';

function check(ok, message) { if (!ok) throw new Error(message); }
export function validateDeployment(deployment, expected, env) {
  check(deployment.id === expected.deploymentId, 'Deployment lookup returned another candidate');
  check(deployment.projectId === env.RELEASE_PROJECT_ID, 'Candidate belongs to another project');
  check(deployment.target === 'production' && deployment.readyState === 'READY', 'Candidate must be a staged production deployment in READY state');
  check(`https://${deployment.url}` === expected.url, 'Use the immutable candidate URL returned by Vercel');
  const meta = deployment.meta || {};
  check(meta.githubCommitSha === expected.commit, 'Vercel source commit differs from expected commit');
  check((meta.githubCommitOrg || meta.githubOrg) === 'sodikjonismoilov' && (meta.githubCommitRepo || meta.githubRepo) === 'VentureCruiter', 'Candidate is not from the canonical VentureCruiter repository');
}
export function validateReleaseConfig(config) {
  check(config.services?.frontend?.root === 'frontend' && config.services?.backend?.root === 'backend', 'Release from the repository root with both frontend and backend services');
  check(config.services.frontend.bindings?.some(binding => binding.type === 'service' && binding.service === 'backend' && binding.env === 'BACKEND_INTERNAL_URL'), 'Frontend backend service binding is required');
  check(config.daemons?.['agent-worker']?.root === 'backend' && config.daemons['agent-worker'].command?.join(' ') === 'python -m app.worker_main', 'Persistent agent worker configuration is required');
}
export async function guardedPromote(env, { fetchImpl = fetch, smokeImpl = smoke, run = spawnSync } = {}) {
  check(env.VERCEL_TOKEN && env.RELEASE_TEAM_ID && env.RELEASE_PROJECT_ID, 'Vercel token, intended team and project IDs are required');
  validateReleaseConfig(JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')));
  const expected = expectedFromEnv(env);
  // Validate inputs before any network call or child process.
  const { validateExpected } = await import('./release-smoke.mjs');
  validateExpected(expected);
  const endpoint = new URL(`https://api.vercel.com/v13/deployments/${expected.deploymentId}`);
  endpoint.searchParams.set('teamId', env.RELEASE_TEAM_ID);
  const response = await fetchImpl(endpoint, { headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  check(response.ok, 'Vercel candidate metadata lookup failed');
  const deployment = await response.json();
  validateDeployment(deployment, expected, env);
  const report = await smokeImpl(expected, { fetchImpl, headers: headersFromEnv(env) });
  check(report?.passed === true, 'Candidate smoke verification did not pass');
  // No aliases and no mutable branch URL: promote precisely the tested production build.
  const result = run('vercel', ['promote', expected.deploymentId, '--scope', env.RELEASE_TEAM_ID, '--yes'], { env, stdio: 'inherit', shell: false });
  check(!result.error && result.status === 0, 'Vercel promotion failed');
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await guardedPromote(process.env), null, 2)); }
  catch { console.error('Release blocked. Verify intended project, source metadata, exact candidate readiness and required services.'); process.exitCode = 1; }
}
