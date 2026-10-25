import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environment, renderer, load, find, textOf } from './support/component-harness.mjs';

const dates = load('../src/lib/dates.ts');

test('WorkPanel displays a valid local date for a run with a compact numeric offset', async () => {
  const env = environment(), view = renderer(env);
  const { WorkPanel } = load('../src/components/WorkPanel.tsx', {
    react: view.react,
    '../lib/api': { api: { cancelJob: async () => {} } },
    '../lib/dates': dates,
    './SteeringPanel': { SteeringPanel: 'steering-panel' },
  }, { ...env.globals, React: view.react.default });
  const createdAt = '2026-10-25T07:34:56.789-0500';

  view.mount(() => WorkPanel({
    open: true,
    onClose() {},
    conversationId: 'room',
    jobs: [{ id: 'run', title: 'Offset task', status: 'completed', created_at: createdAt }],
    options: {},
    onChange() {},
    onRefresh: async () => {},
  }));
  await view.flush();

  const time = find(view.tree, node => node.type === 'time');
  assert.ok(time);
  assert.equal(time.props.dateTime, createdAt);
  assert.notEqual(textOf(time), '—');
  assert.doesNotMatch(textOf(time), /Invalid Date/);
  view.unmount();
});

test('GoalsPanel displays a valid next-run date for a timestamp with an explicit offset', async () => {
  const env = environment(), view = renderer(env);
  const { GoalsPanel } = load('../src/components/GoalsPanel.tsx', {
    react: view.react,
    './LoadingState': { LoadingState: 'loading-state' },
    './GlassSelect': { GlassSelect: 'select' },
    '../lib/api': { api: { getGoals: async () => [{
      id: 'goal', conversation_id: 'room', title: 'Keep the date', objective: 'Work',
      success_criteria: 'Done', status: 'active', runs: 1, max_runs: 3,
      interval_minutes: 60, next_run_at: '2026-10-25T12:34:56+00:00', manager_model: 'gpt-6.1-sol',
    }], createGoal: async () => {}, setGoalState: async () => {} } },
    '../lib/dates': dates,
  }, { ...env.globals, React: view.react.default });

  view.mount(() => GoalsPanel({ onClose() {}, rooms: [], ensureRoom: async () => ({ id: 'room' }), onOpenWorkspace() {} }));
  await view.flush();

  const nextRun = find(view.tree, node => node.type === 'p' && textOf(node).startsWith('Next run:'));
  assert.ok(nextRun);
  assert.doesNotMatch(textOf(nextRun), /—|Invalid Date/);
  view.unmount();
});

test('WorkspaceHub displays recent work dates from offset timestamps without an invalid label', async () => {
  const env = environment(), view = renderer(env);
  const { WorkspaceHub } = load('../src/components/WorkspaceHub.tsx', {
    react: view.react,
    './LoadingState': { LoadingState: 'loading-state' },
    './GlassSelect': { GlassSelect: 'select' },
    '../lib/api': {
      api: {},
      request: async path => {
        if (path === '/computer/approvals/pending') return [];
        if (path === '/workspace/knowledge' || path === '/workspace/routines' || path === '/workspace/notifications') return [];
        if (path === '/workspace/runs') return [{
          id: 'run', title: 'Offset run', status: 'completed', conversation_id: 'room',
          created_at: '2026-10-25T07:34:56.789-05:00',
        }];
        if (path === '/workspace/usage') return { tokens: 0, estimated_cost: 0, weekly_token_limit: null, resets_at: '2026-10-26T00:00:00Z', models: [] };
        if (path === '/workspace/settings') return { tool_approval: 'never', notifications: true, weekly_token_limit: null };
        throw new Error(`Unexpected request: ${path}`);
      },
    },
    '../lib/dates': dates,
  }, { ...env.globals, React: view.react.default, setInterval: () => 1, clearInterval() {} });

  view.mount(() => WorkspaceHub({
    bots: [], rooms: [], ensureRoom: async () => ({ id: 'room' }), onRefresh: async () => {},
    onOpenWorkspace() {}, onClose() {}, initialTab: 'Activity',
  }));
  await view.flush();

  const recentDate = find(view.tree, node => node.type === 'small' && textOf(node).length > 0);
  assert.ok(recentDate);
  assert.doesNotMatch(textOf(recentDate), /Invalid Date|—/);
  view.unmount();
});
