import {test} from 'node:test';
import assert from 'node:assert/strict';
import {load} from './support/component-harness.mjs';
function route(fetch,environment={}){
  return load('../src/app/api/voice/route.ts',{'next/headers':{cookies:()=>({get:()=>undefined})},'next/server':{NextResponse:{json:(data,init)=>new Response(JSON.stringify(data),init)}},'../../../lib/auth-server':{readSignedPayload:()=>null}},
    {Request,Response,TextDecoder,Uint8Array,URL,AbortSignal,performance:{now:()=>100},process:{env:{ELEVENLABS_API_KEY:'server-fixture-key',...environment}},fetch});
}
function request(signal){return new Request('https://cypher.example/api/voice',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'Voice latency fixture.'}),signal});}
test('realtime TTS preserves server credentials and stream while removing style overhead',async()=>{
 let seen;
 const {POST}=route(async(url,options)=>{seen={url,options};return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'audio/mpeg'}});});
 const result=await POST(request());assert.equal(result.status,200);
 const body=JSON.parse(seen.options.body);assert.equal(body.model_id,'eleven_flash_v2_5');assert.equal(body.voice_settings.style,0);assert.equal(body.voice_settings.speed,1.03);
 assert.equal(seen.options.headers['xi-api-key'],'server-fixture-key');assert.equal(result.headers.get('xi-api-key'),null);assert.match(result.headers.get('Server-Timing'),/^voice_provider_headers;dur=\d+(\.\d+)?$/);
 assert.equal(result.headers.get('Cache-Control'),'private, no-store');assert.deepEqual([...new Uint8Array(await result.arrayBuffer())],[1,2,3]);
});
test('stopping a voice request aborts the upstream generation signal',async()=>{
 let upstream,entered;const ready=new Promise(resolve=>entered=resolve);
 const {POST}=route(async(url,options)=>{upstream=options.signal;entered();return new Promise((resolve,reject)=>upstream.addEventListener('abort',()=>reject(upstream.reason),{once:true}));});
 const controller=new AbortController();const pending=POST(request(controller.signal));await ready;assert.equal(upstream.aborted,false);controller.abort();const result=await pending;assert.equal(upstream.aborted,true);assert.equal(result.status,504);
});
test('voice auth still rejects requests before contacting the provider',async()=>{
 let calls=0;const {POST}=route(async()=>{calls++;throw new Error('Must not reach provider');},{REQUIRE_USER_AUTH:'true'});const result=await POST(request());assert.equal(result.status,401);assert.equal(calls,0);
});
