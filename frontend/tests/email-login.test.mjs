import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function fixture(fetch) {
  const values = [];
  let index = 0;
  let now = 100_000;
  const slot = initial => { const position = index++; if(position >= values.length) values.push(initial); return position; };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: initial => { const position = slot(initial); return [values[position], next => { values[position] = typeof next === 'function' ? next(values[position]) : next; }]; },
    useRef: initial => values[slot({ current: initial })],
  };
  class FixtureDate extends Date { static now() { return now; } }
  const exports = {};
  const source = readFileSync(new URL('../src/components/EmailLoginForm.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  runInNewContext(compiled, { exports, React: react, Date: FixtureDate, AbortSignal, Error, fetch, require: name => { assert.equal(name, 'react'); return react; } });
  return { render: () => { index = 0; return exports.EmailLoginForm({}); }, advance: ms => { now += ms; } };
}

function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return undefined;
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  return predicate(tree) ? tree : find(tree.props?.children, predicate);
}
function button(tree, label) { return find(tree, node => node.type === 'button' && node.props.children.includes(label)); }
const flush = () => new Promise(resolve => setImmediate(resolve));

test('resend waits through the backend 60-second window and shows the remaining time', async () => {
  const calls = [];
  const app = fixture(async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true, json: async () => ({ sent: true }) }; });
  find(app.render(), node => node.props?.id === 'workspace-email').props.onChange({ target: { value: ' owner@example.test ' } });
  app.render().props.onSubmit({ preventDefault() {} });
  await flush();
  app.advance(31_000);
  button(app.render(), 'Resend link').props.onClick();
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(find(app.render(), node => node.props?.role === 'alert').props.children.join(''), 'Wait 29 seconds before requesting another link.');
  app.advance(31_000);
  button(app.render(), 'Resend link').props.onClick();
  await flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.email, 'owner@example.test');
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
