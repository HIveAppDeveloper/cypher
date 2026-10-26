import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from './support/component-harness.mjs';
const origin=(value)=>load('../src/lib/canonical-app.ts',{}, {URL,URLSearchParams,process:{env:{NEXT_PUBLIC_SELF_HOSTED_ORIGIN:value}}});
test('self-host origin is an explicit operator setting; canonical production remains the default',()=>{
  assert.equal(origin('').CANONICAL_APP_ORIGIN,'https://cypher-agent.vercel.app');
  const configured=origin('https://models.example.test');assert.equal(configured.CANONICAL_APP_ORIGIN,'https://models.example.test');assert.equal(configured.isOffCanonicalHost('models.example.test'),false);assert.equal(configured.isOffCanonicalHost('unrelated.example'),true);
  assert.equal(configured.safeInternalReturnTo('https://evil.test'),null);assert.equal(configured.safeInternalReturnTo('//evil.test'),null);assert.equal(configured.safeInternalReturnTo('/gateway'),'/gateway');
});
test('malformed origins cannot redirect sign-in away from the configured app',()=>{
  for(const value of ['https://user:secret@example.test','https://example.test/path','https://example.test?token=secret','https://example.test#fragment','http://public.example','javascript:alert(1)',' https://example.test'])assert.equal(origin(value).CANONICAL_APP_ORIGIN,'https://cypher-agent.vercel.app');
  assert.equal(origin('http://localhost:3000').CANONICAL_APP_ORIGIN,'http://localhost:3000');
});
