import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { load } from './support/component-harness.mjs';

const next = createRequire(import.meta.url)('next/server');
const timing = load('../src/lib/server-timing.ts');
function route(fetch, options = {}) {
  let time = 90;
  return load('../src/app/api/[...path]/route.ts', {
    'next/server': next,
    '../../../lib/auth-server': { getSessionFromCookieHeader: () => null },
    '../../../lib/pluginAuthorization': load('../src/lib/pluginAuthorization.ts', {}, { URL }),
    '../../../lib/server-timing': timing,
  }, { URL, AbortSignal, performance: { now: () => time += 10 }, process: { env: {
    BACKEND_INTERNAL_URL: 'http://backend.fixture', GROKBOT_BACKEND_API_TOKEN: 'synthetic-private-token', ...options,
  } }, fetch });
}
const params = Promise.resolve({ path: ['fixture'] });

test('timing header allows only bounded durations and never accepts backend descriptions', () => {
  assert.equal(timing.proxyServerTiming(25, 30, ' 12.5 '), 'cypher_upstream_headers;dur=25.00, cypher_proxy_headers;dur=30.00, cypher_app_headers;dur=12.50');
  for (const value of ['-1', 'Infinity', 'NaN', '300001', '1e3', '4;desc="secret"', '4,other;dur=9', '4\r\nX-Secret: value', '1'.repeat(40)]) {
    assert.equal(timing.proxyServerTiming(25, 30, value), 'cypher_upstream_headers;dur=25.00, cypher_proxy_headers;dur=30.00');
  }
  assert.equal(timing.proxyServerTiming(Infinity, -1, null), '');
});

test('proxy preserves HTTP/body/retry headers and exposes only numeric headers-ready timings', async () => {
  const handler = route(async () => new Response('limited', { status: 429, headers: {
    'content-type': 'text/plain', 'retry-after': '12', 'content-disposition': 'attachment; filename="fixture.txt"',
    'x-cypher-app-headers-ms': '12.5', 'server-timing': 'secret;desc="must-not-forward"',
  } }));
  const response = await handler.GET(new next.NextRequest('https://app.example/api/fixture'), { params });
  assert.equal(response.status, 429);
  assert.equal(await response.text(), 'limited');
  assert.equal(response.headers.get('retry-after'), '12');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('content-disposition'), 'attachment; filename="fixture.txt"');
  assert.equal(response.headers.get('server-timing'), 'cypher_upstream_headers;dur=10.00, cypher_proxy_headers;dur=30.00, cypher_app_headers;dur=12.50');
  assert.equal(response.headers.get('x-cypher-app-headers-ms'), null);
});

test('timing diagnostics do not consume or wait for an unfinished response stream', async () => {
  let controller;
  const source = new ReadableStream({ start(value) { controller = value; value.enqueue(new TextEncoder().encode('first')); } });
  const handler = route(async () => new Response(source));
  const response = await handler.GET(new next.NextRequest('https://app.example/api/fixture'), { params });
  assert.match(response.headers.get('server-timing'), /cypher_upstream_headers;dur=/);
  const reader = response.body.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'first');
  controller.close();
  assert.equal((await reader.read()).done, true);
});

test('backend failure keeps the existing safe 503 and unauthorized calls still stop before fetch', async () => {
  let calls = 0;
  const handler = route(async () => { calls++; throw Error('synthetic-private-token'); });
  const failed = await handler.GET(new next.NextRequest('https://app.example/api/fixture'), { params });
  assert.equal(failed.status, 503);
  assert.match((await failed.json()).detail, /cloud API is starting or unavailable/);
  assert.doesNotMatch(failed.headers.get('server-timing'), /token|secret|fixture/);
  const guarded = route(async () => { assert.fail('must not fetch for signed-out caller'); }, { REQUIRE_USER_AUTH: 'true' });
  const denied = await guarded.GET(new next.NextRequest('https://app.example/api/fixture'), { params });
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get('server-timing'), null);
  assert.equal(calls, 1);
});
