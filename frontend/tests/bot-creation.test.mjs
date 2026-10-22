import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';

// Exercise the real component handlers with controlled hooks. Native dialog,
// focus, layout and browser auth are deliberately outside this simulation.
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
    useState: initial => { const position = slot(initial); return [values[position], next => { values[position] = typeof next === 'function' ? next(values[position]) : next; }]; },
    useRef: initial => values[slot({ current: initial })],
    useEffect: () => {},
  };
  return { react: { __esModule: true, default: react, ...react }, render: fn => { index = 0; return fn(); } };
}

function load(path, imports = {}, globals = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.React, esModuleInterop: true,
  } }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, process: { env: {} }, crypto: webcrypto, AbortSignal, ...globals,
    require: name => { if (!(name in imports)) throw new Error('Unexpected import: ' + name); return imports[name]; },
  });
  return exports;
}

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return undefined;
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  return predicate(tree) ? tree : find(tree.props?.children, predicate);
}

function creator(onCreate, onClose = () => {}) {
  const runtime = hooks();
  const { BotCreator } = load('../src/components/BotCreator.tsx', {
    react: runtime.react, './GlassSelect': { GlassSelect: 'select' }, './ModelControls': { ModelControls: 'model-controls' },
    '../lib/presets': load('../src/lib/presets.ts'),
  });
  return () => runtime.render(() => BotCreator({ onCreate, onClose }));
}

test('double submission and a lost creation response recover one request and preserve the draft', async () => {
  const calls = [];
  let rejectFirst;
  let closed = 0;
  const render = creator((body, requestId) => {
    calls.push({ body, requestId });
    return calls.length === 1 ? new Promise((_, reject) => { rejectFirst = reject; }) : Promise.resolve({ id: 'created-agent' });
  }, () => closed++);
  let tree = render();
  find(tree, node => node.props?.id === 'bot-name').props.onChange({ target: { value: 'My researcher' } });
  find(tree, node => node.props?.id === 'bot-prompt').props.onChange({ target: { value: 'Keep my research instructions.' } });
  tree = render();
  const submit = find(tree, node => node.type === 'form').props.onSubmit;
  const pending = submit({ preventDefault() {} });
  await submit({ preventDefault() {} });
  assert.equal(calls.length, 1);
  find(tree, node => node.type === 'dialog').props.onCancel({ preventDefault() {} });
  assert.equal(closed, 0);
  rejectFirst(new Error('Connection interrupted.'));
  await pending;
  tree = render();
  assert.equal(find(tree, node => node.props?.id === 'bot-name').props.value, 'My researcher');
  assert.equal(find(tree, node => node.props?.id === 'bot-prompt').props.value, 'Keep my research instructions.');
  assert.ok(find(tree, node => node.props?.role === 'alert'));
  await find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].requestId, calls[1].requestId);
  assert.match(calls[0].requestId, /^[0-9a-f-]{36}$/);
  assert.equal(closed, 1);
});

test('blank instructions keep the dialog open and never call creation', async () => {
  let calls = 0;
  const render = creator(async () => { calls++; });
  find(render(), node => node.props?.id === 'bot-prompt').props.onChange({ target: { value: '   \n' } });
  await find(render(), node => node.type === 'form').props.onSubmit({ preventDefault() {} });
  assert.equal(calls, 0);
  assert.ok(find(render(), node => node.props?.role === 'alert'));
});

test('API creation serializes the retry key and maps the server response', async () => {
  const requests = [];
  const { api } = load('../src/lib/api.ts', { './conversations': {} }, {
    fetch: async (url, options) => {
      requests.push({ url, ...options });
      return { ok: true, json: async () => ({ id: 'agent-id', name: 'Agent', role: 'Researcher', llm_provider: 'openai', llm_model: 'test-model', tools_enabled: ['none'], system_prompt: 'Help.' }) };
    },
  });
  const bot = await api.createBot({ role: 'Researcher', systemPrompt: 'Help.' }, '11111111-1111-4111-8111-111111111111');
  assert.equal(requests[0].url, '/api/bots');
  assert.equal(JSON.parse(requests[0].body).client_request_id, '11111111-1111-4111-8111-111111111111');
  assert.equal(bot.llmModel, 'test-model');
});

test('a recovered server response does not duplicate an agent in local state', async () => {
  const runtime = hooks();
  const { useBots } = load('../src/hooks/useBots.ts', {
    react: runtime.react, '../lib/modelPolicy': {}, '../lib/api': { api: { createBot: async () => ({ id: 'agent-id', name: 'Agent' }) } },
  }, { localStorage: { setItem() {} } });
  const render = () => runtime.render(useBots);
  await render().createBot({ role: 'Researcher' }, true, 'request-key');
  await render().createBot({ role: 'Researcher' }, true, 'request-key');
  assert.equal(render().bots.length, 1);
  assert.equal(render().selectedBot.id, 'agent-id');
});
