// Best-effort, shape-agnostic extraction of deal-like records from arbitrary
// captured JSON. Until a source's exact contract is confirmed (from the
// diagnostics this enables), this lets Ving/TUI surface deals when their
// response uses recognizable field names — and harmlessly returns [] otherwise.

const PP_KEYS = ['pricePerPerson', 'perPersonPrice', 'prisPerPerson', 'pricePerPax', 'unitPrice', 'fromPricePerPerson'];
const PRICE_KEYS = ['price', 'totalPrice', 'currentPrice', 'amount', 'prisTotalt', 'fromPrice', 'totalAmount'];
const ORIG_KEYS = ['brochurePrice', 'originalPrice', 'ordinaryPrice', 'wasPrice', 'førpris', 'forPrice', 'normalPrice', 'priceBeforeDiscount'];
const NAME_KEYS = ['name', 'hotelName', 'title', 'accommodationName', 'hotel', 'productName'];
const DATE_KEYS = ['departureDate', 'date', 'startDate', 'outboundDate', 'travelDate', 'departure'];
const STAR_KEYS = ['stars', 'classification', 'rating', 'categoryRating'];
const URL_KEYS = ['url', 'link', 'productUrl', 'detailUrl', 'bookingUrl', 'href'];
const SEATS_KEYS = ['availability', 'seats', 'seatsLeft', 'availableSeats', 'remaining'];

const ci = (obj, keys) => {
  if (!obj || typeof obj !== 'object') return undefined;
  const lower = {};
  for (const k of Object.keys(obj)) lower[k.toLowerCase()] = obj[k];
  for (const k of keys) {
    const v = lower[k.toLowerCase()];
    if (v != null) return v;
  }
  return undefined;
};

const num = (v) => {
  if (v == null) return null;
  if (typeof v === 'object') v = v.amount ?? v.value ?? v.price;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** Walk a JSON value and collect every array of plain objects, biggest first. */
function findObjectArrays(root, out = [], depth = 0) {
  if (depth > 8 || root == null || typeof root !== 'object') return out;
  if (Array.isArray(root)) {
    if (root.length && root.every((x) => x && typeof x === 'object' && !Array.isArray(x))) out.push(root);
    for (const v of root) findObjectArrays(v, out, depth + 1);
  } else {
    for (const v of Object.values(root)) findObjectArrays(v, out, depth + 1);
  }
  return out;
}

const looksLikeOffer = (o) =>
  ci(o, NAME_KEYS) != null && (ci(o, PP_KEYS) != null || ci(o, PRICE_KEYS) != null);

/**
 * Map captured JSON responses to normalized deal candidates (pre-evaluation).
 * @param {Array<{json:any}>} captured
 * @param {{operator:string}} ctx
 * @returns {object[]} normalized products (operator/hotel/prices/…); may be empty
 */
export function heuristicDeals(captured, { operator }) {
  const offers = [];
  for (const cap of captured) {
    const arrays = findObjectArrays(cap.json).sort((a, b) => b.length - a.length);
    for (const arr of arrays) {
      if (!arr.some(looksLikeOffer)) continue;
      for (const o of arr) if (looksLikeOffer(o)) offers.push(o);
      break; // one best array per response
    }
  }

  return offers.map((o) => {
    const current = num(ci(o, PRICE_KEYS));
    const pp = num(ci(o, PP_KEYS)) ?? (current != null ? current : null);
    const brochure = num(ci(o, ORIG_KEYS));
    const rawUrl = ci(o, URL_KEYS);
    return {
      operator,
      accommodationCode: String(ci(o, ['code', 'id', 'productId', 'accommodationCode']) ?? ci(o, NAME_KEYS) ?? ''),
      departureDate: String(ci(o, DATE_KEYS) ?? '').slice(0, 10) || null,
      durationGroup: num(ci(o, ['duration', 'nights', 'days', 'durationGroup'])),
      pax: null,
      hotel: ci(o, NAME_KEYS) ?? null,
      stars: num(ci(o, STAR_KEYS)),
      currentPrice: current,
      currentPricePerPerson: pp,
      brochurePrice: brochure,
      availability: num(ci(o, SEATS_KEYS)),
      bookingUrl: typeof rawUrl === 'string' ? rawUrl : null,
    };
  });
}

/** Compact, log-safe summary of what was captured (for contract discovery). */
export function summarizeCaptured(captured) {
  return captured.map((c) => ({
    url: c.url.slice(0, 140),
    keys: c.json && typeof c.json === 'object' && !Array.isArray(c.json)
      ? Object.keys(c.json).slice(0, 14)
      : Array.isArray(c.json) ? `array(${c.json.length})` : typeof c.json,
  }));
}
