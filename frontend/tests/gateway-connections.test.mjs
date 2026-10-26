import test from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,find,textOf,button,field,deferred} from './support/component-harness.mjs';
import * as catalog from '../src/lib/gateway-connections.mjs';

function mount({preview=false,owner=true,items=[],fetchImpl}={}){
  const env=environment(),view=renderer(env),calls=[],destinations=[];
  env.window.location={assign:value=>destinations.push(value)};
  const baseElement=env.element;env.element=props=>baseElement({closest:()=>null,...props});
  const Component=load('../src/components/GatewayConnections.tsx',{react:view.react,'./GatewayProviderLogo':{GatewayProviderLogo:'provider-logo'},'../lib/gateway-connections.mjs':catalog},{...env.globals,React:view.react.default,fetch:async(path,options)=>{calls.push({path,...options});return fetchImpl?fetchImpl(path,options):{ok:true,json:async()=>({status:'pending'})}},setInterval:()=>1,clearInterval:()=>{}}).GatewayConnections;
  view.mount(()=>Component({items,canManage:owner,workerReady:true,preview,onRefresh:async()=>{}}));
  return {view,calls,destinations,env,select:async id=>{find(view.tree,n=>n.type==='button'&&n.props['data-provider']===catalog.gatewayProviders.find(p=>p.name===id).id).props.onClick();await view.flush();}};
}
test('catalog connects internally, and a preview never claims real account verification',async()=>{
  const app=mount({preview:true,items:[{id:'openai',state:'ready',account_connected:true}]});await app.view.flush();
  assert.ok(!textOf(app.view.tree).includes('Account connected'));assert.match(textOf(app.view.tree),/Account sign-in unavailable/);assert.ok(find(app.view.tree,n=>n.type==='button'&&n.props['aria-label']==='View setup for ChatGPT'));assert.match(textOf(app.view.tree),/Preview/);
  assert.equal(find(app.view.tree,n=>n.type==='a'&&String(n.props.href).includes('omniroute')),undefined);
  await app.select('ChatGPT');assert.match(textOf(app.view.tree),/local preview/);assert.equal(app.calls.length,0);
  app.view.unmount();
});
test('provider key is cleared immediately, queued once, and never put in a URL',async()=>{
  const waiting=deferred(),app=mount({items:[{id:'claude',state:'not_checked',can_add_api_key:true}],fetchImpl:()=>waiting.promise});await app.select('Claude');
  field(app.view.tree,'gc-provider-key').props.onChange({target:{value:'fixture-secret-provider-key'}});await app.view.flush();
  const form=find(app.view.tree,n=>n.type==='form');const first=form.props.onSubmit({preventDefault(){}});form.props.onSubmit({preventDefault(){}});await app.view.flush();
  assert.equal(app.calls.length,1);assert.equal(app.calls[0].path,'/api/runtime/model-connections/claude/api-key');assert.deepEqual(JSON.parse(app.calls[0].body),{api_key:'fixture-secret-provider-key'});assert.equal(field(app.view.tree,'gc-provider-key').props.value,'');
  waiting.resolve({ok:true,json:async()=>({status:'pending'})});await first;await app.view.flush();assert.match(textOf(app.view.tree),/Checking in the cloud/);app.view.unmount();
});
test('only server-advertised same-origin begin actions can open an approved provider URL',async()=>{
  assert.equal(catalog.connectionBeginPath({id:'openai',can_connect:true,connect_url:'https://omniroute.example/connect'}),null);
  assert.equal(catalog.connectionBeginPath({id:'openai',connect_url:'/api/model-connections/openai/begin'}),null);
  const app=mount({items:[{id:'openai',can_connect:true,connect_url:'/api/model-connections/openai/begin'}],fetchImpl:async()=>({ok:true,json:async()=>({authorization_url:'https://auth.openai.com/oauth/authorize?state=fixture'})})});await app.select('ChatGPT');await button(app.view.tree,'Continue with ChatGPT').props.onClick();await app.view.flush();assert.equal(app.calls[0].path,'/api/model-connections/openai/begin');assert.equal(app.destinations[0],'https://auth.openai.com/oauth/authorize?state=fixture');app.view.unmount();
});
test('untrusted consent destinations fail without navigation or a connected label',async()=>{
  for(const url of ['https://auth.openai.com.evil.test/','https://user:pass@auth.openai.com/','http://auth.openai.com/','https://omniroute-cloud-ten.vercel.app/login'])assert.equal(catalog.providerConsentUrl('openai',url),null);
  const app=mount({items:[{id:'openai',can_connect:true,connect_url:'/api/model-connections/openai/begin'}],fetchImpl:async()=>({ok:true,json:async()=>({authorization_url:'https://evil.test/'})})});await app.select('ChatGPT');button(app.view.tree,'Continue with ChatGPT').props.onClick();await app.view.flush();assert.equal(app.destinations.length,0);assert.match(textOf(app.view.tree),/Nothing has been connected/);app.view.unmount();
});
test('non-owners cannot submit a key or start provider authorization',async()=>{
  const app=mount({owner:false,items:[{id:'claude',can_add_api_key:true,can_connect:true,connect_url:'/api/model-connections/claude/begin'}]});await app.select('Claude');assert.equal(field(app.view.tree,'gc-provider-key').props.disabled,true);find(app.view.tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});await app.view.flush();assert.equal(app.calls.length,0);assert.match(textOf(app.view.tree),/Owner access needed/);app.view.unmount();
});
test('a late begin response after leaving the provider cannot navigate',async()=>{
  const waiting=deferred(),app=mount({items:[{id:'openai',can_connect:true,connect_url:'/api/model-connections/openai/begin'}],fetchImpl:()=>waiting.promise});await app.select('ChatGPT');button(app.view.tree,'Continue with ChatGPT').props.onClick();button(app.view.tree,'← All providers').props.onClick();await app.view.flush();waiting.resolve({ok:true,json:async()=>({authorization_url:'https://auth.openai.com/oauth/authorize'})});await app.view.flush();assert.equal(app.destinations.length,0);app.view.unmount();assert.equal(app.view.updatesAfterUnmount,0);
});
test('saved route readiness is not presented as a connected subscription',()=>{
  assert.equal(catalog.providerConnectionLabel({state:'ready'}),'Route available');assert.equal(catalog.providerConnectionLabel({state:'ready',account_connected:true}),'Account connected');assert.equal(catalog.providerConnectionLabel({state:'ready',account_connected:true},true),'Preview');
});
