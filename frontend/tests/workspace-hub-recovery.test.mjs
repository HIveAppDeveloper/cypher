import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,deferred,find,textOf,button,submit} from './support/component-harness.mjs';

const sectionInput=tree=>{
  const label=find(tree,node=>node.type==='label'&&textOf(node).startsWith('Sidebar section'));
  return label&&find(label,node=>node.type==='input');
};

function mountWorkspaceHub(env,request,{bots=[],initialTab='Activity'}={}){
  const view=renderer(env);
  const {WorkspaceHub}=load('../src/components/WorkspaceHub.tsx',{
    react:view.react,
    './LoadingState':{LoadingState:'loading-state'},
    './GlassSelect':{GlassSelect:'select'},
    '../lib/api':{api:{updateBot:async()=>{},deleteBot:async()=>{}},request},
    '../lib/dates':load('../src/lib/dates.ts'),
  },{...env.globals,React:view.react.default,setInterval:()=>1,clearInterval(){}});
  view.mount(()=>WorkspaceHub({bots,rooms:[],ensureRoom:async()=>({id:'room-a'}),onRefresh:async()=>{},onOpenWorkspace(){},onClose(){},initialTab}));
  return view;
}

function workspaceRequest({runs=[],notices=[]}={}){
  const calls=[];
  const request=async path=>{
    calls.push(path);
    if(path==='/computer/approvals/pending')return [];
    if(path==='/workspace/knowledge'||path==='/workspace/routines')return [];
    if(path==='/workspace/runs')return runs;
    if(path==='/workspace/notifications')return notices;
    if(path==='/workspace/usage')return {tokens:0,estimated_cost:0,weekly_token_limit:null,resets_at:'2026-01-01T00:00:00Z',models:[]};
    if(path==='/workspace/settings')return {tool_approval:'never',notifications:true,weekly_token_limit:null};
    throw new Error('Unexpected request: '+path);
  };
  return {request,calls};
}

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
    '../lib/dates':load('../src/lib/dates.ts'),
  },{...env.globals,React:view.react.default,setInterval:()=>1,clearInterval(){}});
  view.mount(()=>WorkspaceHub({bots:[],rooms:[],ensureRoom:async()=>({id:'room-a'}),onRefresh:async()=>{},onOpenWorkspace(){},onClose(){},initialTab:'Activity'}));
  await view.flush();
  assert.match(textOf(view.tree),/Some workspace information could not load/);
  assert.doesNotMatch(textOf(view.tree),/Couldn’t load .*recent work.*notifications/,'the global recovery notice stays concise');
  assert.match(textOf(view.tree),/Recent work could not load/,'the active section explains its unavailable content');
  assert.match(textOf(view.tree),/Notifications could not load/,'each failed section keeps its own status');
  assert.doesNotMatch(textOf(view.tree),/No unread notifications|No recent work yet/,'failed endpoints must not look like empty data');
  assert.ok(button(view.tree,'Retry'));

  button(view.tree,'Notes').props.onClick();
  await view.flush();
  assert.ok(button(view.tree,'Retry'),'the recovery action stays visible after changing tabs');
  submit(view.tree);
  await view.flush();
  assert.ok(button(view.tree,'Retry'),'successful actions do not hide recovery for still-failed resources');

  loadPass=1;
  button(view.tree,'My work').props.onClick();
  await view.flush();
  button(view.tree,'Retry').props.onClick();
  await view.flush();
  assert.doesNotMatch(textOf(view.tree),/Couldn’t load .*recent work.*notifications/,'successful refresh clears the stale load error');
  assert.match(textOf(view.tree),/No unread notifications/);
  assert.match(textOf(view.tree),/No recent work yet/);
  view.unmount();
});

test('My work search filters notifications and recent tasks locally and Clear restores both lists',async()=>{
  const env=environment();
  const {request,calls}=workspaceRequest({
    notices:[
      {id:'notice-a',title:'SEC snapshot ready',detail:'Form D filings are indexed.',conversation_id:'room-a'},
      {id:'notice-b',title:'Approval requested',detail:'Review the draft before it is sent.',conversation_id:'room-b'},
    ],
    runs:[
      {id:'run-a',title:'Climate fund sourcing',status:'completed',conversation_id:'room-a',created_at:'2026-10-29T12:00:00Z'},
      {id:'run-b',title:'Water market mapping',status:'failed_network',conversation_id:'room-b',created_at:'2026-10-29T13:00:00Z'},
    ],
  });
  const view=mountWorkspaceHub(env,request);
  await view.flush();
  const search=find(view.tree,node=>node.type==='input'&&node.props?.placeholder==='Notification details or task title');
  assert.ok(search);

  search.props.onChange({target:{value:'failed network'}});
  await view.flush();
  assert.match(textOf(view.tree),/Water market mapping/,'a normalized task status is searchable');
  assert.doesNotMatch(textOf(view.tree),/Climate fund sourcing|SEC snapshot ready|Approval requested/);
  assert.equal(textOf(find(view.tree,node=>node.props?.className==='hub-activity-count')),'0 of 2 notifications · 1 of 2 recent tasks');

  const currentSearch=find(view.tree,node=>node.type==='input'&&node.props?.placeholder==='Notification details or task title');
  currentSearch.props.onChange({target:{value:'Form D'} });
  await view.flush();
  assert.match(textOf(view.tree),/SEC snapshot ready/,'notification details are searchable');
  assert.match(textOf(view.tree),/No recent work matches/);
  assert.doesNotMatch(textOf(view.tree),/Water market mapping/);

  button(view.tree,'Clear search').props.onClick();
  await view.flush();
  assert.match(textOf(view.tree),/Climate fund sourcing/);
  assert.match(textOf(view.tree),/Water market mapping/);
  assert.match(textOf(view.tree),/SEC snapshot ready/);
  assert.match(textOf(view.tree),/Approval requested/);
  assert.equal(calls.filter(path=>path==='/workspace/notifications').length,1,'searching uses the loaded notices without another request');
  assert.equal(calls.filter(path=>path==='/workspace/runs').length,1,'searching uses the loaded task list without another request');
  view.unmount();
});

test('assistant search matches name, role and description and reports a helpful empty state',async()=>{
  const env=environment();
  const {request,calls}=workspaceRequest();
  const bots=[
    {id:'bot-a',name:'Climate scout',role:'Founder research',description:'Company evidence review',systemPrompt:'Synthetic instructions'},
    {id:'bot-b',name:'Meeting prep',role:'Relationship manager',description:'Conversation planning',systemPrompt:'Synthetic instructions'},
  ];
  const view=mountWorkspaceHub(env,request,{bots,initialTab:'Agents'});
  await view.flush();
  const search=find(view.tree,node=>node.type==='input'&&node.props?.placeholder==='Name, role or description');
  assert.ok(search);

  search.props.onChange({target:{value:'COMPANY EVIDENCE'} });
  await view.flush();
  assert.match(textOf(view.tree),/Climate scout/,'description matches ignore case');
  assert.doesNotMatch(textOf(view.tree),/Meeting prep/);
  assert.equal(textOf(find(view.tree,node=>node.props?.className==='hub-agent-count')),'1 of 2 assistants');

  const currentSearch=find(view.tree,node=>node.type==='input'&&node.props?.placeholder==='Name, role or description');
  currentSearch.props.onChange({target:{value:'no such assistant'} });
  await view.flush();
  assert.match(textOf(view.tree),/No assistants match/);
  assert.equal(textOf(find(view.tree,node=>node.props?.className==='hub-agent-count')),'0 of 2 assistants');

  button(view.tree,'Clear search').props.onClick();
  await view.flush();
  assert.match(textOf(view.tree),/Climate scout/);
  assert.match(textOf(view.tree),/Meeting prep/);
  assert.equal(textOf(find(view.tree,node=>node.props?.className==='hub-agent-count')),'2 assistants');
  assert.equal(calls.filter(path=>path==='/workspace/runs').length,1,'assistant search does not reload unrelated workspace data');
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
    '../lib/dates':load('../src/lib/dates.ts'),
  },{...env.globals,React:view.react.default,setInterval:()=>1,clearInterval(){}});
  const bots=[{id:'bot-a',name:'Researcher',role:'Research assistant',description:'Synthetic agent',systemPrompt:'Synthetic instructions'}];
  view.mount(()=>WorkspaceHub({bots,rooms:[],ensureRoom:async()=>({id:'room-a'}),onRefresh:async()=>{},onOpenWorkspace(){},onClose(){},initialTab:'Agents'}));
  await view.flush();
  assert.match(textOf(view.tree),/Some workspace information could not load/);
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
    '../lib/dates':load('../src/lib/dates.ts'),
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

test('a stale pending-approval poll cannot restore an action after it was resolved',async()=>{
  const env=environment(),view=renderer(env),approval={id:'approval-a',name:'Read a private file',arguments:'{"path":"/private.txt"}'};
  const latePoll=deferred();let approvalReads=0,poll;
  const request=async(path,options={})=>{
    if(path==='/computer/approvals/pending')return ++approvalReads===1?[approval]:latePoll.promise;
    if(path==='/computer/approvals/approval-a'&&options.method==='POST')return {};
    if(path==='/workspace/knowledge'||path==='/workspace/routines'||path==='/workspace/runs'||path==='/workspace/notifications')return [];
    if(path==='/workspace/usage')return {tokens:0,estimated_cost:0,weekly_token_limit:null,resets_at:'2026-01-01T00:00:00Z',models:[]};
    if(path==='/workspace/settings')return {tool_approval:'always',notifications:true,weekly_token_limit:null};
    throw new Error('Unexpected request: '+path);
  };
  const {WorkspaceHub}=load('../src/components/WorkspaceHub.tsx',{
    react:view.react,'./LoadingState':{LoadingState:'loading-state'},'./GlassSelect':{GlassSelect:'select'},
    '../lib/api':{api:{},request},'../lib/dates':load('../src/lib/dates.ts'),
  },{...env.globals,React:view.react.default,setInterval:callback=>{poll=callback;return 1;},clearInterval(){}});
  view.mount(()=>WorkspaceHub({bots:[],rooms:[],ensureRoom:async()=>({id:'room-a'}),onRefresh:async()=>{},onOpenWorkspace(){},onClose(){},initialTab:'Activity'}));
  await view.flush();
  assert.match(textOf(view.tree),/Approval needed: Read a private file/);

  poll();
  await view.flush();
  button(view.tree,'Allow this action').props.onClick();
  await view.flush();
  assert.doesNotMatch(textOf(view.tree),/Approval needed: Read a private file/);

  latePoll.resolve([approval]);
  await view.flush();
  assert.doesNotMatch(textOf(view.tree),/Approval needed: Read a private file/,'an earlier poll cannot resurrect a resolved approval');
  view.unmount();
});

test('a saved memory remains visible when the initial knowledge request finishes late',async()=>{
  const env=environment(),view=renderer(env),initialKnowledge=deferred();
  let knowledgeReads=0;
  const saved={id:'memory-a',kind:'memory',scope:'workspace',name:'Writing preference',content:'Use concise language.',parameters:[]};
  const request=async(path,options={})=>{
    if(path==='/computer/approvals/pending')return [];
    if(path==='/workspace/knowledge'){
      if(options.method==='POST')return {};
      return ++knowledgeReads===1?initialKnowledge.promise:[saved];
    }
    if(path==='/workspace/routines'||path==='/workspace/runs'||path==='/workspace/notifications')return [];
    if(path==='/workspace/usage')return {tokens:0,estimated_cost:0,weekly_token_limit:null,resets_at:'2026-01-01T00:00:00Z',models:[]};
    if(path==='/workspace/settings')return {tool_approval:'never',notifications:true,weekly_token_limit:null};
    throw new Error('Unexpected request: '+path);
  };
  const {WorkspaceHub}=load('../src/components/WorkspaceHub.tsx',{
    react:view.react,'./LoadingState':{LoadingState:'loading-state'},'./GlassSelect':{GlassSelect:'select'},
    '../lib/api':{api:{},request},'../lib/dates':load('../src/lib/dates.ts'),
  },{...env.globals,React:view.react.default,setInterval:()=>1,clearInterval(){}});
  view.mount(()=>WorkspaceHub({bots:[],rooms:[],ensureRoom:async()=>({id:'room-a'}),onRefresh:async()=>{},onOpenWorkspace(){},onClose(){},initialTab:'Memory'}));
  await view.flush();

  const nameLabel=find(view.tree,node=>node.type==='label'&&textOf(node).startsWith('Name'));
  find(nameLabel,node=>node.type==='input').props.onChange({target:{value:saved.name}});
  const contentLabel=find(view.tree,node=>node.type==='label'&&textOf(node).startsWith('What should Cypher remember?'));
  find(contentLabel,node=>node.type==='textarea').props.onChange({target:{value:saved.content}});
  await view.flush();
  const saving=submit(view.tree);
  await view.flush();
  await saving;
  await view.flush();
  assert.match(textOf(view.tree),/Writing preference/);
  assert.match(textOf(view.tree),/Saved\./);

  initialKnowledge.resolve([]);
  await view.flush();
  assert.match(textOf(view.tree),/Writing preference/,'the stale initial load cannot erase the saved item');
  assert.match(textOf(view.tree),/Saved\./);
  view.unmount();
});
