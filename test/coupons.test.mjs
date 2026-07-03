import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applicableCoupons,
  couponSummary,
  headcount,
  daysBetween,
} from '../src/coupons.mjs';

const apolloDeal = {
  operator: 'apollo',
  departureDate: '2026-08-01',
  pax: '2v', // 2 people
  currentPrice: 6000,
  currentPricePerPerson: 3000,
};

test('headcount resolves from pax key, falls back to paxAges', () => {
  assert.equal(headcount({ pax: '2v' }), 2);
  assert.equal(headcount({ pax: '4v' }), 4);
  assert.equal(headcount({ pax: '4v2b' }), 6);
  assert.equal(headcount({ paxAges: '18,18,9,12' }), 4);
  assert.equal(headcount({}), null);
});

test('daysBetween counts whole days, null on garbage', () => {
  assert.equal(daysBetween('2026-06-01', '2026-07-01'), 30);
  assert.equal(daysBetween('2026-07-01', '2026-06-01'), -30);
  assert.equal(daysBetween('nope', '2026-07-01'), null);
});

test('Apollo deal far out gets OBOS + Studentpakken', () => {
  const today = '2026-06-01'; // 61 days before departure
  const ids = applicableCoupons(apolloDeal, today).map((c) => c.id).sort();
  assert.deepEqual(ids, ['obos', 'studentpakken']);
});

test('per-person, per-booking and cashback values compute correctly', () => {
  const today = '2026-06-01';
  const apolloById = Object.fromEntries(
    applicableCoupons(apolloDeal, today).map((c) => [c.id, c.value]),
  );
  assert.equal(apolloById.obos, 350 * 2); // per person × 2
  assert.equal(apolloById.studentpakken, 750); // flat per booking
  // Trumf is now a TUI coupon — cashback is 1% of the total price.
  const tuiDeal = { ...apolloDeal, operator: 'tui' };
  const tuiById = Object.fromEntries(
    applicableCoupons(tuiDeal, today).map((c) => [c.id, c.value]),
  );
  assert.equal(tuiById.trumf, Math.round(6000 * 0.01)); // 1% of total
});

test('lead-time gate: inside 30 days drops the ≥30-day Apollo coupons', () => {
  const today = '2026-07-20'; // 12 days before departure
  const ids = applicableCoupons(apolloDeal, today).map((c) => c.id).sort();
  assert.deepEqual(ids, []); // both Apollo coupons require ≥30 days lead time
});

test('lead-time gate: TUI keeps the 0-day Trumf inside 30 days', () => {
  const today = '2026-07-20'; // 12 days before departure
  const tui = { ...apolloDeal, operator: 'tui' };
  const ids = applicableCoupons(tui, today).map((c) => c.id).sort();
  assert.deepEqual(ids, ['trumf']); // only the 0-day-min coupon survives
});

test('NAF applies to TUI, not Apollo; OBOS the reverse', () => {
  const today = '2026-06-01';
  const tui = { ...apolloDeal, operator: 'tui' };
  const apolloIds = applicableCoupons(apolloDeal, today).map((c) => c.id);
  const tuiIds = applicableCoupons(tui, today).map((c) => c.id);
  assert.ok(apolloIds.includes('obos') && !apolloIds.includes('naf'));
  assert.ok(tuiIds.includes('naf') && !tuiIds.includes('obos'));
});

test('Ving gets Coop as a label-only coupon (no kr value)', () => {
  const ving = { ...apolloDeal, operator: 'ving' };
  const coupons = applicableCoupons(ving, '2026-06-01');
  assert.deepEqual(coupons.map((c) => c.id), ['coop']);
  assert.equal(coupons[0].value, null); // amount not yet known → no fabricated number
});

test('couponSummary stacks values and computes net per person', () => {
  const today = '2026-06-01';
  const { total, netPrice, netPerPerson } = couponSummary(apolloDeal, today);
  const expected = 700 + 750; // obos + studentpakken (Trumf moved to TUI)
  assert.equal(total, expected);
  assert.equal(netPrice, 6000 - expected);
  assert.equal(netPerPerson, Math.round((6000 - expected) / 2));
});

test('couponSummary ignores label-only coupons in the total (Coop on Ving)', () => {
  const ving = { ...apolloDeal, operator: 'ving' };
  const { coupons, total, netPrice } = couponSummary(ving, '2026-06-01');
  assert.deepEqual(coupons.map((c) => c.id), ['coop']);
  assert.equal(total, 0); // value is null → contributes nothing
  assert.equal(netPrice, 6000); // price unchanged
});

test('no today → operator-eligible coupons shown ungated by lead time', () => {
  const all = applicableCoupons(apolloDeal, undefined).map((c) => c.id).sort();
  assert.deepEqual(all, ['obos', 'studentpakken']);
});

test('snake_case DB shape is accepted too', () => {
  const dbRow = {
    operator: 'apollo',
    departure_date: '2026-08-01',
    pax: '2v',
    current_price: 6000,
  };
  const ids = applicableCoupons(dbRow, '2026-06-01').map((c) => c.id).sort();
  assert.deepEqual(ids, ['obos', 'studentpakken']);
});
