# Design notes / grilling log

## Goal
Personal monitor for restplasser (last-minute package-holiday seats) departing
OSL from Apollo, TUI, Ving. Poll → filter cheap deals → email on a hit →
dashboard of current deals.

## Decisions made
- **Data source:** scraping only; no API exists. Personal use accepted.
- **Hosting instinct:** let a managed platform own the schedule/restarts rather
  than a self-run daemon that can crash silently. GitHub + Supabase + Vercel,
  each doing what it's best at.
- **First source to build:** Apollo (owner choice), despite it being the hardest
  (Cloudflare challenge).

## Feasibility probe — 2026-06-28
Plain `curl` (Chrome UA) from this datacenter IP:
- **Ving** → 200, 318 KB. Listings JS-rendered (no prices in raw HTML). Runs on
  nltg.com infra. Search endpoint reference found: `/websearchresult`. → likely
  a JSON search API to target.
- **Apollo** → 403, `cf-mitigated: challenge`, `server: cloudflare`. Active
  Cloudflare bot challenge ("Just a moment…" + Turnstile). Needs real browser;
  datacenter IPs may still be challenged.
- **TUI** → 403, `server: AkamaiGHost`. Akamai Bot Manager. Hardest; may need a
  residential proxy.

**Reframe:** binding constraint is bot detection + IP reputation, not rendering.
Pushes the scraper to Playwright-in-a-container (not edge/serverless), Supabase
as DB + cron, Vercel as read-only dashboard only.

## Apollo spike — RESOLVED 2026-06-28 ✅
Ran Playwright (headless chromium) from this datacenter container:
- **Cloudflare challenge is cleared by a plain headless browser** — NO residential
  proxy needed. Free approach (A) is viable. (Naked curl still 403s everywhere.)
- Real listings page: `https://www.apollo.no/restplasser` (200, prices render).
- **Apollo has a clean, unauthenticated JSON BFF** at `bff.apollo.no`:
  - `POST /product-list/v1/sales-unit/apollono/core/departures/cheapest`
    `?durationGroup=7&departureAirportCode=OSL&startDate=…&endDate=…&paxAges=18,18`
    body `{"IncludeExternalFlights":false,"IncludeBedbankAccommodations":false,
    "SearchSpanStartDate":"…","SearchSpanEndDate":"…"}`
    → `{"Departures":[{"DepartureDate","Price","PricePerPerson"}], ...}`
  - also `/core/products`, `/filter`, `/departure-airports/OSL/duration-groups`
  - **No auth header / api-key / token.** `departureAirportCode=OSL` is a param.
- **BUT `bff.apollo.no` is ALSO behind the same Cloudflare challenge** — naked curl
  to it gets 403 cf=challenge. The browser reaches it via the `cf_clearance` cookie.
- **Winning pattern (confirmed working):** drive a cleared Playwright browser, then
  call the BFF JSON ourselves via in-page `fetch()` for arbitrary OSL/date queries.
  Returns structured JSON — no HTML parsing.

**Architectural consequence:** scraper MUST be Playwright-in-a-container (not edge/
serverless), since even the JSON API needs browser-obtained CF clearance. Confirms
the container-runner decision; kills the "Supabase Edge Function scrapes" variant.

## Open questions (next grilling branches)
- [ ] What defines a "good" deal? (absolute price? price/person? % below a
      baseline? per-destination thresholds?)
- [ ] Which destinations/dates in scope, or all?
- [ ] Dedup / "seen" semantics — notify once per deal, or again on price drop?
- [ ] Poll frequency.
- [ ] Email: Resend vs M365 SMTP.
- [ ] GitHub: account, repo visibility, auth method.
