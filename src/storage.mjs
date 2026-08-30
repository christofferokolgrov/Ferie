import { promises as nodeFs } from 'node:fs';
import nodePath from 'node:path';

// Storage port + two implementations.
//
// The pipeline depends only on this minimal interface (a "Store"), so it can be
// driven by an in-memory fake in tests and by JSON files on disk in production.
// There is very little to persist here — a few dozen live deals and an
// append-only dedup ledger — so the production store is two JSON files that the
// sweep workflow commits back to the repo. Git is the database: it gives us
// durability, history and a public read URL for the dashboard, with no external
// service and no secrets.
//
//   getSeenKeys(keys)  -> Promise<Set<string>>   which of these keys we've already notified about
//   upsertDeals(deals) -> Promise<void>          keep the dashboard's "current deals" fresh
//   markNotified(deals)-> Promise<void>          remember we've emailed about these (dedup)

/** In-memory store — used by tests and as a no-DB fallback. */
export class InMemoryStore {
  constructor() {
    this.seen = new Set();
    this.deals = new Map();
  }

  async getSeenKeys(keys) {
    return new Set(keys.filter((k) => this.seen.has(k)));
  }

  async upsertDeals(deals) {
    for (const d of deals) this.deals.set(d.key, d);
  }

  async markNotified(deals) {
    for (const d of deals) this.seen.add(d.key);
  }

  async deleteStale(beforeIso) {
    for (const [k, d] of this.deals) {
      const ts = d.last_seen_at ?? d.lastSeenAt;
      if (ts && ts < beforeIso) this.deals.delete(k);
    }
  }
}

/**
 * JSON-file store — the production store. Keeps two files under `dir`:
 *
 *   deals.json  current qualifying deals (the dashboard's data source)
 *   seen.json   sorted list of deal keys we have already emailed about
 *
 * Every mutation rewrites the file it touches, so the pipeline needs no
 * flush/close step. Writes go through a temp file + rename so an interrupted
 * run can never leave a half-written file behind. Both files are written
 * sorted and pretty-printed: the sweep commits them, and stable ordering keeps
 * those commits to a readable diff instead of a reshuffled blob.
 */
export class JsonFileStore {
  constructor(dir, { deals = [], seen = [] } = {}) {
    this.dir = dir;
    this.dealsPath = nodePath.join(dir, 'deals.json');
    this.seenPath = nodePath.join(dir, 'seen.json');
    this.deals = new Map(deals.map((d) => [d.key, d]));
    this.seen = new Set(seen);
  }

  /** Read the files if they exist; a missing or empty file starts from scratch. */
  static async create(dir) {
    const deals = await readJsonArray(nodePath.join(dir, 'deals.json'));
    const seen = await readJsonArray(nodePath.join(dir, 'seen.json'));
    return new JsonFileStore(dir, { deals, seen });
  }

  async getSeenKeys(keys) {
    return new Set(keys.filter((k) => this.seen.has(k)));
  }

  async upsertDeals(deals) {
    if (deals.length === 0) return;
    for (const d of deals) {
      const row = toDealRow(d);
      this.deals.set(row.key, row);
    }
    await this.#writeDeals();
  }

  async markNotified(deals) {
    if (deals.length === 0) return;
    for (const d of deals) this.seen.add(d.key);
    await this.#writeSeen();
  }

  // Drop deals not re-seen since `beforeIso` — they've dropped off every source.
  // The seen ledger is intentionally left intact: it's the dedup memory, so a
  // pruned deal that later reappears under the same key won't re-trigger an email.
  async deleteStale(beforeIso) {
    let removed = false;
    for (const [key, d] of this.deals) {
      if (d.last_seen_at && d.last_seen_at < beforeIso) {
        this.deals.delete(key);
        removed = true;
      }
    }
    if (removed) await this.#writeDeals();
  }

  async #writeDeals() {
    const rows = [...this.deals.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    await writeJsonAtomic(this.dealsPath, rows);
  }

  async #writeSeen() {
    await writeJsonAtomic(this.seenPath, [...this.seen].sort());
  }
}

/** Read a JSON array from `path`; missing file or empty contents -> []. */
async function readJsonArray(path) {
  let raw;
  try {
    raw = await nodeFs.readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  if (raw.trim() === '') return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`${path}: expected a JSON array`);
  return parsed;
}

/** Write JSON via temp file + rename, so readers never see a partial file. */
async function writeJsonAtomic(path, value) {
  await nodeFs.mkdir(nodePath.dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await nodeFs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await nodeFs.rename(tmp, path);
}

/** Map a normalized+evaluated deal to the `deals` table row (snake_case). */
export function toDealRow(d) {
  return {
    key: d.key,
    operator: d.operator,
    accommodation_code: d.accommodationCode,
    departure_date: d.departureDate,
    duration_group: d.durationGroup,
    pax: d.pax,
    hotel: d.hotel,
    destination: d.destination,
    meal_plan: d.mealPlan,
    stars: d.stars,
    distance_to_beach: d.distanceToBeach,
    availability: d.availability,
    current_price: d.currentPrice,
    current_price_per_person: d.currentPricePerPerson,
    brochure_price: d.brochurePrice,
    discount: d.discount,
    reasons: d.reasons,
    booking_url: d.bookingUrl,
    last_seen_at: new Date().toISOString(),
  };
}

/**
 * Build a Store from the environment. Returns a JsonFileStore over FERIE_DATA_DIR
 * (default `data/`). Set FERIE_DATA_DIR=:memory: to get a throwaway InMemoryStore
 * — useful for a local dry run that must not touch the working tree.
 */
export async function createStoreFromEnv(env = process.env, log = console.error) {
  const dir = env.FERIE_DATA_DIR ?? DEFAULT_DATA_DIR;
  if (dir === ':memory:') {
    log('[storage] FERIE_DATA_DIR=:memory: — using in-memory store (no cross-run dedup).');
    return new InMemoryStore();
  }
  return JsonFileStore.create(dir);
}

// Repo-relative so a sweep started from any cwd writes the same files the
// workflow commits.
export const DEFAULT_DATA_DIR = nodePath.join(
  nodePath.dirname(nodePath.dirname(new URL(import.meta.url).pathname)),
  'data',
);
