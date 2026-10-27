import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {environment,renderer,load,find,textOf,button,deferred} from './support/component-harness.mjs';
const id='00000000-0000-4000-8000-000000000001';
const {companionSetup}=load('../src/lib/gateway-hosting.ts',{},{URL});
function mount({preview=false,fetchImpl,origin='https://cypher-agent.vercel.app'}={}){
  const env=environment(),view=renderer(env),calls=[],intervals=[];let accountId='fixture-a';
  const baseElement=env.element;env.element=props=>baseElement({closest:()=>null,...props});
  const Component=load('../src/components/GatewayHosting.tsx',{react:view.react,'./GatewayProviderLogo':{GatewayProviderLogo:'provider-logo'},'./GatewayDeployment':{GatewayDeployment:'deployment-wizard'},'../lib/canonical-app':{CANONICAL_APP_ORIGIN:origin},'../lib/gateway-hosting':{companionSetup}},{...env.globals,React:view.react.default,fetch:async(path,options)=>{calls.push({path,...options});return fetchImpl?fetchImpl(path,options):{ok:true,json:async()=>[]}},setInterval:fn=>{intervals.push(fn);return intervals.length},clearInterval:()=>{},navigator:{clipboard:{writeText:async()=>{}}}}).GatewayHosting;
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
test('custom HTTPS hosting uses the configured origin for the companion download and server on every platform',async()=>{
  const origin='https://cypher.owned.example:8443',app=mount({origin});await app.view.flush();
  for(const label of ['Connect computer →','Connect AWS machine →','Connect Azure machine →']){
    button(app.view.tree,label).props.onClick();await app.view.flush();
    const command=textOf(find(app.view.tree,n=>n.type==='pre'));
    assert.match(command,/python3 cypher_device.py --server 'https:\/\/cypher\.owned\.example:8443'/);
    assert.ok(command.includes(origin+'/grokbot_device.py'));assert.ok(!command.includes('cypher-agent.vercel.app'));
    assert.equal(find(app.view.tree,n=>n.type==='a'&&n.props.download==='cypher_device.py').props.href,origin+'/grokbot_device.py');
    if(label==='Connect computer →'){button(app.view.tree,'Windows').props.onClick();await app.view.flush();assert.ok(textOf(find(app.view.tree,n=>n.type==='pre')).includes("py -3 cypher_device.py --server '"+origin+"'"));}
    button(app.view.tree,'← All hosting options').props.onClick();await app.view.flush();
  }
  app.view.unmount();
});
test('canonical hosting retains its default server while passing it explicitly to the companion',async()=>{
  const app=mount();await app.view.flush();button(app.view.tree,'Connect computer →').props.onClick();await app.view.flush();
  const command=textOf(find(app.view.tree,n=>n.type==='pre'));assert.ok(command.includes("--server 'https://cypher-agent.vercel.app'"));assert.ok(command.includes('https://cypher-agent.vercel.app/grokbot_device.py'));app.view.unmount();
});
test('HTTP loopback hosting cannot create pairing codes even through a forced form submit',async()=>{
  for(const origin of ['http://127.0.0.1:3000','http://localhost:4320']){
    const app=mount({origin});await app.view.flush();assert.match(textOf(app.view.tree),/Computer pairing requires HTTPS/);
    button(app.view.tree,'Connect computer →').props.onClick();await app.view.flush();assert.equal(button(app.view.tree,'HTTPS required').props.disabled,true);
    assert.equal(find(app.view.tree,n=>n.type==='pre'),undefined);assert.equal(button(app.view.tree,'Copy command'),undefined);
    find(app.view.tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});await app.view.flush();assert.equal(app.calls.filter(call=>call.method==='POST').length,0);app.view.unmount();
  }
});
test('companion command arguments preserve literal quoted origins and reject non-origin or non-HTTPS inputs',()=>{
  const origin="https://cypher'quoted.example",setup=companionSetup(origin);assert.ok(setup);
  const lines=setup.unix.split('\n');
  const server=execFileSync('/bin/sh',['-c','set -- '+lines[2].replace('python3 cypher_device.py ','')+'\nprintf %s "$2"'],{encoding:'utf8'});
  const download=execFileSync('/bin/sh',['-c','set -- '+lines[1].replace('curl ','')+'\nprintf %s "$4"'],{encoding:'utf8'});
  assert.equal(server,origin);assert.equal(download,origin+'/grokbot_device.py');
  assert.ok(setup.windows.includes("--server 'https://cypher''quoted.example'"));
  for(const value of ['http://localhost:3000','http://127.0.0.1:3000','http://public.example','https://user:password@owned.example','https://owned.example/path','https://owned.example?query=1','https://owned.example#fragment','https://owned.example\n'])assert.equal(companionSetup(value),null);
});
