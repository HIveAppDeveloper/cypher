import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {TextEncoder} from 'node:util';
import {environment,renderer,load,storage,deferred,find,textOf,button} from './support/component-harness.mjs';
const auth=load('../src/lib/pluginAuthorization.ts',{}, {URL,Date});
const id='e52dad3f-b0db-4cf8-a0f0-f9b88c16f230';
const item={id:'fixture',name:'Fixture Service',url:'https://provider.example/mcp',domains:['provider.example'],description:'Synthetic service',category:'Testing'};
const pending={id,name:item.name,url:'https://provider.example/allow?state=synthetic',startedAt:0};
function panel({saved={},popupBlocked=false,api:overrides={},embedded=false,runtimeConnected=false,onManageSkills,existingSession,existingEnvironment,approve=async()=>undefined,locationSearch='?workspace=1&conversation=fixture'}={}){
  const session=existingSession||storage(saved),env=existingEnvironment||environment(session),view=renderer(env);let opens=0,closed=0;
  const makePopup=()=>({closed:false,opener:{},sessionStorage:storage(),document:{title:'',createElement:()=>({style:{}}),body:{appendChild(){}}},location:{url:'',replace(value){this.url=value;}},focus(){},close(){this.closed=true;closed++;}});
  const popup=makePopup(),popups=[];
  env.document.createElement=()=>({style:{}});
  env.window.crypto={subtle:{digest:async (_algorithm,bytes)=>{const digest=createHash('sha256').update(bytes).digest();return digest.buffer.slice(digest.byteOffset,digest.byteOffset+digest.byteLength);}}};
  env.window.open=()=>{opens++;if(popupBlocked)return null;const opened=opens===1?popup:makePopup();popups.push(opened);return opened;};
  env.window.location={hostname:'cypher-agent.vercel.app',href:'https://app.example/?workspace=1&conversation=fixture',search:locationSearch,assign(){throw Error('Must preserve the workspace');}};
  env.window.history={state:null,replaceState(){}};
  const api={getPluginCatalog:async()=>[item],getPlugins:async()=>[],deviceStatus:async()=>({enrolled:false}),getAvailableConnections:async()=>[],pluginSyncStatus:async()=>null,accountStatus:async()=>({}),authorizePlugin:async()=>({status:'awaiting_login',flow_id:id,authorization_url:pending.url,name:item.name}),pluginAuthStatus:async()=>({status:'awaiting_login',name:item.name}),cancelPluginAuth:async()=>({status:'cancelled'}),...overrides};
  const scopedAuth=load('../src/lib/pluginAuthorization.ts',{}, {URL,Date:env.globals.Date,TextEncoder});
  const {PluginPanel}=load('../src/components/PluginPanel.tsx',{react:view.react,'./LoadingState':{LoadingState:'loading-state'},'../lib/api':{api},'../lib/plugin-status':load('../src/lib/plugin-status.ts',{}, {Date}),'../lib/canonical-app':load('../src/lib/canonical-app.ts',{}, {URL}),'../lib/device':{approveConnection:approve,enrollDevice:async()=>{}},'../lib/pluginAuthorization':scopedAuth,'../lib/connectionQueue':load('../src/lib/connectionQueue.ts'),'./McpDirectory':{McpDirectory:'mcp-directory'},'./cipher/CypherMark':{__esModule:true,default:'cypher-mark'},'./cipher/BinaryLens':{__esModule:true,default:'binary-lens'}},{...env.globals,URL,URLSearchParams,React:view.react.default,fetch:async()=>({ok:true,json:async()=>({connected:runtimeConnected,variables:[]})})});
  view.mount(()=>PluginPanel({onClose(){},onManageSkills,embedded}));
  return {env,view,api,session,popup,popups,get opens(){return opens;},get closed(){return closed;}};
}
async function connect(p){await p.view.flush();find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']===`Connect ${item.name}`).props.onClick();await p.view.flush();await p.view.flush();}

const linkedPlugin=(verification={status:'not_tested'})=>({id:'linked-account',name:item.name,url:item.url,enabled:true,authenticated:true,tools:[{name:'read_profile',description:'Read an authorized profile',enabled:true}],verification});

test('catalog keeps connection details internal while Connect uses the saved endpoint',async()=>{
  let authorization;
  const p=panel({api:{getPluginCatalog:async()=>[{...item,source:'https://provider.example/developers'}],authorizePlugin:async body=>{authorization=body;return {status:'awaiting_login',flow_id:id,authorization_url:pending.url,name:item.name};},resolvePlugin:async()=>{throw Error('Catalog entries must not be rediscovered');}}});
  await p.view.flush();
  assert.equal(find(p.view.tree,n=>n.type==='a'&&n.props?.href===item.url),undefined);
  assert.doesNotMatch(textOf(p.view.tree),/MCP server:|About this connection/);
  assert.equal(find(p.view.tree,n=>n.type==='a'&&n.props?.href==='https://provider.example/developers'),undefined);
  await connect(p);
  assert.equal(authorization.url,item.url);
  assert.match(textOf(p.view.tree),/Continue to Fixture Service/);
  p.view.unmount();
});

test('catalog never exposes credential-bearing or non-HTTPS addresses as public MCP links',async()=>{
  const cases=['https://user:secret@provider.example/mcp','https://provider.example/mcp?token=secret','http://provider.example/mcp'];
  const p=panel({api:{getPluginCatalog:async()=>cases.map((url,i)=>({...item,id:String(i),name:'Unsafe '+i,url}))}});
  await p.view.flush();
  for(let i=0;i<cases.length;i++)assert.equal(find(p.view.tree,n=>n.type==='a'&&n.props?.['aria-label']===`Open Unsafe ${i} MCP server`),undefined);
  p.view.unmount();
});

test('unavailable Canva does not open developer setup or block connecting another app',async()=>{
  const canva={...item,id:'canva-official',name:'Canva',url:'https://api.canva.com/connect/v1/mcp',auth:'registered_oauth',source:'https://www.canva.dev/docs/apps/mcp/'};
  let calls=0,input;
  const p=panel({api:{getPluginCatalog:async()=>[canva,item],authorizePlugin:async body=>{calls++;input=body;return {status:'awaiting_login',flow_id:id,authorization_url:pending.url,name:body.name};}}});
  await p.view.flush();const unavailable=find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']==='Unavailable Canva');
  assert.equal(unavailable.props.disabled,true);unavailable.props.onClick();await p.view.flush();
  assert.equal(calls,0);
  assert.equal(p.opens,0);assert.equal(find(p.view.tree,n=>n.props?.className==='plugin-registration'),undefined);
  assert.match(textOf(p.view.tree),/You can keep connecting other apps/);
  await connect(p);assert.equal(calls,1);assert.equal(input.url,item.url);
  p.view.unmount();
});

test('Canva setup failures keep developer credentials out of the primary connection flow',async()=>{
  const canva={...item,id:'canva-official',name:'Canva',url:'https://api.canva.com/connect/v1/mcp',auth:'registered_oauth',oauth_client_configured:true};
  const p=panel({api:{getPluginCatalog:async()=>[canva],authorizePlugin:async()=>{throw Object.assign(Error('Internal client setup'),{status:409,details:{code:'oauth_registration_required',callback_url:'https://cypher-agent.vercel.app/api/plugin-oauth/callback'}});}}});
  await p.view.flush();find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']==='Connect Canva').props.onClick();await p.view.flush();
  assert.equal(find(p.view.tree,n=>n.props?.className==='plugin-registration'),undefined);
  assert.doesNotMatch(textOf(p.view.tree),/Client ID|Client secret|Internal client setup/);
  assert.equal(find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']==='Unavailable Canva').props.disabled,true);p.view.unmount();
});

test('an existing saved Canva connection stays manageable without the shared app client',async()=>{
  const canva={...item,id:'canva-official',name:'Canva',url:'https://api.canva.com/connect/v1/mcp',auth:'registered_oauth',oauth_client_configured:false};
  let authorizations=0;
  const p=panel({api:{getPluginCatalog:async()=>[canva],getPlugins:async()=>[{...linkedPlugin(),name:'Canva',url:canva.url}],authorizePlugin:async()=>{authorizations++;throw Error('Do not reauthorize');}}});
  await p.view.flush();const manage=find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']==='Manage Canva');
  assert.notEqual(manage.props.disabled,true);manage.props.onClick();await p.view.flush();
  assert.equal(authorizations,0);assert.equal(find(p.view.tree,n=>n.props?.className==='plugin-registration'),undefined);p.view.unmount();
});

test('configured Cypher Canva client starts the saved endpoint directly',async()=>{
  const canva={...item,id:'canva-official',name:'Canva',url:'https://api.canva.com/connect/v1/mcp',auth:'registered_oauth',oauth_client_configured:true};
  let input;
  const p=panel({api:{getPluginCatalog:async()=>[canva],authorizePlugin:async body=>{input=body;return {status:'awaiting_login',flow_id:id,authorization_url:pending.url,name:'Canva'};}}});
  await p.view.flush();find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']==='Connect Canva').props.onClick();await p.view.flush();
  assert.equal(input.url,canva.url);assert.equal(input.oauth_client,undefined);
  assert.match(textOf(p.view.tree),/Continue to Canva/);p.view.unmount();
});

test('explicit connection checks its exact returned plugin once and shows verification progress',async()=>{
  const check=deferred();let saved=[],calls=0,authorizations=0;
  const p=panel({api:{getPlugins:async()=>saved,authorizePlugin:async()=>{authorizations++;saved=[linkedPlugin()];return{status:'connected',plugin_id:'linked-account',name:item.name};},testPlugin:async pid=>{assert.equal(pid,'linked-account');calls++;return check.promise;}}});
  await p.view.flush();assert.equal(calls,0,'opening Apps never executes a provider tool');
  const start=find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']===`Connect ${item.name}`);start.props.onClick();start.props.onClick();
  await p.view.flush();
  assert.equal(authorizations,1);assert.equal(calls,1);
  assert.match(textOf(p.view.tree),/checking its tools/);
  saved=[linkedPlugin({status:'passed',checked_at:new Date().toISOString()})];
  check.resolve({status:'passed',message:'A read-only tool returned successfully.',latency_ms:10});
  await p.view.flush();await p.view.flush();
  assert.match(textOf(p.view.tree),/Fixture Service connected/);
  assert.match(textOf(p.view.tree),/Test passed/);
  assert.equal(calls,1);p.view.unmount();
});

test('Allow completion verifies the returned plugin instead of guessing a matching service',async()=>{
  let status='awaiting_login',checks=0;
  const p=panel({api:{pluginAuthStatus:async()=>({status,name:item.name,plugin_id:'linked-account'}),getPlugins:async()=>status==='connected'?[linkedPlugin({status:'discovered'})]:[],testPlugin:async pid=>{assert.equal(pid,'linked-account');checks++;return{status:'discovered',message:'Tools discovered. Execution has not been tested for this service.'};}}});
  await connect(p);assert.equal(checks,0);
  status='connected';p.env.time.advance(2000);await p.view.flush();await p.view.flush();
  assert.equal(checks,1);assert.equal(p.session.getItem(auth.PLUGIN_SIGN_IN_KEY),null);
  assert.match(textOf(p.view.tree),/Tools found/);
  assert.doesNotMatch(textOf(p.view.tree),/Test passed/);p.view.unmount();
});

test('a failed HTTP tool check refreshes persisted sign-in evidence and preserves the saved connection',async()=>{
  let verification={status:'passed',checked_at:new Date().toISOString()},loads=0;
  const p=panel({api:{getPlugins:async()=>{loads++;return[linkedPlugin(verification)];},testPlugin:async()=>{verification={status:'failed',detail:{code:'sign_in_required',message:'Reconnect this account.'}};throw Error('Reconnect this account.');}}});
  await p.view.flush();find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']===`Manage ${item.name}`).props.onClick();await p.view.flush();
  button(p.view.tree,'Test again').props.onClick();await p.view.flush();await p.view.flush();
  assert.equal(loads,2);
  assert.match(textOf(p.view.tree),/Sign in again/);
  assert.doesNotMatch(textOf(p.view.tree),/Test passed/);
  assert.match(textOf(p.view.tree),/Account or API access linked/);
  assert.ok(button(p.view.tree,'Reconnect'));p.view.unmount();
});

test('successful sign-in stays saved when execution fails and never claims a successful tool call',async()=>{
  let saved=[];
  const p=panel({api:{getPlugins:async()=>saved,authorizePlugin:async()=>{saved=[linkedPlugin({status:'failed',detail:{message:'Provider unavailable.'}})];return{status:'connected',plugin_id:'linked-account',name:item.name};},testPlugin:async()=>{throw Error('Provider unavailable.');}}});
  await connect(p);await p.view.flush();
  assert.match(textOf(p.view.tree),/saved connection was preserved/);
  assert.match(textOf(p.view.tree),/Needs attention/);
  assert.doesNotMatch(textOf(p.view.tree),/Test passed/);
  assert.ok(button(p.view.tree,'Test tools'));p.view.unmount();
});

test('a failed evidence refresh stays retryable rather than silently leaving a stale pass',async()=>{
  let loads=0;
  const p=panel({api:{getPlugins:async()=>{if(++loads>1)throw Error('Synthetic offline');return[linkedPlugin()];},testPlugin:async()=>({status:'passed',message:'A read-only tool returned successfully.'})}});
  await p.view.flush();find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']===`Manage ${item.name}`).props.onClick();await p.view.flush();
  button(p.view.tree,'Test tools').props.onClick();await p.view.flush();await p.view.flush();
  assert.match(textOf(p.view.tree),/Could not refresh connection status/);
  assert.ok(button(p.view.tree,'Refresh connections'));p.view.unmount();
});

test('catalog request failures show recovery instead of a valid empty catalog',async()=>{
  let calls=0;
  const p=panel({api:{getPluginCatalog:async()=>{if(++calls===1)throw Error('Synthetic offline');return [item];}}});
  await p.view.flush();
  assert.match(textOf(p.view.tree),/App catalog unavailable/);
  assert.doesNotMatch(textOf(p.view.tree),/No apps match/);
  find(p.view.tree,n=>n.type==='button'&&textOf(n)==='Retry catalog').props.onClick();
  await p.view.flush();
  assert.doesNotMatch(textOf(p.view.tree),/App catalog unavailable/);
  assert.match(textOf(p.view.tree),/Fixture Service/);
  p.view.unmount();
});

test('connecting from a website search reveals the saved connection instead of filtering it out',async()=>{
  let saved=[];
  const p=panel({api:{getPlugins:async()=>saved,authorizePlugin:async()=>{saved=[linkedPlugin()];return{status:'connected',plugin_id:'linked-account',name:item.name};},testPlugin:async()=>({status:'discovered',message:'Tools found; execution not tested.'})}});
  await p.view.flush();
  const search=find(p.view.tree,n=>n.type==='input'&&n.props?.type==='search');
  search.props.onChange({target:{value:'provider.example'}});await p.view.flush();
  find(p.view.tree,n=>n.type==='form').props.onSubmit({preventDefault(){}});await p.view.flush();await p.view.flush();
  assert.match(textOf(p.view.tree),/Account or API access linked/);
  assert.doesNotMatch(textOf(p.view.tree),/No connected services match/);
  const connectedSearch=find(p.view.tree,n=>n.props?.['aria-label']==='Search my apps');
  assert.equal(connectedSearch.props.value,item.name);
  p.view.unmount();
});

test('catalog appears and can be searched while saved connections are still loading',async()=>{
  const pendingConnections=deferred();let authorizations=0;
  const p=panel({api:{getPlugins:()=>pendingConnections.promise,authorizePlugin:async()=>{authorizations++;throw Error('Must wait for saved connections');}}});
  await p.view.flush();
  assert.match(textOf(p.view.tree),/Fixture Service/);
  const search=find(p.view.tree,n=>n.type==='input'&&n.props?.type==='search');
  search.props.onChange({target:{value:'Fixture'}});await p.view.flush();
  const connect=find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']===`Connect ${item.name}`);
  assert.ok(connect);assert.equal(connect.props.disabled,true);assert.equal(authorizations,0);
  pendingConnections.resolve([linkedPlugin()]);await p.view.flush();await p.view.flush();
  assert.equal(find(p.view.tree,n=>n.type==='button'&&n.props?.className==='connector-connect'&&n.props?.['aria-label']===`Manage ${item.name}`).props.disabled,false);
  assert.equal(authorizations,0);
  p.view.unmount();
});

test('catalog stays visible when saved connections fail without permitting a duplicate connection',async()=>{
  const pendingConnections=deferred();let authorizations=0;
  const p=panel({api:{getPlugins:()=>pendingConnections.promise,authorizePlugin:async()=>{authorizations++;throw Error('Unexpected authorization');}}});
  await p.view.flush();assert.match(textOf(p.view.tree),/Fixture Service/);
  pendingConnections.reject(Error('offline'));await p.view.flush();await p.view.flush();
  assert.match(textOf(p.view.tree),/Could not load your saved connections/);
  assert.equal(find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']===`Connect ${item.name}`).props.disabled,true);
  assert.equal(authorizations,0);p.view.unmount();
});

test('Canva availability waits for available-account lookup',async()=>{
  const canva={...item,id:'canva-official',name:'Canva',url:'https://api.canva.com/connect/v1/mcp',auth:'registered_oauth'};
  const accounts=deferred();const p=panel({api:{getPluginCatalog:async()=>[canva],getAvailableConnections:()=>accounts.promise}});
  await p.view.flush();assert.doesNotMatch(textOf(p.view.tree),/Canva connections aren’t available yet/);
  assert.equal(find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']==='Connect Canva').props.disabled,true);
  accounts.resolve([]);await p.view.flush();
  assert.match(textOf(p.view.tree),/Canva connections aren’t available yet/);p.view.unmount();
});

test('retry publishes the catalog without waiting for slower connection refresh',async()=>{
  let catalogCalls=0,pluginCalls=0;const waiting=deferred();
  const p=panel({api:{getPluginCatalog:async()=>{if(++catalogCalls===1)throw Error('offline');return [item];},getPlugins:()=>++pluginCalls===1?Promise.resolve([]):waiting.promise}});
  await p.view.flush();assert.match(textOf(p.view.tree),/App catalog unavailable/);
  button(p.view.tree,'Retry catalog').props.onClick();await p.view.flush();
  assert.match(textOf(p.view.tree),/Fixture Service/);assert.doesNotMatch(textOf(p.view.tree),/App catalog unavailable/);
  waiting.resolve([]);await p.view.flush();p.view.unmount();
});

test('connection request failures do not claim there are no saved tools and retry recovers',async()=>{
  let calls=0;
  const p=panel({api:{getPlugins:async()=>{if(++calls===1)throw Error('Synthetic offline');return [];}}});
  await p.view.flush();
  assert.match(textOf(p.view.tree),/Could not load your saved connections/);
  assert.doesNotMatch(textOf(p.view.tree),/Connect an app below/);
  button(p.view.tree,'My apps').props.onClick();
  await p.view.flush();
  assert.match(textOf(p.view.tree),/Connections unavailable/);
  assert.doesNotMatch(textOf(p.view.tree),/No tools connected yet/);
  find(p.view.tree,n=>n.type==='button'&&textOf(n)==='Retry connections').props.onClick();
  await p.view.flush();
  assert.match(textOf(p.view.tree),/No tools connected yet/);
  assert.doesNotMatch(textOf(p.view.tree),/Connections unavailable/);
  p.view.unmount();
});

test('offline app errors stay focused on each section instead of repeating a summary alert',async()=>{
  const p=panel({runtimeConnected:false,api:{getPluginCatalog:async()=>{throw Error('Synthetic offline');},getPlugins:async()=>{throw Error('Synthetic offline');}}});
  await p.view.flush();
  const text=textOf(p.view.tree);
  assert.match(text,/Cypher is disconnected from its cloud runtime/);
  assert.doesNotMatch(text,/Some connections could not load/);
  assert.match(text,/App catalog unavailable/);
  assert.match(text,/Could not load your saved connections/);
  assert.ok(button(p.view.tree,'Retry catalog'));
  assert.ok(button(p.view.tree,'Retry connections'));
  p.view.unmount();
});

test('offline status does not hide an individual tool test failure',async()=>{
  const p=panel({runtimeConnected:false,api:{getPlugins:async()=>[{id:'linked-account',name:item.name,url:item.url,enabled:true,authenticated:true,tools:[]}],testPlugin:async()=>{throw Error('Synthetic tool access denied');}}});
  await p.view.flush();
  find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']===`Manage ${item.name}`).props.onClick();
  await p.view.flush();
  button(p.view.tree,'Test tools').props.onClick();
  await p.view.flush();
  const alert=find(p.view.tree,node=>node.props?.role==='alert'&&textOf(node).includes('Synthetic tool access denied'));
  assert.ok(alert,'an action failure must stay visible while the runtime is disconnected');
  p.view.unmount();
});

test('connected runtime keeps the summary recovery notice when connections cannot load',async()=>{
  const p=panel({runtimeConnected:true,api:{getPlugins:async()=>{throw Error('Synthetic failure');}}});
  await p.view.flush();
  assert.match(textOf(p.view.tree),/Some connections could not load/);
  assert.ok(button(p.view.tree,'Refresh connections'));
  p.view.unmount();
});

test('Connected view opens saved skills separately from account connections',async()=>{
  let opens=0;
  const p=panel({onManageSkills:()=>{opens++;}});
  await p.view.flush();
  button(p.view.tree,'My apps').props.onClick();
  await p.view.flush();
  assert.match(textOf(p.view.tree),/Create and manage reusable skill recipes separately in your workspace library/);
  button(p.view.tree,'Saved instructions').props.onClick();
  assert.equal(opens,1);
  p.view.unmount();
});

test('embedded app management opens the saved connection without reauthorizing or claiming a tool test',async()=>{
  let authorizations=0;
  const p=panel({embedded:true,api:{getPlugins:async()=>[{id:'linked-account',name:item.name,url:item.url,enabled:true,authenticated:true,tools:[{name:'read_source',description:'Read a source',enabled:true}]}],authorizePlugin:async()=>{authorizations++;throw Error('Management must not start authorization');}}});
  await p.view.flush();
  assert.equal(p.view.tree.type,'section');
  assert.match(textOf(p.view.tree),/Not tested/);
  find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']==='Manage Fixture Service').props.onClick();
  await p.view.flush();
  assert.equal(authorizations,0);
  assert.equal(p.opens,0);
  assert.match(textOf(p.view.tree),/Account or API access linked/);
  assert.match(textOf(p.view.tree),/Not tested/);
  assert.ok(find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']==='Enable Fixture Service'));
  p.view.unmount();
});

test('blocked popup leaves a working provider link and the conversation in place',async()=>{
  const p=panel({popupBlocked:true});await connect(p);
  const link=find(p.view.tree,n=>n.type==='a'&&textOf(n)==='Continue to Fixture Service');
  assert.equal(link.props.href,pending.url);assert.equal(link.props.target,'_blank');
  assert.equal(p.opens,1);assert.ok(p.session.getItem(auth.PLUGIN_SIGN_IN_KEY));
  assert.match(textOf(p.view.tree),/Review the permissions and choose Allow or Authorize/);
  assert.ok(button(p.view.tree,'Check connection'));p.view.unmount();
});
test('Lovable opens its official MCP OAuth flow and waits for verified tools after Allow',async()=>{
  let request,status='awaiting_login';
  const p=panel({api:{authorizePlugin:async input=>{request=input;return {status:'awaiting_login',flow_id:id,authorization_url:'https://lovable.example/authorize?state=synthetic',name:'Lovable'};},pluginAuthStatus:async()=>({status,name:'Lovable'})}});
  await p.view.flush();find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']==='Connect Lovable').props.onClick();await p.view.flush();await p.view.flush();
  assert.equal(request.url,'https://mcp.lovable.dev');assert.equal(request.name,'Lovable');
  assert.match(textOf(p.view.tree),/review the permissions Lovable lists and press Allow/i);
  assert.match(textOf(p.view.tree),/only (?:the )?tools Lovable authorizes/i);
  assert.ok(find(p.view.tree,n=>n.type==='a'&&textOf(n)==='Continue to Lovable'));
  assert.ok(p.session.getItem(auth.PLUGIN_SIGN_IN_KEY));
  status='connected';p.env.time.advance(4000);await p.view.flush();
  assert.match(textOf(p.view.tree),/Lovable connected/);assert.equal(p.session.getItem(auth.PLUGIN_SIGN_IN_KEY),null);p.view.unmount();
});
test('a closed provider window can be reopened through the real link',async()=>{
  const p=panel();await connect(p);p.popup.closed=true;let prevented=false;
  find(p.view.tree,n=>n.type==='a'&&textOf(n)==='Continue to Fixture Service').props.onClick({preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(p.popups[1].location.url,pending.url);
  assert.deepEqual(JSON.parse(p.popups[1].sessionStorage.getItem(auth.PLUGIN_SIGN_INS_KEY)).map(value=>value.id),[id]);p.view.unmount();
});
test('a blocked reopening leaves the direct provider link usable',async()=>{
  const p=panel();await connect(p);p.popup.closed=true;p.env.window.open=()=>null;let prevented=false;
  find(p.view.tree,n=>n.type==='a'&&textOf(n)==='Continue to Fixture Service').props.onClick({preventDefault(){prevented=true;}});
  assert.equal(prevented,false);p.view.unmount();
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
  const wait=deferred();let starts=0;const p=panel({api:{authorizePlugin:()=>{starts++;return wait.promise;}}});await p.view.flush();const connect=find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']===`Connect ${item.name}`);connect.props.onClick();connect.props.onClick();await p.view.flush();assert.equal(starts,1);
  wait.resolve({status:'connected',name:item.name});await p.view.flush();p.view.unmount();
});
test('failed cancellation keeps a resumable flow; successful cancellation clears it',async()=>{
  let calls=0;const p=panel({api:{cancelPluginAuth:async()=>{if(++calls===1)throw Error('Synthetic offline');return {status:'cancelled'};}}});await connect(p);
  button(p.view.tree,'Cancel sign-in').props.onClick();await p.view.flush();assert.ok(p.session.getItem(auth.PLUGIN_SIGN_IN_KEY));
  button(p.view.tree,'Cancel sign-in').props.onClick();await p.view.flush();assert.equal(p.session.getItem(auth.PLUGIN_SIGN_IN_KEY),null);assert.match(textOf(p.view.tree),/Sign-in cancelled/);p.view.unmount();
});
test('multiple selected apps proceed after a failure and retain independent sign-ins',async()=>{
  const one={...item,id:'one',name:'One',url:'https://one.example/mcp'};
  const two={...item,id:'two',name:'Two',url:'https://two.example/mcp'};
  const three={...item,id:'three',name:'Three',url:'https://three.example/mcp'};
  const first=deferred(),calls=[];const id2='f52dad3f-b0db-4cf8-a0f0-f9b88c16f230';
  const p=panel({api:{getPluginCatalog:async()=>[one,two,three],authorizePlugin:async input=>{calls.push(input.name);if(input.name==='One')return first.promise;if(input.name==='Two')throw Error('provider failed');return {status:'awaiting_login',flow_id:id2,name:input.name,authorization_url:'https://three.example/allow'};}}});
  await p.view.flush();const click=name=>find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']===`Connect ${name}`).props.onClick();
  click('One');click('One');click('Two');click('Three');await p.view.flush();assert.deepEqual(calls,['One']);
  first.resolve({status:'awaiting_login',flow_id:id,name:'One',authorization_url:'https://one.example/allow'});await p.view.flush();await p.view.flush();
  assert.deepEqual(calls,['One','Two','Three']);assert.match(textOf(p.view.tree),/Could not connect/);
  assert.ok(find(p.view.tree,n=>n.type==='a'&&n.props?.href==='https://one.example/allow'));
  assert.ok(find(p.view.tree,n=>n.type==='a'&&n.props?.href==='https://three.example/allow'));
  assert.equal(JSON.parse(p.session.getItem(auth.PLUGIN_SIGN_INS_KEY)).length,2);
  assert.equal(p.popups.length,3);assert.equal(p.popups[0].closed,false);assert.equal(p.popups[1].closed,true);assert.equal(p.popups[2].closed,false);
  assert.deepEqual(JSON.parse(p.popups[0].sessionStorage.getItem(auth.PLUGIN_SIGN_INS_KEY)).map(value=>value.id),[id]);
  assert.deepEqual(JSON.parse(p.popups[2].sessionStorage.getItem(auth.PLUGIN_SIGN_INS_KEY)).map(value=>value.id),[id2]);
  p.view.unmount();
});

test('an unsafe provider link fails its own app and does not stop the queue',async()=>{
  const one={...item,id:'one',name:'One',url:'https://one.example/mcp'},two={...item,id:'two',name:'Two',url:'https://two.example/mcp'};const calls=[];
  const p=panel({api:{getPluginCatalog:async()=>[one,two],authorizePlugin:async input=>{calls.push(input.name);return {status:'awaiting_login',flow_id:input.name==='One'?'f52dad3f-b0db-4cf8-a0f0-f9b88c16f230':id,name:input.name,authorization_url:input.name==='One'?'javascript:alert(1)':'https://two.example/allow'};}}});
  await p.view.flush();find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']==='Connect One').props.onClick();find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']==='Connect Two').props.onClick();await p.view.flush();await p.view.flush();
  assert.deepEqual(calls,['One','Two']);assert.match(textOf(p.view.tree),/Could not connect/);assert.equal(p.popups[0].closed,true);
  assert.equal(find(p.view.tree,n=>n.type==='a'&&n.props?.href==='javascript:alert(1)'),undefined);assert.ok(find(p.view.tree,n=>n.type==='a'&&n.props?.href==='https://two.example/allow'));p.view.unmount();
});

test('cancelling an in-flight start moves on without treating a late result as a connection',async()=>{
  const one={...item,id:'one',name:'One',url:'https://one.example/mcp'};const two={...item,id:'two',name:'Two',url:'https://two.example/mcp'};
  const late=deferred(),calls=[];let firstSignal;
  const p=panel({api:{getPluginCatalog:async()=>[one,two],authorizePlugin:(input,signal)=>{calls.push(input.name);if(input.name==='One'){firstSignal=signal;return late.promise;}return Promise.resolve({status:'awaiting_login',flow_id:id,name:'Two',authorization_url:'https://two.example/allow'});}}});
  await p.view.flush();find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']==='Connect One').props.onClick();find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']==='Connect Two').props.onClick();await p.view.flush();
  button(p.view.tree,'Cancel One').props.onClick();await p.view.flush();await p.view.flush();
  assert.equal(firstSignal.aborted,true);assert.deepEqual(calls,['One','Two']);assert.equal(p.popups[0].closed,true);
  late.resolve({status:'awaiting_login',flow_id:'f52dad3f-b0db-4cf8-a0f0-f9b88c16f230',name:'One',authorization_url:'https://one.example/allow'});await p.view.flush();
  assert.equal(find(p.view.tree,n=>n.type==='a'&&n.props?.href==='https://one.example/allow'),undefined);assert.ok(find(p.view.tree,n=>n.type==='a'&&n.props?.href==='https://two.example/allow'));p.view.unmount();
});

test('cancelling a pending approval never authorizes it after it resolves',async()=>{
  const one={...item,id:'one',name:'One',url:'https://one.example/mcp'},two={...item,id:'two',name:'Two',url:'https://two.example/mcp'};
  const approval=deferred(),calls=[];let approvals=0;
  const p=panel({approve:()=>++approvals===1?approval.promise:Promise.resolve(undefined),api:{getPluginCatalog:async()=>[one,two],authorizePlugin:async input=>{calls.push(input.name);return {status:'awaiting_login',flow_id:id,name:input.name,authorization_url:'https://two.example/allow'};}}});
  await p.view.flush();find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']==='Connect One').props.onClick();find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']==='Connect Two').props.onClick();await p.view.flush();
  button(p.view.tree,'Cancel One').props.onClick();await p.view.flush();await p.view.flush();assert.deepEqual(calls,['Two']);
  approval.resolve(undefined);await p.view.flush();assert.deepEqual(calls,['Two']);p.view.unmount();
});

test('a slow tool check does not delay starting the next selected app',async()=>{
  const two={...item,id:'two',name:'Two',url:'https://two.example/mcp'},check=deferred();const calls=[];
  const p=panel({api:{getPluginCatalog:async()=>[item,two],authorizePlugin:async input=>{calls.push(input.name);return input.name===item.name?{status:'connected',plugin_id:'linked-account',name:input.name}:{status:'awaiting_login',flow_id:id,name:input.name,authorization_url:'https://two.example/allow'};},testPlugin:()=>check.promise}});
  await p.view.flush();find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']===`Connect ${item.name}`).props.onClick();
  find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']==='Connect Two').props.onClick();await p.view.flush();await p.view.flush();
  assert.deepEqual(calls,[item.name,'Two']);assert.ok(find(p.view.tree,n=>n.type==='a'&&n.props?.href==='https://two.example/allow'));
  check.resolve({status:'passed',message:'Read succeeded.'});await p.view.flush();p.view.unmount();
});

test('one stalled provider status does not prevent another pending flow completing',async()=>{
  const second={id:'f52dad3f-b0db-4cf8-a0f0-f9b88c16f230',name:'Two',url:'https://two.example/allow',startedAt:0};
  const slow=deferred(),checked=[];
  const p=panel({saved:{[auth.PLUGIN_SIGN_INS_KEY]:JSON.stringify([pending,second])},api:{pluginAuthStatus:flow=>{checked.push(flow);return flow===id?slow.promise:Promise.resolve({status:'connected',name:'Two'});}}});
  await p.view.flush();await p.view.flush();assert.deepEqual(checked,[id,second.id]);
  assert.equal(find(p.view.tree,n=>n.type==='a'&&n.props?.href===second.url),undefined);assert.ok(find(p.view.tree,n=>n.type==='a'&&n.props?.href===pending.url));
  slow.resolve({status:'awaiting_login',name:item.name});await p.view.flush();p.view.unmount();
});

test('API-key setup remains actionable while another app continues',async()=>{
  const keyed={...item,id:'keyed',name:'Keyed',url:'https://key.example/mcp',auth:'api_key'};let calls=0;
  const p=panel({api:{getPluginCatalog:async()=>[keyed,item],authorizePlugin:async()=>{calls++;return {status:'awaiting_login',flow_id:id,name:item.name,authorization_url:pending.url};}}});
  await p.view.flush();find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']==='View options Keyed').props.onClick();
  find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']===`Connect ${item.name}`).props.onClick();await p.view.flush();await p.view.flush();
  assert.equal(calls,1);assert.ok(find(p.view.tree,n=>n.type==='a'&&n.props?.href===pending.url));
  button(p.view.tree,'View options for Keyed').props.onClick();await p.view.flush();
  assert.ok(find(p.view.tree,n=>n.props?.id==='plugin-token'));assert.match(textOf(p.view.tree),/Keyed uses an API key/);p.view.unmount();
});

test('multiple pending sign-ins resume separately and cancellation removes only its own flow',async()=>{
  const second={id:'f52dad3f-b0db-4cf8-a0f0-f9b88c16f230',name:'Two',url:'https://two.example/allow',startedAt:0};
  const saved={[auth.PLUGIN_SIGN_INS_KEY]:JSON.stringify([pending,second])};let cancelled=[];
  const p=panel({saved,api:{cancelPluginAuth:async flow=>{cancelled.push(flow);return {status:'cancelled'};}}});
  await p.view.flush();assert.ok(find(p.view.tree,n=>n.type==='a'&&n.props?.href===pending.url));assert.ok(find(p.view.tree,n=>n.type==='a'&&n.props?.href===second.url));
  const section=find(p.view.tree,n=>n.props?.['aria-label']===`Connect ${item.name}`&&n.type==='section');
  button(section,'Cancel sign-in').props.onClick();await p.view.flush();
  assert.deepEqual(cancelled,[id]);assert.deepEqual(JSON.parse(p.session.getItem(auth.PLUGIN_SIGN_INS_KEY)).map(x=>x.id),[second.id]);
  assert.ok(find(p.view.tree,n=>n.type==='a'&&n.props?.href===second.url));p.view.unmount();
});

test('closing during authorization preserves its returned flow and never starts queued work',async()=>{
  const second={...item,id:'two',name:'Two',url:'https://two.example/mcp'},first=deferred();let calls=0;
  const p=panel({api:{getPluginCatalog:async()=>[item,second],authorizePlugin:async()=>{calls++;return first.promise;}}});
  await p.view.flush();find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']===`Connect ${item.name}`).props.onClick();
  find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']==='Connect Two').props.onClick();await p.view.flush();
  p.view.unmount();first.resolve({status:'awaiting_login',flow_id:id,name:item.name,authorization_url:pending.url});
  await p.view.flush();await p.view.flush();assert.equal(calls,1);assert.equal(p.view.updatesAfterUnmount,0);
  assert.equal(JSON.parse(p.session.getItem(auth.PLUGIN_SIGN_INS_KEY))[0].id,id);assert.equal(p.popups[1].closed,true);
});

test('provider return removes only its matching stored flow',async()=>{
  const second={id:'f52dad3f-b0db-4cf8-a0f0-f9b88c16f230',name:'Two',url:'https://two.example/allow',startedAt:0};
  const p=panel({saved:{[auth.PLUGIN_SIGN_INS_KEY]:JSON.stringify([pending,second])},locationSearch:`?workspace=1&plugins=connected&plugin_flow=${id}`});
  await p.view.flush();assert.deepEqual(JSON.parse(p.session.getItem(auth.PLUGIN_SIGN_INS_KEY)).map(value=>value.id),[second.id]);
  assert.ok(find(p.view.tree,n=>n.type==='a'&&n.props?.href===second.url));p.view.unmount();
});

test('a late result merges with sign-ins started in a newly opened panel',async()=>{
  const late=deferred(),two={...item,id:'two',name:'Two',url:'https://two.example/mcp'};const id2='f52dad3f-b0db-4cf8-a0f0-f9b88c16f230';
  const old=panel({api:{authorizePlugin:()=>late.promise}});await old.view.flush();
  find(old.view.tree,n=>n.type==='button'&&n.props?.['aria-label']===`Connect ${item.name}`).props.onClick();await old.view.flush();old.view.unmount();
  const fresh=panel({existingSession:old.session,existingEnvironment:old.env,api:{getPluginCatalog:async()=>[two],authorizePlugin:async()=>({status:'awaiting_login',flow_id:id2,name:'Two',authorization_url:'https://two.example/allow'})}});
  await fresh.view.flush();find(fresh.view.tree,n=>n.type==='button'&&n.props?.['aria-label']==='Connect Two').props.onClick();await fresh.view.flush();
  late.resolve({status:'awaiting_login',flow_id:id,name:item.name,authorization_url:pending.url});await old.view.flush();await fresh.view.flush();
  assert.deepEqual(JSON.parse(fresh.session.getItem(auth.PLUGIN_SIGN_INS_KEY)).map(value=>value.id).sort(),[id,id2].sort());
  assert.ok(find(fresh.view.tree,n=>n.type==='a'&&n.props?.href===pending.url));assert.ok(find(fresh.view.tree,n=>n.type==='a'&&n.props?.href==='https://two.example/allow'));
  assert.equal(old.view.updatesAfterUnmount,0);fresh.view.unmount();
});

test('a restored pending sign-in prevents reauthorization of the same endpoint without storing its address',async()=>{
  const key=createHash('sha256').update(item.url+'|').digest('hex');let calls=0;
  const p=panel({saved:{[auth.PLUGIN_SIGN_INS_KEY]:JSON.stringify([{...pending,keyHash:key}])},api:{authorizePlugin:async()=>{calls++;throw Error('Unexpected duplicate');}}});
  await p.view.flush();find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']===`Connect ${item.name}`).props.onClick();await p.view.flush();
  assert.equal(calls,0);assert.equal(p.popup.closed,true);assert.doesNotMatch(p.session.getItem(auth.PLUGIN_SIGN_INS_KEY),/provider\.example\/mcp/);p.view.unmount();
});

test('expired or unsafe stored links are never resumed',()=>{
  for(const change of [{url:'javascript:alert(1)'},{url:'https://user:secret@provider.example/allow'},{startedAt:-auth.PLUGIN_SIGN_IN_TTL},{id:'other'}]){const s=storage({[auth.PLUGIN_SIGN_IN_KEY]:JSON.stringify({...pending,...change})});assert.equal(auth.readPluginSignIn(s,0),null);assert.equal(s.getItem(auth.PLUGIN_SIGN_IN_KEY),null);}
});
test('multiple stored flows migrate legacy state and retain only safe unexpired entries',()=>{
  const old=storage({[auth.PLUGIN_SIGN_IN_KEY]:JSON.stringify(pending)});assert.equal(auth.readPluginSignIns(old,0)[0].id,id);
  const second={id:'f52dad3f-b0db-4cf8-a0f0-f9b88c16f230',name:'Two',url:'https://two.example/allow',startedAt:0,keyHash:'a'.repeat(64)};
  const mixed=storage({[auth.PLUGIN_SIGN_INS_KEY]:JSON.stringify([pending,{...second,url:'javascript:alert(1)'},second,{...pending,id:'bad'}])});
  assert.deepEqual(Array.from(auth.readPluginSignIns(mixed,0),x=>x.id),[id,second.id]);
  assert.equal(auth.readPluginSignIns(mixed,auth.PLUGIN_SIGN_IN_TTL).length,0);
});

test('pending start reservations deduplicate across panels and release only their own claim',()=>{
  const state=storage(),hash='a'.repeat(64),other='b'.repeat(64);
  assert.equal(auth.reservePluginStart(state,hash,'first',0),true);assert.equal(auth.reservePluginStart(state,hash,'second',0),false);
  assert.equal(auth.reservePluginStart(state,other,'other',0),true);auth.releasePluginStart(state,'first',0);
  assert.equal(auth.reservePluginStart(state,hash,'second',0),true);
  auth.releasePluginStart(state,'first',0);assert.equal(auth.reservePluginStart(state,hash,'third',0),false);
  assert.equal(auth.reservePluginStart(state,hash,'later',auth.PLUGIN_SIGN_IN_TTL),true);
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
  for (const name of components) imports['./'+name] = { [name]: name };
  imports['./PanelBoundary']={PanelBoundary:'panel-boundary'};
  imports['./cipher/CypherEntrance']={__esModule:true,default:'CypherEntrance'};
  const {default:WorkspaceApp}=load('../src/components/WorkspaceApp.tsx',{react:{...view.react,lazy:loader=>{const component={};loader().then(module=>{component.resolved=module.default;});return component;}},...imports},{...env.globals,URLSearchParams,setInterval:()=>1,clearInterval(){}});
  view.mount(()=>WorkspaceApp({}));await view.flush();
  assert.ok(find(view.tree,n=>n.props?.embedded===true),'callback result remains visible after conversation restoration');
  const pluginPanel=find(view.tree,n=>n.props?.embedded===true);
  assert.equal(typeof pluginPanel.props.onManageSkills,'function','Connected tools expose a skills-management handoff');
  pluginPanel.props.onManageSkills();
  view.render();
  const skillsHub=find(view.tree,n=>n.props?.initialTab==='Skills');
  assert.ok(skillsHub,'the handoff opens the workspace Skills tab directly');
  view.unmount();
});

test('provider registration errors open an actionable OAuth form without claiming connection',async()=>{
  let calls=0,input;
  const p=panel({api:{authorizePlugin:async data=>{input=data;if(++calls===1)throw Object.assign(Error('Registered client required'),{details:{code:'oauth_registration_required',callback_url:'https://app.example/api/plugin-oauth/callback'}});return {status:'awaiting_login',flow_id:id,authorization_url:pending.url,name:'Lovable'};}}});
  await p.view.flush();find(p.view.tree,n=>n.type==='button'&&n.props?.['aria-label']==='Connect Lovable').props.onClick();await p.view.flush();
  assert.match(textOf(p.view.tree),/Sign-in isn’t ready for Lovable yet/);
  assert.equal(find(p.view.tree,n=>n.props?.role==='alert'),undefined);
  const field=label=>find(find(p.view.tree,n=>n.type==='label'&&textOf(n).startsWith(label)),n=>n.type==='input');
  field('Client ID').props.onChange({target:{value:'fixture-own-client'}});
  field('Client secret').props.onChange({target:{value:'fixture-private-secret'}});
  await p.view.flush();
  const section=find(p.view.tree,n=>n.props?.className==='plugin-registration');
  await find(section,n=>n.type==='form').props.onSubmit({preventDefault(){}});await p.view.flush();
  assert.equal(input.oauth_client.client_id,'fixture-own-client');
  assert.equal(input.oauth_client.client_secret,'fixture-private-secret');
  assert.ok(find(p.view.tree,n=>n.type==='a'&&textOf(n)==='Continue to Lovable'));
  assert.doesNotMatch(textOf(p.view.tree),/Lovable connected/);
  p.view.unmount();
});

test('connected tool descriptions are searchable and public tools have a separate view',async()=>{
  const connections=[{id:'account',name:'Account fixture',url:'https://account.example/mcp',authenticated:true,enabled:true,tools:[{name:'lookup',description:'Find invoices'}]},{id:'public',name:'Public fixture',url:'https://public.example/mcp',authenticated:false,enabled:true,tools:[{name:'public_read',description:'Public documentation'}]}];
  const p=panel({api:{getPlugins:async()=>connections}});await p.view.flush();
  button(p.view.tree,'My apps · 1').props.onClick();await p.view.flush();
  assert.match(textOf(p.view.tree),/Account fixture/);assert.doesNotMatch(textOf(p.view.tree),/Public fixture/);
  button(p.view.tree,'Public tools · 1').props.onClick();await p.view.flush();assert.match(textOf(p.view.tree),/Public fixture/);
  find(p.view.tree,n=>n.props?.['aria-label']==='Search public tools').props.onChange({target:{value:'invoices'}});await p.view.flush();
  assert.match(textOf(p.view.tree),/No public tools match your search/);assert.doesNotMatch(textOf(p.view.tree),/Account fixture/);
  button(p.view.tree,'Account connections').props.onClick();await p.view.flush();
  find(p.view.tree,n=>n.props?.['aria-label']==='Search my apps').props.onChange({target:{value:'invoices'}});await p.view.flush();
  assert.match(textOf(p.view.tree),/Account fixture/);assert.doesNotMatch(textOf(p.view.tree),/Public fixture/);
  p.view.unmount();
});

test('My apps search counts and shows only matching account connections',async()=>{
  const connections=[{id:'account',name:'GitHub',url:'https://github.example/mcp',authenticated:true,enabled:true,tools:[{name:'issues',description:'Find GitHub issues'}]},{id:'public',name:'Public docs',url:'https://public.example/mcp',authenticated:false,enabled:true,tools:[{name:'search',description:'Search GitHub docs'}]}];
  const p=panel({api:{getPlugins:async()=>connections}});await p.view.flush();button(p.view.tree,'My apps · 1').props.onClick();await p.view.flush();
  const search=find(p.view.tree,n=>n.props?.['aria-label']==='Search my apps');search.props.onChange({target:{value:'GitHub'}});await p.view.flush();
  assert.match(textOf(p.view.tree),/Your connections 1/);assert.match(textOf(p.view.tree),/GitHub/);assert.doesNotMatch(textOf(p.view.tree),/Public docs/);
  find(p.view.tree,n=>n.props?.['aria-label']==='Search my apps').props.onChange({target:{value:'nothing'}});await p.view.flush();
  assert.match(textOf(p.view.tree),/Your connections 0/);assert.match(textOf(p.view.tree),/No connected services match your search/);p.view.unmount();
});

test('structured registration responses retain recovery fields and readable errors',async()=>{
  const fields={message:'Provider registration needed',code:'oauth_registration_required',callback_url:'https://app.example/api/plugin-oauth/callback'};
  const {request}=load('../src/lib/api.ts',{'./conversations':{}},{process:{env:{}},AbortSignal,fetch:async()=>({ok:false,status:422,headers:{get:()=>null},json:async()=>({detail:fields})})});
  await assert.rejects(()=>request('/plugins/authorize'),error=>error.message===fields.message&&error.code===fields.code&&error.details.callback_url===fields.callback_url);
});


test('authorizePlugin forwards an optional cancellation signal',async()=>{
  let received;const controller=new AbortController();
  const {api}=load('../src/lib/api.ts',{'./conversations':{}},{process:{env:{}},AbortSignal,fetch:async(_url,options)=>{received=options.signal;return {ok:true,json:async()=>({status:'awaiting_login',name:'Fixture'})};}});
  await api.authorizePlugin({name:'Fixture',url:'https://provider.example/mcp'},controller.signal);
  assert.equal(received.aborted,false);controller.abort();assert.equal(received.aborted,true);
});

test('Apps exposes Meta permissions directly without starting another authorization flow',async()=>{
  let authorizations=0,checks=0;
  const p=panel({api:{authorizePlugin:async()=>{authorizations++;throw Error('Navigation must not authorize');},testPlugin:async()=>{checks++;throw Error('Navigation must not execute a tool');}}});
  await p.view.flush();
  const entry=()=>find(p.view.tree,n=>n.type==='a'&&textOf(n)==='Connect Facebook & Instagram');
  assert.equal(entry().props.href,'/connect/meta');
  assert.equal(entry().props.target,undefined,'the existing signed-in permission page opens in this tab');
  find(p.view.tree,n=>n.props?.id==='plugin-search').props.onChange({target:{value:'Instagram'}});
  await p.view.flush();
  assert.equal(entry().props.href,'/connect/meta','the dedicated entry remains discoverable when searching for Instagram');
  assert.equal(authorizations,0);assert.equal(checks,0);assert.equal(p.opens,0);
  p.view.unmount();
});

test('legacy Gmail entries use native Google recovery instead of invalid website authorization',async()=>{
  const p=panel({embedded:true,api:{getPlugins:async()=>[{id:'legacy-gmail',name:'Gmail',url:'site-mcp://gmail.com',enabled:true,authenticated:true,tools:[]}]}});
  await p.view.flush();
  find(p.view.tree,n=>n.props?.['aria-label']==='Manage Gmail').props.onClick();await p.view.flush();
  const recovery=find(p.view.tree,n=>n.type==='a'&&textOf(n)==='Use Google apps');
  assert.equal(recovery.props.href,'/connect/google');
  assert.equal(button(p.view.tree,'Reconnect'),undefined);
  assert.equal(p.opens,0);
  p.view.unmount();
});

test('an app needing a key never starts sign-in or sends a new user straight to a key form',async()=>{
  let authorizations=0;
  const manual={...item,name:'Private Reports',auth:'api_key'};
  const p=panel({api:{getPluginCatalog:async()=>[manual],authorizePlugin:async()=>{authorizations++;throw Error('Unexpected authorization');}}});
  await p.view.flush();
  assert.equal(find(p.view.tree,n=>n.props?.id==='plugin-setup-filter'),undefined,'authentication protocols are not a browsing filter');
  const options=find(p.view.tree,n=>n.type==='details'&&textOf(n).startsWith('Apps that need additional setup'));
  assert.equal(options.props.open,false,'manual setup stays outside the ordinary path');
  find(p.view.tree,n=>n.props?.id==='plugin-search').props.onChange({target:{value:'Private Reports'}});
  await p.view.flush();
  await find(p.view.tree,n=>n.type==='form'&&n.props?.className==='website-connect').props.onSubmit({preventDefault(){}});
  await p.view.flush();
  assert.equal(authorizations,0);
  assert.equal(p.opens,0);
  assert.equal(find(p.view.tree,n=>n.props?.id==='plugin-token'),undefined,'no key form appears automatically');
  assert.equal(find(p.view.tree,n=>n.type==='details'&&textOf(n).startsWith('Apps that need additional setup')).props.open,true);
  assert.match(textOf(p.view.tree),/your account has not been connected/);
  p.view.unmount();
});

test('ordinary app search stays local until the user asks for community connections',async()=>{
  let lookups=0;
  const p=panel({api:{searchMcpRegistry:async()=>{lookups++;return {items:[],next_cursor:null};}}});
  await p.view.flush();
  find(p.view.tree,n=>n.props?.id==='plugin-search').props.onChange({target:{value:'Fixture'}});
  await p.view.flush();p.env.time.advance(300);await p.view.flush();
  assert.equal(lookups,0);
  find(p.view.tree,n=>n.type==='details'&&textOf(n).startsWith('Search more connections')).props.onToggle({currentTarget:{open:true}});
  await p.view.flush();p.env.time.advance(300);await p.view.flush();
  assert.equal(lookups,1);
  assert.equal(p.opens,0);
  p.view.unmount();
});

test('a saved HTTPS root connection is managed without signing in again for a root-slash catalog URL',async()=>{
  let authorizations=0;
  const rootItem={...item,url:'https://provider.example/'};
  const p=panel({api:{getPluginCatalog:async()=>[rootItem],getPlugins:async()=>[{...linkedPlugin(),url:'https://provider.example'}],authorizePlugin:async()=>{authorizations++;throw Error('Must reuse the saved connection');}}});
  await p.view.flush();
  find(p.view.tree,n=>n.props?.id==='plugin-search').props.onChange({target:{value:item.name}});await p.view.flush();
  const entry=find(p.view.tree,n=>n.type==='article'&&n.props?.className==='connector-entry'&&textOf(n).includes(item.name));
  const manage=find(entry,n=>n.type==='button');
  assert.equal(manage.props['aria-label'],`Manage ${item.name}`);
  manage.props.onClick();await p.view.flush();
  assert.equal(authorizations,0);
  assert.equal(p.opens,0,'managing saved access does not open another sign-in window');
  assert.match(textOf(p.view.tree),/already in your workspace/);
  assert.ok(find(p.view.tree,n=>n.props?.['aria-label']==='Search my apps'));
  p.view.unmount();
});

test('saved-connection matching preserves endpoint queries and explicit connection IDs',async()=>{
  for(const [candidate,saved] of [
    [{...item,url:'https://provider.example/?account=one'},{...linkedPlugin(),url:'https://provider.example/?account=two'}],
    [{...item,connection_id:'new-account'},{...linkedPlugin(),connection_id:'saved-account'}],
  ]){
    const p=panel({api:{getPluginCatalog:async()=>[candidate],getPlugins:async()=>[saved]}});
    await p.view.flush();
    find(p.view.tree,n=>n.props?.id==='plugin-search').props.onChange({target:{value:item.name}});await p.view.flush();
    const entry=find(p.view.tree,n=>n.type==='article'&&n.props?.className==='connector-entry'&&textOf(n).includes(item.name));
    assert.equal(find(entry,n=>n.type==='button').props['aria-label'],`Connect ${item.name}`,'another account must not be treated as the selected connection');
    p.view.unmount();
  }
});
