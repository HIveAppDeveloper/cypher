import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const next = require('next/server');
function route(env) {
  const source = readFileSync(new URL('../src/app/api/release/route.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, Boolean, process: { env }, require: name => { assert.equal(name, 'next/server'); return next; } });
  return exports;
}
test('provenance reports binding without leaking private addresses or credentials', async () => {
  const response = await route({ VERCEL_DEPLOYMENT_ID: 'dpl_fixture', VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40), VERCEL_ENV: 'production', BACKEND_INTERNAL_URL: 'https://private.internal', GROKBOT_BACKEND_API_TOKEN: 'private-token' }).GET();
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { deployment_id: 'dpl_fixture', commit: 'a'.repeat(40), environment: 'production', backend_bound: true });
});
test('missing metadata and binding remain explicit and legacy backend binding is supported', async () => {
  assert.deepEqual(await (await route({}).GET()).json(), { deployment_id: null, commit: null, environment: null, backend_bound: false });
  assert.equal((await (await route({ GROKBOT_BACKEND_URL: 'https://private.internal' }).GET()).json()).backend_bound, true);
});
