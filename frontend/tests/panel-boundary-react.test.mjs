import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://panel-test.invalid',
  virtualConsole: new VirtualConsole()
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.IS_REACT_ACT_ENVIRONMENT = false;

const React = require('react');
const { createRoot } = require('react-dom/client');
const ts = require('typescript');
const previousConsoleError = console.error;

const source = readFileSync(new URL('../src/components/PanelBoundary.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React }
}).outputText;
const panelModule = { exports: {} };
new Function('require', 'module', 'exports', 'React', compiled)(
  id => id === 'react' ? React : id === './LoadingState'
    ? { LoadingState: () => React.createElement('span', null, 'loading') }
    : require(id),
  panelModule,
  panelModule.exports,
  React
);
const { PanelBoundary, RetryablePanel } = panelModule.exports;

after(() => {
  console.error = previousConsoleError;
  dom.window.close();
});

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('Timed out waiting for the panel state');
}

function createPanelFixture({ rejectFirst = false } = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let shouldReject = rejectFirst;
  let loaderCalls = 0;

  function LoadedPanel() {
    const [count, setCount] = React.useState(0);
    return React.createElement('button', {
      id: 'loaded-panel',
      onClick: () => setCount(value => value + 1)
    }, `Loaded ${count}`);
  }

  const loader = () => {
    loaderCalls++;
    return new Promise((resolve, reject) => setTimeout(() => {
      if (shouldReject) reject(new Error('Synthetic chunk unavailable'));
      else resolve({ default: LoadedPanel });
    }, 5));
  };

  function Fixture({ tick = 0 } = {}) {
    return React.createElement('div', null,
      React.createElement('input', { id: 'composer-draft', defaultValue: '' }),
      React.createElement('span', { id: 'parent-tick' }, `Tick ${tick}`),
      React.createElement(PanelBoundary, {
        inline: true,
        title: 'Apps',
        onClose() {}
      }, React.createElement(RetryablePanel, { loader, componentProps: {} }))
    );
  }

  return {
    container,
    root,
    Fixture,
    setShouldReject(value) { shouldReject = value; },
    get loaderCalls() { return loaderCalls; }
  };
}

test('a successful async panel load runs once and preserves state across parent rerenders', async () => {
  const fixture = createPanelFixture();
  try {
    fixture.root.render(React.createElement(fixture.Fixture));
    await waitFor(() => fixture.container.querySelector('#loaded-panel'));

    const draft = fixture.container.querySelector('#composer-draft');
    draft.value = 'keep this draft';
    assert.equal(fixture.loaderCalls, 1);
    fixture.container.querySelector('#loaded-panel').click();
    await waitFor(() => fixture.container.querySelector('#loaded-panel')?.textContent === 'Loaded 1');

    fixture.root.render(React.createElement(fixture.Fixture, { tick: 1 }));
    await waitFor(() => fixture.container.querySelector('#parent-tick')?.textContent === 'Tick 1');
    assert.equal(fixture.container.querySelector('#loaded-panel')?.textContent, 'Loaded 1');
    assert.equal(fixture.container.querySelector('#composer-draft'), draft);
    assert.equal(draft.value, 'keep this draft');
    assert.equal(fixture.loaderCalls, 1);
  } finally {
    fixture.root.unmount();
    fixture.container.remove();
  }
});

test('a rejected async panel shows Retry, reloads once, and preserves surrounding state', async () => {
  const fixture = createPanelFixture({ rejectFirst: true });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    fixture.root.render(React.createElement(fixture.Fixture));
    await waitFor(() => fixture.container.querySelector('[role="alert"]'));
    const draft = fixture.container.querySelector('#composer-draft');
    draft.value = 'keep this draft';
    assert.equal(fixture.loaderCalls, 1);
    assert.match(fixture.container.textContent, /couldn’t load/);

    fixture.setShouldReject(false);
    [...fixture.container.querySelectorAll('button')].find(button => button.textContent === 'Try again')?.click();
    await waitFor(() => fixture.container.querySelector('#loaded-panel'));
    assert.equal(fixture.loaderCalls, 2);
    assert.equal(fixture.container.querySelector('#composer-draft'), draft);
    assert.equal(draft.value, 'keep this draft');

    fixture.container.querySelector('#loaded-panel').click();
    await waitFor(() => fixture.container.querySelector('#loaded-panel')?.textContent === 'Loaded 1');
    fixture.root.render(React.createElement(fixture.Fixture, { tick: 1 }));
    await waitFor(() => fixture.container.querySelector('#parent-tick')?.textContent === 'Tick 1');
    assert.equal(fixture.container.querySelector('#loaded-panel')?.textContent, 'Loaded 1');
    assert.equal(fixture.loaderCalls, 2);
  } finally {
    fixture.root.unmount();
    fixture.container.remove();
    console.error = originalConsoleError;
  }
});
