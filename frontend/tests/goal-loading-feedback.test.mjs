import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,deferred,find,textOf,button,field,submit} from './support/component-harness.mjs';

function fixture(getGoals, overrides={}) {
  const env=environment(),view=renderer(env);
  const api={getGoals,createGoal:async()=>{},setGoalState:async()=>{},...overrides};
  const {GoalsPanel}=load('../src/components/GoalsPanel.tsx',{
    react:view.react,'./LoadingState':{LoadingState:'loading-state'},
    './GlassSelect':{GlassSelect:'select'},'../lib/api':{api},
  },{...env.globals,React:view.react.default});
  view.mount(()=>GoalsPanel({onClose(){},rooms:[],ensureRoom:async()=>({id:'room'}),onOpenWorkspace(){}}));
  return {view,env};
}

test('goal loading never claims empty before a response; failure retries without losing the draft',async()=>{
  const first=deferred(),retry=deferred();let calls=0;
  const {view}=fixture(()=>++calls===1?first.promise:retry.promise);
  assert.ok(find(view.tree,n=>n.type==='loading-state'));
  assert.doesNotMatch(textOf(view.tree),/No goals yet/);
  field(view.tree,'goal-title').props.onChange({target:{value:'Keep this draft'}});
  first.reject(Error('Synthetic offline'));await view.flush();
  assert.match(textOf(view.tree),/Goals couldn’t load/);
  assert.doesNotMatch(textOf(view.tree),/No goals yet/);
  button(view.tree,'Retry goals').props.onClick();await view.flush();
  assert.ok(find(view.tree,n=>n.type==='loading-state'));
  retry.resolve([]);await view.flush();
  assert.match(textOf(view.tree),/No goals yet/);
  assert.ok(button(view.tree,'Write your first goal'));
  assert.equal(field(view.tree,'goal-title').props.value,'Keep this draft');
  assert.equal(find(view.tree,n=>n.props?.role==='alert'),undefined);
  view.unmount();
});

test('background goal refreshes preserve saved rows and cannot clear a failed action',async()=>{
  const goal={id:'g1',conversation_id:'room',title:'Saved goal',objective:'Do it',success_criteria:'Done',status:'paused',runs:0,max_runs:3,interval_minutes:60};
  const {view,env}=fixture(async()=>[goal],{createGoal:async()=>{throw Error('Save unavailable');}});
  await view.flush();await submit(view.tree);await view.flush();
  assert.match(textOf(view.tree),/Save unavailable/);
  env.time.advance(5000);await view.flush();
  assert.match(textOf(view.tree),/Saved goal/);
  assert.match(textOf(view.tree),/Save unavailable/);
  assert.equal(find(view.tree,n=>n.type==='loading-state'),undefined);
  view.unmount();assert.equal(env.time.pending,0);
});

test('saving feedback exists only while the real mutation is pending',async()=>{
  const saving=deferred();const {view}=fixture(async()=>[],{createGoal:()=>saving.promise});
  await view.flush();const pending=submit(view.tree);await view.flush();
  assert.match(textOf(find(view.tree,n=>n.props?.role==='status')),/Saving your goal/);
  assert.equal(button(view.tree,'Saving…').props.disabled,true);
  saving.reject(Error('Synthetic save failed'));await pending;await view.flush();
  assert.equal(find(view.tree,n=>n.props?.role==='status'),undefined);
  assert.match(textOf(view.tree),/Synthetic save failed/);
  assert.equal(button(view.tree,'Start goal').props.disabled,false);
  view.unmount();
});

test('Computer shows real startup feedback without presenting an empty browser as a loaded screen',async()=>{
  const env=environment(),view=renderer(env),starting=deferred();
  const {ComputerPanel}=load('../src/components/ComputerPanel.tsx',{
    react:view.react,'./LoadingState':{LoadingState:'loading-state'},'./GlassSelect':{GlassSelect:'select'},
    '../lib/api':{api:{startBot:()=>starting.promise},request:async()=>({})},
  },{...env.globals,React:view.react.default});
  const bot={id:'fixture-agent',name:'Research agent',containerId:null};
  view.mount(()=>ComputerPanel({bots:[bot],onClose(){}}));
  assert.match(textOf(view.tree),/Your agent’s cloud browser/);
  button(view.tree,'Start computer & take control').props.onClick();await view.flush();
  assert.match(textOf(find(view.tree,n=>n.props?.role==='status')),/Starting your cloud computer/);
  assert.ok(find(view.tree,n=>n.type==='loading-state'));
  starting.reject(Error('Synthetic startup unavailable'));await view.flush();
  assert.equal(find(view.tree,n=>n.type==='loading-state'),undefined);
  assert.match(textOf(view.tree),/Synthetic startup unavailable/);
  assert.equal(button(view.tree,'Start computer & take control').props.disabled,false);
  view.unmount();
});
