import {test} from 'node:test';
import assert from 'node:assert/strict';
import {environment,renderer,load} from './support/component-harness.mjs';

function avatars(){const env=environment(),view=renderer(env);return load('../src/components/BotAvatar.tsx',{}, {...env.globals,React:view.react.default});}

test('agent logos retain deterministic identity and give roles distinct vector emblems',()=>{
 const {BotAvatar,agentIdentity}=avatars();
 const identities=['Researcher','Reviewer','Builder','Writer','Coordinator','Data analyst','Designer','Security','Finance','Support','Runner'].map(role=>agentIdentity(role,role));
 assert.equal(new Set(identities.map(identity=>identity.kind)).size,11);
 assert.deepEqual(agentIdentity('Ada','Builder'),agentIdentity('Ada','Builder'));
 assert.notEqual(agentIdentity('Ada','Builder').signature,agentIdentity('Bea','Builder').signature);
 for(const name of ['Researcher','Ada','Cypher','研究員']){
  const avatar=BotAvatar({name,small:true,status:'working'});
  assert.equal(avatar.props['aria-hidden'],'true','the adjacent name remains the accessible label');
  assert.equal(avatar.props['data-agent-status'],'working');
  assert.ok(avatar.props.className.includes('small-avatar'));
  assert.ok(avatar.props['data-agent-signature']);
  const child=avatar.props.children[0],svg=child.type(child.props);
  assert.equal(svg.type,'svg');
  assert.equal(svg.props.viewBox,'0 0 24 24');
  assert.equal(svg.props.focusable,'false');
 }
});
