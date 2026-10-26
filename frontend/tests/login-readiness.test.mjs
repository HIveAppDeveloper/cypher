import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loginReadiness,previewDestination} from '../src/lib/login-readiness.mjs';
test('only explicit no-auth loopback configuration can offer sample preview continuation',()=>{
  const base={local:true,requireAuth:'false',backendConfigured:false,backendTokenLength:0,sessionSecretLength:0};
  assert.deepEqual(loginReadiness(base),{configured:false,preview:true});
  for(const requireAuth of [undefined,'true','FALSE'])assert.equal(loginReadiness({...base,requireAuth}).preview,false);
  assert.equal(loginReadiness({...base,local:false}).preview,false);
  assert.deepEqual(loginReadiness({...base,backendConfigured:true,backendTokenLength:32,sessionSecretLength:32}),{configured:true,preview:false});
  assert.equal(loginReadiness({...base,requireAuth:'true',backendConfigured:true,backendTokenLength:31,sessionSecretLength:32}).configured,false);
  assert.equal(loginReadiness({...base,requireAuth:'true',backendConfigured:true,backendTokenLength:32,sessionSecretLength:31}).configured,false);
});
test('preview continuation stays internal and cannot loop back to sign-in',()=>{
  for(const value of [null,'https://evil.example','//evil.example','/\\evil.example','/login','/login?returnTo=/gateway','/login/extra','/\nother'])assert.equal(previewDestination(value),'/gateway');
  assert.equal(previewDestination('/gateway?tab=providers'),'/gateway?tab=providers');
});
