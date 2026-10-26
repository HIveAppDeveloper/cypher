import test from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,find,textOf,button,deferred} from './support/component-harness.mjs';
const id='00000000-0000-4000-8000-000000000001';
function mount({preview=false,fetchImpl}={}){
  const env=environment(),view=renderer(env),calls=[],intervals=[];let accountId='fixture-a';
  const baseElement=env.element;env.element=props=>baseElement({closest:()=>null,...props});
  const Component=load('../src/components/GatewayHosting.tsx',{react:view.react,'./GatewayProviderLogo':{GatewayProviderLogo:'provider-logo'},'./GatewayDeployment':{GatewayDeployment:'deployment-wizard'}},{...env.globals,React:view.react.default,fetch:async(path,options)=>{calls.push({path,...options});return fetchImpl?fetchImpl(path,options):{ok:true,json:async()=>[]}},setInterval:fn=>{intervals.push(fn);return intervals.length},clearInterval:()=>{},navigator:{clipboard:{writeText:async()=>{}}}}).GatewayHosting;
  view.mount(()=>Component({preview,cloudReady:true,accountId}));return{view,calls,intervals,account(value){accountId=value;view.rerender()}};
}
test('hosting preview exposes all three guided choices and performs no device mutations',async()=>{
  const app=mount({preview:true});await app.view.flush();for(const label of ['Connect computer →','Connect AWS machine →','Connect Azure machine →'])assert.ok(button(app.view.tree,label));button(app.view.tree,'Connect AWS machine →').props.onClick();await app.view.flush();assert.match(textOf(app.view.tree),/Session Manager/);assert.match(textOf(app.view.tree),/Python 3.10/);assert.ok(find(app.view.tree,n=>n.type==='a'&&String(n.props.href).startsWith('https://console.aws.amazon.com/')));assert.equal(app.calls.length,0);app.view.unmount();
});
test('pairing is explicit, password-masked, read-polled, and clears on confirmed pair',async()=>{
  let paired=false;const app=mount({fetchImpl:async(path,options)=>({ok:true,json:async()=>options.method==='POST'?{id,pairing_code:id+'.fixture-secret',expires_at:'1970-01-01T00:10:00Z'}:paired?[{id,name:'My computer',paired:true,scopes:[]}]:[]})});await app.view.flush();assert.equal(app.calls.length,1);button(app.view.tree,'Connect computer →').props.onClick();await app.view.flush();find(app.view.tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});await app.view.flush();assert.equal(app.calls.filter(c=>c.method==='POST').length,1);const input=find(app.view.tree,n=>n.type==='input'&&n.props['aria-label']==='Pairing code');assert.equal(input.props.type,'password');assert.ok(!textOf(app.view.tree).includes('fixture-secret'));paired=true;app.intervals.at(-1)();await app.view.flush();assert.match(textOf(app.view.tree),/Computer paired/);assert.equal(find(app.view.tree,n=>n.type==='input'&&n.props['aria-label']==='Pairing code'),undefined);app.view.unmount();
});
test('an old account device response cannot populate the new account view',async()=>{
  const pending=[];const app=mount({fetchImpl:()=>{const item=deferred();pending.push(item);return item.promise}});app.account('fixture-b');pending[1].resolve({ok:true,json:async()=>[]});await app.view.flush();pending[0].resolve({ok:true,json:async()=>[{id,name:'Private old account machine',paired:true}]});await app.view.flush();assert.ok(!textOf(app.view.tree).includes('Private old account machine'));app.view.unmount();
});
test('late device reads after unmount do not update state',async()=>{
  const waiting=deferred(),app=mount({fetchImpl:()=>waiting.promise});app.view.unmount();waiting.resolve({ok:true,json:async()=>[]});await app.view.flush();assert.equal(app.view.updatesAfterUnmount,0);
});
