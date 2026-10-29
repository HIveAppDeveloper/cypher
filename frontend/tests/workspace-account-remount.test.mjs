import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { environment, load } from './support/component-harness.mjs';

function WorkspaceProbe({ accountId }) {
  const [mountedAccount] = React.useState(accountId);
  return React.createElement('output', {
    'data-account': accountId,
    'data-mounted-account': mountedAccount,
  }, mountedAccount);
}

function loadRoutePage(route, accountId) {
  const env = environment();
  const globals = { ...env.globals, React, URL, URLSearchParams };
  const authImport = route === 'root' ? '../lib/auth-server' : '../../lib/auth-server';
  const pathImport = route === 'root' ? '../lib/canonical-app' : '../../lib/canonical-app';
  const workspaceImport = route === 'root' ? '../components/WorkspaceApp' : '../../components/WorkspaceApp';
  const imports = {
    'next/headers': { cookies: async () => ({ get: () => ({ value: 'fixture-session' }) }) },
    'next/navigation': { redirect: path => { throw new Error(`unexpected redirect: ${path}`); } },
    [authImport]: { readSignedPayload: () => ({ sub: accountId, email: `${accountId}@example.test` }) },
    [pathImport]: { internalPathWithSearch: path => path },
    [workspaceImport]: { __esModule: true, default: WorkspaceProbe },
  };
  if (route === 'root') {
    imports['../components/PublicDocument'] = { __esModule: true, default: 'public-document' };
    imports['../lib/public-metadata'] = { publicMetadata: () => ({}) };
  } else {
    imports['../cipher/cipher.css'] = {};
  }
  const path = route === 'root' ? '../src/app/page.tsx' : '../src/app/workspace/page.tsx';
  const page = load(path, imports, { ...globals, process: { env: { REQUIRE_USER_AUTH: 'true' } } });
  return page.default({ searchParams: Promise.resolve({}) });
}

test('both core workspace routes remount client state when the authenticated account changes', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>');
  const previous = new Map();
  const values = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }

  const root = createRoot(dom.window.document.getElementById('root'));
  try {
    for (const route of ['root', 'workspace']) {
      const first = await loadRoutePage(route, 'account-1');
      const second = await loadRoutePage(route, 'account-2');
      assert.equal(first.key, 'account-1');
      assert.equal(second.key, 'account-2');
      await act(async () => root.render(first));
      assert.equal(dom.window.document.querySelector('output')?.dataset.mountedAccount, 'account-1');
      await act(async () => root.render(second));
      const output = dom.window.document.querySelector('output');
      assert.equal(output?.dataset.account, 'account-2');
      assert.equal(output?.dataset.mountedAccount, 'account-2', `${route} discards account-1 client state`);
    }
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const name of Object.keys(values)) {
      const descriptor = previous.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
