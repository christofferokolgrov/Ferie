# Apollo feasibility spikes (throwaway, but proven working)

These are the scripts used to resolve Apollo data access on 2026-06-28. They are
proof-of-concept, not production code, but the pattern in `inpage.mjs` is the seed
for the real scraper.

## Run them

```bash
cd spikes/apollo
npm init -y
npm i playwright
npx playwright install --with-deps chromium
npx playwright install chromium-headless-shell   # headless needs this too
node inpage.mjs        # the key one
```

(`node_modules/` is gitignored — reinstall in a fresh session.)

## What each proves
- `spike.mjs`   — headless Chromium clears Apollo's Cloudflare challenge (no proxy).
- `find.mjs`    — finds real URL `https://www.apollo.no/restplasser` + logs the
                  `bff.apollo.no` JSON API calls the page makes.
- `bff.mjs`     — captures the BFF POST payloads/headers (no auth/api-key).
- `inpage.mjs`  — **the winning pattern**: load page (clears CF), then call the BFF
                  JSON ourselves via in-page `fetch()`. Returns structured
                  `{Departures:[{DepartureDate,Price,PricePerPerson}]}`.
- `discount.mjs`— `/products` endpoint exposes `BrochurePrice` (original) vs
                  `CurrentPrice` → lets us compute discount % for the 70%-off rule.

## Key facts
- Naked `curl` is 403'd (CF challenge) on BOTH `www.apollo.no` and `bff.apollo.no`.
- A real headless browser clears CF from a plain datacenter IP → no residential proxy.
- BFF base: `https://bff.apollo.no/product-list/v1/sales-unit/apollono/...`
  - `core/departures/cheapest?...&departureAirportCode=OSL&startDate=&endDate=&durationGroup=7&paxAges=18,18`
  - `core/products?departureAirportCode=OSL&departureDate=YYYY-MM-DD&durationGroup=7&paxAges=18,18`
  - body: `{"IncludeExternalFlights":false,"IncludeBedbankAccommodations":false,"SearchSpanStartDate":"…","SearchSpanEndDate":"…"}`
