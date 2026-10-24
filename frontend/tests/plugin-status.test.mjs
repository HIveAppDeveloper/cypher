import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source=stripTypeScriptTypes(readFileSync(new URL('../src/lib/plugin-status.ts',import.meta.url),'utf8'));
const {pluginStatus,isAccountPlugin}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const now = Date.parse('2026-10-24T20:00:00Z');
const base = {url:'https://service.example/mcp',enabled:true,tools:[{enabled:true}]};
test('a saved connection and successful discovery do not claim execution passed',()=>{
  assert.equal(pluginStatus(base,now).label,'Not tested');
  assert.equal(pluginStatus({...base,verification:{status:'discovered'}},now).label,'Tools found');
  assert.equal(pluginStatus({...base,verification:{status:'fallback'}},now).label,'Website fallback');
});
test('only a recent completed execution test gets the success state',()=>{
  const passed = checked_at => ({...base,verification:{status:'passed',checked_at}});
  assert.equal(pluginStatus(passed('2026-10-24T19:00:00Z'),now).tone,'success');
  for(const date of [undefined,'invalid','2026-10-22T19:00:00Z','2026-10-25T19:00:00Z']) assert.equal(pluginStatus(passed(date),now).label,'Check again');
});
test('auth failures, paused tools and unsupported legacy websites have recovery states',()=>{
  assert.equal(pluginStatus({...base,verification:{status:'failed',detail:{code:'sign_in_required'}}},now).label,'Sign in again');
  assert.equal(pluginStatus({...base,enabled:false},now).label,'Paused');
  assert.equal(pluginStatus({...base,tools:[{enabled:false}]},now).label,'No tools enabled');
  assert.equal(pluginStatus({...base,url:'site-mcp://gmail.com'},now).label,'Needs setup');
  assert.equal(isAccountPlugin({...base,authenticated:false,verification:{status:'failed',detail:{code:'sign_in_required'}}}),true,'Expired accounts stay visible for reconnection');
  assert.equal(isAccountPlugin({...base,authenticated:false}),false);
});
