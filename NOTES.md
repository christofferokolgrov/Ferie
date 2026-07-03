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

## Poll frequency + sweep scope — LOCKED 2026-06-28
- **Poll frequency:** every **30 min** (cron concern, lives in the runner).
- **Horizon:** **~50 days** ahead (was 45; bumped 2026-06-28) — truest last-minute window; further out is
  mostly non-restplasser noise.
- **Durations:** `durationGroup` **{7, 14}** (1 week + 2 weeks) — the two
  dominant package lengths.
- **Destinations:** all OSL destinations (free — the BFF returns them all per
  date; no per-destination decision needed).

### Two-stage sweep — the cost reframe (implemented)
Naive "call /products for every calendar day × duration" = ~180 heavy calls per
sweep (bot risk + cost driver). Avoided:
- **Stage 1** — `cheapest` calendar, one cheap call per duration. Also reveals
  the **actual departure dates** (charters fly only certain weekdays), so it
  bounds stage 2.
- **Stage 2** — `/products` once per *real* departure date (~30–40 calls total,
  not 90). `/products` is the only endpoint carrying `BrochurePrice`, so this
  gives **full coverage of BOTH deal rules** (no prefilter gap on the softer
  70%-off rule) while staying light.

This collapses a sweep to a handful of calls + one browser launch → broad scope
costs almost nothing; the real constraint is signal/noise, not compute.

## Apollo adapter — BUILT 2026-06-28
Real adapter (not spike) under `src/`, pure logic separated from browser/network
so it's unit-testable without a network (`node --test`, 12 passing):
- `src/config.mjs`   — locked params (OSL, {7,14}, 45d, thresholds, endpoints).
- `src/dates.mjs`    — pure date-window math.
- `src/dealrule.mjs` — `normalizeProduct`, `evaluateDeal` (the locked rule),
  `computeDiscount`, `seenKey` (the locked identity tuple).
- `src/apollo.mjs`   — URL builders, response extractors, `sweepApollo()`
  (orchestrator, takes an injected `fetchJson` → testable), `openApolloSession()`
  (Playwright: clears CF once, exposes in-page `fetchJson`), `runApollo()`, CLI.
- `test/` — `dealrule.test.mjs`, `apollo.test.mjs`.
Run a live smoke test with `npm run sweep:apollo` (needs `playwright` installed
+ `npx playwright install chromium`). DB persistence + email are clean seams —
the sweep just **returns** qualifying deals for now.

## Stack + pipeline — LOCKED 2026-06-28
Grilling resolved the remaining infra branches:
- **Email transport:** **Resend** (free tier, HTTPS API, no SMTP fiddling).
- **Database:** **Supabase Postgres** — `deals` (dashboard source) + `seen`
  (notification dedup). Schema in `supabase/migrations/0001_init.sql`.
- **Runner:** **GitHub Actions cron** (`*/30`-ish, off-minute). Free; the spike
  already proved a headless browser clears CF from a datacenter IP, so GH's
  datacenter runners work. Trade-off: GH may delay busy scheduled runs a few min.
  Render/Lightsail kept as fallbacks if cadence proves too laggy.

### Pipeline — BUILT 2026-06-28
Full Apollo path is wired end-to-end and unit-tested (22 passing, no network):
- `src/storage.mjs`  — Store port; `SupabaseStore` (lazy supabase-js) +
  `InMemoryStore` fallback; `createStoreFromEnv`.
- `src/email.mjs`    — pure `formatDealEmail`/`formatDealLine`; `ResendMailer`
  (injectable fetch) + `ConsoleMailer` fallback; `createMailerFromEnv`.
- `src/pipeline.mjs` — `runPipeline({sweep,store,mailer})`: sweep → upsert all
  qualifying (dashboard) → dedup via `seen` → email only NEW → mark notified.
- `src/run.mjs`      — env-wired entrypoint the cron calls (`node src/run.mjs`).
- `.github/workflows/sweep.yml` — the 30-min cron (needs repo secrets:
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, EMAIL_FROM, EMAIL_TO).
- `.github/workflows/test.yml`  — runs `node --test` on push/PR.
Graceful degradation: missing Supabase env → in-memory store; missing Resend env
→ emails logged not sent. So a local `npm run` works with zero secrets.

## Party configs (paxAges) — LOCKED 2026-06-28
Sweep runs for THREE party configurations (each independently, since per-person
price + availability differ by party):
- `2v`   → 2 adults (`18,18`)
- `2v2b` → 2 adults + 2 kids 9,12 (`18,18,9,12`)
- `4v2b` → 4 adults + 2 kids 9,12 (`18,18,18,18,9,12`)
Deal identity now includes `pax`: `(operator, accommodationCode, departureDate,
duration, pax)` → same hotel/date alerts once per party. `deals` table gained a
`pax` column (migration `0002_add_pax.sql` — apply in Supabase). ~3× the BFF
calls per sweep (~225 /products); workflow timeout bumped to 15 min.

## Live verification — 2026-06-28 ✅
First green production sweep (single party): `productsSeen=6478 priced=6478
minPP=3794 qualifying=0`. Confirms: full inventory scanned (~6.5k packages),
ALL prices parse correctly (normalizeProduct field paths verified against real
sample), and 0 alerts is CORRECT — cheapest was 3794/pp (> 3000 bar) and best
discount ~43% (< 70%). System is live on the 30-min cron.
Note: Apollo exposes `Content.DistanceToCenter`, not `DistanceToBeach` → that
field is usually null (cosmetic; doesn't affect alerts).

## Reliability hardening — 2026-06-28
First scheduled runs exposed a fragility: a sweep is ~230 sequential in-page BFF
calls, and a single transient `page.evaluate: TypeError: Failed to fetch` (network
blip / momentary CF re-challenge) aborted the WHOLE sweep (runs #6, #7 failed this
way). Fixed: `fetchJson` now retries a call 3× with backoff (1s, 2s); `sweepApollo`
catches a still-failing cheapest/products call, counts it (`stats.failedCalls`),
logs it, and continues instead of crashing. First real deals delivered run #8
(Malia Princess 2892/pp; Monte Feliz 76% off — both family-config hits).

## Vercel dashboard — BUILT 2026-06-28
Read-only Next.js (App Router) app in `dashboard/`, deployed to Vercel (root dir
= `dashboard`). Server component fetches `deals` with the service-role key
(server-only → table stays RLS-locked, no public read policy). Single dynamic
page: qualifying deals, cheapest/pp first, with discount badge, party label,
seats, "seen" freshness (stale rows dimmed >2h), and a "Book →" deep link.
- Decision: no auth in v1 (just holiday deals) — access via the Vercel URL.
- Env on Vercel: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (same as GH secrets).
- Next 16 / React 19 (cleared the high-sev Next DoS advisories; one transitive
  postcss moderate remains, bundled inside Next — build-time only, not runtime).
- Build verified locally (`npm run build`, / is server-rendered/dynamic).
- v1.1: hotel name links to booking page; "Run screening now" button triggers
  the sweep workflow via a server action (env `GH_DISPATCH_TOKEN`, a fine-grained
  PAT with Actions:write). Button is UNAUTHENTICATED per owner choice.
  Note: existing pre-#9 deals show no link until a fresh sweep re-upserts them
  with booking_url.

## Tuning — 2026-06-28
- Price threshold raised 3000 → **3500** kr/pp (PRICE_PER_PERSON_THRESHOLD).
  Email footer + dashboard copy now derive from the constant.
- Cron cadence 30 → **15 min** (`7,22,37,52 * * * *`). GitHub still delays
  scheduled runs, so effective cadence is looser.

## Multi-source (Ving + TUI) — IN PROGRESS 2026-06-28
Goal: add Ving and TUI alongside Apollo. Approach: source registry + resilient
multi-source pipeline (a source that errors is skipped, others still run/email),
adapters following the Apollo pattern.
(Earlier note said the dev env's proxy blocked ving.no — that has since cleared:
ving.no is reachable (200) and was fully spiked from here; tui.no is still hard-
blocked by Akamai, see below.)

## Ving spike — RESOLVED 2026-06-28 ✅ (`spikes/ving/`, full contract in its README)
Ving exposes a clean, **unauthenticated GraphQL** restplass API — no per-pax
sweep needed (prices are already per person), but no discount rule possible.
- **Endpoint:** `POST https://origo-sc.nltg.com/` (search service "origo-sc",
  runs on NLTG infra). Headers: `content-type/accept: application/json`,
  `marketunit: vn` (siteId 3 → mucd `vn`), `x-caller-app: lastminutesales`. No auth.
- **Query:** `{ lmsTrips(<args>) { metadata{…} edges{ node{…} } pageInfo{…} } }`.
  Args (from the `lms.js` bundle): `first, orderBy:DATE|PRICE, after, departureCode,
  destinationCode, tripTypes:[SPECIFIED|FLIGHTONLY], durationFrom/To (DAYS: 8≈1wk,
  15≈2wk), dateFrom/To, priceTo`. Introspection disabled.
- **Node:** `date{raw…}, duration, destinationCode, departureCode, numFreeSeats,
  serialNumber, offers[{tripId, price, priceFormatted, type, hotelCode}], hotel{…country…}`.
- **Same access pattern as Apollo:** naked curl is hard-blocked; must drive a
  headless browser and call the API via in-page fetch. Confirms the Playwright-
  in-a-container decision for Ving too.
- **Gotchas baked into the spike (and the future adapter):**
  - **Per-person price already** ("én voksen i delt dobbeltrom"), **no pax arg**
    → Ving does NOT sweep the 3 PAX_CONFIGS like Apollo does. One pass.
  - **No brochure/original price** in the response → the **70%-discount rule
    cannot apply to Ving**; only the absolute `price < THRESHOLD` rule does.
  - `orderBy: PRICE` + selecting `edges` errors server-side (no CORS on the error
    → "Failed to fetch"). Use `orderBy: DATE`, sort client-side.
  - Hand-built queries selecting `date{…}` are network-blocked (XHR status 0),
    but the page's own query + **arg-value mutations of it** pass. → adapter
    pattern = **capture the page's live query as a template, mutate only args**
    (self-heals on query changes). First call after load is flaky → retry/warm-up.
  - `tripTypes:[SPECIFIED]` = fly+hotell packages; `FLIGHTONLY` = seats only
    (`hotelCode:"FLYA"`). Decide whether to monitor packages only.
- **Live proof:** OSL priceTo≤3500 → totalCount=125, minPrice=995. Real cheap
  hits returned (995 OSL→Varna flight; sub-3000 fly+hotell). Contract verified.

## Ving adapter — BUILT 2026-06-28 (`src/ving.mjs`, `test/ving.test.mjs`)
Mirrors the Apollo adapter (pure logic + browser layer; 13 unit tests, 35 total
passing). Owner decisions this session:
- **Packages only** (`tripTypes:[SPECIFIED]`) — no flight-only seats. Live: 553
  packages, 13 ≤3500, 7 inside the 50-day horizon.
- **Party combos = {2v, 4v, 4v2b}** (2 adults / 4 adults / 4 adults + 2 kids).
  Confirmed empirically the GraphQL API has **NO pax argument** (server rejects
  `adults/numAdults/pax/occupancy/rooms/childAges/travellers`), so party size is
  honored as a **CAPACITY gate**: a package qualifies for a party iff
  `numFreeSeats >= size` (2/4/6). pax is in the dedup key → per-party alerts,
  same semantics as Apollo. (NB this differs from Apollo's per-party *pricing*;
  Ving price is per person and party-independent.)
- Only the **absolute price/pp rule** applies to Ving (no brochure price → 70%
  rule never fires). Booking deep-link replicates the bundle's buildUpSellUrl.
- Net pattern: `openVingSession()` clears the site + captures the page's query as
  a template; `sweepVing()` paginates, filters to packages, gates by capacity per
  party, evaluates. CLI/script: `npm run sweep:ving`.
- **Live smoke (2026-06-28):** `tripsSeen=7 packagesSeen=7 minPP=2945
  qualifying=21` (7 packages × 3 parties; all had 9 seats). Cheapest 2945/pp
  OSL→Antalya. Working booking links emitted.
- **Still TODO:** wire Ving into a source registry + multi-source pipeline (run
  Apollo + Ving, skip a source that errors), and add Ving columns/labels to the
  dashboard. `src/run.mjs` still runs Apollo only.

## TUI spike — BLOCKED from datacenter IP 2026-06-28 ⛔ (`spikes/tui/`)
TUI is behind **Akamai with a hard IP deny** (`403 Access Denied`,
`errors.edgesuite.net`) — NOT a solvable JS challenge, so headless Chromium does
not clear it (the Apollo Cloudflare trick doesn't transfer). Even `robots.txt`
is 403, so the real restplass URL can't be discovered from here. An extra bot-
defense beacon (`api.tx4.pw.adn.cloud`) sits on top. **Binding constraint = IP
reputation.** Reverse-engineering TUI is **deferred until a residential/mobile
egress** (proxy or non-datacenter runner) is available; then repeat the
capture-XHR → replicate-in-page-fetch method. Apollo + Ving are the two working
sources for now.

## ⚡ TUI SOLVED via Finn.no aggregator — 2026-06-28 ✅ (`spikes/finn/`)
The residential-proxy requirement above is now MOOT. Finn.no's travel vertical
aggregates ALL charter operators (apollo, tui, ving, amisol, nazar) behind ONE
plain JSON API reachable with a **bare fetch from a datacenter IP** — no browser,
no Akamai/CF, no proxy:
- `GET https://www.finn.no/travel-api/lms/offers?fra=OSL&type=spesifisert&med=tui&sorter=pris_lms&pageNumber=1`
- Params: `fra`=airport, `med`=operator (apollo|tui|ving|amisol|nazar|tripx|…),
  `type=spesifisert`=fly+hotel package, `sorter=pris_lms`=cheapest-first,
  `pageNumber`, plus `lengde/pris/avreise/til/stjerner`. Keys reflect 1:1 to the API.
- Offer fields: hotelName, **rating (stars)**, price (PER PERSON, NOK), tripType,
  country/destination, duration, deepLink (operator booking URL), supplier/brand.
- TUI: ~27.7k OSL packages, real `tui.no/no/bestill-reise` booking links (the
  USER clicks them in their own browser — we never fetch tui.no).
- Coverage (OSL packages): apollo 71176 · tui 27686 · ving 5985 · amisol 1988 · nazar 565.
- Caveats: no brochure price (discount rule can't fire → absolute price/pp only),
  no pax/free-seats (party handling weaker than direct sources), aggregator may
  lag operators slightly.
- **Recommended architecture:** add a Finn source scoped to `med=tui` (+ amisol,
  nazar) to COMPLEMENT the direct Apollo/Ving adapters without double-counting.
  Keep Apollo direct (only direct exposes BrochurePrice → discount rule); keep
  Ving direct (built + tested). Finn fills the TUI gap + 2 small brands for free.
- Full contract + runnable spike: `spikes/finn/README.md`, `spikes/finn/offers.mjs`.
The direct-TUI investigation above is SUPERSEDED — kept for the record.

## Finn adapter — BUILT 2026-06-28 (`src/finn.mjs`, `test/finn.test.mjs`)
Owner decisions: Finn is used ONLY for operators we don't scrape directly —
`FINN_OPERATORS = ['tui','amisol','nazar']` (NO apollo, NO ving: direct adapters
are richer/fresher). 7 unit tests; 42 total passing.
- Plain fetch (no browser): `buildFinnUrl` → `fra=OSL&type=spesifisert&med=…&sorter=pris_lms&pageNumber=N`.
- `sweepFinn` pages cheapest-first and STOPS at the first offer ≥ price bar
  (ascending sort ⇒ nothing cheaper remains); keeps under-bar offers within the
  50-day horizon. Absolute price/pp rule only (no brochure → no discount).
- `normalizeFinnOffer` → the shared deal shape; `pax=null`, `availability=null`,
  `currentPrice=null`, `brochurePrice=null`, `stars`=rating (0.0→null),
  `accommodationCode`=hotel-name slug, `bookingUrl`=offer.deepLink (real
  tui.no/amisol/nazar booking URL the user opens in their own browser).
- **Dashboard/DB compatibility VERIFIED:** a real TUI offer maps through
  `toDealRow` to a valid `deals` row — NOT NULL cols satisfied (departure_date,
  duration_group int, operator), snake_case fields present, key
  `tui|<hotel-slug>|<date>|<dur>|`. Existing dashboard renders it as-is (pax/seats
  show '–', no booking change needed). CLI: `npm run sweep:finn`.
- Live smoke (2026-06-28): cheapest tui/amisol/nazar OSL package = 4393/pp
  (> 3500 bar) → 0 qualifying right now (correct monitor behavior).
## Reconciliation with main (tiered thresholds + destination/meal) — 2026-06-28
The Ving + Finn adapters were first built on a stale base (pre-#13). Synced local
to origin/main (PRs #14–#16) and aligned both adapters:
- main moved the deal rule to TIERED per-person bars (base 3500, 4★ → 4500,
  all-inclusive → 6000; `priceThreshold`/`evaluateDeal` read `stars` + `mealPlan`),
  and added `destination` + `meal_plan` columns (migration 0004) + a dashboard
  **Source** column (`DealsTable.js`, `OPERATOR_LABEL`).
- Ving/Finn now emit `destination` ("country – place") and `mealPlan` (null for
  both — neither API exposes board basis). Ving also has no stars → it only ever
  clears the base 3500 bar. Finn HAS stars (rating) → 4★ Finn deals clear the
  4500 tier.
- FIXED a real bug: `sweepFinn` had stopped paging at the base 3500 bar; with
  tiers it now pages to the 4★ bar (4500) — the highest a Finn deal can clear
  (all-inclusive 6000 is unreachable without meal data) — so 4★ deals in 3500–4500
  aren't missed.
- Dashboard `OPERATOR_LABEL` extended with amisol/nazar.
- All 49 unit tests pass; live smoke confirms a real TUI offer → valid `deals`
  row with destination/operator/stars/meal_plan.

## Multi-source pipeline — WIRED 2026-06-28
`src/sources.mjs` registry + `sweepAllSources()` (resilient: a source that throws
is logged + skipped, others still run). `run.mjs` now sweeps **all** enabled
sources (Apollo + Ving + Finn), gated by `FERIE_SOURCES` (default all). sweep.yml
timeout 15→25 min (two browser sources + Finn). Pre-wire fixes applied to Finn:
client-side operator allow-list (never store apollo/ving or a missing supplier)
and a duration guard (drop null/≤0 durations — `deals.duration_group` is NOT NULL,
one bad offer would otherwise fail the whole batch upsert). 54 tests passing.
Remaining cleanup (deferred): dedupe `openVingSession`≈`openApolloSession`,
`joinPlace`×3, `num`; Ving fabricated total + single-cheapest-hotel/seenKey churn;
remove committed `spikes/ving/package-lock.json`.

## Membership coupons (stackable discounts) — BUILT 2026-06-28
Feature: surface external membership discounts that a buyer can stack ON TOP of a
restplass price (OBOS, Studentpakken, NAF, Trumf). Informational only — coupons do
NOT change whether a deal qualifies; they're "you could also stack this" hints.

Research (4 parallel agents; operator/coupon domains 403 anti-bot, so figures are
from search snippets — re-verify exact amounts/codes at point of use):
- **OBOS** → Apollo only. 350 kr/pers (up to 500 for Mondo Family/Selected). Code at
  booking step 6. ≥30 days before departure. (Ving's equivalent is Coop, not OBOS.)
- **Studentpakken** → Apollo only. 750 kr/booking (flat). Charter only, not Nordics.
  Code at step 6. ≥30 days before. Free student-gated app (Inform Media, not a bank).
- **NAF** → TUI only. ~600 kr/pers (campaign figure; standing amount behind login).
  Code from NAF portal. ≥7 nights, ≥4 000 kr, ≥30 days before. (Apollo's analogues
  are LO/LOfavør ~350/pers and Pensjonistforbundet — NOT NAF.)
- **Trumf** → TUI (direct) + Apollo (Netthandel portal); Ving unconfirmed. CASHBACK,
  not a price cut: 3% if >120 days out, 1% if ≤120 days. Click-through, credited
  1–2 months after the trip. Caveat: some Netthandel terms exclude pakkereiser.

Simplified model (LOCKED — owner decision): (1) assume coupons STACK on the price
(ignore the formal "cannot combine" clauses); (2) gate PRIMARILY on lead time
(days before departure); other constraints (min nights/spend/age/season) not modelled
in v1. Cashback (Trumf) is folded into the stacked kr total for a rough net estimate.

Tension worth noting: most coupons require ≥30 days lead + no-stacking in their real
terms, so they rarely apply to genuine sub-30-day restplasser — the lead-time gate
makes the email/dashboard honest about which still apply on a given day.

Implementation:
- `src/coupons.mjs` — pure: `COUPONS` catalog, `headcount`, `daysBetween`,
  `applicableCoupons(deal, todayIso)`, `couponSummary` (stacked total + net/pp).
  Accepts both camelCase (scraper) and snake_case (DB) deal shapes.
- `src/email.mjs` — deal line gains a "stackbare kuponger: …  → ~X/pp" hint; mailers
  pass `today` (impure boundary) so the pure formatter stays clock-free + tested.
- `dashboard/app/format.js` — `couponSummary` mirrored (separate package; kept in
  sync like the threshold constants). `DealsTable` renders coupon chips per card.
- Computed at DISPLAY time, never stored — lead-time eligibility shrinks daily, so a
  stored value would go stale. No DB migration needed.
- Tests: `test/coupons.test.mjs` (11 cases). Full suite 43 passing, no network.

## ===== RESUME HERE (next session) =====
### Decisions locked so far
1. Scraping only; no API exists. Personal use.
2. First source: **Apollo** — feasibility SOLVED, adapter built, **full
   sweep→dedup→email pipeline built** (`src/`). Pattern: Playwright (headless,
   container, NO proxy) clears Cloudflare, then call clean JSON BFF via in-page fetch.
3. Deal rule: email if `CurrentPricePerPerson < 3000` OR discount >= 70%.
4. Notify immediately on first sighting; dedup via seen-key
   `(operator, accommodationCode, departureDate, duration)`.
5. Sweep: every 30 min, 50-day horizon, durations {7,14}, two-stage.
6. Stack: Resend (email) + Supabase Postgres (DB) + GitHub Actions cron (runner).
   Vercel read-only dashboard still planned. Edge/serverless-scrape ruled out.
7. GitHub: private repo christofferokolgrov/Ferie, pushed.

### Operational TODO (before it actually runs)
- [ ] Apply `supabase/migrations/0001_init.sql` to a Supabase project.
- [ ] Add the 5 repo secrets so the cron can store + email.
- [ ] Verify a Resend sender domain for `EMAIL_FROM`.
- [ ] Live-smoke `npm run sweep:apollo` to confirm `/products` field shapes match
      `normalizeProduct` (BrochurePrice/Content paths) against production.

### Still open (next grilling branches)
- [ ] Dashboard: Vercel read-only view of `deals`. Scope + auth (private URL vs
      Supabase RLS + anon read).
- [ ] Then: replicate for Ving (JS-rendered, /websearchresult) and TUI (Akamai —
      hardest, may need proxy).

### Next action
Provision Supabase + secrets and live-smoke against the real BFF; once a sweep
stores real deals, build the Vercel dashboard over the `deals` table.
