/**
 * Stripe, for hosting (Epic hosting v7, RULINGS › Payments; register L, 3 Oct 2026).
 *
 *   · **Epic never holds booking money (L1).** A guest's payment is a
 *     destination charge: `transfer_data.destination` and `on_behalf_of` are the
 *     host's own connected account, and Epic's fee is the application fee
 *     (L2). Separate charges and transfers — the guest's money on Epic's
 *     balance, passed on later — is the escrow pattern the FCA says needs
 *     authorisation, so this file has no way to make a transfer at all.
 *   · Epic holds the timing, not the money (L3): every host account is on
 *     manual payouts, set here at creation, and a released payout is a Payout
 *     made on the host's own account for the released amount only.
 *   · Host accounts are Accounts v2 (`/v2/core/accounts`): Stripe refuses v1
 *     creation for this platform. Express dashboard, Epic collects fees and
 *     carries losses, Stripe collects the details through its hosted form
 *     (L6). Payout settings are v1-only, so the schedule is set through v1.
 *   · Verified is Stripe Identity: passport plus a selfie (L7). For a host
 *     with an account it is tied to the account's Person (`related_person`),
 *     which Stripe only allows before the first onboarding link is made.
 *     Epic sees the result, never the document.
 *   · The private host's £10 and joining Pro are a hosted Checkout.
 *
 * **Test mode only.** Going live, or anything that spends money — an Identity
 * check costs per verification in live mode — is an Approval for the owner
 * (RULINGS: "Don't do it yourself"). So a live key is refused here outright:
 * reaching live mode takes a code change, made after that approval, and not a
 * key pasted into Doppler. The key itself is the owner's (CLAUDE.md: anything
 * that holds a secret); until it is there every caller is told plainly.
 *
 * Every call is written to `provider_calls` (provider `stripe`), attributed to
 * the household and session it was made for, at nought in test mode.
 */

import crypto from 'node:crypto';
import * as providerCalls from '../repositories/providerCalls.js';

const ROOT = () => (process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/$/, '');
const PROVIDER = 'stripe';
/** Accounts v2 is versioned on its own; payments stay on the v1 version this file was written against. */
const V2_VERSION = () => process.env.STRIPE_API_VERSION_V2 || '2026-09-30.endive';

export class StripeNotReady extends Error {
  constructor(code, message) { super(message); this.status = 503; this.code = code; }
}

/** Which Stripe this server could talk to: 'test', 'live' or null. */
export function stripeMode(key = process.env.STRIPE_SECRET_KEY) {
  const k = String(key ?? '').trim();
  if (!k) return null;
  if (/^(sk|rk)_test_/.test(k)) return 'test';
  if (/^(sk|rk)_live_/.test(k)) return 'live';
  return null;
}

/** Ready means a test key: a live one is refused until the owner has approved going live. */
export function stripeStatus() {
  const mode = stripeMode();
  if (mode === 'test') return { ready: true, mode: 'test', note: null };
  if (mode === 'live') return { ready: false, mode: 'live', note: 'Stripe is in test mode until the owner approves going live.' };
  return { ready: false, mode: null, note: 'Stripe is not connected yet.' };
}

function assertReady() {
  const s = stripeStatus();
  if (!s.ready) throw new StripeNotReady(s.mode === 'live' ? 'stripe_live_refused' : 'stripe_not_configured', s.note);
}

/** Stripe's form encoding: nested keys in brackets, arrays indexed. */
export function formEncode(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object' ? out.push(formEncode(x, `${key}[${i}]`)) : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(x)}`)));
    else if (typeof v === 'object') out.push(formEncode(v, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out.filter(Boolean).join('&');
}

/**
 * One call. `purpose` is a stable string (add, never rename). A failure keeps
 * Stripe's own short code for the back office and says something plain to the
 * caller; a raw body never reaches a phone.
 */
async function call(method, path, params, { householdId = null, purpose, idempotencyKey = null, account = null, v2 = false } = {}) {
  assertReady();
  const started = Date.now();
  const headers = { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY.trim()}`, 'stripe-version': v2 ? V2_VERSION() : (process.env.STRIPE_API_VERSION || '2024-06-20') };
  // A v2 path carries its own version prefix; a v1 path is under /v1.
  let url = `${ROOT()}${v2 ? path : `/v1${path}`}`;
  let body;
  if (v2) { if (method !== 'GET') { headers['content-type'] = 'application/json'; body = JSON.stringify(params ?? {}); } }
  else if (method === 'GET') { const q = formEncode(params); if (q) url += `?${q}`; }
  else { headers['content-type'] = 'application/x-www-form-urlencoded'; body = formEncode(params); }
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  // Acting on the host's own account (a payout from their balance): Stripe's Connect header.
  if (account) headers['stripe-account'] = account;
  let res; let j;
  try {
    res = await fetch(url, { method, headers, body });
    j = await res.json().catch(() => ({}));
  } catch (err) {
    await providerCalls.recordFailure({ householdId, provider: PROVIDER, purpose, ms: Date.now() - started, fault: 'network' });
    throw Object.assign(new Error('Epic couldn’t reach Stripe just now. Try again in a moment.'), { status: 503, code: 'stripe_unreachable' });
  }
  if (!res.ok) {
    await providerCalls.recordFailure({ householdId, provider: PROVIDER, purpose, ms: Date.now() - started, fault: `http_${res.status}_${j?.error?.code ?? ''}`.slice(0, 40) });
    // Too many requests, or Stripe's own trouble: worth trying again with the same key, not a refusal (Codex, 2 Oct 2026).
    if (res.status === 429 || res.status >= 500) throw Object.assign(new Error('Epic couldn’t reach Stripe just now. Try again in a moment.'), { status: 503, code: 'stripe_unreachable', detail: j?.error?.code ?? null });
    throw Object.assign(new Error('Stripe said no to that. Try again, or come back to it later.'), { status: 502, code: 'stripe_refused', detail: j?.error?.code ?? null, httpStatus: res.status });
  }
  await providerCalls.recordMetered({ householdId, provider: PROVIDER, purpose, units: { 'stripe-requests': 1 }, costUsd: 0, ok: true, ms: Date.now() - started });
  return j;
}

// ---------------------------------------------------------------------------
// payouts: Connect, hosted onboarding
// ---------------------------------------------------------------------------

/**
 * What Epic already knows about the host, in the shape Accounts v2 takes it.
 * Only what was given to Epic (email, date of birth, the legal name split at
 * its last space) — anything missing is left for Stripe's own form. Pre-filling
 * is only possible before the first onboarding link (Stripe, sandbox 3 Oct 2026).
 */
export function prefillIndividual({ email = null, legalName = null, dateOfBirth = null } = {}) {
  const ind = {};
  if (email) ind.email = email;
  const parts = String(legalName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) { ind.given_name = parts.slice(0, -1).join(' '); ind.surname = parts[parts.length - 1]; }
  const d = dateOfBirth ? new Date(dateOfBirth) : null;
  if (d && !Number.isNaN(d.getTime())) ind.date_of_birth = { day: d.getUTCDate(), month: d.getUTCMonth() + 1, year: d.getUTCFullYear() };
  return ind;
}

/**
 * The body that makes a host's account (L2, L6, L11): exported so a test can hold it to the rules.
 *
 * Dormant (owner, 3 Oct 2026): every host gets an account silently at the passport step, so the check can be tied
 * to its Person and count as Stripe's own — free hosts too. It asks for nothing: a merchant configuration with no
 * capabilities (Stripe needs one to hold a Person at all; sandbox 3 Oct 2026), nothing due from the host, never paid
 * out, so never a Connect "active account". Card payments are asked for only when the host first takes money
 * (`wakeAccount`).
 */
export function connectAccountBody({ hostId, email = null, legalName = null, dateOfBirth = null, displayName = null, dormant = false }) {
  return {
    contact_email: email ?? undefined,
    display_name: displayName ?? undefined,
    dashboard: 'express',
    // Express needs Epic to collect fees and carry losses; Stripe still collects the host's details (L6).
    defaults: { responsibilities: { fees_collector: 'application', losses_collector: 'application' } },
    identity: { country: 'gb', entity_type: 'individual', individual: prefillIndividual({ email, legalName, dateOfBirth }) },
    // Merchant, not recipient: the host is merchant of record on a destination charge with on_behalf_of (L2).
    // Guests' statements read "EPIC* <host>" (L11).
    // A destination charge needs the transfers capability too, which Accounts v2 keeps on the recipient configuration:
    // without it Stripe refuses the booking (insufficient_capabilities_for_transfer, sandbox 3 Oct 2026).
    configuration: {
      merchant: { ...(dormant ? {} : { capabilities: { card_payments: { requested: true } } }), statement_descriptor: { prefix: 'EPIC' } },
      ...(dormant ? {} : { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } }),
    },
    metadata: { epic_host_id: hostId },
  };
}

/**
 * A dormant account woken when its host first takes money through Epic: card payments asked for, and what Epic
 * already knows filled in (the kind of business, the host's page) — only possible before Stripe's form is first
 * opened. The passport check tied to it earlier stands: Stripe does not ask for ID again (sandbox, 3 Oct 2026).
 */
export function wakeAccount(accountId, { householdId = null, businessUrl = null } = {}) {
  return call('POST', `/v2/core/accounts/${encodeURIComponent(accountId)}`, {
    configuration: {
      merchant: { capabilities: { card_payments: { requested: true } }, mcc: '7999' },
      recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
    },
    ...(businessUrl ? { defaults: { profile: { business_url: businessUrl } } } : {}),
  }, { householdId, purpose: 'host.payouts.wake', idempotencyKey: `wake-${accountId}`, v2: true });
}

/**
 * Ask for the transfers capability (Accounts v2's recipient configuration), which a destination charge needs. On its
 * own and safe to repeat: an account made before it was known to be needed (Phase 1, live from 488be135) is
 * upgraded the next time its host goes to payouts or comes back from Stripe; Stripe accepts it after onboarding too
 * and asks the host for nothing new (sandbox, 3 Oct 2026). Never for a dormant account.
 */
export function ensureTransfers(accountId, { householdId = null } = {}) {
  return call('POST', `/v2/core/accounts/${encodeURIComponent(accountId)}`, {
    configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
  }, { householdId, purpose: 'host.payouts.transfers', idempotencyKey: `transfers-${accountId}`, v2: true });
}

/** Has the account been asked for card payments yet? A dormant one has no capabilities at all. */
export const accountAwake = (a) => Boolean(a?.capabilities && 'card_payments' in a.capabilities);

/**
 * A host's connected account, created in the background (L6): Accounts v2,
 * then manual payouts set explicitly through v1 (L3) — the dashboard switch
 * that stops hosts changing it is Stripe-side, and this does not rely on it.
 * Returns `{ id, personId }`: the Person is what Identity is tied to (L7).
 */
export async function createConnectAccount({ email, householdId, hostId, legalName = null, dateOfBirth = null, displayName = null, dormant = false }) {
  const a = await call('POST', '/v2/core/accounts', connectAccountBody({ hostId, email, legalName, dateOfBirth, displayName, dormant }),
    { householdId, purpose: 'host.payouts.account', idempotencyKey: `acct-v2-${hostId}`, v2: true });
  await setManualPayouts(a.id, { householdId });
  const v1 = await retrieveAccount(a.id, { householdId });
  return { id: a.id, personId: v1?.individual?.id ?? null, account: v1 };
}

/** Manual payouts (L3): money waits in the host's own balance until Epic releases it. */
export function setManualPayouts(accountId, { householdId = null } = {}) {
  return call('POST', `/accounts/${encodeURIComponent(accountId)}`, { settings: { payouts: { schedule: { interval: 'manual' } } } },
    { householdId, purpose: 'host.payouts.schedule', idempotencyKey: `manual-payouts-${accountId}` });
}

/** Stripe's hosted form. Only what is due now (L6); the bank details Stripe asks for when it needs them. */
export function accountLink({ accountId, refreshUrl, returnUrl, householdId }) {
  return call('POST', '/account_links', {
    account: accountId, refresh_url: refreshUrl, return_url: returnUrl, type: 'account_onboarding',
    collection_options: { fields: 'currently_due' },
  }, { householdId, purpose: 'host.payouts.link' });
}

export function retrieveAccount(accountId, { householdId } = {}) {
  return call('GET', `/accounts/${encodeURIComponent(accountId)}`, null, { householdId, purpose: 'host.payouts.read' });
}

/**
 * Ready to be booked and paid: Stripe has what it needs, a guest's card can be
 * charged to the account, and payouts are switched on. A destination charge
 * needs card payments on the host's account, so payouts alone are not enough.
 */
export const accountReady = (a) => Boolean(a?.details_submitted && a?.charges_enabled && a?.payouts_enabled);

/** Manual payouts held: what the payout job checks before it trusts an account (L3). */
export const payoutsManual = (a) => a?.settings?.payouts?.schedule?.interval === 'manual';

/** A host row's patch from Stripe's view of their account: the payouts state the checklist reads, and the facts below. */
export function hostPatchFromAccount(a) {
  const f = accountFacts(a);
  return {
    payoutsState: accountReady(a) ? 'ready' : 'pending',
    stripeChargesEnabled: f.chargesEnabled, stripePayoutsEnabled: f.payoutsEnabled,
    stripePayoutsManual: f.payoutsManual, stripeRequirements: f.requirements,
  };
}

/** What in Stripe's requirements is an ID request: a document, proof of liveness, or a risk review's identity check. */
const ID_ASK = /((^|\.)verification\.(additional_)?document$|proof_of_liveness|\.identity_verification\.)/;

/** Identity documents Stripe's onboarding still lists for the account's person — what L7 means never to ask twice. */
export function asksForIdAgain(a) {
  const r = a?.requirements ?? {};
  const all = [...(r.currently_due ?? []), ...(r.eventually_due ?? []), ...(r.past_due ?? [])];
  return [...new Set(all.filter((x) => ID_ASK.test(x)))];
}

/** The same, read from the facts Epic stored (hosts.stripe_requirements, accountFacts below). */
export function storedIdAsks(facts) {
  const all = [...(facts?.currentlyDue ?? []), ...(facts?.eventuallyDue ?? []), ...(facts?.pastDue ?? [])];
  return [...new Set(all.filter((x) => ID_ASK.test(x)))];
}

/** The only facts Epic keeps about a host's account (brief §2): never bank details. */
export function accountFacts(a) {
  return {
    chargesEnabled: Boolean(a?.charges_enabled),
    payoutsEnabled: Boolean(a?.payouts_enabled),
    requirements: {
      currentlyDue: a?.requirements?.currently_due ?? [],
      eventuallyDue: a?.requirements?.eventually_due ?? [],
      pastDue: a?.requirements?.past_due ?? [],
      disabledReason: a?.requirements?.disabled_reason ?? null,
      // What the account-trouble watch (L15) reads: whether sign-up was finished, and each capability's state.
      detailsSubmitted: Boolean(a?.details_submitted),
      capabilities: { card_payments: a?.capabilities?.card_payments ?? null, transfers: a?.capabilities?.transfers ?? null },
    },
    payoutsManual: payoutsManual(a),
  };
}

/** Disabled reasons that are Stripe acting on the account, not a host part-way through its form (L15). */
const STRIPE_ACTED = /^(rejected\.|listed$|under_review$|platform_paused$|other$|account_closed$)/;

/**
 * Is Stripe disabling, restricting or closing a host's account (register L15)? From the facts Epic stored. Null when
 * all is well — including a dormant account and a host still part-way through Stripe's form, which are not trouble.
 * Otherwise `{ reason, words }`: Stripe's own reason, and what it means, for a person in the back office.
 */
export function accountTrouble(facts) {
  const r = facts ?? {};
  const why = r.disabledReason ?? null;
  if (why && STRIPE_ACTED.test(why)) {
    const words = why === 'account_closed' ? 'The host’s Stripe account was closed or disconnected.'
      : why.startsWith('rejected.') ? `Stripe rejected the account (${why.slice(9).replace(/_/g, ' ')}).`
        : why === 'listed' ? 'Stripe is checking the account against a prohibited list.'
          : why === 'under_review' ? 'Stripe is reviewing the account.'
            : why === 'platform_paused' ? 'The account is paused.' : 'Stripe disabled the account.';
    return { reason: why, words };
  }
  // Sign-up finished (now, or ever — Stripe un-marks it when new requirements go overdue), and since then Stripe has
  // turned something off.
  if (r.detailsSubmitted || r.everSubmitted) {
    const off = Object.entries(r.capabilities ?? {}).filter(([, v]) => v === 'inactive').map(([k]) => k);
    if (why || off.length) return { reason: why ?? `inactive:${off.join(',')}`, words: why ? `Stripe disabled the account (${why.replace(/[._]/g, ' ')}).` : `Stripe switched off ${off.map((k) => (k === 'card_payments' ? 'card payments' : 'transfers')).join(' and ')}.` };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Verified: Identity
// ---------------------------------------------------------------------------

/**
 * Passport and a selfie (L7). A UK photocard licence only while the setting
 * that allows it is on — it is off (owner, 3 Oct 2026). `relatedPerson` ties
 * the check to the host's Stripe Person so Stripe's own checks accept it; Stripe
 * refuses it once an onboarding link has been made, so it is made first.
 */
export function identitySessionBody({ returnUrl, hostId, relatedPerson = null, allowDrivingLicence = false }) {
  return {
    type: 'document',
    options: { document: { allowed_types: allowDrivingLicence ? ['passport', 'driving_license'] : ['passport'], require_matching_selfie: true } },
    ...(relatedPerson?.account && relatedPerson?.person ? { related_person: { account: relatedPerson.account, person: relatedPerson.person } } : {}),
    return_url: returnUrl,
    metadata: { epic_host_id: hostId },
  };
}

export function identitySession({ returnUrl, hostId, householdId, relatedPerson = null, allowDrivingLicence = false }) {
  return call('POST', '/identity/verification_sessions', identitySessionBody({ returnUrl, hostId, relatedPerson, allowDrivingLicence }),
    { householdId, purpose: 'host.identity.session' });
}

export function retrieveIdentity(sessionId, { householdId } = {}) {
  // With its last report, whose creation is when Stripe actually checked the document (verifiedAt below).
  return call('GET', `/identity/verification_sessions/${encodeURIComponent(sessionId)}`, { expand: ['last_verification_report'] }, { householdId, purpose: 'host.identity.read' });
}

/**
 * When Stripe verified it — never when Epic heard about it (Codex, 3 Oct 2026): the report's own time when the
 * session carries it, else the event's (`eventCreated`, seconds), else null for the caller to fall back on.
 */
export function verifiedAt(session, eventCreated = null) {
  const report = session?.last_verification_report;
  if (report && typeof report === 'object' && Number.isFinite(report.created)) return new Date(report.created * 1000);
  if (Number.isFinite(eventCreated)) return new Date(eventCreated * 1000);
  return null;
}

/** Stripe's states, in Epic's words: only `verified` is Verified. */
export const identityState = (s) => (s?.status === 'verified' ? 'verified' : s?.status === 'requires_input' && s?.last_error ? 'failed' : s?.status === 'canceled' ? 'none' : 'pending');

// ---------------------------------------------------------------------------
// the private host's £10, and Pro
// ---------------------------------------------------------------------------

export function checkout({ kind, amountPence, name, successUrl, cancelUrl, email, householdId, offerId, idempotencyKey = null }) {
  const recurring = kind === 'pro';
  return call('POST', '/checkout/sessions', {
    mode: recurring ? 'subscription' : 'payment',
    success_url: successUrl, cancel_url: cancelUrl,
    customer_email: email ?? undefined,
    line_items: [{ quantity: 1, price_data: { currency: 'gbp', unit_amount: amountPence, product_data: { name }, ...(recurring ? { recurring: { interval: 'month' } } : {}) } }],
    metadata: { epic_kind: kind, epic_offer_id: offerId, epic_household_id: householdId },
    ...(recurring ? { subscription_data: { metadata: { epic_kind: 'pro', epic_household_id: householdId } } } : {}),
  }, { householdId, purpose: recurring ? 'host.pro.checkout' : 'host.private_fee.checkout', idempotencyKey });
}

export function retrieveCheckout(id, { householdId } = {}) {
  return call('GET', `/checkout/sessions/${encodeURIComponent(id)}`, null, { householdId, purpose: 'host.checkout.read' });
}

/** Close a Checkout session nobody should pay any more (the host switched plan). */
export function expireCheckout(id, { householdId } = {}) {
  return call('POST', `/checkout/sessions/${encodeURIComponent(id)}/expire`, {}, { householdId, purpose: 'host.checkout.expire' });
}

/** Paid: a payment session marked paid, or a subscription session complete. */
// Only money actually taken counts: a subscription can complete Checkout with a delayed payment still unpaid (Codex, 2 Oct 2026).
export const checkoutPaid = (s) => s?.payment_status === 'paid';

// ---------------------------------------------------------------------------
// guests' payments: destination charges to the host's own account (L1, L2)
//
// The guest's money goes straight into the host's Stripe balance; Epic's fee
// comes back to Epic as the application fee, and nothing else ever sits on
// Epic's balance. The host's balance is on manual payouts, so Epic still decides
// *when* it is paid out (72 hours after the session, with no complaint) — it
// holds the timing, never the money (L3). An Ask to book is a card *held* — a
// manual-capture PaymentIntent, the same destination charge — captured on
// accept and cancelled on decline or timeout. Every call carries an idempotency
// key built from Epic's own ids, so a retry can never charge, refund or pay twice.
// ---------------------------------------------------------------------------

/**
 * The body of a guest's payment. Refuses outright without the host's account:
 * a booking or tip charged to Epic's own balance is the one thing L1 forbids,
 * so there is no fallback that would make one.
 */
/**
 * The host's part of the guest's statement: "EPIC* KATE MORRIS" (L11). Card networks allow 22 characters in all
 * and the prefix and "* " take six, so at most 16 here, letters and numbers only, and at least one letter.
 */
export function statementSuffix(name) {
  const clean = String(name ?? '').normalize('NFKD').replace(/[^A-Za-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 16).trim();
  return /[A-Z]/.test(clean) ? clean : null;
}

export function paymentIntentBody({ amountPence, destination, applicationFeePence, bookingId, offerId, householdId, hold = false, email = null, kind = 'booking', tipId = null, hostName = null }) {
  if (!/^acct_/.test(String(destination ?? ''))) throw Object.assign(new Error('This host can’t take payments yet.'), { status: 409, code: 'host_not_ready' });
  const fee = Math.round(Number(applicationFeePence));
  if (!Number.isInteger(fee) || fee < 0 || fee > amountPence) throw Object.assign(new Error('Epic’s fee on this booking is not right.'), { status: 500, code: 'bad_application_fee' });
  return {
    amount: amountPence, currency: 'gbp',
    automatic_payment_methods: { enabled: true },
    capture_method: hold ? 'manual' : 'automatic',
    receipt_email: email ?? undefined,
    // L2: a destination charge with the host as merchant of record, Epic's fee as the application fee.
    transfer_data: { destination },
    on_behalf_of: destination,
    ...(fee > 0 ? { application_fee_amount: fee } : {}),
    ...(statementSuffix(hostName) ? { statement_descriptor_suffix: statementSuffix(hostName) } : {}),
    metadata: { epic_kind: kind, epic_booking_id: bookingId, epic_offer_id: offerId, epic_household_id: householdId, epic_charge_model: 'destination', ...(tipId ? { epic_tip_id: tipId } : {}) },
  };
}

/** A guest's payment for a booking or a tip. `hold` holds the card without charging it. */
export function paymentIntent({ amountPence, destination, applicationFeePence, bookingId, offerId, householdId, hold = false, email = null, idempotencyKey, kind = 'booking', tipId = null, hostName = null }) {
  const body = paymentIntentBody({ amountPence, destination, applicationFeePence, bookingId, offerId, householdId, hold, email, kind, tipId, hostName });
  return call('POST', '/payment_intents', body, { householdId, purpose: kind === 'tip' ? 'booking.tip' : hold ? 'booking.hold' : 'booking.charge', idempotencyKey });
}

export function retrievePaymentIntent(id, { householdId } = {}) {
  return call('GET', `/payment_intents/${encodeURIComponent(id)}`, null, { householdId, purpose: 'booking.read' });
}

/** Charge a held card (Ask to book accepted). */
export function capturePayment(id, { householdId, idempotencyKey }) {
  return call('POST', `/payment_intents/${encodeURIComponent(id)}/capture`, {}, { householdId, purpose: 'booking.capture', idempotencyKey });
}

/** Let a held card go (declined, or the host did not answer in time). */
export function cancelPayment(id, { householdId, idempotencyKey }) {
  return call('POST', `/payment_intents/${encodeURIComponent(id)}/cancel`, {}, { householdId, purpose: 'booking.release', idempotencyKey });
}

/**
 * Give money back on a destination charge. The money comes back out of the
 * host's balance (`reverse_transfer`), and Epic's fee is given back in the same
 * proportion (`refund_application_fee`, K11) — a full refund leaves both at
 * nought, a part refund leaves each with the same share of what is kept.
 * `cause` is Epic's own word for why, kept in Stripe's metadata.
 */
export function refundBody({ paymentIntentId, amountPence, cause, bookingId, destination = true, keepFee = false }) {
  return {
    payment_intent: paymentIntentId, amount: amountPence,
    // A payment from before L1 (charged on Epic's own balance) has no transfer or fee to unwind. A refund that keeps
    // the cancellation fee unwinds the host's share explicitly instead (reverseHostShare), so neither is set (L5).
    ...(destination && !keepFee ? { reverse_transfer: true, refund_application_fee: true } : {}),
    metadata: { epic_kind: 'refund', epic_booking_id: bookingId, epic_cause: cause },
  };
}

export function refund({ paymentIntentId, amountPence, cause, bookingId, householdId, idempotencyKey, destination = true, keepFee = false }) {
  return call('POST', '/refunds', refundBody({ paymentIntentId, amountPence, cause, bookingId, destination, keepFee }), { householdId, purpose: 'booking.refund', idempotencyKey });
}

/**
 * The cancellation fee's other half (L5): after refunding the guest the cancelled amount less the fee, the host's
 * whole share of the cancelled amount comes back from their balance — a reversal of the charge's transfer by that
 * amount. Epic then holds exactly the fee (sandbox, 3 Oct 2026: £60 cancelled, £57 back, £51 reversed, Epic £3).
 */
export async function reverseHostShare({ paymentIntentId, amountPence, householdId, idempotencyKey, refundId }) {
  const pi = await call('GET', `/payment_intents/${encodeURIComponent(paymentIntentId)}`, { expand: ['latest_charge'] }, { householdId, purpose: 'booking.read' });
  const transfer = pi?.latest_charge?.transfer;
  if (!transfer) throw Object.assign(new Error('Stripe hasn’t made the transfer for this payment yet.'), { status: 503, code: 'stripe_unreachable', detail: 'no_transfer_yet' });
  return call('POST', `/transfers/${encodeURIComponent(typeof transfer === 'string' ? transfer : transfer.id)}/reversals`, {
    amount: amountPence, metadata: { epic_kind: 'cancellation_fee', epic_refund: refundId ?? null },
  }, { householdId, purpose: 'booking.refund.host_share', idempotencyKey });
}

/**
 * Recovering the fee from a host (L5): an account debit, taking it from their own Stripe balance to Epic's. Needs
 * the host's consent in the host terms (legal pack), and never takes a balance below nought — the caller checks.
 */
export function accountDebit({ accountId, amountPence, householdId, idempotencyKey, recoveryId }) {
  if (!/^acct_/.test(String(accountId ?? ''))) throw Object.assign(new Error('This host has no Stripe account.'), { status: 409, code: 'host_not_ready' });
  return call('POST', '/charges', {
    amount: amountPence, currency: 'gbp', source: accountId,
    metadata: { epic_kind: 'host_recovery', epic_recovery_id: recoveryId },
  }, { householdId, purpose: 'host.recovery', idempotencyKey });
}

export function retrieveRefund(id, { householdId } = {}) {
  return call('GET', `/refunds/${encodeURIComponent(id)}`, null, { householdId, purpose: 'booking.refund.read' });
}

/**
 * A released payout (L3): a Payout made on the host's own account, from their
 * own balance, for the released amount only. Never a transfer from Epic.
 * Stripe refusing for want of available funds is `funds_pending` — the money
 * is there but not cleared yet — and the payout waits rather than failing.
 */
export async function payout({ accountId, amountPence, payoutId, hostId, householdId, idempotencyKey }) {
  if (!/^acct_/.test(String(accountId ?? ''))) throw Object.assign(new Error('This host has no Stripe account.'), { status: 409, code: 'host_not_ready' });
  try {
    return await call('POST', '/payouts', {
      amount: amountPence, currency: 'gbp',
      metadata: { epic_kind: 'payout', epic_payout_id: payoutId, epic_host_id: hostId },
    }, { householdId, purpose: 'host.payout', idempotencyKey, account: accountId });
  } catch (err) {
    if (err.detail === 'balance_insufficient') throw Object.assign(new Error('The money for this payout hasn’t cleared at Stripe yet.'), { status: 409, code: 'funds_pending' });
    throw err;
  }
}

export function retrievePayout(id, { accountId, householdId } = {}) {
  return call('GET', `/payouts/${encodeURIComponent(id)}`, null, { householdId, purpose: 'host.payout.read', account: accountId });
}

/** What the host's own balance holds: available (can be paid out now) and pending, in pence. */
export async function hostBalance(accountId, { householdId } = {}) {
  const b = await call('GET', '/balance', null, { householdId, purpose: 'host.balance.read', account: accountId });
  const gbp = (list) => (list ?? []).filter((x) => x.currency === 'gbp').reduce((n, x) => n + Number(x.amount ?? 0), 0);
  return { availablePence: gbp(b.available), pendingPence: gbp(b.pending) };
}

/**
 * What Stripe holds for one ledger row, in Epic's terms: `{ amountPence, ok }`
 * where ok means the money moved (succeeded, captured, paid). Null for a
 * reference Epic does not know how to read — the reconciliation says it could
 * not check that row rather than calling it a match.
 */
export function stripeView(obj) {
  if (!obj || typeof obj !== 'object') return null;
  switch (obj.object) {
    case 'payment_intent': return { amountPence: obj.amount_received ?? 0, ok: obj.status === 'succeeded', held: obj.status === 'requires_capture' };
    case 'refund': return { amountPence: obj.amount ?? 0, ok: obj.status === 'succeeded' };
    case 'payout': return { amountPence: obj.amount ?? 0, ok: ['paid', 'in_transit', 'pending'].includes(obj.status) };
    // A host recovery: an account debit, which Stripe answers as a charge (py_).
    case 'charge': return { amountPence: (obj.amount ?? 0) - (obj.amount_refunded ?? 0), ok: obj.status === 'succeeded' };
    case 'checkout.session': return { amountPence: obj.amount_total ?? 0, ok: obj.payment_status === 'paid' };
    default: return null;
  }
}

/**
 * Read whatever a ledger reference points at, by its prefix. Null for an
 * unknown prefix — and for a transfer (`tr_`), which only the old model
 * made: those rows are void, not something to check against (owner, 3 Oct 2026).
 * A payout lives on the host's own account, so it needs that account.
 */
export function retrieveRef(ref, { householdId, accountId = null } = {}) {
  const r = String(ref ?? '');
  if (r.startsWith('pi_')) return retrievePaymentIntent(r, { householdId });
  if (r.startsWith('re_')) return retrieveRefund(r, { householdId });
  if (r.startsWith('po_')) return accountId ? retrievePayout(r, { accountId, householdId }) : null;
  if (r.startsWith('py_')) return call('GET', `/charges/${encodeURIComponent(r)}`, null, { householdId, purpose: 'host.recovery.read' });
  if (r.startsWith('cs_')) return retrieveCheckout(r, { householdId });
  return null;
}

// ---------------------------------------------------------------------------
// webhooks
// ---------------------------------------------------------------------------

/** The signing secrets Doppler holds: the platform endpoint's and, once made, the Connect endpoint's. */
export const webhookSecrets = () => [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].map((s) => String(s ?? '').trim()).filter(Boolean);

/**
 * Stripe's signature: `t=<ts>,v1=<hmac>` over `${t}.${raw}` with the endpoint
 * secret, inside a five-minute tolerance. Constant-time compare.
 */
export function verifyWebhook(raw, header, secret = webhookSecrets(), { now = Date.now(), toleranceS = 300 } = {}) {
  // Two endpoints, two secrets: Epic's own events, and the hosts' accounts' (payouts, account changes) on the Connect one.
  if (Array.isArray(secret)) return secret.some((s) => verifyWebhook(raw, header, s, { now, toleranceS }));
  if (!secret || !header) return false;
  const parts = Object.fromEntries(String(header).split(',').map((p) => p.split('=')).filter((p) => p.length === 2));
  const t = Number(parts.t);
  if (!t || Math.abs(now / 1000 - t) > toleranceS) return false;
  const want = crypto.createHmac('sha256', secret).update(`${t}.${Buffer.isBuffer(raw) ? raw.toString('utf8') : raw}`).digest('hex');
  const got = String(header).split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  return got.some((g) => g.length === want.length && crypto.timingSafeEqual(Buffer.from(g), Buffer.from(want)));
}
