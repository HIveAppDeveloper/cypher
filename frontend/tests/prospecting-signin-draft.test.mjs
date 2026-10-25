import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,find,textOf,submit,deferred} from './support/component-harness.mjs';

test('prospecting setup is restored for the same account after sign-in and never restored across accounts',async()=>{
  const env=environment();
  let runCalls=0;
  const profile={url:'https://northstar.example',title:'Northstar',description:'Scheduling tools',market:'SaaS teams',product:'Scheduling software',assumptions:[],retrieved_at:'2026-10-25T12:00:00Z'};
  const request=async path=>{
    if(path==='/prospecting/settings')return {akta_available:true};
    if(path==='/prospecting/profile')return profile;
    if(path==='/prospecting/runs'){
      runCalls++;
      if(runCalls===1)throw new Error('Session expired');
      return [];
    }
    throw new Error('Unexpected request: '+path);
  };
  const fetch=async()=>({json:async()=>({configured:false})});
  function mount(accountId){
    const view=renderer(env);
    const {default:Workspace}=load('../src/components/ProspectingWorkspace.tsx',{
      react:view.react,'../lib/api':{request},'../lib/company-website':{companyWebsite:value=>value.startsWith('https://')?value:`https://${value}`},
      '../lib/cypher-voice':{CYPHER_VOICE_INTRO:'Hello'},'./cipher/BinaryLens':{__esModule:true,default:'lens'},
      './cipher/CypherMark':{__esModule:true,default:'mark'},'./WorkflowShell':{__esModule:true,default:'workflow-shell'},'./prospecting-workspace.css':{},
    },{...env.globals,React:view.react.default,URLSearchParams,fetch});
    view.mount(()=>Workspace({accountId}));
    return view;
  }

  const first=mount('account-1');
  await first.flush();
  assert.match(textOf(first.tree),/Session expired/);
  const urlField=find(first.tree,node=>node.type==='input'&&node.props?.id==='prospecting-url');
  urlField.props.onChange({target:{value:'northstar.example'}});
  first.render();
  submit(first.tree);
  await first.flush();
  assert.match(textOf(first.tree),/Your customer profile/);
  find(first.tree,node=>node.type==='input'&&node.props?.value==='SaaS teams').props.onChange({target:{value:'Growth-stage SaaS teams in the US'}});
  first.render();
  find(first.tree,node=>node.type==='textarea').props.onChange({target:{value:'Scheduling software for distributed operations teams.'}});
  first.render();
  const confirm=find(first.tree,node=>node.type==='input'&&node.props?.type==='checkbox');
  confirm.props.onChange({target:{checked:true}});
  first.render();
  const signIn=find(first.tree,node=>node.type==='a'&&String(node.props?.href||'').startsWith('/login?returnTo='));
  assert.ok(signIn,'session recovery offers sign-in');
  signIn.props.onClick({preventDefault(){}});
  await first.flush();
  first.unmount();

  const otherAccount=mount('account-2');
  await otherAccount.flush();
  assert.equal(find(otherAccount.tree,node=>node.type==='input'&&node.props?.id==='prospecting-url').props.value,'');
  assert.ok(env.globals.sessionStorage.getItem('grokbot.prospecting-form.v1.account-1'));
  otherAccount.unmount();

  const recovered=mount('account-1');
  await recovered.flush();
  assert.equal(find(recovered.tree,node=>node.type==='input'&&node.props?.id==='prospecting-url').props.value,'https://northstar.example');
  assert.equal(find(recovered.tree,node=>node.type==='input'&&node.props?.value==='Growth-stage SaaS teams in the US')?.props.value,'Growth-stage SaaS teams in the US');
  assert.equal(find(recovered.tree,node=>node.type==='textarea')?.props.value,'Scheduling software for distributed operations teams.');
  assert.equal(find(recovered.tree,node=>node.type==='input'&&node.props?.type==='checkbox')?.props.checked,false,'the user must reconfirm before starting research');
  assert.match(textOf(recovered.tree),/Your research setup is back/);
  assert.equal(env.globals.sessionStorage.getItem('grokbot.prospecting-form.v1.account-1'),null,'the one-time draft is removed after restore');
  recovered.unmount();
});

test('changing the signed-in account clears the prior prospecting form and ignores late account-A results',async()=>{
  const env=environment(),view=renderer(env),historyA=deferred();
  let runCalls=0,signalA;
  const privateRun={id:'private-run-a',market:'Private A market',product:'Private A offer',limit:20,status:'completed',results:[],events:[],gmail:{status:'connection_required'},limitations:[]};
  const request=async(path,options={})=>{
    if(path==='/prospecting/settings')return {akta_available:false};
    if(path==='/prospecting/runs'){
      runCalls++;
      if(runCalls===1){signalA=options.signal;return historyA.promise;}
      return [];
    }
    throw new Error('Unexpected request: '+path);
  };
  env.globals.sessionStorage.setItem('grokbot.prospecting-form.v1.account-A',JSON.stringify({version:1,url:'https://account-a.example',manual:true,market:'Private A market',product:'Private A offer'}));
  const {default:Workspace}=load('../src/components/ProspectingWorkspace.tsx',{
    react:view.react,'../lib/api':{request},'../lib/company-website':{companyWebsite:value=>value},
    '../lib/cypher-voice':{CYPHER_VOICE_INTRO:'Hello'},'./cipher/BinaryLens':{__esModule:true,default:'lens'},
    './cipher/CypherMark':{__esModule:true,default:'mark'},'./WorkflowShell':{__esModule:true,default:'workflow-shell'},'./prospecting-workspace.css':{},
  },{...env.globals,React:view.react.default,URLSearchParams,fetch:async()=>({json:async()=>({configured:false})})});
  let props={accountId:'account-A'};
  view.mount(()=>Workspace(props));
  await view.flush();
  assert.equal(find(view.tree,node=>node.type==='input'&&node.props?.id==='prospecting-url').props.value,'https://account-a.example');
  assert.equal(find(view.tree,node=>node.type==='textarea')?.props.value,'Private A offer');
  find(view.tree,node=>node.type==='input'&&node.props?.type==='checkbox').props.onChange({target:{checked:true}});
  view.render();

  props={accountId:'account-B'};
  view.rerender();
  await view.flush();
  assert.equal(signalA.aborted,true,'the previous account history request is cancelled');
  assert.equal(find(view.tree,node=>node.type==='input'&&node.props?.id==='prospecting-url').props.value,'');
  assert.equal(find(view.tree,node=>node.type==='textarea'),undefined);
  assert.doesNotMatch(textOf(view.tree),/Private A market|Private A offer/);

  historyA.resolve([privateRun]);
  await view.flush();
  assert.doesNotMatch(textOf(view.tree),/Private A market|Private A offer/,'late account-A data must not reappear after account B loads');
  assert.equal(runCalls,2,'account B loads its own saved research');

  props={};
  view.rerender();
  await view.flush();
  assert.equal(find(view.tree,node=>node.type==='input'&&node.props?.id==='prospecting-url').props.value,'');
  assert.doesNotMatch(textOf(view.tree),/Private A market|Private A offer/,'sign-out also clears the prior account setup');
  assert.equal(runCalls,3,'the anonymous state loads its own empty research view');
  view.unmount();
});
