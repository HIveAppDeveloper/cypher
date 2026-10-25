import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load } from './support/component-harness.mjs';

const { calendarDateLabel, dateFromApi } = load('../src/lib/dates.ts');

test('API timestamps treat naive server dates as UTC and honor explicit ISO offsets', () => {
  const cases = [
    ['2026-10-25T12:34:56.789', '2026-10-25T12:34:56.789Z'],
    ['2026-10-25T12:34:56.789Z', '2026-10-25T12:34:56.789Z'],
    ['2026-10-25T12:34:56.789+00:00', '2026-10-25T12:34:56.789Z'],
    ['2026-10-25T07:34:56.789-0500', '2026-10-25T12:34:56.789Z'],
    ['2026-10-25T13:34:56.789+0100', '2026-10-25T12:34:56.789Z'],
    ['2026-10-25T12:34:56.789z', '2026-10-25T12:34:56.789Z'],
    ['2026-10-25', '2026-10-25T00:00:00.000Z'],
  ];

  for (const [input, expected] of cases) assert.equal(dateFromApi(input)?.toISOString(), expected);
});

test('API timestamps return null for missing and invalid values', () => {
  assert.equal(dateFromApi(undefined), null);
  assert.equal(dateFromApi('  '), null);
  assert.equal(dateFromApi('not a date'), null);
});

test('calendar labels preserve date-only days and reject impossible calendar dates', () => {
  const expected = new Date('2026-10-25T00:00:00Z').toLocaleDateString(undefined, { timeZone: 'UTC' });
  assert.equal(calendarDateLabel('2026-10-25'), expected);
  assert.equal(calendarDateLabel(' 2026-10-25 '), expected);
  assert.equal(calendarDateLabel('2026-10-25T00:30:00-05:00'), new Date('2026-10-25T05:30:00Z').toLocaleDateString());
  for (const value of [undefined, null, '', 'invalid', '2026-02-30']) assert.equal(calendarDateLabel(value), null);
});
