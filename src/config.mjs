// Locked sweep parameters for the Apollo adapter.
// Decisions made in the design grilling (see NOTES.md):
//   - Poll every 30 min (cron concern; documented here for reference)
//   - Horizon: ~45 days ahead
//   - Durations: 1 week (7) and 2 weeks (14)
//   - Deal rule: CurrentPricePerPerson < 3000 OR discount >= 70%

export const OPERATOR = 'apollo';

// Departure airport we monitor.
export const DEPARTURE_AIRPORT = 'OSL';

// durationGroup values to sweep (7 = 1 week, 14 = 2 weeks).
export const DURATION_GROUPS = [7, 14];

// How far ahead each sweep looks for departures.
export const HORIZON_DAYS = 45;

// Two adults; mirrors the proven spike query (paxAges=18,18).
export const PAX_AGES = '18,18';

// Cron cadence — informational; the schedule lives in the runner, not here.
export const POLL_INTERVAL_MIN = 30;

// Deal rule thresholds (NOK).
export const PRICE_PER_PERSON_THRESHOLD = 3000; // absolute, trustworthy
export const DISCOUNT_THRESHOLD = 0.7; // softer "look at this" flag

// Endpoints / browser identity (from the resolved Apollo spike).
export const PAGE_URL = 'https://www.apollo.no/restplasser';
export const BFF_BASE =
  'https://bff.apollo.no/product-list/v1/sales-unit/apollono/core';
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// How long to wait after navigation for Cloudflare clearance to settle (ms).
export const CF_SETTLE_MS = 8000;
