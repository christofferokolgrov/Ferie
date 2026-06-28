// Finn.no aggregator adapter. Reaches operators we don't scrape directly —
// TUI (tui.no hard-blocks datacenter IPs) plus the small charter brands amisol
// & nazar. Apollo and Ving are intentionally NOT sourced here (we have richer,
// fresher direct adapters for them — see config FINN_OPERATORS / NOTES.md).
//
// Unlike Apollo/Ving, Finn needs NO browser: it's a plain unauthenticated JSON
// API reachable with a bare fetch. So this adapter is just URL building +
// normalization + paging; the network layer is a one-line fetch.
//
// Finn limitations baked in here:
//  - No brochure/list price → the 70%-off discount rule can't fire; only the
//    absolute price/pp rule does (evaluateDeal handles this — brochure null →
//    computeDiscount null).
//  - No pax / free-seats → party is not modelled (pax = null) and availability
//    is null. (Party capacity is the direct Ving adapter's job.)
//  - Price is PER PERSON (NOK), trip type `spesifisert` = fly + hotel package.

import {
  FINN_API,
  FINN_OPERATORS,
  FINN_TRIP_TYPE,
  DEPARTURE_AIRPORT,
  HORIZON_DAYS,
  PRICE_PP_THRESHOLD_4STAR,
  USER_AGENT,
} from './config.mjs';
import { addDays } from './dates.mjs';
import { evaluateDeal, seenKey } from './dealrule.mjs';

// ---------------------------------------------------------------------------
// URL builder (pure). Params discovered in the spike: fra=airport, med=operator
// (repeatable), type=spesifisert, sorter=pris_lms (cheapest-first), pageNumber.
// ---------------------------------------------------------------------------
export function buildFinnUrl({ operators = FINN_OPERATORS, pageNumber = 1 } = {}) {
  const q = new URLSearchParams();
  q.set('fra', DEPARTURE_AIRPORT);
  q.set('type', FINN_TRIP_TYPE);
  for (const op of operators) q.append('med', op); // OR within the supplier facet
  q.set('sorter', 'pris_lms'); // ascending price → lets us stop at the threshold
  q.set('pageNumber', String(pageNumber));
  return `${FINN_API}?${q}`;
}

// ---------------------------------------------------------------------------
// Response + normalization helpers (pure, defensive).
// ---------------------------------------------------------------------------
export function extractOffers(json) {
  return Array.isArray(json?.offers) ? json.offers : [];
}

/** Stable, readable accommodation code from a hotel name (used in the deal key). */
export function hotelSlug(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || null;
}

/**
 * Map a Finn offer to the shared deal shape (same field names as Apollo/Ving so
 * storage/email/dashboard treat it uniformly).
 */
export function normalizeFinnOffer(offer) {
  const pp = num(offer?.price);
  const rating = num(offer?.rating);
  return {
    operator: offer?.supplier ?? null, // 'tui' | 'amisol' | 'nazar'
    accommodationCode: hotelSlug(offer?.hotelName),
    departureDate: (offer?.outboundDepartureTime ?? '').slice(0, 10) || null,
    durationGroup: int(offer?.duration), // days (integer; column is NOT NULL)
    pax: null, // Finn has no party concept
    hotel: offer?.hotelName ?? null,
    destination: joinPlace(offer?.country, offer?.destination), // e.g. "Hellas – Rhodos by"
    mealPlan: null, // Finn's offer JSON carries no board basis → all-inclusive tier can't apply
    stars: rating && rating > 0 ? rating : null, // 0.0 = unrated; feeds the 4★ price tier
    distanceToBeach: null,
    availability: null, // Finn exposes no free-seat count
    currentPricePerPerson: pp,
    currentPrice: null, // per-person only; no defined party total
    brochurePrice: null, // no list price → discount rule can't fire
    brochurePricePerPerson: null,
    bookingUrl: offer?.deepLink ?? null, // full operator booking URL
  };
}

// ---------------------------------------------------------------------------
// Orchestration (pure given an injected fetchOffers — unit-testable, no network).
// ---------------------------------------------------------------------------

/**
 * Sweep Finn for cheap OSL packages from the FINN_OPERATORS.
 *
 * Strategy: offers come back cheapest-first (sorter=pris_lms), so we page until
 * the first offer at/above the HIGHEST bar a Finn deal could clear, then stop —
 * everything beyond is pricier than any tier. evaluateDeal applies the correct
 * tier per offer (base 3500, or 4500 for 4★ via the offer's star rating). The
 * all-inclusive tier (6000) is unreachable for Finn (no board data → mealPlan
 * is null), so the 4★ bar is the effective ceiling we page to.
 *
 * @param {object}   opts
 * @param {string}   opts.todayIso     YYYY-MM-DD anchor for the horizon window
 * @param {function} opts.fetchOffers  async (pageNumber) => parsed JSON page
 */
export async function sweepFinn({ todayIso, fetchOffers }) {
  const STOP_BAR = PRICE_PP_THRESHOLD_4STAR; // highest tier a Finn deal can clear
  const horizonEnd = addDays(todayIso, HORIZON_DAYS);
  const deals = [];
  const MAX_PAGES = 40;
  let page = 1;
  let offersScanned = 0;
  let underBar = 0;
  let outsideHorizon = 0;
  let skippedOther = 0;
  let skippedNoDuration = 0;
  let minPricePerPerson = null;
  let failedPages = 0;
  let reachedBar = false;

  while (page <= MAX_PAGES) {
    let json;
    try {
      json = await fetchOffers(page);
    } catch (err) {
      failedPages += 1;
      console.error(`[finn] page ${page} fetch failed: ${err.message ?? err}`);
      break;
    }
    const offers = extractOffers(json);
    if (offers.length === 0) break;

    for (const offer of offers) {
      offersScanned += 1;
      const pp = num(offer?.price);
      if (pp == null) continue;
      if (minPricePerPerson === null || pp < minPricePerPerson) minPricePerPerson = pp;
      // Ascending sort: once we pass the highest tier, nothing cheaper remains.
      if (pp >= STOP_BAR) { reachedBar = true; break; }
      underBar += 1;

      const p = normalizeFinnOffer(offer);
      // Only operators we deliberately source via Finn — never apollo/ving (they
      // have richer direct adapters) and never a missing supplier. Guards against
      // bundled/related offers Finn might surface beyond the `med=` facet.
      if (!FINN_OPERATORS.includes(p.operator)) {
        skippedOther += 1;
        continue;
      }
      // `deals.duration_group` is NOT NULL; an offer with no/zero parseable
      // duration (null, or '' → 0) would fail or pollute the batch, so drop it.
      if (p.durationGroup == null || p.durationGroup <= 0) {
        skippedNoDuration += 1;
        continue;
      }
      // Keep to the last-minute horizon (same window as Apollo/Ving).
      if (!p.departureDate || p.departureDate < todayIso || p.departureDate > horizonEnd) {
        outsideHorizon += 1;
        continue;
      }
      const evalResult = evaluateDeal(p);
      if (evalResult.qualifies) {
        deals.push({ ...p, ...evalResult, key: seenKey(p), bookingUrl: p.bookingUrl });
      }
    }

    if (reachedBar) break;
    if (json.currentPage != null && json.totalPages != null && json.currentPage >= json.totalPages) break;
    page += 1;
  }

  return {
    deals,
    stats: {
      operator: 'finn',
      operators: FINN_OPERATORS,
      pages: page,
      failedPages,
      offersScanned,
      underBar,
      outsideHorizon,
      skippedOther,
      skippedNoDuration,
      minPricePerPerson,
      qualifying: deals.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Network layer: a plain fetch (no browser). Light retry for transient blips.
// ---------------------------------------------------------------------------
export async function fetchFinnPage(pageNumber, { fetchImpl = fetch, attempts = 3 } = {}) {
  const url = buildFinnUrl({ pageNumber });
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
      if (!res.ok) throw new Error(`Finn ${res.status} for page ${pageNumber}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) await sleep(500 * 2 ** i);
    }
  }
  throw lastErr;
}

/** End-to-end: sweep Finn over the network. Returns the sweep result. */
export async function runFinn({ todayIso } = {}) {
  const today = todayIso ?? new Date().toISOString().slice(0, 10);
  return sweepFinn({ todayIso: today, fetchOffers: (page) => fetchFinnPage(page) });
}

function num(v) {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function int(v) {
  const n = num(v);
  return n == null ? null : Math.trunc(n);
}
/** Join "country – place" like Apollo's destination, dropping blanks/dupes. */
function joinPlace(country, place) {
  const parts = [country, place].map((s) => (s ?? '').trim()).filter(Boolean);
  const uniq = [...new Set(parts)];
  return uniq.length ? uniq.join(' – ') : null;
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// CLI smoke test: `node src/finn.mjs`.
if (import.meta.url === `file://${process.argv[1]}`) {
  runFinn()
    .then(({ deals, stats }) => {
      console.error('sweep stats:', JSON.stringify(stats));
      console.log(JSON.stringify(deals, null, 2));
    })
    .catch((err) => {
      console.error('Finn sweep failed:', err);
      process.exit(1);
    });
}
