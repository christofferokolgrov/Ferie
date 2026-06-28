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
 * startDate = today, endDate = today + HORIZON_DAYS.
 */
export function sweepWindow(todayIso, horizonDays) {
  return { startDate: todayIso, endDate: addDays(todayIso, horizonDays) };
}
