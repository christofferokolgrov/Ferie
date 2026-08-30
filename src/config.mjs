// Locked sweep parameters (shared across sources).
// Decisions made in the design grilling (see NOTES.md):
//   - Poll once a day at 12:00 Norwegian time (cron concern; noted here for reference)
//   - Horizon: fixed cutoff at 2027-01-01 (shrinks as that date approaches)
//   - Durations: 1 week (7) and 2 weeks (14)
//   - Deal rule: CurrentPricePerPerson < 3500 OR discount >= 70%

// Default operator for the Apollo adapter. Other sources set their own.
export const OPERATOR = 'apollo';

// Departure airport we monitor.
export const DEPARTURE_AIRPORT = 'OSL';

// durationGroup values to sweep (7 = 1 week, 14 = 2 weeks).
export const DURATION_GROUPS = [7, 14];

// Fixed cutoff date each sweep looks out to (YYYY-MM-DD). Unlike a rolling
// days-ahead horizon, this stays put — the window shrinks day by day as
// "today" approaches it.
export const HORIZON_END_DATE = '2027-01-01';

// Party configurations to sweep. paxAges is Apollo's comma-separated age list
// (18 = adult). Each party is searched independently (its per-person price and
// availability differ), so `key` is part of the deal identity and is stored on
// every deal. Keep `key` stable — changing it resets dedup for that party.
export const PAX_CONFIGS = [
  { key: '2v', label: '2 voksne', paxAges: '18,18' },
  { key: '2v2b', label: '2 voksne + 2 barn (9, 12)', paxAges: '18,18,9,12' },
  { key: '4v2b', label: '4 voksne + 2 barn (9, 12)', paxAges: '18,18,18,18,9,12' },
];

// ---------------------------------------------------------------------------
// Ving source (see spikes/ving/README.md for the reverse-engineered contract).
// Ving's restplass search is a GraphQL API with NO pax argument — prices are
// strictly per person ("Prisene gjelder for én voksen i delt dobbeltrom"), and
// there is no brochure/original price, so for Ving only the absolute price rule
// can fire (the 70%-off discount rule never applies — no list price exists).
// ---------------------------------------------------------------------------
export const VING_OPERATOR = 'ving';
export const VING_PAGE_URL = 'https://www.ving.no/restplasser';
export const VING_ORIGO_URL = 'https://origo-sc.nltg.com/';
export const VING_MARKET_UNIT = 'vn'; // siteId 3 → mucd 'vn' (Norway)
export const VING_CALLER_APP = 'lastminutesales';
export const VING_BOOKING_BASE = 'https://www.ving.no/restplass-hotell';
export const VING_PAGE_SIZE = 40; // `first:` per GraphQL page

// We monitor PACKAGE deals only (fly + hotell), never flight-only seats.
export const VING_TRIP_TYPE = 'SPECIFIED';

// Party configurations for Ving. Because price is per person and party-
// INDEPENDENT, parties differ only by CAPACITY: a restplass must have enough
// free seats to fit the party. `size` = required free seats; `roomAges` feeds
// Ving's QueryRoomAges in the booking deep-link (adults coded as age 42, kids
// by real age). Keep `key` stable — it's part of the dedup identity.
export const VING_PAX_CONFIGS = [
  { key: '2v', label: '2 voksne', size: 2, roomAges: '42,42' },
  { key: '4v', label: '4 voksne', size: 4, roomAges: '42,42,42,42' },
  { key: '4v2b', label: '4 voksne + 2 barn (9, 12)', size: 6, roomAges: '42,42,42,42,9,12' },
];

// Friendly label lookup for emails/dashboard, keyed by the stable pax key.
// Covers every party key used by any source (Apollo + Ving).
export const PAX_LABEL = Object.fromEntries(
  [...PAX_CONFIGS, ...VING_PAX_CONFIGS].map((p) => [p.key, p.label]),
);

// Operator display names (email + dashboard). The dashboard keeps its own mirror
// in format.js (separate package); keep the two in sync.
export const OPERATOR_LABEL = {
  apollo: 'Apollo',
  ving: 'Ving',
  tui: 'TUI',
  amisol: 'Amisol',
  nazar: 'Nazar',
};

// Deals not re-seen within this window are considered gone: pruned from the
// store on each sweep and hidden by the dashboard. Sweeps run once a day, so
// this must span several runs — at 24 h a single missed or failed sweep would
// wipe the dashboard. 72 h tolerates two consecutive misses before a still-
// listed deal is dropped.
export const DEAL_TTL_HOURS = 72;

// ---------------------------------------------------------------------------
// Finn.no aggregator source (see spikes/finn/README.md). Reaches operators we
// can't scrape directly — primarily TUI (tui.no hard-blocks datacenter IPs),
// plus the small charter brands amisol & nazar. We deliberately EXCLUDE apollo
// & ving here: the direct adapters are richer/fresher (Apollo exposes
// BrochurePrice → discount rule; Ving exposes free seats → party capacity).
// Finn carries neither, so for its operators ONLY the absolute price/pp rule
// applies and party is not modelled (pax = null). Reachable with a plain fetch
// — no browser, no proxy.
// ---------------------------------------------------------------------------
export const FINN_API = 'https://www.finn.no/travel-api/lms/offers';
// Operators sourced via Finn. NOT apollo/ving (those have direct adapters).
export const FINN_OPERATORS = ['tui', 'amisol', 'nazar'];
// Finn's trip-type value for fly+hotel packages (we monitor packages only).
export const FINN_TRIP_TYPE = 'spesifisert';

// Cron cadence — informational; the schedule lives in the runner, not here.
export const POLL_INTERVAL_MIN = 15;

// Deal rule thresholds (NOK). The per-person bar is tiered: a pricier package
// still counts if it's high-star or all-inclusive. The highest applicable tier
// wins (e.g. a 4★ all-inclusive uses the all-inclusive bar).
export const PRICE_PER_PERSON_THRESHOLD = 3500; // base
export const PRICE_PP_THRESHOLD_4STAR = 4500; // when stars >= STAR_THRESHOLD
export const PRICE_PP_THRESHOLD_ALL_INCLUSIVE = 6000; // when meal plan is all-inclusive
export const STAR_THRESHOLD = 4;
export const DISCOUNT_THRESHOLD = 0.7; // softer "look at this" flag

// Endpoints / browser identity (from the resolved Apollo spike).
export const PAGE_URL = 'https://www.apollo.no/restplasser';
export const BFF_BASE =
  'https://bff.apollo.no/product-list/v1/sales-unit/apollono/core';
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// How long to wait after navigation for Cloudflare clearance to settle (ms).
export const CF_SETTLE_MS = 8000;
