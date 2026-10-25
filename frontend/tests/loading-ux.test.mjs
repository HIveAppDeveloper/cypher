import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environment, renderer, load, deferred, find, textOf, button } from './support/component-harness.mjs';

function workspace(search = '') {
  const env = environment(), view = renderer(env), pending = deferred();
  env.window.location = { search };
  let bots = [], loadingBots = true;
  const names = ['BotRoster','SidebarShell','ChatPanel','BotCreator','PluginPanel','GoalsPanel','ChannelsPanel','WorkspaceSetup','RoomCreator','CommandPalette','WorkspaceHub','ComputerPanel'];
  const imports = Object.fromEntries(names.flatMap(name => [['../components/'+name, {[name]:name}], ['./'+name, {[name]:name}]]));
  imports['./PanelBoundary'] = { PanelBoundary:'panel-boundary' };
  imports['../hooks/useBots'] = { useBots:()=>{
    const [selectedBot,setSelectedBot]=view.react.useState(null);
    return {bots,selectedBot,setSelectedBot,createBot(){},refreshBots:async()=>{},loading:loadingBots};
  } };
  imports['../components/PreferencesPanel'] = { PreferencesPanel:'preferences',restoreAppearance(){} };
  imports['../components/RunControls'] = { DEFAULT_OPTIONS:{} };
  imports['../lib/api'] = { api:{getConversations:()=>pending.promise},request:async()=>[] };
  imports['./cipher/CypherEntrance'] = { __esModule:true,default:'entrance' };
  const react = {...view.react,lazy:()=>'lazy-panel'};
  const {default:WorkspaceApp} = load('../src/components/WorkspaceApp.tsx',{react,...imports},{...env.globals,URLSearchParams,setInterval:()=>1,clearInterval(){}});
  view.mount(()=>WorkspaceApp({}));
  return {view,pending,setBots(next){bots=next;loadingBots=false;view.rerender();}};
}
const lounge = {id:'synthetic-lounge',title:'Agent lounge',is_group:true,bot_ids:[]};

test('slow startup cannot navigate away after the user chooses New task',async()=>{
  const {view,pending}=workspace();
  find(view.tree,node=>node.type==='BotRoster').props.onHome();
  pending.resolve([lounge]);await view.flush();
  assert.equal(find(view.tree,node=>node.type==='ChatPanel').props.room,null);
  view.unmount();
});

test('startup keeps the task home visible while existing rooms remain available',async()=>{
  const {view,pending}=workspace();pending.resolve([lounge]);await view.flush();
  assert.equal(find(view.tree,node=>node.type==='ChatPanel').props.room,null);
  assert.equal(find(view.tree,node=>node.type==='BotRoster').props.rooms[0].id,lounge.id);
  assert.equal(find(view.tree,node=>node.type==='BotRoster').props.loadingRooms,false);
  view.unmount();
});

test('sign-in return restores the requested agent after its conversation initially failed to open',()=>{
  const {view,setBots}=workspace('?bot=synthetic-agent');
  const agent={id:'synthetic-agent',name:'Saved agent',description:'Synthetic fixture',role:'Researcher',llmProvider:'openai',llmModel:'gpt-6.1-sol'};
  assert.equal(find(view.tree,node=>node.type==='ChatPanel').props.bot,null,'wait for the saved agents list before resolving the return target');
  setBots([agent]);
  assert.equal(find(view.tree,node=>node.type==='ChatPanel').props.bot.id,agent.id);
  assert.equal(find(view.tree,node=>node.type==='BotRoster').props.selectedBot.id,agent.id);
  view.unmount();
});

test('a deliberate New task choice wins over a pending sign-in agent restore',async()=>{
  const {view,pending,setBots}=workspace('?bot=synthetic-agent');
  const agent={id:'synthetic-agent',name:'Saved agent',description:'Synthetic fixture',role:'Researcher',llmProvider:'openai',llmModel:'gpt-6.1-sol'};
  find(view.tree,node=>node.type==='BotRoster').props.onHome();
  setBots([agent]);
  await view.flush();
  pending.resolve([lounge]);
  await view.flush();
  assert.equal(find(view.tree,node=>node.type==='ChatPanel').props.bot,null);
  assert.equal(find(view.tree,node=>node.type==='BotRoster').props.activeView,'home');
  view.unmount();
});

test('pending agents and rooms never announce empty data',()=>{
  const env=environment(),view=renderer(env);
  const {BotRoster}=load('../src/components/BotRoster.tsx',{react:view.react,'./LoadingState':{LoadingState:'loading-state'},'./AccountMenu':{AccountMenu:'account-menu'},'./BotAvatar':{},'../lib/api':{request:async()=>({})}},{...env.globals,React:view.react.default});
  view.mount(()=>BotRoster({bots:[],rooms:[],loadingAgents:true,loadingRooms:true}));
  assert.doesNotMatch(textOf(view.tree),/Your team starts here|No team rooms yet/);
  assert.ok(find(view.tree,node=>node.type==='loading-state'&&node.props.label==='Loading your agents…'));
  view.unmount();
});

test('recent work replaces skeletons with an error, retries, and then shows real content',async()=>{
  const env=environment(),view=renderer(env),pending=deferred();let calls=0;
  const {RecentWork}=load('../src/components/cipher/RecentWork.tsx',{react:view.react,'../LoadingState':{LoadingState:'loading-state'},'./RecentWork.module.css':{},'../../lib/api':{request:()=>++calls===1?pending.promise:Promise.resolve([{id:'run',title:'Saved task',status:'completed',conversation_id:'room',created_at:'2026-10-24T12:00:00Z'}])}},{...env.globals,React:view.react.default});
  view.mount(()=>RecentWork({onOpen(){}}));assert.ok(find(view.tree,node=>node.type==='loading-state'));
  pending.reject(Error('Offline'));await view.flush();assert.match(textOf(view.tree),/Recent work could not load/);
  button(view.tree,'Retry').props.onClick();await view.flush();
  assert.match(textOf(view.tree),/Saved task/);assert.equal(find(view.tree,node=>node.type==='loading-state'),undefined);
  view.unmount();
});

test('ghost shapes are hidden from assistive technology and have one descriptive status',()=>{
  const env=environment(),view=renderer(env);
  const {LoadingState}=load('../src/components/LoadingState.tsx',{'./LoadingState.module.css':{}},{...env.globals,React:view.react.default});
  const node=LoadingState({label:'Loading conversation…',variant:'messages'});
  assert.equal(node.props.role,'status');assert.equal(node.props['aria-label'],'Loading conversation…');
  assert.ok(find(node,item=>item.props?.['aria-hidden']==='true'));
});

function prospecting(request, { voiceConfigured = true } = {}) {
  const env=environment(),view=renderer(env);
  env.globals.fetch=async()=>({json:async()=>({configured:voiceConfigured})});
  const {default:Workspace}=load('../src/components/ProspectingWorkspace.tsx',{
    react:view.react,
    '../lib/api':{request},
    '../lib/company-website':{companyWebsite:value=>value},
    '../lib/cypher-voice':{CYPHER_VOICE_INTRO:'Synthetic introduction'},
    './cipher/BinaryLens':{__esModule:true,default:'binary-lens'},
    './cipher/CypherMark':{__esModule:true,default:'cypher-mark'},
    './WorkflowShell':{__esModule:true,default:'workflow-shell'},
    './prospecting-workspace.css':{},
  },{...env.globals,React:view.react.default});
  view.mount(()=>Workspace());
  return view;
}

test('unavailable voice intro explains the text fallback without exposing server setup',async()=>{
  const view=prospecting(path=>path==='/prospecting/runs'?Promise.resolve([]):Promise.resolve({akta_available:false}),{voiceConfigured:false});
  await view.flush();
  const voice=find(view.tree,node=>node.type==='button'&&textOf(node).includes('Voice intro unavailable'));
  assert.equal(voice?.props.disabled,true);
  assert.match(textOf(view.tree),/Audio intro isn't available for this workspace yet\. You can continue with the text workflow\./);
  assert.doesNotMatch(textOf(view.tree),/Vercel|API key/);
  const textInput=find(view.tree,node=>node.type==='input'&&node.props?.id==='prospecting-url');
  assert.ok(textInput,'the text research field stays available');
  assert.notEqual(textInput.props.disabled,true);
  view.unmount();
});

test('prospecting keeps the empty state hidden until saved research finishes loading',async()=>{
  const history=deferred();
  const view=prospecting(path=>path==='/prospecting/runs'?history.promise:Promise.resolve({akta_available:false}));
  const loading=find(view.tree,node=>typeof node.type==='function'&&node.type.name==='ResearchLoading');
  assert.equal(loading?.props.label,'Loading your saved research');
  assert.equal(loading?.props.variant,'results');
  assert.doesNotMatch(textOf(view.tree),/No research yet|No saved runs yet/);
  history.resolve([]);await view.flush();
  assert.match(textOf(view.tree),/No saved research yet/);
  assert.match(textOf(view.tree),/No saved runs yet/);
  view.unmount();
});

test('prospecting history errors offer retry without claiming the shortlist is empty',async()=>{
  let calls=0;
  const saved={id:'saved-run',market:'Synthetic market',product:'Synthetic offer',limit:20,status:'completed',results:[],events:[],gmail:{status:'connection_required'},limitations:[]};
  const view=prospecting(path=>path==='/prospecting/runs'?++calls===1?Promise.reject(new Error('Offline')):Promise.resolve([saved]):Promise.resolve({akta_available:false}));
  await view.flush();
  assert.match(textOf(view.tree),/Saved research could not be loaded/);
  assert.match(textOf(view.tree),/Saved research is unavailable/);
  assert.doesNotMatch(textOf(view.tree),/No saved research yet|No saved runs yet/);
  button(view.tree,'Retry').props.onClick();await view.flush();
  assert.match(textOf(view.tree),/Synthetic market/);
  assert.match(textOf(view.tree),/Recent research/);
  assert.equal(calls,2);
  view.unmount();
});


test('an explicit saved conversation link still opens the existing team after startup',async()=>{
  const {view,pending}=workspace('?conversation=synthetic-lounge');
  pending.resolve([lounge]);await view.flush();await view.flush();
  assert.equal(find(view.tree,node=>node.type==='ChatPanel').props.room.id,lounge.id);
  view.unmount();
});

test('Apps opens inside the frame and preserves the mounted conversation before returning home',async()=>{
  const {view,pending}=workspace('?plugins=1');await view.flush();
  assert.ok(find(view.tree,node=>node.props?.embedded===true));
  assert.equal(find(view.tree,node=>node.props?.className==='workspace-conversation').props.hidden,true);
  assert.equal(find(view.tree,node=>node.type==='BotRoster').props.activeView,'apps');
  find(view.tree,node=>node.type==='BotRoster').props.onHome();await view.flush();
  pending.resolve([lounge]);await view.flush();
  assert.equal(find(view.tree,node=>node.props?.className==='workspace-conversation').props.hidden,false);
  assert.equal(find(view.tree,node=>node.type==='ChatPanel').props.room,null);
  view.unmount();
});
