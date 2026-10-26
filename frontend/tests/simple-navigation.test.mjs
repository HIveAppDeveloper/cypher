import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,button} from './support/component-harness.mjs';

test('everyday Settings opens preferences while Advanced setup remains a separate destination',async()=>{
  const env=environment(),view=renderer(env);
  let preferences=0,setup=0;
  const {BotRoster}=load('../src/components/BotRoster.tsx',{
    react:view.react,'./AccountMenu':{AccountMenu:'account-menu'},'./LoadingState':{LoadingState:'loading-state'},
    './BotAvatar':{BotAvatar:'bot-avatar'},'../lib/api':{request:async path=>path==='/workspace/settings'?{}:[]},
  },{...env.globals,React:view.react.default});
  view.mount(()=>BotRoster({bots:[],rooms:[],selectedBot:null,selectedRoom:null,
    onPreferences:()=>preferences++,onSetup:()=>setup++,onHome(){},onPlugins(){},onWorkspace(){},onMyWork(){},
    onSelectBot(){},onCreateNew(){},onSelectRoom(){},onCreateRoom(){},onGoals(){},onChannels(){},onOpenRecent(){},onComputer(){},
  }));
  await view.flush();
  button(view.tree,'Settings').props.onClick();
  assert.equal(preferences,1);
  assert.equal(setup,0,'everyday Settings must not open the installation console');
  button(view.tree,'Advanced setup').props.onClick();
  assert.equal(setup,1,'the existing connection and AI setup must remain reachable');
  view.unmount();
});
