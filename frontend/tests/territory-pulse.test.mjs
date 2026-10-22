import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const exports = {};
const source = readFileSync(new URL('../src/lib/territory-pulse.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
runInNewContext(compiled, { exports, Error });
const { buildProspects, rankProspects, exportProspects, SCORE_LABEL } = exports;
const build = () => buildProspects('Independent retail teams', 'A simpler way to coordinate incoming requests');

function parseCsv(value) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '"') {
      if (quoted && value[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && char === ',') { row.push(cell); cell = ''; }
    else if (!quoted && char === '\r' && value[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += char;
  }
  assert.equal(quoted, false); return rows;
}

test('all twenty prospects are explicitly fictional, unverified, role-only demo fixtures', () => {
  const rows = build(); assert.equal(rows.length, 20); assert.equal(new Set(rows.map(row => row.id)).size, 20);
  for (const row of rows) {
    assert.match(row.name, /^Demo /); assert.match(row.domain, /^[a-z-]+\.example$/);
    assert.match(row.signal, /^Demo scenario:/); assert.match(row.signal, /fictional, not an observed company signal/);
    assert.equal(JSON.stringify(row.source), JSON.stringify({ url: null, date: '2026-10-22', label: 'Demo fixture', verified: false }));
    assert.equal(row.status, 'new'); assert.ok(Number.isInteger(row.score) && row.score >= 55 && row.score <= 96);
    assert.doesNotMatch(row.buyerRole, /@|https?:/); assert.match(row.draft, /^Demo scenario/);
  }
  assert.equal(SCORE_LABEL, 'Illustrative demo score');
});
test('ranking is deterministic for normalized inputs and produces independent mutable rows', () => {
  assert.equal(JSON.stringify(build()), JSON.stringify(build()));
  assert.equal(JSON.stringify(buildProspects(' Retail ', ' Offer ')), JSON.stringify(buildProspects('Retail', 'Offer')));
  const first = build(), second = build(); first[0].status = 'reviewed'; first[0].source.label = 'Changed locally';
  assert.equal(second[0].status, 'new'); assert.equal(second[0].source.label, 'Demo fixture');
  assert.ok(second.every((row, i) => !i || second[i - 1].score >= row.score));
});
test('rankProspects returns a new ordering with stable ID tie breaks without changing input', () => {
  const rows = build().slice(0, 3).map((row, i) => ({ ...row, score: 80, id: ['c', 'a', 'b'][i] }));
  const ranked = rankProspects(rows);
  assert.equal(rows.map(row => row.id).join(','), 'c,a,b'); assert.equal(ranked.map(row => row.id).join(','), 'a,b,c');
  assert.notEqual(ranked, rows);
});
test('blank inputs and inputs beyond the market/offer bounds are rejected', () => {
  assert.throws(() => buildProspects('', 'Offer'), /Market is required/);
  assert.throws(() => buildProspects('Market', ' \n '), /Offer is required/);
  assert.throws(() => buildProspects('x'.repeat(121), 'Offer'), /Market must be 120/);
  assert.throws(() => buildProspects('Market', 'x'.repeat(501)), /Offer must be 500/);
  assert.throws(() => buildProspects(null, 'Offer'), /Market is required/);
  assert.equal(buildProspects('x'.repeat(120), 'x'.repeat(500)).length, 20);
});
test('drafts retain the provided market and offer as plain text in an explicit hypothetical scenario', () => {
  const market = 'Boutiques & studios', offer = 'Coordinate "rush" requests, with fewer handoffs';
  const rows = buildProspects(market, offer);
  for (const row of rows) { assert.ok(row.draft.includes(market)); assert.ok(row.draft.includes(offer)); assert.match(row.draft, /hypothetical/); assert.doesNotMatch(row.draft, /<\/?[a-z][^>]*>/i); }
});
test('CSV round trips quotes, commas, multiline drafts, source flags and reviewed status', () => {
  const row = { ...build()[0], name: 'Demo "Quoted", Company', draft: 'Demo scenario\nLine "two", continued', status: 'reviewed' };
  const rows = parseCsv(exportProspects([row])); assert.equal(rows.length, 2); assert.equal(rows[0].length, 12);
  assert.equal(rows[1][0], row.name); assert.equal(rows[1][8], 'false'); assert.equal(rows[1][9], '');
  assert.equal(rows[1][10], row.draft); assert.equal(rows[1][11], 'reviewed');
  assert.ok(rows[0].includes('Illustrative demo score'));
});
test('CSV neutralizes spreadsheet formulas including whitespace and control prefixes', () => {
  for (const payload of ['=1+1', '+SUM(1,2)', '-1+2', '@SUM(1,2)', ' \t=HYPERLINK("https://invalid.example")', '\r=1+1', '\ttext']) {
    const row = { ...build()[0], name: payload, domain: payload, buyerRole: payload, draft: payload };
    const cells = parseCsv(exportProspects([row]))[1];
    for (const index of [0, 1, 4, 10]) assert.equal(cells[index], "'" + payload);
  }
});
test('empty export still contains the documented CSV header and no invented records', () => {
  const rows = parseCsv(exportProspects([])); assert.equal(rows.length, 1); assert.equal(rows[0].length, 12);
});
