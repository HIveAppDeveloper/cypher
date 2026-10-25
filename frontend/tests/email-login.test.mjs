import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function fixture(fetch) {
  const values = [];
  let index = 0;
  let now = 100_000;
  let timerId = 0;
  const timers = new Map();
  let pendingEffects = [];
  const slot = initial => { const position = index++; if(position >= values.length) values.push(initial); return position; };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: initial => { const position = slot(initial); return [values[position], next => { values[position] = typeof next === 'function' ? next(values[position]) : next; }]; },
    useRef: initial => values[slot({ current: initial })],
    useEffect: (create, deps) => {
      const position = slot({ deps: null, cleanup: null });
      const current = values[position];
      if (!current.deps || deps.some((value, i) => !Object.is(value, current.deps[i]))) {
        pendingEffects.push({ current, create, deps });
      }
    },
  };
  class FixtureDate extends Date { static now() { return now; } }
  const exports = {};
  const source = readFileSync(new URL('../src/components/EmailLoginForm.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  const setTimeout = (fn, delay) => { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; };
  const clearTimeout = id => timers.delete(id);
  runInNewContext(compiled, { exports, React: react, Date: FixtureDate, AbortSignal, Error, fetch, setTimeout, clearTimeout, require: name => { assert.equal(name, 'react'); return react; } });
  function render() {
    index = 0;
    const tree = exports.EmailLoginForm({});
    const effects = pendingEffects; pendingEffects = [];
    for (const { current, create, deps } of effects) { current.cleanup?.(); current.deps = deps; current.cleanup = create(); }
    return tree;
  }
  function advance(ms) {
    const target = now + ms;
    for (let count = 0; count < 1000; count++) {
      const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) { now = target; return; }
      timers.delete(next[0]); now = next[1].at; next[1].fn();
    }
    throw new Error('Unexpected timer loop in fixture');
  }
  return { render, advance };
}

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return undefined;
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  return predicate(tree) ? tree : find(tree.props?.children, predicate);
}
function button(tree, label) { return find(tree, node => node.type === 'button' && node.props.children.includes(label)); }
const flush = () => new Promise(resolve => setImmediate(resolve));

test('resend stays disabled through the backend 60-second window', async () => {
  const calls = [];
  const app = fixture(async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ sent: true }) }; });
  find(app.render(), node => node.props?.id === 'workspace-email').props.onChange({ target: { value: ' owner@example.test ' } });
  app.render().props.onSubmit({ preventDefault() {} });
  await flush();
  assert.equal(button(app.render(), 'Resend link').props.disabled, true);
  assert.match(find(app.render(), node => node.props?.className === 'email-login-resend-note').props.children.join(''), /once a minute/);
  app.advance(31_000);
  assert.equal(button(app.render(), 'Resend link').props.disabled, true);
  assert.equal(calls.length, 1);
  app.advance(29_000);
  assert.equal(button(app.render(), 'Resend link').props.disabled, false);
  button(app.render(), 'Resend link').props.onClick();
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.email, 'owner@example.test');
});

test('resending keeps the inbox confirmation visible while the request is pending', async () => {
  let resolveResend;
  let calls = 0;
  const app = fixture(() => {
    if (++calls === 1) return Promise.resolve({ ok: true, json: async () => ({ sent: true }) });
    return new Promise(resolve => { resolveResend = resolve; });
  });
  find(app.render(), node => node.props?.id === 'workspace-email').props.onChange({ target: { value: 'owner@example.test' } });
  app.render().props.onSubmit({ preventDefault() {} });
  await flush();
  app.render();
  app.advance(60_000);
  button(app.render(), 'Resend link').props.onClick();
  const pending = app.render();
  assert.match(find(pending, node => node.type === 'strong').props.children.join(''), /Check your inbox/);
  assert.ok(button(pending, 'Sending new link…'));
  assert.equal(button(pending, 'Sending new link…').props.disabled, true);
  resolveResend({ ok: true, json: async () => ({ sent: true }) });
  await flush();
  assert.match(find(app.render(), node => node.type === 'strong').props.children.join(''), /Check your inbox/);
  assert.equal(button(app.render(), 'Resend link').props.disabled, true);
});

test('pending email submissions coalesce and disable both controls', async () => {
  let resolve;
  let calls = 0;
  const app = fixture(() => { calls++; return new Promise(complete => { resolve = complete; }); });
  find(app.render(), node => node.props?.id === 'workspace-email').props.onChange({ target: { value: 'owner@example.test' } });
  const submit = app.render().props.onSubmit;
  submit({ preventDefault() {} }); submit({ preventDefault() {} });
  assert.equal(calls, 1);
  assert.equal(find(app.render(), node => node.props?.id === 'workspace-email').props.disabled, true);
  assert.equal(button(app.render(), 'Sending sign-in link…').props.disabled, true);
  resolve({ ok: true, json: async () => ({ sent: true }) });
  await flush();
  assert.ok(button(app.render(), 'Resend link'));
});

test('email failure preserves the address and returns to usable controls', async () => {
  const app = fixture(async () => ({ ok: false, json: async () => ({ detail: 'Synthetic delivery unavailable.' }) }));
  find(app.render(), node => node.props?.id === 'workspace-email').props.onChange({ target: { value: 'owner@example.test' } });
  app.render().props.onSubmit({ preventDefault() {} });
  await flush();
  const input = find(app.render(), node => node.props?.id === 'workspace-email');
  assert.equal(input.props.value, 'owner@example.test');
  assert.equal(input.props.disabled, false);
  assert.equal(find(app.render(), node => node.props?.role === 'alert').props.children.join(''), 'Synthetic delivery unavailable.');
});
