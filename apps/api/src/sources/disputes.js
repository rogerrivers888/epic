/**
 * Chargebacks (register L3; Stripe build, Phases 7–8; back-office hooks).
 *
 * A chargeback is the guest's bank's decision, never Epic's: while one is open
 * the booking's payout waits (hostingLedger.markDispute). Each Stripe dispute is
 * a row in `chargebacks` with its deadline, and one row in the payment problems
 * log through every stage, closed when the bank decides.
 *
 * Nobody has to remember the deadline: Epic's own evidence — the booking, who
 * came, what was agreed — is sent automatically two days before it, unless a
 * person has already sent it or accepted the chargeback (design handover §3:
 * "Sends automatically on {date}").
 */

import { query } from '../db.js';
import * as problems from '../repositories/paymentProblems.js';
import * as stripe from './stripe.js';
import { logAutomation } from './automationLog.js';

export const SEND_DAYS_BEFORE = 2;

/** One sighting of a dispute: its row and its problem brought up to its stage; closed when the bank has decided. */
export async function applyDispute(d, { closed = false, eventType = null } = {}) {
  if (!d?.id) return null;
  const pi = typeof d.payment_intent === 'string' ? d.payment_intent : d.payment_intent?.id ?? null;
  const { rows: [b] } = pi ? await query('select id, household_id, host_id, offer_id from experience_bookings where stripe_payment_intent = $1', [pi]) : { rows: [] };
  const dueBy = d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000) : null;
  await query(
    `insert into chargebacks (id, booking_id, payment_intent, amount_pence, reason, status, due_by, closed_at, mode)
     values ($1, $2, $3, $4, $5, $6, $7, case when $8 then now() end, $9)
     on conflict (id) do update set booking_id = coalesce(chargebacks.booking_id, excluded.booking_id), amount_pence = excluded.amount_pence,
       reason = excluded.reason, status = excluded.status, due_by = coalesce(excluded.due_by, chargebacks.due_by),
       closed_at = case when $8 then coalesce(chargebacks.closed_at, now()) else chargebacks.closed_at end, updated_at = now()`,
    [d.id, b?.id ?? null, pi, d.amount ?? null, d.reason ?? null, d.status ?? null, dueBy, closed, d.livemode ? 'live' : 'test'],
  );
  const row = await problems.record({
    kind: 'chargeback', dedupeKey: `chargeback:${d.id}`, amountPence: d.amount ?? null, bookingId: b?.id ?? null, householdId: b?.household_id ?? null,
    hostId: b?.host_id ?? null, offerId: b?.offer_id ?? null, stripeRef: d.id, stage: d.status ?? null,
    detail: { reason: d.reason ?? null, dueBy: dueBy?.toISOString() ?? null, paymentIntent: pi, lastEvent: eventType }, mode: d.livemode ? 'live' : 'test',
  });
  if (closed && ['won', 'lost', 'warning_closed'].includes(d.status)) {
    await problems.resolve({ dedupeKey: `chargeback:${d.id}`, resolution: d.status === 'won' ? 'The bank decided for Epic' : d.status === 'lost' ? 'The bank decided for the guest' : 'Closed without a chargeback', by: 'stripe', stage: d.status });
  }
  return row;
}

const day = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' }) : null);
const gbp = (p) => `£${(Number(p ?? 0) / 100).toFixed(2)}`;

/**
 * Epic's evidence for one booking, from Epic's own records only, in Stripe's text fields: what was bought, by whom,
 * when it happened, who came, what the guest said afterwards, and the refund terms they agreed to before paying.
 */
export async function assembleEvidence(bookingId) {
  const { rows: [b] } = await query(
    `select b.*, o.title, o.lane, h.name as host_name, a.email, a.name as account_name
       from experience_bookings b join host_offers o on o.id = b.offer_id join hosts h on h.id = b.host_id
       left join lateral (select email, name from accounts where household_id = b.household_id and status <> 'suspended' order by (member_id is null) desc, created_at limit 1) a on true
      where b.id = $1`, [bookingId]);
  if (!b) return null;
  const { rows: sessions } = await query(
    `select s.on_date, s.starts_at, bs.state from booking_sessions bs join offer_sessions s on s.id = bs.session_id where bs.booking_id = $1 order by s.on_date, s.starts_at`, [bookingId]);
  const { rows: [msgs] } = await query(`select count(*)::int as n from hosting_changes where subject_kind = 'booking' and subject_id = $1`, [bookingId]).catch(() => ({ rows: [{ n: 0 }] }));
  const held = sessions.map((s) => `${day(s.on_date)}${s.starts_at ? ` ${String(s.starts_at).slice(0, 5)}` : ''} — ${s.state}`).join('; ');
  const terms = b.refund_terms ? JSON.stringify(b.refund_terms) : null;
  return {
    product_description: `${b.title ?? 'An event'} with ${b.host_name ?? 'a host'} on Epic: ${b.heads} ${b.heads === 1 ? 'place' : 'places'}, ${gbp(b.charged_pence ?? b.value_pence)}.`,
    customer_name: b.account_name ?? undefined,
    customer_email_address: b.email ?? undefined,
    service_date: sessions[0] ? new Date(sessions[0].on_date).toISOString().slice(0, 10) : undefined,
    access_activity_log: `Sessions booked: ${held || 'none'}. Booking made ${day(b.created_at)}. ${b.confirmed_happened ? `After the event the guest answered "did it happen?": ${b.confirmed_happened}.` : 'The guest did not answer "did it happen?".'} ${msgs?.n ?? 0} recorded changes on the booking.`,
    refund_policy_disclosure: `The refund policy (${b.refund_policy ?? 'none'}) was shown on the event page and in the booking sheet before payment${b.cancellation_fee_pct != null ? `; a ${Number(b.cancellation_fee_pct)}% cancellation fee applies to a cancellation that would otherwise be refunded in full` : ''}.${terms ? ` Terms agreed: ${terms}` : ''}`,
    cancellation_policy_disclosure: 'Cancelling is in the booking itself on Epic, at any time before the event, under the refund policy above.',
    uncategorized_text: `Booking ${b.id}. Refunded so far ${gbp(b.refunded_pence)}. ${b.state === 'cancelled' ? `Cancelled by ${b.cancelled_by ?? 'unknown'} (${b.cancel_cause ?? 'no reason'}).` : `Booking ${b.state}.`}`,
  };
}

/** Send one chargeback's evidence to the bank, by a person or by the job. Once: a second send is a no-op. */
export async function sendEvidence(disputeId, { by = 'epic', submit = stripe.submitDisputeEvidence } = {}) {
  const { rows: [cb] } = await query('select * from chargebacks where id = $1', [disputeId]);
  if (!cb || cb.evidence_sent_at || cb.accepted_at || cb.closed_at) return null;
  const evidence = cb.booking_id ? await assembleEvidence(cb.booking_id) : null;
  if (!evidence) return null;
  await submit(disputeId, evidence, { submit: true });
  const { rows: [done] } = await query(
    `update chargebacks set evidence = $2::jsonb, evidence_sent_at = now(), evidence_sent_by = $3, updated_at = now() where id = $1 and evidence_sent_at is null returning *`,
    [disputeId, JSON.stringify(evidence), by]);
  if (done) await problems.record({ kind: 'chargeback', dedupeKey: `chargeback:${disputeId}`, stage: 'evidence_sent', detail: { evidenceSentBy: by } });
  return done ?? null;
}

/** Accept a chargeback: nothing contested. A person's decision, never the job's. */
export async function acceptChargeback(disputeId, { by, accept = stripe.acceptDispute } = {}) {
  const { rows: [cb] } = await query('select * from chargebacks where id = $1', [disputeId]);
  if (!cb || cb.evidence_sent_at || cb.accepted_at || cb.closed_at) return null;
  await accept(disputeId);
  const { rows: [done] } = await query(`update chargebacks set accepted_at = now(), accepted_by = $2, updated_at = now() where id = $1 and accepted_at is null returning *`, [disputeId, by]);
  return done ?? null;
}

/** The job: every chargeback within two days of its deadline that nobody has answered gets Epic's evidence. */
export async function sendDueEvidence({ now = new Date(), status = stripe.stripeStatus, submit = stripe.submitDisputeEvidence } = {}) {
  const out = { sent: 0, failed: 0 };
  if (!status().ready) return { ...out, skipped: 'stripe_not_ready' };
  const { rows } = await query(
    `select * from chargebacks where evidence_sent_at is null and accepted_at is null and closed_at is null and due_by is not null
        and due_by - make_interval(days => $2) <= $1 and status in ('needs_response', 'warning_needs_response')
      order by due_by limit 20`, [now, SEND_DAYS_BEFORE]);
  for (const cb of rows) {
    try {
      const done = await sendEvidence(cb.id, { by: 'epic', submit });
      if (!done) continue;
      out.sent += 1;
      await logAutomation({ automation: 'chargeback_evidence', subjectKind: 'booking', subjectId: cb.booking_id, rule: `Nobody had answered the chargeback two days before Stripe's deadline (${day(cb.due_by)})`, evidence: { dispute: cb.id, dueBy: cb.due_by, amountPence: cb.amount_pence }, did: 'Sent Epic’s evidence to the bank', undo: null });
    } catch (err) {
      out.failed += 1;
      console.error(`epic-api: chargeback ${cb.id} evidence — ${err.code ?? err.message}`);
    }
  }
  return out;
}
