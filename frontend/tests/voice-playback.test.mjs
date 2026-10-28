import {test} from 'node:test';
import assert from 'node:assert/strict';
import {load,environment} from './support/component-harness.mjs';
const tick = async () => { for(let i=0;i<30;i++)await Promise.resolve(); };
function setup(streaming=true,opening='auto') {
  const env=environment();
  class TrackedTarget extends EventTarget {
    listeners=new Map();
    addEventListener(type,callback,options){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(callback);super.addEventListener(type,callback,options);}
    removeEventListener(type,callback,options){this.listeners.get(type)?.delete(callback);super.removeEventListener(type,callback,options);}
    count(type){return this.listeners.get(type)?.size||0;}
  }
  const urls=new Map(),revoked=[];let sequence=0,plays=0,played=0;
  class Source extends TrackedTarget {
    static isTypeSupported=()=>streaming;
    readyState='closed';
    addSourceBuffer(){return Object.assign(new TrackedTarget(),{appendBuffer(){queueMicrotask(()=>this.dispatchEvent(new Event('updateend')));}});}
    endOfStream(){this.readyState='ended';queueMicrotask(()=>audio.dispatchEvent(new Event('ended')));}
  }
  const audio=Object.assign(new TrackedTarget(),{
    _src:'',getAttribute(){return this._src;},removeAttribute(){this._src='';},load(){},pause(){},
    async play(){plays++;this.dispatchEvent(new Event('playing'));},
  });
  Object.defineProperty(audio,'src',{get(){return this._src;},set(url){this._src=url;const source=urls.get(url);if(source instanceof Source&&opening==='auto')queueMicrotask(()=>{source.readyState='open';source.dispatchEvent(new Event('sourceopen'));});else if(source instanceof Source&&opening==='error')queueMicrotask(()=>audio.dispatchEvent(new Event('error')));}});
  const module=load('../src/lib/voice-playback.ts',{}, {AbortSignal,AbortController,Uint8Array,Event,setTimeout:env.time.setTimeout,clearTimeout:env.time.clearTimeout,MediaSource:Source,URL:{createObjectURL(value){const url='blob:'+(++sequence);urls.set(url,value);return url;},revokeObjectURL(url){revoked.push(url);urls.delete(url);}}});
  return {...module,audio,revoked,urls,time:env.time,get plays(){return plays;},get played(){return played;},onPlaying(){played++;}};
}
test('progressive MP3 starts playing before the response finishes downloading',async()=>{
  const f=setup();let body;
  const response=new Response(new ReadableStream({start(c){body=c;}}),{headers:{'Content-Type':'audio/mpeg'}});
  const pending=f.playVoiceResponse(response,f.audio,new AbortController().signal,f.onPlaying);
  body.enqueue(new Uint8Array([1,2,3]));await tick();
  assert.equal(f.plays,1);assert.equal(f.played,1);assert.equal(f.revoked.length,0);
  assert.equal(f.time.pending,0,'successful opening clears its startup deadline');
  f.time.advance(6000);await tick();assert.equal(f.revoked.length,0,'startup budget must not cut off a playing reply');
  body.enqueue(new Uint8Array([4,5,6]));body.close();await pending;
  assert.equal(f.plays,1);assert.equal(f.revoked.length,1);assert.equal(f.audio.src,'');
});
test('Stop cancels a stalled stream and frees the source, then restart plays normally',async()=>{
  const f=setup();let body,cancelled=false;
  const response=new Response(new ReadableStream({start(c){body=c;},cancel(){cancelled=true;}}),{headers:{'Content-Type':'audio/mpeg'}});
  const controller=new AbortController();const pending=f.playVoiceResponse(response,f.audio,controller.signal,f.onPlaying);
  body.enqueue(new Uint8Array([1,2,3]));await tick();controller.abort();
  await assert.rejects(pending,{name:'AbortError'});assert.equal(cancelled,true);assert.equal(f.audio.src,'');
  await f.playVoiceResponse(new Response(new Uint8Array([7,8]),{headers:{'Content-Type':'audio/mpeg'}}),f.audio,new AbortController().signal,f.onPlaying);
  assert.equal(f.plays,2);assert.equal(f.revoked.length,2);
});
test('unsupported MSE preserves buffered audio playback',async()=>{
  const f=setup(false);const pending=f.playVoiceResponse(new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'audio/mpeg'}}),f.audio,new AbortController().signal,f.onPlaying);
  await tick();assert.equal(f.plays,1);f.audio.dispatchEvent(new Event('ended'));await pending;assert.equal(f.revoked.length,1);
});
test('Stop during buffered download never starts stale audio',async()=>{
  const f=setup(false);let body;
  const response=new Response(new ReadableStream({start(c){body=c;}}));const controller=new AbortController();
  const pending=f.playVoiceResponse(response,f.audio,controller.signal,f.onPlaying);await tick();controller.abort();
  await assert.rejects(pending,{name:'AbortError'});body.enqueue(new Uint8Array([1,2]));body.close();await tick();assert.equal(f.plays,0);assert.equal(f.urls.size,0);
});
test('play rejection cancels response download and releases the media source',async()=>{
  const f=setup();let cancelled=false;
  f.audio.play=async()=>{throw new Error('Playback blocked');};
  const response=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2,3]));},cancel(){cancelled=true;}}),{headers:{'Content-Type':'audio/mpeg'}});
  await assert.rejects(f.playVoiceResponse(response,f.audio,new AbortController().signal,f.onPlaying),/Playback blocked/);
  assert.equal(cancelled,true);assert.equal(f.urls.size,0);
});
test('an already cancelled session allocates no audio source',async()=>{
  const f=setup();const c=new AbortController();c.abort();await assert.rejects(f.playVoiceResponse(new Response('abc'),f.audio,c.signal,f.onPlaying),{name:'AbortError'});assert.equal(f.urls.size,0);
});


test('a stalled MSE sourceopen fails within its startup budget and releases the pending response',async()=>{
  const f=setup(true,'stalled');let cancelled=false,settled=false,failure;
  const response=new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'Content-Type':'audio/mpeg'}});
  const controller=new AbortController();const pending=f.playVoiceResponse(response,f.audio,controller.signal,f.onPlaying);
  pending.then(()=>{settled=true;},error=>{settled=true;failure=error;});
  const source=f.urls.get(f.audio.src);
  try {
    await tick();f.time.advance(4999);await tick();assert.equal(settled,false);
    f.time.advance(1);await tick();assert.equal(settled,true,'missing sourceopen must not leave voice thinking indefinitely');
    assert.match(failure?.message||'',/too long to start/i);
    assert.equal(cancelled,true);assert.equal(f.audio.src,'');assert.equal(f.urls.size,0);assert.equal(f.time.pending,0);
    assert.equal(source.count('sourceopen'),0);assert.equal(source.count('error'),0);
    assert.equal(f.audio.count('error'),0);assert.equal(f.audio.count('playing'),0);
    source.readyState='open';source.dispatchEvent(new Event('sourceopen'));await tick();assert.equal(f.plays,0,'a late open cannot revive timed-out playback');
  }finally{controller.abort();await pending.catch(()=>{});}
});

test('an audio error before sourceopen rejects promptly for caller fallback and removes startup listeners',async()=>{
  const f=setup(true,'error');let cancelled=false,settled=false,failure;
  const response=new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'Content-Type':'audio/mpeg'}});
  const controller=new AbortController();const pending=f.playVoiceResponse(response,f.audio,controller.signal,f.onPlaying);
  pending.then(()=>{settled=true;},error=>{settled=true;failure=error;});
  const source=f.urls.get(f.audio.src);
  try {
    await tick();assert.equal(settled,true,'audio error must reach the caller before sourceopen or its timeout');
    assert.match(failure?.message||'',/could not be played/i);
    assert.equal(cancelled,true);assert.equal(f.plays,0);assert.equal(f.audio.src,'');assert.equal(f.urls.size,0);assert.equal(f.time.pending,0);
    assert.equal(source.count('sourceopen'),0);assert.equal(source.count('error'),0);assert.equal(f.audio.count('error'),0);
  }finally{controller.abort();await pending.catch(()=>{});}
});

test('Stop while MSE is opening cancels its response and clears the startup deadline',async()=>{
  const f=setup(true,'stalled');let cancelled=false;
  const response=new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'Content-Type':'audio/mpeg'}});
  const controller=new AbortController();const pending=f.playVoiceResponse(response,f.audio,controller.signal,f.onPlaying);
  const source=f.urls.get(f.audio.src);await tick();controller.abort();
  await assert.rejects(pending,{name:'AbortError'});await tick();
  assert.equal(cancelled,true);assert.equal(f.audio.src,'');assert.equal(f.urls.size,0);assert.equal(f.time.pending,0);
  assert.equal(source.count('sourceopen'),0);assert.equal(source.count('error'),0);assert.equal(f.audio.count('error'),0);
  f.time.advance(6000);source.dispatchEvent(new Event('sourceopen'));await tick();assert.equal(f.plays,0);
});
