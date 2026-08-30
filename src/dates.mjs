// Pure date helpers. All work on ISO date strings (YYYY-MM-DD) so the sweep
// is deterministic and unit-testable without a clock.

/** Format a Date as a YYYY-MM-DD string (UTC). */
export function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

/** Add `days` to a YYYY-MM-DD string, returning a YYYY-MM-DD string. */
export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

/**
 * Build the sweep window for a given "today".
 * startDate = today + `minLeadDays` (the minimum lead time before departure),
 * endDate = the fixed horizon cutoff date.
 *
 * The window is empty when startDate > endDate — callers should treat that as
 * "nothing to sweep" rather than querying a backwards range.
 */
export function sweepWindow(todayIso, horizonEndDateIso, minLeadDays = 0) {
  return { startDate: addDays(todayIso, minLeadDays), endDate: horizonEndDateIso };
}
