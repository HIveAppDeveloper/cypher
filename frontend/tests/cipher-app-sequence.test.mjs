import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environment, renderer, load, storage, find, textOf, button } from './support/component-harness.mjs';

const lead = {
  id: 'SYN',
  company: { name: 'Synthetic Systems', ticker: 'SYN', domain: 'synthetic.example', hq: 'New York, NY' },
  signals: [], score: 82, tier: 'Hot', why: 'A synthetic signal for the test.',
  buyer: { persona: 'VP of Sales', linkedin: 'https://example.test/linkedin', apollo: 'https://example.test/apollo' },
  email: { subject: 'A useful idea for Synthetic Systems', body: 'Hello from Cypher.' },
  sequence: [
    { day: 0, channel: 'Email', action: 'Intro', due: '2026-10-25' },
    { day: 2, channel: 'LinkedIn', action: 'Connect', due: '2026-10-27' },
  ],
  stage: 'drafted',
};

const intel = {
  dealSize: '$10K–$20K', seats: 10, window: '30–90 days', confidence: 'Low',
  fit: ['Hiring', 'Raising', 'Spending', 'Momentum'].map(label => ({ label, points: 0, max: 10 })),
  committee: [], play: { name: 'Stay close', talkTrack: [], objections: [] },
  channel: 'Email first', timing: 'Tue–Thu mornings',
};

function mountApp({ webhook = '' } = {}) {
  const env = environment();
  env.globals.localStorage = storage({
    'cipher-territory-v2': JSON.stringify({
      marketId: 'test-market', offering: 'Simple outbound', persona: 'VP of Sales', senderName: 'Alex',
      tickers: '', webhook, leads: [lead], steps: [], finishedAt: null,
    }),
  });
  const dispatch = [];
  env.globals.fetch = async (url, options = {}) => {
    if (url === '/api/cipher/ai') return { json: async () => ({ serverKey: false }) };
    if (url === '/api/cipher/dispatch') {
      dispatch.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ ok: true }) };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const view = renderer(env);
  const imports = {
    react: { ...view.react, useMemo: callback => callback() },
    '../../lib/cipher/markets': { MARKETS: [{ id: 'test-market', label: 'Test market', companies: [] }], PERSONAS: ['VP of Sales'] },
    './BinaryLens': { __esModule: true, default: 'binary-lens' },
    './ProspectBrain': { __esModule: true, default: 'prospect-brain' },
    './CipherIntro': { __esModule: true, default: 'cipher-intro' },
    '../../lib/cipher/assistant': { GREETING: 'Hello.', SUGGESTIONS: [], localReply: () => null },
    '../../lib/cipher/engine': {
      SIGNAL_MAX: { hiring: 40, raising: 25, spending: 18, news: 17 },
      accountIntel: () => intel,
      leadsToCsv: () => '',
    },
  };
  const { default: CipherApp } = load('../src/components/cipher/CipherApp.tsx', imports, { ...env.globals, React: view.react.default });
  view.mount(() => CipherApp());
  return { env, view, dispatch };
}

async function openLead(view) {
  await view.flush();
  button(view.tree, 'Accounts').props.onClick();
  await view.flush();
  const row = find(view.tree, node => node.type === 'button' && node.props?.role === 'row' && node.props?.className?.includes('cx-row') && node.props.className !== 'cx-row cx-th');
  assert.ok(row, 'the saved account row is available');
  row.props.onClick();
  await view.flush();
  const dialog = find(view.tree, node => node.type === 'article' && node.props?.role === 'dialog');
  assert.ok(dialog, 'the account details are open');
  return dialog;
}

function stageText(view) {
  return textOf(find(view.tree, node => node.props?.className?.startsWith('cx-stage')));
}

test('opening a Gmail draft does not mark the lead as sent', async () => {
  const { view, dispatch } = mountApp();
  const dialog = await openLead(view);
  const draft = find(dialog, node => node.type === 'a' && textOf(node) === 'Open draft in Gmail');
  assert.ok(draft.props.href.includes('mail.google.com'));
  draft.props.onClick();
  await view.flush();
  assert.equal(stageText(view), 'Ready to send');
  assert.match(textOf(view.tree), /Gmail draft opened. Mark it as sent after you send it./);
  assert.equal(dispatch.length, 0);
  view.unmount();
});

test('manual send has an explicit Mark as sent action', async () => {
  const { view } = mountApp();
  const dialog = await openLead(view);
  button(dialog, 'Mark as sent').props.onClick();
  await view.flush();
  assert.equal(stageText(view), 'In sequence');
  assert.match(textOf(view.tree), /Synthetic Systems moved to In sequence/);
  view.unmount();
});

test('a sequence without a configured sending tool stays unsent and opens Setup', async () => {
  const { view, dispatch } = mountApp();
  const dialog = await openLead(view);
  button(dialog, 'Connect sending tool').props.onClick();
  await view.flush();
  assert.equal(stageText(view), 'Ready to send');
  assert.ok(find(view.tree, node => node.props?.id === 'cx-setup'));
  assert.match(textOf(view.tree), /Add a sending webhook in Setup to start a sequence\./);
  assert.equal(dispatch.length, 0);
  view.unmount();
});
