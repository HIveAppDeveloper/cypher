import { pathToFileURL } from 'node:url';

function check(ok, message) { if (!ok) throw new Error(message); }
export function validateExpected(expected) {
  check(/^dpl_[A-Za-z0-9]+$/.test(expected.deploymentId || ''), 'Expected deployment ID is required');
  check(/^[a-f0-9]{40}$/.test(expected.commit || ''), 'Expected full commit SHA is required');
  const url = new URL(expected.url);
  check(url.protocol === 'https:' && url.origin === expected.url && !url.username && !url.password, 'Use the exact HTTPS candidate origin');
  check(Array.isArray(expected.services) && expected.services.length > 0, 'Required services must be explicit');
}
export function validateRuntime(runtime, expected, { activeWorker } = {}) {
  check(runtime.connected === true && runtime.state === 'connected', 'Frontend is not connected to the backend');
  check(runtime.database === true, 'Database query did not succeed');
  check(activeWorker ? runtime.worker === false && runtime.worker_version_matches === false : runtime.worker === true && runtime.worker_version_matches === true, 'Worker is unavailable or belongs to another release');
  check(Number.isInteger(runtime.worker_last_seen_seconds) && runtime.worker_last_seen_seconds >= 0 && runtime.worker_last_seen_seconds < 90, 'Worker heartbeat is stale or invalid');
  for (const key of ['deployment', 'worker_deployment']) {
    const identity = key === 'worker_deployment' && activeWorker ? activeWorker : expected;
    check(runtime[key]?.deployment_id === identity.deploymentId, `${key} deployment ID differs from candidate`);
    check(runtime[key]?.commit === identity.commit, `${key} commit differs from candidate`);
    check(runtime[key]?.environment === 'production', `${key} was not staged for production`);
  }
  check(runtime.model_configured === true, 'Model inference is unconfigured');
  for (const service of expected.services) check(runtime.configured_services?.[service] === true, `Required service is unconfigured: ${service}`);
}

export async function smoke(expected, { fetchImpl = fetch, headers = {}, activeWorker } = {}) {
  validateExpected(expected);
  if (activeWorker) {
    validateExpected({ ...expected, ...activeWorker });
    check(activeWorker.deploymentId !== expected.deploymentId, 'Activation preflight requires the distinct current production worker');
  }
  const rows = [];
  async function get(path, json = true, publicLogin = false) {
    let response;
    try {
      response = await fetchImpl(new URL(path, expected.url), {
        headers: { ...Object.fromEntries(Object.entries(headers).filter(([key]) => !publicLogin || key.toLowerCase() !== 'cookie')), 'Cache-Control': 'no-cache' }, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(35000),
      });
    } catch { throw new Error(`${path}: request failed or timed out`); }
    if (publicLogin && [307, 308].includes(response.status)) {
      check(response.headers.get('location') === 'https://cypher-agent.vercel.app/login', '/login: unexpected canonical redirect');
      rows.push({ path, status: response.status, canonical_redirect: true });
      return null; // Never follow the redirect and accidentally test the old release.
    }
    check(response.status === 200, `${path}: expected HTTP 200, got ${response.status}`);
    check((response.headers.get('content-type') || '').includes(json ? 'application/json' : 'text/html'), `${path}: unexpected content type`);
    const body = json ? await response.json().catch(() => null) : await response.text();
    check(body !== null, `${path}: invalid JSON`);
    rows.push({ path, status: response.status });
    return body;
  }
  // Exercise public routing, not backend-only /health or a deployment READY flag.
  for (const path of ['/', '/login']) {
    const html = await get(path, false, path === '/login');
    check(html === null || /cypher/i.test(html), `${path}: Cypher page is missing`);
  }
  const release = await get('/api/release');
  check(release.deployment_id === expected.deploymentId && release.commit === expected.commit && release.environment === 'production', 'Frontend provenance differs from candidate');
  check(release.backend_bound === true, 'Frontend backend binding is missing');
  const health = await get('/api/health');
  check(health.service === 'cypher' && health.status === 'ok', 'Backend process health failed');
  const runtime = await get('/api/runtime');
  validateRuntime(runtime, expected, { activeWorker });
  for (const path of ['/api/bots', '/api/plugins', '/api/plugins/catalog', '/api/conversations']) {
    const body = await get(path);
    check(Array.isArray(body), `${path}: expected a list, got an error or incompatible payload`);
  }
  return { passed: true, phase: activeWorker ? 'activation-preflight' : 'full-stack', candidate_worker_verified: !activeWorker, candidate: expected.url, deployment_id: expected.deploymentId, commit: expected.commit, required_services: expected.services, routes: rows };
}

export function expectedFromEnv(env) {
  return { url: env.RELEASE_URL, deploymentId: env.RELEASE_DEPLOYMENT_ID, commit: env.RELEASE_COMMIT,
    services: (env.RELEASE_REQUIRED_SERVICES || 'model,model_control,backend_auth').split(',').map(s => s.trim()).filter(Boolean) };
}
export function headersFromEnv(env) {
  const headers = {};
  if (env.RELEASE_SESSION_COOKIE) headers.Cookie = env.RELEASE_SESSION_COOKIE;
  if (env.VERCEL_AUTOMATION_BYPASS_SECRET) headers['x-vercel-protection-bypass'] = env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return headers;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await smoke(expectedFromEnv(process.env), { headers: headersFromEnv(process.env) }), null, 2)); }
  catch (error) { console.error(`Release blocked: ${error.message}`); process.exitCode = 1; }
}
