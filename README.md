# Ferie 🏖️

A personal monitor for **restplasser** (leftover last-minute package-holiday seats)
departing **Oslo (OSL)** from **Apollo**, **Ving**, and **TUI**.

It polls the operators on a schedule, filters for genuinely cheap deals, emails
when a good one appears, and surfaces current deals on a dashboard.

Sources run via a resilient registry (`src/sources.mjs`) — each sweep runs every
enabled source independently; one failing source never blocks the others. Select
with `FERIE_SOURCES=apollo,ving,tui` (default: all). Apollo is fully proven; Ving
and TUI capture the sites' own search responses, with their exact field mapping
finalized from CI capture logs.

> Personal-use project. No public API exists for these operators, so data is
> obtained by scraping their public `restplasser` pages.

## Status

Apollo path built end-to-end: **sweep → store → dedup → email**, running on a
30-min GitHub Actions cron. Stack locked: **Resend** (email) + **Supabase
Postgres** (`deals` + `seen`) + **GitHub Actions** (runner). 22 passing unit
tests. Remaining: provision Supabase + secrets, then a Vercel dashboard and the
Ving/TUI sources — see [`NOTES.md`](./NOTES.md).

```bash
npm install
npm test                 # pure logic, no network
npm run sweep:apollo     # live sweep only (needs: npx playwright install chromium)
npm run run              # full pipeline; uses env (falls back to in-memory + console)
```

## How it runs

`.github/workflows/sweep.yml` runs `node src/run.mjs` every ~30 min. It needs
these repo secrets (see [`.env.example`](./.env.example)):

| Secret | Purpose |
|--------|---------|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | store deals + dedup set |
| `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_TO`  | send deal alerts |

Apply `supabase/migrations/0001_init.sql` to your Supabase project first. With
no secrets set, a run still works locally (in-memory store, emails logged).

## Target sources & access reality (probed 2026-06-28)

| Site  | Raw HTTP GET | Wall / rendering                              | Difficulty |
|-------|--------------|-----------------------------------------------|------------|
| Ving  | `200`        | No wall; **JS-rendered**; search endpoint `/websearchresult` exists | ✅ Easy |
| Apollo| `403`        | **Cloudflare** active bot challenge (`cf-mitigated: challenge`)      | ⚠️ Hard |
| TUI   | `403`        | **Akamai** Bot Manager (`server: AkamaiGHost`)                      | ⚠️⚠️ Hardest |

**Key constraint:** the binding problem is bot-wall + IP reputation, *not* just
JS rendering. Datacenter IPs (serverless / CI runners) are challenged before JS
even matters — so the scraper needs a real browser (Playwright) on a stable,
less-flagged IP (container runner), not an edge/serverless function.

## Leaning-toward stack

- **Scraper:** Playwright in a container runner (Render cron ~$1/mo or existing Lightsail box)
- **Database + scheduler:** Supabase (deals table + seen-set for dedup; Supabase Cron triggers)
- **Dashboard:** Vercel (read-only frontend)
- **Email:** Resend (free tier) or Microsoft 365 SMTP
- **Source / CI:** GitHub

## First build target

Apollo (per owner decision) — note this is the hardest source (Cloudflare challenge).
