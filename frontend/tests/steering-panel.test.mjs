import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,storage,find,textOf,button} from './support/component-harness.mjs';

function panel({conversationId='thread-a',saved={},storageOverrides={},options={}}={}){
  const env=environment();
  const baseStorage=storage(saved);
  env.globals.localStorage={...baseStorage,...storageOverrides};
  const view=renderer(env),changes=[];
  let props={conversationId,jobs:[],options:{provider:'openai',model:'gpt-6.1-sol',reasoning_effort:'medium',steering:'',...options},initiallyOpen:true,onChange(options){changes.push(options);}};
  const {SteeringPanel}=load('../src/components/SteeringPanel.tsx',{react:view.react,'./GlassSelect':{GlassSelect:'select'},'../lib/api':{api:{steerJob:async()=>{}}}},{...env.globals,React:view.react.default});
  view.mount(()=>SteeringPanel(props));
  return {view,changes,switchConversation(id){props={...props,conversationId:id,options:changes.at(-1)||props.options};view.rerender();}};
}

test('switching conversations restores only that conversation’s saved steering',async()=>{
  const p=panel({saved:{'grokbot-brief-thread-a':JSON.stringify({brief:'Private client outcome',constraints:'Keep this within team A',style:'detailed',effort:'high'})}});
  await p.view.flush();
  assert.match(p.changes.at(-1).steering,/Private client outcome/);
  assert.equal(p.changes.at(-1).reasoning_effort,'high');
  p.switchConversation('thread-b');
  await p.view.flush();
  assert.equal(p.changes.at(-1).steering,'');
  assert.equal(p.changes.at(-1).reasoning_effort,'medium');
  assert.equal(p.changes.at(-1).model,'gpt-6.1-sol');
  assert.equal(find(p.view.tree,node=>node.props?.id==='steering-outcome').props.value,'');
  assert.equal(find(p.view.tree,node=>node.props?.id==='steering-constraints').props.value,'');
  p.view.unmount();
});

test('the pace selector summarizes advanced model effort without overwriting it',async()=>{
  const p=panel({options:{reasoning_effort:'xhigh'}});
  p.switchConversation('thread-b');
  await p.view.flush();
  assert.equal(find(p.view.tree,node=>node.type==='select'&&node.props['aria-label']==='Working pace').props.value,'high');
  assert.equal(p.changes.at(-1).reasoning_effort,'xhigh');
  p.view.unmount();
});

test('browser storage failures do not block an in-session steering brief or clear action',async()=>{
  const p=panel({storageOverrides:{setItem(){throw Error('Storage is unavailable');},removeItem(){throw Error('Storage is unavailable');}}});
  await p.view.flush();
  find(p.view.tree,node=>node.props?.id==='steering-outcome').props.onChange({target:{value:'Finish the current brief'}});
  await p.view.flush();
  button(p.view.tree,'Use for next messages').props.onClick();
  await p.view.flush();
  assert.match(p.changes.at(-1).steering,/Finish the current brief/);
  assert.match(textOf(p.view.tree),/active for this conversation/);
  button(p.view.tree,'Clear brief').props.onClick();
  await p.view.flush();
  assert.equal(p.changes.at(-1).steering,'');
  assert.match(textOf(p.view.tree),/Brief cleared for this conversation/);
  p.view.unmount();
});
