import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Drive the component's real selectors and submit handler with controlled
// React hooks. No network, provider, native dialog, or layout is simulated.
function hooks() {
  const values = [];
  let index = 0;
  const slot = initial => {
    const position = index++;
    if (position >= values.length) values.push(initial);
    return position;
  };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: initial => {
      const position = slot(initial);
      return [values[position], next => { values[position] = typeof next === 'function' ? next(values[position]) : next; }];
    },
    useRef: initial => values[slot({ current: initial })],
    useEffect: () => {},
  };
  return { react, render: fn => { index = 0; return fn(); } };
}

function load(path, imports = {}, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.React, esModuleInterop: true,
  } }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, Error, ...globals,
    require: name => { if (!(name in imports)) throw new Error('Unexpected import: ' + name); return imports[name]; },
  });
  return exports;
}

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return undefined;
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  return predicate(tree) ? tree : find(tree.props?.children, predicate);
}

const presets = load('../src/lib/presets.ts');
function quickStart(onStart, initialOptions = { routing: 'auto', provider: 'openai', model: 'gpt-6.1-sol' }, onOpenLounge = async () => {}, onOpenSetup = () => {}) {
  const runtime = hooks();
  let options = initialOptions;
  const { QuickStart } = load('../src/components/QuickStart.tsx', {
    react: runtime.react, './GlassSelect': { GlassSelect: 'select' }, '../lib/presets': presets,
  }, { React: runtime.react, localStorage: { setItem() {} } });
  return () => runtime.render(() => QuickStart({
    options, onOptions: next => { options = next; }, onStart,
    onCreateBot() {}, onCreateRoom() {}, onOpenLounge, onOpenSetup,
  }));
}

const task = tree => find(tree, node => node.props?.id === 'first-task');
const manager = tree => find(tree, node => node.props?.['aria-label'] === 'Manager model');
const submit = tree => find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} });

for (const choice of presets.MODEL_CHOICES) {
  test(`manual ${choice.label} sends its actual provider/model pair`, async () => {
    const calls = [];
    const render = quickStart(async (prompt, options) => { calls.push({ prompt, options }); });
    manager(render()).props.onChange({ target: { value: choice.model } });
    task(render()).props.onChange({ target: { value: 'Synthetic model selection check.' } });
    await submit(render());
    assert.equal(calls.length, 1);
    assert.equal(calls[0].prompt, 'Synthetic model selection check.');
    assert.equal(calls[0].options.routing, 'manual');
    assert.equal(calls[0].options.provider, choice.provider);
    assert.equal(calls[0].options.model, choice.model);
  });
}

test('Auto retains automatic routing with a valid OpenAI Sol base pair', async () => {
  const calls = [];
  const render = quickStart(async (prompt, options) => { calls.push({ prompt, options }); }, {
    routing: 'manual', provider: 'gemini', model: 'gemini-3.8-flash',
  });
  manager(render()).props.onChange({ target: { value: 'auto' } });
  task(render()).props.onChange({ target: { value: 'Synthetic automatic task.' } });
  await submit(render());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.routing, 'auto');
  assert.equal(calls[0].options.provider, 'openai');
  assert.equal(calls[0].options.model, 'gpt-6.1-sol');
});

test('home exposes model setup without leaving the task composer', () => {
  let opened = 0;
  const tree = quickStart(async () => {}, undefined, async () => {}, () => { opened++; })();
  const setup = find(tree, node => node.type === 'button' && node.props.children?.includes('Connect models'));
  assert.ok(setup);
  setup.props.onClick();
  assert.equal(opened, 1);
});

test('same-tick double submission starts once and an interruption retains the task for retry', async () => {
  const calls = [];
  let rejectFirst;
  const render = quickStart((prompt, options) => {
    calls.push({ prompt, options });
    return calls.length === 1 ? new Promise((_, reject) => { rejectFirst = reject; }) : Promise.resolve();
  });
  task(render()).props.onChange({ target: { value: 'Keep this synthetic task after failure.' } });
  const tree = render();
  const first = submit(tree);
  await submit(tree);
  assert.equal(calls.length, 1);
  rejectFirst(new Error('Synthetic connection interruption.'));
  await first;
  const recovered = render();
  assert.equal(task(recovered).props.value, 'Keep this synthetic task after failure.');
  const error = find(recovered, node => node.props?.role === 'alert');
  assert.match(error.props.children.flat().join(''), /Synthetic connection interruption.*Your task is still here/);
  await submit(recovered);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].prompt, calls[1].prompt);
  assert.equal(JSON.stringify(calls[0].options), JSON.stringify(calls[1].options));
});

test('empty tasks never start; Enter submits while Shift+Enter and composition retain native input', async () => {
  let calls = 0;
  const render = quickStart(async () => { calls++; });
  await submit(render());
  assert.equal(calls, 0);
  const key = task(render()).props.onKeyDown;
  let prevented = 0, submitted = 0;
  const event = { key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false },
    preventDefault() { prevented++; }, currentTarget: { form: { requestSubmit() { submitted++; } } } };
  key(event);
  key({ ...event, shiftKey: true });
  key({ ...event, nativeEvent: { isComposing: true } });
  assert.equal(prevented, 1);
  assert.equal(submitted, 1);
});

// The keyboard submit path must honor the existing separate lounge-loading state.
test('opening the lounge keeps keyboard task submission blocked until navigation resolves', async () => {
  let started = 0, release;
  const render = quickStart(async () => { started++; }, undefined, () => new Promise(resolve => { release = resolve; }));
  task(render()).props.onChange({ target: { value: 'Keep task during lounge navigation.' } });
  const button = find(render(), node => node.type === 'button' && node.props.children.includes('Open agent lounge'));
  button.props.onClick();
  await submit(render());
  assert.equal(started, 0);
  release();
  await Promise.resolve();
  await Promise.resolve();
});
