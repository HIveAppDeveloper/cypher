import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,find,textOf,button} from './support/component-harness.mjs';

function panel(getChannels,overrides={}){
  const env=environment(),view=renderer(env);
  const api={getChannels,createChannel:async()=>{},setChannelState:async()=>{},testChannel:async()=>{},getDeliveries:async()=>[],...overrides};
  const {ChannelsPanel}=load('../src/components/ChannelsPanel.tsx',{react:view.react,'./LoadingState':{LoadingState:'loading-state'},'./GlassSelect':{GlassSelect:'select'},'../lib/api':{api}},{...env.globals,React:view.react.default});
  view.mount(()=>ChannelsPanel({onClose(){},rooms:[],ensureRoom:async()=>({id:'room'})}));
  return view;
}

test('channel load errors offer retry without claiming the list is empty',async()=>{
  let calls=0;
  const view=panel(async()=>{if(++calls===1)throw Error('Synthetic offline');return [];});
  await view.flush();
  assert.match(textOf(view.tree),/Could not load channels/);
  assert.doesNotMatch(textOf(view.tree),/No channels yet/);
  button(view.tree,'Retry channels').props.onClick();
  await view.flush();
  assert.match(textOf(view.tree),/No channels yet/);
  assert.equal(find(view.tree,node=>node.props?.role==='alert'),undefined);
  assert.equal(calls,2);
  view.unmount();
});

test('a successful empty channel list keeps its clear starter state',async()=>{
  const view=panel(async()=>[]);
  await view.flush();
  assert.match(textOf(view.tree),/No channels yet/);
  assert.equal(find(view.tree,node=>node.props?.role==='alert'),undefined);
  view.unmount();
});

test('successful channel retries clear stale errors for toggles, checks, and delivery logs',async()=>{
  let channel={id:'channel-a',name:'Inbound tasks',enabled:false,manager_model:'gpt-6.1-sol',conversation_id:'room-a'};
  let toggleAttempts=0,checkAttempts=0,deliveryAttempts=0;
  const view=panel(async()=>[channel],{
    setChannelState:async(id,enabled)=>{if(++toggleAttempts===1)throw Error('Toggle unavailable');channel={...channel,enabled};return channel;},
    testChannel:async()=>{if(++checkAttempts===1)throw Error('Check unavailable');},
    getDeliveries:async()=>{if(++deliveryAttempts===1)throw Error('Delivery log unavailable');return [];},
  });
  await view.flush();

  button(view.tree,'Disabled').props.onClick();await view.flush();
  assert.equal(button(view.tree,'Disabled').props['aria-label'],'Enable Inbound tasks');
  assert.match(textOf(view.tree),/Toggle unavailable/);
  button(view.tree,'Disabled').props.onClick();await view.flush();
  assert.equal(button(view.tree,'Enabled').props['aria-checked'],true);
  assert.equal(button(view.tree,'Enabled').props['aria-label'],'Disable Inbound tasks');
  assert.equal(find(view.tree,node=>node.props?.role==='alert'),undefined);

  button(view.tree,'Run connection test').props.onClick();await view.flush();
  assert.match(textOf(view.tree),/Check unavailable/);
  button(view.tree,'Run connection test').props.onClick();await view.flush();
  assert.match(textOf(view.tree),/Connection test queued/);
  assert.equal(find(view.tree,node=>node.props?.role==='alert'),undefined);

  button(view.tree,'Delivery log').props.onClick();await view.flush();
  assert.match(textOf(view.tree),/Delivery log unavailable/);
  button(view.tree,'Delivery log').props.onClick();await view.flush();
  assert.match(textOf(view.tree),/No outgoing deliveries yet/);
  assert.equal(find(view.tree,node=>node.props?.role==='alert'),undefined);
  view.unmount();
});
