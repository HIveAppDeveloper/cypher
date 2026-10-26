import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,deferred,find,textOf,button} from './support/component-harness.mjs';

function panel(getChannels,overrides={},globals={}){
  const env=environment(),view=renderer(env);
  const api={getChannels,createChannel:async()=>{},setChannelState:async()=>{},testChannel:async()=>{},getDeliveries:async()=>[],...overrides};
  const {ChannelsPanel}=load('../src/components/ChannelsPanel.tsx',{react:view.react,'./LoadingState':{LoadingState:'loading-state'},'./GlassSelect':{GlassSelect:'select'},'../lib/api':{api}},{...env.globals,React:view.react.default,...globals});
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
  assert.equal(button(view.tree,'Disabled').props['aria-label'],'Inbound tasks');
  assert.match(textOf(view.tree),/Toggle unavailable/);
  button(view.tree,'Disabled').props.onClick();await view.flush();
  assert.equal(button(view.tree,'Enabled').props['aria-checked'],true);
  assert.equal(button(view.tree,'Enabled').props['aria-label'],'Inbound tasks');
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

test('retrying configuration copy clears its earlier clipboard error',async()=>{
  let attempts=0,copied;
  const view=panel(async()=>[],{
    createChannel:async data=>({...data,id:'synthetic-channel',enabled:true,token:'synthetic-channel-key',inbound_path:'/api/channels/synthetic/inbound'}),
  },{location:{origin:'https://fixture.example'},navigator:{clipboard:{writeText:async value=>{if(++attempts===1)throw Error('Synthetic clipboard blocked');copied=JSON.parse(value);}}}});
  await view.flush();
  find(view.tree,node=>node.props?.id==='channel-name').props.onChange({target:{value:'Fixture inbox'}});await view.flush();
  await find(view.tree,node=>node.type==='form').props.onSubmit({preventDefault(){}});await view.flush();
  button(view.tree,'Copy configuration').props.onClick();await view.flush();
  assert.match(textOf(view.tree),/Clipboard unavailable/);
  button(view.tree,'Copy configuration').props.onClick();await view.flush();
  assert.ok(button(view.tree,'Configuration copied'));
  assert.equal(find(view.tree,node=>node.props?.role==='alert'),undefined);
  assert.equal(copied.url,'https://fixture.example/api/channels/synthetic/inbound');
  assert.equal(copied.headers['X-Grokbot-Channel-Key'],'synthetic-channel-key');
  view.unmount();
});

test('channel operations announce their own pending action and keep switch names stable',async()=>{
  const toggled=deferred(),tested=deferred(),logs=deferred(),created=deferred();
  const channel={id:'channel-a',name:'Inbound tasks',enabled:false,manager_model:'gpt-6.1-sol',conversation_id:'room-a'};
  const view=panel(async()=>[channel],{setChannelState:()=>toggled.promise,testChannel:()=>tested.promise,getDeliveries:()=>logs.promise,createChannel:()=>created.promise});
  const progress=()=>find(view.tree,node=>node.props?.role==='status'&&node.props['aria-atomic']==='true');
  await view.flush();
  button(view.tree,'Disabled').props.onClick();await view.flush();
  assert.ok(button(view.tree,'Updating…'));
  assert.equal(button(view.tree,'Updating…').props['aria-label'],channel.name);
  assert.equal(button(view.tree,'Updating…').props['aria-checked'],false);
  assert.match(textOf(progress()),/Updating Inbound tasks/);
  assert.ok(button(view.tree,'Create channel'),'a toggle must not relabel creation as Connecting');
  toggled.resolve({...channel,enabled:true});await view.flush();
  assert.equal(button(view.tree,'Enabled').props['aria-label'],channel.name);
  assert.equal(button(view.tree,'Enabled').props['aria-checked'],true);

  button(view.tree,'Run connection test').props.onClick();await view.flush();
  assert.ok(button(view.tree,'Queuing connection test…'));
  assert.match(textOf(progress()),/Queuing connection test for Inbound tasks/);
  assert.ok(button(view.tree,'Create channel'));
  tested.resolve({});await view.flush();

  button(view.tree,'Delivery log').props.onClick();await view.flush();
  assert.ok(button(view.tree,'Loading delivery log…'));
  assert.match(textOf(progress()),/Loading delivery log for Inbound tasks/);
  assert.ok(button(view.tree,'Create channel'));
  logs.resolve([]);await view.flush();

  find(view.tree,node=>node.props?.id==='channel-name').props.onChange({target:{value:'Another inbox'}});await view.flush();
  const creation=find(view.tree,node=>node.type==='form').props.onSubmit({preventDefault(){}});await view.flush();
  assert.ok(button(view.tree,'Creating channel…'));
  assert.ok(button(view.tree,'Run connection test'));
  assert.match(textOf(progress()),/Creating your channel/);
  created.resolve({...channel,id:'new-channel',token:'synthetic-channel-key',inbound_path:'/synthetic'});await creation;await view.flush();
  assert.equal(textOf(progress()),'');
  view.unmount();
});

test('a late initial channel load cannot replace a channel created while it was pending',async()=>{
  const initialLoad=deferred();
  const created={id:'channel-new',name:'Fresh tasks',enabled:true,manager_model:'gpt-6.1-sol',conversation_id:'room-a',token:'fresh-key',inbound_path:'/api/channels/channel-new/inbound'};
  const view=panel(()=>initialLoad.promise,{createChannel:async()=>created});
  await view.flush();
  find(view.tree,node=>node.props?.id==='channel-name').props.onChange({target:{value:'Fresh tasks'}});
  await view.flush();
  const creating=find(view.tree,node=>node.type==='form').props.onSubmit({preventDefault(){}});
  await view.flush();
  await creating;
  await view.flush();
  assert.match(textOf(view.tree),/Fresh tasks/);

  initialLoad.resolve([]);
  await view.flush();
  assert.match(textOf(view.tree),/Fresh tasks/,'the initial response cannot erase the newly created channel');
  assert.doesNotMatch(textOf(view.tree),/No channels yet/);
  view.unmount();
});
