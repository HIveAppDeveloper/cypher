/** Actual loopback routes/transports; only the model generator is substituted. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HARNESS = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.env.WIRE_TEST_WORKSPACE || resolve(HARNESS, '..'));
const PYTHON = process.env.WIRE_TEST_PYTHON || 'python3';
const ENGINE_KEY = 'synthetic-engine-signing-key-0000000000000000';
const SEARCH_KEY = 'synthetic-search-signing-key-0000000000000000';
const TENANT = 'wire-synthetic';
// No existing database, Vercel or provider credentials participate in fixtures.
for (const name of Object.keys(process.env)) {
  if (/(?:DATABASE|POSTGRES|^PG|^PRISMA|^NEON|API_KEY|OIDC|^VERCEL|^AWS|^RESEND|^TWILIO|^STRIPE)/.test(name)) delete process.env[name];
}
Object.assign(process.env, {
  NODE_ENV: 'test', HIVE_STATE_ID: TENANT,
  HIVE_SESSION_SECRET: 'synthetic-session-signing-key-0000000000000000',
  HIVE_AI_APPROVED_RECIPIENTS: 'gemini', ATLAS_ENGINE_SIGNING_KEY: ENGINE_KEY,
  ATLAS_ENGINE_MODEL_RECIPIENT: 'gemini', ATLAS_ENGINE_ALLOW_LOCAL_HTTP: 'true',
  HIVE_ATLAS_SEARCH_SIGNING_KEY: SEARCH_KEY, HIVE_ATLAS_SEARCH_MODEL_RECIPIENT: 'gemini',
  HIVE_ATLAS_SEARCH_TENANT_ID: TENANT,
  ATLAS_HIVE_SEARCH_ENABLED: 'true', ATLAS_HIVE_SEARCH_SHARING_APPROVED: 'true',
  GROKBOT_BACKEND_API_TOKEN: 'synthetic-backend-proxy-token',
  GROKBOT_ATLAS_ENGINE_ENABLED: 'true',
});
const results = [];
const network = [];
const nativeFetch = globalThis.fetch;
let backend;
let proxy;
let atlas;
const servers = [];
const child = spawn(PYTHON, [resolve(HARNESS, 'engine-fixture-server.py')], { cwd: ROOT, env: { ...process.env, WIRE_TEST_WORKSPACE: ROOT }, stdio: ['ignore', 'pipe', 'pipe'] });
let childError = '';
child.stderr.on('data', part => { childError += part.toString(); });
async function startup() {
  let pending = '';
  return new Promise((resolvePort, reject) => {
    const timer = setTimeout(() => reject(new Error('Engine fixture startup timeout: ' + childError.slice(-500))), 15000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Engine fixture exited ' + code + ': ' + childError.slice(-1000))); });
    child.stdout.on('data', part => {
      pending += part.toString();
      for (const line of pending.split('\n')) {
        try { const value = JSON.parse(line); if (value.port) { clearTimeout(timer); resolvePort(value.port); return; } } catch {}
      }
    });
  });
}
async function bridge(handler, name) {
  const server = createServer(async (req, res) => {
    const abort = new AbortController();
    res.once('close', () => { if (!res.writableEnded) abort.abort(); });
    try {
      const parts = [];
      for await (const part of req) parts.push(part);
      const raw = Buffer.concat(parts);
      const request = new Request(`http://127.0.0.1:${server.address().port}${req.url}`, {
        method: req.method, headers: req.headers,
        ...(!['GET', 'HEAD'].includes(req.method) ? { body: raw } : {}), signal: abort.signal,
      });
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) for await (const chunk of response.body) { if (res.destroyed) break; res.write(chunk); }
      res.end();
    } catch (error) {
      if (!res.destroyed) { res.writeHead(500); res.end('Synthetic bridge failure'); }
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}
let failure;
async function check(name, test) {
  console.log('RUN ' + name);
  const start = performance.now();
  try { const detail = await test(); results.push({ name, status: 'passed', durationMs: Math.round(performance.now() - start), ...(detail ? { detail } : {}) }); console.log('PASS ' + name); }
  catch (error) { results.push({ name, status: 'failed', durationMs: Math.round(performance.now() - start), error: error.message }); failure ??= error; console.log('FAIL ' + name + ': ' + error.message); }
}
async function state() { return (await nativeFetch(backend + '/__fixture/state')).json(); }
async function waitForIdle(expectedClosed) {
  for (let i = 0; i < 50; i += 1) {
    const value = await state();
    if (!value.active && value.closed >= expectedClosed) return value;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const value = await state();
  assert.equal(value.active, 0, 'Model call remained active after cancellation');
  assert.ok(value.closed >= expectedClosed, 'Model iterator was not closed');
  return value;
}
function signed(body, { key = ENGINE_KEY, timestamp = String(Math.floor(Date.now() / 1000)), prefix = 'v1' } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return { raw, timestamp, signature: createHmac('sha256', key).update(`${prefix}\n${timestamp}\n${raw}`).digest('hex') };
}
async function postEngine(body, signatureOptions) {
  const sig = signed(body, signatureOptions);
  return nativeFetch(proxy + '/api/integrations/atlas/v1/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-atlas-engine-timestamp': sig.timestamp, 'x-atlas-engine-signature': sig.signature }, body: sig.raw, signal: AbortSignal.timeout(5000) });
}
function engineBody(extra = {}) {
  return { version: 1, requestId: randomUUID(), principal: { tenantId: 'fixture-a', actorId: 'actor-a' }, recipient: 'gemini', messages: [{ role: 'user', content: 'Synthetic café question' }], maxTokens: 700, timeoutMs: 2000, stream: false, ...extra };
}
try {
  backend = `http://127.0.0.1:${await startup()}`;
  for (let i = 0; i < 100; i += 1) { try { if ((await nativeFetch(backend + '/health')).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 20)); }
  process.env.BACKEND_INTERNAL_URL = backend;
  globalThis.fetch = async (input, init) => {
    const rawUrl = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const target = rawUrl === 'https://atlassolution.net/api/internal/hive/search' ? atlas + '/api/internal/hive/search' : rawUrl;
    const parsed = new URL(target);
    if (!['127.0.0.1', '[::1]', 'localhost'].includes(parsed.hostname) || ![backend, proxy, atlas].includes(parsed.origin)) throw new Error('Wire verification blocks non-loopback fetch');
    const entry = { target: target.startsWith(atlas) ? 'atlas' : target.startsWith(proxy) ? 'proxy' : 'backend', method: init?.method || 'GET', path: parsed.pathname };
    if (typeof init?.body === 'string') entry.body = JSON.parse(init.body);
    network.push(entry);
    return nativeFetch(target, init);
  };
  // This route must exist: no fallback synthetic proxy can produce a pass.
  const realProxy = await import(resolve(ROOT, 'open-grokbot/frontend/src/app/api/integrations/atlas/v1/chat/route.ts'));
  proxy = await bridge(realProxy.POST, 'grokbot-next-proxy');
  process.env.GROKBOT_ENGINE_URL = proxy;
  const atlasRoute = await import(resolve(ROOT, 'atlas/app/api/internal/hive/search/route.ts'));
  atlas = await bridge(atlasRoute.POST, 'atlas-hive-search');
  const { callGrokbotEngine } = await import(resolve(ROOT, 'atlas/lib/agent/grokbot.ts'));
  const { rankVisibleCreators } = await import(resolve(ROOT, 'hive/src/server/atlasSearch.ts'));
  const { putServerState } = await import(resolve(ROOT, 'hive/src/server/serverState.ts'));
  const { saveAiConsent } = await import(resolve(ROOT, 'hive/src/server/aiPrivacy.ts'));
  const { saveAtlasSearchConsent } = await import(resolve(ROOT, 'hive/src/server/atlasSearchPrivacy.ts'));
  const { mintSessionToken, verifySessionToken } = await import(resolve(ROOT, 'hive/src/server/sessionToken.ts'));
  const user = { id: 'brand-fixture', role: 'planner', name: 'Synthetic Brand', email: 'brand@example.invalid', city: 'Synthetic City', status: 'verified', createdAt: 1 };
  await putServerState({ users: [user] });
  const auth = { user, claims: verifySessionToken(mintSessionToken(user.id)) };
  const candidates = [0, 1, 2].map(index => ({ id: `local-private-${index}`, platform: 'instagram', handle: `synthetic_${index}`, profileUrl: `https://www.instagram.com/synthetic_${index}/`, displayName: `Synthetic Creator ${index}`, snippet: 'Café food; contact synthetic@private.invalid or +1 555 010 1234', source: 'exact_profile', profileVerified: true, contactRef: 'PRIVATE_CONTACT_PROOF_MUST_NOT_TRANSMIT', fitScore: 71 + index }));
  const principal = { tenantId: 'atlas-user:synthetic', actorId: 'synthetic' };

  await check('Atlas client → real Next proxy → real FastAPI route streams Unicode without browser session', async () => {
    const tokens = [];
    const result = await callGrokbotEngine({ principal, messages: [{ role: 'user', content: 'Synthetic café question' }], onToken: text => tokens.push(text), timeoutMs: 2000 });
    assert.equal(result.content, 'Synthetic answer ✓ — café'); assert.equal(tokens.join(''), result.content); assert.equal(result.model, 'gemini-3.8-flash');
  });
  await check('Real client and engine preserve streamed tool intent arguments', async () => {
    const result = await callGrokbotEngine({ principal, messages: [{ role: 'user', content: 'fixture:tools' }], tools: [{ name: 'search_synthetic', description: 'Synthetic read only', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }], timeoutMs: 2000 });
    assert.deepEqual(result.toolCalls, [{ id: 'fixture-call-1', name: 'search_synthetic', arguments: '{"query":"synthetic"}' }]);
  });
  await check('Unsigned and body-tampered engine requests are rejected before inference', async () => {
    const before = (await state()).calls.length;
    const unsigned = await nativeFetch(proxy + '/api/integrations/atlas/v1/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(engineBody()) });
    assert.equal(unsigned.status, 401);
    const sig = signed(engineBody());
    const tampered = await nativeFetch(proxy + '/api/integrations/atlas/v1/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-atlas-engine-timestamp': sig.timestamp, 'x-atlas-engine-signature': sig.signature }, body: sig.raw.replace('café', 'cafe') });
    assert.equal(tampered.status, 401); assert.equal((await state()).calls.length, before);
  });
  await check('Direct FastAPI JSON response finishes within a local three-second deadline', async () => {
    const sig = signed(engineBody());
    const response = await nativeFetch(backend + '/api/integrations/atlas/v1/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-atlas-engine-timestamp': sig.timestamp, 'x-atlas-engine-signature': sig.signature }, body: sig.raw, signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.type, 'result');
  });
  await check('Used request ID and expired HMAC cannot start another inference', async () => {
    const body = engineBody(); const before = (await state()).calls.length;
    assert.equal((await postEngine(body)).status, 200); assert.equal((await postEngine(body)).status, 409);
    assert.equal((await postEngine(engineBody(), { timestamp: String(Math.floor(Date.now() / 1000) - 120) })).status, 401);
    assert.equal((await state()).calls.length, before + 1);
  });
  await check('Concurrent principals reach isolated engine context', async () => {
    await Promise.all(['a', 'b'].map(id => callGrokbotEngine({ principal: { tenantId: 'wire-tenant-' + id, actorId: 'actor-' + id }, messages: [{ role: 'user', content: 'Synthetic concurrent ' + id }], timeoutMs: 2000 })));
    const calls = (await state()).calls.slice(-2); assert.deepEqual(new Set(calls.map(call => call.tenant)), new Set(['atlas-engine:wire-tenant-a', 'atlas-engine:wire-tenant-b']));
  });
  await check('Provider failure produces safe error and closes the model iterator', async () => {
    const before = await state();
    await assert.rejects(() => callGrokbotEngine({ principal, messages: [{ role: 'user', content: 'fixture:provider-error' }], timeoutMs: 2000 }), error => !String(error).includes('SYNTHETIC_PROVIDER_SECRET') && error.code === 'engine_unavailable');
    await waitForIdle(before.closed + 1);
  });
  await check('Client cancellation crosses the Next proxy and closes provider execution', async () => {
    const before = await state(); const controller = new AbortController();
    await assert.rejects(() => callGrokbotEngine({ principal, messages: [{ role: 'user', content: 'fixture:slow' }], signal: controller.signal, onToken: () => controller.abort(), timeoutMs: 2000 }), error => error.code === 'cancelled');
    await waitForIdle(before.closed + 1);
  });
  await check('Disabled Hive path sends no request and preserves source objects', async () => {
    delete process.env.HIVE_ATLAS_SEARCH_ENABLED; const before = network.length;
    const result = await rankVisibleCreators({ auth, query: 'Synthetic food café', candidates });
    assert.equal(result.candidates, candidates); assert.equal(network.length, before);
  });
  Object.assign(process.env, { HIVE_ATLAS_SEARCH_ENABLED: 'true', HIVE_ATLAS_SEARCH_SHARING_APPROVED: 'true' });
  await check('Existing Gemini consent alone cannot authorize the new sharing chain', async () => {
    await saveAiConsent(user.id, true, ['gemini']); const before = network.length;
    const result = await rankVisibleCreators({ auth, query: 'Synthetic food café', candidates });
    assert.equal(result.provider.status, 'skipped'); assert.equal(result.candidates, candidates); assert.equal(network.length, before);
  });
  await saveAtlasSearchConsent(user.id, true, ['atlas', 'grokbot', 'gemini']);
  await check('Hive adapter → real Atlas search route → client → proxy → engine ranks authorized sources', async () => {
    const before = network.length; const result = await rankVisibleCreators({ auth, query: 'Synthetic food café', candidates });
    assert.equal(result.provider.status, 'ok'); assert.deepEqual(result.candidates.map(item => item.id), [...candidates].reverse().map(item => item.id));
    assert.equal(result.candidates[0], candidates[2]); assert.equal(result.candidates[0].contactRef, candidates[2].contactRef);
    const outgoing = network.slice(before).find(entry => entry.target === 'atlas').body;
    const raw = JSON.stringify(outgoing); assert.ok(!raw.includes('PRIVATE_CONTACT_PROOF')); assert.ok(!raw.includes('local-private-')); assert.ok(!raw.includes('synthetic@private.invalid')); assert.ok(!raw.includes('brand@example.invalid'));
    assert.deepEqual(outgoing.candidates.map(item => Object.keys(item).sort()), candidates.map(() => ['description', 'id', 'platform', 'title', 'url']));
    const lastCall = (await state()).calls.at(-1); assert.equal(lastCall.tenant, 'atlas-engine:hive:' + TENANT); assert.equal(lastCall.toolCount, 0);
    return { modelMocked: true, realHttpHops: 3, sources: candidates.length };
  });
  await check('Unknown model source IDs are rejected and original Hive sources survive', async () => {
    const result = await rankVisibleCreators({ auth, query: 'fixture:ranking-injection', candidates });
    assert.equal(result.provider.status, 'error'); assert.equal(result.candidates, candidates);
  });
  await check('Revoked new scope blocks the next transmission', async () => {
    await saveAtlasSearchConsent(user.id, false, []); const before = network.length;
    const result = await rankVisibleCreators({ auth, query: 'Synthetic food café', candidates });
    assert.equal(result.provider.status, 'skipped'); assert.equal(network.length, before);
  });
  await saveAtlasSearchConsent(user.id, true, ['atlas', 'grokbot', 'gemini']);
  await check('Hive caller cancellation preserves sources and stops the downstream inference', async () => {
    const before = await state(); const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 50);
    const result = await rankVisibleCreators({ auth, query: 'fixture:slow', candidates, signal: controller.signal }); clearTimeout(timer);
    assert.equal(result.provider.status, 'error'); assert.equal(result.candidates, candidates); await waitForIdle(before.closed + 1);
  });
  await check('Atlas signed-search tenant mismatch and wrong signature cannot reach inference', async () => {
    const body = network.find(entry => entry.target === 'atlas').body; const before = (await state()).calls.length;
    const changed = { ...body, requestId: randomUUID(), principal: { ...body.principal, tenantId: 'other-tenant' } };
    const sig = signed(changed, { key: SEARCH_KEY, prefix: 'hive-search-v1' });
    const response = await nativeFetch(atlas + '/api/internal/hive/search', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hive-search-timestamp': sig.timestamp, 'x-hive-search-signature': sig.signature }, body: sig.raw });
    assert.equal(response.status, 400);
    const wrong = signed({ ...body, requestId: randomUUID() }, { key: 'wrong-synthetic-key', prefix: 'hive-search-v1' });
    assert.equal((await nativeFetch(atlas + '/api/internal/hive/search', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hive-search-timestamp': wrong.timestamp, 'x-hive-search-signature': wrong.signature }, body: wrong.raw })).status, 401);
    assert.equal((await state()).calls.length, before);
  });
} catch (error) { failure = error; }
finally {
  globalThis.fetch = nativeFetch;
  for (const server of servers) { server.closeAllConnections(); server.close(); }
  child.kill('SIGTERM');
  const report = { generatedAt: new Date().toISOString(), result: failure ? 'failed' : 'passed', cases: results, counts: { passed: results.filter(item => item.status === 'passed').length, failed: results.filter(item => item.status === 'failed').length }, boundaries: ['Real Hive adapter, projection and consent guards against synthetic memory users', 'Real Atlas signed search route and rank/source validation', 'Real Atlas engine signer and streaming client', 'Real Grokbot Next proxy and FastAPI application middleware/engine route', 'Actual loopback HTTP between all three boundaries'], substitutions: ['Model provider stream is synthetic; no provider network call', 'Canonical Atlas URL is rewritten to its loopback bridge without changing body or HMAC', 'Fixed synthetic service/session signing values exist only in the harness', 'Node HTTP bridge supplies Request/Response hosting instead of a Next server'], limits: ['No hosted deployment or real authentication/OAuth provider flow', 'Harness starts at the verified-user Hive adapter; discovery HTTP handler authorization has separate unit coverage', 'No model quality/latency or competitor evaluation', 'No production consent activation or real user data', 'No distributed multi-instance replay guarantee'], ...(failure ? { failure: failure.message, fixtureStderr: childError.slice(-2000) } : {}) };
  await writeFile(resolve(ROOT, 'verification/results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ result: report.result, counts: report.counts, failure: failure?.message }));
  if (failure) { console.error(failure); process.exitCode = 1; }
}
