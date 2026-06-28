import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCheapestUrl,
  buildProductsUrl,
  extractDepartureDates,
  extractProducts,
  sweepApollo,
} from '../src/apollo.mjs';

test('buildCheapestUrl carries the locked OSL params', () => {
  const u = buildCheapestUrl({ durationGroup: 7, startDate: '2026-06-28', endDate: '2026-08-12' });
  assert.match(u, /departures\/cheapest\?/);
  assert.match(u, /departureAirportCode=OSL/);
  assert.match(u, /durationGroup=7/);
  assert.match(u, /startDate=2026-06-28/);
  assert.match(u, /endDate=2026-08-12/);
});

test('buildProductsUrl targets a single departure date', () => {
  const u = buildProductsUrl({ durationGroup: 14, departureDate: '2026-07-10' });
  assert.match(u, /\/products\?/);
  assert.match(u, /departureDate=2026-07-10/);
  assert.match(u, /durationGroup=14/);
});

test('extractDepartureDates dedupes + sorts actual departure days', () => {
  const json = {
    Departures: [
      { DepartureDate: '2026-07-10T00:00:00', PricePerPerson: 4000 },
      { DepartureDate: '2026-07-03T00:00:00', PricePerPerson: 2800 },
      { DepartureDate: '2026-07-10T00:00:00', PricePerPerson: 4200 },
    ],
  };
  assert.deepEqual(extractDepartureDates(json), ['2026-07-03', '2026-07-10']);
});

test('extractProducts handles array and wrapped shapes', () => {
  assert.deepEqual(extractProducts([{ a: 1 }]), [{ a: 1 }]);
  assert.deepEqual(extractProducts({ Products: [{ a: 2 }] }), [{ a: 2 }]);
  assert.deepEqual(extractProducts({}), []);
});

test('sweepApollo: two-stage flow across parties, only real departure dates hit /products', async () => {
  const calls = [];
  // Fake BFF: cheapest returns 1 date for dg7, 1 for dg14; products returns
  // one qualifying + one non-qualifying product per date.
  const fetchJson = async (url) => {
    calls.push(url);
    if (url.includes('/cheapest')) {
      const dg = url.match(/durationGroup=(\d+)/)[1];
      const date = dg === '7' ? '2026-07-03' : '2026-07-17';
      return { Departures: [{ DepartureDate: `${date}T00:00:00`, PricePerPerson: 2500 }] };
    }
    return {
      Products: [
        { AccommodationCode: 'CHEAP', Content: { Name: 'Sol' }, Price: { CurrentPrice: 5000, CurrentPricePerPerson: 2500, BrochurePrice: 5200 } },
        { AccommodationCode: 'PRICEY', Content: { Name: 'Lux' }, Price: { CurrentPrice: 12000, CurrentPricePerPerson: 6000, BrochurePrice: 13000 } },
      ],
    };
  };

  const { deals, stats } = await sweepApollo({ todayIso: '2026-06-28', fetchJson });

  // 3 parties × 2 durations: 6 cheapest calls + 6 products calls.
  assert.deepEqual(stats.paxConfigs, ['2v', '2v2b', '4v2b']);
  assert.equal(calls.filter((u) => u.includes('/cheapest')).length, 6);
  assert.equal(stats.productCalls, 6);
  assert.equal(stats.failedCalls, 0);
  assert.equal(stats.qualifying, 6); // one CHEAP per (party × duration)
  assert.equal(stats.productsSeen, 12); // 2 products × 2 dates × 3 parties
  assert.equal(stats.priced, 12);
  assert.equal(stats.minPricePerPerson, 2500);
  assert.ok(deals.every((d) => d.accommodationCode === 'CHEAP'));
  // paxAges is carried into the BFF query for each party.
  assert.ok(calls.some((u) => u.includes('paxAges=18%2C18%2C9%2C12')));
  // Every party appears, and keys are distinct per party.
  assert.deepEqual([...new Set(deals.map((d) => d.pax))].sort(), ['2v', '2v2b', '4v2b']);
  assert.equal(new Set(deals.map((d) => d.key)).size, 6);
});

test('sweepApollo: a failing call is skipped, the rest of the sweep continues', async () => {
  // Throw on every /products for the dg7 leg; cheapest + dg14 products succeed.
  const fetchJson = async (url) => {
    if (url.includes('/cheapest')) {
      const dg = url.match(/durationGroup=(\d+)/)[1];
      const date = dg === '7' ? '2026-07-03' : '2026-07-17';
      return { Departures: [{ DepartureDate: `${date}T00:00:00`, PricePerPerson: 2500 }] };
    }
    if (url.includes('durationGroup=7')) throw new Error('Failed to fetch');
    return {
      Products: [
        { AccommodationCode: 'CHEAP', Content: { Name: 'Sol' }, Price: { CurrentPrice: 5000, CurrentPricePerPerson: 2500, BrochurePrice: 5200 } },
      ],
    };
  };

  const { deals, stats } = await sweepApollo({ todayIso: '2026-06-28', fetchJson });

  // 3 parties × 1 failing dg7 products call each = 3 failures, sweep still finishes.
  assert.equal(stats.failedCalls, 3);
  assert.equal(stats.productCalls, 3); // only the dg14 leg succeeded per party
  assert.equal(stats.qualifying, 3); // one CHEAP per party from dg14
  assert.deepEqual([...new Set(deals.map((d) => d.durationGroup))], [14]);
});
