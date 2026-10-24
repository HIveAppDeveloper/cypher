import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function route(env) {
  const source = readFileSync(new URL('../src/app/api/connections/route.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, URL, process: { env }, require: name => {
    if (name === 'next/server') return { NextResponse: { json: (body, init) => ({ body, init }) } };
    throw new Error('Unexpected import: ' + name);
  } });
  return exports;
}

test('OmniRoute management link is usable and never exposes URL credentials or query values', async () => {
  const { GET } = route({ OMNIROUTE_URL: 'https://omni.example/v1?token=url-secret', OMNIROUTE_API_KEY: 'server-secret' });
  const result = await GET();
  assert.equal(result.body.models.transport, 'omniroute');
  assert.equal(result.body.models.manageUrl, 'https://omni.example/dashboard/providers');
  assert.equal(JSON.stringify(result.body).includes('server-secret'), false);
  assert.equal(JSON.stringify(result.body).includes('url-secret'), false);
});

test('explicit OmniRoute dashboard URL keeps its route but strips credentials and query parameters', async () => {
  const { GET } = route({ OMNIROUTE_URL: 'https://omni.example/v1', OMNIROUTE_API_KEY: 'server-secret', OMNIROUTE_DASHBOARD_URL: 'https://user:password@omni.example/dashboard?token=url-secret' });
  const result = await GET();
  assert.equal(result.body.models.manageUrl, 'https://omni.example/dashboard');
  assert.equal(JSON.stringify(result.body).includes('password'), false);
  assert.equal(JSON.stringify(result.body).includes('url-secret'), false);
});
