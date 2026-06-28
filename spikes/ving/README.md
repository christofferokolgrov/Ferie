# Ving feasibility spike — RESOLVED 2026-06-28 ✅

Reverse-engineering of Ving's restplasser data access, same goal as the Apollo
spike. **Outcome: fully cracked.** Ving exposes a clean, unauthenticated GraphQL
search API; the winning pattern is the same in-page-fetch shape as Apollo.

## Run them

```bash
cd spikes/ving
npm i playwright
npx playwright install chromium
node validate.mjs     # the end-to-end proof: live cheapest deals
```

(`node_modules/` is gitignored — reinstall in a fresh session.)

## What each script proves
- `capture.mjs`    — loads `www.ving.no/restplasser` and records the request the
  page makes to the search service. Found: `POST https://origo-sc.nltg.com/`,
  a **GraphQL** API, no auth.
- `findbundle.mjs` — downloads the frontend chunk
  `assets.nltg.com/lastminutesales/lms.f9af0f4639cf27899628.js` and dumps the
  query builder → the full `lmsTrips` argument grammar + node shape.
- `introspect.mjs` — confirms GraphQL **introspection is disabled** (so args
  were recovered from the bundle, not `__schema`).
- `validate.mjs`   — **the winning end-to-end pattern**: clear the site in a
  headless browser, capture the page's own query as a template, mutate only the
  arg values, paginate, and pull live cheapest deals via in-page `fetch()`.

## The contract

- **Endpoint:** `POST https://origo-sc.nltg.com/`
- **Auth:** none. Headers: `content-type: application/json`, `accept:
  application/json`, `marketunit: vn` (Norway; siteId 3 → mucd `vn`),
  `x-caller-app: lastminutesales`.
- **Body:** `{ "query": "{ <attributeCollection?> lmsTrips(<args>) { … } }" }`

### `lmsTrips` arguments (recovered from `buildInput()` in the bundle)
```
first:Int  orderBy: DATE|PRICE  after:"<cursor>"  departureCode:["OSL", …]
destinationCode:["PMI", …]  tripTypes:[SPECIFIED|FLIGHTONLY]
durationFrom:Int  durationTo:Int   (duration is in DAYS: 8 ≈ 1 week, 15 ≈ 2 weeks)
dateFrom:"YYYY-MM-DD"  dateTo:"YYYY-MM-DD"   priceTo:Int
```

### Node shape (per trip)
```
date { day monthShortName dayShortName short raw }   # raw = "2026-06-29T00:00:00"
duration  destinationCode  departureCode  numFreeSeats  serialNumber
departure { caId name }   destinationAirport
offers { tripId  priceFormatted  price  type  hotelCode }   # type: specified | flightOnly
hotel { content { geographical { country { caId url name } resort { caId } area { caId } } } }
```
Plus rich `metadata`: `totalCount, minPrice, maxPrice, hasDurations{…},
countries[{countryCode,name,count,destinations[…]}], departures[], availableDates[]`,
and `pageInfo { endCursor hasNextPage }`.

## Key facts / gotchas (these shape the adapter)

1. **Naked curl is hard-blocked** — origo-sc returns an Akamai-style "request
   has been blocked" page (ref `SVG403…`). The endpoint only works from a
   browser-cleared context, exactly like Apollo's BFF. → scraper stays
   Playwright-in-a-container.
2. **Price is already per-person** ("Prisene gjelder for én voksen i delt
   dobbeltrom"). There is **no pax argument** — so, unlike Apollo, we do NOT
   sweep 3 party configs for Ving. `offers.price` is NOK per person.
3. **No brochure/original price field.** The node carries only `price` — there
   is no list price → the **70%-discount rule cannot be evaluated for Ving**.
   Only the absolute `price < THRESHOLD` rule applies.
4. **`orderBy: PRICE` + selecting `edges` errors server-side** (the error
   response has no CORS header → surfaces as "Failed to fetch"). Use
   `orderBy: DATE` and sort client-side.
5. **Hand-built queries that select `date {…}` are rejected at the network
   level** (XHR status 0 / "Failed to fetch", no CORS header on the block) — but
   the page's own full query, and arg-value mutations of it, are accepted.
   → robust pattern is **capture-the-page-query-as-template + mutate args**
   (self-heals if Ving changes the query). `orderBy: DATE` + `priceTo` +
   `first` + `after` all mutate cleanly.
6. **First in-page call after load is flaky** — warm up or retry with backoff
   (the validate script retries 4× per call).
7. **`tripTypes:[SPECIFIED]`** filters to fly+hotel packages; `FLIGHTONLY` are
   flight-only seats (`hotelCode: "FLYA"`). Decide whether restplass monitoring
   wants packages only.

## Live result (2026-06-28, OSL, priceTo≤3500)
`totalCount=125  minPrice=995  maxPrice=30745`. Cheapest hits included a 995 NOK
OSL→Varna flight-only and sub-3000 fly+hotell packages — contract proven
end-to-end with real data.

## Decisions for the real adapter (`src/ving.mjs`, built 2026-06-28)

**Packages only.** We monitor fly+hotell, never flight-only seats →
`tripTypes:[SPECIFIED]`. (Live: 553 SPECIFIED vs 530 FLIGHTONLY; 13 packages
≤3500, 7 within the 50-day horizon.)

**Party combinations via CAPACITY, not price.** The user asked to sweep 2 adults
/ 4 adults / 4 adults + 2 kids. Confirmed empirically that `lmsTrips` has **no
pax/occupancy argument** — the server rejects `adults`, `numAdults`, `pax`,
`occupancy`, `rooms`, `childAges`, `travellers` all with *"Unknown argument …"*,
and the UI traveller picker fires no new search arg. Ving price is strictly per
person regardless of party. So party size is honored as a **capacity gate**: a
package qualifies for a party iff `numFreeSeats >= party size` (2/4/6). Each
party is a distinct deal (pax in the dedup key), exactly like Apollo, and the
booking deep-link carries that party's `QueryRoomAges` (adults = age 42).

**Booking deep-link** replicates the bundle's `buildUpSellUrl`:
`/restplass-hotell?SelectedDestCd=…&QueryDepDate=YYYYMMDD&SelectedHotCd=<code>&
QueryRoomAges=42,42[,…]&SelectedSerNo=<serial>&QueryDepID=<depCaId>&price=<pp×headcount>`.
