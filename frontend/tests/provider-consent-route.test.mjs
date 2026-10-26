import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {load} from './support/component-harness.mjs';
const require=createRequire(import.meta.url),next=require('next/server'),crypto=require('node:crypto');
const canonical=load('../src/lib/canonical-app.ts',{}, {URL});
const origin=canonical.CANONICAL_APP_ORIGIN,id='e52dad3f-b0db-4cf8-a0f0-f9b88c16f230';
const env={AUTH_SESSION_SECRET:'synthetic-secret-longer-than-thirty-two-characters',NODE_ENV:'production',BACKEND_INTERNAL_URL:'http://backend.fixture',GROKBOT_BACKEND_API_TOKEN:'synthetic-service-token'};
const auth=load('../src/lib/auth-server.ts',{'node:crypto':crypto},{Buffer,process:{env}});
const user={sub:'owner',email:'owner@example.test',exp:Math.floor(Date.now()/1000)+600};
const flow={flow_id:id,binding:'b'.repeat(43),sub:'owner',returnTo:'/?conversation=fixture',exp:user.exp};
const authorization_url='https://openrouter.ai/auth?callback_url='+encodeURIComponent(origin+'/api/model-connections/openrouter/callback')+'&state='+'s'.repeat(43)+'&code_challenge='+'c'.repeat(43)+'&code_challenge_method=S256';
function route(fetch){return load('../src/app/api/model-connections/openrouter/[action]/route.ts',{'next/server':next,'../../../../../lib/auth-server':auth,'../../../../../lib/canonical-app':canonical},{URL,AbortSignal,process:{env},fetch});}
const context=action=>({params:Promise.resolve({action})});
function request(action,{method='GET',query='',session=user,binding=flow,requestOrigin=origin,body={}}={}){
  const cookies=[session?'grokbot_session='+auth.signPayload(session):'',binding?'cypher-openrouter-consent='+auth.signPayload(binding):''].filter(Boolean).join('; ');
  return new next.NextRequest(origin+'/api/model-connections/openrouter/'+action+query,{method,headers:{cookie:cookies,origin:requestOrigin},...(method==='POST'?{body:JSON.stringify(body)}:{})});
}
test('start requires canonical origin and an existing session before touching the backend',async()=>{
  let calls=0;const r=route(async()=>{calls++;throw Error('Unexpected backend call');});
  assert.equal((await r.POST(request('begin',{method:'POST',session:null}),context('begin'))).status,401);
  assert.equal((await r.POST(request('begin',{method:'POST',requestOrigin:'https://outside.example'}),context('begin'))).status,403);assert.equal(calls,0);
});
test('start keeps binding in a signed HttpOnly cookie and rejects dashboard URLs',async()=>{
  let body;const r=route(async(_,options)=>{body=JSON.parse(options.body);return Response.json({flow_id:id,authorization_url});});
  const response=await r.POST(request('begin',{method:'POST',body:{returnTo:'https://outside.example'}}),context('begin'));
  assert.deepEqual(await response.json(),{authorization_url});assert.match(response.headers.get('set-cookie'),/HttpOnly/);assert.match(response.headers.get('set-cookie'),/Secure/);
  const stored=auth.readSignedPayload(response.cookies.get('cypher-openrouter-consent').value);assert.equal(stored.sub,'owner');assert.equal(stored.binding,body.binding);assert.equal(stored.returnTo,'/');assert.equal(body.binding.length,43);
  const bad=route(async()=>Response.json({flow_id:id,authorization_url:'https://gateway.example/login'}));assert.equal((await bad.POST(request('begin',{method:'POST'}),context('begin'))).status,503);
});
test('callback is session-bound, strips code and state, and never returns credentials',async()=>{
  let body;const r=route(async(_,options)=>{body=JSON.parse(options.body);return Response.json({status:'queued'});});
  const response=await r.GET(request('callback',{query:'?state=synthetic-state&code=private-code'}),context('callback'));
  const target=new URL(response.headers.get('location'));assert.equal(target.origin,origin);assert.equal(target.pathname,'/connect/models');assert.equal(target.searchParams.get('flow'),id);assert.equal(target.searchParams.get('returnTo'),'/?conversation=fixture');assert.equal(target.searchParams.get('result'),'queued');assert.ok(!target.href.includes('private-code'));assert.ok(!target.searchParams.has('state'));assert.equal(body.binding,flow.binding);assert.equal(body.code,'private-code');assert.equal(response.cookies.get('cypher-openrouter-consent').value,'');assert.equal(response.headers.get('referrer-policy'),'no-referrer');
});
test('missing or changed session/binding and provider denial without state cannot exchange',async()=>{
  let calls=0;const r=route(async()=>{calls++;throw Error('Unexpected exchange');});
  for(const options of [{session:null},{session:{...user,sub:'someone-else'}},{binding:null},{binding:{...flow,exp:1}},{query:'?error=access_denied'}]){
    const response=await r.GET(request('callback',{query:'?code=private-code',...options}),context('callback'));assert.equal(response.status,303);assert.ok(!response.headers.get('location').includes('private-code'));
  }assert.equal(calls,0);
});
test('status uses authenticated internal forwarding and private no-store metadata',async()=>{
  let options,path;const r=route(async(url,config)=>{path=String(url);options=config;return Response.json({status:'saving',model_access_verified:false});});
  const response=await r.GET(request('status',{query:'?flow='+id}),context('status'));
  assert.equal(path,'http://backend.fixture/api/runtime/model-connections/openrouter/consent/'+id);assert.equal(options.headers['x-grokbot-user-id'],'owner');assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal((await response.json()).model_access_verified,false);
});
