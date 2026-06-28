import { createClient } from '@supabase/supabase-js';
import RunButton from './RunButton';
import DealsTable from './DealsTable';
import { fmtSeen, PP_THRESHOLD } from './format';

// Always fetch fresh on each request (low traffic; we want current deals).
export const dynamic = 'force-dynamic';

async function getDeals() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return { deals: [], error: 'Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars.' };
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase
    .from('deals')
    .select('*')
    .order('current_price_per_person', { ascending: true, nullsFirst: false })
    .limit(500);
  if (error) return { deals: [], error: error.message };
  return { deals: data ?? [], error: null };
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
      <header>
        <h1>🏖️ Ferie — restplasser fra Oslo</h1>
        <div className="sub">
          {deals.length} qualifying deal{deals.length === 1 ? '' : 's'} (under {PP_THRESHOLD} kr/pp or ≥70% off)
          {lastUpdated ? ` · last sweep ${fmtSeen(lastUpdated, now)}` : ''} · click a column to sort
        </div>
        <RunButton />
      </header>

      {error ? (
        <div className="table-wrap"><div className="error">⚠️ {error}</div></div>
      ) : deals.length === 0 ? (
        <div className="table-wrap"><div className="empty">No deals stored yet. The next sweep will populate this.</div></div>
      ) : (
        <DealsTable deals={deals} now={now} />
      )}
    </main>
  );
}
