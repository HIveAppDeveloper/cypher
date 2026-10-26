import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,find,button} from './support/component-harness.mjs';

test('browser commands appear after control, and masked input only after an actual browser screen',async()=>{
  const env=environment(),view=renderer(env),calls=[];
  const request=async(path,options={})=>{
    calls.push({path,body:options.body?JSON.parse(options.body):null});
    if(path.endsWith('/control'))return {};
    if(path.endsWith('/commands'))return {id:'fixture-command'};
    if(path.endsWith('/commands/fixture-command'))return {status:'completed',result:{image:'synthetic-image',url:'https://fixture.example',title:'Fixture browser'}};
    throw Error('Unexpected request: '+path);
  };
  const {ComputerPanel}=load('../src/components/ComputerPanel.tsx',{
    react:view.react,'./LoadingState':{LoadingState:'loading-state'},'./GlassSelect':{GlassSelect:'select'},
    '../lib/api':{api:{startBot(){throw Error('Existing sandbox must be reused');}},request},
  },{...env.globals,React:view.react.default,setInterval:()=>1,clearInterval(){}});
  view.mount(()=>ComputerPanel({bots:[{id:'fixture-agent',name:'Researcher',containerId:'existing-sandbox'}],onClose(){}}));
  assert.equal(find(view.tree,n=>n.props?.id==='computer-website'),undefined);
  assert.equal(find(view.tree,n=>n.props?.id==='computer-type'),undefined);
  assert.equal(calls.length,0);
  button(view.tree,'Open browser').props.onClick();await view.flush();
  assert.deepEqual(calls[0],{path:'/computer/fixture-agent/control',body:{takeover:true}});
  const website=find(view.tree,n=>n.props?.id==='computer-website');
  assert.equal(website.props.value,'','opening Computer never navigates to an example website');
  assert.equal(find(view.tree,n=>n.props?.id==='computer-type'),undefined);
  website.props.onChange({target:{value:'https://fixture.example'}});await view.flush();
  find(view.tree,n=>n.type==='form'&&n.props?.className==='computer-address-bar').props.onSubmit({preventDefault(){}});
  await view.flush();
  assert.deepEqual(calls.find(c=>c.path.endsWith('/commands')).body,{action:'navigate',url:'https://fixture.example'});
  assert.equal(find(view.tree,n=>n.props?.id==='computer-type').props.type,'password');
  assert.ok(button(view.tree,'Enter'));
  view.unmount();
  assert.deepEqual(calls.at(-1),{path:'/computer/fixture-agent/control',body:{takeover:false}},'closing still returns control');
});
