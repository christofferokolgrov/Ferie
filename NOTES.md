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

## Open questions (next grilling branches)
- [ ] Apollo: can Playwright-stealth from a container clear the CF challenge, or
      is a residential proxy needed? (spike required)
- [ ] What defines a "good" deal? (absolute price? price/person? % below a
      baseline? per-destination thresholds?)
- [ ] Which destinations/dates in scope, or all?
- [ ] Dedup / "seen" semantics — notify once per deal, or again on price drop?
- [ ] Poll frequency.
- [ ] Email: Resend vs M365 SMTP.
- [ ] GitHub: account, repo visibility, auth method.
