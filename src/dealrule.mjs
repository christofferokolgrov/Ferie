import {
  OPERATOR,
  PRICE_PER_PERSON_THRESHOLD,
  PRICE_PP_THRESHOLD_4STAR,
  PRICE_PP_THRESHOLD_ALL_INCLUSIVE,
  STAR_THRESHOLD,
  DISCOUNT_THRESHOLD,
} from './config.mjs';

// Pure deal logic. No network, no browser — fully unit-testable.

/**
 * Pull the fields we care about out of a raw Apollo /products entry into a flat
 * shape. Apollo's BFF nests price under `Price` and metadata under `Content`;
 * we read defensively so a missing optional field never throws.
 *
 * @param {object} raw   one product object from the /products response
 * @param {object} ctx   { departureDate, durationGroup, pax, paxAges }
 */
export function normalizeProduct(raw, ctx) {
  const price = raw?.Price ?? {};
  const content = raw?.Content ?? {};
  return {
    operator: OPERATOR,
    accommodationCode:
      raw?.AccommodationCode ?? content?.AccommodationCode ?? null,
    departureDate: ctx.departureDate,
    durationGroup: ctx.durationGroup,
    pax: ctx.pax ?? null,
    paxAges: ctx.paxAges ?? null, // kept for the booking-link builder
    hotel: content?.Name ?? raw?.Name ?? null,
    stars: raw?.Classification ?? content?.Classification ?? null,
    distanceToBeach:
      raw?.DistanceToBeach ?? content?.DistanceToBeach ?? content?.DistanceToCenter ?? null,
    destination: extractDestination(content),
    mealPlan: extractMealPlan(raw),
    availability: raw?.Availability ?? null,
    currentPrice: num(price.CurrentPrice),
    currentPricePerPerson: num(price.CurrentPricePerPerson),
    brochurePrice: num(price.BrochurePrice),
    brochurePricePerPerson: num(price.BrochurePricePerPerson),
    // Identifiers needed to deep-link into Apollo's booking flow.
    accommodationUri: raw?.AccommodationUri ?? null,
    productId: raw?.ProductId ?? null,
    travelAreaUri: raw?.TravelAreaUri ?? raw?.travelAreaUri ?? null,
  };
}

/** True when the meal plan is (ultra) all-inclusive. */
export function isAllInclusive(mealPlan) {
  return mealPlan != null && /inclusive|inkludert/i.test(String(mealPlan));
}

/**
 * The per-person price bar for this deal. Base 3500, raised to 4500 for 4★+ and
 * to 6000 for all-inclusive; the highest applicable tier wins.
 * @returns {{ value: number, tier: string }}
 */
export function priceThreshold(p) {
  let value = PRICE_PER_PERSON_THRESHOLD;
  let tier = '';
  if (p.stars != null && Number(p.stars) >= STAR_THRESHOLD && PRICE_PP_THRESHOLD_4STAR > value) {
    value = PRICE_PP_THRESHOLD_4STAR;
    tier = '4★+';
  }
  if (isAllInclusive(p.mealPlan) && PRICE_PP_THRESHOLD_ALL_INCLUSIVE > value) {
    value = PRICE_PP_THRESHOLD_ALL_INCLUSIVE;
    tier = 'all-inclusive';
  }
  return { value, tier };
}

/**
 * Apply the deal rule to a normalized product.
 * Email if EITHER CurrentPricePerPerson < its tiered bar OR discount >= 70%.
 *
 * @returns {{ qualifies: boolean, reasons: string[], discount: number|null }}
 */
export function evaluateDeal(p) {
  const reasons = [];

  const { value: threshold, tier } = priceThreshold(p);
  if (p.currentPricePerPerson != null && p.currentPricePerPerson < threshold) {
    reasons.push(`pp ${p.currentPricePerPerson} < ${threshold}${tier ? ` (${tier})` : ''}`);
  }

  const discount = computeDiscount(p);
  if (discount != null && discount >= DISCOUNT_THRESHOLD) {
    reasons.push(`${Math.round(discount * 100)}% off`);
  }

  return { qualifies: reasons.length > 0, reasons, discount };
}

/** discount = 1 - CurrentPrice / BrochurePrice, or null if not computable. */
export function computeDiscount(p) {
  if (!p.brochurePrice || p.currentPrice == null) return null;
  if (p.brochurePrice <= 0) return null;
  return 1 - p.currentPrice / p.brochurePrice;
}

/**
 * Stable identity for dedup ("seen" set), per NOTES policy:
 * (operator, accommodationCode, departureDate, duration, pax).
 * pax is included so the same hotel/date alerts once per party configuration.
 */
export function seenKey(p) {
  return [p.operator, p.accommodationCode, p.departureDate, p.durationGroup, p.pax].join('|');
}

function num(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Apollo's Content.LocationBreadcrumbs is [continent, country, area], e.g.
 * ["Europa","Hellas","Ioannina"]. Drop the continent and join → "Hellas – Ioannina".
 */
export function extractDestination(content) {
  const bc = content?.LocationBreadcrumbs;
  if (Array.isArray(bc) && bc.length) {
    const parts = (bc.length > 1 ? bc.slice(1) : bc).filter(Boolean);
    if (parts.length) return parts.join(' – ');
  }
  return content?.Destination ?? content?.Country ?? null;
}

/**
 * Meal plan included in the price, from Apollo's Units[].MealPlans (prefer the
 * one flagged IncludedInPrice). Returns a display name like "Frokostbuffé".
 */
export function extractMealPlan(raw) {
  const units = raw?.Units;
  if (Array.isArray(units)) {
    for (const u of units) {
      const mps = u?.MealPlans;
      if (Array.isArray(mps) && mps.length) {
        const inc = mps.find((m) => m?.IncludedInPrice) ?? mps[0];
        if (inc) return inc.MealPlanName ?? inc.MealPlanCode ?? null;
      }
    }
  }
  return null;
}
