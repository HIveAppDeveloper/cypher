import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,find,field,button,textOf} from './support/component-harness.mjs';

function editor() {
  const env=environment(),view=renderer(env),writes=[];
  let rows=[{id:'note-a',name:'Writing style',kind:'preference',content:'Keep it brief.',source:'owner',verified:false}];
  let failSave=false,failDelete=false;
  const api={
    getContext:async()=>rows.map(row=>({...row})),
    saveContext:async(id,note)=>{
      writes.push({...note});
      if(failSave)throw new Error('Save interrupted.');
      // Existing backend contract: identity is conversation + case-insensitive name.
      const index=rows.findIndex(row=>row.name.toLowerCase()===note.name.trim().toLowerCase());
      const saved={...note,id:index<0?'duplicate':rows[index].id,source:'owner',verified:false};
      if(index<0)rows.push(saved);else rows[index]=saved;
      return saved;
    },
    deleteContext:async(id,noteId)=>{if(failDelete)throw new Error('Delete interrupted.');rows=rows.filter(row=>row.id!==noteId);},
  };
  const {ContextPanel}=load('../src/components/ContextPanel.tsx',{react:view.react,'./GlassSelect':{GlassSelect:'select'},'../lib/api':{api}},{...env.globals,React:view.react.default});
  view.mount(()=>ContextPanel({conversationId:'conversation-a'}));
  find(view.tree,node=>node.type==='details').props.onToggle({currentTarget:{open:true}});
  return {view,writes,get rows(){return rows;},failSave(value){failSave=value;},failDelete(value){failDelete=value;}};
}

test('editing conversation memory updates its existing identity instead of creating a renamed duplicate',async()=>{
  const app=editor(),{view}=app;await view.flush();
  button(view.tree,'Edit').props.onClick();await view.flush();
  if(!field(view.tree,'memory-name').props.disabled)field(view.tree,'memory-name').props.onChange({target:{value:'Renamed note'}});
  field(view.tree,'memory-content').props.onChange({target:{value:'Lead with the result.'}});
  find(view.tree,node=>node.type==='select').props.onChange({target:{value:'fact'}});
  await view.flush();
  find(view.tree,node=>node.type==='button'&&/Save/.test(textOf(node))).props.onClick();await view.flush();
  assert.equal(app.rows.length,1,'Edit must update the original note, not retain it alongside a renamed copy');
  assert.equal(app.rows[0].id,'note-a');
  assert.deepEqual(app.writes,[{name:'Writing style',kind:'fact',content:'Lead with the result.'}]);
  assert.equal(field(view.tree,'memory-name').props.value,'');
  assert.equal(field(view.tree,'memory-name').props.disabled,false);
  assert.equal(button(view.tree,'Cancel edit'),undefined);
  button(view.tree,'Edit').props.onClick();await view.flush();
  assert.equal(field(view.tree,'memory-name').props.disabled,true);
  view.unmount();
});

test('cancel and confirmed deletion clear edit state without restoring or rewriting a forgotten note',async()=>{
  const app=editor(),{view}=app;await view.flush();
  button(view.tree,'Edit').props.onClick();await view.flush();
  field(view.tree,'memory-content').props.onChange({target:{value:'Unsaved change'}});await view.flush();
  button(view.tree,'Cancel edit').props.onClick();await view.flush();
  assert.equal(app.writes.length,0);
  assert.equal(app.rows[0].content,'Keep it brief.');
  assert.equal(field(view.tree,'memory-name').props.value,'');
  button(view.tree,'Edit').props.onClick();await view.flush();
  app.failDelete(true);button(view.tree,'Forget').props.onClick();await view.flush();
  assert.equal(field(view.tree,'memory-name').props.disabled,true,'failed deletion keeps the editable note intact');
  app.failDelete(false);button(view.tree,'Forget').props.onClick();await view.flush();
  assert.equal(app.rows.length,0);
  assert.equal(field(view.tree,'memory-name').props.value,'');
  assert.equal(field(view.tree,'memory-content').props.value,'');
  assert.equal(button(view.tree,'Cancel edit'),undefined);
  assert.equal(find(view.tree,node=>node.props?.role==='alert'),undefined);
  view.unmount();
});

test('a failed edit preserves the draft and identity for a successful retry',async()=>{
  const app=editor(),{view}=app;await view.flush();
  button(view.tree,'Edit').props.onClick();await view.flush();
  field(view.tree,'memory-content').props.onChange({target:{value:'Retry this update'}});await view.flush();
  app.failSave(true);button(view.tree,'Save changes').props.onClick();await view.flush();
  assert.match(textOf(view.tree),/Save interrupted/);
  assert.equal(field(view.tree,'memory-name').props.disabled,true);
  assert.equal(field(view.tree,'memory-content').props.value,'Retry this update');
  app.failSave(false);button(view.tree,'Save changes').props.onClick();await view.flush();
  assert.equal(app.rows.length,1);
  assert.equal(app.rows[0].content,'Retry this update');
  assert.equal(find(view.tree,node=>node.props?.role==='alert'),undefined);
  assert.equal(field(view.tree,'memory-name').props.disabled,false);
  view.unmount();
});
