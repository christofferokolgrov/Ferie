-- Party configuration the deal was found for (e.g. '2v', '2v2b', '4v2b').
-- Part of the deal identity: the same hotel/date is a distinct deal per party,
-- since per-person price and availability differ.
alter table deals add column if not exists pax text;

create index if not exists deals_pax_idx on deals (pax);
