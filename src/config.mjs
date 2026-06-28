// Locked sweep parameters (shared across sources).
// Decisions made in the design grilling (see NOTES.md):
//   - Poll every 15 min (cron concern; documented here for reference)
//   - Horizon: ~50 days ahead
//   - Durations: 1 week (7) and 2 weeks (14)
//   - Deal rule: CurrentPricePerPerson < 3500 OR discount >= 70%

// Default operator for the Apollo adapter. Other sources set their own.
export const OPERATOR = 'apollo';

// Departure airport we monitor.
export const DEPARTURE_AIRPORT = 'OSL';

// durationGroup values to sweep (7 = 1 week, 14 = 2 weeks).
export const DURATION_GROUPS = [7, 14];

// How far ahead each sweep looks for departures.
export const HORIZON_DAYS = 50;

// Party configurations to sweep. paxAges is Apollo's comma-separated age list
// (18 = adult). Each party is searched independently (its per-person price and
// availability differ), so `key` is part of the deal identity and is stored on
// every deal. Keep `key` stable — changing it resets dedup for that party.
export const PAX_CONFIGS = [
  { key: '2v', label: '2 voksne', paxAges: '18,18' },
  { key: '2v2b', label: '2 voksne + 2 barn (9, 12)', paxAges: '18,18,9,12' },
  { key: '4v2b', label: '4 voksne + 2 barn (9, 12)', paxAges: '18,18,18,18,9,12' },
];

// Friendly label lookup for emails/dashboard, keyed by the stable pax key.
export const PAX_LABEL = Object.fromEntries(
  PAX_CONFIGS.map((p) => [p.key, p.label]),
);

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
