import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environment, renderer, load, find, textOf } from './support/component-harness.mjs';

test('Cipher only marks a sequence sent after a connected sender succeeds', async () => {
  const env = environment(), view = renderer(env);
  const lead = {
    id: 'lead-1', company: { name: 'Acme', ticker: 'ACME', domain: 'acme.example', hq: 'New York, NY' },
    signals: [], score: 88, tier: 'Hot', why: 'A strong buying signal',
    buyer: { persona: 'CFO', linkedin: 'https://linkedin.example/acme', apollo: 'https://apollo.example/acme' },
    email: { subject: 'A better workflow', body: 'A short introduction.' },
    sequence: [{ day: 0, channel: 'Email', action: 'Send note', due: '2026-10-25' }, { day: 2, channel: 'LinkedIn', action: 'Follow up', due: '2026-10-27' }],
    stage: 'drafted',
  };
  env.globals.localStorage.setItem('cipher-territory-v2', JSON.stringify({
    marketId: 'fintech', offering: 'Workflow software', persona: 'CFO', senderName: '', tickers: '', webhook: '',
    leads: [lead], steps: [], finishedAt: null,
  }));
  env.globals.fetch = async () => ({ json: async () => ({ serverKey: false }) });

  const markets = load('../src/lib/cipher/markets.ts');
  const engine = load('../src/lib/cipher/engine.ts', { './markets': markets });
  const assistant = load('../src/lib/cipher/assistant.ts', { './engine': engine });
  const react = { ...view.react, useMemo: create => create() };
  const { default: CipherApp } = load('../src/components/cipher/CipherApp.tsx', {
    react,
    '../../lib/cipher/markets': markets,
    './BinaryLens': { __esModule: true, default: 'binary-lens' },
    './ProspectBrain': { __esModule: true, default: 'prospect-brain' },
    './CipherIntro': { __esModule: true, default: 'cipher-intro' },
    '../../lib/cipher/assistant': assistant,
    '../../lib/cipher/engine': engine,
  }, { ...env.globals, React: react.default });

  view.mount(() => CipherApp());
  const start = find(view.tree, node => node.type === 'button' && textOf(node).startsWith('Start 1 hot sequence'));
  start.props.onClick();
  await view.flush();
  assert.equal(JSON.parse(env.globals.localStorage.getItem('cipher-territory-v2')).leads[0].stage, 'drafted');
  assert.ok(find(view.tree, node => node.props?.id === 'cx-setup'));

  find(view.tree, node => node.type === 'button' && node.props.role === 'tab' && textOf(node) === 'Accounts').props.onClick();
  view.rerender();
  find(view.tree, node => node.type === 'button' && node.props.role === 'row' && textOf(node).includes('Acme')).props.onClick();
  view.rerender();

  const gmail = find(view.tree, node => node.type === 'a' && node.props.href?.startsWith('https://mail.google.com/'));
  assert.equal(gmail.props.onClick, undefined);
  find(view.tree, node => node.type === 'button' && textOf(node) === 'Mark sent').props.onClick();
  await view.flush();

  assert.equal(JSON.parse(env.globals.localStorage.getItem('cipher-territory-v2')).leads[0].stage, 'sent');
  assert.ok(find(view.tree, node => node.type === 'button' && textOf(node) === 'Mark replied'));
  view.unmount();
});
