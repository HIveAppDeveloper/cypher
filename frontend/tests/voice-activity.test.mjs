import {test} from 'node:test';
import assert from 'node:assert/strict';
import {load} from './support/component-harness.mjs';
const {VoiceSilenceTimer}=load('../src/lib/voice-activity.ts');
test('normal frame sampling still ends an utterance after 850ms observed silence',()=>{
 const timer=new VoiceSilenceTimer(0);assert.equal(timer.update(0,true),false);
 for(let t=50;t<850;t+=50)assert.equal(timer.update(t,false),false);
 assert.equal(timer.update(850,false),true);
});
test('a busy main thread cannot truncate speech by treating its missing frames as silence',()=>{
 const timer=new VoiceSilenceTimer(0);timer.update(50,true);
 assert.equal(timer.update(1500,false),false,'a 1.45-second sample gap only contributes 100ms');
 assert.equal(timer.update(1550,true),false,'the next voiced frame resets silence');
 for(let t=1600;t<2400;t+=50)assert.equal(timer.update(t,false),false);
 assert.equal(timer.update(2400,false),true);
});
test('long recordings still stop at the monotonic 45-second maximum',()=>{
 const timer=new VoiceSilenceTimer(500);assert.equal(timer.update(45499,true),false);assert.equal(timer.update(45500,true),true);
});
