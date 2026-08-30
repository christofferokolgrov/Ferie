import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoDate, addDays, sweepWindow } from '../src/dates.mjs';
import { HORIZON_END_DATE, MIN_LEAD_DAYS } from '../src/config.mjs';

test('isoDate / addDays work on UTC day boundaries', () => {
  assert.equal(isoDate(new Date('2026-06-28T23:59:59Z')), '2026-06-28');
  assert.equal(addDays('2026-06-28', 3), '2026-07-01');
  assert.equal(addDays('2026-12-30', 3), '2027-01-02'); // crosses the year
  assert.equal(addDays('2026-06-28', 0), '2026-06-28');
});

test('sweepWindow starts at today + minLeadDays', () => {
  assert.deepEqual(sweepWindow('2026-06-28', '2027-01-01', 3), {
    startDate: '2026-07-01',
    endDate: '2027-01-01',
  });
});

test('sweepWindow defaults to no lead time when minLeadDays is omitted', () => {
  assert.deepEqual(sweepWindow('2026-06-28', '2027-01-01'), {
    startDate: '2026-06-28',
    endDate: '2027-01-01',
  });
});

test('the configured window is a 3-day floor under the fixed horizon', () => {
  assert.equal(MIN_LEAD_DAYS, 3);
  const { startDate, endDate } = sweepWindow('2026-08-30', HORIZON_END_DATE, MIN_LEAD_DAYS);
  assert.equal(startDate, '2026-09-02');
  assert.equal(endDate, HORIZON_END_DATE);
  assert.ok(startDate < endDate); // window still open
});
