// Storage port + two implementations.
//
// The pipeline depends only on this minimal interface (a "Store"), so it can be
// driven by an in-memory fake in tests and by Supabase Postgres in production.
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
}

/** Supabase Postgres store. supabase-js is imported lazily so tests need no dep. */
export class SupabaseStore {
  constructor(client) {
    this.client = client;
  }

  static async create({ url, serviceKey }) {
    const { createClient } = await import('@supabase/supabase-js');
    return new SupabaseStore(
      createClient(url, serviceKey, { auth: { persistSession: false } }),
    );
  }

  async getSeenKeys(keys) {
    if (keys.length === 0) return new Set();
    const { data, error } = await this.client
      .from('seen')
      .select('key')
      .in('key', keys);
    if (error) throw new Error(`seen lookup failed: ${error.message}`);
    return new Set((data ?? []).map((r) => r.key));
  }

  async upsertDeals(deals) {
    if (deals.length === 0) return;
    const rows = deals.map(toDealRow);
    const { error } = await this.client
      .from('deals')
      .upsert(rows, { onConflict: 'key' });
    if (error) throw new Error(`deals upsert failed: ${error.message}`);
  }

  async markNotified(deals) {
    if (deals.length === 0) return;
    const rows = deals.map((d) => ({ key: d.key, operator: d.operator }));
    // ignoreDuplicates: a concurrent run may have inserted the same key.
    const { error } = await this.client
      .from('seen')
      .upsert(rows, { onConflict: 'key', ignoreDuplicates: true });
    if (error) throw new Error(`seen insert failed: ${error.message}`);
  }
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
 * Build a Store from the environment. Returns SupabaseStore when configured,
 * otherwise an InMemoryStore (with a warning) so a local run still works.
 */
export async function createStoreFromEnv(env = process.env, log = console.error) {
  const url = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && serviceKey) return SupabaseStore.create({ url, serviceKey });
  log('[storage] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — using in-memory store (no cross-run dedup).');
  return new InMemoryStore();
}
