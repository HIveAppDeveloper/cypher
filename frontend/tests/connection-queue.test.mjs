import {test} from 'node:test';
import assert from 'node:assert/strict';
import {load,deferred} from './support/component-harness.mjs';
const {ConnectionQueue,untilAborted}=load('../src/lib/connectionQueue.ts');
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};

test('starts only explicit selections, serializes starts, deduplicates and advances after failure or consent wait',async()=>{
  const first=deferred(),starts=[],snapshots=[];
  const queue=new ConnectionQueue(async item=>{starts.push(item);if(item==='A')return first.promise;if(item==='B')throw Error('Unavailable');return {state:'waiting'};},jobs=>snapshots.push(jobs));
  assert.equal(queue.enqueue('A','A'),true);assert.equal(queue.enqueue('A','A'),false);
  queue.enqueue('B','B');queue.enqueue('C','C');await tick();assert.deepEqual(starts,['A']);
  first.resolve({state:'waiting'});await tick();assert.deepEqual(starts,['A','B','C']);
  const states=Object.fromEntries(snapshots.at(-1).map(job=>[job.key,job.state]));
  assert.deepEqual(states,{A:'waiting',B:'failed',C:'waiting'});
  assert.equal(queue.enqueue('B','B'),true);await tick();assert.deepEqual(starts,['A','B','C','B']);
});

test('cancels queued work and stops starting work after disposal',async()=>{
  const first=deferred(),starts=[];
  const queue=new ConnectionQueue(async item=>{starts.push(item);return first.promise;},()=>{});
  queue.enqueue('A','A');queue.enqueue('B','B');queue.enqueue('C','C');
  assert.equal(queue.cancel('B'),true);queue.dispose();first.resolve({state:'waiting'});await tick();
  assert.deepEqual(starts,['A']);assert.equal(queue.enqueue('D','D'),false);
});

test('limits outstanding selections and permits new work after terminal state',async()=>{
  const queue=new ConnectionQueue(async()=>({state:'waiting'}),()=>{},2);
  assert.equal(queue.enqueue('A','A'),true);assert.equal(queue.enqueue('B','B'),true);assert.equal(queue.enqueue('C','C'),false);
  await tick();queue.update('A','connected');assert.equal(queue.enqueue('C','C'),true);await tick();
});


test('cancelling an active item signals its operation and lets the next start',async()=>{
  const first=deferred(),starts=[],cancelled=[];
  const queue=new ConnectionQueue(async item=>{starts.push(item);if(item==='A')return first.promise;return {state:'waiting'};},()=>{},2,item=>{cancelled.push(item);first.reject(Error('stopped'));});
  queue.enqueue('A','A');queue.enqueue('B','B');assert.equal(queue.cancel('A'),true);await tick();
  assert.deepEqual(cancelled,['A']);assert.deepEqual(starts,['A','B']);
});


test('an already-aborted operation is never started',async()=>{
  const controller=new AbortController();controller.abort();let invoked=false;
  await assert.rejects(untilAborted(()=>{invoked=true;return Promise.reject(Error('unhandled'));},controller.signal));
  assert.equal(invoked,false);
});
