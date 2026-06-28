import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProduct,
  evaluateDeal,
  computeDiscount,
  seenKey,
} from '../src/dealrule.mjs';

const ctx = { departureDate: '2026-07-10', durationGroup: 7 };

function product(price) {
  return normalizeProduct(
    { AccommodationCode: 'AC1', Content: { Name: 'Hotel Sol' }, Price: price },
    ctx,
  );
}

test('absolute rule: cheap per-person qualifies', () => {
  const p = product({ CurrentPrice: 5800, CurrentPricePerPerson: 2900, BrochurePrice: 6000 });
  const r = evaluateDeal(p);
  assert.equal(r.qualifies, true);
  assert.match(r.reasons.join(' '), /2900 < 3000/);
});

test('absolute rule: at threshold does not qualify (strict <)', () => {
  const p = product({ CurrentPrice: 6000, CurrentPricePerPerson: 3000, BrochurePrice: 6100 });
  const r = evaluateDeal(p);
  assert.equal(r.qualifies, false);
});

test('discount rule: 70% off qualifies even when not cheap per-person', () => {
  const p = product({ CurrentPrice: 6000, CurrentPricePerPerson: 3500, BrochurePrice: 20000 });
  const r = evaluateDeal(p);
  assert.equal(r.qualifies, true);
  assert.match(r.reasons.join(' '), /70% off/);
});

test('discount rule: 69% off does not qualify', () => {
  const p = product({ CurrentPrice: 3100, CurrentPricePerPerson: 1550, BrochurePrice: 10000 });
  // pp is cheap here so it WOULD qualify on absolute; isolate the discount rule:
  const expensive = product({ CurrentPrice: 6200, CurrentPricePerPerson: 3100, BrochurePrice: 10000 });
  assert.equal(evaluateDeal(expensive).qualifies, false);
  assert.ok(computeDiscount(p) < 0.7);
});

test('computeDiscount returns null without a usable brochure price', () => {
  assert.equal(computeDiscount(product({ CurrentPrice: 5000, CurrentPricePerPerson: 2500 })), null);
  assert.equal(computeDiscount(product({ CurrentPrice: 5000, CurrentPricePerPerson: 2500, BrochurePrice: 0 })), null);
});

test('normalizeProduct reads nested + coerces numeric strings', () => {
  const p = normalizeProduct(
    { AccommodationCode: 'X', Classification: 4, Content: { Name: 'H', DistanceToBeach: 150 }, Price: { CurrentPrice: '5000', CurrentPricePerPerson: '2500' } },
    ctx,
  );
  assert.equal(p.hotel, 'H');
  assert.equal(p.stars, 4);
  assert.equal(p.distanceToBeach, 150);
  assert.equal(p.currentPrice, 5000);
  assert.equal(p.currentPricePerPerson, 2500);
});

test('seenKey is the locked identity tuple', () => {
  const p = product({ CurrentPrice: 5000, CurrentPricePerPerson: 2500, BrochurePrice: 6000 });
  assert.equal(seenKey(p), 'apollo|AC1|2026-07-10|7');
});
