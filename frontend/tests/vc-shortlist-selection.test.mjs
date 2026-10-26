import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environment, renderer, load, find, textOf, button } from './support/component-harness.mjs';

const founder = (id, person, company) => ({
  id, person_name: person, company_name: company, title: 'Founder', roles: ['Founder'],
  founder_status: 'founder_named_in_filing', founder_evidence: 'Synthetic fixture', industry: 'Climate',
  location: { city: null, state: null }, filing_date: null, filing_count_in_snapshot: 1,
  source_quarters: [], source_url: `https://example.test/${id}`,
});

test('shortlist details stay on a visible shortlisted founder after another research row was selected', async () => {
  const env = environment(), view = renderer(env);
  const alpha = founder('alpha', 'Synthetic Alpha', 'Fixture Alpha');
  const beta = founder('beta', 'Synthetic Beta', 'Fixture Beta');
  const page = {
    database: { records: 2, explicit_founder_signals: 2, matched_records: 2, snapshot_ready: true, snapshot_built_at: null, quarters: [], quarter_count: 0,
      historical: { status: 'idle', total_quarters: 0, processed_quarters: 0, current_quarter: null, error: null }, source: 'Synthetic fixture' },
    items: [alpha, beta], page: { limit: 25, offset: 0, returned: 2 }, limitations: [],
  };
  class ApiError extends Error {}
  const { default: Workspace } = load('../src/components/VcProspectingWorkspace.tsx', {
    react: view.react,
    '../lib/api': { ApiError, request: async path => path.includes('/founders?') ? page : [] },
    './WorkflowShell': { __esModule: true, default: 'workflow-shell' },
    './vc-prospecting.css': {},
  }, { ...env.globals, React: view.react.default, URLSearchParams });

  view.mount(() => Workspace({}));
  await view.flush();
  button(view.tree, 'Add to shortlist').props.onClick();
  await view.flush();
  const betaRow = find(view.tree, node => node.type === 'button' && textOf(node).includes('Synthetic Beta'));
  assert.ok(betaRow, 'the second research result is available');
  betaRow.props.onClick();
  await view.flush();
  button(view.tree, '3Shortlist').props.onClick();
  await view.flush();

  const detailPanel = find(view.tree, node => node.type === 'aside' && node.props?.['aria-label'] === 'Selected person details');
  assert.match(textOf(detailPanel), /Fixture Alpha/);
  assert.match(textOf(detailPanel), /Synthetic Alpha/);
  assert.doesNotMatch(textOf(detailPanel), /Fixture Beta|Synthetic Beta/);
  view.unmount();
});
