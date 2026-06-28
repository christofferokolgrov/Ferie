// Membership coupons that stack on top of operator prices.
//
// These are external loyalty/membership discounts (OBOS, Studentpakken, NAF,
// Trumf, …) that a buyer can apply ON TOP of a restplass price. They do NOT
// change whether a deal qualifies — they're surfaced as "you could also stack
// this" hints on a deal that already passed the price/discount rule.
//
// Simplified model (per owner decision, 2026-06-28):
//   1. Assume coupons STACK on the deal price (ignore the operators' formal
//      "cannot be combined with other offers" clauses).
//   2. Gate them PRIMARILY on lead time — number of days before departure.
//      The other real-world constraints (min nights, min spend, age, trip
//      type, exact season) are intentionally not modelled in v1.
//
// Because lead-time eligibility shrinks every day, coupons are computed at
// DISPLAY time (email send / dashboard render) and never stored.
//
// Operator mapping comes from research (see NOTES.md "Membership coupons"):
//   apollo → OBOS, Studentpakken, Trumf      tui → NAF, Trumf      ving → (none yet)

export const COUPONS = [
  {
    id: 'obos',
    label: 'OBOS',
    operators: ['apollo'],
    type: 'per_person', // 350 kr/pers (up to 500 for Mondo Family/Selected)
    amount: 350,
    minDaysBefore: 30,
    note: '350 kr/pers (inntil 500 for Mondo Family/Selected)',
  },
  {
    id: 'studentpakken',
    label: 'Studentpakken',
    operators: ['apollo'],
    type: 'per_booking', // flat 750 kr per booking
    amount: 750,
    minDaysBefore: 30,
    note: '750 kr/bestilling — charter, ikke Norden',
  },
  {
    id: 'naf',
    label: 'NAF',
    operators: ['tui'],
    type: 'per_person', // ~600 kr/pers (campaign figure; standing amount behind login)
    amount: 600,
    minDaysBefore: 30,
    note: 'ca. 600 kr/pers — min 7 netter & 4 000 kr',
  },
  {
    id: 'trumf',
    label: 'Trumf',
    operators: ['apollo', 'tui'],
    type: 'cashback_pct', // 1% within 120 days of departure (3% if booked earlier)
    amount: 0.01,
    minDaysBefore: 0,
    note: '1 % bonus (3 % hvis >120 dager før avreise)',
  },
];

// Headcount per stored party key, with a fallback to counting paxAges ("18,18,9,12").
export const PAX_HEADCOUNT = { '2v': 2, '2v2b': 4, '4v2b': 6 };

export function headcount({ pax, paxAges } = {}) {
  if (pax && PAX_HEADCOUNT[pax] != null) return PAX_HEADCOUNT[pax];
  if (paxAges != null) {
    const n = String(paxAges).split(',').filter((s) => s.trim() !== '').length;
    if (n > 0) return n;
  }
  return null;
}

/** Whole days from `fromIso` to `toIso` (YYYY-MM-DD), or null if unparseable. */
export function daysBetween(fromIso, toIso) {
  const a = Date.parse(`${String(fromIso).slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${String(toIso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/** The kr value of one coupon for a deal, or null if not computable. */
function couponValue(c, { currentPrice, heads }) {
  if (c.type === 'per_person') return heads != null ? c.amount * heads : null;
  if (c.type === 'per_booking') return c.amount;
  if (c.type === 'cashback_pct') {
    return Number.isFinite(currentPrice) ? Math.round(currentPrice * c.amount) : null;
  }
  return null;
}

/**
 * Coupons that could apply to a deal, given a "today" ISO date. Accepts both the
 * camelCase scraper shape (departureDate / currentPrice / paxAges) and the
 * snake_case DB shape (departure_date / current_price / pax_ages).
 *
 * @returns {Array<{id,label,type,note,value:number|null}>}
 */
export function applicableCoupons(deal, todayIso) {
  const operator = deal.operator;
  const departureDate = deal.departureDate ?? deal.departure_date ?? null;
  const currentPrice = Number(deal.currentPrice ?? deal.current_price);
  const heads = headcount({
    pax: deal.pax,
    paxAges: deal.paxAges ?? deal.pax_ages,
  });
  // null today/departure → don't gate on lead time (show everything operator-eligible).
  const lead = todayIso && departureDate ? daysBetween(todayIso, departureDate) : null;

  return COUPONS
    .filter((c) => c.operators.includes(operator))
    .filter((c) => lead == null || lead >= c.minDaysBefore)
    .map((c) => ({
      id: c.id,
      label: c.label,
      type: c.type,
      note: c.note,
      value: couponValue(c, { currentPrice: Number.isFinite(currentPrice) ? currentPrice : null, heads }),
    }));
}

/**
 * Stacked-coupon summary for a deal. Per the simplified model, all applicable
 * coupons stack — their kr values (cashback included) sum into a single extra
 * saving, and netPerPerson is the resulting per-person price estimate.
 *
 * @returns {{ coupons, total:number, netPrice:number|null, netPerPerson:number|null }}
 */
export function couponSummary(deal, todayIso) {
  const coupons = applicableCoupons(deal, todayIso);
  const total = coupons.reduce((sum, c) => sum + (c.value ?? 0), 0);
  const currentPrice = Number(deal.currentPrice ?? deal.current_price);
  const heads = headcount({ pax: deal.pax, paxAges: deal.paxAges ?? deal.pax_ages });
  const netPrice = Number.isFinite(currentPrice) ? Math.max(0, currentPrice - total) : null;
  const netPerPerson = netPrice != null && heads ? Math.round(netPrice / heads) : null;
  return { coupons, total, netPrice, netPerPerson };
}
