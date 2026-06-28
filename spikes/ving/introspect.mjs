// Load the Ving page to clear bot protection, then run GraphQL introspection
// via in-page fetch to discover the exact arguments of lmsTrips and the shape
// of its node — so we know how to filter by pax, duration, price, paginate.
import { chromium } from 'playwright';

const PAGE = 'https://www.ving.no/restplasser';
const ORIGO = 'https://origo-sc.nltg.com/';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
});
const ctx = await browser.newContext({
  userAgent: UA, locale: 'nb-NO', timezoneId: 'Europe/Oslo',
  viewport: { width: 1366, height: 900 },
});
await ctx.addInitScript(() =>
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
const page = await ctx.newPage();

await page.goto(PAGE, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(4000);

async function gql(query) {
  return page.evaluate(async ({ url, q }) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        marketunit: 'vn',
        'x-caller-app': 'lastminutesales',
      },
      body: JSON.stringify({ query: q }),
    });
    const txt = await r.text();
    try { return { status: r.status, json: JSON.parse(txt) }; }
    catch { return { status: r.status, text: txt.slice(0, 500) }; }
  }, { url: ORIGO, q: query });
}

// Introspect the lmsTrips field's args + the trip node type.
const introspection = `{
  __type(name: "Query") {
    fields { name args { name type { kind name ofType { kind name ofType { kind name } } } } }
  }
}`;
const r = await gql(introspection);
console.log('=== Query fields/args ===');
if (r.json?.data?.__type?.fields) {
  for (const f of r.json.data.__type.fields) {
    if (/lms|trip/i.test(f.name)) {
      console.log(`\n${f.name}(`);
      for (const a of f.args) {
        const t = a.type;
        const tn = t.name || t.ofType?.name || t.ofType?.ofType?.name || t.kind;
        console.log(`   ${a.name}: ${tn}`);
      }
      console.log(')');
    }
  }
} else {
  console.log(JSON.stringify(r).slice(0, 800));
}

await browser.close();
