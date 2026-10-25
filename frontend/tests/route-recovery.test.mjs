import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './support/component-harness.mjs';

class RedirectSignal extends Error {
  constructor(location) {
    super('Redirect');
    this.location = location;
  }
}

test('unauthenticated investor page return preserves the subpage and query parameters', async () => {
  const imports = {
    'next/headers': { cookies: async () => ({ get: () => undefined }) },
    'next/navigation': { redirect: location => { throw new RedirectSignal(location); } },
    '../../../lib/auth-server': { readSignedPayload: () => null },
    '../../../lib/canonical-app': load('../src/lib/canonical-app.ts', {}, { URL, URLSearchParams }),
    '../../../components/VcProspectingWorkspace': { __esModule: true, default: 'investor-workspace' },
    '../../cipher/cipher.css': {},
  };
  const { default: InvestorPage } = load('../src/app/prospecting/investors/page.tsx', imports, {
    process: { env: { REQUIRE_USER_AUTH: 'true' } },
  });

  await assert.rejects(
    InvestorPage({ searchParams: Promise.resolve({ tab: 'founders', sector: ['health', 'climate'] }) }),
    error => {
      assert.ok(error instanceof RedirectSignal);
      assert.equal(error.location, '/login?returnTo=%2Fprospecting%2Finvestors%3Ftab%3Dfounders%26sector%3Dhealth%26sector%3Dclimate');
      return true;
    }
  );
});

test('Prospecting workspace remounts at account identity changes to clear private draft state', async () => {
  let account = 'account-A';
  const React = { createElement: (type, props, ...children) => ({ type, props: { ...props, children }, key: props?.key }) };
  const process = { env: { REQUIRE_USER_AUTH: 'false' } };
  const { default: ProspectingPage } = load('../src/app/prospecting/page.tsx', {
    'next/headers': { cookies: async () => ({ get: () => ({ value: account }) }) },
    'next/navigation': { redirect: location => { throw new RedirectSignal(location); } },
    '../../lib/auth-server': { readSignedPayload: value => value ? ({ sub: value, email: 'fixture@example.test' }) : null },
    '../../lib/canonical-app': { internalPathWithSearch: path => path },
    '../../components/ProspectingWorkspace': { __esModule: true, default: 'prospecting-workspace' },
    '../cipher/cipher.css': {},
  }, { process, React });

  const first = await ProspectingPage({ searchParams: Promise.resolve({}) });
  assert.equal(first.key, 'account-A');
  assert.equal(first.props.accountId, 'account-A');

  account = 'account-B';
  const second = await ProspectingPage({ searchParams: Promise.resolve({}) });
  assert.equal(second.key, 'account-B');
  assert.equal(second.props.accountId, 'account-B');
  assert.notEqual(first.key, second.key, 'React must remount the account-scoped workspace and clean up pending A requests');

  account = null;
  const anonymous = await ProspectingPage({ searchParams: Promise.resolve({}) });
  assert.equal(anonymous.key, 'anonymous');
  assert.equal(anonymous.props.accountId, undefined);
});

test('legacy Cipher route keeps saved conversation links when it redirects to the workspace', async () => {
  const { default: CipherPage } = load('../src/app/cipher/page.tsx', {
    'next/navigation': { redirect: location => { throw new RedirectSignal(location); } },
    '../../lib/canonical-app': load('../src/lib/canonical-app.ts', {}, { URL, URLSearchParams }),
  });

  await assert.rejects(
    CipherPage({ searchParams: Promise.resolve({ conversation: 'saved-thread', view: 'work' }) }),
    error => {
      assert.ok(error instanceof RedirectSignal);
      assert.equal(error.location, '/?conversation=saved-thread&view=work');
      return true;
    }
  );
});
