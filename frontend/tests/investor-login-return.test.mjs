import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environment, load } from './support/component-harness.mjs';

function loadPage({ session, redirect }) {
  const env = environment();
  const globals = { ...env.globals, URL, URLSearchParams, React: { createElement: (type, props) => ({ type, props }) } };
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
