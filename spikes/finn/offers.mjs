// Finn travel API spike — the winning, simplest source of all.
// Finn aggregates ALL Norwegian charter operators (apollo, tui, ving, amisol,
// nazar) in one PLAIN JSON API reachable with a bare fetch — NO browser, NO
// Akamai/Cloudflare clearance, NO residential proxy. This is how we reach TUI
// (tui.no itself hard-blocks datacenter IPs).
//
//   GET https://www.finn.no/travel-api/lms/offers?<params>
//
// Params (all reflected 1:1 from the page URL; discovered from the bundle + by
// watching numFound):
//   fra=OSL          origin airport code        (airportFacet)
//   med=tui          operator/supplier          (supplierFacet: apollo|tui|ving|amisol|nazar|tripx|sasholidays|ticket)
//   type=spesifisert trip type = fly+hotel pkg  (also: fly, enveisfly, uspesifisert)
//   sorter=pris_lms  sort cheapest-first        (also: avreise = by departure date)
//   pageNumber=1     pagination
//   lengde / pris / avreise / til / stjerner    duration / price / date / destination / stars
// Repeat a key to OR within a facet, e.g. med=tui&med=amisol.
//
// Response: { numFound, totalPages, currentPage, offers:[{ offerId,
//   outboundDepartureTime, originAirportCode, originCity, destination, region,
//   country, duration, hotelName, rating, tripType, price (per person, NOK),
//   deepLink, supplier, brand }], airportFacet, supplierFacet, ... }
//
// Run: node offers.mjs [operator]   (default tui)
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const API = 'https://www.finn.no/travel-api/lms/offers';
const operator = process.argv[2] || 'tui';

const q = new URLSearchParams({ fra: 'OSL', type: 'spesifisert', med: operator, sorter: 'pris_lms', pageNumber: '1' });
const res = await fetch(`${API}?${q}`, { headers: { 'user-agent': UA, accept: 'application/json' } });
const data = await res.json();

console.log(`HTTP ${res.status} | ${operator} OSL packages: numFound=${data.numFound} totalPages=${data.totalPages}`);
console.log('\ncheapest 10 (pp | date | dur | stars | dest | hotel):');
for (const o of data.offers.slice(0, 10)) {
  console.log(`  ${String(o.price).padStart(5)} | ${o.outboundDepartureTime.slice(0, 10)} | ${String(o.duration).padStart(2)}d | ★${o.rating} | ${(o.country + '/' + o.destination).padEnd(24).slice(0, 24)} | ${o.hotelName}`);
}
console.log('\nsample deepLink:\n  ' + data.offers[0]?.deepLink);
