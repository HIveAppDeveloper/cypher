import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,find,textOf,button,submit} from './support/component-harness.mjs';

function editor(kind) {
  const env=environment(),view=renderer(env),writes=[];
  let rows=[{id:'saved-'+kind,kind,scope:'bot:agent-a',name:kind==='skill'?'weekly-brief':'Writing preferences',content:'Original content',parameters:kind==='skill'?['company']:[],updated_at:'2026-10-25T12:00:00Z'}];
  const original={...rows[0]};
  const request=async(path,options={})=>{
    if(path==='/workspace/knowledge') {
      if(options.method==='POST') {
        const body=JSON.parse(options.body);writes.push(body);
        const index=rows.findIndex(row=>row.kind===body.kind&&row.scope===body.scope&&row.name===body.name);
        const saved={...body,id:index<0?'duplicate':rows[index].id};
        if(index<0)rows.push(saved);else rows[index]=saved;
        return saved;
      }
      return rows;
    }
    if(path==='/workspace/knowledge/'+original.id&&options.method==='DELETE'){rows=[];return {};}
    if(path==='/workspace/runs/run-a/skill-draft')return {name:'drafted-skill',content:'Review this generated recipe'};
    if(path==='/workspace/runs')return [{id:'run-a',title:'Completed task',status:'completed'}];
    if(path==='/workspace/settings')return {notifications:true,tool_approval:'writes'};
    if(path==='/workspace/usage')return {tokens:0,estimated_cost:0,weekly_token_limit:null,models:[]};
    if(['/workspace/routines','/workspace/notifications','/computer/approvals/pending'].includes(path))return [];
    throw Error('Unexpected request '+path);
  };
  const {WorkspaceHub}=load('../src/components/WorkspaceHub.tsx',{
    react:view.react,'../lib/api':{api:{},request},'./LoadingState':{LoadingState:'loading-state'},'./GlassSelect':{GlassSelect:'select'},
  },{...env.globals,React:view.react.default,setInterval:()=>1,clearInterval(){}});
  view.mount(()=>WorkspaceHub({bots:[{id:'agent-a',name:'Researcher'}],rooms:[],ensureRoom:async()=>({id:'room-a'}),onRefresh:async()=>{},onOpenWorkspace(){},onClose(){},initialTab:kind==='skill'?'Skills':'Memory'}));
  return {view,original,writes,get rows(){return rows;}};
}

const control=(tree,label,type)=>find(find(tree,node=>node.type==='label'&&textOf(node).startsWith(label)),node=>node.type===type);

for(const kind of ['memory','skill'])test(`${kind} editing keeps upsert identity fixed and clears edit state on recovery actions`,async()=>{
  const app=editor(kind),{view,original,writes}=app;
  await view.flush();
  button(view.tree,'Edit').props.onClick();await view.flush();
  assert.equal(control(view.tree,'Name','input').props.disabled,true);
  assert.equal(control(view.tree,'Who can use this?','select').props.disabled,true);
  assert.ok(button(view.tree,'Save changes'));
  control(view.tree,kind==='skill'?'Instructions':'What should Cypher remember?','textarea').props.onChange({target:{value:'Updated content'}});
  if(kind==='skill')control(view.tree,'Optional inputs','input').props.onChange({target:{value:'company, audience'}});
  await view.flush();
  submit(view.tree);await view.flush();
  assert.equal(writes.length,1);
  assert.deepEqual({...writes[0]},{kind,scope:original.scope,name:original.name,content:'Updated content',parameters:kind==='skill'?['company','audience']:[]});
  assert.equal(app.rows.length,1,'an edit must update the existing identity rather than create a duplicate');
  assert.equal(app.rows[0].id,original.id);
  assert.match(textOf(view.tree),/Updated\./);
  assert.equal(button(view.tree,'Save changes'),undefined);

  button(view.tree,'Edit').props.onClick();await view.flush();
  control(view.tree,kind==='skill'?'Instructions':'What should Cypher remember?','textarea').props.onChange({target:{value:'Unsaved changes'}});
  button(view.tree,'Cancel edit').props.onClick();await view.flush();
  assert.equal(control(view.tree,'Name','input').props.value,'');
  assert.equal(control(view.tree,kind==='skill'?'Instructions':'What should Cypher remember?','textarea').props.value,'');
  assert.equal(writes.length,1,'cancelling must not save the unsaved content');
  assert.equal(app.rows[0].content,'Updated content');

  if(kind==='skill') {
    button(view.tree,'Edit').props.onClick();await view.flush();
    find(view.tree,node=>node.type==='select'&&node.props.value==='').props.onChange({target:{value:'run-a'}});await view.flush();
    button(view.tree,'Create reusable instructions').props.onClick();await view.flush();
    assert.equal(button(view.tree,'Cancel edit'),undefined);
    assert.equal(control(view.tree,'Name','input').props.value,'drafted-skill');
    assert.equal(control(view.tree,'Name','input').props.disabled,false);
  }

  button(view.tree,'Edit').props.onClick();await view.flush();
  button(view.tree,kind==='skill'?'Notes':'Saved instructions').props.onClick();await view.flush();
  assert.equal(button(view.tree,'Cancel edit'),undefined);
  assert.equal(control(view.tree,'Name','input').props.value,'');
  button(view.tree,kind==='skill'?'Saved instructions':'Notes').props.onClick();await view.flush();
  button(view.tree,'Edit').props.onClick();await view.flush();
  button(view.tree,'Delete').props.onClick();await view.flush();
  assert.equal(app.rows.length,0);
  assert.equal(button(view.tree,'Cancel edit'),undefined);
  assert.equal(control(view.tree,'Name','input').props.value,'');
  view.unmount();
});
