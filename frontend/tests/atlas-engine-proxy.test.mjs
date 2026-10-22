import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { proxyAtlasEngine } from '../src/lib/atlas-engine-proxy.ts';

const originalFetch = globalThis.fetch;
const originalEnabled = process.env.GROKBOT_ATLAS_ENGINE_ENABLED;
const originalInternal = process.env.BACKEND_INTERNAL_URL;
const KEY = 'synthetic-proxy-signing-key-at-least-32';
const PATH = '/api/integrations/atlas/v1/chat';

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalEnabled === undefined) delete process.env.GROKBOT_ATLAS_ENGINE_ENABLED;
  else process.env.GROKBOT_ATLAS_ENGINE_ENABLED = originalEnabled;
  if (originalInternal === undefined) delete process.env.BACKEND_INTERNAL_URL;
  else process.env.BACKEND_INTERNAL_URL = originalInternal;
});

function request(body = '{ "version":1, "fixture":"Unicode: é ⛵" }', options = {}) {
  process.env.GROKBOT_ATLAS_ENGINE_ENABLED = 'true';
  process.env.BACKEND_INTERNAL_URL = 'http://private-fixture.invalid';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const raw = typeof body === 'string' ? body : '';
  const signature = createHmac('sha256', KEY).update(`v1\n${timestamp}\n${raw}`).digest('hex');
  return new Request('http://public-fixture.invalid' + PATH, {
    method: 'POST', body, duplex: 'half', ...options,
    headers: { 'content-type': 'application/json', 'x-atlas-engine-timestamp': timestamp, 'x-atlas-engine-signature': signature,
      cookie: 'grokbot_session=must-not-forward', authorization: 'Bearer must-not-forward', 'x-grokbot-user-id': 'spoofed', 'x-vercel-protection-bypass': 'must-not-forward', ...options.headers },
  });
}

test('exact service proxy forwards signed bytes without a browser session or ambient credentials', async () => {
  const input = request();
  const expected = new Uint8Array(await input.clone().arrayBuffer());
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return new Response('{"type":"result","result":{"content":"Synthetic answer","toolCalls":[]},"model":"fixture"}', { headers: { 'content-type': 'application/json' } });
  };
  const response = await proxyAtlasEngine(input);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).type, 'result');
  assert.equal(String(captured.url), 'http://private-fixture.invalid' + PATH);
  assert.deepEqual(captured.init.body, expected);
  assert.deepEqual(Object.keys(captured.init.headers).sort(), ['content-type', 'x-atlas-engine-signature', 'x-atlas-engine-timestamp']);
  assert.equal(captured.init.headers['x-atlas-engine-signature'], input.headers.get('x-atlas-engine-signature'));
  assert.equal(captured.init.redirect, 'error');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('default-disabled and malformed signatures never reach private backend', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('must not run'); };
  const input = request();
  delete process.env.GROKBOT_ATLAS_ENGINE_ENABLED;
  assert.equal((await proxyAtlasEngine(input)).status, 503);
  assert.equal((await proxyAtlasEngine(request('{}', { headers: { 'x-atlas-engine-signature': 'bad' } }))).status, 401);
  assert.equal(calls, 0);
});

test('oversized and compressed input fail before forwarding', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('must not run'); };
  assert.equal((await proxyAtlasEngine(request('x'.repeat(256 * 1024 + 1)))).status, 413);
  assert.equal((await proxyAtlasEngine(request('{}', { headers: { 'content-encoding': 'gzip' } }))).status, 415);
  assert.equal(calls, 0);
});

test('backend rejection preserves status without exposing internal errors', async () => {
  globalThis.fetch = async () => new Response('{"type":"error","code":"invalid_signature","message":"Not authenticated","retryable":false}', { status: 401, headers: { 'content-type': 'application/json' } });
  const response = await proxyAtlasEngine(request());
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'invalid_signature');
  globalThis.fetch = async () => { throw new Error('private-host synthetic-secret'); };
  const failed = await proxyAtlasEngine(request());
  assert.equal(failed.status, 503);
  assert.doesNotMatch(await failed.text(), /private-host|synthetic-secret/);
});

test('NDJSON passes incrementally and cancelling consumer aborts provider connection', async () => {
  let signal;
  let cancelled = false;
  globalThis.fetch = async (_url, init) => {
    signal = init.signal;
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"type":"token","text":"first"}\n')); },
      cancel() { cancelled = true; },
    }), { headers: { 'content-type': 'application/x-ndjson' } });
  };
  const response = await proxyAtlasEngine(request());
  const reader = response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value), /first/);
  await reader.cancel();
  assert.equal(cancelled, true);
  assert.equal(signal.aborted, true);
});

test('incoming cancellation aborts upstream fetch and is reported explicitly', async () => {
  const abort = new AbortController();
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    abort.abort();
  });
  const response = await proxyAtlasEngine(request('{}', { signal: abort.signal }));
  assert.equal(response.status, 499);
  assert.equal((await response.json()).code, 'request_cancelled');
});

test('a stalled upload obeys its five-second body deadline', async () => {
  let cancelled = false;
  const input = request(new ReadableStream({ cancel() { cancelled = true; } }));
  const before = Date.now();
  const response = await proxyAtlasEngine(input);
  assert.equal(response.status, 408);
  assert.equal(cancelled, true);
  assert.ok(Date.now() - before < 6500);
});

test('invalid upstream content type is rejected and body cancelled', async () => {
  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/html' } });
  const response = await proxyAtlasEngine(request());
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, 'engine_protocol_error');
  assert.equal(cancelled, true);
});
