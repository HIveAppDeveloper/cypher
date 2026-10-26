import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,deferred,button,textOf} from './support/component-harness.mjs';

test('a failed old shared-files read cannot hide a successful retry',async()=>{
  const env=environment(),view=renderer(env),staleRead=deferred();
  let reads=0;
  const files=[{id:'file-latest',name:'Latest notes.txt'}];
  const request=async path=>{
    if(path==='/computer/shared/files')return ++reads===1?staleRead.promise:files;
    throw new Error('Unexpected request: '+path);
  };
  const {ComputerPanel}=load('../src/components/ComputerPanel.tsx',{
    react:view.react,'./GlassSelect':{GlassSelect:'select'},'../lib/api':{api:{},request},
  },{...env.globals,React:view.react.default});
  view.mount(()=>ComputerPanel({bots:[],onClose(){}}));

  button(view.tree,'Shared files').props.onClick();
  await view.flush();
  button(view.tree,'Browser').props.onClick();
  await view.flush();
  button(view.tree,'Shared files').props.onClick();
  await view.flush();
  assert.match(textOf(view.tree),/Latest notes\.txt/);

  staleRead.reject(new Error('Old read failed'));
  await view.flush();
  assert.match(textOf(view.tree),/Latest notes\.txt/);
  assert.doesNotMatch(textOf(view.tree),/Old read failed/,'an obsolete error cannot replace the successful retry state');
  assert.equal(findAlert(view.tree),undefined);
  view.unmount();
});

function findAlert(tree){
  const visit=node=>{
    if(!node||typeof node!=='object')return undefined;
    if(Array.isArray(node))return node.map(visit).find(Boolean);
    return node.props?.role==='alert'?node:visit(node.props?.children);
  };
  return visit(tree);
}
