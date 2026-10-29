import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environment, renderer, load, deferred, find, button, textOf } from './support/component-harness.mjs';

async function mountSharedFiles(request) {
  const env = environment();
  const view = renderer(env);
  const { ComputerPanel } = load('../src/components/ComputerPanel.tsx', {
    react: view.react,
    './LoadingState': { LoadingState: 'loading-state' },
    './PanelState': { PanelState: 'panel-state', ActionStatus: 'action-status', panelClassName: 'panel' },
    './GlassSelect': { GlassSelect: 'select' },
    '../lib/api': { api: {}, request },
  }, { ...env.globals, React: view.react.default });
  view.mount(() => ComputerPanel({ bots: [], onClose() {} }));
  button(view.tree, 'Shared files').props.onClick();
  await view.flush();
  return view;
}

const fileInput = tree => find(tree, node => node.type === 'input' && node.props?.type === 'file');
const contentField = tree => find(tree, node => node.type === 'textarea');
const nameField = tree => find(tree, node => node.type === 'input' && node.props?.value === 'notes.txt');

test('a rejected File.text can be retried with the same file after the picker resets', async () => {
  let attempts = 0;
  const file = {
    name: 'notes.txt',
    size: 12,
    text: () => ++attempts === 1 ? Promise.reject(new Error('Synthetic file read failure')) : Promise.resolve('Recovered contents'),
  };
  const request = async path => {
    if (path === '/computer/shared/files') return [];
    throw new Error(`Unexpected request: ${path}`);
  };
  const view = await mountSharedFiles(request);

  fileInput(view.tree).props.onChange({ currentTarget: { files: [file] } });
  await view.flush();
  assert.match(textOf(view.tree), /Could not read this file/);
  assert.equal(fileInput(view.tree).props.ref.current.value, '', 'the input resets after a failed read');

  fileInput(view.tree).props.onChange({ currentTarget: { files: [file] } });
  await view.flush();
  assert.equal(attempts, 2, 'the same file can be selected and read again');
  assert.equal(contentField(view.tree).props.value, 'Recovered contents');
  assert.equal(nameField(view.tree).props.value, 'notes.txt');
  assert.doesNotMatch(textOf(view.tree), /Could not read this file/);
  assert.equal(fileInput(view.tree).props.ref.current.value, '', 'the input resets after a successful read too');
  view.unmount();
});

test('a slower earlier File.text result cannot overwrite the most recently selected file', async () => {
  const olderRead = deferred();
  const newerRead = deferred();
  const olderFile = { name: 'older.txt', size: 5, text: () => olderRead.promise };
  const newerFile = { name: 'notes.txt', size: 5, text: () => newerRead.promise };
  const request = async path => {
    if (path === '/computer/shared/files') return [];
    throw new Error(`Unexpected request: ${path}`);
  };
  const view = await mountSharedFiles(request);
  const input = fileInput(view.tree);

  input.props.onChange({ currentTarget: { files: [olderFile] } });
  input.props.onChange({ currentTarget: { files: [newerFile] } });
  newerRead.resolve('Newer contents');
  await view.flush();
  assert.equal(contentField(view.tree).props.value, 'Newer contents');
  assert.equal(nameField(view.tree).props.value, 'notes.txt');

  olderRead.resolve('Stale contents');
  await view.flush();
  assert.equal(contentField(view.tree).props.value, 'Newer contents');
  assert.equal(nameField(view.tree).props.value, 'notes.txt');
  assert.doesNotMatch(textOf(view.tree), /Could not read this file/);
  view.unmount();
});

test('a late File.text completion after unmount does not update the panel', async () => {
  const lateRead = deferred();
  const request = async path => {
    if (path === '/computer/shared/files') return [];
    throw new Error(`Unexpected request: ${path}`);
  };
  const view = await mountSharedFiles(request);
  fileInput(view.tree).props.onChange({ currentTarget: { files: [{ name: 'notes.txt', size: 5, text: () => lateRead.promise }] } });
  await view.flush();

  view.unmount();
  lateRead.resolve('Too late');
  await view.flush();
  assert.equal(view.updatesAfterUnmount, 0);
});
