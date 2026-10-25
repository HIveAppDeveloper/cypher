import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,find,textOf,button} from './support/component-harness.mjs';

test('dismissing an initial SEC load error keeps retry and unavailable status until recovery',async()=>{
  const env=environment(),view=renderer(env);
  let founderCalls=0;
  const page={database:{records:0,explicit_founder_signals:0,matched_records:0,snapshot_ready:false,snapshot_built_at:null,quarters:[],quarter_count:0,historical:{status:'idle',total_quarters:0,processed_quarters:0,current_quarter:null,error:null},source:'Synthetic fixture'},items:[],page:{limit:25,offset:0,returned:0},limitations:[]};
  class ApiError extends Error {}
  const request=async path=>{
    if(path.startsWith('/prospecting/investors/founders?')){
      founderCalls++;
      if(founderCalls===1)throw new ApiError('Synthetic SEC service failure');
      return page;
    }
    if(path==='/prospecting/investors/runs')return [];
    throw new Error('Unexpected request: '+path);
  };
  const {default:Workspace}=load('../src/components/VcProspectingWorkspace.tsx',{react:view.react,'../lib/api':{ApiError,request},'./WorkflowShell':{__esModule:true,default:'workflow-shell'},'./vc-prospecting.css':{}},{...env.globals,React:view.react.default,URLSearchParams});
  view.mount(()=>Workspace({}));
  await view.flush();
  assert.match(textOf(view.tree),/Could not load SEC data/);
  assert.ok(button(view.tree,'Retry'));

  button(view.tree,'Dismiss').props.onClick();
  await view.flush();
  assert.match(textOf(view.tree),/Could not load SEC data/,'dismiss only clears the detailed error');
  assert.ok(button(view.tree,'Retry'),'recovery remains available after dismiss');
  assert.doesNotMatch(textOf(view.tree),/Ready to find public data/,'failed unloaded data must not appear ready');

  button(view.tree,'Retry').props.onClick();
  await view.flush();
  assert.equal(founderCalls,2);
  assert.match(textOf(view.tree),/Ready to find public data/);
  assert.doesNotMatch(textOf(view.tree),/Could not load SEC data/);
  view.unmount();
});
