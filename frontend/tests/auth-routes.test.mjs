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
    require: name => name === 'node:crypto' ? crypto : name === 'next/server' ? next : name.endsWith('/lib/auth-server') ? load('../src/lib/auth-server.ts', env) : name.endsWith('/lib/canonical-app') ? load('../src/lib/canonical-app.ts', env) : (() => { throw new Error('Unexpected import ' + name); })(),
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
  assert.equal(response.headers.get('location'), 'https://grokbot.fixture/connect/google?welcome=1');
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

test('Google permissions require a session and bind consent to a protected browser cookie',async()=>{
 const path='../src/app/api/google/connect/route.ts';let calls=0,received;
 const route=load(path,BASE,async(url,options)=>{calls++;received={url:String(url),options};return Response.json({flow_id:'e52dad3f-b0db-4cf8-a0f0-f9b88c16f230',binding:'fixture-browser-binding',authorization_url:'https://accounts.google.com/o/oauth2/v2/auth?state=fixture'});});
 assert.equal((await route.POST(request('/api/google/connect',{method:'POST',body:'{}'}))).status,401);
 const session=load('../src/lib/auth-server.ts').signPayload({sub:'fixture-owner',email:'owner@example.test',exp:Date.now()/1000+300});
 const headers={Cookie:'grokbot_session='+session,Origin:'https://grokbot.fixture','Content-Type':'application/json'};
 assert.equal((await route.POST(request('/api/google/connect',{method:'POST',headers:{...headers,Origin:'https://evil.fixture'},body:'{}'}))).status,403);
 const response=await route.POST(request('/api/google/connect',{method:'POST',headers,body:JSON.stringify({services:['gmail','drive'],user_id:'other-owner'})}));
 assert.equal(response.status,200);assert.equal(calls,1);assert.equal(received.options.headers['x-grokbot-user-id'],'fixture-owner');
 assert.deepEqual(JSON.parse(received.options.body),{services:['gmail','drive']});assert.equal((await response.json()).binding,undefined);
 for(const flag of ['HttpOnly','Secure','SameSite=lax','Path=/api/auth/google/callback','Max-Age=600'])assert.ok(response.headers.get('set-cookie').includes(flag));
});

test('Google API callback requires browser and session binding, strips codes and handles denial',async()=>{
 const flow='e52dad3f-b0db-4cf8-a0f0-f9b88c16f230';let calls=0,body;
 const route=load('../src/app/api/auth/google/callback/route.ts',BASE,async(url,options)=>{calls++;body=JSON.parse(options.body);assert.equal(options.headers['x-grokbot-user-id'],'fixture-owner');return Response.json({status:body.denied?'cancelled':'connected'});});
 const url='/api/auth/google/callback?state='+flow+'.fixture-state&code=fixture-code&returnTo=https://evil.fixture';
 assert.equal((await route.GET(request(url))).headers.get('location'),'https://grokbot.fixture/connect/google?result=failed');assert.equal(calls,0);
 const session=load('../src/lib/auth-server.ts').signPayload({sub:'fixture-owner',email:'owner@example.test',exp:Date.now()/1000+300});
 const headers={Cookie:'grokbot_session='+session+'; cypher-google-'+flow+'=fixture-browser-binding'};
 const response=await route.GET(request(url,{headers}));assert.equal(calls,1);assert.equal(body.binding,'fixture-browser-binding');assert.equal(body.code,'fixture-code');
 assert.equal(response.headers.get('location'),'https://grokbot.fixture/connect/google?result=connected');assert.ok(response.headers.get('set-cookie').includes('Max-Age=0'));
 const denial=await route.GET(request('/api/auth/google/callback?state='+flow+'.fixture-state&error=access_denied',{headers}));assert.equal(denial.headers.get('location'),'https://grokbot.fixture/connect/google?result=cancelled');assert.equal(body.denied,true);
});

test('readiness reports missing runtime without a network request', async () => {
  const route = load('../src/app/api/health/route.ts', {});
  const response = await route.GET();
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { service: 'cypher', status: 'unconfigured' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('readiness probes only backend health and never exposes its address or error', async () => {
  for (const upstream of [200, 500, 'network-error']) {
    let requested;
    const route = load('../src/app/api/health/route.ts', BASE, async (url, options) => {
      requested = String(url);
      assert.equal(options.cache, 'no-store');
      assert.ok(options.signal);
      if (upstream === 'network-error') throw new Error('private upstream failure');
      return new Response('private upstream response', { status: upstream });
    });
    const response = await route.GET();
    assert.equal(requested, 'http://127.0.0.1:1/health');
    assert.equal(response.status, upstream === 200 ? 200 : 503);
    assert.deepEqual(await response.json(), { service: 'cypher', status: upstream === 200 ? 'ok' : 'unavailable' });
  }
});
