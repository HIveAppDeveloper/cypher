import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,deferred,find,textOf,button} from './support/component-harness.mjs';
import * as catalog from '../src/lib/gateway-connections.mjs';

const item={id:'xai',name:'xAI',model:'grok',state:'not_checked',message:'Not checked',account_url:'https://x.ai',can_add_api_key:true,requires_api_key:true};
function panel({items=[item],canManage=true,fetcher=async()=>({ok:true,json:async()=>({})}),onQueued=async()=>{},omniroute=false,manageUrl}={}){
  const env=environment(),view=renderer(env);
  const {ModelConnections}=load('../src/components/ModelConnections.tsx',{react:view.react,'../lib/gateway-connections.mjs':catalog},{...env.globals,React:view.react.default,fetch:fetcher,AbortSignal,URL,encodeURIComponent});
  view.mount(()=>ModelConnections({items,canManage,workerReady:true,onQueued,omniroute,manageUrl}));
  return view;
}

test('an empty model-connection list explains where configuration is managed',()=>{
  const view=panel({items:[]});
  assert.match(textOf(view.tree),/No provider connections are configured for this workspace/);
  assert.equal(find(view.tree,node=>node.type==='ul'&&node.props?.className==='model-connection-list'),undefined);
  view.unmount();
});

test('explicit provider checks request an account and remain queued after a status refresh failure',async()=>{
  let requests=0,body;
  const pending=deferred();
  const view=panel({items:[{...item,requires_api_key:false}],omniroute:true,fetcher:async(_url,options)=>{requests++;body=JSON.parse(options.body);return pending.promise;},onQueued:async()=>{throw Error('Synthetic status offline');}});
  const check=button(view.tree,'Check provider access');check.props.onClick();check.props.onClick();
  await view.flush();assert.equal(requests,1);assert.deepEqual(body,{target:'provider_account'});
  pending.resolve({ok:true,json:async()=>({status:'pending',verification_target:'provider_account'})});await view.flush();
  assert.match(textOf(view.tree),/check is queued in the cloud/);
  assert.match(textOf(view.tree),/Your check continues/);
  assert.ok(button(view.tree,'Queued…').props.disabled);
  view.unmount();
});

test('a public Llama check never requests a Meta account or presents API key enrollment',async()=>{
  let body,path;
  const view=panel({items:[{...item,id:'meta',name:'Meta / Llama',requires_api_key:false,can_add_api_key:false,access_kind:'public',access_label:'Public model route',verified_model:'meta-llama/llama-3.3-70b-instruct-fp8-fast'}],omniroute:true,fetcher:async(url,options)=>{path=url;body=JSON.parse(options.body);return{ok:true,json:async()=>({status:'pending',verification_target:'current_route'})};}});
  assert.match(textOf(view.tree),/Does not verify a subscription/);
  assert.equal(find(view.tree,node=>node.type==='input'&&node.props?.type==='password'),undefined);
  button(view.tree,'Test Llama text route').props.onClick();await view.flush();
  assert.equal(path,'/api/runtime/model-connections/meta/verify');assert.deepEqual(body,{target:'current_route'});
  view.unmount();
});

test('saved OpenAI checks are explicitly route-only and reject an account-scope acknowledgement',async()=>{
 for(const target of ['current_route','provider_account']){
  let body,path;
  const view=panel({items:[{...item,id:'openai',name:'ChatGPT',state:'ready',requires_api_key:false,can_add_api_key:false,verification_target:'current_route',verification_scope:'current_route',account_connected:false,access_kind:'account',access_label:'Gateway account route',verified_model:'gpt-6.1-sol'}],fetcher:async(url,options)=>{path=url;body=JSON.parse(options.body);return{ok:true,json:async()=>({status:'pending',verification_target:target})};}});
  assert.match(textOf(view.tree),/Route available/);assert.match(textOf(view.tree),/Gateway model route/);assert.doesNotMatch(textOf(view.tree),/Gateway account route|Verified/);
  button(view.tree,'Test gateway route').props.onClick();await view.flush();assert.equal(path,'/api/runtime/model-connections/openai/verify');assert.deepEqual(body,{target:'current_route'});
  if(target==='current_route')assert.match(textOf(view.tree),/Queued in the cloud/);else assert.match(textOf(view.tree),/did not confirm this type of check/);
  view.unmount();
 }
});

test('unavailable verification keeps provider setup available without sending a request',async()=>{
  let requests=0;
  const view=panel({items:[{...item,verification_supported:false}],omniroute:true,manageUrl:'https://gateway.example/dashboard/providers',fetcher:async()=>{requests++;throw Error('Unexpected provider call');}});
  assert.match(textOf(view.tree),/verification is unavailable/);
  assert.ok(find(view.tree,node=>node.type==='a'&&textOf(node)==='Open xAI account'));
  assert.equal(button(view.tree,'Check provider access'),undefined);assert.equal(requests,0);
  view.unmount();
});

test('an old or different server check target cannot silently stand in for an account check',async()=>{
  const view=panel({items:[{...item,requires_api_key:false}],fetcher:async()=>({ok:true,json:async()=>({status:'pending',verification_target:'current_route'})})});
  button(view.tree,'Check provider access').props.onClick();await view.flush();
  assert.match(textOf(view.tree),/did not confirm this type of check/);
  assert.doesNotMatch(textOf(view.tree),/Verified/);
  view.unmount();
});

test('an accepted request finishing after setup closes cannot write late UI state',async()=>{
  const pending=deferred();
  const view=panel({items:[{...item,requires_api_key:false}],fetcher:async()=>pending.promise});
  button(view.tree,'Check provider access').props.onClick();view.unmount();
  pending.resolve({ok:true,json:async()=>({status:'pending',verification_target:'provider_account'})});await view.flush();
  assert.equal(view.updatesAfterUnmount,0);
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

 test('provider actions never open a gateway dashboard or require a gateway login',()=>{
  const view=panel({omniroute:true,manageUrl:'https://gateway.example/dashboard/providers'});
  assert.equal(find(view.tree,node=>node.type==='a'&&node.props?.href?.includes('gateway.example')),undefined);
  assert.ok(find(view.tree,node=>node.type==='a'&&node.props?.href==='https://x.ai'));
  assert.doesNotMatch(textOf(view.tree),/Connect accounts in OmniRoute/);view.unmount();
});
