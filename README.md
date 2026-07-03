# Ferie 🏖️

A personal monitor for **restplasser** (leftover last-minute package-holiday seats)
departing **Oslo (OSL)** from **Apollo**, **TUI**, and **Ving**.

It polls the operators on a schedule, filters for genuinely cheap deals, emails
when a good one appears, and surfaces current deals on a dashboard.

> Personal-use project. No public API exists for these operators, so data is
> obtained by scraping their public `restplasser` pages.

## Status

All three source paths built end-to-end and wired into the production run:
**Apollo + Ving (direct) + Finn.no (TUI/amisol/nazar) → store → dedup →
email**, on a 15-min GitHub Actions sweep (externally triggered — see
"Reliable scheduling"). Stack locked: **Resend** (email) + **Supabase
Postgres** (`deals` + `seen`) + **GitHub Actions** (runner). See
[`NOTES.md`](./NOTES.md).

```bash
npm install
npm test                 # pure logic, no network
npm run sweep:apollo     # live sweep only (needs: npx playwright install chromium)
npm run run              # full pipeline; uses env (falls back to in-memory + console)
```

## How it runs

`.github/workflows/sweep.yml` runs `node src/run.mjs` every ~15 min. It needs
these repo secrets (see [`.env.example`](./.env.example)):

| Secret | Purpose |
|--------|---------|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | store deals + dedup set |
| `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_TO`  | send deal alerts |

Apply `supabase/migrations/0001_init.sql` to your Supabase project first. With
no secrets set, a run still works locally (in-memory store, emails logged).

### Reliable scheduling

GitHub's `schedule` trigger is **best-effort**: sub-hourly crons are queued and
frequently dropped, so the 15-min cron actually fires roughly once an hour
(observed gaps of 1–3 h). The cron is kept only as a fallback; the primary
trigger should be an external scheduler calling the `workflow_dispatch` API:

```bash
curl -X POST \
  -H "Authorization: Bearer $GH_PAT" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/christofferokolgrov/Ferie/actions/workflows/sweep.yml/dispatches \
  -d '{"ref":"main"}'
```

Setup (one-time, ~5 min):

1. Create a **fine-grained PAT** scoped to this repo with only
   **Actions: Read and write** permission (GitHub → Settings → Developer
   settings → Fine-grained tokens). Set a long expiry.
2. On [cron-job.org](https://cron-job.org) (free) create a job: every 15 min,
   `POST` to the URL above with the `Authorization` and `Accept` headers and
   the `{"ref":"main"}` body. (Any scheduler that can send an authenticated
   POST works — a Cloudflare Worker cron trigger, UptimeRobot, etc.)
3. Done — external dispatches fire on time; the GitHub cron stays as a backup,
   and the workflow's `concurrency` group prevents overlap if both fire.

Note: GitHub also **auto-disables** scheduled workflows after 60 days without
repo activity; externally-dispatched runs are immune to that too.

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
