import { chromium } from 'playwright';

const URL = 'https://www.apollo.no/restplass';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function classify(title, bodyText, html) {
  const t = (title || '').toLowerCase();
  const b = (bodyText || '').toLowerCase();
  if (t.includes('just a moment') || b.includes('verifying you are human') ||
      html.includes('challenges.cloudflare.com') || b.includes('cf-')) {
    return 'CHALLENGE_STUCK';
  }
  if (b.includes('access denied') || b.includes('you don’t have permission') ||
      b.includes("you don't have permission")) {
    return 'HARD_BLOCK';
  }
  if (b.includes('restplass') || /\d[\s.]?\d{3}\s*(kr|,-)/.test(b)) {
    return 'LIKELY_THROUGH';
  }
  return 'UNKNOWN';
}

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
});
const ctx = await browser.newContext({
  userAgent: UA,
  locale: 'nb-NO',
  timezoneId: 'Europe/Oslo',
  viewport: { width: 1366, height: 900 },
});
// Light stealth: drop the webdriver flag CF looks for.
await ctx.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
});

const page = await ctx.newPage();
let status = 'n/a';
page.on('response', (r) => { if (r.url() === URL || r.url() === URL + '/') status = r.status(); });

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  // Give Cloudflare's JS challenge a chance to auto-solve and redirect.
  await page.waitForTimeout(12000);
  const title = await page.title();
  const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 4000) || '');
  const html = await page.content();
  const priceHits = (bodyText.match(/\d[\s.]?\d{3}\s*(?:kr|,-)/gi) || []).slice(0, 8);
  await page.screenshot({ path: 'apollo.png', fullPage: false });

  console.log(JSON.stringify({
    httpStatus: status,
    title,
    verdict: classify(title, bodyText, html),
    priceHits,
    bodyPreview: bodyText.slice(0, 500).replace(/\s+/g, ' '),
  }, null, 2));
} catch (e) {
  console.log(JSON.stringify({ error: String(e) }, null, 2));
} finally {
  await browser.close();
}
