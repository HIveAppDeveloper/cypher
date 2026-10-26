import test from 'node:test';
import assert from 'node:assert/strict';
import {publicGatewayManagementUrl,providerUsage,configuredModels,connectionStatus,knownNumber,safeRuns} from '../src/lib/gateway-dashboard.mjs';

test('management links accept only verified public origins and never forward credential components',()=>{
  assert.equal(publicGatewayManagementUrl('https://omniroute-cloud-ten.vercel.app/v1'),'https://omniroute-cloud-ten.vercel.app/dashboard/providers');
  for(const url of ['http://omniroute-cloud-ten.vercel.app','http://localhost:8000','https://backend.internal/v1','https://evil.example','https://key:secret@omniroute-cloud-ten.vercel.app','https://omniroute-cloud-ten.vercel.app?bypass=secret','https://omniroute-cloud-ten.vercel.app#token','https://omniroute-cloud-ten.vercel.app:8443','javascript:alert(1)','https://omniroute-cloud-ten.vercel.app.evil.example','https://omniroute-cloud-ten.vercel.app/api/internal'])assert.equal(publicGatewayManagementUrl(url),null,url);
});
test('usage grouping sums only finite nonnegative observed values',()=>{
  assert.deepEqual(providerUsage({models:[{provider:'a',input_tokens:10,output_tokens:4,estimated_cost:.1},{provider:'a',input_tokens:3,output_tokens:2,estimated_cost:.2},{provider:'b',input_tokens:-1,output_tokens:Infinity,estimated_cost:'0'}]}),[{provider:'a',tokens:19,cost:.30000000000000004,models:2},{provider:'b',tokens:0,cost:0,models:1}]);
  assert.deepEqual(providerUsage(null),[]);
});
test('unknown observations stay unknown rather than becoming zero',()=>{for(const value of [undefined,null,'0',NaN,Infinity,-1])assert.equal(knownNumber(value),null);assert.equal(knownNumber(0),0);assert.equal(knownNumber(2),2);});
test('configured model list deduplicates without inferring catalog entries',()=>{assert.deepEqual(configuredModels({configured_models:['provider/a','provider/a',null,7,'provider/b']}),['provider/a','provider/b']);assert.deepEqual(configuredModels(null),[]);assert.equal(connectionStatus('ready'),'Verified');assert.equal(connectionStatus('unexpected'),'Not checked');});
test('task metadata explicitly excludes titles, prompts, output and arbitrary fields',()=>{
  assert.deepEqual(safeRuns([{id:'task',status:'completed',created_at:'2026-10-26T13:00:00Z',title:'private title',prompt:'secret',result:'private output'},{id:7}]),[{id:'task',status:'completed',created_at:'2026-10-26T13:00:00Z',completed_at:undefined}]);
});
