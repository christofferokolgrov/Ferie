import { createClient } from '@supabase/supabase-js';

// Always fetch fresh on each request (low traffic; we want current deals).
export const dynamic = 'force-dynamic';

const PAX_LABEL = {
  '2v': '2 voksne',
  '2v2b': '2 voksne + 2 barn',
  '4v2b': '4 voksne + 2 barn',
};

const STALE_MS = 2 * 60 * 60 * 1000; // not seen in last 2h → dim it

const nok = (n) =>
  n == null ? '–' : `${Math.round(Number(n)).toLocaleString('nb-NO')} kr`;

function fmtDate(d) {
  if (!d) return '–';
  return new Date(d).toLocaleDateString('nb-NO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function fmtSeen(d) {
  if (!d) return '–';
  const mins = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

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
  const lastUpdated = deals.reduce(
    (m, d) => (d.last_seen_at && d.last_seen_at > m ? d.last_seen_at : m),
    '',
  );

  return (
    <main>
      <header>
        <h1>🏖️ Ferie — restplasser fra Oslo</h1>
        <div className="sub">
          {deals.length} qualifying deal{deals.length === 1 ? '' : 's'} (under 3000 kr/pp or ≥70% off)
          {lastUpdated ? ` · last sweep ${fmtSeen(lastUpdated)}` : ''}
        </div>
      </header>

      {error ? (
        <div className="table-wrap"><div className="error">⚠️ {error}</div></div>
      ) : deals.length === 0 ? (
        <div className="table-wrap"><div className="empty">No deals stored yet. The next sweep will populate this.</div></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Hotel</th>
                <th>Pr. person</th>
                <th>Discount</th>
                <th>Departure</th>
                <th>Days</th>
                <th>Party</th>
                <th>Seats</th>
                <th>Seen</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => {
                const stale = d.last_seen_at
                  ? Date.now() - new Date(d.last_seen_at).getTime() > STALE_MS
                  : true;
                const cheap = d.current_price_per_person != null && Number(d.current_price_per_person) < 3000;
                const disc = d.discount != null ? Math.round(Number(d.discount) * 100) : null;
                return (
                  <tr key={d.key} className={stale ? 'stale' : undefined}>
                    <td className="hotel">
                      <div className="name">
                        {d.hotel ?? d.accommodation_code ?? 'Unknown'}
                        {d.stars ? ` ★${d.stars}` : ''}
                      </div>
                    </td>
                    <td>
                      <span className={`pp${cheap ? ' cheap' : ''}`}>{nok(d.current_price_per_person)}</span>
                      <div className="total">total {nok(d.current_price)}</div>
                    </td>
                    <td>{disc != null ? <span className="badge disc">{disc}% off</span> : '–'}</td>
                    <td>{fmtDate(d.departure_date)}</td>
                    <td>{d.duration_group ?? '–'}</td>
                    <td>{PAX_LABEL[d.pax] ?? d.pax ?? '–'}</td>
                    <td className={d.availability != null && d.availability <= 2 ? 'seats-low' : undefined}>
                      {d.availability ?? '–'}
                    </td>
                    <td>{fmtSeen(d.last_seen_at)}</td>
                    <td>
                      {d.booking_url ? (
                        <a className="book" href={d.booking_url} target="_blank" rel="noreferrer">Book →</a>
                      ) : '–'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
