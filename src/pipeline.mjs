// Orchestration: sweep → keep dashboard fresh → prune stale → dedup → email new deals.
// Fully testable: sweep, store and mailer are injected.

import { DEAL_TTL_HOURS } from './config.mjs';

/**
 * @param {object}   deps
 * @param {function} deps.sweep   async () => { deals, stats }
 * @param {object}   deps.store   Store port (storage.mjs)
 * @param {object}   deps.mailer  { send(deals) }
 * @param {function} [deps.log]
 * @returns {Promise<{ qualifying: number, fresh: number, notified: boolean, stats: object }>}
 */
export async function runPipeline({ sweep, store, mailer, log = console.error }) {
  const { deals, stats } = await sweep();
  log(`[pipeline] sweep: ${deals.length} qualifying deal(s). ${JSON.stringify(stats)}`);

  // Keep every currently-qualifying deal in the store (dashboard data source).
  await store.upsertDeals(deals);

  // Prune deals that have dropped off every source (not re-seen within the TTL),
  // so the dashboard doesn't accumulate stale ghosts. Runs every sweep; only
  // removes rows older than the window, so a transient empty sweep is harmless.
  if (typeof store.deleteStale === 'function') {
    const cutoff = new Date(Date.now() - DEAL_TTL_HOURS * 3600_000).toISOString();
    await store.deleteStale(cutoff);
  }

  // Notify once per newly-seen deal (NOTES policy v1).
  const seenKeys = await store.getSeenKeys(deals.map((d) => d.key));
  const fresh = deals.filter((d) => !seenKeys.has(d.key));

  if (fresh.length === 0) {
    log('[pipeline] no new deals to notify.');
    return { qualifying: deals.length, fresh: 0, notified: false, stats };
  }

  log(`[pipeline] ${fresh.length} new deal(s) — sending email.`);
  await mailer.send(fresh);
  await store.markNotified(fresh);

  return { qualifying: deals.length, fresh: fresh.length, notified: true, stats };
}
