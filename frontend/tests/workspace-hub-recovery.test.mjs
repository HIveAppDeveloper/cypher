import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,find,textOf,button,submit} from './support/component-harness.mjs';

const sectionInput=tree=>{
  const label=find(tree,node=>node.type==='label'&&textOf(node).startsWith('Sidebar section'));
  return label&&find(label,node=>node.type==='input');
};

test('partial Activity load failures stay visible until retry succeeds',async()=>{
  const env=environment(),view=renderer(env);
  let loadPass=0;
  const request=async path=>{
    if(path==='/computer/approvals/pending')return [];
    if(path==='/workspace/knowledge')return [];
    if(path==='/workspace/routines')return [];
    if(path==='/workspace/runs')return loadPass===0?Promise.reject(Error('Runs unavailable')):[];
    if(path==='/workspace/notifications')return loadPass===0?Promise.reject(Error('Notifications unavailable')):[];
    if(path==='/workspace/usage')return {tokens:0,estimated_cost:0,weekly_token_limit:null,resets_at:'2026-01-01T00:00:00Z',models:[]};
    if(path==='/workspace/settings')return {tool_approval:'never',notifications:true,weekly_token_limit:null};
    throw new Error('Unexpected request: '+path);
  };
  const {WorkspaceHub}=load('../src/components/WorkspaceHub.tsx',{
    react:view.react,
    './LoadingState':{LoadingState:'loading-state'},
    './GlassSelect':{GlassSelect:'select'},
    '../lib/api':{api:{},request},
  },{...env.globals,React:view.react.default,setInterval:()=>1,clearInterval(){}});
  view.mount(()=>WorkspaceHub({bots:[],rooms:[],ensureRoom:async()=>({id:'room-a'}),onRefresh:async()=>{},onOpenWorkspace(){},onClose(){},initialTab:'Activity'}));
  await view.flush();
  assert.match(textOf(view.tree),/Couldn’t load .*recent work.*notifications/);
  assert.doesNotMatch(textOf(view.tree),/No unread notifications|No recent work yet/,'failed endpoints must not look like empty data');
  assert.ok(button(view.tree,'Retry'));

  button(view.tree,'Memory').props.onClick();
  await view.flush();
  assert.ok(button(view.tree,'Retry'),'the recovery action stays visible after changing tabs');
  submit(view.tree);
  await view.flush();
  assert.ok(button(view.tree,'Retry'),'successful actions do not hide recovery for still-failed resources');

  loadPass=1;
  button(view.tree,'Activity').props.onClick();
  await view.flush();
  button(view.tree,'Retry').props.onClick();
  await view.flush();
  assert.doesNotMatch(textOf(view.tree),/Couldn’t load .*recent work.*notifications/,'successful refresh clears the stale load error');
  assert.match(textOf(view.tree),/No unread notifications/);
  assert.match(textOf(view.tree),/No recent work yet/);
  view.unmount();
});

test('settings recovery hydrates the current sidebar section and an untouched details save preserves it',async()=>{
  const env=environment(),view=renderer(env),calls=[];
  let settingsReads=0;
  const serverPrefs={bot_sections:{Team:['bot-a']},hidden_bots:[]};
  const request=async(path,options={})=>{
    calls.push({path,method:options.method||'GET'});
    if(path==='/computer/approvals/pending')return [];
    if(path==='/workspace/knowledge'||path==='/workspace/routines'||path==='/workspace/runs'||path==='/workspace/notifications')return [];
    if(path==='/workspace/usage')return {tokens:0,estimated_cost:0,weekly_token_limit:null,resets_at:'2026-01-01T00:00:00Z',models:[]};
    if(path==='/workspace/settings'){
      if(++settingsReads===1)throw new Error('Preferences unavailable');
      if(options.method==='PATCH')return Object.assign(serverPrefs,JSON.parse(options.body));
      return serverPrefs;
    }
    if(path==='/workspace/bots/bot-a/duplicate')return {};
    throw new Error('Unexpected request: '+path);
  };
  let updates=0;
  const {WorkspaceHub}=load('../src/components/WorkspaceHub.tsx',{
    react:view.react,
    './LoadingState':{LoadingState:'loading-state'},
    './GlassSelect':{GlassSelect:'select'},
    '../lib/api':{api:{updateBot:async()=>{updates++;},deleteBot:async()=>{}},request},
  },{...env.globals,React:view.react.default,setInterval:()=>1,clearInterval(){}});
  const bots=[{id:'bot-a',name:'Researcher',role:'Research assistant',description:'Synthetic agent',systemPrompt:'Synthetic instructions'}];
  view.mount(()=>WorkspaceHub({bots,rooms:[],ensureRoom:async()=>({id:'room-a'}),onRefresh:async()=>{},onOpenWorkspace(){},onClose(){},initialTab:'Agents'}));
  await view.flush();
  assert.match(textOf(view.tree),/workspace preferences/);
  const visibility=button(view.tree,'Sidebar visibility unavailable');
  assert.equal(visibility.props.disabled,true);

  button(view.tree,'Duplicate').props.onClick();
  await view.flush();
  assert.ok(calls.some(call=>call.path==='/workspace/bots/bot-a/duplicate'),'unrelated agent actions remain usable');
  assert.ok(button(view.tree,'Retry'),'agent actions do not hide the failed settings recovery');

  button(view.tree,'Edit agent').props.onClick();
  await view.flush();
  assert.equal(sectionInput(view.tree),undefined,'the section editor stays hidden while its current value is unknown');
  button(view.tree,'Retry').props.onClick();
  await view.flush();
  assert.equal(sectionInput(view.tree).props.value,'Team','recovery hydrates the saved section before enabling edits');
  submit(view.tree);
  await view.flush();
  assert.equal(updates,1,'agent details remain editable');
  assert.deepEqual(calls.filter(call=>call.path==='/workspace/settings'&&call.method==='PATCH'),[],'failed settings reads must not produce a PATCH from default preference values');
  assert.deepEqual(serverPrefs.bot_sections,{Team:['bot-a']},'saving unchanged agent details preserves the server section');
  view.unmount();
});

test('an explicit sidebar section edit updates only the selected agent assignment',async()=>{
  const env=environment(),view=renderer(env),patches=[];
  const serverPrefs={bot_sections:{Team:['bot-a'],'Design systems':['bot-b']},hidden_bots:[]};
  const request=async(path,options={})=>{
    if(path==='/computer/approvals/pending')return [];
    if(path==='/workspace/knowledge'||path==='/workspace/routines'||path==='/workspace/runs'||path==='/workspace/notifications')return [];
    if(path==='/workspace/usage')return {tokens:0,estimated_cost:0,weekly_token_limit:null,resets_at:'2026-01-01T00:00:00Z',models:[]};
    if(path==='/workspace/settings'&&options.method==='PATCH'){
      const changes=JSON.parse(options.body);patches.push(changes);Object.assign(serverPrefs,changes);return serverPrefs;
    }
    if(path==='/workspace/settings')return serverPrefs;
    throw new Error('Unexpected request: '+path);
  };
  const {WorkspaceHub}=load('../src/components/WorkspaceHub.tsx',{
    react:view.react,
    './LoadingState':{LoadingState:'loading-state'},
    './GlassSelect':{GlassSelect:'select'},
    '../lib/api':{api:{updateBot:async()=>{},deleteBot:async()=>{}},request},
  },{...env.globals,React:view.react.default,setInterval:()=>1,clearInterval(){}});
  const bots=[{id:'bot-a',name:'Researcher',role:'Research assistant',description:'Synthetic agent',systemPrompt:'Synthetic instructions'}];
  view.mount(()=>WorkspaceHub({bots,rooms:[],ensureRoom:async()=>({id:'room-a'}),onRefresh:async()=>{},onOpenWorkspace(){},onClose(){},initialTab:'Agents'}));
  await view.flush();
  button(view.tree,'Edit agent').props.onClick();
  await view.flush();
  sectionInput(view.tree).props.onChange({target:{value:'Research'}});
  await view.flush();
  submit(view.tree);
  await view.flush();
  assert.deepEqual(patches,[{bot_sections:{Team:[],'Design systems':['bot-b'],Research:['bot-a']}}]);
  view.unmount();
});
