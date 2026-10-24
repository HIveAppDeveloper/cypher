import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smoke, validateRuntime } from './release-smoke.mjs';
import { guardedPromote, validateReleaseConfig } from './promote-release.mjs';

const expected = { url: 'https://cypher-candidate-hiveapp.vercel.app', deploymentId: 'dpl_current', commit: 'a'.repeat(40), services: ['model', 'model_control', 'backend_auth'] };
const identity = { deployment_id: expected.deploymentId, commit: expected.commit, environment: 'production' };
function runtime() { return { connected: true, state: 'connected', database: true, worker: true, worker_version_matches: true, worker_last_seen_seconds: 2, deployment: { ...identity }, worker_deployment: { ...identity }, model_configured: true, configured_services: { model: true, model_control: true, backend_auth: true } }; }
function fixture(overrides = {}) {
  const responses = { '/': '<html>Cypher workspace</html>', '/login': '<html>Cypher sign in</html>', '/api/release': { ...identity, backend_bound: true }, '/api/health': { service: 'cypher', status: 'ok' }, '/api/runtime': runtime(), '/api/bots': [], '/api/plugins': [], '/api/plugins/catalog': [], '/api/conversations': [], ...overrides };
  const calls = [];
  const fetchImpl = async (url, options) => {
    assert.equal(new URL(url).origin, expected.url);
    assert.equal(options.redirect, 'manual');
    calls.push(new URL(url).pathname);
    const body = responses[new URL(url).pathname];
    return body instanceof Response ? body : typeof body === 'string' ? new Response(body, { headers: { 'content-type': 'text/html' } }) : Response.json(body);
  };
  return { fetchImpl, calls };
}
test('exact staged candidate verifies the public app, backend, DB, worker and service contracts', async () => {
  const app = fixture();
  const result = await smoke(expected, app);
  assert.equal(result.passed, true);
  assert.deepEqual(app.calls, ['/', '/login', '/api/release', '/api/health', '/api/runtime', '/api/bots', '/api/plugins', '/api/plugins/catalog', '/api/conversations']);
});
test('recorded outage cannot pass HTTP 200 runtime or frontend READY', async () => {
  const app = fixture({ '/api/runtime': { connected: false, state: 'unconfigured' } });
  await assert.rejects(smoke(expected, app), /not connected/);
});
for (const [name, mutate] of [
  ['database unavailable', r => r.database = false],
  ['stale worker', r => r.worker_last_seen_seconds = 90],
  ['negative heartbeat', r => r.worker_last_seen_seconds = -1],
  ['unknown version parity', r => r.worker_version_matches = null],
  ['old worker deployment', r => r.worker_deployment.deployment_id = 'dpl_old'],
  ['worker commit mismatch despite matching deployment', r => r.worker_deployment.commit = 'b'.repeat(40)],
  ['backend commit mismatch', r => r.deployment.commit = 'b'.repeat(40)],
  ['preview environment', r => r.deployment.environment = 'preview'],
  ['missing service configuration', r => delete r.configured_services],
  ['missing model control', r => r.configured_services.model_control = false],
  ['missing inference', r => r.model_configured = false],
]) test(name + ' blocks release', () => { const r = runtime(); mutate(r); assert.throws(() => validateRuntime(r, expected)); });
for (const [name, overrides] of [
  ['missing binding', { '/api/release': { ...identity, backend_bound: false } }],
  ['wrong frontend release', { '/api/release': { ...identity, deployment_id: 'dpl_old', backend_bound: true } }],
  ['public route 503', { '/api/plugins': new Response('private-upstream-secret', { status: 503 }) }],
  ['auth redirect', { '/api/bots': new Response('', { status: 307, headers: { location: 'https://elsewhere.invalid' } }) }],
  ['HTML login in place of JSON', { '/api/bots': '<html>Sign in</html>' }],
  ['error-shaped JSON with HTTP 200', { '/api/conversations': { detail: 'database failed' } }],
]) test(name + ' blocks candidate smoke', async () => { await assert.rejects(smoke(expected, fixture(overrides)), error => !error.message.includes('private-upstream-secret')); });

const env = { RELEASE_URL: expected.url, RELEASE_DEPLOYMENT_ID: expected.deploymentId, RELEASE_COMMIT: expected.commit, RELEASE_TEAM_ID: 'team_intended', RELEASE_PROJECT_ID: 'prj_intended', VERCEL_TOKEN: 'private-token' };
function deployment() { return { id: expected.deploymentId, url: new URL(expected.url).host, projectId: env.RELEASE_PROJECT_ID, target: 'production', readyState: 'READY', meta: { githubCommitSha: expected.commit, githubCommitOrg: 'sodikjonismoilov', githubCommitRepo: 'VentureCruiter' } }; }
function promotionFixture(change = () => {}, smokeImpl = async () => ({ passed: true })) {
  const meta = deployment(); change(meta);
  const calls = [];
  return { calls, fetchImpl: async (url, options) => {
    assert.equal(new URL(url).searchParams.get('teamId'), env.RELEASE_TEAM_ID);
    assert.equal(options.headers.Authorization, 'Bearer private-token');
    return Response.json(meta);
  }, smokeImpl, run: (...args) => { calls.push(args); return { status: 0 }; } };
}
for (const [name, change] of [
  ['wrong project', d => d.projectId = 'prj_other'],
  ['old repository', d => d.meta.githubCommitOrg = 'HIveAppDeveloper'],
  ['missing provenance', d => d.meta = {}],
  ['old commit', d => d.meta.githubCommitSha = 'b'.repeat(40)],
  ['preview rebuild', d => d.target = 'preview'],
  ['mutable alias URL', d => d.url = 'cypher-agent.vercel.app'],
]) test(name + ' never invokes promotion', async () => { const f = promotionFixture(change); await assert.rejects(guardedPromote(env, f)); assert.equal(f.calls.length, 0); });
test('failed smoke never invokes promotion', async () => {
  const f = promotionFixture(() => {}, async () => { throw new Error('worker stale'); });
  await assert.rejects(guardedPromote(env, f), /worker stale/);
  assert.equal(f.calls.length, 0);
});
test('promotion uses precisely the tested deployment ID after smoke succeeds', async () => {
  let checked;
  const f = promotionFixture(() => {}, async e => { checked = e; return { passed: true }; });
  await guardedPromote(env, f);
  assert.equal(checked.deploymentId, expected.deploymentId);
  assert.deepEqual(f.calls[0].slice(0, 2), ['vercel', ['promote', expected.deploymentId, '--scope', env.RELEASE_TEAM_ID, '--yes']]);
  assert.equal(f.calls[0][2].shell, false);
});


test('intentional candidate login redirect is checked without following it or sending a session', async () => {
  const app = fixture({ '/login': new Response('', { status: 307, headers: { location: 'https://cypher-agent.vercel.app/login' } }) });
  const fetchImpl = async (url, options) => {
    if (new URL(url).pathname === '/login') assert.equal(options.headers.Cookie, undefined);
    else assert.equal(options.headers.Cookie, 'private-session');
    return app.fetchImpl(url, options);
  };
  assert.equal((await smoke(expected, { fetchImpl, headers: { Cookie: 'private-session' } })).passed, true);
});
test('arbitrary login redirect is rejected', async () => {
  await assert.rejects(smoke(expected, fixture({ '/login': new Response('', { status: 307, headers: { location: 'https://old-release.invalid/login' } }) })), /unexpected canonical redirect/);
});
test('frontend-only effective source config fails before release', () => {
  assert.throws(() => validateReleaseConfig({ framework: 'nextjs' }), /repository root/);
  const config = { services: { frontend: { root: 'frontend', bindings: [{ type: 'service', service: 'backend', env: 'BACKEND_INTERNAL_URL' }] }, backend: { root: 'backend' } }, daemons: { 'agent-worker': { root: 'backend', command: ['python', '-m', 'app.worker_main'] } } };
  validateReleaseConfig(config);
  delete config.daemons;
  assert.throws(() => validateReleaseConfig(config), /worker/);
});
