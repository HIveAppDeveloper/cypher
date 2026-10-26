import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deferred, environment, renderer, load, find, textOf, button } from './support/component-harness.mjs';

function all(node, predicate, result = []) {
  if (!node || typeof node !== 'object') return result;
  if (Array.isArray(node)) { for (const child of node) all(child, predicate, result); return result; }
  if (predicate(node)) result.push(node);
  return all(node.props?.children, predicate, result);
}

function mount(createRoom, onClose, onCreated) {
  const env = environment(), view = renderer(env);
  const { RoomCreator } = load('../src/components/RoomCreator.tsx', {
    react: view.react,
    './BotAvatar': { BotAvatar: 'avatar' },
    '../lib/api': { api: { createRoom } },
  }, { ...env.globals, React: view.react.default });
  const bots = [
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
  await view.flush();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].name, 'Launch planning');
  assert.equal(requests[0].ids.join(','), 'bot-a,bot-b');

  await submit(view.tree);
  find(view.tree, node => node.type === 'dialog').props.onCancel({ preventDefault() {} });
  assert.deepEqual(closed, [], 'Escape cannot abandon an accepted in-flight creation');
  assert.equal(button(view.tree, 'Cancel').props.disabled, true);
  assert.equal(button(view.tree, 'Creating…').props.disabled, true);
  assert.equal(find(view.tree, node => node.props?.id === 'room-name').props.disabled, true);
  assert.equal(requests.length, 1, 'the in-flight guard blocks same-tick duplicate submissions');

  const room = { id: 'room-1', title: 'Launch planning', bot_ids: ['bot-a', 'bot-b'], is_group: true };
  response.resolve(room);
  await pending;
  await view.flush();
  assert.deepEqual(created, [room]);
  assert.deepEqual(closed, ['closed']);
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
