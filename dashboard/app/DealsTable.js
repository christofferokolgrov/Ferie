'use client';

import { useState } from 'react';
import {
  nok, fmtDate, fmtSeen, returnDate, savings,
  PP_THRESHOLD, STALE_MS, NEW_MS, PAX_LABEL, OPERATOR_LABEL,
} from './format';

// Column definitions. `get` is the sort accessor; `num` marks numeric sort.
const COLUMNS = [
  { key: 'hotel', label: 'Hotel', get: (d) => (d.hotel ?? d.accommodation_code ?? '').toLowerCase() },
  { key: 'operator', label: 'Source', get: (d) => d.operator ?? '' },
  { key: 'pp', label: 'Pr. person', num: true, get: (d) => d.current_price_per_person },
  { key: 'savings', label: 'Savings', num: true, get: (d) => savings(d) },
  { key: 'discount', label: 'Discount', num: true, get: (d) => d.discount },
  { key: 'departure', label: 'Departure', get: (d) => d.departure_date ?? '' },
  { key: 'duration', label: 'Days', num: true, get: (d) => d.duration_group },
  { key: 'pax', label: 'Party', sortable: false },
  { key: 'availability', label: 'Seats', num: true, get: (d) => d.availability },
  { key: 'seen', label: 'Seen', num: true, get: (d) => (d.last_seen_at ? new Date(d.last_seen_at).getTime() : 0) },
  { key: 'book', label: '', sortable: false },
];

function sortDeals(deals, key, dir) {
  const col = COLUMNS.find((c) => c.key === key);
  if (!col || !col.get) return deals;
  const mul = dir === 'asc' ? 1 : -1;
  return [...deals].sort((a, b) => {
    const av = col.get(a), bv = col.get(b);
    const an = av == null || av === '', bn = bv == null || bv === '';
    if (an && bn) return 0;
    if (an) return 1; // nulls always last
    if (bn) return -1;
    if (col.num) return (Number(av) - Number(bv)) * mul;
    return String(av).localeCompare(String(bv), 'nb') * mul;
  });
}

export default function DealsTable({ deals, now }) {
  const [sort, setSort] = useState({ key: 'pp', dir: 'asc' });

  function clickHeader(col) {
    if (col.sortable === false) return;
    setSort((s) =>
      s.key === col.key ? { key: col.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: col.key, dir: col.num ? 'asc' : 'asc' },
    );
  }

  const rows = sortDeals(deals, sort.key, sort.dir);
  const arrow = (col) => (sort.key === col.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                onClick={() => clickHeader(col)}
                className={col.sortable === false ? '' : 'sortable'}
                aria-sort={sort.key === col.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
              >
                {col.label}{arrow(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => {
            const stale = d.last_seen_at ? now - new Date(d.last_seen_at).getTime() > STALE_MS : true;
            const isNew = d.first_seen_at ? now - new Date(d.first_seen_at).getTime() < NEW_MS : false;
            const cheap = d.current_price_per_person != null && Number(d.current_price_per_person) < PP_THRESHOLD;
            const disc = d.discount != null ? Math.round(Number(d.discount) * 100) : null;
            const sav = savings(d);
            const ret = returnDate(d.departure_date, d.duration_group);
            const name = d.hotel ?? d.accommodation_code ?? 'Unknown';
            return (
              <tr key={d.key} className={stale ? 'stale' : undefined}>
                <td className="hotel">
                  <div className="name">
                    {isNew && <span className="badge new">NEW</span>}{' '}
                    {d.booking_url ? (
                      <a className="hotel-link" href={d.booking_url} target="_blank" rel="noreferrer">{name}</a>
                    ) : name}
                    {d.stars ? ` ★${d.stars}` : ''}
                  </div>
                </td>
                <td><span className={`badge src src-${d.operator}`}>{OPERATOR_LABEL[d.operator] ?? d.operator ?? '–'}</span></td>
                <td>
                  <span className={`pp${cheap ? ' cheap' : ''}`}>{nok(d.current_price_per_person)}</span>
                  <div className="total">total {nok(d.current_price)}</div>
                </td>
                <td>{sav != null ? <span className="save">−{nok(sav)}</span> : '–'}</td>
                <td>{disc != null ? <span className="badge disc">{disc}% off</span> : '–'}</td>
                <td>
                  {fmtDate(d.departure_date)}
                  {ret && <div className="total">→ {fmtDate(ret)}</div>}
                </td>
                <td>{d.duration_group ?? '–'}</td>
                <td>{PAX_LABEL[d.pax] ?? d.pax ?? '–'}</td>
                <td className={d.availability != null && d.availability <= 2 ? 'seats-low' : undefined}>{d.availability ?? '–'}</td>
                <td>{fmtSeen(d.last_seen_at, now)}</td>
                <td>{d.booking_url ? <a className="book" href={d.booking_url} target="_blank" rel="noreferrer">Book →</a> : '–'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
