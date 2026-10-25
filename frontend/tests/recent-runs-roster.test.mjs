import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environment, renderer, load, find, textOf, button } from './support/component-harness.mjs';

function roster(request) {
  const env = environment();
  const view = renderer(env);
  const { BotRoster } = load('../src/components/BotRoster.tsx', {
    react: view.react,
    './AccountMenu': { AccountMenu: 'account-menu' },
    './LoadingState': { LoadingState: 'loading-state' },
    './BotAvatar': { BotAvatar: 'bot-avatar' },
    '../lib/api': { request },
  }, { ...env.globals, React: view.react.default });
  const opened = [];
  const props = {
    bots: [], selectedBot: null, onSelectBot() {}, onCreateNew() {}, rooms: [], selectedRoom: null,
    onSelectRoom() {}, onCreateRoom() {}, onHome() {}, onSetup() {}, onPlugins() {}, onPreferences() {},
    onGoals() {}, onChannels() {}, onWorkspace() {}, onMyWork() {}, onOpenRecent(id) { opened.push(id); },
    onComputer() {},
  };
  view.mount(() => BotRoster(props));
  return { view, opened };
}

test('recent tasks distinguish initial loading from empty and retry after a failed load', async () => {
  let attempts = 0;
  const run = { id: 'run-1', title: 'Recovered research task', status: 'completed', conversation_id: 'conversation-1', created_at: '2026-10-25T12:00:00' };
  const { view, opened } = roster(path => {
    if (path === '/workspace/settings') return Promise.resolve({});
    assert.equal(path, '/workspace/runs');
    attempts++;
    return attempts === 1 ? Promise.reject(new Error('Synthetic offline state')) : Promise.resolve([run]);
  });

  assert.match(textOf(view.tree), /Loading recent tasks/);
  assert.doesNotMatch(textOf(view.tree), /No recent tasks yet/);
  assert.equal(find(view.tree, node => node.props?.['aria-busy'] === true)?.props.className, 'cypher-recent-tasks');

  await view.flush();
  assert.match(textOf(view.tree), /Recent tasks are unavailable/);
  button(view.tree, 'Retry').props.onClick();
  await view.flush();
  assert.match(textOf(view.tree), /Recovered research task/);
  assert.doesNotMatch(textOf(view.tree), /Loading recent tasks|No recent tasks yet|Recent tasks are unavailable/);
  assert.equal(attempts, 2);

  const task = find(view.tree, node => node.type === 'button' && node.props?.title === run.title);
  task.props.onClick();
  assert.deepEqual(opened, [run.conversation_id]);
  view.unmount();
});
