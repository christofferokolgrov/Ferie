import { chromium } from 'playwright';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ userAgent: UA, locale: 'nb-NO', timezoneId: 'Europe/Oslo' });
await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
const page = await ctx.newPage();

const captured = [];
page.on('request', (r) => {
  const u = r.url();
  if (u.includes('bff.apollo.no') && (u.includes('cheapest') || u.includes('/products') || u.includes('/filter'))) {
    captured.push({ method: r.method(), url: u, headers: r.headers(), postData: r.postData() });
  }
});

await page.goto('https://www.apollo.no/restplasser', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(10000);
await browser.close();

// Dedup by url path
const seen = new Set();
for (const c of captured) {
  const key = c.method + c.url.split('?')[0];
  if (seen.has(key)) continue; seen.add(key);
  console.log('========================================');
  console.log(c.method, c.url);
  const h = c.headers;
  console.log('content-type:', h['content-type'], '| authorization:', h['authorization'] ? '(present)' : '(none)', '| x-api-key:', h['x-api-key'] || '(none)');
  console.log('interesting headers:', JSON.stringify(Object.fromEntries(Object.entries(h).filter(([k]) => /key|auth|token|client|sales|tenant|brand/i.test(k))), null, 0));
  console.log('postData:', c.postData ? c.postData.slice(0, 1200) : '(none)');
}
console.log('\nTOTAL captured bff calls:', captured.length);
