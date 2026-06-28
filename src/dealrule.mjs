import {
  OPERATOR,
  PRICE_PER_PERSON_THRESHOLD,
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
    distanceToBeach: raw?.DistanceToBeach ?? content?.DistanceToBeach ?? null,
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

/**
 * Apply the locked deal rule to a normalized product.
 * Email if EITHER CurrentPricePerPerson < 3000 OR discount >= 70%.
 *
 * @returns {{ qualifies: boolean, reasons: string[], discount: number|null }}
 */
export function evaluateDeal(p) {
  const reasons = [];

  if (p.currentPricePerPerson != null && p.currentPricePerPerson < PRICE_PER_PERSON_THRESHOLD) {
    reasons.push(`pp ${p.currentPricePerPerson} < ${PRICE_PER_PERSON_THRESHOLD}`);
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
