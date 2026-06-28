# Finn aggregator spike — RESOLVED 2026-06-28 ✅ (this is how we get TUI)

Finn.no's travel vertical (`/reise/restplasser`) aggregates **all** Norwegian
charter operators — apollo, tui, ving, amisol, nazar — plus non-charter flight
resellers, behind **one plain JSON API**. Crucially it is reachable with a
**bare `fetch`/`curl` from a datacenter IP** — no browser, no Cloudflare/Akamai
clearance, no residential proxy. This is the route to **TUI**, which blocks
datacenter IPs on its own site (see `../tui/README.md`).

## Run it
```bash
cd spikes/finn
node offers.mjs tui     # or apollo / ving / amisol / nazar
```
No deps — uses global `fetch`. (Node 18+.)

## The contract
- **Endpoint:** `GET https://www.finn.no/travel-api/lms/offers?<params>` (`lms`
  = last-minute sales). Unauthenticated, JSON, CORS-open, no bot wall.
- The page is a Next.js app; it server-renders the first page into
  `__NEXT_DATA__` and otherwise calls this API. Param names are reflected **1:1**
  from the page URL into the API (the serializer renames nothing).

### Params (discovered from the bundle + by watching `numFound`)
| param | meaning | example / values |
|-------|---------|------------------|
| `fra` | origin airport | `OSL` (matches airportFacet) |
| `med` | operator/supplier | `apollo` `tui` `ving` `amisol` `nazar` `tripx` `sasholidays` `ticket` |
| `type` | trip type | `spesifisert` (fly+hotel **package**), `fly`, `enveisfly`, `uspesifisert` |
| `sorter` | sort order | `pris_lms` (price, **cheapest-first**), `avreise` (departure date) |
| `pageNumber` | page | `1`, `2`, … |
| `lengde` | duration (days) | range |
| `pris` | price per person | acts as a ceiling (`pris=4000` → 0 when min is 4393) |
| `avreise` | departure date | |
| `til` | destination | `locationFacet` name path, e.g. `Europa;Hellas` (bare `tyrkia` → 0) |
| `stjerner` | hotel stars | |

Repeat a key to OR within a facet: `?med=tui&med=amisol`.

### Response
```
{ numFound, totalPages, currentPage,
  offers: [ { offerId, outboundDepartureTime, originAirportCode, originCity,
              destination, region, country, duration, hotelName,
              rating,        // hotel stars (Ving's own API lacked this!)
              tripType, price,   // PER PERSON, NOK
              deepLink,      // operator booking URL (tui.no / bff.apollo.no / …)
              supplier, brand } ],
  airportFacet, supplierFacet:{charter,nonCharter}, typeFacet, locationFacet }
```

## Why this matters
- **TUI: solved.** `med=tui&fra=OSL&type=spesifisert` → ~27.7k OSL packages with
  hotel names, stars, dates, prices, and a real `tui.no/no/bestill-reise` booking
  link (the *user* opens it in their own browser; we never fetch tui.no). Kills
  the residential-proxy requirement entirely.
- **Coverage (OSL packages, 2026-06-28):** apollo 71176 · tui 27686 · ving 5985 ·
  amisol 1988 · nazar 565.
- **Far simpler than Apollo/Ving** — no Playwright, no challenge clearance.
- **Richer than Ving's own API** — carries hotel `rating`/stars.

## Caveats (shape the adapter)
- **No brochure/original price** → the 70%-off discount rule can't fire on Finn
  (same limitation as Ving's own API). Absolute price/pp rule only.
- **No pax argument** → price is per person; party size is a capacity concern
  only (Finn doesn't expose free seats either — so party handling is weaker than
  the direct sources). Booking deepLink defaults to `noOfAdults=2`.
- **Aggregator freshness** may lag the operators' own sites slightly; fine for
  TUI (no alternative) — Apollo & Ving we still get fresher via direct adapters.
- **Per-offer granularity is huge** (every date×hotel×duration is one offer →
  ~27k for TUI OSL). Sort `pris_lms` + stop at the price threshold instead of
  paging everything.

## Recommended use
Add a Finn source scoped to the operators we DON'T scrape directly — **tui (+
amisol, nazar)** — so it complements the direct Apollo/Ving adapters without
double-counting. Apollo stays direct (only direct gives BrochurePrice → discount
rule); Ving stays direct (built + tested). Finn fills the TUI gap and adds the
two small charter brands for free.
