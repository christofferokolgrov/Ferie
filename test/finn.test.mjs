import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFinnUrl,
  extractOffers,
  hotelSlug,
  normalizeFinnOffer,
  sweepFinn,
} from '../src/finn.mjs';
import { toDealRow } from '../src/storage.mjs';
import { FINN_OPERATORS } from '../src/config.mjs';

test('buildFinnUrl carries OSL packages, all operators, price sort', () => {
  const u = buildFinnUrl({ pageNumber: 2 });
  assert.match(u, /\/travel-api\/lms\/offers\?/);
  assert.match(u, /fra=OSL/);
  assert.match(u, /type=spesifisert/);
  assert.match(u, /sorter=pris_lms/);
  assert.match(u, /pageNumber=2/);
  for (const op of FINN_OPERATORS) assert.match(u, new RegExp(`med=${op}`));
  assert.doesNotMatch(u, /med=apollo/); // never source apollo/ving via Finn
  assert.doesNotMatch(u, /med=ving/);
});

const TUI_OFFER = {
  offerId: '75ef215e',
  outboundDepartureTime: '2026-08-08T17:30:00',
  originAirportCode: 'OSL',
  originCity: 'Oslo',
  destination: 'Rhodos by',
  country: 'Hellas',
  duration: '7',
  hotelName: 'Leiligheter Palmasol',
  rating: '2.5',
  tripType: 'SPECIFIED',
  price: '4393',
  deepLink: 'https://www.tui.no/no/bestill-reise?productCode=P-000008920',
  supplier: 'tui',
  brand: 'TUI',
};

test('normalizeFinnOffer maps to the shared deal shape', () => {
  const p = normalizeFinnOffer(TUI_OFFER);
  assert.equal(p.operator, 'tui');
  assert.equal(p.accommodationCode, 'leiligheter-palmasol');
  assert.equal(p.departureDate, '2026-08-08');
  assert.equal(p.durationGroup, 7);
  assert.equal(typeof p.durationGroup, 'number'); // column is integer NOT NULL
  assert.equal(p.pax, null); // Finn has no party concept
  assert.equal(p.hotel, 'Leiligheter Palmasol');
  assert.equal(p.stars, 2.5);
  assert.equal(p.currentPricePerPerson, 4393);
  assert.equal(p.currentPrice, null);
  assert.equal(p.brochurePrice, null); // → discount never computable for Finn
  assert.equal(p.availability, null);
  assert.equal(p.bookingUrl, TUI_OFFER.deepLink);
  assert.equal(p.destination, 'Hellas – Rhodos by'); // country – destination
  assert.equal(p.mealPlan, null); // Finn carries no board basis
});

test('unrated hotel (0.0) maps stars to null', () => {
  assert.equal(normalizeFinnOffer({ ...TUI_OFFER, rating: '0.0' }).stars, null);
});

test('normalized Finn deal is a valid deals-table row (dashboard compatible)', () => {
  const p = normalizeFinnOffer(TUI_OFFER);
  const row = toDealRow({ ...p, discount: null, reasons: ['pp 4393 < 3500'], key: 'tui|x|2026-08-08|7|' });
  // NOT NULL columns must be present and correctly typed.
  assert.equal(typeof row.departure_date, 'string');
  assert.equal(Number.isInteger(row.duration_group), true);
  assert.equal(row.operator, 'tui');
  // snake_case fields the dashboard reads
  assert.equal(row.current_price_per_person, 4393);
  assert.equal(row.hotel, 'Leiligheter Palmasol');
  assert.equal(row.stars, 2.5);
  assert.equal(row.booking_url, TUI_OFFER.deepLink);
  assert.equal(row.pax, null);
  assert.equal(row.destination, 'Hellas – Rhodos by'); // new column (migration 0004)
  assert.equal(row.meal_plan, null);
  assert.ok('last_seen_at' in row);
});

test('extractOffers is defensive', () => {
  assert.deepEqual(extractOffers({ offers: [TUI_OFFER] }).length, 1);
  assert.deepEqual(extractOffers({}), []);
  assert.deepEqual(extractOffers(null), []);
});

// --- sweep: cheapest-first paging, stop at the price bar, horizon gate --------

function pagedFetch(pages) {
  return async (pageNumber) => pages[pageNumber - 1] ?? { offers: [], currentPage: pageNumber, totalPages: pages.length };
}
const mk = (over) => ({ ...TUI_OFFER, ...over });

test('sweepFinn applies tiered bars (4★ up to 4500), gates horizon, stops at top tier', async () => {
  // todayIso 2026-06-28, horizon 50d → window ~ up to 2026-08-17.
  const page1 = {
    currentPage: 1,
    totalPages: 2,
    offers: [
      mk({ price: '2990', rating: '2.5', hotelName: 'Cheap Inn', outboundDepartureTime: '2026-07-10T00:00:00', supplier: 'tui' }),    // <3500 base → qualifies
      mk({ price: '3200', rating: '2.0', hotelName: 'Far Future', outboundDepartureTime: '2026-12-01T00:00:00', supplier: 'amisol' }),// under base but outside horizon → skip
      mk({ price: '4200', rating: '4.5', hotelName: 'Posh 4star', outboundDepartureTime: '2026-08-01T00:00:00', supplier: 'tui' }),   // 4★ tier (4500) → qualifies
      mk({ price: '4300', rating: '3.0', hotelName: 'Midrange', outboundDepartureTime: '2026-07-15T00:00:00' }),                      // 3★ → base bar → NOT qualifying, but < stop bar → keep scanning
      mk({ price: '4600', rating: '5.0', hotelName: 'Over Bar', outboundDepartureTime: '2026-07-15T00:00:00' }),                      // >= 4500 stop bar → STOP
      mk({ price: '4700', hotelName: 'Never Seen', outboundDepartureTime: '2026-07-15T00:00:00' }),                                   // not reached
    ],
  };
  const page2 = { currentPage: 2, totalPages: 2, offers: [mk({ price: '5000' })] }; // never fetched (stopped)

  const { deals, stats } = await sweepFinn({ todayIso: '2026-06-28', fetchOffers: pagedFetch([page1, page2]) });

  assert.deepEqual(deals.map((d) => d.hotel).sort(), ['Cheap Inn', 'Posh 4star']);
  const posh = deals.find((d) => d.hotel === 'Posh 4star');
  assert.match(posh.reasons.join(' '), /4★|4500/); // qualified via the 4★ tier
  assert.ok(deals.every((d) => d.key.includes('|') && d.bookingUrl && d.reasons.length));
  assert.equal(stats.outsideHorizon, 1);
  assert.equal(stats.minPricePerPerson, 2990);
});

test('sweepFinn skips offers from non-Finn operators (never apollo/ving) and missing supplier', async () => {
  const page1 = {
    currentPage: 1, totalPages: 1,
    offers: [
      mk({ price: '2990', hotelName: 'Real TUI', supplier: 'tui', outboundDepartureTime: '2026-07-10T00:00:00' }),
      mk({ price: '2991', hotelName: 'Bundled Apollo', supplier: 'apollo', outboundDepartureTime: '2026-07-10T00:00:00' }),
      mk({ price: '2992', hotelName: 'No Supplier', supplier: undefined, outboundDepartureTime: '2026-07-10T00:00:00' }),
    ],
  };
  const { deals, stats } = await sweepFinn({ todayIso: '2026-06-28', fetchOffers: pagedFetch([page1]) });
  assert.deepEqual(deals.map((d) => d.hotel), ['Real TUI']);
  assert.equal(stats.skippedOther, 2);
});

test('sweepFinn drops offers with no parseable duration (duration_group is NOT NULL)', async () => {
  const page1 = {
    currentPage: 1, totalPages: 1,
    offers: [
      mk({ price: '2990', hotelName: 'Has Duration', duration: '7', outboundDepartureTime: '2026-07-10T00:00:00' }),
      mk({ price: '2991', hotelName: 'No Duration', duration: '', outboundDepartureTime: '2026-07-10T00:00:00' }),
    ],
  };
  const { deals, stats } = await sweepFinn({ todayIso: '2026-06-28', fetchOffers: pagedFetch([page1]) });
  assert.deepEqual(deals.map((d) => d.hotel), ['Has Duration']);
  assert.equal(stats.skippedNoDuration, 1);
  assert.ok(deals.every((d) => Number.isInteger(d.durationGroup)));
});

test('sweepFinn returns nothing when the cheapest is already over the top tier', async () => {
  // ★2.5 at 4393 → base bar (3500), doesn't qualify; but it's < 4500 stop bar so
  // we keep scanning; the 4600 then trips the stop. Nothing under its tier here.
  const page1 = { currentPage: 1, totalPages: 1, offers: [mk({ price: '4393', rating: '2.5' }), mk({ price: '4600', rating: '5.0' }), mk({ price: '5000' })] };
  const { deals, stats } = await sweepFinn({ todayIso: '2026-06-28', fetchOffers: pagedFetch([page1]) });
  assert.equal(deals.length, 0);
  assert.equal(stats.qualifying, 0);
});
