// Email layer: a pure formatter (unit-tested) + a Resend-backed sender.

import {
  PAX_LABEL,
  PRICE_PER_PERSON_THRESHOLD,
  PRICE_PP_THRESHOLD_4STAR,
  PRICE_PP_THRESHOLD_ALL_INCLUSIVE,
  DISCOUNT_THRESHOLD,
} from './config.mjs';

const NOK = (n) =>
  n == null ? '–' : `${Math.round(n).toLocaleString('nb-NO')} kr`;

/** One human line for a deal, e.g. "Hotel Sol ★4 — 2 900 kr/pp, dep 2026-07-10, 7d, 2 voksne [pp 2900 < 3000]". */
export function formatDealLine(d) {
  const stars = d.stars ? ` ★${d.stars}` : '';
  const why = d.reasons?.length ? ` [${d.reasons.join(', ')}]` : '';
  const seats = d.availability != null ? `, ${d.availability} seats` : '';
  const party = d.pax ? `, ${PAX_LABEL[d.pax] ?? d.pax}` : '';
  return `${d.hotel ?? d.accommodationCode ?? 'Unknown'}${stars} — ${NOK(d.currentPricePerPerson)}/pp (total ${NOK(d.currentPrice)}), dep ${d.departureDate}, ${d.durationGroup}d${party}${seats}${why}`;
}

/**
 * Build the alert email for a batch of newly-seen qualifying deals.
 * Pure: returns { subject, text, html }.
 */
export function formatDealEmail(deals) {
  const n = deals.length;
  const cheapest = deals.reduce(
    (min, d) =>
      d.currentPricePerPerson != null && d.currentPricePerPerson < min
        ? d.currentPricePerPerson
        : min,
    Infinity,
  );
  const subject =
    n === 1
      ? `🏖️ Restplass: ${deals[0].hotel ?? 'deal'} — ${NOK(deals[0].currentPricePerPerson)}/pp`
      : `🏖️ ${n} restplasser fra OSL — fra ${NOK(cheapest)}/pp`;

  const text = [
    `${n} new qualifying deal${n === 1 ? '' : 's'} from Oslo:`,
    '',
    ...deals.map((d) => `• ${formatDealLine(d)}${d.bookingUrl ? `\n  ${d.bookingUrl}` : ''}`),
  ].join('\n');

  const items = deals
    .map((d) => {
      const line = escapeHtml(formatDealLine(d));
      const link = d.bookingUrl
        ? ` <a href="${escapeHtml(d.bookingUrl)}">Book on Apollo →</a>`
        : '';
      return `<li style="margin:0 0 10px">${line}${link}</li>`;
    })
    .join('');
  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.5">
  <p><strong>${n} new qualifying deal${n === 1 ? '' : 's'}</strong> from Oslo (Apollo):</p>
  <ul style="padding-left:18px">${items}</ul>
  <p style="color:#777;font-size:12px">Rule: under ${PRICE_PER_PERSON_THRESHOLD} kr/pp (4★+ ${PRICE_PP_THRESHOLD_4STAR}, all-inclusive ${PRICE_PP_THRESHOLD_ALL_INCLUSIVE}) or ≥${Math.round(DISCOUNT_THRESHOLD * 100)}% off. Brochure-price discounts can be inflated — eyeball before booking.</p>
</div>`;

  return { subject, text, html };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}

/** Resend-backed mailer. Uses the HTTPS API directly (no SDK dependency). */
export class ResendMailer {
  constructor({ apiKey, from, to, fetchImpl = fetch }) {
    this.apiKey = apiKey;
    this.from = from;
    this.to = to;
    this.fetch = fetchImpl;
  }

  async send(deals) {
    const { subject, text, html } = formatDealEmail(deals);
    const res = await this.fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from: this.from, to: this.to, subject, text, html }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
    }
    return res.json().catch(() => ({}));
  }
}

/** Logs to stdout instead of sending — fallback when Resend isn't configured. */
export class ConsoleMailer {
  constructor(log = console.log) {
    this.log = log;
  }

  async send(deals) {
    const { subject, text } = formatDealEmail(deals);
    this.log(`\n[email — not sent, no transport configured]\nSubject: ${subject}\n${text}\n`);
  }
}

/** Build a mailer from the environment. Resend when configured, else console. */
export function createMailerFromEnv(env = process.env, log = console.error) {
  const apiKey = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;
  const to = env.EMAIL_TO;
  if (apiKey && from && to) return new ResendMailer({ apiKey, from, to });
  log('[email] RESEND_API_KEY / EMAIL_FROM / EMAIL_TO not all set — emails will be logged, not sent.');
  return new ConsoleMailer();
}
