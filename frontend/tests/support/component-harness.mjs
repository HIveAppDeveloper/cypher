import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
function storage(initial = {}) {
  const entries = new Map(Object.entries(initial));
  return { getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)), removeItem: key => entries.delete(key) };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function clock() {
  let now = 0, sequence = 0;
  const timers = new Map();
  return { get now() { return now; }, get pending() { return timers.size; },
    setTimeout(fn, delay = 0) { const id = ++sequence; timers.set(id, { fn, at: now + Math.max(0, delay) }); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(ms) {
      const target = now + ms;
      for (let count = 0; count < 1000; count++) {
        const next = [...timers].filter(([, item]) => item.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) { now = target; return; }
        timers.delete(next[0]); now = next[1].at; next[1].fn();
      }
      throw new Error('Unexpected timer loop in fixture');
    } };
}
function environment(session = storage()) {
  const time = clock();
  const nodes = new Map();
  const document = Object.assign(new EventTarget(), { hidden: false, body: {},
    documentElement: { dataset: {} }, getElementById: id => nodes.get(id) ?? null });
  const window = Object.assign(new EventTarget(), { matchMedia: () => ({ matches: false }) });
  class FixtureDate extends Date { constructor(...args) { super(...(args.length ? args : [time.now])); } static now() { return time.now; } }
  function element(props = {}) {
    return { open: false, style: {}, scrollHeight: 1000, scrollTop: 1000, clientHeight: 500,
      focus() {}, contains: () => false, querySelector: () => null, scrollIntoView() {},
      showModal() { this.open = true; }, close() { this.open = false; },
      scrollTo(options) { this.scrollTop = options.top; }, ...props };
  }
  return { time, nodes, document, window, element, globals: { document, window, Event, AbortController,
    sessionStorage: session, localStorage: storage(), Date: FixtureDate,
    setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
    HTMLElement: class {}, process: { env: {} } } };
}
function renderer(env) {
  const slots = [];
  let cursor = 0, dirty = true, mounted = true, component, tree, pendingEffects = [];
  let updatesAfterUnmount = 0;
  function slot(kind, initial) {
    const index = cursor++;
    if (!slots[index]) slots[index] = { kind, ...initial };
    assert.equal(slots[index].kind, kind, 'hook order is stable');
    return slots[index];
  }
  const react = {
    Fragment: 'fragment',
    createElement(type, props, ...children) {
      const node = { type, props: { ...props, children } };
      if (typeof type === 'string') {
        if (props?.ref && !props.ref.current) props.ref.current = env.element();
        if (props?.id) env.nodes.set(props.id, props.ref?.current || env.element());
      }
      return node;
    },
    useState(initial) {
      const current = slot('state', {});
      if (!('value' in current)) current.value = typeof initial === 'function' ? initial() : initial;
      return [current.value, next => {
        if (!mounted) { updatesAfterUnmount++; return; }
        const value = typeof next === 'function' ? next(current.value) : next;
        if (!Object.is(value, current.value)) { current.value = value; dirty = true; }
      }];
    },
    useRef(initial) { return slot('ref', { value: { current: initial } }).value; },
    useCallback(callback, deps) {
      const current = slot('callback', {});
      if (!current.deps || !deps || deps.length !== current.deps.length || deps.some((value, i) => !Object.is(value, current.deps[i]))) {
        current.deps = deps; current.value = callback;
      }
      return current.value;
    },
    useEffect(create, deps) {
      const current = slot('effect', {});
      if (!current.deps || !deps || deps.length !== current.deps.length || deps.some((value, i) => !Object.is(value, current.deps[i]))) {
        current.deps = deps; pendingEffects.push({ current, create });
      }
    },
  };
  function render() {
    for (let turn = 0; dirty && turn < 30; turn++) {
      dirty = false; cursor = 0; tree = component();
      const effects = pendingEffects; pendingEffects = [];
      for (const { current, create } of effects) { current.cleanup?.(); current.cleanup = create(); }
    }
    assert.equal(dirty, false, 'component effects settle');
    return tree;
  }
  return { react: { __esModule: true, default: react, ...react },
    mount(fn) { component = fn; return render(); }, render,
    rerender() { dirty = true; return render(); },
    async flush() { for (let i = 0; i < 12; i++) { await Promise.resolve(); if (mounted) render(); } return tree; },
    get tree() { return tree; }, get updatesAfterUnmount() { return updatesAfterUnmount; },
    unmount() { mounted = false; for (const current of slots) current.cleanup?.(); } };
}
function load(path, imports = {}, globals = {}) {
  const source = readFileSync(new URL('../'+path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  const exports = {};
  runInNewContext(compiled, { exports, Error, Map, ...globals,
    require: name => {
      if (name === '../lib/canonical-app') return { CANONICAL_APP_ORIGIN: 'https://app.example', isOffCanonicalHost: () => false };
      if (name === '../lib/speech') return { createSpeechRecognition: () => null, describeSpeechError: () => 'Speech input unavailable.', hasSpeechRecognition: () => false };
      if (!(name in imports)) throw new Error('Unexpected import: ' + name);
      return imports[name];
    } });
  return exports;
}
function find(node, predicate) {
  if (!node || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  return predicate(node) ? node : find(node.props?.children, predicate);
}
function textOf(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.props?.children);
}
const button = (tree, label) => find(tree, node => node.type === 'button' && textOf(node) === label);
const field = (tree, id) => find(tree, node => node.props?.id === id);
const submit = tree => find(tree, node => node.type === 'form').props.onSubmit({ preventDefault() {} });

export {storage,deferred,environment,renderer,load,find,textOf,button,field,submit};
