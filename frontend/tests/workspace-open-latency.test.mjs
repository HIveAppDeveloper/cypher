import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,deferred,find,textOf,button} from './support/component-harness.mjs';

const savedRoom={id:'saved-room',title:'Saved team',is_group:true,bot_ids:[]};
const otherRoom={id:'other-room',title:'Other team',is_group:true,bot_ids:[]};
function workspace({search='',getConversations=async()=>[],getBots=async()=>[],defaultTeam=async()=>savedRoom,refreshBots=async()=>{}}={}){
  const env=environment(),view=renderer(env);
  env.window.location={search};
  const names=['BotRoster','SidebarShell','ChatPanel','CommandPalette'];
  const imports=Object.fromEntries(names.flatMap(name=>[['../components/'+name,{[name]:name}],['./'+name,{[name]:name}]]));
  imports['./PanelBoundary']={PanelBoundary:'panel-boundary',RetryablePanel:'retryable-panel'};
  imports['../hooks/useBots']={useBots:()=>{const [selectedBot,setSelectedBot]=view.react.useState(null);return {bots:[],selectedBot,setSelectedBot,createBot(){},refreshBots,loading:false};}};
  imports['../components/PreferencesPanel']={PreferencesPanel:'preferences',restoreAppearance(){}};
  imports['../components/RunControls']={DEFAULT_OPTIONS:{}};
  imports['../lib/api']={api:{getConversations,getBots,defaultTeam},request:async()=>[]};
  imports['./cipher/CypherEntrance']={__esModule:true,default:'entrance'};
  const {default:WorkspaceApp}=load('../src/components/WorkspaceApp.tsx',{react:view.react,...imports},{...env.globals,URLSearchParams,setInterval:()=>1,clearInterval(){}});
  view.mount(()=>WorkspaceApp({}));
  return {view,roster:()=>find(view.tree,node=>node.type==='BotRoster').props,chat:()=>find(view.tree,node=>node.type==='ChatPanel').props,commands:()=>find(view.tree,node=>node.type==='CommandPalette').props.commands};
}

test('room opens while roster refresh is pending and survives refresh failure',async()=>{
 const pending=deferred(),app=workspace({refreshBots:()=>pending.promise});
 const opened=app.chat().onOpenLounge();await app.view.flush();
 assert.equal(app.chat().room?.id,savedRoom.id);assert.equal((await opened).id,savedRoom.id);
 pending.reject(Error('Roster unavailable'));await app.view.flush();
 assert.equal(app.chat().room?.id,savedRoom.id);app.view.unmount();
});
test('late room response cannot override later navigation',async()=>{
 const pending=deferred(),app=workspace({defaultTeam:()=>pending.promise});
 const opened=app.chat().onOpenLounge().catch(()=>null);
 app.roster().onSelectRoom(otherRoom);await app.view.flush();
 pending.resolve(savedRoom);await opened;await app.view.flush();
 assert.equal(app.chat().room?.id,otherRoom.id);app.view.unmount();
});
test('unmount cancels a late room response',async()=>{
 const pending=deferred(),app=workspace({defaultTeam:()=>pending.promise});
 const opened=app.chat().onOpenLounge().catch(()=>null);
 app.view.unmount();pending.resolve(savedRoom);await opened;await app.view.flush();
 assert.equal(app.view.updatesAfterUnmount,0);
});
