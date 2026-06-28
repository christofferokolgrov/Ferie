import {
  BFF_BASE,
  PAGE_URL,
  USER_AGENT,
  CF_SETTLE_MS,
  DEPARTURE_AIRPORT,
  DURATION_GROUPS,
  HORIZON_DAYS,
  PAX_AGES,
} from './config.mjs';
import { sweepWindow } from './dates.mjs';
import { normalizeProduct, evaluateDeal, seenKey } from './dealrule.mjs';

// ---------------------------------------------------------------------------
// URL builders (pure)
// ---------------------------------------------------------------------------

export function buildCheapestUrl({ durationGroup, startDate, endDate }) {
  const q = new URLSearchParams({
    durationGroup: String(durationGroup),
    departureAirportCode: DEPARTURE_AIRPORT,
    startDate,
    endDate,
    paxAges: PAX_AGES,
  });
  return `${BFF_BASE}/departures/cheapest?${q}`;
}

export function buildProductsUrl({ durationGroup, departureDate }) {
  const q = new URLSearchParams({
    departureAirportCode: DEPARTURE_AIRPORT,
    departureDate,
    durationGroup: String(durationGroup),
    paxAges: PAX_AGES,
  });
  return `${BFF_BASE}/products?${q}`;
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

  for (const durationGroup of DURATION_GROUPS) {
    // Stage 1: cheap calendar call → which dates actually have departures.
    const cheapest = await fetchJson(
      buildCheapestUrl({ durationGroup, ...window }),
      body,
    );
    const dates = extractDepartureDates(cheapest);
    departureDateCount += dates.length;

    // Stage 2: one /products call per real departure date → full price detail
    // (BrochurePrice lives only here), evaluate both deal rules per product.
    for (const departureDate of dates) {
      const productsJson = await fetchJson(
        buildProductsUrl({ durationGroup, departureDate }),
        body,
      );
      productCalls += 1;
      for (const raw of extractProducts(productsJson)) {
        if (sampleRaw === null) sampleRaw = raw;
        productsSeen += 1;
        const p = normalizeProduct(raw, { departureDate, durationGroup });
        if (p.currentPricePerPerson != null) {
          priced += 1;
          if (minPricePerPerson === null || p.currentPricePerPerson < minPricePerPerson) {
            minPricePerPerson = p.currentPricePerPerson;
          }
        }
        const evalResult = evaluateDeal(p);
        if (evalResult.qualifies) {
          deals.push({ ...p, ...evalResult, key: seenKey(p) });
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
      durationGroups: DURATION_GROUPS,
      departureDates: departureDateCount,
      productCalls,
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

  const fetchJson = (url, body) =>
    page.evaluate(
      async ({ u, b }) => {
        const r = await fetch(u, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(b),
        });
        const txt = await r.text();
        if (!r.ok) throw new Error(`BFF ${r.status} for ${u}: ${txt.slice(0, 200)}`);
        return JSON.parse(txt);
      },
      { u: url, b: body },
    );

  return { fetchJson, close: () => browser.close() };
}

/** End-to-end: open a cleared session, sweep, close. Returns the sweep result. */
export async function runApollo({ todayIso } = {}) {
  const today = todayIso ?? new Date().toISOString().slice(0, 10);
  const session = await openApolloSession();
  try {
    return await sweepApollo({ todayIso: today, fetchJson: session.fetchJson });
  } finally {
    await session.close();
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
