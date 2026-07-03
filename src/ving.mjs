// Ving adapter. Mirrors the Apollo adapter's structure: pure logic (URL/body
// builders, response extractors, normalizer, sweep orchestrator) separated from
// the browser/network layer so the sweep is unit-testable without a network.
//
// Two facts from the spike (spikes/ving/README.md) shape this adapter:
//  - Ving's restplass search has NO pax argument: price is strictly per person.
//    So we do NOT run a per-party priced sweep like Apollo. Party size matters
//    only as CAPACITY — a deal qualifies for a party iff numFreeSeats >= size.
//  - No brochure/list price → the 70%-off rule can never fire for Ving; only
//    the absolute price-per-person rule does (evaluateDeal handles this, since
//    computeDiscount returns null without a brochure price).
//
// Network pattern: origo-sc rejects hand-built GraphQL queries at the network
// layer, but accepts the page's OWN query and arg-value mutations of it. So we
// CAPTURE the page's query body as a template, then mutate only the lmsTrips
// arg values (tripTypes, priceTo, dateTo, first, after). This self-heals if
// Ving changes its query shape.

import {
  VING_OPERATOR,
  VING_PAGE_URL,
  VING_ORIGO_URL,
  VING_MARKET_UNIT,
  VING_CALLER_APP,
  VING_BOOKING_BASE,
  VING_PAGE_SIZE,
  VING_TRIP_TYPE,
  VING_PAX_CONFIGS,
  DEPARTURE_AIRPORT,
  HORIZON_DAYS,
  PRICE_PER_PERSON_THRESHOLD,
  USER_AGENT,
  CF_SETTLE_MS,
} from './config.mjs';
import { sweepWindow } from './dates.mjs';
import { evaluateDeal, seenKey, joinDestination } from './dealrule.mjs';
import { launchClearedContext, withRetry } from './browser.mjs';

// ---------------------------------------------------------------------------
// Query body builder (pure) — mutate the captured page template's arg values.
// ---------------------------------------------------------------------------

/**
 * Given the page's captured GraphQL request body (a JSON string like
 * `{"query":"{ … lmsTrips(first:10 orderBy: DATE departureCode:[\"OSL\"]) … }"}`),
 * return a new body with our arg values injected onto the lmsTrips(...) call.
 *
 * We only ever set `first`, and inject extra args right after `orderBy: DATE`
 * (kept as DATE — orderBy: PRICE + edges errors server-side). All injected
 * values are escaped the way they must appear inside the JSON-encoded query.
 */
export function buildVingBody(template, { tripTypes, priceTo, dateTo, first = VING_PAGE_SIZE, after } = {}) {
  let q = template;
  if (first) q = q.replace(/first:\d+/, `first:${first}`);
  const inject = [
    tripTypes && `tripTypes:[${tripTypes}]`,
    priceTo != null && `priceTo:${priceTo}`,
    dateTo && `dateTo:\\"${dateTo}\\"`,
    after && `after:\\"${after}\\"`,
  ].filter(Boolean).join(' ');
  if (inject) q = q.replace('orderBy: DATE', `orderBy: DATE ${inject}`);
  return q;
}

// ---------------------------------------------------------------------------
// Response shape helpers (pure, defensive).
// ---------------------------------------------------------------------------

/** Pull the trip nodes out of a GraphQL response page. */
export function extractTrips(json) {
  return (json?.data?.lmsTrips?.edges ?? [])
    .map((e) => e?.node)
    .filter(Boolean);
}

/** Read pagination info from a response page. */
export function extractPageInfo(json) {
  const pi = json?.data?.lmsTrips?.pageInfo ?? {};
  return { hasNextPage: !!pi.hasNextPage, endCursor: pi.endCursor ?? null };
}

/**
 * Cheapest PACKAGE (fly + hotell) offer on a trip node. Ving marks packages as
 * `type: "specified"`; we ignore flight-only offers entirely. Returns null when
 * the node carries no package offer.
 */
export function cheapestPackageOffer(node) {
  const pkg = (node?.offers ?? []).filter(
    (o) => String(o?.type).toLowerCase() === 'specified' && o?.price != null,
  );
  if (pkg.length === 0) return null;
  return pkg.reduce((min, o) => (o.price < min.price ? o : min));
}

/**
 * One package offer per DISTINCT hotel on a node (cheapest variant of each).
 * A trip node can list several hotels; surfacing each as its own deal avoids
 * dropping hotels and keeps the dedup key (hotelCode) stable across runs
 * instead of churning to whichever hotel is momentarily cheapest.
 */
export function packageOffersByHotel(node) {
  const byHotel = new Map();
  for (const o of node?.offers ?? []) {
    if (String(o?.type).toLowerCase() !== 'specified' || o?.price == null) continue;
    const code = o.hotelCode ?? null;
    const cur = byHotel.get(code);
    if (!cur || o.price < cur.price) byHotel.set(code, o);
  }
  return [...byHotel.values()];
}

// ---------------------------------------------------------------------------
// Normalization → the shared deal shape (same field names as Apollo's
// normalizeProduct, so storage/email/dashboard treat all sources uniformly).
// ---------------------------------------------------------------------------

/**
 * @param {object} node   one trip node from the GraphQL response
 * @param {object} offer  the chosen package offer (cheapestPackageOffer)
 * @param {object} pax    one VING_PAX_CONFIGS entry { key, size, roomAges }
 */
export function normalizeVingTrip(node, offer, pax) {
  const geo = node?.hotel?.content?.geographical ?? {};
  const departureDate = (node?.date?.raw ?? '').slice(0, 10) || null;
  const perPerson = offer?.price ?? null;
  return {
    operator: VING_OPERATOR,
    accommodationCode: offer?.hotelCode ?? null,
    departureDate,
    durationGroup: node?.duration ?? null, // Ving duration is in days (8, 15, …)
    pax: pax.key,
    // Ving's GraphQL list carries no hotel name — identify by destination + code.
    hotel: node?.destinationAirport
      ? `${node.destinationAirport}${offer?.hotelCode ? ` (${offer.hotelCode})` : ''}`
      : offer?.hotelCode ?? null,
    // "country – place", e.g. "Bulgaria – Varna" (matches the dashboard column).
    destination: joinDestination(geo?.country?.name, node?.destinationAirport),
    mealPlan: null, // Ving's restplass list exposes no board basis
    stars: null, // not exposed by the restplass list (so Ving uses the base price tier only)
    distanceToBeach: null,
    availability: node?.numFreeSeats ?? null, // free seats on the trip
    currentPricePerPerson: perPerson,
    // Ving exposes ONLY a per-person price (party-independent); it never quotes a
    // party total, so don't fabricate one — leave currentPrice null (the
    // dashboard shows "total –" rather than a number Ving wouldn't honor).
    currentPrice: null,
    brochurePrice: null, // no list price → no discount possible for Ving
    brochurePricePerPerson: null,
    // Identifiers for the booking deep-link.
    serialNumber: node?.serialNumber ?? null,
    destinationCode: node?.destinationCode ?? null,
    departureCode: node?.departureCode ?? DEPARTURE_AIRPORT,
    departureCaId: node?.departure?.caId ?? null,
    resortCaId: geo?.resort?.caId ?? null,
    countryCaId: geo?.country?.caId ?? null,
    areaCaId: geo?.area?.caId ?? null,
    roomAges: pax.roomAges,
  };
}

/**
 * Deep-link into Ving's restplass→hotel booking flow. Replicates the bundle's
 * buildUpSellUrl(): /restplass-hotell?SelectedDestCd=…&QueryRoomAges=…&…
 * Returns null when key identifiers are missing.
 */
export function buildVingBookingUrl(p) {
  if (!p.serialNumber || !p.accommodationCode || !p.departureDate) return null;
  const headcount = p.roomAges ? p.roomAges.split(',').length : 1;
  const q = [
    `SelectedDestCd=${p.destinationCode ?? ''}`,
    `SelectedDepCd=${p.departureCode ?? DEPARTURE_AIRPORT}`,
    `QueryDepDate=${p.departureDate.replaceAll('-', '')}`,
    `QueryDur=${p.durationGroup ?? ''}`,
    `QueryRoomAges=${p.roomAges ?? '42,42'}`,
    'QueryUnits=1',
    `SelectedHotCd=${p.accommodationCode}`,
    `QueryResID=${p.resortCaId ?? '-1'}`,
    `QueryCtryID=${p.countryCaId ?? '-1'}`,
    `QueryAreaID=${p.areaCaId ?? '-1'}`,
    `QueryDepID=${p.departureCaId ?? ''}`,
    `SelectedSerNo=${p.serialNumber}`,
    `price=${p.currentPricePerPerson != null ? p.currentPricePerPerson * headcount : ''}`,
  ].join('&');
  return `${VING_BOOKING_BASE}?${q}`;
}

// ---------------------------------------------------------------------------
// Orchestration (pure given injected fetchTrips + template — unit-testable).
// ---------------------------------------------------------------------------

/**
 * Run a full Ving sweep over OSL package restplasser.
 *
 * @param {object}   opts
 * @param {string}   opts.todayIso   YYYY-MM-DD anchor for the date window
 * @param {string}   opts.template   captured page GraphQL request body
 * @param {function} opts.fetchTrips async (body) => parsed JSON page
 * @returns {Promise<{deals: object[], stats: object}>}
 */
export async function sweepVing({ todayIso, template, fetchTrips }) {
  const { endDate } = sweepWindow(todayIso, HORIZON_DAYS);

  // Page through all matching packages (priced at/under our bar, within horizon).
  const nodes = [];
  let after = null;
  let pages = 0;
  let failedCalls = 0;
  const MAX_PAGES = 60;
  do {
    const body = buildVingBody(template, {
      tripTypes: VING_TRIP_TYPE,
      priceTo: PRICE_PER_PERSON_THRESHOLD,
      dateTo: endDate,
      first: VING_PAGE_SIZE,
      after,
    });
    let json;
    try {
      json = await fetchTrips(body);
    } catch (err) {
      failedCalls += 1;
      console.error(`[ving] page fetch failed (after=${after}): ${err.message ?? err}`);
      break; // can't paginate further without this page's cursor
    }
    pages += 1;
    nodes.push(...extractTrips(json));
    const pi = extractPageInfo(json);
    after = pi.hasNextPage ? pi.endCursor : null;
  } while (after && pages < MAX_PAGES);

  // Evaluate each package against each party config (capacity-gated).
  const deals = [];
  let tripsSeen = 0;
  let packagesSeen = 0;
  let priced = 0;
  let minPricePerPerson = null;
  let sampleRaw = null;

  for (const node of nodes) {
    tripsSeen += 1;
    if (sampleRaw === null) sampleRaw = node;
    // Each distinct hotel on the node is its own deal (stable per-hotel key).
    for (const offer of packageOffersByHotel(node)) {
      packagesSeen += 1;
      if (offer.price != null) {
        priced += 1;
        if (minPricePerPerson === null || offer.price < minPricePerPerson) {
          minPricePerPerson = offer.price;
        }
      }
      for (const pax of VING_PAX_CONFIGS) {
        // Capacity gate: the trip must seat the whole party.
        if ((node?.numFreeSeats ?? 0) < pax.size) continue;
        const p = normalizeVingTrip(node, offer, pax);
        const evalResult = evaluateDeal(p);
        if (evalResult.qualifies) {
          deals.push({ ...p, ...evalResult, key: seenKey(p), bookingUrl: buildVingBookingUrl(p) });
        }
      }
    }
  }

  if (deals.length === 0 && sampleRaw !== null) {
    console.error(
      `[ving] 0 qualifying. tripsSeen=${tripsSeen} packagesSeen=${packagesSeen} priced=${priced} minPP=${minPricePerPerson}. sample raw node: ` +
        JSON.stringify(sampleRaw).slice(0, 1500),
    );
  }

  return {
    deals,
    stats: {
      operator: VING_OPERATOR,
      paxConfigs: VING_PAX_CONFIGS.map((p) => p.key),
      pages,
      failedCalls,
      tripsSeen,
      packagesSeen,
      priced,
      minPricePerPerson,
      qualifying: deals.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Browser layer: clear the site once, capture the page's own query as a
// template, then expose a retrying in-page fetch.
// ---------------------------------------------------------------------------

/**
 * Launch headless Chromium, load the Ving restplasser page (clears Akamai +
 * primes the in-page fetch context), capture the page's own origo-sc query as
 * a template, and return { template, fetchTrips, close }.
 */
export async function openVingSession() {
  const { browser, page } = await launchClearedContext({
    userAgent: USER_AGENT,
    viewport: { width: 1366, height: 900 },
  });

  let template = null;
  page.on('request', (r) => {
    if (r.url().includes('origo-sc.nltg.com') && !template) template = r.postData();
  });

  await page.goto(VING_PAGE_URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(CF_SETTLE_MS);
  if (!template) {
    await browser.close();
    throw new Error('[ving] did not capture the page origo-sc query template');
  }

  // Timeout so a stalled request fails into the retry path instead of hanging
  // the whole sweep until the CI job timeout kills it with nothing persisted.
  const callOnce = (body) =>
    page.evaluate(
      async ({ url, body, marketUnit, callerApp }) => {
        const r = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            marketunit: marketUnit,
            'x-caller-app': callerApp,
          },
          body,
          signal: AbortSignal.timeout(20000),
        });
        const txt = await r.text();
        if (!r.ok) throw new Error(`origo ${r.status}: ${txt.slice(0, 200)}`);
        return JSON.parse(txt);
      },
      { url: VING_ORIGO_URL, body, marketUnit: VING_MARKET_UNIT, callerApp: VING_CALLER_APP },
    );

  // The first in-page call after load is flaky ("Failed to fetch"); retry with
  // backoff (also covers transient network blips during the sweep).
  const fetchTrips = withRetry(callOnce, {
    attempts: 4,
    baseMs: 800,
    sleep: (ms) => page.waitForTimeout(ms),
  });

  return { template, fetchTrips, close: () => browser.close() };
}

/** End-to-end: open a cleared session, sweep, close. Returns the sweep result. */
export async function runVing({ todayIso } = {}) {
  const today = todayIso ?? new Date().toISOString().slice(0, 10);
  const session = await openVingSession();
  try {
    return await sweepVing({ todayIso: today, template: session.template, fetchTrips: session.fetchTrips });
  } finally {
    // A close failure (e.g. browser already crashed) must not mask a
    // successful sweep result.
    await session.close().catch((err) => console.error('[ving] browser close failed:', err));
  }
}

// CLI smoke test: `node src/ving.mjs`.
if (import.meta.url === `file://${process.argv[1]}`) {
  runVing()
    .then(({ deals, stats }) => {
      console.error('sweep stats:', JSON.stringify(stats));
      console.log(JSON.stringify(deals, null, 2));
    })
    .catch((err) => {
      console.error('Ving sweep failed:', err);
      process.exit(1);
    });
}
