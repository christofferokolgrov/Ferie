import { createClient } from '@supabase/supabase-js';
import RunButton from './RunButton';
import DealsTable from './DealsTable';
import { fmtSeen, PP_THRESHOLD, PP_THRESHOLD_4STAR, PP_THRESHOLD_AI, DEAL_TTL_HOURS } from './format';

// Always fetch fresh on each request (low traffic; we want current deals).
export const dynamic = 'force-dynamic';

async function getDeals() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { deals: [], error: 'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars.' };
  }
  // force-dynamic means this hits Supabase every request — a transient network
  // failure must degrade to the friendly error box, not crash the page.
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const cutoff = new Date(Date.now() - DEAL_TTL_HOURS * 3600_000).toISOString();
    const { data, error } = await supabase
      .from('deals')
      .select('*')
      .gt('last_seen_at', cutoff) // hide deals that have aged out (also pruned server-side)
      .order('current_price_per_person', { ascending: true, nullsFirst: false })
      .limit(500);
    if (error) return { deals: [], error: error.message };
    return { deals: data ?? [], error: null };
  } catch (err) {
    return { deals: [], error: `Supabase request failed: ${err?.message ?? err}` };
  }
}

export default async function Page() {
  const { deals, error } = await getDeals();
  const now = Date.now();
  const lastUpdated = deals.reduce(
    (m, d) => (d.last_seen_at && d.last_seen_at > m ? d.last_seen_at : m),
    '',
  );

  return (
    <main>
      <div className="topbar">
        <div>
          <h1>🏖️ Ferie — restplasser fra Oslo</h1>
          <div className="sub">
            {deals.length} qualifying deal{deals.length === 1 ? '' : 's'}
            {lastUpdated ? ` · last sweep ${fmtSeen(lastUpdated, now)}` : ''}
            <br />
            under {PP_THRESHOLD} kr/pp · 4★+ {PP_THRESHOLD_4STAR} · all-incl {PP_THRESHOLD_AI} · or ≥70% off
          </div>
        </div>
        <RunButton />
      </div>

      {error ? (
        <div className="error">⚠️ {error}</div>
      ) : deals.length === 0 ? (
        <div className="empty">No deals stored yet. The next sweep will populate this.</div>
      ) : (
        <DealsTable deals={deals} now={now} />
      )}
    </main>
  );
}
