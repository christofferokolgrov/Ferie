import { runApollo } from './apollo.mjs';
import { runVing } from './ving.mjs';
import { runFinn } from './finn.mjs';

// Source registry. Each `run({ todayIso })` returns { deals, stats } with deals
// already normalized + evaluated + keyed (operator distinguishes them in the
// seen-set), so the pipeline treats every source uniformly.
//
// Select with FERIE_SOURCES (comma list), e.g. FERIE_SOURCES=apollo,finn.
// Default: all. A source that throws (bot wall, network, contract drift) is
// logged and skipped — one broken source never blocks another's alert.
const ALL = [
  { name: 'apollo', run: runApollo },
  { name: 'ving', run: runVing },
  { name: 'finn', run: runFinn },
];

export function enabledSources(env = process.env) {
  const sel = (env.FERIE_SOURCES ?? '').trim();
  if (!sel) return ALL;
  const want = new Set(sel.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  return ALL.filter((s) => want.has(s.name));
}

/**
 * Run every enabled source independently and combine their deals.
 * @param {object} [opts]
 * @returns {Promise<{ deals: object[], stats: object }>}
 */
export async function sweepAllSources({ todayIso, log = console.error, env = process.env, sources = enabledSources(env) } = {}) {
  const deals = [];
  const perSource = [];

  for (const s of sources) {
    try {
      const res = await s.run({ todayIso });
      deals.push(...(res?.deals ?? []));
      perSource.push({ source: s.name, ok: true, ...(res?.stats ?? {}) });
      log(`[sources] ${s.name}: ${res?.deals?.length ?? 0} qualifying`);
    } catch (err) {
      perSource.push({ source: s.name, ok: false, error: String(err?.message ?? err) });
      log(`[sources] ${s.name} FAILED (skipped): ${err?.message ?? err}`);
    }
  }

  return { deals, stats: { sources: perSource, qualifying: deals.length } };
}
