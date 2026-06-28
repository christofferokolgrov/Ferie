// Explore TUI: try to clear Akamai with headless Chromium (the Apollo lesson),
// find the restplass listing page, and capture the API/XHR calls it makes.
import { chromium } from 'playwright';
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const CANDIDATES = [
  'https://www.tui.no/restplass/',
  'https://www.tui.no/sisteliten/',
  'https://www.tui.no/siste-liten/',
  'https://www.tui.no/',
];
const b=await chromium.launch({headless:true,args:['--no-sandbox','--disable-blink-features=AutomationControlled']});
const ctx=await b.newContext({userAgent:UA,locale:'nb-NO',timezoneId:'Europe/Oslo',viewport:{width:1366,height:900}});
await ctx.addInitScript(()=>Object.defineProperty(navigator,'webdriver',{get:()=>undefined}));
const page=await ctx.newPage();
const api=new Set();
page.on('request',(r)=>{const u=r.url();const t=r.resourceType();
  if((t==='xhr'||t==='fetch')&&!/google|facebook|cookie|consent|analytics|gtm|doubleclick|hotjar|dynatrace|onetrust|cdn|\.(png|jpg|svg|css|woff)/i.test(u)) api.add(r.method()+' '+u.split('?')[0]);
});
for(const url of CANDIDATES){
  let status='n/a';
  page.on('response',(r)=>{if(r.url()===url||r.url()===url.replace(/\/$/,'')) status=r.status();});
  try{
    const resp=await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
    status=resp?.status()??status;
    await page.waitForTimeout(7000);
    const title=await page.title();
    const body=(await page.evaluate(()=>document.body?.innerText?.slice(0,300)||'')).replace(/\s+/g,' ');
    const blocked=/just a moment|access denied|reference #|verifying you|don.t have permission/i.test(title+' '+body);
    console.log(`\n[${url}] http=${status} blocked=${blocked}`);
    console.log('  title:', title);
    console.log('  body :', body.slice(0,160));
  }catch(e){ console.log(`\n[${url}] ERROR ${String(e).slice(0,120)}`); }
}
console.log('\n=== API/XHR endpoints observed ===');
[...api].sort().forEach(u=>console.log('  '+u));
await b.close();
