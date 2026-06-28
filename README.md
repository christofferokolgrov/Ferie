# Ferie 🏖️

A personal monitor for **restplasser** (leftover last-minute package-holiday seats)
departing **Oslo (OSL)** from **Apollo**, **TUI**, and **Ving**.

It polls the operators on a schedule, filters for genuinely cheap deals, emails
when a good one appears, and surfaces current deals on a dashboard.

> Personal-use project. No public API exists for these operators, so data is
> obtained by scraping their public `restplasser` pages.

## Status

Early build. Apollo feasibility solved and the **Apollo adapter is built**
(`src/`, two-stage sweep, 12 passing unit tests). Sweep params locked: every
30 min, 45-day horizon, durations {7, 14}. DB + email transport still being
grilled — see [`NOTES.md`](./NOTES.md).

```bash
npm install
npm test                 # pure logic, no network
npm run sweep:apollo     # live sweep (needs: npx playwright install chromium)
```

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
