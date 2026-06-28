-- Deep link into Apollo's booking flow for the deal (select-unit-and-meal),
-- built from productId + accommodationUri + departureDate + duration + paxAges.
alter table deals add column if not exists booking_url text;
