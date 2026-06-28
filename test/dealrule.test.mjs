import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeProduct,
  evaluateDeal,
  computeDiscount,
  seenKey,
  extractDestination,
  extractMealPlan,
  priceThreshold,
  isAllInclusive,
} from '../src/dealrule.mjs';
import { PRICE_PER_PERSON_THRESHOLD as T } from '../src/config.mjs';

const ctx = { departureDate: '2026-07-10', durationGroup: 7, pax: '2v' };

function product(price) {
  return normalizeProduct(
    { AccommodationCode: 'AC1', Content: { Name: 'Hotel Sol' }, Price: price },
    ctx,
  );
}

test('absolute rule: cheap per-person qualifies', () => {
  const pp = T - 100;
  const p = product({ CurrentPrice: pp * 2, CurrentPricePerPerson: pp, BrochurePrice: pp * 2 + 200 });
  const r = evaluateDeal(p);
  assert.equal(r.qualifies, true);
  assert.match(r.reasons.join(' '), new RegExp(`${pp} < ${T}`));
});

test('absolute rule: at threshold does not qualify (strict <)', () => {
  const p = product({ CurrentPrice: T * 2, CurrentPricePerPerson: T, BrochurePrice: T * 2 + 100 });
  const r = evaluateDeal(p);
  assert.equal(r.qualifies, false);
});

test('discount rule: 70% off qualifies even when not cheap per-person', () => {
  // pp at/above threshold so only the discount rule can fire.
  const p = product({ CurrentPrice: T * 2, CurrentPricePerPerson: T, BrochurePrice: T * 2 / 0.3 });
  const r = evaluateDeal(p);
  assert.equal(r.qualifies, true);
  assert.match(r.reasons.join(' '), /70% off/);
});

test('discount rule: 69% off + not cheap does not qualify', () => {
  // pp above threshold and discount below 70%.
  const expensive = product({ CurrentPrice: 6200, CurrentPricePerPerson: T + 200, BrochurePrice: 10000 });
  assert.equal(evaluateDeal(expensive).qualifies, false);
  assert.ok(computeDiscount(expensive) < 0.7);
});

// Build a product with stars and/or an included meal plan.
function productWith(price, { stars, meal } = {}) {
  const raw = { AccommodationCode: 'AC1', Content: { Name: 'H', Classification: stars }, Price: price };
  if (meal) raw.Units = [{ MealPlans: [{ MealPlanName: meal, IncludedInPrice: true }] }];
  return normalizeProduct(raw, ctx);
}

test('isAllInclusive matches AI meal plans', () => {
  assert.equal(isAllInclusive('All Inclusive'), true);
  assert.equal(isAllInclusive('Ultra All Inclusive'), true);
  assert.equal(isAllInclusive('Alt inkludert'), true);
  assert.equal(isAllInclusive('Frokostbuffé'), false);
  assert.equal(isAllInclusive(null), false);
});

test('priceThreshold tiers: base / 4★ / all-inclusive / combined', () => {
  assert.equal(priceThreshold({ stars: 3 }).value, 3500);
  assert.equal(priceThreshold({ stars: 4 }).value, 4500);
  assert.equal(priceThreshold({ stars: 5 }).value, 4500);
  assert.equal(priceThreshold({ stars: 3, mealPlan: 'All Inclusive' }).value, 6000);
  assert.equal(priceThreshold({ stars: 5, mealPlan: 'All Inclusive' }).value, 6000); // highest wins
});

test('4★ raises the bar to 4500', () => {
  assert.equal(evaluateDeal(productWith({ CurrentPrice: 8400, CurrentPricePerPerson: 4200 }, { stars: 4 })).qualifies, true);
  // same price, only 3★ → below 4500 tier doesn't apply, over base 3500 → no
  assert.equal(evaluateDeal(productWith({ CurrentPrice: 8400, CurrentPricePerPerson: 4200 }, { stars: 3 })).qualifies, false);
});

test('all-inclusive raises the bar to 6000', () => {
  const ai = evaluateDeal(productWith({ CurrentPrice: 11000, CurrentPricePerPerson: 5500 }, { stars: 3, meal: 'All Inclusive' }));
  assert.equal(ai.qualifies, true);
  assert.match(ai.reasons.join(' '), /all-inclusive/);
  // 5★ but not AI → bar is 4500, 5500 over it → no
  assert.equal(evaluateDeal(productWith({ CurrentPrice: 11000, CurrentPricePerPerson: 5500 }, { stars: 5, meal: 'Frokostbuffé' })).qualifies, false);
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

test('extractDestination drops the continent and joins breadcrumbs', () => {
  assert.equal(extractDestination({ LocationBreadcrumbs: ['Europa', 'Hellas', 'Ioannina'] }), 'Hellas – Ioannina');
  assert.equal(extractDestination({ LocationBreadcrumbs: ['Hellas'] }), 'Hellas');
  assert.equal(extractDestination({}), null);
});

test('extractMealPlan prefers the included plan', () => {
  const raw = { Units: [{ MealPlans: [
    { MealPlanCode: 'RO', MealPlanName: 'Kun overnatting', IncludedInPrice: false },
    { MealPlanCode: 'BF', MealPlanName: 'Frokostbuffé', IncludedInPrice: true },
  ] }] };
  assert.equal(extractMealPlan(raw), 'Frokostbuffé');
  assert.equal(extractMealPlan({}), null);
});

test('normalizeProduct surfaces destination + meal plan', () => {
  const p = normalizeProduct(
    { Content: { Name: 'H', LocationBreadcrumbs: ['Europa', 'Spania', 'Mallorca'] },
      Units: [{ MealPlans: [{ MealPlanName: 'All Inclusive', IncludedInPrice: true }] }],
      Price: { CurrentPrice: 5000, CurrentPricePerPerson: 2500 } },
    ctx,
  );
  assert.equal(p.destination, 'Spania – Mallorca');
  assert.equal(p.mealPlan, 'All Inclusive');
});

test('seenKey is the locked identity tuple (incl. pax)', () => {
  const p = product({ CurrentPrice: 5000, CurrentPricePerPerson: 2500, BrochurePrice: 6000 });
  assert.equal(seenKey(p), 'apollo|AC1|2026-07-10|7|2v');
});
