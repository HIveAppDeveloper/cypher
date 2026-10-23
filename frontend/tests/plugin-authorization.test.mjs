import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,storage,deferred,find,textOf,button} from './support/component-harness.mjs';
const auth=load('../src/lib/pluginAuthorization.ts',{}, {URL,Date});
const id='e52dad3f-b0db-4cf8-a0f0-f9b88c16f230';
const item={id:'fixture',name:'Fixture Service',url:'https://provider.example/mcp',domains:['provider.example'],description:'Synthetic service',category:'Testing'};
const pending={id,name:item.name,url:'https://provider.example/allow?state=synthetic',startedAt:0};
function panel({saved={},popupBlocked=false,api:overrides={}}={}){
  const session=storage(saved),env=environment(session),view=renderer(env);let opens=0,closed=0;
  const popup={closed:false,opener:{},document:{title:'',createElement:()=>({style:{}}),body:{appendChild(){}}},location:{replace(){}},focus(){},close(){this.closed=true;closed++;}};
  env.document.createElement=()=>({style:{}});
  env.window.open=()=>{opens++;return popupBlocked?null:popup;};
  env.window.location={href:'https://app.example/?workspace=1&conversation=fixture',search:'?workspace=1&conversation=fixture',assign(){throw Error('Must preserve the workspace');}};
  env.window.history={state:null,replaceState(){}};
  const api={getPluginCatalog:async()=>[item],getPlugins:async()=>[],deviceStatus:async()=>({enrolled:false}),getAvailableConnections:async()=>[],pluginSyncStatus:async()=>null,accountStatus:async()=>({}),authorizePlugin:async()=>({status:'awaiting_login',flow_id:id,authorization_url:pending.url,name:item.name}),pluginAuthStatus:async()=>({status:'awaiting_login',name:item.name}),cancelPluginAuth:async()=>({status:'cancelled'}),...overrides};
  const scopedAuth=load('../src/lib/pluginAuthorization.ts',{}, {URL,Date:env.globals.Date});
  const {PluginPanel}=load('../src/components/PluginPanel.tsx',{react:view.react,'../lib/api':{api},'../lib/device':{approveConnection:async()=>undefined,enrollDevice:async()=>{}},'../lib/pluginAuthorization':scopedAuth},{...env.globals,URL,URLSearchParams,React:view.react.default,fetch:async()=>({json:async()=>({})})});
  view.mount(()=>PluginPanel({onClose(){}}));
  return {env,view,api,session,popup,get opens(){return opens;},get closed(){return closed;}};
}
async function connect(p){await p.view.flush();button(p.view.tree,'Connect').props.onClick();await p.view.flush();await p.view.flush();}

test('blocked popup leaves a working provider link and the conversation in place',async()=>{
  const p=panel({popupBlocked:true});await connect(p);
  const link=find(p.view.tree,n=>n.type==='a'&&textOf(n)==='Continue to Fixture Service');
  assert.equal(link.props.href,pending.url);assert.equal(link.props.target,'_blank');
  assert.equal(p.opens,1);assert.ok(p.session.getItem(auth.PLUGIN_SIGN_IN_KEY));
  assert.match(textOf(p.view.tree),/Review the permissions and choose Allow or Authorize/);
  assert.ok(button(p.view.tree,'Check connection'));p.view.unmount();
});
test('a closed provider window can be reopened through the real link',async()=>{
  const p=panel();await connect(p);p.popup.closed=true;let prevented=false;
  find(p.view.tree,n=>n.type==='a'&&textOf(n)==='Continue to Fixture Service').props.onClick({preventDefault(){prevented=true;}});
  assert.equal(prevented,false,'browser follows the link when the old window is closed');p.view.unmount();
});
test('transient status errors preserve sign-in and retry without a second authorization',async()=>{
  let polls=0,starts=0;
  const p=panel({api:{authorizePlugin:async()=>{starts++;return {status:'awaiting_login',flow_id:id,authorization_url:pending.url,name:item.name};},pluginAuthStatus:async()=>{if(++polls===1)throw Error('Synthetic offline');return {status:'connected',name:item.name};}}});
  await connect(p);assert.match(textOf(p.view.tree),/retry automatically/);assert.ok(p.session.getItem(auth.PLUGIN_SIGN_IN_KEY));
  p.env.time.advance(4000);await p.view.flush();assert.match(textOf(p.view.tree),/Fixture Service connected/);assert.equal(starts,1);assert.equal(p.session.getItem(auth.PLUGIN_SIGN_IN_KEY),null);p.view.unmount();
});
test('closing and reopening Plugins resumes a pending sign-in without closing its window',async()=>{
  const p=panel();await connect(p);const saved=p.session.getItem(auth.PLUGIN_SIGN_IN_KEY);p.view.unmount();assert.equal(p.closed,0);
  const resumed=panel({saved:{[auth.PLUGIN_SIGN_IN_KEY]:saved}});await resumed.view.flush();assert.equal(resumed.opens,0);assert.ok(button(resumed.view.tree,'Cancel sign-in'));resumed.view.unmount();
});
test('focus checks coalesce with an in-flight status request and recover after returning',async()=>{
  const wait=deferred();let polls=0;
  const p=panel({saved:{[auth.PLUGIN_SIGN_IN_KEY]:JSON.stringify(pending)},api:{pluginAuthStatus:()=>{polls++;return wait.promise;}}});
  await p.view.flush();p.env.window.dispatchEvent(new Event('focus'));p.env.window.dispatchEvent(new Event('online'));await p.view.flush();assert.equal(polls,1);
  wait.resolve({status:'connected',name:item.name});await p.view.flush();assert.match(textOf(p.view.tree),/Fixture Service connected/);p.view.unmount();assert.equal(p.env.time.pending,0);
});
test('rapid Connect clicks start only one approval and authorization',async()=>{
  const wait=deferred();let starts=0;const p=panel({api:{authorizePlugin:()=>{starts++;return wait.promise;}}});await p.view.flush();const connect=button(p.view.tree,'Connect');connect.props.onClick();connect.props.onClick();await p.view.flush();assert.equal(starts,1);
  wait.resolve({status:'connected',name:item.name});await p.view.flush();p.view.unmount();
});
test('failed cancellation keeps a resumable flow; successful cancellation clears it',async()=>{
  let calls=0;const p=panel({api:{cancelPluginAuth:async()=>{if(++calls===1)throw Error('Synthetic offline');return {status:'cancelled'};}}});await connect(p);
  button(p.view.tree,'Cancel sign-in').props.onClick();await p.view.flush();assert.ok(p.session.getItem(auth.PLUGIN_SIGN_IN_KEY));
  button(p.view.tree,'Cancel sign-in').props.onClick();await p.view.flush();assert.equal(p.session.getItem(auth.PLUGIN_SIGN_IN_KEY),null);assert.match(textOf(p.view.tree),/Sign-in cancelled/);p.view.unmount();
});
test('expired or unsafe stored links are never resumed',()=>{
  for(const change of [{url:'javascript:alert(1)'},{url:'https://user:secret@provider.example/allow'},{startedAt:-auth.PLUGIN_SIGN_IN_TTL},{id:'other'}]){const s=storage({[auth.PLUGIN_SIGN_IN_KEY]:JSON.stringify({...pending,...change})});assert.equal(auth.readPluginSignIn(s,0),null);assert.equal(s.getItem(auth.PLUGIN_SIGN_IN_KEY),null);}
});
test('provider return paths retain the conversation and reject external or API destinations',()=>{
  const origin='https://app.example';assert.equal(auth.pluginReturnPath(origin+'/?workspace=1&conversation=123&plugins=failed&state=secret',origin),'/?workspace=1&conversation=123');
  for(const value of ['https://outside.example/','//outside.example/','/api/plugin-oauth/callback?code=secret'])assert.equal(auth.pluginReturnPath(value,origin),'/?workspace=1');
});
test('restoring the callback conversation does not dismiss its plugin result panel',async()=>{
  const env=environment(),view=renderer(env);env.window.location={search:'?workspace=1&conversation=123&plugins=cancelled'};
  const components=['BotRoster','SidebarShell','ChatPanel','BotCreator','PluginPanel','GoalsPanel','ChannelsPanel','WorkspaceSetup','RoomCreator','CommandPalette','WorkspaceHub','ComputerPanel'];
  const imports=Object.fromEntries(components.map(name=>['../components/'+name,{[name]:name}]));imports['./CommandPalette']={CommandPalette:'CommandPalette'};imports['./WorkspaceHub']={WorkspaceHub:'WorkspaceHub'};imports['./ComputerPanel']={ComputerPanel:'ComputerPanel'};
  imports['../hooks/useBots']={useBots:()=>({bots:[],selectedBot:null,setSelectedBot(){},createBot(){},refreshBots(){}})};
  imports['../components/PreferencesPanel']={PreferencesPanel:'PreferencesPanel',restoreAppearance(){}};imports['../components/RunControls']={DEFAULT_OPTIONS:{}};imports['../lib/types']={};imports['../lib/api']={request:async()=>[],api:{getConversations:async()=>[{id:'123',title:'Fixture conversation',is_group:true}]}};
  const {default:WorkspaceApp}=load('../src/components/WorkspaceApp.tsx',{react:view.react,...imports},{...env.globals,URLSearchParams,setInterval:()=>1,clearInterval(){}});
  view.mount(()=>WorkspaceApp({}));await view.flush();assert.ok(find(view.tree,n=>n.type==='PluginPanel'),'callback result remains visible after conversation restoration');view.unmount();
});
