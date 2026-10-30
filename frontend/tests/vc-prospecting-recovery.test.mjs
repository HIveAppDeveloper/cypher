import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,find,textOf,button} from './support/component-harness.mjs';

test('VC filing dates preserve calendar days while timestamps retain local timezone conversion',async()=>{
  const calendarLabel=new Date('2026-10-25T00:00:00Z').toLocaleDateString(undefined,{timeZone:'UTC'});
  const timestampLabel=new Date('2026-10-25T00:30:00Z').toLocaleDateString();
  for(const [filingDate,expected] of [
    ['2026-10-25',calendarLabel],
    ['2026-10-25T00:30:00Z',timestampLabel],
    ['2026-10-25T01:30:00+01:00',timestampLabel],
    ['2026-10-25T00:30:00',timestampLabel],
    ['2026-02-30','Not listed'],
  ]){
    const env=environment(),view=renderer(env);
    const founder={id:'filing-person',person_name:'Synthetic Person',company_name:'Synthetic Company',title:'Director',roles:['Director'],founder_status:'related_person',founder_evidence:null,industry:null,location:{city:null,state:null},filing_date:filingDate,filing_count_in_snapshot:1,source_quarters:['2026q4'],source_url:'https://www.sec.gov/Archives/synthetic'};
    const page={database:{records:1,explicit_founder_signals:0,matched_records:1,snapshot_ready:true,snapshot_built_at:'2026-10-25T00:30:00Z',quarters:['2026q4'],quarter_count:1,historical:{status:'idle',total_quarters:0,processed_quarters:0,current_quarter:null,error:null},source:'Synthetic fixture'},items:[founder],page:{limit:25,offset:0,returned:1},limitations:[]};
    class ApiError extends Error {}
    const request=async path=>{
      if(path.startsWith('/prospecting/investors/founders?'))return page;
      if(path==='/prospecting/investors/runs')return [];
      throw new Error('Unexpected request: '+path);
    };
    const {default:Workspace}=load('../src/components/VcProspectingWorkspace.tsx',{react:view.react,'../lib/api':{ApiError,request},'./WorkflowShell':{__esModule:true,default:'workflow-shell'},'./vc-prospecting.css':{}},{...env.globals,React:view.react.default,URLSearchParams});
    view.mount(()=>Workspace({}));
    await view.flush();
    const field=find(view.tree,node=>node.type==='div'&&Array.isArray(node.props?.children)&&node.props.children.some(child=>child?.type==='dt'&&textOf(child)==='Filing date'));
    assert.ok(field,'selected filing details rendered');
    const value=find(field,node=>node.type==='dd');
    assert.equal(textOf(value),expected,`${filingDate} in ${process.env.TZ||'default timezone'}`);
    view.unmount();
  }
});

test('dismissing an initial SEC load error keeps retry and unavailable status until recovery',async()=>{
  const env=environment(),view=renderer(env);
  let founderCalls=0;
  const page={database:{records:0,explicit_founder_signals:0,matched_records:0,snapshot_ready:false,snapshot_built_at:null,quarters:[],quarter_count:0,historical:{status:'idle',total_quarters:0,processed_quarters:0,current_quarter:null,error:null},source:'Synthetic fixture'},items:[],page:{limit:25,offset:0,returned:0},limitations:[]};
  class ApiError extends Error {}
  const request=async path=>{
    if(path.startsWith('/prospecting/investors/founders?')){
      founderCalls++;
      if(founderCalls===1)throw new ApiError('Synthetic SEC service failure');
      return page;
    }
    if(path==='/prospecting/investors/runs')return [];
    throw new Error('Unexpected request: '+path);
  };
  const {default:Workspace}=load('../src/components/VcProspectingWorkspace.tsx',{react:view.react,'../lib/api':{ApiError,request},'./WorkflowShell':{__esModule:true,default:'workflow-shell'},'./vc-prospecting.css':{}},{...env.globals,React:view.react.default,URLSearchParams});
  view.mount(()=>Workspace({}));
  await view.flush();
  assert.match(textOf(view.tree),/Could not load SEC data/);
  assert.match(textOf(view.tree),/Coverage unavailable/);
  assert.match(find(view.tree,node=>node.props?.className?.startsWith('vc-source-dot'))?.props.className,/is-unavailable/);
  assert.match(textOf(view.tree),/People in SEC filings \(—\)/);
  assert.match(textOf(view.tree),/Filing record counts unavailable/);
  assert.doesNotMatch(textOf(view.tree),/0 people and company records|0 people found/);
  const totals=find(view.tree,node=>node.props?.className==='vc-stats');
  assert.ok(totals);
  for(const metric of totals.props.children.slice(0,2)) {
    const value=find(metric,node=>node.type==='strong');
    assert.equal(textOf(value),'—');
    assert.equal(value.props['aria-label'],'Unavailable');
  }
  assert.ok(button(view.tree,'Retry'));

  button(view.tree,'Dismiss').props.onClick();
  await view.flush();
  assert.match(textOf(view.tree),/Could not load SEC data/,'dismiss only clears the detailed error');
  assert.ok(button(view.tree,'Retry'),'recovery remains available after dismiss');
  assert.doesNotMatch(textOf(view.tree),/Ready to find public data/,'failed unloaded data must not appear ready');

  button(view.tree,'Retry').props.onClick();
  await view.flush();
  assert.equal(founderCalls,2);
  assert.match(textOf(view.tree),/Ready to find public data/);
  assert.doesNotMatch(textOf(view.tree),/Could not load SEC data/);
  assert.equal(find(view.tree,node=>node.props?.className?.startsWith('vc-source-dot'))?.props.className,'vc-source-dot');
  assert.match(textOf(view.tree),/0 people and company records/);
  assert.match(textOf(view.tree),/People in SEC filings \(0\)/);
  assert.match(textOf(view.tree),/0 people found · showing 0/);
  assert.doesNotMatch(textOf(view.tree),/Coverage unavailable|Filing record counts unavailable/);
  view.unmount();
});
