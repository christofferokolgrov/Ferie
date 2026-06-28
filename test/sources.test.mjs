import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enabledSources } from '../src/sources.mjs';
import { heuristicDeals } from '../src/heuristic.mjs';

// Re-implement the combine logic against fake sources to test resilience without
// launching browsers. (sweepAllSources itself imports the real adapters.)
async function combine(sources, log = () => {}) {
  const deals = [];
  const perSource = [];
  for (const s of sources) {
    try {
      const res = await s.run();
      deals.push(...(res?.deals ?? []));
      perSource.push({ source: s.name, ok: true });
    } catch (err) {
      perSource.push({ source: s.name, ok: false, error: String(err?.message ?? err) });
    }
  }
  return { deals, stats: { sources: perSource } };
}

test('enabledSources: default is all three, FERIE_SOURCES filters', () => {
  assert.deepEqual(enabledSources({}).map((s) => s.name), ['apollo', 'ving', 'tui']);
  assert.deepEqual(enabledSources({ FERIE_SOURCES: 'apollo,ving' }).map((s) => s.name), ['apollo', 'ving']);
  assert.deepEqual(enabledSources({ FERIE_SOURCES: 'apollo' }).map((s) => s.name), ['apollo']);
});

test('a failing source is skipped; others still contribute', async () => {
  const sources = [
    { name: 'apollo', run: async () => ({ deals: [{ key: 'a' }], stats: {} }) },
    { name: 'ving', run: async () => { throw new Error('contract not confirmed'); } },
    { name: 'tui', run: async () => ({ deals: [{ key: 't' }], stats: {} }) },
  ];
  const { deals, stats } = await combine(sources);
  assert.deepEqual(deals.map((d) => d.key), ['a', 't']);
  assert.equal(stats.sources.find((s) => s.source === 'ving').ok, false);
  assert.equal(stats.sources.filter((s) => s.ok).length, 2);
});

test('heuristicDeals pulls offer-like records from arbitrary JSON', () => {
  const captured = [
    { json: { results: [
      { hotelName: 'Sol Resort', pricePerPerson: 2490, price: 4980, stars: 4, departureDate: '2026-08-10', url: '/x' },
      { hotelName: 'Dyrt', pricePerPerson: 9000, price: 18000 },
      { somethingElse: true },
    ] } },
  ];
  const out = heuristicDeals(captured, { operator: 'ving' });
  assert.equal(out.length, 2);
  const sol = out.find((o) => o.hotel === 'Sol Resort');
  assert.equal(sol.operator, 'ving');
  assert.equal(sol.currentPricePerPerson, 2490);
  assert.equal(sol.stars, 4);
  assert.equal(sol.departureDate, '2026-08-10');
});

test('heuristicDeals returns [] when nothing looks like an offer', () => {
  assert.deepEqual(heuristicDeals([{ json: { ok: true, count: 0 } }], { operator: 'tui' }), []);
});
