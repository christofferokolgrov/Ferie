import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVingBody,
  extractTrips,
  extractPageInfo,
  cheapestPackageOffer,
  normalizeVingTrip,
  buildVingBookingUrl,
  sweepVing,
} from '../src/ving.mjs';
import { VING_PAX_CONFIGS } from '../src/config.mjs';

// A minimal stand-in for the page's captured query body.
const TEMPLATE = '{"query":"{ lmsTrips(first:10 orderBy: DATE departureCode:[\\"OSL\\"]) { edges { node { } } } }"}';

test('buildVingBody injects args after orderBy and bumps page size', () => {
  const body = buildVingBody(TEMPLATE, {
    tripTypes: 'SPECIFIED',
    priceTo: 3500,
    dateTo: '2026-08-17',
    first: 40,
    after: 'CUR123',
  });
  assert.match(body, /first:40/);
  assert.match(body, /tripTypes:\[SPECIFIED\]/);
  assert.match(body, /priceTo:3500/);
  assert.match(body, /dateTo:\\"2026-08-17\\"/);
  assert.match(body, /after:\\"CUR123\\"/);
  // orderBy stays DATE (orderBy: PRICE + edges errors server-side).
  assert.match(body, /orderBy: DATE/);
  assert.doesNotMatch(body, /orderBy: PRICE/);
});

test('buildVingBody with no opts only normalizes page size', () => {
  const body = buildVingBody(TEMPLATE, {});
  assert.match(body, /first:40/);
  assert.doesNotMatch(body, /priceTo/);
});

test('extractTrips / extractPageInfo read defensively', () => {
  const json = {
    data: {
      lmsTrips: {
        edges: [{ node: { duration: 8 } }, { node: null }, {}],
        pageInfo: { hasNextPage: true, endCursor: 'X' },
      },
    },
  };
  assert.deepEqual(extractTrips(json), [{ duration: 8 }]);
  assert.deepEqual(extractPageInfo(json), { hasNextPage: true, endCursor: 'X' });
  assert.deepEqual(extractTrips({}), []);
  assert.deepEqual(extractPageInfo({}), { hasNextPage: false, endCursor: null });
});

test('cheapestPackageOffer ignores flight-only and picks the cheapest package', () => {
  const node = {
    offers: [
      { type: 'flightOnly', price: 995, hotelCode: 'FLYA' },
      { type: 'specified', price: 4200, hotelCode: 'AAA' },
      { type: 'specified', price: 2890, hotelCode: 'BBB' },
    ],
  };
  assert.equal(cheapestPackageOffer(node).hotelCode, 'BBB');
  // a flight-only-only trip yields no package offer
  assert.equal(cheapestPackageOffer({ offers: [{ type: 'flightOnly', price: 995 }] }), null);
  assert.equal(cheapestPackageOffer({ offers: [] }), null);
});

const SAMPLE_NODE = {
  date: { raw: '2026-07-12T00:00:00' },
  duration: 8,
  destinationCode: 'CHQ',
  departureCode: 'OSL',
  numFreeSeats: 6,
  serialNumber: 42,
  departure: { caId: 12667 },
  destinationAirport: 'Kreta/Chania',
  offers: [{ type: 'specified', price: 2890, hotelCode: 'MONT' }],
  hotel: { content: { geographical: { country: { caId: 100 }, resort: { caId: 200 }, area: { caId: 300 } } } },
};

test('normalizeVingTrip maps to the shared deal shape, per person, no discount', () => {
  const offer = cheapestPackageOffer(SAMPLE_NODE);
  const p = normalizeVingTrip(SAMPLE_NODE, offer, { key: '2v', size: 2, roomAges: '42,42' });
  assert.equal(p.operator, 'ving');
  assert.equal(p.accommodationCode, 'MONT');
  assert.equal(p.departureDate, '2026-07-12');
  assert.equal(p.durationGroup, 8);
  assert.equal(p.pax, '2v');
  assert.equal(p.currentPricePerPerson, 2890);
  assert.equal(p.currentPrice, 2890 * 2); // per-person × headcount (Ving convention)
  assert.equal(p.availability, 6);
  assert.equal(p.brochurePrice, null); // no list price → discount never computable
  assert.equal(p.mealPlan, null);
  assert.match(p.hotel, /Kreta\/Chania/);
});

test('buildVingBookingUrl replicates the bundle deep-link params', () => {
  const offer = cheapestPackageOffer(SAMPLE_NODE);
  const p = normalizeVingTrip(SAMPLE_NODE, offer, { key: '4v2b', size: 6, roomAges: '42,42,42,42,9,12' });
  const url = buildVingBookingUrl(p);
  assert.match(url, /^https:\/\/www\.ving\.no\/restplass-hotell\?/);
  assert.match(url, /SelectedDestCd=CHQ/);
  assert.match(url, /QueryDepDate=20260712/);
  assert.match(url, /SelectedHotCd=MONT/);
  assert.match(url, /QueryRoomAges=42,42,42,42,9,12/);
  assert.match(url, /SelectedSerNo=42/);
  assert.match(url, /QueryDepID=12667/);
  assert.match(url, /price=17340/); // 2890 × 6 travellers
});

test('buildVingBookingUrl returns null without the identifiers it needs', () => {
  assert.equal(buildVingBookingUrl({ accommodationCode: 'X', departureDate: '2026-07-12' }), null);
});

// --- sweep: package-only + capacity-gated per party --------------------------

function fakeSession(nodes) {
  // One page, no next page. fetchTrips ignores the body and returns canned data.
  return {
    todayIso: '2026-06-28',
    template: TEMPLATE,
    fetchTrips: async () => ({
      data: { lmsTrips: { edges: nodes.map((node) => ({ node })), pageInfo: { hasNextPage: false } } },
    }),
  };
}

test('sweepVing emits package deals per party, gated by free seats', async () => {
  const cheapPkg2seats = {
    ...SAMPLE_NODE, serialNumber: 1, numFreeSeats: 2,
    offers: [{ type: 'specified', price: 1990, hotelCode: 'AAA' }],
  };
  const cheapPkg6seats = {
    ...SAMPLE_NODE, serialNumber: 2, numFreeSeats: 6,
    offers: [{ type: 'specified', price: 2490, hotelCode: 'BBB' }],
  };
  const flightOnly = {
    ...SAMPLE_NODE, serialNumber: 3, numFreeSeats: 9,
    offers: [{ type: 'flightOnly', price: 995, hotelCode: 'FLYA' }],
  };
  const tooPricey = {
    ...SAMPLE_NODE, serialNumber: 4, numFreeSeats: 9,
    offers: [{ type: 'specified', price: 9999, hotelCode: 'CCC' }],
  };

  const { deals, stats } = await sweepVing(
    fakeSession([cheapPkg2seats, cheapPkg6seats, flightOnly, tooPricey]),
  );

  // flight-only excluded entirely.
  assert.ok(deals.every((d) => d.accommodationCode !== 'FLYA'));
  // over-threshold package excluded by the absolute price rule.
  assert.ok(deals.every((d) => d.accommodationCode !== 'CCC'));

  // 2-seat package: only the 2-adult party fits.
  const aaa = deals.filter((d) => d.accommodationCode === 'AAA');
  assert.deepEqual(aaa.map((d) => d.pax).sort(), ['2v']);

  // 6-seat package: all three parties fit (2,4,6 <= 6).
  const bbb = deals.filter((d) => d.accommodationCode === 'BBB');
  assert.deepEqual(bbb.map((d) => d.pax).sort(), ['2v', '4v', '4v2b']);

  // every deal carries a per-party dedup key and a booking link.
  assert.ok(deals.every((d) => d.key.startsWith('ving|') && d.bookingUrl));
  assert.equal(stats.packagesSeen, 3); // AAA, BBB, CCC (FLYA has no package offer)
  assert.equal(stats.minPricePerPerson, 1990);
});

test('VING_PAX_CONFIGS covers the three requested parties', () => {
  assert.deepEqual(VING_PAX_CONFIGS.map((p) => p.key), ['2v', '4v', '4v2b']);
  assert.deepEqual(VING_PAX_CONFIGS.map((p) => p.size), [2, 4, 6]);
});
