# Ferie dashboard

Read-only Next.js view of `data/deals.json` — current qualifying restplasser,
cheapest per-person first, with a direct "Book →" link per deal.

There is no database. The sweep commits the deal data to this repo, and the
dashboard fetches the raw file server-side on each request. The repo is public,
so this needs no credentials at all. Set `DEALS_URL` to point somewhere else
(a fork, or a private mirror behind a token-authenticated URL).

## Deploy to Vercel

1. **New Project** → import the `christofferokolgrov/Ferie` repo.
2. Set **Root Directory** to `dashboard`.
3. Framework preset: **Next.js** (auto-detected).
4. Add Environment Variables:
   - `GH_DISPATCH_TOKEN` — for the **Run screening now** button (see below).
   - `DEALS_URL` — optional; only if the deal data lives outside this repo.
5. Deploy. The dashboard refetches the deal data on each request
   (`force-dynamic`), so a sweep's commit shows up without a redeploy.

## "Run screening now" button

Triggers the `sweep.yml` GitHub Actions workflow on demand (`workflow_dispatch`)
via a server action — the token stays server-side, never in the browser.

Create a **fine-grained Personal Access Token** (GitHub → Settings → Developer
settings → Fine-grained tokens): scope it to the `Ferie` repo, permission
**Actions: Read and write**. Add it to Vercel as `GH_DISPATCH_TOKEN`.

> Note: the button is **unauthenticated** — anyone with the dashboard URL can
> trigger a sweep. Add Vercel password protection if that becomes a problem.

## Local dev

```bash
cd dashboard
npm install
cp .env.example .env.local   # only needed for the Run button
npm run dev                  # http://localhost:3000
```

## Notes / next steps

- No auth in v1 — access is via the Vercel URL. Add Vercel password protection
  or a simple middleware login if you want it private.
- Rows not seen in the last daily sweep (>26h) are dimmed as "stale"; deals
  not re-seen for 72h are dropped by the sweep and hidden here.
