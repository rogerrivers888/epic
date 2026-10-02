/**
 * Stripe, for hosting (Epic hosting v7, RULINGS › Payments).
 *
 *   · Payouts are Stripe Connect's hosted onboarding (an Express account and an
 *     account link). Epic never collects a sort code or an account number.
 *   · Verified is Stripe Identity: a hosted verification session, passport or
 *     UK driving licence plus a selfie. Epic sees the result, never the document.
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

const BASE = (process.env.STRIPE_API_BASE || 'https://api.stripe.com').replace(/\/$/, '') + '/v1';
const PROVIDER = 'stripe';

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
async function call(method, path, params, { householdId = null, purpose, idempotencyKey = null } = {}) {
  assertReady();
  const started = Date.now();
  const headers = { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY.trim()}`, 'stripe-version': process.env.STRIPE_API_VERSION || '2024-06-20' };
  let url = `${BASE}${path}`;
  let body;
  if (method === 'GET') { const q = formEncode(params); if (q) url += `?${q}`; }
  else { headers['content-type'] = 'application/x-www-form-urlencoded'; body = formEncode(params); }
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
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
    throw Object.assign(new Error('Stripe said no to that. Try again, or come back to it later.'), { status: 502, code: 'stripe_refused', detail: j?.error?.code ?? null });
  }
  await providerCalls.recordMetered({ householdId, provider: PROVIDER, purpose, units: { 'stripe-requests': 1 }, costUsd: 0, ok: true, ms: Date.now() - started });
  return j;
}

// ---------------------------------------------------------------------------
// payouts: Connect, hosted onboarding
// ---------------------------------------------------------------------------

export function createConnectAccount({ email, householdId, hostId }) {
  return call('POST', '/accounts', {
    type: 'express', country: 'GB', email: email ?? undefined, business_type: 'individual',
    capabilities: { transfers: { requested: true }, card_payments: { requested: true } },
    metadata: { epic_host_id: hostId },
  }, { householdId, purpose: 'host.payouts.account', idempotencyKey: `acct-${hostId}` });
}

export function accountLink({ accountId, refreshUrl, returnUrl, householdId }) {
  return call('POST', '/account_links', { account: accountId, refresh_url: refreshUrl, return_url: returnUrl, type: 'account_onboarding' }, { householdId, purpose: 'host.payouts.link' });
}

export function retrieveAccount(accountId, { householdId } = {}) {
  return call('GET', `/accounts/${encodeURIComponent(accountId)}`, null, { householdId, purpose: 'host.payouts.read' });
}

/** Ready to be paid: Stripe has what it needs and payouts are switched on. */
export const accountReady = (a) => Boolean(a?.details_submitted && a?.payouts_enabled);

// ---------------------------------------------------------------------------
// Verified: Identity
// ---------------------------------------------------------------------------

export function identitySession({ returnUrl, hostId, householdId }) {
  return call('POST', '/identity/verification_sessions', {
    type: 'document',
    options: { document: { allowed_types: ['passport', 'driving_license'], require_matching_selfie: true } },
    return_url: returnUrl,
    metadata: { epic_host_id: hostId },
  }, { householdId, purpose: 'host.identity.session' });
}

export function retrieveIdentity(sessionId, { householdId } = {}) {
  return call('GET', `/identity/verification_sessions/${encodeURIComponent(sessionId)}`, null, { householdId, purpose: 'host.identity.read' });
}

/** Stripe's states, in Epic's words: only `verified` is Verified. */
export const identityState = (s) => (s?.status === 'verified' ? 'verified' : s?.status === 'requires_input' && s?.last_error ? 'failed' : s?.status === 'canceled' ? 'none' : 'pending');

// ---------------------------------------------------------------------------
// the private host's £10, and Pro
// ---------------------------------------------------------------------------

export function checkout({ kind, amountPence, name, successUrl, cancelUrl, email, householdId, offerId }) {
  const recurring = kind === 'pro';
  return call('POST', '/checkout/sessions', {
    mode: recurring ? 'subscription' : 'payment',
    success_url: successUrl, cancel_url: cancelUrl,
    customer_email: email ?? undefined,
    line_items: [{ quantity: 1, price_data: { currency: 'gbp', unit_amount: amountPence, product_data: { name }, ...(recurring ? { recurring: { interval: 'month' } } : {}) } }],
    metadata: { epic_kind: kind, epic_offer_id: offerId, epic_household_id: householdId },
  }, { householdId, purpose: recurring ? 'host.pro.checkout' : 'host.private_fee.checkout' });
}

export function retrieveCheckout(id, { householdId } = {}) {
  return call('GET', `/checkout/sessions/${encodeURIComponent(id)}`, null, { householdId, purpose: 'host.checkout.read' });
}

/** Close a Checkout session nobody should pay any more (the host switched plan). */
export function expireCheckout(id, { householdId } = {}) {
  return call('POST', `/checkout/sessions/${encodeURIComponent(id)}/expire`, {}, { householdId, purpose: 'host.checkout.expire' });
}

/** Paid: a payment session marked paid, or a subscription session complete. */
export const checkoutPaid = (s) => s?.payment_status === 'paid' || (s?.mode === 'subscription' && s?.status === 'complete');

// ---------------------------------------------------------------------------
// webhooks
// ---------------------------------------------------------------------------

/**
 * Stripe's signature: `t=<ts>,v1=<hmac>` over `${t}.${raw}` with the endpoint
 * secret, inside a five-minute tolerance. Constant-time compare.
 */
export function verifyWebhook(raw, header, secret = process.env.STRIPE_WEBHOOK_SECRET, { now = Date.now(), toleranceS = 300 } = {}) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(String(header).split(',').map((p) => p.split('=')).filter((p) => p.length === 2));
  const t = Number(parts.t);
  if (!t || Math.abs(now / 1000 - t) > toleranceS) return false;
  const want = crypto.createHmac('sha256', secret).update(`${t}.${Buffer.isBuffer(raw) ? raw.toString('utf8') : raw}`).digest('hex');
  const got = String(header).split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  return got.some((g) => g.length === want.length && crypto.timingSafeEqual(Buffer.from(g), Buffer.from(want)));
}
