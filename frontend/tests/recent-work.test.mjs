import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environment, renderer, load, find, textOf } from './support/component-harness.mjs';

test('recent work lists the latest runs and opens the selected conversation', async () => {
  const env = environment(), view = renderer(env), opened = [];
  const runs = [1, 2, 3, 4].map(index => ({
    id: `run-${index}`,
    title: `Task ${index}`,
    status: index === 1 ? 'completed' : 'pending',
    conversation_id: `conversation-${index}`,
    created_at: `2026-10-23T12:0${index}:00`,
  }));
  const { RecentWork } = load('../src/components/cipher/RecentWork.tsx', {
    react: view.react,
    '../LoadingState': { LoadingState: 'loading-state' },
    '../../lib/api': { request: async path => { assert.equal(path, '/workspace/runs'); return runs; } },
    './RecentWork.module.css': {},
  }, { ...env.globals, React: view.react.default });

  view.mount(() => RecentWork({ onOpen: id => opened.push(id) }));
  await view.flush();

  const rows = [];
  const collect = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(collect); return; }
    if (node.type === 'button' && textOf(node).includes('Task ')) rows.push(node);
    collect(node.props?.children);
  };
  collect(view.tree);
  assert.equal(rows.length, 3);
  assert.equal(textOf(rows[0]).includes('Task 1'), true);
  rows[0].props.onClick();
  assert.deepEqual(opened, ['conversation-1']);
});
