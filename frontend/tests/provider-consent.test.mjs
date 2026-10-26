import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,deferred,textOf,button,find} from './support/component-harness.mjs';
const canonical=load('../src/lib/canonical-app.ts',{}, {URL});
const url='https://openrouter.ai/auth?callback_url='+encodeURIComponent(canonical.CANONICAL_APP_ORIGIN+'/api/model-connections/openrouter/callback')+'&state='+'s'.repeat(43)+'&code_challenge='+'c'.repeat(43)+'&code_challenge_method=S256';
function panel(name,fetcher,props={}){
  const env=environment(),view=renderer(env),destinations=[];
  env.window.location={pathname:'/',search:'?conversation=fixture',assign:value=>destinations.push(value)};
  const components=load('../src/components/ProviderConsent.tsx',{react:view.react,'./cipher/CypherMark':{default:'cypher-mark'},'../lib/canonical-app':canonical},{...env.globals,React:view.react.default,fetch:fetcher,AbortSignal,URL});
  view.mount(()=>components[name](props));return {view,env,destinations};
}
test('Connect starts one bound request and opens only the actual provider page',async()=>{
  const pending=deferred();let calls=0,body;
  const {view,destinations}=panel('ProviderConsentButton',async(path,options)=>{calls++;assert.equal(path,'/api/model-connections/openrouter/begin');body=JSON.parse(options.body);return pending.promise;});
  const connect=button(view.tree,'Connect OpenRouter');connect.props.onClick();connect.props.onClick();await view.flush();
  assert.equal(calls,1);assert.deepEqual(body,{returnTo:'/?conversation=fixture'});
  pending.resolve({ok:true,json:async()=>({authorization_url:url})});await view.flush();assert.deepEqual(destinations,[url]);view.unmount();
});
test('unsupported or unexpected provider addresses never navigate',async()=>{
  for(const authorization_url of ['https://gateway.example/login',url.replace('S256','plain'),url.replace('state='+ 's'.repeat(43),'state=bad')]){
    const {view,destinations}=panel('ProviderConsentButton',async()=>({ok:true,json:async()=>({authorization_url})}));
    button(view.tree,'Connect OpenRouter').props.onClick();await view.flush();assert.deepEqual(destinations,[]);assert.match(textOf(view.tree),/unexpected sign-in address/);view.unmount();
  }
});
test('closing setup during start prevents late navigation and state updates',async()=>{
  const pending=deferred();const {view,destinations}=panel('ProviderConsentButton',async()=>pending.promise);
  button(view.tree,'Connect OpenRouter').props.onClick();view.unmount();pending.resolve({ok:true,json:async()=>({authorization_url:url})});await view.flush();assert.equal(view.updatesAfterUnmount,0);assert.deepEqual(destinations,[]);
});
test('callback query cannot claim success, and exact account evidence stops polling',async()=>{
  let calls=0;const {view,env}=panel('ProviderConsentResult',async()=>{calls++;return {ok:true,json:async()=>calls===1?{status:'saving'}:{status:'connected',account_connected:true,model_access_verified:false}};},{flowId:'fixture',result:'connected',returnTo:'/?conversation=fixture'});
  await view.flush();assert.doesNotMatch(textOf(view.tree),/^CypherAccount connected/);env.time.advance(3000);await view.flush();assert.match(textOf(view.tree),/Account connected/);assert.match(textOf(view.tree),/Model access has not been tested/);
  env.window.dispatchEvent(new Event('focus'));env.time.advance(30000);await view.flush();assert.equal(calls,2);assert.equal(find(view.tree,node=>node.type==='a'&&textOf(node)==='Continue to workspace').props.href,'/?conversation=fixture');view.unmount();
});
test('expired session stops polling and asks for Cypher sign-in',async()=>{
  let calls=0;const {view,env}=panel('ProviderConsentResult',async()=>{calls++;return {ok:false,status:401,json:async()=>({})};},{flowId:'fixture',result:'queued',returnTo:'/api/private'});
  await view.flush();env.time.advance(30000);env.window.dispatchEvent(new Event('focus'));await view.flush();assert.equal(calls,1);assert.ok(find(view.tree,node=>node.type==='a'&&node.props.href==='/login'));view.unmount();
});
test('wrong connection evidence remains unverified and unmount cancels polling',async()=>{
  const pending=deferred();const {view,env}=panel('ProviderConsentResult',async()=>pending.promise,{flowId:'fixture',result:'queued',returnTo:'/'});
  pending.resolve({ok:true,json:async()=>({status:'connected',account_connected:true,model_access_verified:true})});await view.flush();assert.match(textOf(view.tree),/status could not be verified/);view.unmount();assert.equal(env.time.pending,0);assert.equal(view.updatesAfterUnmount,0);
});
