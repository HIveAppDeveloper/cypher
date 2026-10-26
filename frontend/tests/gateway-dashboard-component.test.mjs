import test from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,find,textOf,deferred} from './support/component-harness.mjs';
import * as helpers from '../src/lib/gateway-dashboard.mjs';

function mount({owner=true,hold=false,small=false}={}){
  const env=environment(),view=renderer(env),calls=[],pending=[],intervals=[];
  let account='account-a';
  env.window.matchMedia=()=>({matches:small});
  const good={runtime:{connected:true,model_transport:'omniroute',database:true,worker:true,can_manage_model_connections:owner,configured_models:['example/route'],model_connections:[]},usage:{models:[],tokens:42,estimated_cost:.001},runs:[{id:'fixture-task',status:'completed',created_at:'2026-10-26T12:00:00Z',title:'private task title',result:'private output'}]};
  const fetch=async path=>{calls.push(path);const route=path.split('/').pop();if(hold){const value=deferred();pending.push({path,value});return value.promise}return{ok:true,json:async()=>good[route]};};
  const react={...view.react,useMemo:fn=>fn()};
  const Component=load('../src/components/GatewayDashboard.tsx',{react,'./GatewayConnections':{GatewayConnections:'gateway-connections'},'./GatewayHosting':{GatewayHosting:'gateway-hosting'},'./GatewayProviderLogo':{GatewayProviderLogo:'provider-logo'},'../lib/gateway-connections.mjs':{providerConnectionLabel:()=>''},'../lib/gateway-dashboard.mjs':helpers},{...env.globals,React:view.react.default,URL,Intl,fetch,setInterval:fn=>{intervals.push(fn);return intervals.length},clearInterval:()=>{},navigator:{clipboard:{writeText:async()=>{}}}}).default;
  view.mount(()=>Component({accountId:account,approvedManageUrl:'https://omniroute-cloud-ten.vercel.app/dashboard/providers'}));
  find(view.tree,n=>n.type==='button'&&textOf(n)==='Overview').props.onClick();view.render();
  return{view,calls,pending,good,intervals,env,account(value){account=value;view.rerender()}};
}
const resolve=(entry,data,ok=true)=>entry.value.resolve({ok,status:ok?200:503,json:async()=>data});

test('dashboard reads only existing authenticated APIs and omits sensitive task contents',async()=>{
  const app=mount();await app.view.flush();
  assert.deepEqual(app.calls.sort(),['/api/runtime','/api/workspace/runs','/api/workspace/usage']);
  find(app.view.tree,n=>n.type==='button'&&textOf(n)==='Overview').props.onClick();await app.view.flush();
  const text=textOf(app.view.tree);assert.match(text,/42/);assert.ok(!text.includes('private task title'));assert.ok(!text.includes('private output'));
  app.view.unmount();assert.equal(app.view.updatesAfterUnmount,0);
});
test('non-owner never receives management actions even when a verified URL exists',async()=>{
  const app=mount({owner:false});await app.view.flush();
  find(app.view.tree,n=>n.type==='button'&&textOf(n).startsWith('Connect tools')).props.onClick();await app.view.flush();
  assert.equal(find(app.view.tree,n=>n.type==='a'&&n.props?.href==='https://omniroute-cloud-ten.vercel.app/dashboard/providers'),undefined);
  assert.ok(!textOf(app.view.tree).includes('https://omniroute-cloud-ten.vercel.app/v1'));
  app.view.unmount();
});
test('older in-flight responses cannot replace a newer account view',async()=>{
  const app=mount({hold:true});app.account('account-b');assert.equal(app.pending.length,6);
  resolve(app.pending[3],{...app.good.runtime,configured_models:['example/b']});resolve(app.pending[4],{...app.good.usage,tokens:87});resolve(app.pending[5],[]);await app.view.flush();
  for(let i=0;i<3;i++)resolve(app.pending[i],i===0?{...app.good.runtime,configured_models:['example/a']}:i===1?{...app.good.usage,tokens:999999}:[]);
  await app.view.flush();assert.match(textOf(app.view.tree),/87/);assert.ok(!textOf(app.view.tree).includes('999,999'));
  app.view.unmount();
});
test('failed refresh removes stale ready state and reports unavailable instead of zero',async()=>{
  const app=mount({hold:true});resolve(app.pending[0],app.good.runtime);resolve(app.pending[1],app.good.usage);resolve(app.pending[2],[]);await app.view.flush();
  app.intervals.at(-1)();for(const entry of app.pending.slice(3))resolve(entry,{},false);await app.view.flush();
  const text=textOf(app.view.tree);assert.match(text,/Unavailable/);assert.match(text,/temporarily unavailable/);assert.ok(!text.includes('Cloud API connected'));
  app.view.unmount();
});
test('late unmounted reads do not update component state',async()=>{
  const app=mount({hold:true});app.view.unmount();for(const entry of app.pending)resolve(entry,{});await app.view.flush();assert.equal(app.view.updatesAfterUnmount,0);
});


test('closed mobile navigation is inert and Escape restores the opener',async()=>{
  const app=mount({small:true});await app.view.flush();
  let restored=0;app.env.document.activeElement={focus(){restored++}};
  const sidebar=()=>find(app.view.tree,n=>n.type==='aside');
  const opener=()=>find(app.view.tree,n=>n.type==='button'&&n.props?.['aria-controls']==='gateway-navigation');
  assert.equal(sidebar().props.inert,true);assert.equal(sidebar().props['aria-hidden'],true);
  opener().props.onClick();await app.view.flush();
  assert.equal(sidebar().props.inert,false);assert.equal(sidebar().props.role,'dialog');assert.equal(opener().props['aria-expanded'],true);
  app.env.document.dispatchEvent(Object.assign(new Event('keydown',{cancelable:true}),{key:'Escape'}));await app.view.flush();
  assert.equal(sidebar().props.inert,true);assert.equal(opener().props['aria-expanded'],false);assert.equal(restored,1);
  app.view.unmount();
});
