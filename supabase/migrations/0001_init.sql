-- Ferie schema: current deals (dashboard source) + notification dedup set.
-- The `key` column is the locked deal identity tuple, joined with '|':
--   operator | accommodationCode | departureDate | durationGroup

create table if not exists deals (
  key                       text primary key,
  operator                  text        not null,
  accommodation_code        text,
  departure_date            date        not null,
  duration_group            integer     not null,
  hotel                     text,
  stars                     numeric,
  distance_to_beach         integer,
  availability              integer,
  current_price             numeric,
  current_price_per_person  numeric,
  brochure_price            numeric,
  discount                  numeric,         -- 0..1, null if not computable
  reasons                   text[],          -- why it qualified
  first_seen_at             timestamptz not null default now(),
  last_seen_at              timestamptz not null default now()
);

create index if not exists deals_departure_date_idx on deals (departure_date);
create index if not exists deals_last_seen_idx       on deals (last_seen_at desc);

-- "seen" gates re-notification: a key here means we've already emailed about it.
create table if not exists seen (
  key                text primary key,
  operator           text        not null,
  first_notified_at  timestamptz not null default now()
);

-- Lock both tables down. The scraper uses the service-role key, which bypasses
-- RLS, so enabling RLS with NO policies = service-role-only (no public/anon
-- access via the auto-exposed REST API). A read-only SELECT policy for `anon`
-- can be added later when the dashboard needs it.
alter table deals enable row level security;
alter table seen  enable row level security;
