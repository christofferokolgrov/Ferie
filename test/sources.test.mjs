import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enabledSources, sweepAllSources } from '../src/sources.mjs';

test('enabledSources: default is all three, FERIE_SOURCES filters + orders by registry', () => {
  assert.deepEqual(enabledSources({}).map((s) => s.name), ['apollo', 'ving', 'finn']);
  assert.deepEqual(enabledSources({ FERIE_SOURCES: 'apollo,finn' }).map((s) => s.name), ['apollo', 'finn']);
  assert.deepEqual(enabledSources({ FERIE_SOURCES: 'finn' }).map((s) => s.name), ['finn']);
});

test('sweepAllSources: a failing source is skipped; others still contribute', async () => {
  const sources = [
    { name: 'apollo', run: async () => ({ deals: [{ key: 'a' }], stats: { qualifying: 1 } }) },
    { name: 'ving', run: async () => { throw new Error('bot wall'); } },
    { name: 'finn', run: async () => ({ deals: [{ key: 'f' }], stats: { qualifying: 1 } }) },
  ];
  const { deals, stats } = await sweepAllSources({ sources, log: () => {} });
  assert.deepEqual(deals.map((d) => d.key), ['a', 'f']);
  assert.equal(stats.qualifying, 2);
  assert.equal(stats.sources.find((s) => s.source === 'ving').ok, false);
  assert.equal(stats.sources.filter((s) => s.ok).length, 2);
});

test('sweepAllSources: todayIso is threaded to each source', async () => {
  const seen = [];
  const sources = [{ name: 'apollo', run: async ({ todayIso }) => { seen.push(todayIso); return { deals: [], stats: {} }; } }];
  await sweepAllSources({ sources, todayIso: '2026-06-28', log: () => {} });
  assert.deepEqual(seen, ['2026-06-28']);
});
