// Shared headless-browser session for sources that ride the page's own search
// XHRs (Ving, TUI). Loads a page and captures JSON responses whose URL matches
// any of `capturePatterns`, so an adapter can read what the site's own JS fetched
// instead of guessing the request contract.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * @param {object} opts
 * @param {string}   opts.pageUrl         page to load
 * @param {string[]} opts.capturePatterns substrings; responses whose URL contains
 *                                         any are captured as JSON
 * @param {number}   [opts.settleMs]      extra wait after load for XHRs to fire
 * @returns {Promise<{ page, captured: Array<{url,status,json}>, fetchJson, close }>}
 */
export async function openBrowserSession({ pageUrl, capturePatterns = [], settleMs = 9000 }) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const ctx = await browser.newContext({
    userAgent: UA,
    locale: 'nb-NO',
    timezoneId: 'Europe/Oslo',
  });
  await ctx.addInitScript(() =>
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined }),
  );
  const page = await ctx.newPage();

  const captured = [];
  page.on('response', async (resp) => {
    try {
      const url = resp.url();
      if (!capturePatterns.some((p) => url.includes(p))) return;
      const ct = resp.headers()['content-type'] ?? '';
      if (!ct.includes('json')) return;
      const json = await resp.json().catch(() => null);
      if (json != null) captured.push({ url, status: resp.status(), json });
    } catch {
      /* ignore individual response read errors */
    }
  });

  await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(settleMs); // let the page's search XHRs fire & settle

  // Call an arbitrary JSON endpoint from inside the cleared origin (carries any
  // bot-clearance cookies), same trick as the Apollo adapter.
  const fetchJson = (url, body, method = 'GET') =>
    page.evaluate(
      async ({ u, b, m }) => {
        const r = await fetch(u, {
          method: m,
          headers: b ? { 'content-type': 'application/json' } : undefined,
          body: b ? JSON.stringify(b) : undefined,
        });
        const txt = await r.text();
        if (!r.ok) throw new Error(`${r.status} for ${u}: ${txt.slice(0, 200)}`);
        return JSON.parse(txt);
      },
      { u: url, b: body, m: method },
    );

  return { page, captured, fetchJson, close: () => browser.close() };
}
