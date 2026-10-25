import { pathToFileURL } from 'node:url';

// Only public, bounded metadata may enter diagnostics. Never stringify an error or response.
const ERROR_NAMES = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'AbortError', 'TimeoutError', 'NetworkError', 'InvalidStateError', 'FetchError', 'HTTPError', 'PageEvaluationTimeoutError', 'PageExecutionTimeoutError', 'PageFetchTimeoutError', 'ScriptTimeoutError', 'BridgeError', 'TargetClosedError', 'PageClosedError']);
const ERROR_CODES = new Set(['ABORT_ERR', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EPIPE', 'ERR_ABORTED', 'ERR_NETWORK', 'ERR_CONNECTION_RESET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET']);
function read(value, key) { try { return value?.[key]; } catch { return undefined; } }
function safeError(error, phase) {
  const cause = read(error, 'cause'), name = read(error, 'name');
  const code = read(error, 'code'), causeCode = read(cause, 'code');
  return { phase, name: ERROR_NAMES.has(name) ? name : 'UnknownError',
    code: ERROR_CODES.has(code) ? code : ERROR_CODES.has(causeCode) ? causeCode : null };
}
function safeIdentity(value) {
  const id = read(value, 'deployment_id'), commit = read(value, 'commit'), environment = read(value, 'environment');
  return { deployment_id: id == null ? null : typeof id === 'string' && /^dpl_[A-Za-z0-9]{1,80}$/.test(id) ? id : 'invalid',
    commit: commit == null ? null : typeof commit === 'string' && /^[a-f0-9]{40}$/.test(commit) ? commit : 'invalid',
    environment: environment == null ? null : ['production', 'preview', 'development'].includes(environment) ? environment : 'invalid' };
}
function expectedIdentity(value) { return safeIdentity({ deployment_id: value.deploymentId, commit: value.commit, environment: 'production' }); }
function provenance(path, body, expected, activeWorker) {
  if (path === '/api/release') return { expected: expectedIdentity(expected), actual: safeIdentity(body) };
  if (path === '/api/runtime') return { expected: { api: expectedIdentity(expected), worker: expectedIdentity(activeWorker || expected) },
    actual: { api: safeIdentity(read(body, 'deployment')), worker: safeIdentity(read(body, 'worker_deployment')) } };
}
function safeTimings(value) {
  const result = {};
  for (const key of ['in_page_fetch_ms', 'bridge_ms']) {
    const ms = read(value, key);
    if (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 && ms <= 3600000) result[key] = Math.round(ms * 1000) / 1000;
  }
  return Object.keys(result).length ? result : undefined;
}
function responseMetadata(response, row) {
  const status = read(response, 'status');
  if (Number.isInteger(status) && status >= 0 && status <= 599) row.status = status;
  let id;
  try { id = response.headers.get('x-vercel-id'); } catch { /* Diagnostic-only access must not affect the gate. */ }
  if (id != null) row.vercel_id = typeof id === 'string' && id.length <= 160 && /^(?:[a-z]{3}[0-9]{1,2}::){1,2}[A-Za-z0-9]{1,16}-[0-9]{10,16}-[a-f0-9]{8,64}$/.test(id) ? id : 'invalid';
}

// Opt-in wrapper around an existing browser adapter: same call, options, result and error.
// bridge_ms is the whole SDK round trip, not an invented measure of network overhead.
export function withBridgeTiming(fetchImpl) {
  function attach(value, started) {
    const timing = { ...safeTimings(read(value, 'releaseTimings')), bridge_ms: performance.now() - started };
    try { Object.defineProperty(value, 'releaseTimings', { value: timing, configurable: true }); } catch { /* Frozen results/errors still preserve their original behavior. */ }
    return value;
  }
  return async (url, options) => {
    const started = performance.now();
    try { return attach(await fetchImpl(url, options), started); }
    catch (error) { throw attach(error, started); }
  };
}

const gateErrors = new WeakSet();
function gateError(message) { const error = new Error(message); gateErrors.add(error); return error; }
function check(ok, message) { if (!ok) throw gateError(message); }
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

export async function smoke(expected, { fetchImpl = fetch, headers = {}, activeWorker, onDiagnostic } = {}) {
  validateExpected(expected);
  if (activeWorker) {
    validateExpected({ ...expected, ...activeWorker });
    check(activeWorker.deploymentId !== expected.deploymentId, 'Activation preflight requires the distinct current production worker');
  }
  const rows = [];
  async function get(path, json = true, publicLogin = false) {
    const started = performance.now();
    const row = { path };
    rows.push(row);
    try {
      let response;
      try {
        response = await fetchImpl(new URL(path, expected.url), {
          headers: { ...Object.fromEntries(Object.entries(headers).filter(([key]) => !publicLogin || key.toLowerCase() !== 'cookie')), 'Cache-Control': 'no-cache' }, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(35000),
        });
      } catch (error) {
        row.error = safeError(error, 'fetch');
        responseMetadata(read(error, 'response') || error, row);
        row.adapter_timing = safeTimings(read(error, 'releaseTimings'));
        throw gateError(`${path}: request failed or timed out`);
      }
      responseMetadata(response, row);
      row.adapter_timing = safeTimings(read(response, 'releaseTimings'));
      if (publicLogin && [307, 308].includes(response.status)) {
        check(response.headers.get('location') === 'https://cypher-agent.vercel.app/login', '/login: unexpected canonical redirect');
        row.canonical_redirect = true;
        return null; // Never follow the redirect and accidentally test the old release.
      }
      check(response.status === 200, `${path}: expected HTTP 200, got ${row.status ?? 'invalid'}`);
      check((response.headers.get('content-type') || '').includes(json ? 'application/json' : 'text/html'), `${path}: unexpected content type`);
      let body;
      if (json) {
        body = await response.json().catch(error => { row.error = safeError(error, 'body'); return null; });
      } else {
        try { body = await response.text(); }
        catch (error) { row.error = safeError(error, 'body'); throw gateError(`${path}: response body failed`); }
      }
      check(body !== null, `${path}: invalid JSON`);
      const identity = provenance(path, body, expected, activeWorker);
      if (identity) row.provenance = identity;
      return body;
    } catch (error) {
      row.error ??= safeError(error, 'response');
      throw gateErrors.has(error) ? error : gateError(`${path}: response handling failed`);
    } finally {
      row.elapsed_ms = Math.min(3600000, Math.max(0, Math.round((performance.now() - started) * 1000) / 1000));
      if (row.adapter_timing === undefined) delete row.adapter_timing;
      // Observers receive detached safe data and cannot change any readiness result.
      try { Promise.resolve(onDiagnostic?.(structuredClone(row))).catch(() => {}); } catch { /* Observer failures are non-gating. */ }
    }
  }
  try {
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
  } catch (error) {
    error.diagnostics = structuredClone(rows);
    throw error;
  }
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
  catch (error) { console.error(`Release blocked: ${error.message}`); if (error.diagnostics) console.error(JSON.stringify({ diagnostics: error.diagnostics })); process.exitCode = 1; }
}
