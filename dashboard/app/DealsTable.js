'use client';

import { useMemo, useState } from 'react';
import {
  nok, fmtDate, fmtSeen, returnDate, savings, ppThreshold,
  STALE_MS, NEW_MS, PAX_LABEL, OPERATOR_LABEL, couponSummary,
} from './format';

// Sort options each imply a sensible direction — no separate asc/desc toggle.
const SORTS = [
  { key: 'cheapest', label: 'Cheapest', cmp: (a, b) => n(a.current_price_per_person) - n(b.current_price_per_person) },
  { key: 'discount', label: 'Biggest discount', cmp: (a, b) => n(b.discount) - n(a.discount) },
  { key: 'savings', label: 'Biggest savings', cmp: (a, b) => n(savings(b)) - n(savings(a)) },
  { key: 'soonest', label: 'Soonest departure', cmp: (a, b) => String(a.departure_date ?? '').localeCompare(String(b.departure_date ?? '')) },
  { key: 'newest', label: 'Recently added', cmp: (a, b) => t(b.first_seen_at) - t(a.first_seen_at) },
];

const n = (v) => (v == null ? Infinity : Number(v)); // nulls sort last for asc-style
const t = (v) => (v ? new Date(v).getTime() : 0);

export default function DealsTable({ deals, now }) {
  const [sortKey, setSortKey] = useState('cheapest');
  const [source, setSource] = useState('all');

  const sources = useMemo(
    () => ['all', ...Array.from(new Set(deals.map((d) => d.operator).filter(Boolean)))],
    [deals],
  );

  const shown = useMemo(() => {
    const cmp = (SORTS.find((s) => s.key === sortKey) ?? SORTS[0]).cmp;
    return deals.filter((d) => source === 'all' || d.operator === source).slice().sort(cmp);
  }, [deals, sortKey, source]);

  return (
    <>
      <div className="controls">
        <div className="chips">
          {sources.map((s) => (
            <button
              key={s}
              className={`chip${source === s ? ' on' : ''}`}
              onClick={() => setSource(s)}
            >
              {s === 'all' ? 'All' : OPERATOR_LABEL[s] ?? s}
            </button>
          ))}
        </div>
        <label className="sortby">
          Sort
          <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      </div>

      <div className="grid">
        {shown.map((d) => <Card key={d.key} d={d} now={now} />)}
      </div>
      {shown.length === 0 && <div className="empty">No deals match this filter.</div>}
    </>
  );
}

function Card({ d, now }) {
  const stale = d.last_seen_at ? now - new Date(d.last_seen_at).getTime() > STALE_MS : true;
  const isNew = d.first_seen_at ? now - new Date(d.first_seen_at).getTime() < NEW_MS : false;
  const cheap = d.current_price_per_person != null && Number(d.current_price_per_person) < ppThreshold(d);
  const disc = d.discount != null ? Math.round(Number(d.discount) * 100) : null;
  const sav = savings(d);
  const ret = returnDate(d.departure_date, d.duration_group);
  const name = d.hotel ?? d.accommodation_code ?? 'Unknown';
  const lowSeats = d.availability != null && d.availability <= 2;
  const { coupons, netPerPerson } = couponSummary(d, now);

  return (
    <article className={`card${stale ? ' stale' : ''}`}>
      <div className="card-top">
        <div className="title">
          <h3>
            {d.booking_url ? <a href={d.booking_url} target="_blank" rel="noreferrer">{name}</a> : name}
          </h3>
          <div className="sub">
            {d.stars ? <span className="stars">{'★'.repeat(Math.round(Number(d.stars)))}</span> : null}
            {d.destination ? <span className="dest">{d.destination}</span> : null}
          </div>
        </div>
        <span className={`src src-${d.operator}`}>{OPERATOR_LABEL[d.operator] ?? d.operator}</span>
      </div>

      <div className="price">
        <span className={`pp${cheap ? ' cheap' : ''}`}>{nok(d.current_price_per_person)}</span>
        <span className="per">/pp</span>
        {disc != null && <span className="disc">{disc}% off</span>}
        {isNew && <span className="new">NEW</span>}
      </div>
      <div className="price-sub">
        total {nok(d.current_price)}{sav != null && <> · <span className="save">save {nok(sav)}</span></>}
      </div>

      <dl className="facts">
        <div><dt>When</dt><dd>{fmtDate(d.departure_date)}{ret && ` → ${fmtDate(ret)}`} · {d.duration_group ?? '?'}d</dd></div>
        <div><dt>Board</dt><dd>{d.meal_plan ?? '–'}</dd></div>
        <div><dt>Party</dt><dd>{PAX_LABEL[d.pax] ?? d.pax ?? '–'}</dd></div>
        <div><dt>Seats</dt><dd className={lowSeats ? 'low' : ''}>{d.availability ?? '–'}{lowSeats ? ' left!' : ''}</dd></div>
      </dl>

      {coupons.length > 0 && (
        <div className="coupons" title="Medlemsrabatter som antas å stacke oppå prisen — grovt anslag, gated på dager før avreise. Verifiser vilkår hos operatøren.">
          <span className="coupons-label">Stackbare kuponger</span>
          <span className="coupons-tags">
            {coupons.map((c) => (
              <span key={c.id} className="coupon">{c.label}{c.value ? ` −${nok(c.value)}` : ''}</span>
            ))}
          </span>
          {netPerPerson != null && <span className="coupons-net">≈ {nok(netPerPerson)}/pp</span>}
        </div>
      )}

      <div className="card-foot">
        <span className="seen">{fmtSeen(d.last_seen_at, now)}</span>
        {d.booking_url && <a className="book" href={d.booking_url} target="_blank" rel="noreferrer">Book →</a>}
      </div>
    </article>
  );
}
