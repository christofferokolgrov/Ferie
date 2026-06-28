import { chromium } from 'playwright';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CANDIDATES = [
  'https://www.tui.no/restplasser/',
  'https://www.tui.no/last-minute/',
  'https://www.tui.no/tilbud/',
  'https://www.tui.no/charter/',
  'https://www.tui.no/sol-og-badeferie/',
  'https://www.tui.no/reisetilbud/',
];
const b=await chromium.launch({headless:true,args:['--no-sandbox','--disable-blink-features=AutomationControlled']});
const ctx=await b.newContext({userAgent:UA,locale:'nb-NO',timezoneId:'Europe/Oslo',viewport:{width:1366,height:900}});
await ctx.addInitScript(()=>Object.defineProperty(navigator,'webdriver',{get:()=>undefined}));
const page=await ctx.newPage();
const api=new Set();
page.on('request',(r)=>{const u=r.url();const t=r.resourceType();
  if((t==='xhr'||t==='fetch')&&!/google|facebook|cookie|consent|analytics|gtm|doubleclick|hotjar|dynatrace|onetrust|adn\.cloud|adobe|demdex|qualtrics|\.(png|jpg|svg|css|woff)/i.test(u)) api.add(r.method()+' '+u.split('?')[0]);
});
for(const url of CANDIDATES){
  try{
    const resp=await page.goto(url,{waitUntil:'domcontentloaded',timeout:40000});
    await page.waitForTimeout(5000);
    const title=await page.title();
    const body=(await page.evaluate(()=>document.body?.innerText?.slice(0,200)||'')).replace(/\s+/g,' ');
    const priceHits=(body.match(/\d[\s.]?\d{3}\s*(?:kr|,-)/gi)||[]).slice(0,3);
    console.log(`[${resp?.status()}] ${url}  title="${title.slice(0,40)}" prices=${JSON.stringify(priceHits)}`);
  }catch(e){ console.log(`[ERR] ${url} ${String(e).slice(0,80)}`); }
}
console.log('\n=== content API/XHR (bot beacons filtered) ===');
[...api].sort().forEach(u=>console.log('  '+u));
await b.close();
