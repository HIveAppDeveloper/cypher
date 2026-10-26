import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,deferred,find,textOf,button} from './support/component-harness.mjs';

const savedRoom={id:'saved-room',title:'Saved team',is_group:true,bot_ids:[]};
const otherRoom={id:'other-room',title:'Other team',is_group:true,bot_ids:[]};
function workspace({search='',getConversations=async()=>[],getBots=async()=>[]}={}){
  const env=environment(),view=renderer(env);
  env.window.location={search};
  const names=['BotRoster','SidebarShell','ChatPanel','CommandPalette','AccountMenu'];
  const imports=Object.fromEntries(names.flatMap(name=>[['../components/'+name,{[name]:name}],['./'+name,{[name]:name}]]));
  imports['./PanelBoundary']={PanelBoundary:'panel-boundary',RetryablePanel:'retryable-panel'};
  imports['../hooks/useBots']={useBots:()=>{const [selectedBot,setSelectedBot]=view.react.useState(null);return {bots:[],selectedBot,setSelectedBot,createBot(){},refreshBots:async()=>{},loading:false};}};
  imports['../components/PreferencesPanel']={PreferencesPanel:'preferences',restoreAppearance(){}};
  imports['../components/RunControls']={DEFAULT_OPTIONS:{}};
  imports['../lib/api']={api:{getConversations,getBots},request:async()=>[]};
  imports['./cipher/CypherEntrance']={__esModule:true,default:'entrance'};
  const {default:WorkspaceApp}=load('../src/components/WorkspaceApp.tsx',{react:view.react,...imports},{...env.globals,URLSearchParams,setInterval:()=>1,clearInterval(){}});
  view.mount(()=>WorkspaceApp({}));
  return {view,roster:()=>find(view.tree,node=>node.type==='BotRoster').props,chat:()=>find(view.tree,node=>node.type==='ChatPanel').props,commands:()=>find(view.tree,node=>node.type==='CommandPalette').props.commands};
}

test('workspace header uses viewport-safe placement for the account menu',()=>{
  const app=workspace();
  const account=find(app.view.tree,node=>node.type==='AccountMenu');
  assert.equal(account.props.placement,'bottom');
  app.view.unmount();
});

for(const destination of ['home','apps','settings','room'])test(`a delayed saved link cannot replace later ${destination} navigation`,async()=>{
  const pending=deferred(),app=workspace({search:'?conversation=saved-room',getConversations:()=>pending.promise});
  if(destination==='home')app.roster().onHome();
  if(destination==='apps')app.roster().onPlugins();
  if(destination==='settings')app.commands().find(command=>command.id==='appearance').run();
  if(destination==='room')app.roster().onSelectRoom(otherRoom);
  await app.view.flush();
  pending.resolve([savedRoom]);await app.view.flush();
  assert.equal(app.chat().room?.id||null,destination==='room'?otherRoom.id:null);
  if(destination==='apps')assert.equal(app.roster().activeView,'apps');
  if(destination==='settings')assert.equal(app.roster().activeView,'settings');
  app.view.unmount();
});

test('a late saved agent lookup cannot override a directly selected agent',async()=>{
  const pending=deferred(),room={...savedRoom,is_group:false,bot_ids:['agent-a']};
  const app=workspace({search:'?conversation=saved-room',getConversations:async()=>[room],getBots:()=>pending.promise});
  await app.view.flush();
  app.roster().onSelectBot({id:'agent-b',name:'Chosen agent'});await app.view.flush();
  pending.resolve([{id:'agent-a',name:'Stale agent'}]);await app.view.flush();
  assert.equal(app.chat().bot?.id,'agent-b');assert.equal(app.chat().room,null);
  app.view.unmount();
});

for(const lateFailure of [false,true])test(`competing recent opens keep the newest target after a late ${lateFailure?'failure':'success'}`,async()=>{
  const older=deferred(),newer=deferred();let calls=0;
  const app=workspace({getConversations:()=>++calls===1?Promise.resolve([]):calls===2?older.promise:newer.promise});
  await app.view.flush();
  app.roster().onOpenRecent(savedRoom.id);app.roster().onOpenRecent(otherRoom.id);await app.view.flush();
  newer.resolve([otherRoom]);await app.view.flush();
  assert.equal(app.chat().room?.id,otherRoom.id);
  if(lateFailure)older.reject(Error('Synthetic stale failure'));else older.resolve([savedRoom]);
  await app.view.flush();
  assert.equal(app.chat().room?.id,otherRoom.id);
  assert.doesNotMatch(textOf(app.view.tree),/Synthetic stale failure|could not be opened/);
  app.view.unmount();
});

test('a sidebar refresh cannot erase a failed saved target and Retry opens that target with feedback',async()=>{
  const sidebar=deferred(),retry=deferred();let calls=0;
  const app=workspace({search:'?conversation=saved-room',getConversations:()=>{calls++;return calls===1?sidebar.promise:calls===2?Promise.reject(Error('Synthetic offline')):retry.promise;}});
  await app.view.flush();assert.match(textOf(app.view.tree),/saved conversation could not be opened/);
  sidebar.resolve([]);await app.view.flush();
  assert.match(textOf(app.view.tree),/saved conversation could not be opened/,'list recovery cannot dismiss a different failed operation');
  button(app.view.tree,'Retry').props.onClick();await app.view.flush();
  assert.match(textOf(app.view.tree),/Opening|Retrying|Reopening/,'the retry has visible pending feedback');
  retry.resolve([savedRoom]);await app.view.flush();
  assert.equal(app.chat().room?.id,savedRoom.id);
  assert.doesNotMatch(textOf(app.view.tree),/could not be opened|Synthetic offline/);
  app.view.unmount();
});

test('a missing saved conversation keeps its target available for retry',async()=>{
  let available=false;
  const app=workspace({search:'?conversation=saved-room',getConversations:async()=>available?[savedRoom]:[]});
  await app.view.flush();assert.match(textOf(app.view.tree),/could not be found/);
  available=true;button(app.view.tree,'Retry').props.onClick();await app.view.flush();
  assert.equal(app.chat().room?.id,savedRoom.id);app.view.unmount();
});

test('unmount invalidates a pending saved conversation without later state writes',async()=>{
  const pending=deferred(),app=workspace({search:'?conversation=saved-room',getConversations:()=>pending.promise});
  app.view.unmount();pending.resolve([savedRoom]);await app.view.flush();
  assert.equal(app.view.updatesAfterUnmount,0);
});

test('opening a conversation from a modal exposes its pending and retry controls',async()=>{
  const pending=deferred();let calls=0;
  const app=workspace({getConversations:()=>++calls===1?Promise.resolve([]):calls===2?pending.promise:Promise.resolve([savedRoom])});
  await app.view.flush();app.roster().onMyWork();await app.view.flush();
  const panel=find(app.view.tree,node=>node.type==='panel-boundary');assert.ok(panel);
  find(panel,node=>typeof node.props?.onOpenWorkspace==='function').props.onOpenWorkspace(savedRoom.id);
  await app.view.flush();
  assert.equal(find(app.view.tree,node=>node.type==='panel-boundary'),undefined,'the modal must not make external recovery controls inert');
  assert.match(textOf(app.view.tree),/Opening saved conversation/);
  pending.reject(Error('Synthetic modal-open failure'));await app.view.flush();
  assert.match(textOf(app.view.tree),/saved conversation could not be opened/);
  button(app.view.tree,'Retry').props.onClick();await app.view.flush();
  assert.equal(app.chat().room?.id,savedRoom.id);
  app.view.unmount();
});
