import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,deferred,textOf,button} from './support/component-harness.mjs';

const connected={configured:true,connected:true,email:'synthetic@example.test',services:['gmail'],offline_access:true,tool_count:1,failures:{},choices:[{id:'gmail',name:'Gmail',description:'Authorized email tools'}]};
const response=(data,ok=true)=>({ok,json:async()=>data});
function page(fetch){
 const env=environment(),view=renderer(env);
 env.window.location={replace(){},assign(){}};
 const {GoogleConnections}=load('../src/components/GoogleConnections.tsx',{react:view.react,'./cipher/CypherMark':{__esModule:true,default:'cypher-mark'},'../lib/device':{approveConnection:async()=>undefined}},{...env.globals,React:view.react.default,fetch,AbortSignal});
 view.mount(()=>GoogleConnections({}));
 return view;
}

test('a completed Google disconnect cannot be undone by an unsuccessful status response',async()=>{
 let gets=0,deletes=0;
 const view=page(async(url,options)=>{
  if(options?.method==='DELETE'){deletes++;return response({status:'disconnected'});}
  assert.equal(url,'/api/google/status');gets++;
  return gets===1?response(connected):response({...connected,email:'must-not-render@example.test'},false);
 });
 await view.flush();assert.match(textOf(view.tree),/Connected as synthetic/);
 button(view.tree,'Disconnect Google').props.onClick();await view.flush();await view.flush();
 assert.equal(deletes,1);assert.equal(gets,2);
 assert.doesNotMatch(textOf(view.tree),/Connected as|must-not-render/);
 assert.match(textOf(view.tree),/Google was disconnected/);
 assert.ok(button(view.tree,'Reload connections'));
 view.unmount();
});

test('a rejected Google disconnect preserves the working grant and reports failure',async()=>{
 const view=page(async(_url,options)=>options?.method==='DELETE'?response({detail:'Synthetic disconnect rejected'},false):response(connected));
 await view.flush();button(view.tree,'Disconnect Google').props.onClick();await view.flush();
 assert.match(textOf(view.tree),/Connected as synthetic/);
 assert.match(textOf(view.tree),/Synthetic disconnect rejected/);
 view.unmount();
});

test('closing Google setup while its disconnect status refresh is pending makes no late state updates',async()=>{
 const pending=deferred();let gets=0;
 const view=page(async(_url,options)=>options?.method==='DELETE'?response({status:'disconnected'}):++gets===1?response(connected):pending.promise);
 await view.flush();button(view.tree,'Disconnect Google').props.onClick();await view.flush();
 assert.doesNotMatch(textOf(view.tree),/Connected as/);
 view.unmount();pending.resolve(response({...connected,connected:false}));await view.flush();
 assert.equal(view.updatesAfterUnmount,0);
});
