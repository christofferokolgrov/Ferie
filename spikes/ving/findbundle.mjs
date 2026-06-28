// Find the JS chunk that builds the lmsTrips GraphQL query, then dump the
// arguments / variable names it uses (pax, duration, price filters, paging).
import { chromium } from 'playwright';
const PAGE = 'https://www.ving.no/restplasser';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ userAgent: UA, locale: 'nb-NO' });
const page = await ctx.newPage();
const scripts = [];
page.on('response', (r) => {
  const u = r.url();
  if (u.endsWith('.js') && /nltg\.com|ving\.no/.test(u)) scripts.push({ u, r });
});
await page.goto(PAGE, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(4000);

let found = null;
for (const { u, r } of scripts) {
  try {
    const txt = await r.text();
    if (txt.includes('lmsTrips')) { found = { u, txt }; break; }
  } catch {}
}
if (!found) { console.log('no chunk with lmsTrips among', scripts.length, 'scripts'); await browser.close(); process.exit(0); }

console.log('FOUND in:', found.u, '\n');
const txt = found.txt;
// Print the region(s) around lmsTrips( to reveal argument names.
let idx = 0;
let n = 0;
while ((idx = txt.indexOf('lmsTrips', idx)) !== -1 && n < 4) {
  console.log(`--- occurrence ${n} ---`);
  console.log(txt.slice(Math.max(0, idx - 200), idx + 900).replace(/\s+/g, ' '));
  console.log();
  idx += 8; n++;
}
// Also surface candidate arg tokens near the query.
const region = txt.slice(Math.max(0, txt.indexOf('lmsTrips') - 500), txt.indexOf('lmsTrips') + 3000);
const toks = [...new Set((region.match(/[a-zA-Z]+:/g) || []).map(s => s.slice(0, -1)))];
console.log('candidate arg/field tokens near query:', toks.join(', '));
await browser.close();
