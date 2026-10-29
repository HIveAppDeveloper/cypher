import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environment, load } from './support/component-harness.mjs';

function loadPage({ session, redirect }) {
  const env = environment();
  const globals = { ...env.globals, URL, URLSearchParams, React: { createElement: (type, props) => { const { key = null, ...elementProps } = props ?? {}; return { type, key, props: elementProps }; } } };
  const { internalPathWithSearch } = load('../src/lib/canonical-app.ts', {}, globals);
  return load('../src/app/prospecting/investors/page.tsx', {
    'next/headers': { cookies: async () => ({ get: () => ({ value: 'fixture-session' }) }) },
    'next/navigation': { redirect },
    '../../../lib/auth-server': { readSignedPayload: () => session },
    '../../../lib/canonical-app': { internalPathWithSearch },
    '../../../components/VcProspectingWorkspace': { __esModule: true, default: 'vc-workspace' },
    '../../cipher/cipher.css': {},
  }, { ...globals, process: { env: { REQUIRE_USER_AUTH: 'true' } } });
}

test('guest sign-in return preserves the investor page query and authenticated users reach the workspace', async () => {
  let redirectTo = '';
  const guest = loadPage({ session: null, redirect: path => { redirectTo = path; throw new Error('redirected'); } });
  await assert.rejects(
    guest.default({ searchParams: Promise.resolve({ tab: 'saved', source: ['sec', 'manual'] }) }),
    /redirected/
  );
  assert.equal(redirectTo, '/login?returnTo=%2Fprospecting%2Finvestors%3Ftab%3Dsaved%26source%3Dsec%26source%3Dmanual');

  const signedIn = loadPage({ session: { sub: 'account-1' }, redirect: () => { throw new Error('unexpected redirect'); } });
  const page = await signedIn.default({ searchParams: Promise.resolve({ tab: 'saved' }) });
  assert.equal(page.type, 'vc-workspace');
  assert.equal(page.props.accountId, 'account-1');
});

test('the investor workspace remount key changes with the signed-in account', async () => {
  const first = loadPage({ session: { sub: 'account-1' }, redirect: () => { throw new Error('unexpected redirect'); } });
  const second = loadPage({ session: { sub: 'account-2' }, redirect: () => { throw new Error('unexpected redirect'); } });
  const firstPage = await first.default({ searchParams: Promise.resolve({}) });
  const secondPage = await second.default({ searchParams: Promise.resolve({}) });

  assert.equal(firstPage.key, 'account-1');
  assert.equal(secondPage.key, 'account-2');
  assert.notEqual(firstPage.key, secondPage.key, 'React discards the old workspace state when the account changes');
  assert.equal(firstPage.props.accountId, 'account-1');
  assert.equal(secondPage.props.accountId, 'account-2');
});
