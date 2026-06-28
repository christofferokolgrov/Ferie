-- Destination (e.g. "Hellas – Ioannina", from Apollo's LocationBreadcrumbs) and
-- the meal plan included in the price (e.g. "Frokostbuffé" / "All Inclusive").
alter table deals add column if not exists destination text;
alter table deals add column if not exists meal_plan text;

create index if not exists deals_destination_idx on deals (destination);
