import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environment, renderer, load, find, textOf, button, deferred } from './support/component-harness.mjs';

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
const sampleFounder = (id = 'person', company_name = 'Synthetic Company') => ({
  id, person_name: 'Synthetic Person', company_name, title: 'Director', roles: ['Director'],
  founder_status: 'related_person', founder_evidence: null, industry: 'Energy',
  location: { city: null, state: null }, filing_date: '2026-10-25', filing_count_in_snapshot: 1,
  source_quarters: ['2026q4'], source_url: 'https://www.sec.gov/Archives/synthetic',
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

function mountVc(env, request, props = {}) {
  const view = renderer(env);
  const { default: Workspace } = load('../src/components/VcProspectingWorkspace.tsx', {
    react: view.react,
    '../lib/api': { ApiError, request },
    './WorkflowShell': { __esModule: true, default: 'workflow-shell' },
    './vc-prospecting.css': {},
  }, { ...env.globals, React: view.react.default, URLSearchParams });
  view.mount(() => Workspace(props));
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

test('company research draft keeps intentionally cleared fields in the preview, clipboard, and Gmail compose link', async () => {
  const env = environment();
  let copied = '';
  env.globals.navigator = { clipboard: { writeText: async value => { copied = value; } } };
  const candidate = {
    id: 'synthetic-candidate', name: 'Synthetic Company', source_url: 'https://example.com/company',
    retrieved_at: '2026-10-30T00:00:00.000Z',
    observed: { description: 'Synthetic public description', source: 'Synthetic source', organization_status: 'active' },
    inferred: { fit_score: 0.8, matched_terms: ['synthetic'], reason: 'Synthetic evidence overlap' },
    contact: { status: 'unverified', email: null },
    draft: { subject: 'Synthetic subject', body: 'Synthetic outreach body', status: 'local_draft', recipient: null, review_required: true, source_urls: [] },
  };
  const run = { ...companyRun('draft-run', 'Synthetic market', 'completed'), results: [candidate] };
  const request = async path => {
    if (path === '/prospecting/settings') return { akta_available: false };
    if (path === '/prospecting/runs') return [run];
    throw new Error(`Unexpected request: ${path}`);
  };
  const view = mountCompany(env, request);
  await view.flush();

  const subjectLabel = find(view.tree, node => node.type === 'label' && textOf(node).includes('Subject'));
  const messageLabel = find(view.tree, node => node.type === 'label' && textOf(node).includes('Message'));
  const subject = find(subjectLabel, node => node.type === 'input');
  const body = find(messageLabel, node => node.type === 'textarea');
  assert.ok(subject, 'saved subject is editable');
  assert.ok(body, 'saved message is editable');
  assert.equal(subject.props.value, 'Synthetic subject');
  assert.equal(body.props.value, 'Synthetic outreach body');
  subject.props.onChange({ target: { value: '' } });
  body.props.onChange({ target: { value: '' } });
  view.render();

  const clearedSubjectLabel = find(view.tree, node => node.type === 'label' && textOf(node).includes('Subject'));
  const clearedMessageLabel = find(view.tree, node => node.type === 'label' && textOf(node).includes('Message'));
  assert.equal(find(clearedSubjectLabel, node => node.type === 'input')?.props.value, '', 'an empty subject remains empty');
  assert.equal(find(clearedMessageLabel, node => node.type === 'textarea')?.props.value, '', 'an empty message remains empty');
  const compose = find(view.tree, node => node.type === 'a' && textOf(node).includes('Open Gmail compose'));
  assert.match(compose.props.href, /&su=&body=$/, 'Gmail compose receives the empty edited fields');
  await button(view.tree, 'Copy draft').props.onClick();
  assert.equal(copied, 'Subject: \n\n', 'copy uses the empty edited fields');
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

test('VC match completion keeps its final founder refresh alive after the run becomes terminal', async () => {
  const env = environment();
  const finalFounders = deferred();
  let founderCalls = 0;
  let finalRefreshSignal;
  const request = async (path, options = {}) => {
    if (path.startsWith('/prospecting/investors/founders?')) {
      founderCalls++;
      if (founderCalls === 1) return historicalPage('idle');
      finalRefreshSignal = options.signal;
      return finalFounders.promise;
    }
    if (path === '/prospecting/investors/runs') return [matchRun()];
    if (path === '/prospecting/investors/runs/match-run') return matchRun('match-run', 'completed');
    throw new Error(`Unexpected request: ${path}`);
  };
  const view = mountVc(env, request);
  await view.flush();
  assert.ok(finalRefreshSignal, 'completion starts a signal-bound final data refresh');
  assert.equal(finalRefreshSignal.aborted, false, 'the terminal status does not cancel its own final refresh');

  finalFounders.resolve(historicalPage('idle'));
  await view.flush();
  assert.match(textOf(view.tree), /SEC snapshot and match results are ready/);
  view.unmount();
});

test('SEC archive completion aborts its final founder refresh when the page unmounts', async () => {
  const env = environment();
  const finalFounders = deferred();
  let founderCalls = 0;
  let finalRefreshSignal;
  const request = async (path, options = {}) => {
    if (path.startsWith('/prospecting/investors/founders?')) {
      founderCalls++;
      if (founderCalls === 1) return historicalPage('running');
      finalRefreshSignal = options.signal;
      return finalFounders.promise;
    }
    if (path === '/prospecting/investors/runs') return [];
    if (path === '/prospecting/investors/founders/backfill') {
      return { status: 'completed', total_quarters: 10, processed_quarters: 10, current_quarter: null, error: null };
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const view = mountVc(env, request);
  await view.flush();
  assert.ok(finalRefreshSignal, 'archive completion starts a signal-bound final data refresh');
  view.unmount();
  assert.equal(finalRefreshSignal.aborted, true, 'unmount cancels the final refresh');
  finalFounders.resolve(historicalPage('completed'));
  await view.flush();
  assert.equal(view.updatesAfterUnmount, 0, 'late final data cannot update the closed page');
});

test('starting a newer VC run aborts an older run’s pending final founder refresh', async () => {
  const env = environment();
  const oldFinalFounders = deferred();
  const initialPage = historicalPage('idle');
  initialPage.database.records = 1;
  const stalePage = historicalPage('idle');
  stalePage.database.records = 99;
  let founderCalls = 0;
  let oldRefreshSignal;
  let createdRuns = 0;
  const request = async (path, options = {}) => {
    if (path.startsWith('/prospecting/investors/founders?')) {
      founderCalls++;
      if (founderCalls === 1) return initialPage;
      oldRefreshSignal = options.signal;
      return oldFinalFounders.promise;
    }
    if (path === '/prospecting/investors/runs' && options.method === 'POST') {
      createdRuns++;
      return matchRun('new-run');
    }
    if (path === '/prospecting/investors/runs') return [matchRun('old-run')];
    if (path === '/prospecting/investors/runs/old-run') return matchRun('old-run', 'completed');
    if (path === '/prospecting/investors/runs/new-run') return matchRun('new-run');
    throw new Error(`Unexpected request: ${path}`);
  };
  const view = mountVc(env, request);
  await view.flush();
  assert.ok(oldRefreshSignal, 'the old run starts its final founder refresh');
  assert.equal(oldRefreshSignal.aborted, false);

  const refreshButton = find(view.tree, node => node.type === 'button' && textOf(node) === 'Refresh recent SEC data');
  assert.ok(refreshButton, 'a completed run allows another research run');
  refreshButton.props.onClick();
  await view.flush();
  assert.equal(createdRuns, 1);
  assert.equal(oldRefreshSignal.aborted, true, 'starting a newer run cancels the older final refresh');

  oldFinalFounders.resolve(stalePage);
  await view.flush();
  assert.match(textOf(view.tree), /SEC refresh queued/);
  assert.doesNotMatch(textOf(view.tree), /SEC snapshot and match results are ready/);
  const indexMetric = find(view.tree, node => node.type === 'div' && node.props?.children?.some?.(child => textOf(child).includes('People in SEC index')));
  assert.ok(indexMetric);
  assert.equal(textOf(find(indexMetric, node => node.type === 'strong')), '1', 'old run data cannot replace the current founder view');
  view.unmount();
});

test('a late completion refresh cannot replace a newer filtered founder search or page', async () => {
  const env = environment();
  const oldFinalFounders = deferred();
  const initialPage = historicalPage('idle');
  initialPage.database.records = 1;
  initialPage.database.matched_records = 60;
  initialPage.page.returned = 25;
  const searchedPage = historicalPage('idle');
  searchedPage.database.records = 7;
  searchedPage.database.matched_records = 60;
  searchedPage.page.returned = 25;
  const nextPage = historicalPage('idle');
  nextPage.database.records = 8;
  nextPage.database.matched_records = 60;
  nextPage.page = { limit: 25, offset: 25, returned: 25 };
  const stalePage = historicalPage('idle');
  stalePage.database.records = 99;
  stalePage.database.matched_records = 99;
  let founderCalls = 0;
  let oldRefreshSignal;
  const founderPaths = [];
  const request = async (path, options = {}) => {
    if (path.startsWith('/prospecting/investors/founders?')) {
      founderPaths.push(path);
      const call = ++founderCalls;
      if (call === 1) return initialPage;
      if (call === 2) { oldRefreshSignal = options.signal; return oldFinalFounders.promise; }
      if (call === 3) return searchedPage;
      if (call === 4) return nextPage;
      throw new Error(`Unexpected founder request: ${path}`);
    }
    if (path === '/prospecting/investors/runs') return [matchRun('old-run')];
    if (path === '/prospecting/investors/runs/old-run') return matchRun('old-run', 'completed');
    throw new Error(`Unexpected request: ${path}`);
  };
  const view = mountVc(env, request);
  await view.flush();
  assert.ok(oldRefreshSignal, 'run completion starts a deferred final data refresh');

  const query = find(view.tree, node => node.type === 'input' && node.props?.placeholder === 'Search people, companies, or roles…');
  const industry = find(view.tree, node => node.type === 'input' && node.props?.placeholder === 'Any industry');
  assert.ok(query);
  assert.ok(industry);
  query.props.onChange({ target: { value: 'climate' } });
  industry.props.onChange({ target: { value: 'energy' } });
  await view.flush();
  const searchForm = find(view.tree, node => node.type === 'form' && node.props?.className === 'vc-search');
  searchForm.props.onSubmit({ preventDefault() {} });
  await view.flush();
  assert.ok(oldRefreshSignal.aborted, 'a newer filtered search cancels the pending completion refresh');
  assert.match(founderPaths[2], /q=climate/);
  assert.match(founderPaths[2], /industry=energy/);

  button(view.tree, 'Next').props.onClick();
  await view.flush();
  assert.match(founderPaths[3], /offset=25/);
  assert.equal(find(view.tree, node => node.type === 'button' && textOf(node) === 'Previous').props.disabled, false);

  oldFinalFounders.resolve(stalePage);
  await view.flush();
  const stats = find(view.tree, node => node.props?.className === 'vc-stats');
  assert.equal(textOf(find(stats, node => node.type === 'strong')), '8', 'late old data cannot replace the newer page');
  assert.equal(find(view.tree, node => node.type === 'button' && textOf(node) === 'Previous').props.disabled, false, 'late old data cannot reset the page offset');
  view.unmount();
});

test('an aborted unfiltered completion refresh cannot replace a submitted founder search', async () => {
  const env = environment();
  const old = deferred();
  const initialPage = historicalPage('idle');
  initialPage.items = [sampleFounder('initial-company', 'Initial Company')];
  const currentPage = historicalPage('idle');
  currentPage.database.records = 7;
  currentPage.database.matched_records = 7;
  currentPage.items = [sampleFounder('current-result', 'Current Search Company')];
  currentPage.page.returned = 1;
  const stalePage = historicalPage('idle');
  stalePage.database.records = 99;
  stalePage.database.matched_records = 99;
  stalePage.items = [sampleFounder('old-result', 'Stale Unfiltered Company')];
  let unfiltered = 0;
  let oldRefreshSignal;
  const request = async (path, options = {}) => {
    if (path.startsWith('/prospecting/investors/founders?')) {
      if (new URLSearchParams(path.split('?')[1]).get('q') === 'new search') return currentPage;
      if (++unfiltered === 1) return initialPage;
      oldRefreshSignal = options.signal;
      return new Promise((resolve, reject) => {
        const stop = () => reject(new Error('Synthetic request aborted'));
        if (options.signal?.aborted) { stop(); return; }
        options.signal?.addEventListener('abort', stop, { once: true });
        old.promise.then(value => {
          options.signal?.removeEventListener('abort', stop);
          resolve(value);
        }, reject);
      });
    }
    if (path === '/prospecting/investors/runs') return [matchRun('old-run')];
    if (path === '/prospecting/investors/runs/old-run') return matchRun('old-run', 'completed');
    throw new Error(`Unexpected request: ${path}`);
  };
  const view = mountVc(env, request);
  await view.flush();
  assert.ok(oldRefreshSignal, 'the completion refresh remains in flight');

  const input = find(view.tree, node => node.type === 'input' && node.props?.placeholder === 'Search people, companies, or roles…');
  input.props.onChange({ target: { value: 'new search' } });
  await view.flush();
  find(view.tree, node => node.type === 'form' && node.props?.className === 'vc-search').props.onSubmit({ preventDefault() {} });
  await view.flush();
  assert.equal(oldRefreshSignal.aborted, true);
  assert.match(textOf(view.tree), /Current Search Company/);

  old.resolve(stalePage);
  await view.flush();
  assert.match(textOf(view.tree), /Current Search Company/);
  assert.doesNotMatch(textOf(view.tree), /Stale Unfiltered Company/);
  const stats = find(view.tree, node => node.props?.className === 'vc-stats');
  assert.equal(textOf(find(stats, node => node.type === 'strong')), '7');
  view.unmount();
});

test('a rejected shortlist write stays available in the tab and never claims it was saved', async () => {
  const env = environment();
  const personPage = historicalPage('idle');
  personPage.items = [sampleFounder('saved-person', 'Saved Person Company')];
  personPage.page.returned = 1;
  const reads = [];
  const writes = [];
  env.window.localStorage = {
    getItem(key) { reads.push(key); return null; },
    setItem(key) { writes.push(key); throw new Error('Synthetic storage quota exceeded'); },
  };
  const request = async path => {
    if (path.startsWith('/prospecting/investors/founders?')) return personPage;
    if (path === '/prospecting/investors/runs') return [];
    throw new Error(`Unexpected request: ${path}`);
  };
  const view = mountVc(env, request, { accountId: 'audit-owner' });
  await view.flush();
  const writesBeforeAdd = writes.length;
  button(view.tree, 'Add to shortlist').props.onClick();
  await view.flush();

  const persistenceLabel = textOf(find(view.tree, node => node.props?.className === 'vc-detail-actions'));
  assert.match(persistenceLabel, /tab only|could not save|not saved/i);
  assert.doesNotMatch(persistenceLabel, /Saved on this device/);
  assert.deepEqual(reads, ['cypher-vc-shortlist:audit-owner'], 'read only the current account key');
  assert.ok(writes.length > writesBeforeAdd, 'adding a person attempts to save the current shortlist');
  assert.ok(writes.every(key => key === 'cypher-vc-shortlist:audit-owner'), 'never write another account’s shortlist');

  const shortlistStep = find(view.tree, node => node.type === 'button' && textOf(node).includes('Shortlist'));
  shortlistStep.props.onClick();
  await view.flush();
  assert.match(textOf(view.tree), /Saved Person Company/);
  assert.match(textOf(find(view.tree, node => node.props?.className === 'vc-candidates-heading')), /Available in this tab only/);
  view.unmount();
});

test('a shortlist read failure keeps the current-tab fallback without overwriting unread data', async () => {
  const env = environment();
  const personPage = historicalPage('idle');
  personPage.items = [sampleFounder('private-person', 'Private Stored Company')];
  const writes = [];
  env.window.localStorage = {
    getItem() { throw new Error('Synthetic storage access denied'); },
    setItem(key) { writes.push(key); },
  };
  const request = async path => {
    if (path.startsWith('/prospecting/investors/founders?')) return personPage;
    if (path === '/prospecting/investors/runs') return [];
    throw new Error(`Unexpected request: ${path}`);
  };
  const view = mountVc(env, request, { accountId: 'audit-owner' });
  await view.flush();
  button(view.tree, 'Add to shortlist').props.onClick();
  await view.flush();

  assert.deepEqual(writes, [], 'do not overwrite stored data when this account’s list could not be read');
  const persistenceLabel = textOf(find(view.tree, node => node.props?.className === 'vc-detail-actions'));
  assert.match(persistenceLabel, /tab only|could not save|not saved/i);
  assert.doesNotMatch(persistenceLabel, /Saved on this device/);
  const shortlistStep = find(view.tree, node => node.type === 'button' && textOf(node).includes('Shortlist'));
  shortlistStep.props.onClick();
  await view.flush();
  assert.match(textOf(view.tree), /Private Stored Company/);
  view.unmount();
});

test('VC thesis labels and prompt follow the selected investor or company direction', async () => {
  const env = environment();
  const request = async path => {
    if (path.startsWith('/prospecting/investors/founders?')) return historicalPage('idle');
    if (path === '/prospecting/investors/runs') return [];
    throw new Error(`Unexpected request: ${path}`);
  };
  const view = mountVc(env, request);
  await view.flush();

  const thesisStep = find(view.tree, node => node.type === 'button' && textOf(node).includes('Thesis'));
  assert.ok(thesisStep);
  thesisStep.props.onClick();
  await view.flush();
  assert.match(textOf(view.tree), /Find founders and companies for your fund/);
  assert.ok(find(view.tree, node => node.type === 'input' && node.props?.placeholder === 'e.g. Climate founders at seed stage'));

  const direction = find(view.tree, node => node.type === 'select');
  assert.ok(direction);
  direction.props.onChange({target:{value:'investors_for_thesis'}});
  await view.flush();
  assert.match(textOf(view.tree), /Find investors for your company/);
  assert.match(textOf(view.tree), /Find investors using public company and fund evidence/);
  assert.ok(find(view.tree, node => node.type === 'input' && node.props?.placeholder === 'e.g. Early investors for a climate startup'));
  assert.ok(find(view.tree, node => node.type === 'button' && textOf(node) === 'Find matching investors'));
  direction.props.onChange({target:{value:'companies_for_thesis'}});
  await view.flush();
  assert.ok(find(view.tree, node => node.type === 'button' && textOf(node) === 'Find matching companies'));
  view.unmount();
});
