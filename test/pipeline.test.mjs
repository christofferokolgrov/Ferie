import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from '../src/pipeline.mjs';
import { InMemoryStore } from '../src/storage.mjs';

function deal(key, pp = 2500) {
  return {
    key,
    operator: 'apollo',
    accommodationCode: key,
    departureDate: '2026-07-10',
    durationGroup: 7,
    hotel: `Hotel ${key}`,
    currentPrice: pp * 2,
    currentPricePerPerson: pp,
    reasons: [`pp ${pp} < 3000`],
  };
}

function fakeMailer() {
  const sent = [];
  return { sent, send: async (deals) => void sent.push(deals) };
}

const noop = () => {};

test('emails new deals and records them as seen', async () => {
  const store = new InMemoryStore();
  const mailer = fakeMailer();
  const sweep = async () => ({ deals: [deal('A'), deal('B')], stats: {} });

  const r = await runPipeline({ sweep, store, mailer, log: noop });

  assert.equal(r.qualifying, 2);
  assert.equal(r.fresh, 2);
  assert.equal(r.notified, true);
  assert.equal(mailer.sent.length, 1);
  assert.equal(mailer.sent[0].length, 2);
  assert.deepEqual([...(await store.getSeenKeys(['A', 'B']))].sort(), ['A', 'B']);
});

test('does not re-email a deal already seen', async () => {
  const store = new InMemoryStore();
  await store.markNotified([deal('A')]);
  const mailer = fakeMailer();
  const sweep = async () => ({ deals: [deal('A'), deal('B')], stats: {} });

  const r = await runPipeline({ sweep, store, mailer, log: noop });

  assert.equal(r.fresh, 1);
  assert.equal(mailer.sent[0].map((d) => d.key).join(), 'B');
});

test('no email when nothing is new', async () => {
  const store = new InMemoryStore();
  await store.markNotified([deal('A')]);
  const mailer = fakeMailer();
  const sweep = async () => ({ deals: [deal('A')], stats: {} });

  const r = await runPipeline({ sweep, store, mailer, log: noop });

  assert.equal(r.notified, false);
  assert.equal(mailer.sent.length, 0);
});

test('upserts all qualifying deals (dashboard) even ones not re-emailed', async () => {
  const store = new InMemoryStore();
  await store.markNotified([deal('A')]);
  const sweep = async () => ({ deals: [deal('A'), deal('B')], stats: {} });

  await runPipeline({ sweep, store, mailer: fakeMailer(), log: noop });

  assert.deepEqual([...store.deals.keys()].sort(), ['A', 'B']);
});

test('prunes stale deals after upserting (deleteStale called with an ISO cutoff)', async () => {
  const calls = [];
  const store = {
    upsertDeals: async () => {},
    getSeenKeys: async () => new Set(),
    markNotified: async () => {},
    deleteStale: async (beforeIso) => { calls.push(beforeIso); },
  };
  await runPipeline({ sweep: async () => ({ deals: [deal('A')], stats: {} }), store, mailer: fakeMailer(), log: noop });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^\d{4}-\d{2}-\d{2}T/); // ISO timestamp
  assert.ok(new Date(calls[0]).getTime() < Date.now()); // cutoff is in the past
});

test('pipeline works with a store that has no deleteStale (back-compat)', async () => {
  const store = {
    upsertDeals: async () => {},
    getSeenKeys: async () => new Set(),
    markNotified: async () => {},
  };
  const r = await runPipeline({ sweep: async () => ({ deals: [deal('A')], stats: {} }), store, mailer: fakeMailer(), log: noop });
  assert.equal(r.fresh, 1); // no throw when deleteStale is absent
});

test('InMemoryStore.deleteStale removes rows older than the cutoff', async () => {
  const store = new InMemoryStore();
  await store.upsertDeals([
    { key: 'old', last_seen_at: '2026-06-01T00:00:00.000Z' },
    { key: 'fresh', last_seen_at: '2026-06-29T00:00:00.000Z' },
    { key: 'notimestamp' }, // no timestamp → kept (safe default)
  ]);
  await store.deleteStale('2026-06-15T00:00:00.000Z');
  assert.deepEqual([...store.deals.keys()].sort(), ['fresh', 'notimestamp']);
});

test('empty sweep is a clean no-op', async () => {
  const mailer = fakeMailer();
  const r = await runPipeline({
    sweep: async () => ({ deals: [], stats: {} }),
    store: new InMemoryStore(),
    mailer,
    log: noop,
  });
  assert.deepEqual(r, { qualifying: 0, fresh: 0, notified: false, stats: {} });
  assert.equal(mailer.sent.length, 0);
});
