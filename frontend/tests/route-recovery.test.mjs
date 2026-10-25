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
