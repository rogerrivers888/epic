/**
 * Pay on the day (register L10; Stripe build, Phase 6, 3 Oct 2026).
 *
 * The organiser of a private event collects guests' money themselves on the
 * day. Epic holds nothing — no Connect account, no booking money anywhere near
 * Stripe — and charges its own fee, the private payment fee, to the organiser's
 * card on Epic's own account (L8):
 *
 *   · up front, 24 hours before each session, on the ticket price × the guests
 *     who said they're coming;
 *   · after it, the organiser says how many came, within 48 hours (a setting):
 *     more came, the saved card is topped up; fewer came, Epic's fee is not
 *     refunded; not said, the up-front charge stands (owner, 3 Oct 2026).
 *
 * A fee the card refuses is not a reason to call anything off: the organiser
 * is told and the payment problems log holds it for a person.
 */

import { query, withTransaction } from '../db.js';
import * as stripe from './stripe.js';
import * as settings from '../repositories/hostingSettings.js';
import * as problems from '../repositories/paymentProblems.js';
import * as notifications from '../repositories/notifications.js';
import { logChange } from '../repositories/hostingSettings.js';
import { feeFor } from '../domain/money.js';
import { localInstant, perPersonAt } from '../domain/lanes.js';

const refuse = (status, code, message) => Object.assign(new Error(message), { status, code });
const ymd = (d) => (d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) : null);
const hm = (t) => (t ? String(t).slice(0, 5) : null);
const tzOf = (o) => o?.time_zone ?? 'Europe/London';
const startOf = (s, o) => localInstant(ymd(s.on_date), hm(s.starts_at) ?? '00:00', tzOf(o));
const endOf = (s, o) => localInstant(ymd(s.ends_on ?? s.on_date), hm(s.ends_at) ?? hm(s.starts_at) ?? '23:59', tzOf(o));

export const UPFRONT_HOURS = 24;

/** An offer whose guests pay the organiser on the day, for money: the only kind this module touches. */
export const paidOnTheDay = (o) => o?.money === 'direct' && Boolean(o.price_mode) && o.price_mode !== 'free';

/** Epic's fee on an amount the organiser collects: the private payment fee (K3a). Null when it isn't set. */
async function feeOn(basePence) {
  const s = await settings.current();
  const f = feeFor({ visibility: 'private', valuePence: basePence, throughEpic: true }, {}, s);
  return f.reason === 'not_set' ? null : f;
}

// ---------------------------------------------------------------------------
// the organiser's card
// ---------------------------------------------------------------------------

/**
 * Save the organiser's card for Epic's fee. A member whose membership card is the customer's default pays with it,
 * in one tap (L8) — nothing to type. Anyone else gets a SetupIntent to confirm in the browser.
 */
export async function startFeeCard({ host, household, account }) {
  const { ensureCustomer } = await import('./membership.js');
  const customerId = await ensureCustomer({ householdId: household.id, email: account?.email ?? null, name: account?.name ?? null });
  const c = await stripe.retrieveCustomer(customerId, { householdId: household.id }).catch(() => null);
  const def = c?.invoice_settings?.default_payment_method;
  const pm = typeof def === 'string' ? def : def?.id ?? null;
  // The membership card is used without asking — unless the fee card just failed, or it is that same card: then a new
  // one is asked for (Codex, 3 Oct 2026).
  if (pm && !host.fee_card_failed_at && pm !== host.fee_payment_method) {
    await query('update hosts set fee_payment_method = $2, fee_card_saved_at = now(), fee_card_failed_at = null where id = $1', [host.id, pm]);
    return { saved: true };
  }
  const si = await stripe.organiserCardSetup({ customerId, hostId: host.id, householdId: household.id });
  await query('update hosts set fee_card_setup_intent = $2 where id = $1', [host.id, si.id]);
  return { saved: false, clientSecret: si.client_secret, setupIntent: si.id };
}

/** The card saved (Stripe's event, or the read-back after the browser confirms it). */
export async function applyOrganiserSetup(si) {
  if (si?.metadata?.epic_kind !== 'organiser_card' || si.status !== 'succeeded') return null;
  const pm = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id ?? null;
  if (!pm) return null;
  const { rows: [h] } = await query(
    `update hosts set fee_payment_method = $2, fee_card_saved_at = now(), fee_card_failed_at = null where id = $1::uuid and fee_card_setup_intent = $3 returning id`,
    [si.metadata.epic_host_id, pm, si.id]);
  return h?.id ?? null;
}

// ---------------------------------------------------------------------------
// the fees
// ---------------------------------------------------------------------------

/** What a session's guests said: heads, and the ticket value that stands for this session (a booking's share). */
async function saidComing(sessionId) {
  const { rows } = await query(
    `select b.heads, b.value_pence, (select count(*) from booking_sessions x where x.booking_id = b.id and x.state <> 'cancelled')::int as n
       from booking_sessions bs join experience_bookings b on b.id = bs.booking_id
      where bs.session_id = $1 and bs.state = 'booked' and b.state in ('confirmed', 'attended')`, [sessionId]);
  return rows.reduce((t, r) => ({ heads: t.heads + Number(r.heads), basePence: t.basePence + Math.round(Number(r.value_pence ?? 0) / Math.max(1, r.n)) }), { heads: 0, basePence: 0 });
}

/** Charge one fee row on the organiser's card; the row says how it went. */
async function chargeRow(row, { host, charge = stripe.organiserFeeCharge }) {
  const { rows: [hh] } = await query('select stripe_customer_id from households where id = $1', [host.household_id]);
  if (!host.fee_payment_method || !hh?.stripe_customer_id) return failRow(row, host, 'no_card');
  let pi;
  try {
    pi = await charge({ customerId: hh.stripe_customer_id, paymentMethod: host.fee_payment_method, amountPence: row.fee_pence, feeId: row.id, attempt: row.attempt ?? 0, offerId: row.offer_id, sessionId: row.session_id, kind: row.kind, householdId: host.household_id });
  } catch (err) {
    if (err.code === 'stripe_unreachable') return null; // the next run asks again, same key
    return failRow(row, host, err.detail ?? err.code ?? 'refused');
  }
  if (pi.status === 'succeeded') {
    await query(`update organiser_fees set state = 'paid', stripe_payment_intent = $2, paid_at = now(), failure = null where id = $1`, [row.id, pi.id]);
    await problems.resolve({ dedupeKey: `organiser_fee:${row.id}`, resolution: 'Paid', by: 'stripe' });
    return 'paid';
  }
  // The bank hasn't answered yet: pending, and Stripe's event settles it (applyOrganiserFeeIntent) (Codex, 3 Oct 2026).
  if (pi.status === 'processing') {
    await query(`update organiser_fees set stripe_payment_intent = $2 where id = $1`, [row.id, pi.id]);
    return null;
  }
  return failRow(row, host, pi.last_payment_error?.code ?? pi.status, pi.id);
}

async function failRow(row, host, code, piId = null) {
  // A definite refusal: the next try (a new card) is a new request under a new key; and the checklist asks for a card again.
  await query(`update organiser_fees set state = 'failed', failed_at = now(), failed_card = $4, failure = $2, stripe_payment_intent = coalesce($3, stripe_payment_intent), attempt = attempt + case when $2 = 'no_card' then 0 else 1 end where id = $1`, [row.id, String(code).slice(0, 80), piId, host?.fee_payment_method ?? null]);
  if (code !== 'no_card') await query('update hosts set fee_card_failed_at = now() where id = $1', [row.host_id]);
  await problems.record({ kind: 'payment_failed', dedupeKey: `organiser_fee:${row.id}`, amountPence: row.fee_pence, hostId: row.host_id, offerId: row.offer_id, householdId: host.household_id, stripeRef: piId, detail: { for: 'organiser_fee', kind: row.kind, code }, reopen: true });
  await notifications.notify({ householdId: host.household_id, kind: 'organiser_fee_failed', title: 'Epic’s fee for your event didn’t go through', body: code === 'no_card' ? 'Add a card for Epic’s fee.' : 'Your card was declined. Update it from the event.', link: `/host/offers/${row.offer_id}/publish?sheet=fee_card`, dedupeKey: `organiser_fee_failed:${row.id}` }).catch(() => null);
  return 'failed';
}

/** Stripe's word on a fee that was processing: paid, or refused (its event, read back). */
export async function applyOrganiserFeeIntent(pi) {
  const feeId = pi?.metadata?.epic_fee_id;
  if (!feeId) return null;
  const { rows: [row] } = await query(`select * from organiser_fees where id = $1::uuid and state = 'pending'`, [feeId]).catch(() => ({ rows: [] }));
  if (!row) return null;
  if (pi.status === 'succeeded') {
    await query(`update organiser_fees set state = 'paid', stripe_payment_intent = $2, paid_at = now(), failure = null where id = $1 and state = 'pending'`, [row.id, pi.id]);
    await problems.resolve({ dedupeKey: `organiser_fee:${row.id}`, resolution: 'Paid', by: 'stripe' });
  } else if (pi.status === 'requires_payment_method' || pi.status === 'canceled') {
    const { rows: [host] } = await query('select * from hosts where id = $1', [row.host_id]);
    await failRow(row, host, pi.last_payment_error?.code ?? pi.status, pi.id);
  }
  return row.id;
}

/**
 * The up-front fees: every session of an event paid on the day that starts within 24 hours, once, on the guests who
 * have said they're coming.
 */
export async function chargeUpfrontFees({ now = new Date(), status = stripe.stripeStatus, charge = stripe.organiserFeeCharge } = {}) {
  const out = { paid: 0, failed: 0, nothing: 0 };
  if (!status().ready) return { ...out, skipped: 'stripe_not_ready' };
  const { rows } = await query(
    `select s.*, o.time_zone, o.money, o.price_mode, o.host_id from offer_sessions s join host_offers o on o.id = s.offer_id
      where o.money = 'direct' and coalesce(o.price_mode, 'free') <> 'free' and s.state = 'scheduled'
        and s.on_date between ($1::timestamptz at time zone 'UTC')::date - 1 and ($1::timestamptz at time zone 'UTC')::date + 2
        and not exists (select 1 from organiser_fees f where f.session_id = s.id and f.kind = 'upfront')
      limit 200`, [now]);
  for (const s of rows) {
    const start = startOf(s, s);
    if (start <= now || start.getTime() - now.getTime() > UPFRONT_HOURS * 3_600_000) continue;
    const said = await saidComing(s.id);
    const fee = await feeOn(said.basePence);
    if (!fee) continue; // the rate isn't set: nothing can be worked out (can't speak)
    const { rows: [row] } = await query(
      `insert into organiser_fees (offer_id, session_id, host_id, kind, heads, base_pence, rate_pct, fee_pence, state)
       values ($1, $2, $3, 'upfront', $4, $5, $6, $7, case when $7 = 0 then 'paid' else 'pending' end)
       on conflict (session_id, kind) do nothing returning *`,
      [s.offer_id, s.id, s.host_id, said.heads, said.basePence, fee.ratePct, fee.feePence]);
    if (!row) continue;
    if (row.fee_pence === 0) { out.nothing += 1; continue; }
    const { rows: [host] } = await query('select * from hosts where id = $1', [s.host_id]);
    const r = await chargeRow(row, { host, charge });
    if (r === 'paid') out.paid += 1; else if (r === 'failed') out.failed += 1;
  }
  return out;
}

/** Up-front rows the card refused, or that Stripe couldn't be reached for, are tried again (a new card saved, say). */
export async function retryOrganiserFees({ charge = stripe.organiserFeeCharge, status = stripe.stripeStatus } = {}) {
  if (!status().ready) return 0;
  const { rows } = await query(
    `select f.* from organiser_fees f join hosts h on h.id = f.host_id
      where (f.state = 'pending' and f.stripe_payment_intent is null)
         -- Each card once: tried again only on a different card from the one it was refused on (Codex, 3 Oct 2026).
         or (f.state = 'failed' and h.fee_payment_method is not null and h.fee_payment_method is distinct from f.failed_card) limit 50`);
  let n = 0;
  for (const row of rows) {
    const { rows: [host] } = await query('select * from hosts where id = $1', [row.host_id]);
    if (row.state === 'failed') await query(`update organiser_fees set state = 'pending' where id = $1 and state = 'failed'`, [row.id]);
    const { rows: [fresh] } = await query('select * from organiser_fees where id = $1', [row.id]);
    if ((await chargeRow(fresh, { host, charge })) === 'paid') n += 1;
  }
  return n;
}

/**
 * The ticket price a head, for guests nobody had booked: what those who did booked at, a head — or, with none, the
 * event's own rule: by numbers, the price a head at its minimum; otherwise its price a person (Codex, 3 Oct 2026).
 */
async function eachHead(s) {
  const said = await saidComing(s.id);
  if (said.heads > 0) return Math.round(said.basePence / said.heads);
  if (s.price_mode === 'by_numbers') return perPersonAt(s.total_pence ?? 0, s.min_count ?? 1) ?? 0;
  return Number(s.price_pence ?? 0);
}

/**
 * The organiser says how many came, within the window after the session (pay_on_day_headcount_hours). More than
 * said they were coming: the saved card is topped up for the extra. Fewer: no refund of Epic's fee.
 */
export async function confirmHeadcount({ sessionId, hostId, heads, now = new Date(), charge = stripe.organiserFeeCharge }) {
  const n = Math.floor(Number(heads));
  if (!Number.isInteger(n) || n < 0 || n > 10_000) throw refuse(400, 'heads', 'How many came?');
  const s0 = await withTransaction(async (c) => {
    const { rows: [s] } = await c.query(
      `select s.*, o.time_zone, o.money, o.price_mode, o.price_pence, o.total_pence, o.min_count, o.per, o.host_id from offer_sessions s join host_offers o on o.id = s.offer_id where s.id = $1 and o.host_id = $2 for update of s`, [sessionId, hostId]);
    if (!s || !paidOnTheDay(s)) throw refuse(404, 'not_found', 'That session isn’t yours, or isn’t paid on the day.');
    const end = endOf(s, s);
    const hours = Number((await settings.current()).pay_on_day_headcount_hours ?? 48);
    if (now < end) throw refuse(409, 'not_yet', 'Say how many came once it’s happened.');
    if (now.getTime() - end.getTime() > hours * 3_600_000) throw refuse(409, 'too_late', `That had to be said within ${hours} hours; what was charged up front stands.`);
    if (s.headcount != null) throw refuse(409, 'said', 'You’ve said how many came already.');
    await c.query('update offer_sessions set headcount = $2, headcount_at = now() where id = $1', [s.id, n]);
    await logChange({ subjectKind: 'session', subjectId: s.id, field: 'headcount', after: { heads: n }, byLabel: 'host' }, c);
    return s;
  });
  const { rows: [up] } = await query(`select * from organiser_fees where session_id = $1 and kind = 'upfront'`, [sessionId]);
  // No up-front charge was ever made (the job missed its window): the fee is taken now, on how many came (Codex).
  if (!up) {
    const base = n * await eachHead(s0);
    const fee = await feeOn(base);
    if (!fee || fee.feePence <= 0) return { heads: n, topUpPence: 0 };
    const { rows: [row] } = await query(
      `insert into organiser_fees (offer_id, session_id, host_id, kind, heads, base_pence, rate_pct, fee_pence) values ($1, $2, $3, 'upfront', $4, $5, $6, $7)
       on conflict (session_id, kind) do nothing returning *`, [s0.offer_id, sessionId, hostId, n, base, fee.ratePct, fee.feePence]);
    if (row) { const { rows: [host] } = await query('select * from hosts where id = $1', [hostId]); await chargeRow(row, { host, charge }); }
    return { heads: n, topUpPence: fee.feePence };
  }
  if (n <= up.heads) return { heads: n, topUpPence: 0 };
  // The extra guests at the same ticket price per head as those who said they were coming — or, when nobody had said
  // so (walk-ins only), the event's own price per person (Codex, 3 Oct 2026).
  const each = up.heads > 0 ? Math.round(up.base_pence / up.heads) : await eachHead(s0);
  const base = each * (n - up.heads);
  const fee = await feeOn(base);
  if (!fee || fee.feePence <= 0) return { heads: n, topUpPence: 0 };
  const { rows: [row] } = await query(
    `insert into organiser_fees (offer_id, session_id, host_id, kind, heads, base_pence, rate_pct, fee_pence) values ($1, $2, $3, 'topup', $4, $5, $6, $7)
     on conflict (session_id, kind) do nothing returning *`, [s0.offer_id, sessionId, hostId, n - up.heads, base, fee.ratePct, fee.feePence]);
  if (row) {
    const { rows: [host] } = await query('select * from hosts where id = $1', [hostId]);
    await chargeRow(row, { host, charge });
  }
  return { heads: n, topUpPence: fee.feePence };
}
