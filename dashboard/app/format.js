// Shared display helpers + constants for the dashboard.

// Mirrors the scraper's tiered price bars (src/config.mjs). Keep in sync.
export const PP_THRESHOLD = 3500; // base
export const PP_THRESHOLD_4STAR = 4500;
export const PP_THRESHOLD_AI = 6000;

export const isAllInclusive = (mealPlan) =>
  mealPlan != null && /inclusive|inkludert/i.test(String(mealPlan));

/** The per-person bar that applies to a deal row (highest tier wins). */
export function ppThreshold(d) {
  let t = PP_THRESHOLD;
  if (d.stars != null && Number(d.stars) >= 4) t = Math.max(t, PP_THRESHOLD_4STAR);
  if (isAllInclusive(d.meal_plan)) t = Math.max(t, PP_THRESHOLD_AI);
  return t;
}
export const STALE_MS = 2 * 60 * 60 * 1000; // not seen in last sweep window → dim
export const NEW_MS = 90 * 60 * 1000; // first seen this recently → "NEW"

export const PAX_LABEL = {
  '2v': '2 voksne',
  '2v2b': '2 voksne + 2 barn',
  '4v2b': '4 voksne + 2 barn',
};

export const OPERATOR_LABEL = { apollo: 'Apollo', ving: 'Ving', tui: 'TUI', amisol: 'Amisol', nazar: 'Nazar' };

export const nok = (n) =>
  n == null ? '–' : `${Math.round(Number(n)).toLocaleString('nb-NO')} kr`;

export function fmtDate(d) {
  if (!d) return '–';
  return new Date(d).toLocaleDateString('nb-NO', { day: '2-digit', month: 'short' });
}

/** Return date = departure + duration nights, as YYYY-MM-DD (or null). */
export function returnDate(departure, days) {
  if (!departure || !days) return null;
  const d = new Date(`${String(departure).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

/** Absolute savings vs brochure price (kr), or null. */
export function savings(d) {
  if (d.brochure_price == null || d.current_price == null) return null;
  const s = Number(d.brochure_price) - Number(d.current_price);
  return s > 0 ? s : null;
}

export function fmtSeen(iso, now = Date.now()) {
  if (!iso) return '–';
  const mins = Math.round((now - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// ---- Stackable membership coupons -----------------------------------------
// Mirrors src/coupons.mjs (separate package — keep in sync). Simplified model:
// assume coupons stack on the deal price, gate primarily on days-before-departure.
// Computed at render time (eligibility shrinks daily), never stored.
export const COUPONS = [
  { id: 'obos', label: 'OBOS', operators: ['apollo'], type: 'per_person', amount: 350, minDaysBefore: 30 },
  { id: 'studentpakken', label: 'Studentpakken', operators: ['apollo'], type: 'per_booking', amount: 750, minDaysBefore: 30 },
  { id: 'naf', label: 'NAF', operators: ['tui'], type: 'per_person', amount: 600, minDaysBefore: 30 },
  { id: 'trumf', label: 'Trumf', operators: ['apollo', 'tui'], type: 'cashback_pct', amount: 0.01, minDaysBefore: 0 },
];

const PAX_HEADCOUNT = { '2v': 2, '2v2b': 4, '4v2b': 6 };

function headcount(d) {
  if (d.pax && PAX_HEADCOUNT[d.pax] != null) return PAX_HEADCOUNT[d.pax];
  return null;
}

function leadDays(departure, now) {
  if (!departure) return null;
  const dep = Date.parse(`${String(departure).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(dep)) return null;
  return Math.round((dep - now) / 86400000);
}

/** Stacked-coupon summary for a deal row. `now` is epoch ms. */
export function couponSummary(d, now = Date.now()) {
  const heads = headcount(d);
  const price = d.current_price == null ? null : Number(d.current_price);
  const lead = leadDays(d.departure_date, now);
  const coupons = COUPONS
    .filter((c) => c.operators.includes(d.operator))
    .filter((c) => lead == null || lead >= c.minDaysBefore)
    .map((c) => {
      let value = null;
      if (c.type === 'per_person') value = heads != null ? c.amount * heads : null;
      else if (c.type === 'per_booking') value = c.amount;
      else if (c.type === 'cashback_pct') value = price != null ? Math.round(price * c.amount) : null;
      return { id: c.id, label: c.label, value };
    });
  const total = coupons.reduce((s, c) => s + (c.value ?? 0), 0);
  const netPrice = price != null ? Math.max(0, price - total) : null;
  const netPerPerson = netPrice != null && heads ? Math.round(netPrice / heads) : null;
  return { coupons, total, netPerPerson };
}
