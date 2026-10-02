/**
 * The money engine's jobs (hosting v4 handover §5): payouts and the daily
 * reconciliation with Stripe. Stripe test mode only — `stripeStatus()` refuses
 * a live key, and every job here stops at the first sign Stripe is not ready
 * rather than marking anything paid.
 *
 *   payouts      Each ended session gets one payout row; it is released
 *                `payout_release` hours later when nobody has complained, or
 *                sooner on a guest's "yes, it happened" or a review (setting,
 *                on). A complaint, missing tax details or an unfinished Stripe
 *                account hold it, and the host is told once per reason.
 *   reconcile    Stripe is the source of truth: every recent ledger row with a
 *                Stripe reference is read back and compared. A mismatch is
 *                recorded, marked on the row and logged for the back office.
 *                A row it could not read is "not checked", never a match.
 */

import * as ledger from '../repositories/hostingLedger.js';
import * as settings from '../repositories/hostingSettings.js';
import * as notifications from '../repositories/notifications.js';
import * as stripe from './stripe.js';
import { payoutDecision } from '../domain/money.js';
import { decideDue, warnUnderMinimum, processRefunds } from './bookingMoney.js';

const HELD_WORDS = {
  complaint: 'A guest raised a problem with this session. The payout waits until it is sorted.',
  tax_details: 'Add your NI number or UTR to be paid.',
  stripe_incomplete: 'Finish setting up payouts with Stripe to be paid.',
  not_set: 'Payouts are waiting on a setting Epic has not set yet.',
  no_end: 'This session has no end time, so its payout waits for a person to check it.',
};

/** Make payout rows for sessions that have ended. Returns how many were made. */
export async function schedulePayouts({ now = new Date() } = {}) {
  const s = await settings.current();
  const ended = await ledger.sessionsEndedWithoutPayout({ now });
  let made = 0;
  for (const row of ended) {
    const p = await ledger.schedulePayout({ sessionId: row.session_id, offerId: row.offer_id, hostId: row.host_id, endsAt: row.ends_at, releaseHours: typeof s.payout_release === 'number' ? s.payout_release : null });
    if (p) made += 1;
  }
  return made;
}

/**
 * Release what is due. Each payout is decided by `payoutDecision`, claimed
 * before the transfer, and the transfer carries the payout's id as its
 * idempotency key so a retry after a crash is the same transfer.
 */
export async function releasePayouts({ now = new Date(), transfer = stripe.transfer, status = stripe.stripeStatus } = {}) {
  const out = { released: 0, held: 0, failed: 0, waiting: 0 };
  if (!status().ready) return { ...out, skipped: 'stripe_not_ready' };
  const s = await settings.current();
  for (const p of await ledger.payoutsDue({ now })) {
    const d = payoutDecision({
      endsAt: p.session_ends_at ?? p.release_at, now,
      complaintOpen: p.complaint_open, guestConfirmed: p.guest_confirmed, reviewed: p.reviewed,
      taxMissing: !p.tax_reference, stripeReady: p.payouts_state === 'ready' && Boolean(p.stripe_account_id),
    }, s);
    if (d.state === 'wait') { out.waiting += 1; continue; }
    if (d.state === 'held') {
      const changed = await ledger.holdPayout(p.id, d.reason);
      out.held += 1;
      if (changed) {
        await notifications.notify({
          householdId: p.household_id, kind: 'payout_held', title: 'A payout is on hold',
          body: HELD_WORDS[d.reason] ?? null, link: '/host/offers', dedupeKey: `payout_held:${p.id}:${d.reason}`,
        }).catch(() => null);
      }
      continue;
    }
    const claimed = await ledger.claimPayout(p.id, { by: d.by });
    if (!claimed) continue; // another run has it
    const amount = claimed.amount_pence + claimed.tips_pence;
    try {
      const t = await transfer({ amountPence: amount, destination: p.stripe_account_id, payoutId: p.id, hostId: p.host_id, householdId: p.household_id, idempotencyKey: `payout-${p.id}` });
      await ledger.finishPayout(p.id, { state: 'paid', stripeTransfer: t.id, mode: 'test' });
      await ledger.record({ kind: 'payout', hostId: p.host_id, offerId: p.offer_id, sessionId: p.session_id, householdId: p.household_id, payoutId: p.id, amountPence: amount, hostPence: amount, state: 'succeeded', stripeRef: t.id, mode: 'test', reason: d.by });
      await notifications.notify({
        householdId: p.household_id, kind: 'payout_sent', title: `£${(amount / 100).toFixed(2)} is on its way`,
        link: '/host/offers', dedupeKey: `payout_sent:${p.id}`,
      }).catch(() => null);
      out.released += 1;
    } catch (err) {
      // Not paid: the row says so and a person looks. The same idempotency key
      // makes a later retry the same transfer, never a second one.
      await ledger.finishPayout(p.id, { state: 'failed' });
      console.error(`epic-api: payout ${p.id} failed — ${err.code ?? err.message}`);
      out.failed += 1;
    }
  }
  return out;
}

/** Compare one ledger row with Stripe's view of it: 'matched', 'mismatch' or 'not_checked'. */
export function compareRow(row, view) {
  if (!view) return 'not_checked';
  const moved = row.state === 'succeeded';
  if (view.held) return row.kind === 'hold' && row.state === 'pending' ? 'matched' : 'mismatch';
  if (moved !== view.ok) return 'mismatch';
  if (moved && Number(view.amountPence) !== Number(row.amount_pence)) return 'mismatch';
  return 'matched';
}

/** The daily reconciliation. Returns the saved summary. */
export async function reconcile({ days = 3, read = stripe.retrieveRef, status = stripe.stripeStatus } = {}) {
  if (!status().ready) return { skipped: 'stripe_not_ready' };
  const rows = await ledger.rowsToReconcile({ days });
  const details = [];
  let checked = 0;
  let mismatched = 0;
  for (const row of rows) {
    let view = null;
    try {
      const obj = await read(row.stripe_ref, { householdId: row.household_id });
      view = obj ? stripe.stripeView(obj) : null;
    } catch { view = null; }
    const match = compareRow(row, view);
    if (match !== 'not_checked') checked += 1;
    if (match === 'mismatch') {
      mismatched += 1;
      details.push({ id: row.id, kind: row.kind, ref: row.stripe_ref, ledger: { state: row.state, pence: row.amount_pence }, stripe: view });
    }
    if (match !== row.stripe_match) await ledger.markMatch(row.id, match);
  }
  const saved = await ledger.saveReconciliation({ mode: 'test', checked, mismatched, details });
  if (mismatched) console.error(`epic-api: Stripe reconciliation — ${mismatched} of ${checked} ledger rows do not match Stripe`);
  return saved;
}

/**
 * One tick of the hosting money loop: decides-by, refunds owed, payouts every
 * time; the reconciliation once a day; then queued e-mail.
 */
export async function moneyTick({ now = new Date() } = {}) {
  const guest = await import('../routes/guestBookings.js');
  await guest.lapseRequests({ now });
  await guest.dropUnpaid({ now });
  await warnUnderMinimum({ now });
  await decideDue({ now });
  await processRefunds();
  await schedulePayouts({ now });
  const released = await releasePayouts({ now });
  const last = await ledger.lastReconciliation().catch(() => null);
  let reconciled = null;
  if (!last || now.getTime() - new Date(last.ran_at).getTime() > 24 * 3_600_000) reconciled = await reconcile();
  await guest.offerFreedPlaces({ now });
  await guest.guestPrompts({ now });
  const mailed = await notifications.drainEmail();
  return { released, reconciled, mailed };
}
