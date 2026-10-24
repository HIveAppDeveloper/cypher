import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { smoke, expectedFromEnv, headersFromEnv } from './release-smoke.mjs';

function check(ok, message) { if (!ok) throw new Error(message); }
export function validateDeployment(deployment, expected, env, { rollback = false } = {}) {
  check(deployment.id === expected.deploymentId, 'Deployment lookup returned another candidate');
  check(deployment.projectId === env.RELEASE_PROJECT_ID, 'Candidate belongs to another project');
  check(deployment.target === 'production' && deployment.readyState === 'READY', 'Candidate must be a staged production deployment in READY state');
  check(`https://${deployment.url}` === expected.url, 'Use the immutable candidate URL returned by Vercel');
  const meta = deployment.meta || {};
  check(meta.githubCommitSha === expected.commit, 'Vercel source commit differs from expected commit');
  const org = meta.githubCommitOrg || meta.githubOrg;
  const repo = meta.githubCommitRepo || meta.githubRepo;
  // The first owned-repository release can roll back to the exact verified
  // pre-migration build. This exception never accepts a new legacy candidate.
  const migrationRollback = rollback && deployment.id === 'dpl_H2PdKgtNyXzVyrQRe5HyuvfemkJP'
    && expected.commit === '2b2cec046aa6fcbf8197ecd6bf720acab6722198'
    && org === 'sodikjonismoilov' && repo === 'VentureCruiter';
  check((org === 'HIveAppDeveloper' && repo === 'cypher') || migrationRollback, 'Candidate is not from the canonical HIveAppDeveloper/cypher repository');
}
export function validateReleaseConfig(config) {
  check(config.services?.frontend?.root === 'frontend' && config.services?.backend?.root === 'backend', 'Release from the repository root with both frontend and backend services');
  check(config.services.frontend.bindings?.some(binding => binding.type === 'service' && binding.service === 'backend' && binding.env === 'BACKEND_INTERNAL_URL'), 'Frontend backend service binding is required');
  check(config.daemons?.['agent-worker']?.root === 'backend' && config.daemons['agent-worker'].command?.join(' ') === 'python -m app.worker_main', 'Persistent agent worker configuration is required');
}
export async function guardedPromote(env, { fetchImpl = fetch, smokeImpl = smoke, run = spawnSync, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 24 } = {}) {
  check(env.VERCEL_TOKEN && env.RELEASE_TEAM_ID && env.RELEASE_PROJECT_ID, 'Vercel token, intended team and project IDs are required');
  validateReleaseConfig(JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')));
  const expected = expectedFromEnv(env);
  const previous = { ...expected, deploymentId: env.RELEASE_PREVIOUS_DEPLOYMENT_ID, commit: env.RELEASE_PREVIOUS_COMMIT };
  const { validateExpected } = await import('./release-smoke.mjs');
  validateExpected(expected); validateExpected(previous);
  check(previous.deploymentId !== expected.deploymentId, 'A distinct known-good rollback deployment is required');
  const canonical = ['cypher-agent.vercel.app', 'open-grokbot.vercel.app'];
  async function api(path) {
    const endpoint = new URL(path, 'https://api.vercel.com');
    endpoint.searchParams.set('teamId', env.RELEASE_TEAM_ID);
    const response = await fetchImpl(endpoint, { headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    check(response.ok, 'Vercel release metadata lookup failed');
    return response.json();
  }
  async function assertAliases(deploymentId) {
    for (const host of canonical) {
      const alias = await api(`/v4/aliases/${host}`);
      check(alias.projectId === env.RELEASE_PROJECT_ID && alias.deploymentId === deploymentId, 'Canonical alias changed or belongs to another project; coordinate with release owner');
    }
  }
  validateDeployment(await api(`/v13/deployments/${expected.deploymentId}`), expected, env);
  const rollbackDeployment = await api(`/v13/deployments/${previous.deploymentId}`);
  previous.url = `https://${rollbackDeployment.url}`;
  validateDeployment(rollbackDeployment, previous, env, { rollback: true });
  await assertAliases(previous.deploymentId);
  const headers = headersFromEnv(env);
  // Vercel starts the new daemon only when this becomes the production deployment.
  // Preflight verifies candidate API/DB plus the exact still-active previous worker.
  const preflight = await smokeImpl(expected, { fetchImpl, headers, activeWorker: previous });
  check(preflight?.passed === true && preflight.phase === 'activation-preflight', 'Activation preflight did not pass');
  await assertAliases(previous.deploymentId); // Do not race a newer release.
  const execute = command => {
    const result = run('vercel', [command, command === 'promote' ? expected.deploymentId : previous.deploymentId, '--scope', env.RELEASE_TEAM_ID, '--yes'], { env, stdio: 'inherit', shell: false });
    check(!result.error && result.status === 0, `Vercel ${command} failed`);
  };
  execute('promote');
  try {
    const deadline = Date.now() + 120000;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const report = await smokeImpl(expected, { fetchImpl, headers });
        check(report?.passed === true && report.phase === 'full-stack' && report.candidate_worker_verified === true, 'Full-stack post-activation verification did not pass');
        await assertAliases(expected.deploymentId);
        for (const host of canonical) {
          const live = await smokeImpl({ ...expected, url: `https://${host}` }, { fetchImpl, headers });
          check(live?.passed === true && live.phase === 'full-stack' && live.candidate_worker_verified === true, 'Canonical live smoke did not pass');
        }
        return { ...report, activation_preflight: preflight, canonical_aliases: canonical };
      } catch (error) {
        if (attempt + 1 >= attempts || Date.now() >= deadline) throw error;
        await pause(5000);
      }
    }
    throw new Error('Worker activation verification exhausted');
  } catch {
    // Refuse to roll over a different release installed by another owner.
    await assertAliases(expected.deploymentId);
    execute('rollback');
    throw new Error('Release failed strict live checks; rollback requested for the verified previous deployment. Verify rollback convergence.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await guardedPromote(process.env), null, 2)); }
  catch { console.error('Release blocked. Verify intended project, source metadata, exact candidate readiness and required services.'); process.exitCode = 1; }
}
