// Drive a real browser to the Ving restplasser page and capture every request
// to the origo-sc search service — request method/url/headers/body + response
// shape. This is the Ving analogue of the Apollo find.mjs spike.
import { chromium } from 'playwright';

const URL = 'https://www.ving.no/restplasser';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

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
await ctx.addInitScript(() =>
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined }),
);

const page = await ctx.newPage();
const hits = [];

page.on('request', (req) => {
  const u = req.url();
  if (u.includes('origo-sc.nltg.com') || /search|websearchresult/i.test(u)) {
    hits.push({
      phase: 'request',
      method: req.method(),
      url: u,
      headers: req.headers(),
      postData: req.postData(),
    });
  }
});

page.on('response', async (res) => {
  const u = res.url();
  if (u.includes('origo-sc.nltg.com')) {
    let bodyPreview = null;
    try {
      const txt = await res.text();
      bodyPreview = txt.slice(0, 4000);
    } catch {}
    hits.push({
      phase: 'response',
      status: res.status(),
      url: u,
      contentType: res.headers()['content-type'],
      bodyPreview,
    });
  }
});

try {
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(6000);
  // try to trigger more results (scroll / load more) to see pagination params
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(4000);
} catch (e) {
  console.error('nav error:', String(e));
}

console.log(JSON.stringify(hits, null, 2));
await browser.close();
