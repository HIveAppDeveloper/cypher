import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,find,textOf,button} from './support/component-harness.mjs';

const item={id:'xai',name:'xAI',model:'grok',state:'not_checked',message:'Not checked',account_url:'https://x.ai',can_add_api_key:true,requires_api_key:true};
function panel({items=[item],canManage=true,fetcher=async()=>({ok:true,json:async()=>({})}),onQueued=async()=>{}}={}){
  const env=environment(),view=renderer(env);
  const {ModelConnections}=load('../src/components/ModelConnections.tsx',{react:view.react},{...env.globals,React:view.react.default,fetch:fetcher});
  view.mount(()=>ModelConnections({items,canManage,workerReady:true,onQueued,omniroute:false}));
  return view;
}

test('an empty model-connection list explains where configuration is managed',()=>{
  const view=panel({items:[]});
  assert.match(textOf(view.tree),/No provider connections are configured for this workspace/);
  assert.equal(find(view.tree,node=>node.type==='ul'&&node.props?.className==='model-connection-list'),undefined);
  view.unmount();
});

test('failed API-key verification clears the key and leaves a recoverable error',async()=>{
  let request;
  const view=panel({fetcher:async(url,options)=>{request={url,options};return {ok:false,json:async()=>({detail:'Synthetic provider rejection'})};}});
  button(view.tree,'Use API key').props.onClick();await view.flush();
  const key=find(view.tree,node=>node.type==='input'&&node.props?.type==='password');
  key.props.onChange({target:{value:'synthetic-secret'}});await view.flush();
  find(view.tree,node=>node.type==='form').props.onSubmit({preventDefault(){}});await view.flush();
  assert.equal(request.url,'/api/runtime/model-connections/xai/api-key');
  assert.deepEqual(JSON.parse(request.options.body),{api_key:'synthetic-secret'});
  assert.match(textOf(view.tree),/Synthetic provider rejection/);
  assert.doesNotMatch(textOf(view.tree),/synthetic-secret/);
  assert.equal(find(view.tree,node=>node.type==='input'&&node.props?.type==='password'),undefined);
  view.unmount();
});
