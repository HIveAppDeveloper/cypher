/** Actual Next handlers with synthetic backend responses; no provider traffic. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const next = require('next/server');
const SECRET = 'synthetic-auth-route-secret-000000000000000000';
const TOKEN = 'synthetic-auth-backend-token-00000000000000000';
const BASE = { AUTH_SESSION_SECRET: SECRET, NODE_ENV: 'production', BACKEND_INTERNAL_URL: 'http://127.0.0.1:1', GROKBOT_BACKEND_API_TOKEN: TOKEN, GROKBOT_PUBLIC_URL: 'https://grokbot.fixture' };

function load(relative, env = BASE, fetch = async () => { throw new Error('Unexpected network request'); }) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, Buffer, URL, Date, FormData, AbortSignal, Request, Response, process: { env }, fetch,
    require: name => name === 'node:crypto' ? crypto : name === 'next/server' ? next : name.endsWith('/lib/auth-server') ? load('../src/lib/auth-server.ts', env) : (() => { throw new Error('Unexpected import ' + name); })(),
  });
  return exports;
}

function request(path, options) { return new next.NextRequest('https://grokbot.fixture' + path, options); }
function google({ csrf = 'fixture-csrf', cookie = csrf, credential = 'synthetic-google-credential-000000' } = {}) {
  const body = new URLSearchParams({ g_csrf_token: csrf, credential });
  return request('/api/auth/google/callback?returnTo=https://outside.invalid', { method: 'POST', body, headers: cookie ? { Cookie: 'g_csrf_token=' + cookie } : {} });
}

test('signed sessions reject missing, expired, tampered and malformed payloads', () => {
  const auth = load('../src/lib/auth-server.ts');
  const claims = { sub: 'fixture-owner', email: 'owner@example.test', exp: Math.floor(Date.now() / 1000) + 300 };
  const signed = auth.signPayload(claims);
  assert.equal(auth.getSessionFromCookieHeader('other=ignored; grokbot_session=' + signed).sub, claims.sub);
  assert.equal(auth.readSignedPayload(), null);
  assert.equal(auth.readSignedPayload(signed + '.extra'), null);
  assert.equal(auth.readSignedPayload('x' + signed), null);
  assert.equal(auth.readSignedPayload(auth.signPayload({ ...claims, exp: 1 })), null);
  assert.equal(auth.readSignedPayload('not-a-payload.invalid'), null);
  assert.throws(() => load('../src/lib/auth-server.ts', {}).signPayload(claims), /not configured/);
});

test('email request fails closed without backend configuration and rejects invalid JSON', async () => {
  const path = '../src/app/api/auth/email/request/route.ts';
  const unavailable = await load(path, {}).POST(request('/api/auth/email/request', { method: 'POST', body: '{}' }));
  assert.equal(unavailable.status, 503);
  assert.match((await unavailable.json()).detail, /not configured/);
  const invalid = await load(path).POST(request('/api/auth/email/request', { method: 'POST', body: '{' }));
  assert.equal(invalid.status, 422);
});

test('email request preserves backend errors and sends service auth only to the configured backend', async () => {
  const calls = [];
  const route = load('../src/app/api/auth/email/request/route.ts', BASE, async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json({ detail: 'Synthetic delivery unavailable.' }, { status: 503 });
  });
  const response = await route.POST(request('/api/auth/email/request', { method: 'POST', body: JSON.stringify({ email: 'owner@example.test' }) }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).detail, 'Synthetic delivery unavailable.');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:1/api/auth/email/request');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer ' + TOKEN);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.ok(!response.headers.has('set-cookie'));
});

test('missing or rejected magic links return to login without a session', async () => {
  const path = '../src/app/api/auth/email/verify/route.ts';
  const missing = await load(path).GET(request('/api/auth/email/verify'));
  assert.equal(missing.headers.get('location'), 'https://grokbot.fixture/login?error=magic-link');
  const rejected = await load(path, BASE, async () => new Response('', { status: 400 })).GET(request('/api/auth/email/verify?token=synthetic-invalid-token-00000000000'));
  assert.equal(rejected.headers.get('location'), 'https://grokbot.fixture/login?error=magic-link');
  assert.ok(!rejected.headers.has('set-cookie'));
});

test('successful synthetic magic-link verification creates a bounded protected cookie and ignores external returnTo', async () => {
  const route = load('../src/app/api/auth/email/verify/route.ts', BASE, async () => Response.json({ id: 'fixture-owner', email: 'owner@example.test', display_name: 'Owner' }));
  const response = await route.GET(request('/api/auth/email/verify?token=synthetic-valid-token-0000000000000&returnTo=https://outside.invalid'));
  assert.equal(response.headers.get('location'), 'https://grokbot.fixture/');
  const value = response.cookies.get('grokbot_session').value;
  const claims = load('../src/lib/auth-server.ts').readSignedPayload(value);
  assert.equal(claims.sub, 'fixture-owner');
  assert.equal(claims.email, 'owner@example.test');
  assert.ok(claims.exp > Date.now() / 1000 + 604700 && claims.exp < Date.now() / 1000 + 604801);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=lax', 'Max-Age=604800', 'Path=/']) assert.ok(response.headers.get('set-cookie').includes(flag), flag);
});

test('Google callback CSRF failures stop before any backend request', async () => {
  const route = load('../src/app/api/auth/google/callback/route.ts');
  for (const input of [google({ cookie: '' }), google({ cookie: 'wrong' }), google({ csrf: '' })]) {
    const response = await route.POST(input);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), 'https://grokbot.fixture/login?error=google-csrf');
    assert.ok(!response.headers.has('set-cookie'));
  }
});

test('Google existing-account conflict retains email-only ownership', async () => {
  const route = load('../src/app/api/auth/google/callback/route.ts', BASE, async () => Response.json({ detail: 'Use email.' }, { status: 409 }));
  const response = await route.POST(google());
  assert.equal(response.headers.get('location'), 'https://grokbot.fixture/login?error=email-required');
  assert.ok(!response.headers.has('set-cookie'));
});

test('synthetic Google callback success sets a session, clears CSRF and ignores external returnTo', async () => {
  const route = load('../src/app/api/auth/google/callback/route.ts', BASE, async () => Response.json({ id: 'fixture-google-owner', email: 'owner@gmail.com' }));
  const response = await route.POST(google());
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), 'https://grokbot.fixture/');
  assert.equal(load('../src/lib/auth-server.ts').readSignedPayload(response.cookies.get('grokbot_session').value).sub, 'fixture-google-owner');
  assert.equal(response.cookies.get('g_csrf_token').value, '');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('logout expires the correct cookie and returns to login', async () => {
  const route = load('../src/app/api/auth/logout/route.ts');
  const response = await route.GET(request('/api/auth/logout?returnTo=https://outside.invalid'));
  assert.equal(response.headers.get('location'), 'https://grokbot.fixture/login');
  const cookie = response.headers.get('set-cookie');
  for (const flag of ['grokbot_session=;', 'Max-Age=0', 'HttpOnly', 'Secure', 'SameSite=lax', 'Path=/']) assert.ok(cookie.includes(flag), flag);
});
