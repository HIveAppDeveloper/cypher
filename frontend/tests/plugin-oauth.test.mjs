import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import { NextRequest } from 'next/server.js';

const require = createRequire(import.meta.url);
const primary = 'https://open-grokbot.vercel.app';
const alternate = 'https://open-grokbot-hiveapp.vercel.app';
const env = { GROKBOT_PUBLIC_URL: alternate, GROKBOT_OAUTH_ALLOWED_ORIGINS: primary, REQUIRE_USER_AUTH: 'true' };
function route(path, overrides = {}, fetch = () => { throw new Error('Unexpected backend request'); }) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    exports: module.exports, module, process: { env: { ...env, ...overrides } }, fetch, URL, AbortSignal,
    require: id => id.endsWith('auth-server') ? { getSessionFromCookieHeader: () => null } : require(id),
  });
  return module.exports;
}
const proxyPath = '../src/app/api/[...path]/route.ts';
const context = path => ({ params: { path: path.split('/') } });

test('both production domains publish public OAuth client metadata without a session', async () => {
  const proxy = route(proxyPath);
  for (const origin of [primary, alternate]) {
    const response = await proxy.GET(new NextRequest(origin + '/api/plugin-oauth/client-metadata'), context('plugin-oauth/client-metadata'));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.client_id, origin + '/api/plugin-oauth/client-metadata');
    assert.equal(data.client_uri, origin);
    assert.deepEqual(data.redirect_uris.sort(), [primary, alternate].map(value => value + '/api/plugin-oauth/callback').sort());
    assert.equal(data.token_endpoint_auth_method, 'none');
    assert.equal(data.client_secret, undefined);
  }
});

test('metadata rejects unapproved domains and private API routes still require sign-in', async () => {
  const proxy = route(proxyPath);
  assert.equal((await proxy.GET(new NextRequest('https://attacker.example/api/plugin-oauth/client-metadata'), context('plugin-oauth/client-metadata'))).status, 404);
  assert.equal((await proxy.GET(new NextRequest(primary + '/api/plugins'), context('plugins'))).status, 401);
});

test('authorization uses the actual app origin and retains the private callback cookie', async () => {
  let forwarded;
  const proxy = route(proxyPath, { REQUIRE_USER_AUTH: 'false', BACKEND_INTERNAL_URL: 'https://backend.example' }, async (url, options) => {
    forwarded = options.headers;
    return Response.json({ status: 'awaiting_login', flow_id: 'test-flow', binding: 'private-browser-binding' });
  });
  const request = new NextRequest(primary + '/api/plugins/authorize', { method: 'POST', body: '{}', headers: { 'x-grokbot-public-origin': 'https://attacker.example' } });
  const response = await proxy.POST(request, context('plugins/authorize'));
  assert.equal(forwarded['x-grokbot-public-origin'], primary);
  assert.equal((await response.json()).binding, undefined);
  assert.match(response.headers.get('set-cookie'), /grokbot-oauth-test-flow=private-browser-binding/);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(response.headers.get('set-cookie'), /Path=\/api\/plugin-oauth\/callback/);
});

test('callbacks return to the app domain where sign-in began', async () => {
  const callback = route('../src/app/api/plugin-oauth/callback/route.ts');
  for (const origin of [primary, alternate]) {
    const response = await callback.GET(new NextRequest(origin + '/api/plugin-oauth/callback?error=access_denied'));
    assert.equal(response.status, 303);
    assert.equal(new URL(response.headers.get('location')).origin, origin);
  }
});
