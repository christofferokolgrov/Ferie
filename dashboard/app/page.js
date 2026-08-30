import RunButton from './RunButton';
import DealsTable from './DealsTable';
import { fmtSeen, PP_THRESHOLD, PP_THRESHOLD_4STAR, PP_THRESHOLD_AI, DEAL_TTL_HOURS } from './format';

// Always fetch fresh on each request (low traffic; we want current deals).
export const dynamic = 'force-dynamic';

// The sweep commits data/deals.json to the repo, so the raw file *is* the API.
// Public repo -> no token needed. Override for a fork or a private mirror.
const DEALS_URL =
  process.env.DEALS_URL ??
  'https://raw.githubusercontent.com/christofferokolgrov/Ferie/main/data/deals.json';

async function getDeals() {
  // force-dynamic means this refetches every request — a transient network
  // failure must degrade to the friendly error box, not crash the page.
  try {
    const res = await fetch(DEALS_URL, { cache: 'no-store' });
    // A repo without the file yet (404) is "no deals", not an error worth showing.
    if (res.status === 404) return { deals: [], error: null };
    if (!res.ok) return { deals: [], error: `Deal data fetch failed: HTTP ${res.status}` };

    const rows = await res.json();
    if (!Array.isArray(rows)) return { deals: [], error: 'Deal data is not a JSON array.' };

    // Filtering and sorting moved here from the old SQL query: hide deals that
    // have aged out (the sweep prunes them too) and show cheapest first, with
    // unpriced deals last.
    const cutoff = new Date(Date.now() - DEAL_TTL_HOURS * 3600_000).toISOString();
    const deals = rows
      .filter((d) => d.last_seen_at && d.last_seen_at > cutoff)
      .sort((a, b) => {
        const x = a.current_price_per_person;
        const y = b.current_price_per_person;
        if (x == null) return y == null ? 0 : 1;
        if (y == null) return -1;
        return x - y;
      })
      .slice(0, 500);
    return { deals, error: null };
  } catch (err) {
    return { deals: [], error: `Deal data request failed: ${err?.message ?? err}` };
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
