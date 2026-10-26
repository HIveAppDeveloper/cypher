import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deferred, environment, renderer, load, find, textOf, button, field } from './support/component-harness.mjs';

function all(node, predicate, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (Array.isArray(node)) { for (const child of node) all(child, predicate, result); return result; }
  if (predicate(node)) result.push(node);
  return all(node.props?.children, predicate, result);
}

function mount(createRoom, onClose, onCreated, suppliedBots) {
  const env = environment(), view = renderer(env);
  const { RoomCreator } = load('../src/components/RoomCreator.tsx', {
    react: view.react,
    './BotAvatar': { BotAvatar: 'avatar' },
    '../lib/api': { api: { createRoom } },
  }, { ...env.globals, React: view.react.default });
  const bots = suppliedBots || [
    { id: 'bot-a', name: 'Researcher', role: 'Research' },
    { id: 'bot-b', name: 'Writer', role: 'Writing' },
  ];
  view.mount(() => RoomCreator({ bots, onClose, onCreated }));
  return view;
}
const submit = tree => find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} });

test('team-room creation cannot be dismissed or submitted twice while the save is pending', async () => {
  const response = deferred(), requests = [], created = [], closed = [];
  const view = mount((name, ids) => { requests.push({ name, ids }); return response.promise; }, () => closed.push('closed'), room => created.push(room));

  find(view.tree, node => node.props?.id === 'room-name').props.onChange({ target: { value: '  Launch planning  ' } });
  for (const input of all(view.tree, node => node.type === 'input' && node.props?.type === 'checkbox')) {
    input.props.onChange({ target: { checked: true } });
    view.rerender();
  }

  const pending = submit(view.tree);
  const repeated = submit(view.tree);
  await view.flush();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].name, 'Launch planning');
  assert.equal(requests[0].ids.join(','), 'bot-a,bot-b');

  find(view.tree, node => node.type === 'dialog').props.onCancel({ preventDefault() {} });
  assert.deepEqual(closed, [], 'Escape cannot abandon an accepted in-flight creation');
  assert.equal(button(view.tree, 'Cancel').props.disabled, true);
  assert.equal(button(view.tree, 'Creating…').props.disabled, true);
  assert.equal(find(view.tree, node => node.props?.id === 'room-name').props.disabled, true);
  assert.equal(textOf(find(view.tree,node=>node.props?.role==='status')),'Creating your team room…');
  assert.equal(find(find(view.tree,node=>node.type==='form'),node=>node.props?.role==='status'),undefined,'progress announcements stay outside the busy form');
  assert.equal(requests.length, 1, 'the in-flight guard blocks same-tick duplicate submissions');

  const room = { id: 'room-1', title: 'Launch planning', bot_ids: ['bot-a', 'bot-b'], is_group: true };
  response.resolve(room);
  await Promise.all([pending, repeated]);
  await view.flush();
  assert.deepEqual(created, [room]);
  assert.deepEqual(closed, ['closed']);
  assert.equal(textOf(find(view.tree,node=>node.props?.role==='status')),'');
  view.unmount();
});

test('failed team-room creation preserves the form and allows a retry', async () => {
  let attempts = 0;
  const room = { id: 'room-1', title: 'Launch planning', bot_ids: ['bot-a', 'bot-b'], is_group: true };
  const view = mount(async () => { if (++attempts === 1) throw new Error('Connection interrupted.'); return room; }, () => {}, () => {});
  find(view.tree, node => node.props?.id === 'room-name').props.onChange({ target: { value: 'Launch planning' } });
  for (const input of all(view.tree, node => node.type === 'input' && node.props?.type === 'checkbox')) {
    input.props.onChange({ target: { checked: true } });
    view.rerender();
  }

  await submit(view.tree);
  await view.flush();
  assert.match(textOf(view.tree), /Connection interrupted/);
  assert.equal(find(view.tree, node => node.props?.id === 'room-name').props.value, 'Launch planning');
  assert.equal(button(view.tree, 'Create room').props.disabled, false);

  await submit(view.tree);
  await view.flush();
  assert.equal(attempts, 2);
  assert.equal(find(view.tree, node => node.props?.role === 'alert'), undefined);
  view.unmount();
});


test('large teams can select 200 agents while search preserves selection and enforces the room limit', async () => {
  const requests=[];
  const bots=Array.from({length:205},(_,i)=>({id:'bot-'+i,name:'Agent '+String(i).padStart(3,'0'),role:i%2?'Writer':'Researcher'}));
  const view=mount(async(name,ids)=>{requests.push({name,ids});return {id:'large-room',title:name,bot_ids:ids,is_group:true};},()=>{},()=>{},bots);
  field(view.tree,'room-name').props.onChange({target:{value:'Large research team'}});
  button(view.tree,'Select all').props.onClick();await view.flush();
  assert.match(textOf(view.tree),/200 of 200 selected/);
  assert.equal(all(view.tree,node=>node.type==='input'&&node.props.type==='checkbox'&&node.props.checked).length,200);
  field(view.tree,'team-agent-search').props.onChange({target:{value:'Agent 204'}});await view.flush();
  assert.equal(all(view.tree,node=>node.type==='input'&&node.props.type==='checkbox').length,1);
  assert.equal(find(view.tree,node=>node.type==='input'&&node.props.type==='checkbox').props.disabled,true);
  assert.match(textOf(view.tree),/200 of 200 selected/,'filtering must not discard hidden selected agents');
  await submit(view.tree);await view.flush();
  assert.equal(requests.length,1);
  assert.equal(requests[0].ids.length,200);
  assert.equal(new Set(requests[0].ids).size,200);
  assert.ok(!requests[0].ids.includes('bot-204'));
  view.unmount();
});

test('filtered selection and clear selection work without selecting unrelated agents', async () => {
  const bots=[{id:'a',name:'Ada',role:'Researcher'},{id:'b',name:'Bea',role:'Researcher'},{id:'c',name:'Cai',role:'Writer'}];
  const view=mount(async()=>({}),()=>{},()=>{},bots);
  field(view.tree,'team-agent-search').props.onChange({target:{value:'researcher'}});await view.flush();
  button(view.tree,'Select matches').props.onClick();await view.flush();
  assert.match(textOf(view.tree),/2 of 200 selected/);
  field(view.tree,'team-agent-search').props.onChange({target:{value:'Writer'}});await view.flush();
  assert.equal(find(view.tree,node=>node.type==='input'&&node.props.type==='checkbox').props.checked,false);
  button(view.tree,'Clear selection').props.onClick();await view.flush();
  assert.match(textOf(view.tree),/0 of 200 selected/);
  assert.equal(button(view.tree,'Create room').props.disabled,true);
  field(view.tree,'team-agent-search').props.onChange({target:{value:'no such agent'}});await view.flush();
  assert.match(textOf(view.tree),/No agents match this search/);
  view.unmount();
});
