import { chromium } from 'playwright';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ userAgent: UA, locale: 'nb-NO', timezoneId: 'Europe/Oslo', viewport: { width: 1366, height: 900 } });
await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
const page = await ctx.newPage();

// Capture JSON/XHR endpoints the page calls — these are the real scrape targets.
const apiCalls = new Set();
page.on('request', (r) => {
  const u = r.url();
  if (/\/(api|graphql|search|trips?|offers?|product|restpl)/i.test(u) && !/\.(js|css|png|jpg|svg|woff)/i.test(u)) apiCalls.add(r.method() + ' ' + u.split('?')[0]);
});

await page.goto('https://www.apollo.no/', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(4000);

// Find the Restplasser link href from the nav.
const links = await page.evaluate(() =>
  [...document.querySelectorAll('a')]
    .filter(a => /restplass/i.test(a.textContent || '') || /restplass/i.test(a.getAttribute('href') || ''))
    .map(a => a.href)
);
const restUrl = [...new Set(links)].find(Boolean);
console.log('candidate restplasser links:', JSON.stringify([...new Set(links)].slice(0, 6), null, 2));

if (restUrl) {
  let httpStatus = 'n/a';
  page.on('response', (r) => { if (r.url().split('#')[0] === restUrl) httpStatus = r.status(); });
  await page.goto(restUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(9000);
  const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 6000) || '');
  const priceHits = (bodyText.match(/\d[\s.]?\d{3}\s*(?:kr|,-)/gi) || []).slice(0, 12);
  await page.screenshot({ path: 'apollo-rest.png', fullPage: false });
  console.log(JSON.stringify({
    restUrl, httpStatus,
    priceCount: priceHits.length, priceHits,
    apiCalls: [...apiCalls].slice(0, 20),
    bodyPreview: bodyText.slice(0, 700).replace(/\s+/g, ' '),
  }, null, 2));
} else {
  console.log('No restplasser link found. apiCalls:', [...apiCalls]);
}
await browser.close();
