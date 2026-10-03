/**
 * Memberships: joining, the portal, Stripe's events and the reminder (L8, Phase 4, 3 Oct 2026).
 *
 *   · Solo £5.99, Household £8.99, Pro £12.99 a month, from `plan_prices`, on
 *     Epic's own Stripe account. One month free with the card taken up front.
 *   · Nothing becomes a membership because a browser came back from Checkout:
 *     only Stripe's events make or change one, and each is applied by reading
 *     the subscription back from Stripe, so events arriving out of order can't
 *     put an older state back.
 *   · A payment that fails after the trial **pauses** the membership — never
 *     cancels it — while Stripe's Smart Retries try again (owner, 3 Oct 2026).
 *     The pause is dated and its reason kept for the payment problems log.
 *   · Seven days before a trial ends (or an annual renewal), Epic writes to the
 *     household itself: the date, the amount, and one tap to cancel. Stripe's
 *     own three-day `trial_will_end` is the backstop, sent only if the seven-day
 *     one somehow never went.
 */

import * as stripe from './stripe.js';
import * as billing from '../repositories/membershipBilling.js';
import { sendMail } from './mail.js';

const appUrl = () => (process.env.EPIC_APP_URL || process.env.APP_URL || 'https://epic.day').replace(/\/$/, '');
const apiUrl = () => (process.env.EPIC_API_BASE_URL || 'https://api.epic.day').replace(/\/$/, '');
export const MEMBERSHIP_PLANS = ['solo', 'household', 'pro'];
export const TRIAL_DAYS = 30;
export const REMIND_DAYS = 7;

const refuse = (status, code, message) => Object.assign(new Error(message), { status, code });

/** The household's Stripe customer, made the first time it is needed; its email kept in step with the account's. */
export async function ensureCustomer({ householdId, email, name = null }) {
  const had = await billing.customerOf(householdId);
  // A returning customer's email is brought up to date before Checkout, so receipts reach today's address (Codex).
  if (had) { if (email) await stripe.updateCustomerEmail(had, email, { householdId }); return had; }
  const c = await stripe.createCustomer({ householdId, email, name });
  return billing.setCustomer(householdId, c.id);
}

/** A plan's Stripe Price for its current website price, made once and remembered. */
export async function priceFor(planKey) {
  const mode = stripe.stripeMode() ?? 'test';
  const p = await billing.webPrice(planKey, mode);
  if (!p) throw refuse(404, 'no_price', 'That membership isn’t on sale.');
  if (p.stripe_price_id) return { priceId: p.stripe_price_id, amountPence: p.amount_pence, label: p.label };
  const price = await stripe.ensureMembershipPrice({ planKey, name: `Epic ${p.label}`, amountPence: p.amount_pence });
  await billing.rememberPrice({ planPriceId: p.id, mode, productId: typeof price.product === 'string' ? price.product : price.product?.id, priceId: price.id });
  return { priceId: price.id, amountPence: p.amount_pence, label: p.label };
}

/**
 * Join: a hosted Checkout. A household already a member is refused — changing
 * plan is the portal's — and so is one whose membership is paused, which is
 * put right by paying, not by joining again.
 */
export async function startCheckout({ householdId, email, name, planKey }) {
  if (!MEMBERSHIP_PLANS.includes(planKey)) throw refuse(400, 'bad_plan', 'Choose Solo, Household or Pro.');
  const running = await billing.runningMembership(householdId);
  if (running) throw refuse(409, 'already_a_member', running.status === 'paused' ? 'Your membership is paused while a payment is retried. Update your card instead.' : 'You’re a member already. Change plan from Membership and billing.');
  // One Checkout at a time (Codex, 3 Oct 2026): two presses at once would open two, and finishing both would make
  // two subscriptions. The second press within half a minute is refused; a later one closes the earlier session first.
  const slot = await billing.claimCheckout(householdId);
  if (!slot.claimed) throw refuse(409, 'checkout_opening', 'Opening the payment page already — give it a moment.');
  let session = null;
  try {
    if (slot.previous) {
      // Only a session Stripe says is not there is passed over: any other failure stops here, so a payable session is
      // never left open beside a new one (Codex, 3 Oct 2026).
      const prev = await stripe.retrieveCheckout(slot.previous, { householdId })
        .catch((err) => { if (err.httpStatus === 404) return null; throw err; });
      // Finished, and its subscription not written down yet: they have just joined. Written down already (and, since
      // nothing is running, ended since): an old Checkout, and they may join again (Codex, 3 Oct 2026).
      const prevSub = typeof prev?.subscription === 'string' ? prev.subscription : prev?.subscription?.id;
      if (prev?.status === 'complete' && !(prevSub && await billing.membershipBySubscription(prevSub))) throw refuse(409, 'already_a_member', 'You’ve just joined — it can take a moment to show.');
      if (prev?.status === 'open') await stripe.expireCheckout(slot.previous, { householdId });
    }
    const customerId = await ensureCustomer({ householdId, email, name });
    // Every session still open for this customer is closed first — the recorded one, and any whose answer was lost on
    // the way back from Stripe and so was never written down (Codex, 3 Oct 2026). Only one is ever payable.
    for (const open of await stripe.openCheckouts(customerId, { householdId })) {
      if (open?.metadata?.epic_kind === 'membership') await stripe.expireCheckout(open.id, { householdId });
    }
    const { priceId } = await priceFor(planKey);
    // One trial a household: a household that has had a membership before pays from the first day.
    const before = await billing.latestMembership(householdId);
    session = await stripe.membershipCheckout({
      customerId, priceId, householdId, planKey,
      trialDays: before ? 0 : TRIAL_DAYS,
      successUrl: `${appUrl()}/settings?membership=joined`,
      cancelUrl: `${appUrl()}/settings?membership=not-yet`,
    });
    if (!(await billing.recordCheckout(householdId, session.id, slot.lease))) {
      await stripe.expireCheckout(session.id, { householdId }).catch(() => null);
      throw refuse(409, 'checkout_opening', 'Opening the payment page already — give it a moment.');
    }
    return { url: session.url, id: session.id, trialDays: before ? 0 : TRIAL_DAYS };
  } catch (err) {
    await billing.releaseCheckout(householdId, slot.lease);
    throw err;
  }
}

/** Stripe's portal for the household's own customer: the card, the receipts, cancelling, switching plan. */
export async function portalUrl({ householdId, email = null }) {
  const customerId = await billing.customerOf(householdId);
  if (!customerId) throw refuse(404, 'not_a_customer', 'There’s no membership to manage yet.');
  if (email) await stripe.updateCustomerEmail(customerId, email, { householdId }).catch(() => null);
  const s = await stripe.portalSession({ customerId, returnUrl: `${appUrl()}/settings`, householdId });
  return s.url;
}

/** The one-tap cancel in the reminder: Stripe's portal, opened straight on cancelling this membership. */
export async function cancelUrlForToken(token) {
  const m = await billing.membershipByCancelToken(token);
  if (!m || !m.stripe_customer_id || !m.stripe_subscription_id) return null;
  const s = await stripe.portalSession({
    customerId: m.stripe_customer_id, householdId: m.household_id, returnUrl: `${appUrl()}/settings`,
    flow: { type: 'subscription_cancel', subscription_cancel: { subscription: m.stripe_subscription_id } },
  });
  return s.url;
}

/** What Settings is told: the membership in words a screen can draw, or nothing. */
export function membershipPayload(m) {
  if (!m) return null;
  return {
    planKey: m.plan_key,
    status: m.status,
    channel: m.channel,
    monthlyPence: m.monthly_pence,
    interval: m.interval,
    trialEnd: m.trial_end,
    renewsAt: m.cancel_at_period_end ? null : m.current_period_end,
    endsAt: m.cancel_at_period_end ? (m.trial_end && m.status === 'trialling' ? m.trial_end : m.current_period_end) : m.ended_at,
    pausedAt: m.paused_at,
    mode: m.mode,
  };
}

// ---------------------------------------------------------------------------
// Stripe's events
// ---------------------------------------------------------------------------

// Epic's membership subscriptions — a duplicate among them too, whose clean-up the read-back below finishes.
const isMembership = (o) => o?.metadata?.epic_kind === 'membership';
// A second subscription cancelled as a duplicate is not a membership, and never becomes a row.
const isDuplicate = (o) => o?.metadata?.epic_duplicate === 'true';

/** The subscription an invoice is for, across API versions. */
const invoiceSubscription = (inv) => (typeof inv?.subscription === 'string' ? inv.subscription : inv?.subscription?.id)
  ?? inv?.parent?.subscription_details?.subscription ?? null;

/** Read the subscription back and write it down. Returns the stored row, or null when it is not one of ours. */
async function sync(subscriptionId, { pauseReason = null, changedAt = null, snapshotPriceId = null, renewalFailed = false } = {}) {
  // Stamped before the read, so an older read finishing later is dropped rather than written over a newer one.
  const stamp = await billing.readStamp();
  const sub = await stripe.retrieveSubscription(subscriptionId);
  if (!isMembership(sub)) return null;
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  const householdId = sub.metadata?.epic_household_id ?? (customer ? await billing.householdByCustomer(customer) : null);
  if (!householdId) return null;
  // Marked a duplicate on an earlier try: its clean-up is finished here — cancelled, refunded — every time, so a
  // retry after a failure part-way never leaves it running or its money kept (Codex, 3 Oct 2026). Never a row.
  if (isDuplicate(sub)) { await stripe.cancelSecondMembership(sub.id, { householdId, sub }); return null; }
  // The subscription's customer is the household's, however the household came to have it.
  if (customer) await billing.setCustomer(householdId, customer);
  const facts = stripe.membershipFromSubscription(sub);
  // The event's time dates a price change only when the event itself shows the price read back now — otherwise it
  // is the time of something earlier (a late or out-of-order delivery), and the change is dated when it is seen
  // (Codex, 3 Oct 2026).
  if (!(snapshotPriceId && snapshotPriceId === facts.priceId)) changedAt = null;
  try {
    return await billing.upsertFromSubscription({ householdId, subscriptionId: sub.id, facts, mode: sub.livemode ? 'live' : 'test', pauseReason, stamp, changedAt,
      // A renewal that failed leaves the period now running unpaid, so the pause starts with it. Any other failure (a
      // mid-cycle invoice, a plan switch's proration) falls in a period already paid: dated when it is seen (Codex).
      pausedFrom: renewalFailed ? facts.currentPeriodStart : null });
  } catch (err) {
    if (err.code !== 'second_membership') throw err;
    // The backstop for two Checkouts finished at once: the household keeps the membership it had, and the second is
    // cancelled and refunded in full. Nothing is written for it; its own cancellation event is then a cancelled row.
    if (err.running?.stripe_subscription_id === sub.id) return err.running;
    await stripe.cancelSecondMembership(sub.id, { householdId, sub });
    return null;
  }
}

/**
 * One Stripe event about a membership. Answers whether it was one (so the
 * webhook's other handlers are not asked). Safe to run twice.
 */
export async function applyMembershipEvent(event) {
  const obj = event?.data?.object ?? {};
  const type = String(event?.type ?? '');
  // When Stripe says it happened — what a price change is dated by, never when Epic got round to it.
  const at = event?.created ? new Date(event.created * 1000) : null;
  if (type === 'checkout.session.completed' && isMembership(obj)) {
    if (obj.subscription) await sync(typeof obj.subscription === 'string' ? obj.subscription : obj.subscription.id, { changedAt: at });
    return true;
  }
  if (type.startsWith('customer.subscription.') && isMembership(obj)) {
    const row = await sync(obj.id, { changedAt: at, snapshotPriceId: obj?.items?.data?.[0]?.price?.id ?? null });
    // Stripe's three-day warning: the backstop for the seven-day reminder, sent only if that one never went.
    if (type === 'customer.subscription.trial_will_end' && row) await remind(await billing.claimReminderFor(row.id));
    return true;
  }
  if ((type === 'invoice.paid' || type === 'invoice.payment_failed' || type === 'invoice.payment_succeeded') && invoiceSubscription(obj)) {
    const failed = type === 'invoice.payment_failed';
    const row = await sync(invoiceSubscription(obj), { pauseReason: failed ? `payment_failed:${obj.billing_reason ?? 'invoice'}:${obj.id}` : null, changedAt: at, renewalFailed: failed && obj.billing_reason === 'subscription_cycle' });
    return Boolean(row);
  }
  return false;
}

// ---------------------------------------------------------------------------
// the reminder
// ---------------------------------------------------------------------------

const money = (p) => `£${(Number(p) / 100).toFixed(2)}`;
const day = (d) => new Date(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' });
const PLAN_WORDS = { solo: 'Solo', household: 'Household', pro: 'Pro' };

/** The reminder, in Epic's voice: the date, the amount, and one tap to cancel. */
export function reminderMail(m, cancelLink) {
  const plan = PLAN_WORDS[m.plan_key] ?? 'Epic';
  const trial = m.status === 'trialling';
  // Stripe's own amount for the interval, never the monthly figure multiplied back (Codex, 3 Oct 2026).
  const each = Number(m.amount_pence) || Number(m.monthly_pence) * (m.interval === 'year' ? 12 : 1);
  const amount = m.interval === 'year' ? `${money(each)} for the year` : `${money(each)} a month`;
  const subject = trial ? `Your free month of Epic ${plan} ends on ${day(m.on_date)}` : `Your Epic ${plan} membership renews on ${day(m.on_date)}`;
  const text = [
    trial
      ? `Your free month of Epic ${plan} ends on ${day(m.on_date)}. From then it’s ${amount}, on the card you gave us.`
      : `Your Epic ${plan} membership renews on ${day(m.on_date)}: ${amount}, on the card you gave us.`,
    '',
    'Staying? There’s nothing to do.',
    '',
    `Not for you? Cancel in one tap, and you won’t be charged:\n${cancelLink}`,
    '',
    'Epic — seize the day',
  ].join('\n');
  return { subject, text };
}

async function remind(m) {
  if (!m) return { sent: false };
  const lead = await billing.leadOf(m.household_id);
  if (!lead?.email) { await billing.unclaimReminder(m.id, m.on_date); return { sent: false, reason: 'no_email' }; }
  const link = `${apiUrl()}/api/membership/cancel/${m.cancel_token}`;
  const { subject, text } = reminderMail(m, link);
  const r = await sendMail({ to: lead.email, subject, text, purpose: 'membership_reminder' }).catch((err) => ({ sent: false, reason: err.message }));
  // Not sent: given back, so the next run tries again (and Stripe's three-day warning after that).
  if (!r?.sent) await billing.unclaimReminder(m.id, m.on_date);
  return r;
}

/** The daily round: every reminder due within seven days, once a date. */
export async function sendRemindersDue() {
  const due = await billing.claimRemindersDue({ days: REMIND_DAYS });
  let sent = 0;
  for (const m of due) if ((await remind(m))?.sent) sent += 1;
  return { due: due.length, sent };
}
