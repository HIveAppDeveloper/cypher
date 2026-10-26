import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,deferred,find,textOf,button} from './support/component-harness.mjs';
const id='e52dad3f-b0db-4cf8-a0f0-f9b88c16f230';
const saved={id,name:'Windsor.ai',url:'https://mcp.windsor.ai/',enabled:true,authenticated:true};
const services=[{id:'facebook_organic',name:'Facebook Pages',available:true,account_count:1,status:'accounts_listed',data_access_verified:false},{id:'instagram',name:'Instagram',available:true,account_count:0,status:'not_connected',data_access_verified:false}];
function panel(fetcher,connections=[saved]){
  const env=environment(),view=renderer(env),calls=[],destinations=[];
  env.window.location={origin:'https://app.example',assign:value=>destinations.push(value)};
  const component=load('../src/components/MetaSocialConnections.tsx',{react:view.react,'./cipher/CypherMark':{default:'cypher-mark'},'../lib/device':{approveConnection:async()=>undefined}},{...env.globals,React:view.react.default,AbortSignal,URL,encodeURIComponent,fetch:async(path,options)=>{calls.push({path,options});return path==='/api/plugins'?{ok:true,json:async()=>connections}:fetcher(path,options);}});
  view.mount(()=>component.MetaSocialConnections());return {view,calls,destinations};
}
test('mount reads only saved local connections; explicit inspect runs once and never claims a live data pass',async()=>{
  const pending=deferred();const {view,calls}=panel(async()=>pending.promise);await view.flush();
  assert.deepEqual(calls.map(item=>item.path),['/api/plugins']);
  const check=button(view.tree,'Check connected accounts');check.props.onClick();check.props.onClick();await view.flush();
  assert.equal(calls.length,2);assert.equal(calls[1].path,`/api/plugins/${id}/meta/inspect`);
  pending.resolve({ok:true,json:async()=>({services})});await view.flush();
  assert.match(textOf(view.tree),/1 account listed. Data access has not been tested/);
  assert.match(textOf(view.tree),/No account selected yet/);assert.equal(button(view.tree,'Add or reconnect').props.disabled,false);view.unmount();
});
test('authorization displays provider guidance verbatim before the human opens consent',async()=>{
  const notes='Select your business Pages.\nKeep the permissions you need.';
  const url='https://onboard.windsor.ai/connect?connector=instagram&state=synthetic';
  const {view,calls}=panel(async()=>({ok:true,json:async()=>({service:'instagram',authorization_url:url,notes,data_access_verified:false})}));await view.flush();
  button(view.tree,'Connect Instagram').props.onClick();await view.flush();
  assert.deepEqual(JSON.parse(calls[1].options.body),{service:'instagram'});assert.match(calls[1].path,/meta\/authorize$/);
  assert.ok(find(view.tree,node=>node.type==='p'&&textOf(node)===notes));
  const link=find(view.tree,node=>node.type==='a'&&textOf(node)==='Continue to provider');assert.equal(link.props.href,url);assert.equal(link.props.rel,'noopener noreferrer');view.unmount();
});
test('an unexpected provider address or mismatched connector cannot create a consent link',async()=>{
  for(const change of [{authorization_url:'https://onboard.windsor.ai.evil.test/'},{service:'facebook_organic'}]){
    const {view}=panel(async()=>({ok:true,json:async()=>({service:'instagram',authorization_url:'https://onboard.windsor.ai/',notes:'',data_access_verified:false,...change})}));await view.flush();
    button(view.tree,'Connect Instagram').props.onClick();await view.flush();assert.equal(find(view.tree,node=>node.type==='a'&&textOf(node)==='Continue to provider'),undefined);assert.match(textOf(view.tree),/could not be confirmed/);view.unmount();
  }
});
test('closing the page during a provider response prevents late state updates',async()=>{
  const pending=deferred();const {view}=panel(async()=>pending.promise);await view.flush();
  button(view.tree,'Check connected accounts').props.onClick();view.unmount();pending.resolve({ok:true,json:async()=>({services})});await view.flush();assert.equal(view.updatesAfterUnmount,0);
});
test('choosing another saved connection prevents an old account response from resurfacing',async()=>{
  const pending=deferred();const {view}=panel(async()=>pending.promise,[saved,{...saved,id:'other',name:'Other Windsor'}]);await view.flush();
  let select=find(view.tree,node=>node.type==='select');select.props.onChange({target:{value:id}});await view.flush();
  button(view.tree,'Check connected accounts').props.onClick();await view.flush();select=find(view.tree,node=>node.type==='select');select.props.onChange({target:{value:'other'}});await view.flush();
  pending.resolve({ok:true,json:async()=>({services})});await view.flush();assert.doesNotMatch(textOf(view.tree),/1 account listed/);view.unmount();
});
test('a new user starts the existing Windsor OAuth path with a safe return to Meta setup',async()=>{
  const url='https://mcp.windsor.ai/authorize?state=synthetic';
  const {view,calls,destinations}=panel(async()=>({ok:true,json:async()=>({status:'awaiting_login',authorization_url:url})}),[]);await view.flush();
  button(view.tree,'Continue with Windsor').props.onClick();await view.flush();
  assert.equal(calls[1].path,'/api/plugins/authorize');assert.equal(calls[1].options.referrer,'https://app.example/connect/meta');assert.deepEqual(destinations,[url]);view.unmount();
});
test('an already saved OAuth grant refreshes local connections without probing Meta on return',async()=>{
  const {view,calls,destinations}=panel(async()=>({ok:true,json:async()=>({status:'connected'})}),[]);await view.flush();
  button(view.tree,'Continue with Windsor').props.onClick();await view.flush();
  assert.deepEqual(calls.map(item=>item.path),['/api/plugins','/api/plugins/authorize','/api/plugins']);assert.deepEqual(destinations,[]);view.unmount();
});
test('reconnection preserves the exact saved endpoint and explicit managed connection identity',async()=>{
  const {view,calls}=panel(async()=>({ok:true,json:async()=>({status:'connected'})}),[{...saved,url:'https://mcp.windsor.ai',connection_id:'managed-windsor'}]);await view.flush();
  button(view.tree,'Reconnect Windsor').props.onClick();await view.flush();
  const body=JSON.parse(calls[1].options.body);assert.equal(body.url,'https://mcp.windsor.ai');assert.equal(body.connection_id,'managed-windsor');assert.equal(body.reconnect,true);view.unmount();
});
