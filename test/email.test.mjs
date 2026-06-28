import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDealEmail,
  formatDealLine,
  ResendMailer,
} from '../src/email.mjs';

const base = {
  operator: 'apollo',
  accommodationCode: 'AC1',
  departureDate: '2026-07-10',
  durationGroup: 7,
  pax: '2v',
  hotel: 'Hotel Sol',
  stars: 4,
  availability: 3,
  currentPrice: 5800,
  currentPricePerPerson: 2900,
  reasons: ['pp 2900 < 3000'],
};

test('formatDealLine includes hotel, price, date, party, reason', () => {
  const line = formatDealLine(base);
  assert.match(line, /Hotel Sol/);
  assert.match(line, /★4/);
  assert.match(line, /\/pp/);
  assert.match(line, /2026-07-10/);
  assert.match(line, /2 voksne/); // pax label resolved from key
  assert.match(line, /pp 2900 < 3000/);
});

test('single-deal subject names the hotel', () => {
  const { subject } = formatDealEmail([base]);
  assert.match(subject, /Hotel Sol/);
});

test('multi-deal subject shows count and cheapest pp', () => {
  const cheaper = { ...base, accommodationCode: 'AC2', hotel: 'Hotel Mar', currentPricePerPerson: 1990 };
  const { subject, text, html } = formatDealEmail([base, cheaper]);
  assert.match(subject, /2 restplasser/);
  assert.match(subject, /1\s?990/); // nb-NO groups thousands
  assert.match(text, /Hotel Mar/);
  assert.match(html, /<li/);
});

test('html escapes hotel names', () => {
  const { html } = formatDealEmail([{ ...base, hotel: 'A & B <Resort>' }]);
  assert.match(html, /A &amp; B &lt;Resort&gt;/);
  assert.doesNotMatch(html, /<Resort>/);
});

test('ResendMailer posts to the API and throws on non-ok', async () => {
  let captured;
  const okFetch = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, json: async () => ({ id: 'eml_1' }) };
  };
  const mailer = new ResendMailer({ apiKey: 'k', from: 'a@x.no', to: 'b@y.no', fetchImpl: okFetch });
  await mailer.send([base]);
  assert.equal(captured.url, 'https://api.resend.com/emails');
  assert.match(captured.opts.headers.Authorization, /Bearer k/);
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.to, 'b@y.no');
  assert.ok(body.subject && body.html && body.text);

  const badFetch = async () => ({ ok: false, status: 422, text: async () => 'bad from' });
  const failing = new ResendMailer({ apiKey: 'k', from: 'a@x.no', to: 'b@y.no', fetchImpl: badFetch });
  await assert.rejects(() => failing.send([base]), /Resend 422/);
});
