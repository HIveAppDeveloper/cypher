import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environment, renderer, load, find, textOf, button } from './support/component-harness.mjs';

test('inline Apps loading and error recovery stay in the workspace without a modal', () => {
  const env=environment(),view=renderer(env);let closed=0;
  class Component { constructor(props){this.props=props;} }
  const react={...view.react,Component,Suspense:'suspense'};
  const {PanelBoundary,InlinePanelNotice}=load('../src/components/PanelBoundary.tsx',{react,'./LoadingState':{LoadingState:'loading-state'}},{...env.globals,React:view.react.default});
  const boundary=new PanelBoundary({inline:true,title:'Apps',onClose:()=>closed++,children:'Loaded apps'});
  let notice=boundary.render().props.fallback;
  assert.equal(notice.type,InlinePanelNotice);
  view.mount(()=>notice.type(notice.props));
  assert.equal(view.tree.type,'section');
  assert.equal(find(view.tree,node=>node.type==='dialog'),undefined);
  assert.equal(find(view.tree,node=>node.type==='loading-state').props.label,'Opening apps…');
  button(view.tree,'Close').props.onClick();assert.equal(closed,1);
  boundary.state={failed:true};notice=boundary.render();view.rerender();
  assert.match(textOf(find(view.tree,node=>node.props?.role==='alert')),/couldn’t load/);
  view.unmount();
});

test('saved founder shortlists stay isolated when the signed-in account changes', async () => {
  const env=environment(),view=renderer(env),writes=[];
  const founder={id:'alpha',person_name:'Synthetic Alpha',company_name:'Fixture Alpha',title:'Founder',roles:['Founder'],founder_status:'explicit',founder_evidence:'Synthetic fixture',industry:null,location:{city:null,state:null},filing_date:null,filing_count_in_snapshot:1,source_quarters:[],source_url:'https://example.com/filing'};
  const entries=new Map([['cypher-vc-shortlist:account-a',JSON.stringify([founder])],['cypher-vc-shortlist:account-b','[]'],['cypher-vc-shortlist','legacy-must-stay-untouched']]);
  env.window.localStorage={getItem:key=>entries.get(key)||null,setItem:(key,value)=>{writes.push({key,value});entries.set(key,value);}};
  const page={database:{records:0,explicit_founder_signals:0,matched_records:0,snapshot_ready:false,snapshot_built_at:null,quarters:[],quarter_count:0,historical:{status:'idle',total_quarters:0,processed_quarters:0,current_quarter:null,error:null},source:'Synthetic fixture'},items:[],page:{limit:25,offset:0,returned:0},limitations:[]};
  class ApiError extends Error {}
  const {default:Workspace}=load('../src/components/VcProspectingWorkspace.tsx',{react:view.react,'../lib/api':{ApiError,request:async path=>path.includes('/founders?')?page:[]},'./WorkflowShell':{__esModule:true,default:'workflow-shell'},'./vc-prospecting.css':{}},{...env.globals,React:view.react.default,URLSearchParams});
  let accountId='account-a';view.mount(()=>Workspace({accountId}));await view.flush();
  button(view.tree,'3Shortlist').props.onClick();await view.flush();
  assert.match(textOf(view.tree),/Fixture Alpha/);
  accountId='account-b';view.rerender();await view.flush();
  assert.doesNotMatch(textOf(view.tree),/Fixture Alpha/);
  assert.match(textOf(view.tree),/Your shortlist is empty/);
  assert.ok(writes.filter(row=>row.key.endsWith('account-b')).every(row=>!row.value.includes('Fixture Alpha')));
  assert.equal(entries.get('cypher-vc-shortlist'),'legacy-must-stay-untouched');
  view.unmount();
});
