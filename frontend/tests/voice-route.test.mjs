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

const kokoroEnv = {KOKORO_TTS_ENABLED:'true',KOKORO_INTERNAL_URL:'http://kokoro.internal',GROKBOT_BACKEND_API_TOKEN:'local-test-fixture-not-a-live-key-0000'};
test('opt-in Kokoro uses the private binding and MP3 contract without exposing internal credentials',async()=>{
 let seen;
 const {POST}=route(async(url,options)=>{seen={url,options};return new Response(new Uint8Array([0xff,0xfb]),{headers:{'Content-Type':'audio/mpeg','X-Server-First-Audio-Ms':'145.123','Authorization':'must-not-forward','X-Internal-URL':'must-not-forward'}});},kokoroEnv);
 const result=await POST(request());assert.equal(result.status,200);
 assert.equal(String(seen.url),'http://kokoro.internal/v1/audio/speech');
 assert.equal(seen.options.headers.Authorization,'Bearer '+kokoroEnv.GROKBOT_BACKEND_API_TOKEN);
 assert.equal(seen.options.headers['xi-api-key'],undefined);
 assert.deepEqual(JSON.parse(seen.options.body),{model:'kokoro',input:'Voice latency fixture.',voice:'af_bella',response_format:'mp3',speed:1});
 assert.match(result.headers.get('server-timing'),/tts_first_audio;dur=145.123/);
 assert.equal(result.headers.get('x-voice-provider'),'kokoro');
 assert.equal(result.headers.get('authorization'),null);assert.equal(result.headers.get('x-internal-url'),null);
 assert.deepEqual([...new Uint8Array(await result.arrayBuffer())],[0xff,0xfb]);
});
test('Kokoro opt-in without a binding or key fails closed despite existing ElevenLabs credentials',async()=>{
 for(const env of [{KOKORO_TTS_ENABLED:'true'},{...kokoroEnv,GROKBOT_BACKEND_API_TOKEN:''}]){
  let calls=0;const {GET,POST}=route(async()=>{calls++;throw new Error('Must not reach provider');},env);
  assert.equal((await (await GET()).json()).configured,false);
  assert.equal((await POST(request())).status,503);assert.equal(calls,0);
 }
});
test('a binding alone does not change the existing provider',async()=>{
 let url;const {POST}=route(async(value)=>{url=String(value);return new Response('audio',{headers:{'Content-Type':'audio/mpeg'}});},{...kokoroEnv,KOKORO_TTS_ENABLED:'false'});
 assert.equal((await POST(request())).status,200);assert.match(url,/api.elevenlabs.io/);
});
test('Kokoro auth rejects unsigned app requests before calling the private service',async()=>{
 let calls=0;const {POST}=route(async()=>{calls++;},{...kokoroEnv,REQUIRE_USER_AUTH:'true'});
 assert.equal((await POST(request())).status,401);assert.equal(calls,0);
});
test('Kokoro never buffers the full response and downstream cancellation cancels the upstream body',async()=>{
 let body,cancelled=false,signal;
 const {POST}=route(async(_url,options)=>{signal=options.signal;return new Response(new ReadableStream({start(c){body=c;},cancel(){cancelled=true;}}),{headers:{'Content-Type':'audio/mpeg'}});},kokoroEnv);
 const abort=new AbortController();const result=await POST(request(abort.signal));const reader=result.body.getReader();
 body.enqueue(new Uint8Array([0xff,0xfb]));assert.deepEqual([...(await reader.read()).value],[0xff,0xfb]);
 // Still open: one delivered chunk proves we do not await the whole clip.
 abort.abort();assert.equal(signal.aborted,true);await reader.cancel();assert.equal(cancelled,true);
});
test('Kokoro rejects wrong content type and cancels provider error bodies',async()=>{
 for(const status of [200,401,429,503]){
  let cancelled=false;const {POST}=route(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{status,headers:{'Content-Type':'application/json'}}),kokoroEnv);
  assert.equal((await POST(request())).status,status===429?429:502);assert.equal(cancelled,true);
 }
});
