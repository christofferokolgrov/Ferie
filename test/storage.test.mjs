import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JsonFileStore, createStoreFromEnv, InMemoryStore } from '../src/storage.mjs';

const mkdir = () => fs.mkdtemp(path.join(os.tmpdir(), 'ferie-store-'));
const deal = (over = {}) => ({
  key: 'apollo|AAA|2026-09-10|7|2v',
  operator: 'apollo',
  accommodationCode: 'AAA',
  departureDate: '2026-09-10',
  durationGroup: 7,
  pax: '2v',
  hotel: 'Sol',
  currentPricePerPerson: 2500,
  reasons: ['pp 2500 < 3500'],
  ...over,
});

test('JsonFileStore persists deals and the seen ledger across instances', async () => {
  const dir = await mkdir();
  const store = await JsonFileStore.create(dir);

  await store.upsertDeals([deal()]);
  await store.markNotified([deal()]);

  // A fresh instance reads what the previous one wrote — this is the whole point.
  const reopened = await JsonFileStore.create(dir);
  const seen = await reopened.getSeenKeys([deal().key, 'ving|other|2026-09-10|7|2v']);
  assert.deepEqual([...seen], [deal().key]);
  assert.equal(reopened.deals.size, 1);
  assert.equal(reopened.deals.get(deal().key).hotel, 'Sol');
  // Stored in the snake_case row shape the dashboard reads.
  assert.equal(reopened.deals.get(deal().key).current_price_per_person, 2500);
});

test('JsonFileStore starts clean when the files do not exist', async () => {
  const dir = await mkdir();
  const store = await JsonFileStore.create(dir);
  assert.deepEqual([...(await store.getSeenKeys(['nope']))], []);
  assert.equal(store.deals.size, 0);
});

test('JsonFileStore treats an empty file as empty, and rejects a non-array', async () => {
  const dir = await mkdir();
  await fs.writeFile(path.join(dir, 'seen.json'), '   ', 'utf8');
  const store = await JsonFileStore.create(dir);
  assert.equal(store.seen.size, 0);

  const bad = await mkdir();
  await fs.writeFile(path.join(bad, 'deals.json'), '{"not":"an array"}', 'utf8');
  await assert.rejects(() => JsonFileStore.create(bad), /expected a JSON array/);
});

test('deleteStale drops aged-out deals but keeps the dedup ledger', async () => {
  const dir = await mkdir();
  const store = await JsonFileStore.create(dir);
  await store.upsertDeals([deal()]);
  await store.markNotified([deal()]);

  // Cutoff in the future -> the deal is stale.
  await store.deleteStale(new Date(Date.now() + 60_000).toISOString());

  const reopened = await JsonFileStore.create(dir);
  assert.equal(reopened.deals.size, 0, 'deal pruned');
  // The ledger survives, so a reappearing deal does not re-notify.
  assert.deepEqual([...(await reopened.getSeenKeys([deal().key]))], [deal().key]);
});

test('files are written sorted, so sweep commits stay readable diffs', async () => {
  const dir = await mkdir();
  const store = await JsonFileStore.create(dir);
  await store.markNotified([deal({ key: 'zzz' }), deal({ key: 'aaa' }), deal({ key: 'mmm' })]);
  await store.upsertDeals([deal({ key: 'zzz' }), deal({ key: 'aaa' })]);

  const seen = JSON.parse(await fs.readFile(path.join(dir, 'seen.json'), 'utf8'));
  assert.deepEqual(seen, ['aaa', 'mmm', 'zzz']);
  const deals = JSON.parse(await fs.readFile(path.join(dir, 'deals.json'), 'utf8'));
  assert.deepEqual(deals.map((d) => d.key), ['aaa', 'zzz']);
});

test('a write leaves no temp file behind', async () => {
  const dir = await mkdir();
  const store = await JsonFileStore.create(dir);
  await store.upsertDeals([deal()]);
  const entries = await fs.readdir(dir);
  assert.deepEqual(entries.sort(), ['deals.json']);
});

test('createStoreFromEnv honours FERIE_DATA_DIR, including :memory:', async () => {
  const dir = await mkdir();
  const fileStore = await createStoreFromEnv({ FERIE_DATA_DIR: dir }, () => {});
  assert.ok(fileStore instanceof JsonFileStore);
  assert.equal(fileStore.dir, dir);

  const memStore = await createStoreFromEnv({ FERIE_DATA_DIR: ':memory:' }, () => {});
  assert.ok(memStore instanceof InMemoryStore);
});
