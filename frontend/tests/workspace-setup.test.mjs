import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,find,textOf,button} from './support/component-harness.mjs';

function panel(fetcher){
  const env=environment(),view=renderer(env);
  const {WorkspaceSetup}=load('../src/components/WorkspaceSetup.tsx',{react:view.react,'./ModelConnections':{ModelConnections:'model-connections'}},{...env.globals,React:view.react.default,fetch:fetcher,setInterval:()=>1,clearInterval(){}});
  view.mount(()=>WorkspaceSetup({onClose(){}}));
  return view;
}

test('runtime probe failures stay unknown and retry without claiming the cloud is disconnected',async()=>{
  let runtimeCalls=0;
  const view=panel(async url=>{
    if(url==='/api/connections')throw Error('Settings service offline');
    if(++runtimeCalls===1)throw Error('Runtime service offline');
    if(runtimeCalls===2)return {ok:true,json:async()=>({connected:true,worker:false,database:true,model_configured:true})};
    return {ok:true,json:async()=>({connected:true,worker:false,database:true,model_configured:true,model_transport:'direct'})};
  });
  await view.flush();
  assert.match(textOf(view.tree),/Connection status unavailable/);
  assert.match(textOf(view.tree),/Could not check Cypher’s connection/);
  assert.doesNotMatch(textOf(view.tree),/Cypher is not connected|Saved work needs attention|Connect Gemini|Test Gemini connection|Get a Gemini API key/);
  button(view.tree,'Refresh').props.onClick();
  await view.flush();
  assert.match(textOf(view.tree),/Background work needs attention/);
  assert.doesNotMatch(textOf(view.tree),/Could not check Cypher’s connection/);
  assert.match(textOf(view.tree),/AI connection not confirmed/);
  assert.doesNotMatch(textOf(view.tree),/Connect Gemini|Test Gemini connection|Get a Gemini API key/);
  button(view.tree,'Refresh').props.onClick();
  await view.flush();
  assert.match(textOf(view.tree),/Connect Gemini/);
  assert.match(textOf(view.tree),/Test Gemini connection/);
  view.unmount();
});

test('connection-settings request failures do not mark a healthy runtime disconnected',async()=>{
  const view=panel(async url=>url==='/api/connections'?Promise.reject(Error('Settings service offline')):{ok:true,json:async()=>({connected:true,worker:true,database:true})});
  await view.flush();
  assert.match(textOf(view.tree),/Cypher is connected/);
  assert.doesNotMatch(textOf(view.tree),/Cypher is not connected|Could not check Cypher’s connection/);
  assert.equal(find(view.tree,node=>node.props?.role==='alert'),undefined);
  view.unmount();
});

test('deployment guide links directly to the canonical Cypher setup file',async()=>{
  const view=panel(async()=>({ok:true,json:async()=>({})}));
  await view.flush();
  const guide=find(view.tree,node=>node.type==='a'&&textOf(node)==='Open setup instructions');
  assert.ok(guide);
  assert.equal(guide.props.href,'https://github.com/HIveAppDeveloper/cypher/blob/main/SETUP.md');
  view.unmount();
});

test('subscription guidance keeps setup in Cypher without fetching a dashboard link',async()=>{
  const calls=[];const view=panel(async url=>{calls.push(url);return {ok:true,json:async()=>({connected:true,worker:true,model_transport:'omniroute',can_manage_model_connections:true})};});
  await view.flush();assert.deepEqual(calls,['/api/runtime']);
  assert.equal(find(view.tree,node=>node.type==='a'&&textOf(node).includes('OmniRoute')),undefined);
  assert.match(textOf(view.tree),/Browser subscription sign-in is unavailable/);view.unmount();
});
