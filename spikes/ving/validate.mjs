// Live validation of the reverse-engineered Ving contract — FINAL working spike.
//
// Pattern (Ving analogue of the Apollo in-page-fetch pattern):
//  1. Playwright loads www.ving.no/restplasser -> clears Akamai, primes context.
//  2. We CAPTURE the page's own GraphQL request body to origo-sc as a template.
//  3. We mutate ONLY the lmsTrips arg values (priceTo, first, after) on that
//     template and re-fetch via in-page fetch, then paginate.
//
// Why capture-and-mutate instead of building the query from scratch:
//  - origo-sc rejects hand-built queries selecting `date {...}` at the network
//    level (XHR status 0 / "Failed to fetch", no CORS header on the block), but
//    accepts the page's own full query and arg-value mutations of it. Capturing
//    the live query is robust and self-heals if Ving changes it.
//  - orderBy: PRICE + edges errors server-side too -> keep orderBy: DATE, sort
//    client-side.
import { chromium } from 'playwright';

const PAGE = 'https://www.ving.no/restplasser';
const ORIGO = 'https://origo-sc.nltg.com/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({ userAgent: UA, locale: 'nb-NO', timezoneId: 'Europe/Oslo', viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();

let template = null;
page.on('request', (r) => { if (r.url().includes('origo-sc.nltg.com') && !template) template = r.postData(); });

await page.goto(PAGE, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(8000);
if (!template) throw new Error('did not capture the page origo-sc query template');

function buildBody({ priceTo, first = 40, after } = {}) {
  let q = template;
  if (first) q = q.replace(/first:\d+/, `first:${first}`);
  const inject = [priceTo && `priceTo:${priceTo}`, after && `after:\\"${after}\\"`].filter(Boolean).join(' ');
  if (inject) q = q.replace('orderBy: DATE', `orderBy: DATE ${inject}`);
  return q;
}

const gqlOnce = (body) => page.evaluate(async ({ url, body }) => {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', marketunit: 'vn', 'x-caller-app': 'lastminutesales' }, body });
    return { ok: true, status: r.status, json: JSON.parse(await r.text()) };
  } catch (e) { return { ok: false, err: String(e) }; }
}, { url: ORIGO, body });
const gql = async (body, attempts = 4) => {
  for (let i = 0; i < attempts; i++) {
    const res = await gqlOnce(body);
    if (res.ok) return res.json;
    await page.waitForTimeout(800 * 2 ** i);
  }
  throw new Error('gql failed after retries');
};

let after = null, all = [], meta = null, pages = 0;
do {
  const json = await gql(buildBody({ priceTo: 3500, first: 40, after }));
  const t = json?.data?.lmsTrips;
  if (!t) { console.error('no lmsTrips:', JSON.stringify(json).slice(0, 300)); break; }
  meta ??= t.metadata;
  all.push(...t.edges.map((e) => e.node));
  after = t.pageInfo.hasNextPage ? t.pageInfo.endCursor : null;
  pages++;
} while (after && pages < 40);

const cheapestOffer = (n) => (n.offers || []).slice().sort((a, b) => a.price - b.price)[0] || {};
all.sort((a, b) => (cheapestOffer(a).price ?? Infinity) - (cheapestOffer(b).price ?? Infinity));

console.log('metadata (OSL, priceTo<=3500):', JSON.stringify({ totalCount: meta?.totalCount, minPrice: meta?.minPrice, maxPrice: meta?.maxPrice }));
console.log('trips fetched:', all.length, 'over', pages, 'page(s)');
console.log('\nsample raw node:\n', JSON.stringify(all[0], null, 1));
console.log('\ncheapest 10 (price/pp | date | dur | dest | seats | type | hotel):');
for (const n of all.slice(0, 10)) {
  const o = cheapestOffer(n);
  console.log(`  ${String(o.price).padStart(5)} | ${n.date?.raw?.slice(0, 10)} | ${String(n.duration).padStart(2)}d | ${n.destinationCode} ${(n.hotel?.content?.geographical?.country?.name || '').padEnd(10)} | seats=${n.numFreeSeats} | ${(o.type || '').padEnd(9)} | ${o.hotelCode || '-'}`);
}
await browser.close();
