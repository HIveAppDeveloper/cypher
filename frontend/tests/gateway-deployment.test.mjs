import test from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load,find,textOf,button} from './support/component-harness.mjs';
test('deployment chooser offers all platforms, private setup, and no implicit provisioning',async()=>{
  const env=environment(),view=renderer(env),base=env.element;env.element=props=>base({closest:()=>null,...props});
  const Component=load('../src/components/GatewayDeployment.tsx',{react:view.react,'./GatewayProviderLogo':{GatewayProviderLogo:'provider-logo'}},{...env.globals,React:view.react.default,navigator:{clipboard:{writeText:async()=>{}}}}).GatewayDeployment;
  view.mount(()=>Component());assert.ok(button(view.tree,'Set up locally →'));assert.ok(button(view.tree,'Set up on AWS →'));assert.ok(button(view.tree,'Set up on Azure →'));
  button(view.tree,'Set up on Azure →').props.onClick();await view.flush();assert.match(textOf(view.tree),/Resend key/);assert.match(textOf(view.tree),/--target azure/);assert.match(textOf(view.tree),/new installation/);assert.ok(find(view.tree,n=>n.type==='a'&&n.props.href==='/setup/cypher_host.py'&&n.props.download));
  assert.equal(find(view.tree,n=>n.type==='input'&&n.props.type==='password'),undefined);view.unmount();
});
