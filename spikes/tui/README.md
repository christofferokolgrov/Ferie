# TUI feasibility spike — BLOCKED from datacenter IP 2026-06-28 ⛔

Goal was to reverse-engineer TUI's restplass data access like Apollo/Ving.
**Outcome: cannot proceed from this environment.** TUI is behind Akamai with a
hard IP/fingerprint **deny** (not a solvable JS challenge), so a datacenter IP
is refused before any page loads.

## Run it
```bash
cd spikes/tui
npm i playwright && npx playwright install chromium
node find.mjs    # tries to clear Akamai + capture API calls
node find2.mjs   # probes candidate restplass URLs
```

## What we found
- `https://www.tui.no/` → **403 "Access Denied"**, `Reference #… errors.edgesuite.net`
  = **Akamai hard block**. Headless Chromium does **not** clear it (unlike
  Apollo's Cloudflare JS challenge, which auto-solves — an Akamai *deny* is not
  a challenge, there is nothing to solve).
- Some subpaths return TUI's real branded 404 ("Denne siden er på ferie"),
  others (e.g. `/tilbud/`) are 403 — Akamai denies selectively.
- Even `robots.txt` is 403 → cannot read the sitemap to discover the real
  restplass URL from here.
- The only XHR observed before block is a **bot-defense beacon**
  (`api.tx4.pw.adn.cloud`) — an additional anti-automation layer on top of Akamai.

## Deeper probe 2026-06-28 (after "are we sure?")
Pushed harder to rule out a workaround:
- The TUI 404 page DOES reach origin and renders TUI's nav → harvested the real
  category URLs: `/finn-reise/` (the search app), `/feriereiser/`, `/tilbud/`,
  `/hotell/`, `/reise/`.
- **All of those real content pages are 403 Access Denied** (only *invalid*
  slugs 404, and those don't load the search app). So discovery via valid URLs
  doesn't help — the listing app never loads.
- TUI's API host is **`mwa.tui.com`** (mobile web API; seen in page network).
  Also **403** from this IP. `sitemap.xml` 403 too.
- Block is **pre-JS / edge-level**: `curl` to `robots.txt` is instantly 403,
  before any sensor JS runs → it's **IP reputation (datacenter ASN)**, not a
  browser-fingerprint challenge. Therefore: better stealth/headful won't help
  from a datacenter IP, and **GitHub Actions (also datacenter) will be blocked
  the same way** — TUI needs a residential egress regardless of dev-vs-prod.

## Conclusion / what's needed
The binding constraint is **IP reputation**, confirming the original probe
(`server: AkamaiGHost`, "hardest; may need a residential proxy"). To reverse-
engineer TUI we need to reach it from a **residential/mobile IP** (proxy or a
non-datacenter runner). Once a page loads, repeat the Apollo/Ving method:
capture the listing page's XHR/GraphQL calls and replicate via in-page fetch.

**Deferred** until a residential egress is available. Ving + Apollo are the two
working sources for now.
