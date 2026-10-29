import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environment, renderer, load, find, textOf } from './support/component-harness.mjs';

class ApiError extends Error {
  constructor(message, status, retryAfter = 0) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

const companyRun = (id, market, status = 'running') => ({
  id, market, product: 'Synthetic scheduling software', limit: 20, status,
  results: [], events: [], gmail: { status: 'connection_required' }, limitations: [],
});
const matchRun = (id = 'match-run', status = 'running') => ({
  id, direction: 'companies_for_thesis', thesis: { one_liner: 'Synthetic thesis' },
  status, phase: 'matching', results: [], events: [], source_snapshot: null, error: null, limitations: [],
});

function mountCompany(env, request) {
  const view = renderer(env);
  const { default: Workspace } = load('../src/components/ProspectingWorkspace.tsx', {
    react: view.react,
    '../lib/api': { ApiError, request },
    '../lib/company-website': { companyWebsite: value => value },
    '../lib/cypher-voice': { CYPHER_VOICE_INTRO: 'Synthetic welcome.' },
    './cipher/BinaryLens': { __esModule: true, default: 'lens' },
    './cipher/CypherMark': { __esModule: true, default: 'mark' },
    './WorkflowShell': { __esModule: true, default: 'workflow-shell' },
    './prospecting-workspace.css': {},
  }, {
    ...env.globals,
    React: view.react.default,
    URLSearchParams,
    fetch: async () => ({ json: async () => ({ configured: false }) }),
  });
  view.mount(() => Workspace({}));
  return view;
}

function historicalPage(status = 'running') {
  return {
    database: {
      records: 0, explicit_founder_signals: 0, matched_records: 0,
      snapshot_ready: true, snapshot_built_at: null, quarters: [], quarter_count: 0,
      historical: { status, total_quarters: 10, processed_quarters: 2, current_quarter: '2020q1', error: null },
      source: 'Synthetic fixture',
    },
    items: [], page: { limit: 25, offset: 0, returned: 0 }, limitations: [],
  };
}

function mountVc(env, request) {
  const view = renderer(env);
  const { default: Workspace } = load('../src/components/VcProspectingWorkspace.tsx', {
    react: view.react,
    '../lib/api': { ApiError, request },
    './WorkflowShell': { __esModule: true, default: 'workflow-shell' },
    './vc-prospecting.css': {},
  }, { ...env.globals, React: view.react.default, URLSearchParams });
  view.mount(() => Workspace({}));
  return view;
}

function pollError(view) {
  return find(view.tree, node => node.props?.className === 'cx-error cx-poll-error');
}

test('company research retries network, 408, 429, and 5xx failures with bounded backoff and clears the alert after recovery', async () => {
  const env = environment();
  const run = companyRun('retry-run', 'Synthetic market');
  const failures = [
    { error: new ApiError('Synthetic service error.', 503), delay: 2500 },
    { error: new ApiError('Synthetic timeout.', 408), delay: 5000 },
    { error: new ApiError('Synthetic rate limit.', 429, 12), delay: 12000 },
    { error: new ApiError('Synthetic server error.', 500), delay: 20000 },
    { error: new Error('Synthetic network interruption.'), delay: 30000 },
  ];
  let statusCalls = 0;
  const request = async path => {
    if (path === '/prospecting/settings') return { akta_available: false };
    if (path === '/prospecting/runs') return [run];
    if (path === '/prospecting/runs/retry-run') {
      const call = statusCalls++;
      if (call < failures.length) throw failures[call].error;
      return { ...run, status: 'completed' };
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const view = mountCompany(env, request);
  await view.flush();

  for (let i = 0; i < failures.length; i++) {
    assert.equal(statusCalls, i + 1, `attempt ${i + 1} starts after the prior failure`);
    assert.match(textOf(pollError(view)), /Synthetic/);
    env.time.advance(failures[i].delay - 1);
    await view.flush();
    assert.equal(statusCalls, i + 1, `attempt ${i + 2} waits for the full ${failures[i].delay}ms retry delay`);
    env.time.advance(1);
    await view.flush();
    assert.equal(statusCalls, i + 2, `attempt ${i + 2} starts at the retry deadline`);
  }

  assert.equal(pollError(view), undefined, 'a successful status read clears its own transient alert');
  assert.match(textOf(view.tree), /Research complete/);
  view.unmount();
});

test('company research does not retry an authentication failure', async () => {
  const env = environment();
  const run = companyRun('auth-run', 'Synthetic market');
  let statusCalls = 0;
  const request = async path => {
    if (path === '/prospecting/settings') return { akta_available: false };
    if (path === '/prospecting/runs') return [run];
    if (path === '/prospecting/runs/auth-run') {
      statusCalls++;
      throw new ApiError('Sign in again.', 401);
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const view = mountCompany(env, request);
  await view.flush();
  assert.equal(statusCalls, 1);
  assert.match(textOf(pollError(view)), /Sign in again/);
  assert.equal(env.time.pending, 0, 'authentication errors schedule no background retry');
  env.time.advance(120000);
  await view.flush();
  assert.equal(statusCalls, 1);
  view.unmount();
});

test('selecting a newer company research run aborts the older poll and ignores its late response', async () => {
  const env = environment();
  let resolveOld;
  let oldSignal;
  let oldCalls = 0;
  const older = companyRun('older-run', 'Older synthetic market');
  const newer = companyRun('newer-run', 'Newer synthetic market', 'completed');
  const request = async (path, options = {}) => {
    if (path === '/prospecting/settings') return { akta_available: false };
    if (path === '/prospecting/runs') return [older, newer];
    if (path === '/prospecting/runs/older-run') {
      oldCalls++;
      oldSignal = options.signal;
      return new Promise(resolve => { resolveOld = resolve; });
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const view = mountCompany(env, request);
  await view.flush();
  assert.equal(oldCalls, 1, 'the selected active run starts polling');

  const newerButton = find(view.tree, node => node.type === 'button' && textOf(node).includes('Newer synthetic market'));
  assert.ok(newerButton, 'the newer saved run is available');
  newerButton.props.onClick();
  view.render();
  await view.flush();
  assert.equal(oldSignal.aborted, true, 'changing the selected run cancels the previous poll');

  resolveOld({ ...older, status: 'failed' });
  await view.flush();
  assert.match(textOf(find(view.tree, node => node.props?.className === 'cx-section-heading cx-results-heading')), /Newer synthetic market/);
  assert.doesNotMatch(textOf(find(view.tree, node => node.props?.className === 'cx-section-heading cx-results-heading')), /Research stopped/);
  assert.equal(env.time.pending, 0, 'a late old-run response schedules no retry or poll');
  view.unmount();
});

test('company research cancels a scheduled retry on unmount', async () => {
  const env = environment();
  const run = companyRun('unmount-run', 'Synthetic market');
  let statusCalls = 0;
  let statusSignal;
  const request = async (path, options = {}) => {
    if (path === '/prospecting/settings') return { akta_available: false };
    if (path === '/prospecting/runs') return [run];
    if (path === '/prospecting/runs/unmount-run') {
      statusCalls++;
      statusSignal = options.signal;
      throw new ApiError('Synthetic temporary failure.', 503);
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const view = mountCompany(env, request);
  await view.flush();
  assert.equal(statusCalls, 1);
  assert.equal(env.time.pending, 1, 'a transient failure schedules one retry');
  view.unmount();
  assert.equal(statusSignal.aborted, true);
  assert.equal(env.time.pending, 0, 'unmount clears the scheduled retry');
  env.time.advance(120000);
  await view.flush();
  assert.equal(statusCalls, 1, 'no request runs after unmount');
  assert.equal(view.updatesAfterUnmount, 0, 'no state update runs after unmount');
});

test('SEC archive status honors Retry-After and clears its alert after recovery', async () => {
  const env = environment();
  let backfillCalls = 0;
  const request = async path => {
    if (path.startsWith('/prospecting/investors/founders?')) return historicalPage(backfillCalls > 1 ? 'completed' : 'running');
    if (path === '/prospecting/investors/runs') return [];
    if (path === '/prospecting/investors/founders/backfill') {
      backfillCalls++;
      if (backfillCalls === 1) throw new ApiError('Synthetic research service failure.', 503, 8);
      return { status: 'completed', total_quarters: 10, processed_quarters: 10, current_quarter: null, error: null };
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const view = mountVc(env, request);
  await view.flush();
  assert.equal(backfillCalls, 1);
  assert.match(textOf(find(view.tree, node => node.props?.role === 'alert')), /couldn’t reach the research service/i);

  env.time.advance(7999);
  await view.flush();
  assert.equal(backfillCalls, 1, 'the retry waits for Retry-After even when exponential backoff is shorter');
  env.time.advance(1);
  await view.flush();
  assert.equal(backfillCalls, 2);
  assert.doesNotMatch(textOf(view.tree), /couldn’t reach the research service/i);
  assert.match(textOf(view.tree), /Historical SEC Form D archive is indexed and searchable/);
  view.unmount();
});

test('SEC archive polling stops after unmount and does not repeat a nonretryable authentication error', async () => {
  const env = environment();
  let backfillCalls = 0;
  let backfillSignal;
  const request = async (path, options = {}) => {
    if (path.startsWith('/prospecting/investors/founders?')) return historicalPage();
    if (path === '/prospecting/investors/runs') return [];
    if (path === '/prospecting/investors/founders/backfill') {
      backfillCalls++;
      backfillSignal = options.signal;
      throw new ApiError('Your sign-in expired.', 401);
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const view = mountVc(env, request);
  await view.flush();
  assert.equal(backfillCalls, 1);
  assert.equal(env.time.pending, 0, 'a nonretryable 401 schedules no retry');
  view.unmount();
  assert.equal(backfillSignal.aborted, true);
  env.time.advance(120000);
  await view.flush();
  assert.equal(backfillCalls, 1, 'the archive poll never restarts after unmount');
  assert.equal(view.updatesAfterUnmount, 0);
});

test('SEC archive cancels a scheduled transient retry on unmount', async () => {
  const env = environment();
  let backfillCalls = 0;
  let backfillSignal;
  const request = async (path, options = {}) => {
    if (path.startsWith('/prospecting/investors/founders?')) return historicalPage();
    if (path === '/prospecting/investors/runs') return [];
    if (path === '/prospecting/investors/founders/backfill') {
      backfillCalls++;
      backfillSignal = options.signal;
      throw new ApiError('Synthetic temporary archive failure.', 503);
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const view = mountVc(env, request);
  await view.flush();
  assert.equal(backfillCalls, 1);
  assert.equal(env.time.pending, 1, 'a transient failure schedules one bounded retry');
  view.unmount();
  assert.equal(backfillSignal.aborted, true);
  assert.equal(env.time.pending, 0, 'unmount clears the scheduled archive retry');
  env.time.advance(120000);
  await view.flush();
  assert.equal(backfillCalls, 1, 'the archive request does not repeat after unmount');
  assert.equal(view.updatesAfterUnmount, 0);
});

test('VC matching retries transient status failures, honors Retry-After, and clears the alert after recovery', async () => {
  const env = environment();
  let statusCalls = 0;
  const request = async path => {
    if (path.startsWith('/prospecting/investors/founders?')) return historicalPage('idle');
    if (path === '/prospecting/investors/runs') return [matchRun()];
    if (path === '/prospecting/investors/runs/match-run') {
      statusCalls++;
      if (statusCalls === 1) throw new ApiError('Synthetic matching service failure.', 503, 9);
      return matchRun('match-run', 'completed');
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const view = mountVc(env, request);
  await view.flush();
  assert.equal(statusCalls, 1);
  assert.match(textOf(find(view.tree, node => node.props?.className === 'vc-alert')), /couldn’t reach the research service/i);

  env.time.advance(8999);
  await view.flush();
  assert.equal(statusCalls, 1, 'the status poll waits for Retry-After');
  env.time.advance(1);
  await view.flush();
  assert.equal(statusCalls, 2);
  assert.doesNotMatch(textOf(view.tree), /couldn’t reach the research service/i);
  assert.match(textOf(view.tree), /SEC snapshot and match results are ready/);
  view.unmount();
});

test('VC matching stops automatic polling for 401 and exposes a deliberate retry action', async () => {
  const env = environment();
  let statusCalls = 0;
  const request = async path => {
    if (path.startsWith('/prospecting/investors/founders?')) return historicalPage('idle');
    if (path === '/prospecting/investors/runs') return [matchRun()];
    if (path === '/prospecting/investors/runs/match-run') {
      statusCalls++;
      if (statusCalls === 1) throw new ApiError('Your sign-in expired.', 401);
      return matchRun('match-run', 'completed');
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const view = mountVc(env, request);
  await view.flush();
  assert.equal(statusCalls, 1);
  assert.equal(env.time.pending, 0, 'authentication errors schedule no background poll');
  assert.ok(find(view.tree, node => node.type === 'a' && String(node.props?.href || '').startsWith('/login?returnTo=')));
  const retryButton = find(view.tree, node => node.type === 'button' && textOf(node) === 'Retry status check');
  assert.ok(retryButton, 'the user can resume a status check after restoring access');
  retryButton.props.onClick();
  await view.flush();
  assert.equal(statusCalls, 2);
  assert.doesNotMatch(textOf(view.tree), /Your sign-in expired/);
  view.unmount();
});

test('VC matching cancels its scheduled retry after unmount', async () => {
  const env = environment();
  let statusCalls = 0;
  let statusSignal;
  const request = async (path, options = {}) => {
    if (path.startsWith('/prospecting/investors/founders?')) return historicalPage('idle');
    if (path === '/prospecting/investors/runs') return [matchRun()];
    if (path === '/prospecting/investors/runs/match-run') {
      statusCalls++;
      statusSignal = options.signal;
      throw new ApiError('Synthetic temporary failure.', 503);
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const view = mountVc(env, request);
  await view.flush();
  assert.equal(statusCalls, 1);
  assert.equal(env.time.pending, 1);
  view.unmount();
  assert.equal(statusSignal.aborted, true);
  assert.equal(env.time.pending, 0);
  env.time.advance(120000);
  await view.flush();
  assert.equal(statusCalls, 1);
  assert.equal(view.updatesAfterUnmount, 0);
});
