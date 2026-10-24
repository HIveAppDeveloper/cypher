import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smoke, validateRuntime } from './release-smoke.mjs';
import { guardedPromote, validateDeployment, validateReleaseConfig } from './promote-release.mjs';

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

const env = { RELEASE_URL: expected.url, RELEASE_DEPLOYMENT_ID: expected.deploymentId, RELEASE_COMMIT: expected.commit, RELEASE_TEAM_ID: 'team_intended', RELEASE_PROJECT_ID: 'prj_intended', VERCEL_TOKEN: 'private-token', RELEASE_PREVIOUS_DEPLOYMENT_ID: 'dpl_previous', RELEASE_PREVIOUS_COMMIT: 'b'.repeat(40) };
function deployment() { return { id: expected.deploymentId, url: new URL(expected.url).host, projectId: env.RELEASE_PROJECT_ID, target: 'production', readyState: 'READY', meta: { githubCommitSha: expected.commit, githubCommitOrg: 'HIveAppDeveloper', githubCommitRepo: 'cypher' } }; }
function promotionFixture(change = () => {}, smokeImpl = async (_expected, options) => ({ passed: true, phase: options.activeWorker ? 'activation-preflight' : 'full-stack', candidate_worker_verified: !options.activeWorker })) {
  const meta = deployment(); change(meta);
  const calls = [];
  let active = env.RELEASE_PREVIOUS_DEPLOYMENT_ID;
  return { calls, attempts: 2, pause: async () => {}, fetchImpl: async (url, options) => {
    assert.equal(new URL(url).searchParams.get('teamId'), env.RELEASE_TEAM_ID);
    assert.equal(options.headers.Authorization, 'Bearer private-token');
    if (new URL(url).pathname.includes('/aliases/')) return Response.json({ projectId: env.RELEASE_PROJECT_ID, deploymentId: active });
    if (new URL(url).pathname.endsWith(env.RELEASE_PREVIOUS_DEPLOYMENT_ID)) return Response.json({ ...deployment(), id: env.RELEASE_PREVIOUS_DEPLOYMENT_ID, url: 'cypher-previous-hiveapp.vercel.app', meta: { ...deployment().meta, githubCommitSha: env.RELEASE_PREVIOUS_COMMIT } });
    return Response.json(meta);
  }, smokeImpl, run: (...args) => { calls.push(args); active = args[1][0] === 'promote' ? expected.deploymentId : env.RELEASE_PREVIOUS_DEPLOYMENT_ID; return { status: 0 }; } };
}
for (const [name, change] of [
  ['wrong project', d => d.projectId = 'prj_other'],
  ['old repository', d => { d.meta.githubCommitOrg = 'sodikjonismoilov'; d.meta.githubCommitRepo = 'VentureCruiter'; }],
  ['missing provenance', d => d.meta = {}],
  ['old commit', d => d.meta.githubCommitSha = 'b'.repeat(40)],
  ['preview rebuild', d => d.target = 'preview'],
  ['mutable alias URL', d => d.url = 'cypher-agent.vercel.app'],
]) test(name + ' never invokes promotion', async () => { const f = promotionFixture(change); await assert.rejects(guardedPromote(env, f)); assert.equal(f.calls.length, 0); });

test('only the exact verified pre-migration build is accepted as a legacy rollback', () => {
  const previous = { ...expected, url: 'https://cypher-ocb3x936n-hiveapp.vercel.app', deploymentId: 'dpl_H2PdKgtNyXzVyrQRe5HyuvfemkJP', commit: '2b2cec046aa6fcbf8197ecd6bf720acab6722198' };
  const legacy = { ...deployment(), id: previous.deploymentId, url: new URL(previous.url).host,
    meta: { githubCommitSha: previous.commit, githubOrg: 'sodikjonismoilov', githubRepo: 'VentureCruiter' } };
  assert.throws(() => validateDeployment(legacy, previous, env), /canonical/);
  assert.doesNotThrow(() => validateDeployment(legacy, previous, env, { rollback: true }));
  assert.throws(() => validateDeployment({ ...legacy, id: 'dpl_other' }, { ...previous, deploymentId: 'dpl_other' }, env, { rollback: true }), /canonical/);
  assert.throws(() => validateDeployment({ ...legacy, meta: { ...legacy.meta, githubCommitSha: 'c'.repeat(40) } }, { ...previous, commit: 'c'.repeat(40) }, env, { rollback: true }), /canonical/);
});
test('failed smoke never invokes promotion', async () => {
  const f = promotionFixture(() => {}, async () => { throw new Error('worker stale'); });
  await assert.rejects(guardedPromote(env, f), /worker stale/);
  assert.equal(f.calls.length, 0);
});
test('promotion uses precisely the tested deployment ID after smoke succeeds', async () => {
  let checked;
  const f = promotionFixture(() => {}, async (e, options) => { checked = e; return { passed: true, phase: options.activeWorker ? 'activation-preflight' : 'full-stack', candidate_worker_verified: !options.activeWorker }; });
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


test('activation preflight verifies the exact existing worker without certifying candidate worker', async () => {
  const r = runtime(); r.worker = false; r.worker_version_matches = false;
  const previous = { deploymentId: env.RELEASE_PREVIOUS_DEPLOYMENT_ID, commit: env.RELEASE_PREVIOUS_COMMIT };
  r.worker_deployment = { deployment_id: previous.deploymentId, commit: previous.commit, environment: 'production' };
  assert.throws(() => validateRuntime(r, expected), /Worker/);
  validateRuntime(r, expected, { activeWorker: previous });
  const report = await smoke(expected, { ...fixture({ '/api/runtime': r }), activeWorker: previous });
  assert.equal(report.phase, 'activation-preflight');
  assert.equal(report.candidate_worker_verified, false);
  assert.throws(() => validateRuntime(r, expected, { activeWorker: { ...previous, deploymentId: 'dpl_unrelated' } }), /differs/);
  r.worker_last_seen_seconds = 90;
  assert.throws(() => validateRuntime(r, expected, { activeWorker: previous }), /stale/);
});
test('activation waits for strict candidate worker and then verifies both canonical aliases', async () => {
  const seen = []; let postAttempts = 0;
  const f = promotionFixture(() => {}, async (e, options) => {
    seen.push({ url: e.url, preflight: !!options.activeWorker });
    if (options.activeWorker) return { passed: true, phase: 'activation-preflight' };
    if (postAttempts++ === 0) throw new Error('old worker still draining');
    return { passed: true, phase: 'full-stack', candidate_worker_verified: true };
  });
  await guardedPromote(env, f);
  assert.deepEqual(seen.slice(-2).map(s => s.url), ['https://cypher-agent.vercel.app', 'https://open-grokbot.vercel.app']);
  assert.deepEqual(f.calls.map(c => c[1][0]), ['promote']);
});
test('strict post-activation failure rolls back the exact verified previous deployment', async () => {
  const f = promotionFixture(() => {}, async (_e, options) => {
    if (options.activeWorker) return { passed: true, phase: 'activation-preflight' };
    throw new Error('new worker never starts');
  });
  await assert.rejects(guardedPromote(env, f), /rollback requested/);
  assert.deepEqual(f.calls.map(c => c[1].slice(0, 2)), [['promote', expected.deploymentId], ['rollback', env.RELEASE_PREVIOUS_DEPLOYMENT_ID]]);
});
test('missing explicit rollback identity blocks all mutations', async () => {
  const f = promotionFixture();
  await assert.rejects(guardedPromote({ ...env, RELEASE_PREVIOUS_DEPLOYMENT_ID: undefined }, f), /deployment ID/);
  assert.equal(f.calls.length, 0);
});
test('a concurrent different release prevents rollback over its aliases', async () => {
  const f = promotionFixture(() => {}, async (_e, options) => {
    if (options.activeWorker) return { passed: true, phase: 'activation-preflight' };
    throw new Error('new worker failed');
  });
  const fetchOriginal = f.fetchImpl;
  f.fetchImpl = async (url, options) => {
    if (f.calls.length && new URL(url).pathname.includes('/aliases/')) return Response.json({ projectId: env.RELEASE_PROJECT_ID, deploymentId: 'dpl_concurrent' });
    return fetchOriginal(url, options);
  };
  await assert.rejects(guardedPromote(env, f), /Canonical alias changed/);
  assert.deepEqual(f.calls.map(c => c[1][0]), ['promote']);
});
