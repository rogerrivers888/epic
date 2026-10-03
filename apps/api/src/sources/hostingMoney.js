/**
 * The money engine's jobs (hosting v4 handover §5): payouts and the daily
 * reconciliation with Stripe. Stripe test mode only — `stripeStatus()` refuses
 * a live key, and every job here stops at the first sign Stripe is not ready
 * rather than marking anything paid.
 *
 *   payouts      Each ended session gets one payout row; it is released
 *                `payout_release` hours later when nobody has complained, or
 *                sooner on a guest's "yes, it happened" or a review (setting,
 *                on). A complaint, an open chargeback, missing tax details or
 *                an unfinished Stripe account hold it, and the host is told
 *                once per reason. The money is already in the host's own
 *                Stripe balance (L1); releasing it is a Payout made on their
 *                account, never a transfer from Epic's (L3).
 *   reconcile    Stripe is the source of truth: every recent ledger row with a
 *                Stripe reference is read back and compared. A mismatch is
 *                recorded, marked on the row and logged for the back office.
 *                A row it could not read is "not checked", never a match.
 */

import { query } from '../db.js';
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
  dispute: 'A guest’s bank is looking at a payment for this session. The payout waits until it decides.',
  not_manual: 'Epic is checking your Stripe payout settings. The payout waits until that is done.',
  dispute_lost: 'A guest’s bank took back a payment for this session. Epic will be in touch about this payout.',
  no_end: 'This session has no end time, so its payout waits for a person to check it.',
};

/**
 * The idempotency key for a payout's Payout. The same while an attempt is in
 * doubt (a crash, a lost reply: Stripe answers with the Payout it already
 * made); a new one after a definite failure, so a retry is a new Payout and
 * never Stripe replaying the one that failed (Codex, 3 Oct 2026).
 */
export const payoutKey = (p) => (Number(p.attempt ?? 0) > 0 ? `payout-${p.id}-a${p.attempt}` : `payout-${p.id}`);

/** Make payout rows for sessions that have ended. Returns how many were made. */
export async function schedulePayouts({ now = new Date() } = {}) {
  const s = await settings.current();
  await ledger.scheduleTipPayouts({ now, releaseHours: typeof s.payout_release === 'number' ? s.payout_release : 72 });
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
 * before the Payout, and the Payout carries the payout's id as its
 * idempotency key so a retry after a crash is the same Payout.
 */
export async function releasePayouts({ now = new Date(), payout = stripe.payout, balance = stripe.hostBalance, status = stripe.stripeStatus } = {}) {
  const out = { released: 0, held: 0, failed: 0, waiting: 0 };
  if (!status().ready) return { ...out, skipped: 'stripe_not_ready' };
  const s = await settings.current();
  for (const p of await ledger.payoutsDue({ now })) {
    // A retry asks again too: a complaint, missing tax details or a broken Stripe account since the first try still hold it (Codex, 2 Oct 2026).
    const decided = payoutDecision({
      endsAt: p.session_ends_at ?? p.release_at, now,
      complaintOpen: p.complaint_open, guestConfirmed: p.guest_confirmed, reviewed: p.reviewed,
      taxMissing: !p.tax_reference,
      // Only an account made the L1 way holds the money this payout is for.
      stripeReady: p.payouts_state === 'ready' && Boolean(p.stripe_account_id) && p.stripe_account_model === 'v2',
    }, s);
    // The owner released it by hand (hostingAdmin, Release): that overrides the clock and a complaint's hold, never a
    // missing Stripe account or tax details — no payout can be made without those.
    // A lost chargeback holds it for the owner too: only his Release, after looking at it, pays it (Codex, 3 Oct 2026).
    if (p.dispute_lost && p.released_by !== 'owner' && decided.state !== 'held') { decided.state = 'held'; decided.reason = 'dispute_lost'; }
    const ownerSaid = p.released_by === 'owner' && (decided.state === 'wait' || (decided.state === 'held' && ['complaint', 'not_set', 'no_end'].includes(decided.reason)));
    let d = ownerSaid ? { state: 'release', by: 'owner' }
      : p.state === 'released' && decided.state !== 'held' ? { state: 'release', by: p.released_by ?? 'time' } : decided;
    // Last, whatever said release: a chargeback is the guest's bank's to decide (L3), so an open one holds the
    // payout and no owner's Release overrides it; and manual payouts are what keeps Epic holding the timing, so an
    // account found otherwise is held for a person rather than paid.
    if (d.state === 'release' && p.dispute_open) d = { state: 'held', reason: 'dispute' };
    else if (d.state === 'release' && !p.stripe_payouts_manual) d = { state: 'held', reason: 'not_manual' };
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
    // A payout claimed by a run that died before it finished is picked up again: the Payout carries the
    // payout's own idempotency key, so Stripe answers with the same Payout, never a second one (Codex, 2 Oct 2026).
    const claimed = p.state === 'released' ? p : await ledger.claimPayout(p.id, { by: d.by });
    if (!claimed) continue; // another run has it
    const amount = claimed.amount_pence + claimed.tips_pence;
    // Asking Stripe, and writing down what it said, are kept apart: only a definite refusal from Stripe marks the
    // payout failed and moves it to a new key. Anything that goes wrong once Stripe has said yes leaves it released
    // under the same key, so the next run is answered with the Payout Stripe already made — never a second one
    // (Codex, 3 Oct 2026).
    let po;
    try {
      // Is the money there to pay out yet? Asked first, so Stripe is not asked for a Payout it would refuse — a
      // refusal it would then remember under this payout's key (Codex, 3 Oct 2026). Can't tell: ask anyway.
      const held = await balance(p.stripe_account_id, { householdId: p.household_id }).catch(() => null);
      if (held && held.availablePence < amount) { out.waiting += 1; continue; }
      po = await payout({ accountId: p.stripe_account_id, amountPence: amount, payoutId: p.id, hostId: p.host_id, householdId: p.household_id, idempotencyKey: payoutKey(claimed) });
    } catch (err) {
      // Stripe unreachable — or a reply lost after Stripe accepted it: the payout stays released, and the next
      // run tries again with the same key, so it is the same Payout (Codex, 2 Oct 2026).
      if (err.code === 'stripe_unreachable') { out.waiting += 1; continue; }
      // The money is in the host's balance but has not cleared yet: Stripe refused, and remembers it; a new key next run.
      if (err.code === 'funds_pending') { await ledger.nextAttempt(p.id); out.waiting += 1; continue; }
      // A definite refusal: failed, for a person to look at, and a retry is a new Payout.
      if (err.code === 'stripe_refused' || err.code === 'host_not_ready') {
        await ledger.finishPayout(p.id, { state: 'failed' });
        console.error(`epic-api: payout ${p.id} failed — ${err.detail ?? err.code}`);
        out.failed += 1;
        continue;
      }
      // Anything else: nobody can say whether Stripe acted, so nothing is decided — released, same key, next run.
      console.error(`epic-api: payout ${p.id} — not sure it reached Stripe (${err.code ?? err.message}); trying again with the same key`);
      out.waiting += 1;
      continue;
    }
    try {
      // Stripe's payout.failed can land before this write: then the row is failed already, and it is neither
      // recorded as paid nor announced (Codex, 3 Oct 2026).
      const done = await ledger.payoutPaid(p.id, {
        stripePayout: po.id, mode: 'test',
        ledgerLine: { kind: 'payout', hostId: p.host_id, offerId: p.offer_id, sessionId: p.session_id, householdId: p.household_id, payoutId: p.id, amountPence: amount, hostPence: amount, reason: d.by },
      });
      if (!done) { out.failed += 1; continue; }
      // Told only while it still stands: a bounce reported in the meantime is not announced as on its way.
      const { rows: [still] } = await query('select state from host_payouts where id = $1', [p.id]);
      if (still?.state !== 'paid') { out.failed += 1; continue; }
      await notifications.notify({
        householdId: p.household_id, kind: 'payout_sent', title: `£${(amount / 100).toFixed(2)} is on its way`,
        link: '/host/offers', dedupeKey: `payout_sent:${p.id}`,
      }).catch(() => null);
      out.released += 1;
    } catch (err) {
      // Stripe made the Payout but Epic couldn't write it down: still released, so the next run asks again with the
      // same key and Stripe answers with this same Payout.
      console.error(`epic-api: payout ${p.id} made at Stripe (${po.id}) but not recorded — ${err.code ?? err.message}; it will be read back next run`);
      out.waiting += 1;
    }
  }
  return out;
}

/** Compare one ledger row with Stripe's view of it: 'matched', 'mismatch' or 'not_checked'. */
export function compareRow(row, view) {
  if (!view) return 'not_checked';
  // A released hold is a cancelled PaymentIntent: that is the match (Codex, 2 Oct 2026).
  if (row.kind === 'release') return row.state === 'succeeded' ? (!view.ok && !view.held ? 'matched' : 'mismatch') : 'matched';
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
      const obj = await read(row.stripe_ref, { householdId: row.household_id, accountId: row.stripe_account_id ?? null });
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
 * Host accounts whose stored facts predate the account-trouble watch (L15) — no record of whether sign-up was
 * finished or of each capability — are read back from Stripe, a few a tick, so a host already in trouble shows in
 * the back office without waiting for Stripe's next word (Codex, 3 Oct 2026). Stops at the first sign Stripe is down.
 */
export async function refreshAccountFacts({ limit = 20, status = stripe.stripeStatus, read = stripe.retrieveAccount } = {}) {
  if (!status().ready) return { skipped: 'stripe_not_ready' };
  const { rows } = await query(
    `select id, household_id, stripe_account_id from hosts
      where stripe_account_model = 'v2' and stripe_account_id is not null
        and (stripe_requirements is null or not (stripe_requirements ? 'detailsSubmitted'))
      order by updated_at limit $1`, [limit],
  );
  const { applyAccountFacts } = await import('../routes/hostLanes.js');
  let refreshed = 0;
  for (const h of rows) {
    try {
      const a = await read(h.stripe_account_id, { householdId: h.household_id });
      await applyAccountFacts(h.id, stripe.hostPatchFromAccount(a));
      refreshed += 1;
    } catch (err) {
      if (err.code === 'stripe_unreachable') break;
      // Only Stripe's account-specific refusal — no access to that account, or it does not exist — means it was deleted
      // or disconnected. Anything else (a key without permission, a platform-wide refusal) says nothing about the
      // account: the run stops with every row untouched, and says so (Codex, 3 Oct 2026).
      if (err.code === 'stripe_refused' && err.detail !== 'account_invalid') {
        console.error(`epic-api: account facts refresh stopped — Stripe refused (${err.detail ?? err.httpStatus ?? 'no code'}), not about one account`);
        break;
      }
      if (err.code === 'stripe_refused') {
        // Stripe won't let Epic read it: deleted, or disconnected from Epic. That is trouble for a person (Safety), and
        // the row is now whole, so it is not asked again and never holds up the accounts behind it (Codex, 3 Oct 2026).
        await applyAccountFacts(h.id, {
          stripeRequirements: { currentlyDue: [], eventuallyDue: [], pastDue: [], disabledReason: 'account_closed', detailsSubmitted: false, capabilities: { card_payments: null, transfers: null } },
          stripeChargesEnabled: false, stripePayoutsEnabled: false, payoutsState: 'pending',
        });
        refreshed += 1;
        continue;
      }
      console.error(`epic-api: account facts for host ${h.id} not refreshed — ${err.code ?? err.message}`);
    }
  }
  return { refreshed };
}

/**
 * One tick of the hosting money loop: decides-by, refunds owed, payouts every
 * time; the reconciliation once a day; then queued e-mail.
 */
export async function moneyTick({ now = new Date() } = {}) {
  const guest = await import('../routes/guestBookings.js');
  await guest.lapseRequests({ now });
  await guest.dropUnpaid({ now });
  await (await import('../routes/hostingAdmin.js')).releaseApproved();
  await warnUnderMinimum({ now });
  await decideDue({ now });
  await processRefunds();
  await refreshAccountFacts().catch((err) => console.error(`epic-api: account facts refresh — ${err.message}`));
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
