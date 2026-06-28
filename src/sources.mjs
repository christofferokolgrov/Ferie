import { runApollo } from './apollo.mjs';
import { runVing } from './ving.mjs';
import { runTui } from './tui.mjs';

// Source registry. Each `run()` returns { deals, stats } with deals already
// normalized + evaluated + keyed (operator distinguishes them in the seen-set).
//
// Enable/disable via FERIE_SOURCES (comma list), e.g. FERIE_SOURCES=apollo,ving.
// Default: all three. Apollo is proven; Ving/TUI contracts are being confirmed
// from CI captures, so they may yield nothing (or be blocked) until refined —
// which is fine, the runner is resilient.
const ALL = [
  { name: 'apollo', run: runApollo },
  { name: 'ving', run: runVing },
  { name: 'tui', run: runTui },
];

export function enabledSources(env = process.env) {
  const sel = (env.FERIE_SOURCES ?? '').trim();
  if (!sel) return ALL;
  const want = new Set(sel.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
  return ALL.filter((s) => want.has(s.name));
}

/**
 * Run every enabled source independently and combine their deals. A source that
 * throws (wrong contract, bot wall, network) is logged and skipped — the others
 * still contribute, so one broken source never blocks an alert from another.
 */
export async function sweepAllSources({ log = console.error, env = process.env } = {}) {
  const sources = enabledSources(env);
  const deals = [];
  const perSource = [];

  for (const s of sources) {
    try {
      const res = await s.run();
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
