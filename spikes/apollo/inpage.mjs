import { chromium } from 'playwright';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
const ctx = await browser.newContext({ userAgent: UA, locale: 'nb-NO', timezoneId: 'Europe/Oslo' });
await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
const page = await ctx.newPage();
await page.goto('https://www.apollo.no/restplasser', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(8000); // let CF clearance settle

// Now call the BFF ourselves from inside the cleared origin — our own OSL query.
const url = 'https://bff.apollo.no/product-list/v1/sales-unit/apollono/core/departures/cheapest?durationGroup=7&departureAirportCode=OSL&startDate=2026-07-01&endDate=2026-07-31&paxAges=18%2C18&paxUnits=&travelAreaUri=';
const result = await page.evaluate(async (u) => {
  const r = await fetch(u, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ IncludeExternalFlights: false, IncludeBedbankAccommodations: false, SearchSpanStartDate: '2026-06-28', SearchSpanEndDate: '2026-09-26' }),
  });
  const txt = await r.text();
  let json = null; try { json = JSON.parse(txt); } catch {}
  return { status: r.status, len: txt.length, topKeys: json ? Object.keys(json) : null, preview: txt.slice(0, 400) };
}, url);
console.log(JSON.stringify(result, null, 2));
await browser.close();
