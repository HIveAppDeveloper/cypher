import {test} from 'node:test';
import assert from 'node:assert/strict';
import {load} from './support/component-harness.mjs';
const tick = async () => { for(let i=0;i<30;i++)await Promise.resolve(); };
function setup(streaming=true) {
  const urls=new Map(),revoked=[];let sequence=0,plays=0,played=0;
  class Source extends EventTarget {
    static isTypeSupported=()=>streaming;
    readyState='closed';
    addSourceBuffer(){return Object.assign(new EventTarget(),{appendBuffer(){queueMicrotask(()=>this.dispatchEvent(new Event('updateend')));}});}
    endOfStream(){this.readyState='ended';queueMicrotask(()=>audio.dispatchEvent(new Event('ended')));}
  }
  const audio=Object.assign(new EventTarget(),{
    _src:'',getAttribute(){return this._src;},removeAttribute(){this._src='';},load(){},pause(){},
    async play(){plays++;this.dispatchEvent(new Event('playing'));},
  });
  Object.defineProperty(audio,'src',{get(){return this._src;},set(url){this._src=url;const source=urls.get(url);if(source instanceof Source)queueMicrotask(()=>{source.readyState='open';source.dispatchEvent(new Event('sourceopen'));});}});
  const module=load('../src/lib/voice-playback.ts',{}, {AbortSignal,AbortController,Uint8Array,Event,MediaSource:Source,URL:{createObjectURL(value){const url='blob:'+(++sequence);urls.set(url,value);return url;},revokeObjectURL(url){revoked.push(url);urls.delete(url);}}});
  return {...module,audio,revoked,urls,get plays(){return plays;},get played(){return played;},onPlaying(){played++;}};
}
test('progressive MP3 starts playing before the response finishes downloading',async()=>{
  const f=setup();let body;
  const response=new Response(new ReadableStream({start(c){body=c;}}),{headers:{'Content-Type':'audio/mpeg'}});
  const pending=f.playVoiceResponse(response,f.audio,new AbortController().signal,f.onPlaying);
  body.enqueue(new Uint8Array([1,2,3]));await tick();
  assert.equal(f.plays,1);assert.equal(f.played,1);assert.equal(f.revoked.length,0);
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
