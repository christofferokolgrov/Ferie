import { chromium } from 'playwright';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ userAgent: UA, locale: 'nb-NO', timezoneId: 'Europe/Oslo' });
await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
const page = await ctx.newPage();
await page.goto('https://www.apollo.no/restplasser', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(8000);

const url = 'https://bff.apollo.no/product-list/v1/sales-unit/apollono/core/products?departureAirportCode=OSL&departureDate=2026-07-03&durationGroup=7&paxAges=18%2C18';
const result = await page.evaluate(async (u) => {
  const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ IncludeExternalFlights: false, IncludeBedbankAccommodations: false, SearchSpanStartDate: '2026-06-28', SearchSpanEndDate: '2026-09-26' }) });
  const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch {}
  return { status: r.status, len: txt.length, json: j };
}, url);

console.log('status', result.status, 'len', result.len);
const j = result.json;
if (j) {
  console.log('top keys:', Object.keys(j));
  const arr = Array.isArray(j) ? j : (j.Products || j.products || j.Items || j.Results || []);
  console.log('product array len:', Array.isArray(arr) ? arr.length : 'n/a');
  if (Array.isArray(arr) && arr[0]) {
    console.log('FIRST PRODUCT keys:', Object.keys(arr[0]));
    // hunt for discount / original-price-ish fields anywhere in the object
    const flat = JSON.stringify(arr[0]);
    const hits = flat.match(/"[A-Za-z]*(?:[Dd]iscount|[Oo]rdinary|[Oo]riginal|[Rr]abatt|[Ss]ave|[Ss]aving|[Bb]efore|[Pp]revious|[Rr]egular|[Ww]as|[Pp]ercent|Pct)[A-Za-z]*"\s*:\s*[^,}]+/g);
    console.log('discount-ish fields in product[0]:', hits || 'NONE');
    console.log('full product[0] (first 1500 chars):', flat.slice(0, 1500));
  }
}
await browser.close();
