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
    react:view.react,'./LoadingState':{LoadingState:'loading-state'},'./PanelState':{PanelState:'panel-state',ActionStatus:'action-status',panelClassName:'panel'},'./GlassSelect':{GlassSelect:'select'},'../lib/api':{api:{},request},
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

test('a shared-files load failure has a direct retry action that reloads the list',async()=>{
  const env=environment(),view=renderer(env);
  let reads=0;
  const files=[{id:'file-after-retry',name:'Recovered notes.txt'}];
  const request=async path=>{
    if(path==='/computer/shared/files'){
      if(++reads===1)throw new Error('Synthetic shared-file service failure');
      return files;
    }
    throw new Error('Unexpected request: '+path);
  };
  const {ComputerPanel}=load('../src/components/ComputerPanel.tsx',{
    react:view.react,'./LoadingState':{LoadingState:'loading-state'},'./PanelState':{PanelState:'panel-state',ActionStatus:'action-status',panelClassName:'panel'},'./GlassSelect':{GlassSelect:'select'},'../lib/api':{api:{},request},
  },{...env.globals,React:view.react.default});
  view.mount(()=>ComputerPanel({bots:[],onClose(){}}));

  button(view.tree,'Shared files').props.onClick();
  await view.flush();
  assert.equal(reads,1);
  assert.match(textOf(findAlert(view.tree)),/Synthetic shared-file service failure/);
  assert.ok(button(view.tree,'Retry loading shared files'),'the failed list has a direct recovery action');

  button(view.tree,'Retry loading shared files').props.onClick();
  await view.flush();
  assert.equal(reads,2,'retry requests the shared-file list directly');
  assert.match(textOf(view.tree),/Recovered notes\.txt/);
  assert.equal(findAlert(view.tree),undefined,'successful retry clears the list error');
  assert.equal(button(view.tree,'Retry loading shared files'),undefined,'retry disappears when the list is available');
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
