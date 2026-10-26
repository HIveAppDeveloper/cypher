import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const ts = require('typescript');

function load(path, imports = {}, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.React, esModuleInterop: true,
  } }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, React, ...globals,
    require: name => {
      if (!(name in imports)) throw new Error('Unexpected import: ' + name);
      return imports[name];
    },
  });
  return exports;
}

const React = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  useId: () => 'model-controls-test',
};

function find(node, predicate) {
  if (!node || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  return predicate(node) ? node : find(node.props?.children, predicate);
}

const catalog = load('../src/lib/nicrronCatalog.ts');
const presets = load('../src/lib/presets.ts');

test('model-choice hook reads the sanitized backend catalog without sending a key', async () => {
  const states = [];
  let cursor = 0;
  let mounted = false;
  let request;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = initial;
      return [states[index], next => { states[index] = typeof next === 'function' ? next(states[index]) : next; }];
    },
    useMemo: factory => factory(),
    useEffect(effect) { if (!mounted) { mounted = true; effect(); } },
  };
  const payload = { configured: true, status: 'ready', models: [
    { id: 'anthropic/claude-sonnet-5-5', name: 'Claude Sonnet 5.5', modality: 'chat' },
  ] };
  const { useModelChoices } = load('../src/hooks/useModelChoices.ts', {
    'react': react,
    '../lib/presets': presets,
    '../lib/nicrronCatalog': catalog,
  }, {
    AbortController,
    fetch: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => payload };
    },
  });
  const render = () => { cursor = 0; return useModelChoices(); };
  render();
  assert.equal(request.url, '/api/runtime/model-catalog/nicrron');
  assert.equal(request.options.cache, 'no-store');
  assert.ok(!JSON.stringify(request.options).includes('NICRRON_API_KEY'));
  await new Promise(resolve => setImmediate(resolve));
  const result = render();
  assert.equal(result.nicrronStatus, 'ready');
  assert.ok(result.choices.some(choice => choice.provider === 'nicrron' && choice.model === 'anthropic/claude-sonnet-5-5'));
});

test('catalog choices include only safe, active Nicrron chat models', () => {
  const choices = catalog.choicesFromNicrronCatalog({
    configured: true,
    status: 'ready',
    models: [
      { id: 'anthropic/claude-sonnet-5-5', name: 'Claude Sonnet 5.5', description: 'Text', modality: 'chat' },
      { id: 'openai/gpt-image-2', name: 'Image', modality: 'image' },
      { id: 'vendor/retired', name: 'Retired', modality: 'chat', deprecated: true },
      { id: '../../bad', name: 'Bad', modality: 'chat' },
    ],
  });
  assert.equal(choices.length, 1);
  assert.equal(choices[0].provider, 'nicrron');
  assert.equal(choices[0].model, 'anthropic/claude-sonnet-5-5');
  assert.equal(choices[0].label, 'Nicrron · Claude Sonnet 5.5');
  assert.equal(catalog.choicesFromNicrronCatalog({ configured: false, status: 'not_configured', models: [] }).length, 0);
});

test('model policy preserves catalog-shaped Nicrron selections and rejects malformed IDs', () => {
  const { modelPolicy } = load('../src/lib/modelPolicy.ts', {
    './presets': presets,
    './nicrronCatalog': catalog,
  });
  const saved = modelPolicy({ provider: 'nicrron', model: 'anthropic/claude-sonnet-5-5' });
  assert.equal(saved.provider, 'nicrron');
  assert.equal(saved.model, 'anthropic/claude-sonnet-5-5');
  const rejected = modelPolicy({ provider: 'nicrron', model: '../../bad' });
  assert.equal(rejected.provider, 'openai');
  assert.equal(rejected.model, 'gpt-6.1-sol');
});

test('model controls select a live Nicrron model with its explicit provider ID', () => {
  const nicrronChoices = catalog.choicesFromNicrronCatalog({
    configured: true,
    status: 'ready',
    models: [{ id: 'anthropic/claude-sonnet-5-5', name: 'Claude Sonnet 5.5', modality: 'chat' }],
  });
  const { ModelControls } = load('../src/components/ModelControls.tsx', {
    'react': React,
    './GlassSelect': { GlassSelect: 'select' },
    '../hooks/useModelChoices': { useModelChoices: () => ({
      choices: [...presets.MODEL_CHOICES, ...nicrronChoices], nicrronChoices, nicrronStatus: 'ready',
    }) },
  });
  let selected = { provider: 'openai', model: 'gpt-6.1-sol' };
  const render = () => ModelControls({ value: selected, onChange: value => { selected = value; } });
  const tree = render();
  const providerSelect = find(tree, node => node.type === 'select' && node.props.id === 'model-controls-test-provider');
  providerSelect.props.onChange({ target: { value: 'nicrron' } });
  assert.equal(selected.provider, 'nicrron');
  assert.equal(selected.model, 'anthropic/claude-sonnet-5-5');
  const modelSelect = find(render(), node => node.type === 'select' && node.props.id === 'model-controls-test-model');
  assert.ok(find(modelSelect, node => node.props?.value === 'anthropic/claude-sonnet-5-5'));
});

test('model controls preserve an unavailable saved Nicrron model until the user replaces it', () => {
  const nicrronChoices = catalog.choicesFromNicrronCatalog({
    configured: true,
    status: 'ready',
    models: [{ id: 'anthropic/claude-sonnet-5-5', name: 'Claude Sonnet 5.5', modality: 'chat' }],
  });
  const { ModelControls } = load('../src/components/ModelControls.tsx', {
    'react': React,
    './GlassSelect': { GlassSelect: 'select' },
    '../hooks/useModelChoices': { useModelChoices: () => ({
      choices: [...presets.MODEL_CHOICES, ...nicrronChoices], nicrronChoices, nicrronStatus: 'ready',
    }) },
  });
  let selected = { provider: 'nicrron', model: 'anthropic/claude-haiku-4-5' };
  const render = () => ModelControls({ value: selected, onChange: value => { selected = value; } });
  const modelSelect = find(render(), node => node.type === 'select' && node.props.id === 'model-controls-test-model');
  assert.equal(modelSelect.props.value, 'anthropic/claude-haiku-4-5');
  assert.ok(find(modelSelect, node => node.props?.value === 'anthropic/claude-haiku-4-5'
    && node.props?.disabled === true
    && node.props?.children?.join('') === 'anthropic/claude-haiku-4-5 (currently unavailable)'));
  modelSelect.props.onChange({ target: { value: 'anthropic/claude-sonnet-5-5' } });
  assert.equal(selected.provider, 'nicrron');
  assert.equal(selected.model, 'anthropic/claude-sonnet-5-5');
  assert.equal(selected.reasoning_effort, undefined);
});
