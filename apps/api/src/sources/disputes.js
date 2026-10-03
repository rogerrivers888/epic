/**
 * Chargebacks (register L3; Stripe build, Phases 7–8).
 *
 * A chargeback is the guest's bank's decision, never Epic's: while one is open
 * the booking's payout waits (hostingLedger.markDispute). Every stage Stripe
 * reports — opened, needs a response, under review, won, lost — is one row in
 * the payment problems log, closed when the bank decides.
 */

import { query } from '../db.js';
import * as problems from '../repositories/paymentProblems.js';

/** One sighting of a dispute: the problem row brought up to its stage, closed when the bank has decided. */
export async function applyDispute(d, { closed = false, eventType = null } = {}) {
  if (!d?.id) return null;
  const pi = typeof d.payment_intent === 'string' ? d.payment_intent : d.payment_intent?.id ?? null;
  const { rows: [b] } = pi ? await query('select id, household_id, host_id, offer_id from experience_bookings where stripe_payment_intent = $1', [pi]) : { rows: [] };
  const dueBy = d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000).toISOString() : null;
  const row = await problems.record({
    kind: 'chargeback', dedupeKey: `chargeback:${d.id}`, amountPence: d.amount ?? null, bookingId: b?.id ?? null, householdId: b?.household_id ?? null,
    hostId: b?.host_id ?? null, offerId: b?.offer_id ?? null, stripeRef: d.id, stage: d.status ?? null,
    detail: { reason: d.reason ?? null, dueBy, paymentIntent: pi, lastEvent: eventType },
  });
  if (closed && ['won', 'lost', 'warning_closed'].includes(d.status)) {
    await problems.resolve({ dedupeKey: `chargeback:${d.id}`, resolution: d.status === 'won' ? 'The bank decided for Epic' : d.status === 'lost' ? 'The bank decided for the guest' : 'Closed without a chargeback', by: 'stripe', stage: d.status });
  }
  return row;
}
