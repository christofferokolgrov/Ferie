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

## Deal rule (v1) — LOCKED 2026-06-28
Email if EITHER:
- `CurrentPricePerPerson < 3000` (NOK), OR
- discount `1 - CurrentPrice/BrochurePrice >= 0.70`

Data source: Apollo `/products` endpoint exposes both, per departure date:
`Price: { CurrentPrice, CurrentPricePerPerson, BrochurePrice,
BrochurePricePerPerson, ShowDiscount }`. The lightweight `cheapest` calendar does
NOT carry BrochurePrice → must hit `/products` per date to evaluate the % rule.
Also available per product: Content.Name (hotel), Classification (stars),
DistanceToBeach, MealPlans, Availability (seats left), lat/long, AccommodationCode.

Caveat: BrochurePrice is the operator's own list price and can be inflated; the
absolute <3000/pp rule is trustworthy, 70%-off is a softer "look at this" flag.

## Notification policy (v1) — LOCKED 2026-06-28
Notify IMMEDIATELY, as soon as a qualifying deal is first noticed (real-time
per-deal email; no daily digest). Keep a "seen" record to avoid re-emailing the
same deal on every poll. Deal identity key:
`(operator, accommodationCode, departureDate, duration)`.
v1 = notify once per newly-seen qualifying deal (simple A). Re-notify-on-price-drop
deferred to later.

## ===== RESUME HERE (next session) =====
### Decisions locked so far
1. Scraping only; no API exists. Personal use.
2. First source: **Apollo** — feasibility SOLVED (see Apollo spike above).
   Pattern: Playwright (headless, container, NO proxy) clears Cloudflare, then
   call clean JSON BFF via in-page fetch. Working spike code in `spikes/apollo/`.
3. Deal rule: email if `CurrentPricePerPerson < 3000` OR discount >= 70%.
4. Notify immediately on first sighting; dedup via seen-key.
5. Stack instinct: Playwright-in-a-container (Render ~$1/mo or existing Lightsail)
   + Supabase (DB + cron) + Vercel (read-only dashboard). Edge/serverless-scrape
   ruled out (CF needs a real browser).
6. GitHub: private repo christofferokolgrov/Ferie, pushed.

### Still open (next grilling branches)
- [ ] Poll frequency (how often the container sweep runs).
- [ ] OSL sweep scope: which durations / how far ahead (90 days?) / all destinations.
- [ ] Email transport: Resend free tier vs Microsoft 365 SMTP.
- [ ] DB schema: deals table + seen table (fields from /products: name, stars,
      beach dist, availability, prices).
- [ ] Where the scraper actually runs (Render vs Lightsail) + how it's triggered.
- [ ] Dashboard scope (what to show; auth needed or just private URL?).
- [ ] Then: replicate for Ving (JS-rendered, /websearchresult) and TUI (Akamai —
      hardest, may need proxy).

### Next action
Continue the grilling on poll frequency + sweep scope, then start building the
Apollo adapter from `spikes/apollo/inpage.mjs`.
