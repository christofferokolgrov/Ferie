# Ferie dashboard

Read-only Next.js view of the Supabase `deals` table — current qualifying
restplasser, cheapest per-person first, with a direct "Book →" link per deal.

Data is fetched **server-side** with the Supabase `service_role` key, so the key
never reaches the browser and the `deals` table stays locked (RLS, no public
read policy needed).

## Deploy to Vercel

1. **New Project** → import the `christofferokolgrov/Ferie` repo.
2. Set **Root Directory** to `dashboard`.
3. Framework preset: **Next.js** (auto-detected).
4. Add Environment Variables (same values as the GitHub Actions secrets):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `GH_DISPATCH_TOKEN` — for the **Run screening now** button (see below).
5. Deploy. The dashboard reads live data on each request (`force-dynamic`).

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
cp .env.example .env.local   # fill in the two values
npm run dev                  # http://localhost:3000
```

## Notes / next steps

- No auth in v1 — access is via the Vercel URL. Add Vercel password protection
  or a simple middleware login if you want it private.
- Rows not seen in the last sweep (>2h) are dimmed as "stale".
