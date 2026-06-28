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
Goal: add Ving and TUI alongside Apollo. Constraint: this dev env's proxy blocks
ving.no/tui.no (403), so contracts can only be probed from GitHub Actions
runners. Approach: source registry + resilient multi-source pipeline (a source
that errors is skipped, others still run/email), adapters following the Apollo
pattern, and a CI probe to capture real endpoint shapes.

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
