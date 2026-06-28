// Shared display helpers + constants for the dashboard.

export const PP_THRESHOLD = 3500; // matches the scraper's PRICE_PER_PERSON_THRESHOLD
export const STALE_MS = 2 * 60 * 60 * 1000; // not seen in last sweep window → dim
export const NEW_MS = 90 * 60 * 1000; // first seen this recently → "NEW"

export const PAX_LABEL = {
  '2v': '2 voksne',
  '2v2b': '2 voksne + 2 barn',
  '4v2b': '4 voksne + 2 barn',
};

export const OPERATOR_LABEL = { apollo: 'Apollo', ving: 'Ving', tui: 'TUI' };

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
