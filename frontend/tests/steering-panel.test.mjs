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
  return {view,changes,storage:baseStorage,switchConversation(id,options){props={...props,conversationId:id,options:options||changes.at(-1)||props.options};view.rerender();}};
}

test('switching conversations restores only that conversation’s saved steering',async()=>{
  const p=panel({saved:{'grokbot-brief-thread-a':JSON.stringify({brief:'Private client outcome',constraints:'Keep this within team A',style:'detailed',effort:'high'})}});
  await p.view.flush();
  assert.match(p.changes.at(-1).steering,/Private client outcome/);
  assert.equal(p.changes.at(-1).reasoning_effort,'high');
  // Simulate the parent loading the second thread's own model options.
  p.switchConversation('thread-b',{provider:'openai',model:'gpt-6.1-sol',reasoning_effort:'medium',steering:''});
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

test('saving and restoring a brief preserves xhigh and max until the pace selector changes',async()=>{
  for(const advancedEffort of ['xhigh','max']){
    const key='grokbot-brief-thread-a';
    const first=panel({options:{reasoning_effort:advancedEffort}});
    await first.view.flush();
    assert.equal(find(first.view.tree,node=>node.type==='select'&&node.props['aria-label']==='Working pace').props.value,'high');
    find(first.view.tree,node=>node.props?.id==='steering-outcome').props.onChange({target:{value:'Finish the plan'}});
    await first.view.flush();
    button(first.view.tree,'Use for next messages').props.onClick();
    await first.view.flush();
    assert.equal(first.changes.at(-1).reasoning_effort,advancedEffort,'brief-only save preserves the exact advanced effort');
    assert.equal(JSON.parse(first.storage.getItem(key)).reasoning_effort,advancedEffort,'saved brief retains the exact effort');

    const restored=panel({saved:{[key]:first.storage.getItem(key)},options:{reasoning_effort:'medium'}});
    await restored.view.flush();
    assert.equal(restored.changes.at(-1).reasoning_effort,advancedEffort,'storage restore reapplies the exact advanced effort');
    assert.equal(find(restored.view.tree,node=>node.type==='select'&&node.props['aria-label']==='Working pace').props.value,'high');
    find(restored.view.tree,node=>node.type==='select'&&node.props['aria-label']==='Working pace').props.onChange({target:{value:'low'}});
    await restored.view.flush();
    button(restored.view.tree,'Use for next messages').props.onClick();
    await restored.view.flush();
    assert.equal(restored.changes.at(-1).reasoning_effort,'low','an explicit pace change applies the selected pace');
    assert.equal(JSON.parse(restored.storage.getItem(key)).reasoning_effort,'low');
    first.view.unmount();restored.view.unmount();
  }
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
