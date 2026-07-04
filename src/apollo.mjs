import {
  BFF_BASE,
  PAGE_URL,
  USER_AGENT,
  CF_SETTLE_MS,
  DEPARTURE_AIRPORT,
  DURATION_GROUPS,
  HORIZON_DAYS,
  PAX_CONFIGS,
} from './config.mjs';
import { sweepWindow } from './dates.mjs';
import { normalizeProduct, evaluateDeal, seenKey } from './dealrule.mjs';

// ---------------------------------------------------------------------------
// URL builders (pure)
// ---------------------------------------------------------------------------

export function buildCheapestUrl({ durationGroup, startDate, endDate, paxAges }) {
  const q = new URLSearchParams({
    durationGroup: String(durationGroup),
    departureAirportCode: DEPARTURE_AIRPORT,
    startDate,
    endDate,
    paxAges,
  });
  return `${BFF_BASE}/departures/cheapest?${q}`;
}

export function buildProductsUrl({ durationGroup, departureDate, paxAges }) {
  const q = new URLSearchParams({
    departureAirportCode: DEPARTURE_AIRPORT,
    departureDate,
    durationGroup: String(durationGroup),
    paxAges,
  });
  return `${BFF_BASE}/products?${q}`;
}

const BOOKING_BASE =
  'https://www.apollo.no/booking-guide/core/select-unit-and-meal';

/**
 * Deep-link into Apollo's booking flow for a normalized deal. Returns null if
 * the identifiers needed for a working link are missing.
 */
export function buildBookingUrl(p) {
  if (!p.productId || !p.accommodationUri || !p.paxAges) return null;
  const q = new URLSearchParams({
    departureAirportCode: DEPARTURE_AIRPORT,
    paxAges: p.paxAges,
    departureDate: p.departureDate,
    duration: String(p.durationGroup),
    accommodationUri: p.accommodationUri,
    productId: p.productId,
    searchProductCategoryCodes: 'FlightAndHotel',
  });
  if (p.travelAreaUri) q.set('travelAreaUri', p.travelAreaUri);
  return `${BOOKING_BASE}?${q}`;
}

function spanBody({ startDate, endDate }) {
  return {
    IncludeExternalFlights: false,
    IncludeBedbankAccommodations: false,
    SearchSpanStartDate: startDate,
    SearchSpanEndDate: endDate,
  };
}

// ---------------------------------------------------------------------------
// Response shape helpers (pure, defensive)
// ---------------------------------------------------------------------------

/**
 * From a `cheapest` calendar response, return the actual departure dates.
 * Charters only fly certain weekdays, so this is a small set — it bounds how
 * many /products calls stage 2 makes (no need to probe every calendar day).
 */
export function extractDepartureDates(cheapestJson) {
  const departures = cheapestJson?.Departures ?? [];
  const dates = new Set();
  for (const d of departures) {
    const date = d?.DepartureDate;
    if (typeof date === 'string') dates.add(date.slice(0, 10));
  }
  return [...dates].sort();
}

/** Pull the product array out of a /products response regardless of wrapper. */
export function extractProducts(productsJson) {
  if (Array.isArray(productsJson)) return productsJson;
  return (
    productsJson?.Products ??
    productsJson?.products ??
    productsJson?.Items ??
    productsJson?.Results ??
    []
  );
}

// ---------------------------------------------------------------------------
// Orchestration (pure given an injected fetchJson — unit-testable, no browser)
// ---------------------------------------------------------------------------

/**
 * Run a full Apollo sweep.
 *
 * @param {object}   opts
 * @param {string}   opts.todayIso   YYYY-MM-DD anchor for the window
 * @param {function} opts.fetchJson  async (url, body) => parsed JSON
 * @returns {Promise<{deals: object[], stats: object}>}
 *   deals: qualifying deals (normalized product + evaluation + seenKey)
 */
export async function sweepApollo({ todayIso, fetchJson }) {
  const window = sweepWindow(todayIso, HORIZON_DAYS);
  const body = spanBody(window);
  const deals = [];
  let productCalls = 0;
  let departureDateCount = 0;
  // Observability: distinguishes "no cheap deals right now" from "we're failing
  // to read prices" (priced === 0 while productsSeen > 0 ⇒ field paths wrong).
  let productsSeen = 0;
  let priced = 0;
  let minPricePerPerson = null;
  let sampleRaw = null;
  // A sweep is ~230 sequential BFF calls; transient single-call failures are
  // expected. Tolerate them (skip that date/combo, keep going) rather than
  // aborting the whole sweep — and count them so we notice if it's widespread.
  let failedCalls = 0;

  // Sweep each party configuration independently: per-person price and
  // availability differ by party, so the same hotel/date is a distinct deal.
  for (const pax of PAX_CONFIGS) {
    for (const durationGroup of DURATION_GROUPS) {
      // Stage 1: cheap calendar call → which dates actually have departures.
      let dates;
      try {
        const cheapest = await fetchJson(
          buildCheapestUrl({ durationGroup, ...window, paxAges: pax.paxAges }),
          body,
        );
        dates = extractDepartureDates(cheapest);
      } catch (err) {
        failedCalls += 1;
        console.error(`[apollo] cheapest failed (pax=${pax.key} dg=${durationGroup}): ${err.message ?? err}`);
        continue; // skip this party/duration; other combos still run
      }
      departureDateCount += dates.length;

      // Stage 2: one /products call per real departure date → full price detail
      // (BrochurePrice lives only here), evaluate both deal rules per product.
      for (const departureDate of dates) {
        let productsJson;
        try {
          productsJson = await fetchJson(
            buildProductsUrl({ durationGroup, departureDate, paxAges: pax.paxAges }),
            body,
          );
        } catch (err) {
          failedCalls += 1;
          console.error(`[apollo] products failed (pax=${pax.key} dg=${durationGroup} date=${departureDate}): ${err.message ?? err}`);
          continue; // skip this date; the rest of the sweep continues
        }
        productCalls += 1;
        for (const raw of extractProducts(productsJson)) {
          if (sampleRaw === null) sampleRaw = raw;
          productsSeen += 1;
          const p = normalizeProduct(raw, { departureDate, durationGroup, pax: pax.key, paxAges: pax.paxAges });
          if (p.currentPricePerPerson != null) {
            priced += 1;
            if (minPricePerPerson === null || p.currentPricePerPerson < minPricePerPerson) {
              minPricePerPerson = p.currentPricePerPerson;
            }
          }
          const evalResult = evaluateDeal(p);
          if (evalResult.qualifies) {
            deals.push({ ...p, ...evalResult, key: seenKey(p), bookingUrl: buildBookingUrl(p) });
          }
        }
      }
    }
  }

  // When a sweep returns nothing, dump one raw product so a green-but-empty run
  // is self-diagnosing: confirms whether prices are being parsed at all.
  if (deals.length === 0 && sampleRaw !== null) {
    console.error(
      `[apollo] 0 qualifying. productsSeen=${productsSeen} priced=${priced} minPP=${minPricePerPerson}. sample raw product: ` +
        JSON.stringify(sampleRaw).slice(0, 2000),
    );
  }

  return {
    deals,
    stats: {
      paxConfigs: PAX_CONFIGS.map((p) => p.key),
      durationGroups: DURATION_GROUPS,
      departureDates: departureDateCount,
      productCalls,
      failedCalls,
      productsSeen,
      priced,
      minPricePerPerson,
      qualifying: deals.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Browser layer: clear Cloudflare once, then call the BFF via in-page fetch.
// ---------------------------------------------------------------------------

/**
 * Launch headless Chromium, clear the Apollo Cloudflare challenge, and return
 * { fetchJson, close }. fetchJson runs inside the cleared origin so it carries
 * the cf_clearance cookie automatically.
 */
export async function openApolloSession() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const ctx = await browser.newContext({
    userAgent: USER_AGENT,
    locale: 'nb-NO',
    timezoneId: 'Europe/Oslo',
  });
  await ctx.addInitScript(() =>
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined }),
  );
  const page = await ctx.newPage();
  await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(CF_SETTLE_MS); // let CF clearance settle

  // Timeout so a stalled request fails into the retry path instead of hanging
  // the whole sweep until the CI job timeout kills it with nothing persisted.
  const callOnce = (url, body) =>
    page.evaluate(
      async ({ u, b }) => {
        const r = await fetch(u, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(b),
          signal: AbortSignal.timeout(20000),
        });
        const txt = await r.text();
        if (!r.ok) throw new Error(`BFF ${r.status} for ${u}: ${txt.slice(0, 200)}`);
        return JSON.parse(txt);
      },
      { u: url, b: body },
    );

  // Retry a single call on transient failures (network blip / momentary CF
  // re-challenge) with backoff, before letting the sweep skip it.
  const fetchJson = async (url, body, attempts = 3) => {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        return await callOnce(url, body);
      } catch (err) {
        lastErr = err;
        if (i < attempts - 1) await page.waitForTimeout(1000 * 2 ** i); // 1s, 2s
      }
    }
    throw lastErr;
  };

  return { fetchJson, close: () => browser.close() };
}

/** End-to-end: open a cleared session, sweep, close. Returns the sweep result. */
export async function runApollo({ todayIso } = {}) {
  const today = todayIso ?? new Date().toISOString().slice(0, 10);
  const session = await openApolloSession();
  try {
    return await sweepApollo({ todayIso: today, fetchJson: session.fetchJson });
  } finally {
    // A close failure (e.g. browser already crashed) must not mask a
    // successful sweep result.
    await session.close().catch((err) => console.error('[apollo] browser close failed:', err));
  }
}

// CLI smoke test: `node src/apollo.mjs`. Persistence (DB) and email are still
// open design decisions — for now we just print qualifying deals.
if (import.meta.url === `file://${process.argv[1]}`) {
  runApollo()
    .then(({ deals, stats }) => {
      console.error('sweep stats:', JSON.stringify(stats));
      console.log(JSON.stringify(deals, null, 2));
    })
    .catch((err) => {
      console.error('Apollo sweep failed:', err);
      process.exit(1);
    });
}
