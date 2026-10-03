/**
 * Memberships through Stripe (register L8, Phase 4; sources/membership.js, migration 372).
 *
 * Stripe is a local fake; nothing leaves the machine and nothing is spent. Pinned:
 *
 *   · joining is a Checkout on the household's own customer, a month free with the card required, at the plan's
 *     current website price — a price found by its lookup key, made once and remembered;
 *   · the return page makes nobody a member: only Stripe's events do, each read back from Stripe;
 *   · a payment failing after the trial pauses the membership (never cancels it) and keeps why; paid again, it runs;
 *   · cancelled is cancelled, with an end; the reports read all of it through billedMemberships();
 *   · the reminder goes seven days before a trial ends, once a date, with the date, the amount and a one-tap cancel;
 *     a send that fails gives the claim back; Stripe's three-day warning is only a backstop;
 *   · the one-tap cancel opens Stripe's cancel page for that membership only, and an old link goes to Settings.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';

const calls = [];
/** The subscriptions the fake Stripe holds, by id. */
const subs = new Map();
let priceMade = 0;
/** What a Checkout session reads back as. */
let checkoutRead = { status: 'open' };
/** Sessions Stripe lists as open for a customer. */
let openSessions = [];
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    calls.push({ method: req.method, url: req.url, body: decodeURIComponent(body), idem: req.headers['idempotency-key'] ?? null });
    const json = (o, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/v1/customers' && req.method === 'POST') return json({ id: `cus_${crypto.randomUUID().slice(0, 8)}` });
    if (req.url.startsWith('/v1/customers/')) return json({ id: req.url.split('/')[3] });
    if (req.url.startsWith('/v1/prices?')) return json({ data: priceMade ? [{ id: 'price_solo_599', product: 'epic_membership_solo' }] : [] });
    if (req.url.startsWith('/v1/products/')) return json({ error: { code: 'resource_missing' } }, 404);
    if (req.url === '/v1/products' && req.method === 'POST') return json({ id: 'epic_membership_solo' });
    if (req.url === '/v1/prices' && req.method === 'POST') { priceMade += 1; return json({ id: 'price_solo_599', product: 'epic_membership_solo' }); }
    if (req.url === '/v1/checkout/sessions' && req.method === 'POST') return json({ id: 'cs_m_1', url: 'https://checkout.stripe.test/m' });
    if (req.url === '/v1/billing_portal/sessions' && req.method === 'POST') return json({ url: 'https://billing.stripe.test/p' });
    if (req.url.startsWith('/v1/checkout/sessions?')) {
      // Two pages when there are more than one: the second after the first page's last id.
      const after = new URL(req.url, 'http://x').searchParams.get('starting_after');
      const from = after ? openSessions.findIndex((x) => x.id === after) + 1 : 0;
      const page = openSessions.slice(from, from + 1);
      return json({ data: page, has_more: from + 1 < openSessions.length });
    }
    if (req.url.endsWith('/expire')) return json({ id: req.url.split('/')[4], status: 'expired' });
    if (req.url.startsWith('/v1/checkout/sessions/')) return json({ id: req.url.split('/')[4], ...checkoutRead });
    if (req.url.startsWith('/v1/subscriptions/') && req.method === 'DELETE') { const s = subs.get(req.url.split('/')[3].split('?')[0]); return json({ ...s, status: 'canceled', latest_invoice: null }); }
    if (req.url.startsWith('/v1/subscriptions/') && req.method === 'POST') { const s = subs.get(req.url.split('/')[3]); if (s && body.includes('epic_duplicate')) s.metadata = { ...s.metadata, epic_duplicate: 'true' }; return json(s ?? {}); }
    if (req.url.startsWith('/v1/subscriptions/')) { const s = subs.get(req.url.split('/')[3]); return s ? json(s) : json({ error: { code: 'resource_missing' } }, 404); }
    return json({ error: { code: 'not_found' } }, 404);
  });
});
fake.listen(0, '127.0.0.1');
await new Promise((r) => fake.once('listening', r));
process.env.STRIPE_API_BASE = `http://127.0.0.1:${fake.address().port}`;
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.EPIC_APP_URL = 'https://app.epic.test';
process.env.EPIC_API_BASE_URL = 'https://api.epic.test';
delete process.env.POSTMARK_SERVER_TOKEN;

const { aHousehold, testDatabase } = await import('./helpers/db.js');
const { query, pool } = await testDatabase();
const { runAsAccount } = await import('../src/context.js');
const routes = await import('../src/routes/membership.js');
const membership = await import('../src/sources/membership.js');
const billing = await import('../src/repositories/membershipBilling.js');
const { billedMemberships, classifyHousehold } = await import('../src/repositories/memberships.js');
const { applyStripeEvent } = await import('../src/routes/hostLanes.js');

test.after(async () => { await new Promise((r) => fake.close(r)); await pool?.end?.(); });

async function aMember() {
  const { household, member } = await aHousehold(query);
  const { rows: [account] } = await query(
    "insert into accounts (household_id, member_id, email, role, status, name) values ($1,$2,$3,'customer','active','Sam Reed') returning *",
    [household.id, member.id, `m-${crypto.randomUUID().slice(0, 8)}@example.com`],
  );
  return { household, account };
}

async function server(account) {
  const app = express();
  app.use('/api', routes.publicRouter);
  app.use(express.json());
  app.use((req, _res, next) => runAsAccount(account, next));
  app.use('/api', routes.default);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.code ?? 'x', message: err.message }));
  const s = app.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  const out = (r) => r.json().catch(() => null).then((body) => ({ status: r.status, body, location: r.headers.get('location') }));
  return {
    close: () => new Promise((r) => s.close(r)),
    get: (p) => fetch(base + p, { redirect: 'manual' }).then(out),
    send: (method, p, body) => fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(out),
  };
}

const secs = (d) => Math.floor(d.getTime() / 1000);
const day = 86400_000;
/** A Stripe subscription as the fake holds it. */
function aSub(householdId, { id = `sub_${crypto.randomUUID().slice(0, 8)}`, status = 'trialing', trialEnd = new Date(Date.now() + 30 * day), amount = 599, interval = 'month', kind = 'membership', plan = 'solo' } = {}) {
  const s = {
    id, object: 'subscription', status, customer: `cus_${householdId}`.slice(0, 40), livemode: false,
    metadata: { epic_kind: kind, epic_household_id: householdId, epic_plan: plan },
    trial_end: trialEnd ? secs(trialEnd) : null, start_date: secs(new Date()), cancel_at_period_end: false, ended_at: null,
    items: { data: [{ quantity: 1, current_period_end: secs(trialEnd ?? new Date(Date.now() + 30 * day)), price: { id: 'price_solo_599', unit_amount: amount, recurring: { interval, interval_count: 1 }, metadata: { epic_plan: plan } } }] },
  };
  subs.set(id, s);
  return s;
}
const event = (type, object) => ({ id: `evt_${crypto.randomUUID().slice(0, 8)}`, type, data: { object } });

test('joining is a Checkout on the household’s own customer, a month free, card required, at the plan’s price', async () => {
  const { household, account } = await aMember();
  const srv = await server(account);
  try {
    calls.length = 0;
    const r = await srv.send('POST', '/api/membership/checkout', { plan: 'solo' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.url, 'https://checkout.stripe.test/m');
    assert.equal(r.body.trialDays, 30);
    const cs = calls.find((c) => c.url === '/v1/checkout/sessions');
    assert.match(cs.body, /mode=subscription/);
    assert.match(cs.body, /payment_method_collection=always/);
    assert.match(cs.body, /subscription_data\[trial_period_days\]=30/);
    assert.match(cs.body, /subscription_data\[metadata\]\[epic_kind\]=membership/);
    assert.match(cs.body, /line_items\[0\]\[price\]=price_solo_599/);
    const customer = await billing.customerOf(household.id);
    assert.match(customer, /^cus_/);
    assert.match(cs.body, new RegExp(`customer=${customer}`));
    assert.equal(calls.find((c) => c.url === '/v1/customers').idem, `customer-${household.id}`);
    // The price was looked up by what it is, and made once.
    assert.match(calls.find((c) => c.url.startsWith('/v1/prices?')).url, /epic_solo_web_599_month/);
    const made = priceMade;
    calls.length = 0;
    const { household: h2, account: a2 } = await aMember();
    const srv2 = await server(a2);
    try { assert.equal((await srv2.send('POST', '/api/membership/checkout', { plan: 'solo' })).status, 200); } finally { await srv2.close(); }
    assert.equal(priceMade, made, 'remembered: no second price');
    assert.equal(calls.some((c) => c.url.startsWith('/v1/prices')), false, 'not even looked up again');
    assert.ok(h2.id);
    // Nothing yet: the return page makes nobody a member.
    assert.equal((await srv.get('/api/membership')).body.membership, null);
    assert.equal((await srv.send('POST', '/api/membership/checkout', { plan: 'gold' })).status, 400);
  } finally { await srv.close(); }
});

test('joining needs a person signed in', async () => {
  const srv = await server(null);
  try { assert.equal((await srv.send('POST', '/api/membership/checkout', { plan: 'solo' })).status, 401); } finally { await srv.close(); }
});

test('Stripe’s events make the membership; a failed payment pauses it, paid again it runs, cancelled is ended', async () => {
  const { household, account } = await aMember();
  const sub = aSub(household.id);
  await applyStripeEvent(event('checkout.session.completed', { id: 'cs_m_1', object: 'checkout.session', subscription: sub.id, metadata: { epic_kind: 'membership', epic_household_id: household.id } }));
  let m = await billing.membershipBySubscription(sub.id);
  assert.equal(m.status, 'trialling');
  assert.equal(m.monthly_pence, 599);
  assert.equal(m.plan_key, 'solo');
  assert.equal((await classifyHousehold(household.id)).cls, 'member_trialling');

  // An event's own snapshot is never trusted: it says active, Stripe (read back) still says trialling.
  await applyStripeEvent(event('customer.subscription.updated', { ...sub, status: 'active' }));
  assert.equal((await billing.membershipBySubscription(sub.id)).status, 'trialling');

  // The first payment after the trial fails: paused, not cancelled, and why is kept.
  sub.status = 'past_due';
  await applyStripeEvent(event('invoice.payment_failed', { id: 'in_1', object: 'invoice', subscription: sub.id, billing_reason: 'subscription_cycle' }));
  m = await billing.membershipBySubscription(sub.id);
  assert.equal(m.status, 'paused');
  assert.ok(m.paused_at);
  assert.equal(m.pause_reason, 'payment_failed:subscription_cycle:in_1');
  assert.equal(m.ended_at, null);
  let billed = (await billedMemberships()).find((b) => b.householdId === household.id);
  assert.deepEqual([billed.state, billed.paused, billed.endedAt, billed.channel], ['paid', true, null, 'website']);
  // Stripe's retries go on ("unpaid" after the last one): still paused, the first date kept.
  const firstPause = m.paused_at.getTime();
  sub.status = 'unpaid';
  await applyStripeEvent(event('customer.subscription.updated', sub));
  m = await billing.membershipBySubscription(sub.id);
  assert.equal(m.status, 'paused');
  assert.equal(m.paused_at.getTime(), firstPause);

  // A retry succeeds: running again.
  sub.status = 'active';
  await applyStripeEvent(event('invoice.paid', { id: 'in_1', object: 'invoice', subscription: sub.id }));
  m = await billing.membershipBySubscription(sub.id);
  assert.deepEqual([m.status, m.paused_at, m.pause_reason], ['active', null, null]);
  assert.equal((await classifyHousehold(household.id)).cls, 'member_paid');
  assert.equal((await classifyHousehold(household.id)).monthlyPence, 599);

  const srv = await server(account);
  try {
    const r = await srv.get('/api/membership');
    assert.equal(r.body.membership.status, 'active');
    assert.equal(r.body.membership.monthlyPence, 599);
    // A member is not sent to join again.
    assert.equal((await srv.send('POST', '/api/membership/checkout', { plan: 'household' })).status, 409);
    assert.equal((await srv.send('POST', '/api/membership/portal')).body.url, 'https://billing.stripe.test/p');
  } finally { await srv.close(); }

  // Cancelled: ended, and a household that has had its month free does not get another.
  sub.status = 'canceled'; sub.ended_at = secs(new Date());
  await applyStripeEvent(event('customer.subscription.deleted', sub));
  m = await billing.membershipBySubscription(sub.id);
  assert.equal(m.status, 'cancelled');
  assert.ok(m.ended_at);
  billed = (await billedMemberships()).find((b) => b.householdId === household.id);
  assert.equal(billed.state, 'cancelled');
  assert.ok(billed.endedAt);
  assert.equal((await classifyHousehold(household.id)).cls, 'none');
  const srv2 = await server(account);
  try {
    calls.length = 0;
    const r = await srv2.send('POST', '/api/membership/checkout', { plan: 'solo' });
    assert.equal(r.body.trialDays, 0);
    assert.doesNotMatch(calls.find((c) => c.url === '/v1/checkout/sessions').body, /trial_period_days/);
  } finally { await srv2.close(); }
});

test('somebody else’s subscription — hosting Pro, or none of Epic’s — is not a membership', async () => {
  const { household } = await aMember();
  const pro = aSub(household.id, { kind: 'pro' });
  await applyStripeEvent(event('invoice.paid', { id: 'in_p', object: 'invoice', subscription: pro.id }));
  assert.equal(await billing.membershipBySubscription(pro.id), null);
  assert.equal(await billing.runningMembership(household.id), null);
});

test('an annual price is counted a month at a time; an incomplete Checkout is not a membership', async () => {
  const { membershipFromSubscription } = await import('../src/sources/stripe.js');
  assert.equal(membershipFromSubscription(aSub('h', { amount: 6000, interval: 'year' })).monthlyPence, 500);
  assert.equal(membershipFromSubscription({ status: 'incomplete' }).status, null);
});

test('the reminder: seven days out, once a date, the date, the amount and one tap to cancel', async () => {
  const { household, account } = await aMember();
  const sub = aSub(household.id, { trialEnd: new Date(Date.now() + 6 * day) });
  await applyStripeEvent(event('customer.subscription.created', sub));
  const far = aSub((await aMember()).household.id, { trialEnd: new Date(Date.now() + 20 * day) });
  await applyStripeEvent(event('customer.subscription.created', far));

  // Mail is not set up here: nothing is sent, and the claim is given back for the next round.
  const r1 = await membership.sendRemindersDue();
  assert.ok(r1.due >= 1);
  assert.equal(r1.sent, 0);
  assert.equal((await billing.membershipBySubscription(sub.id)).reminded_for, null);

  // Claimed: once for that date, never for one further out than seven days.
  const claimed = await billing.claimRemindersDue({ days: 7 });
  const mine = claimed.find((m) => m.stripe_subscription_id === sub.id);
  assert.ok(mine);
  assert.equal(claimed.some((m) => m.stripe_subscription_id === far.id), false);
  assert.equal((await billing.claimRemindersDue({ days: 7 })).some((m) => m.stripe_subscription_id === sub.id), false, 'once a date');
  assert.ok(mine.cancel_token.length >= 60);
  // Stripe's three-day warning finds it already sent.
  assert.equal(await billing.claimReminderFor(mine.id), null);

  const mail = membership.reminderMail(mine, `https://api.epic.test/api/membership/cancel/${mine.cancel_token}`);
  assert.match(mail.subject, /^Your free month of Epic Solo ends on /);
  assert.match(mail.text, /£5\.99 a month/);
  assert.match(mail.text, /Cancel in one tap/);
  assert.match(mail.text, new RegExp(mine.cancel_token));

  // The tap: Stripe's cancel page for this membership; an unknown link goes to Settings.
  const srv = await server(null);
  try {
    calls.length = 0;
    const tap = await srv.get(`/api/membership/cancel/${mine.cancel_token}`);
    assert.equal(tap.status, 303);
    assert.equal(tap.location, 'https://billing.stripe.test/p');
    const portal = calls.find((c) => c.url === '/v1/billing_portal/sessions');
    assert.match(portal.body, /flow_data\[type\]=subscription_cancel/);
    assert.match(portal.body, new RegExp(`flow_data\\[subscription_cancel\\]\\[subscription\\]=${sub.id}`));
    const old = await srv.get(`/api/membership/cancel/${'x'.repeat(64)}`);
    assert.equal(old.location, 'https://app.epic.test/settings');
  } finally { await srv.close(); }
  assert.ok(account);
});

test('a cancelled-at-period-end trial is not reminded; the backstop sends only what never went', async () => {
  const { household } = await aMember();
  const sub = aSub(household.id, { trialEnd: new Date(Date.now() + 3 * day) });
  sub.cancel_at_period_end = true;
  await applyStripeEvent(event('customer.subscription.created', sub));
  assert.equal((await billing.claimRemindersDue({ days: 7 })).some((m) => m.stripe_subscription_id === sub.id), false);
  sub.cancel_at_period_end = false;
  // trial_will_end: the subscription is read back and, never reminded, it is claimed (and, unsent here, given back).
  await applyStripeEvent(event('customer.subscription.trial_will_end', sub));
  const m = await billing.membershipBySubscription(sub.id);
  assert.equal(m.cancel_at_period_end, false);
  assert.equal(m.reminded_for, null, 'mail not set up: given back for the hourly round');
});

test('a Pro membership is Pro for hosting: the £10 private fee is waived; paused, it is not', async () => {
  const { household } = await aMember();
  const sub = aSub(household.id, { plan: 'pro', amount: 1299 });
  await applyStripeEvent(event('customer.subscription.created', sub));
  const { rows: [r] } = await query("select 1 from memberships where household_id = $1 and plan_key = 'pro' and status = 'trialling'", [household.id]);
  assert.ok(r);
  const lanes = await import('../src/routes/hostLanes.js');
  assert.equal(await lanes.hostingProFor(household.id), true);
  sub.status = 'past_due';
  await applyStripeEvent(event('customer.subscription.updated', sub));
  assert.equal(await lanes.hostingProFor(household.id), false);
});

test('a plan switched in the portal is the new plan: the price says so, not what Checkout wrote', async () => {
  const { household } = await aMember();
  const sub = aSub(household.id, { plan: 'solo' });
  sub.items.data[0].price.metadata.epic_plan = 'pro';
  sub.items.data[0].price.unit_amount = 1299;
  await applyStripeEvent(event('customer.subscription.updated', sub));
  const m = await billing.membershipBySubscription(sub.id);
  assert.deepEqual([m.plan_key, m.monthly_pence], ['pro', 1299]);
});

test('an older read finishing late never puts an older state back', async () => {
  const { household } = await aMember();
  const sub = aSub(household.id);
  const { membershipFromSubscription } = await import('../src/sources/stripe.js');
  const older = await billing.readStamp();
  const newer = await billing.readStamp();
  await billing.upsertFromSubscription({ householdId: household.id, subscriptionId: sub.id, facts: membershipFromSubscription({ ...sub, status: 'canceled', ended_at: secs(new Date()) }), stamp: newer });
  const after = await billing.upsertFromSubscription({ householdId: household.id, subscriptionId: sub.id, facts: membershipFromSubscription({ ...sub, status: 'active' }), stamp: older });
  assert.equal(after.status, 'cancelled');
  assert.ok(after.ended_at);
});

test('a full batch of reminders already sent never starves the rest', async () => {
  const made = [];
  for (let i = 0; i < 3; i += 1) {
    const { household } = await aMember();
    const sub = aSub(household.id, { trialEnd: new Date(Date.now() + (2 + i) * day) });
    await applyStripeEvent(event('customer.subscription.created', sub));
    made.push(sub.id);
  }
  const got = new Set();
  for (let i = 0; i < 6; i += 1) for (const m of await billing.claimRemindersDue({ days: 7, limit: 1 })) got.add(m.stripe_subscription_id);
  for (const id of made) assert.ok(got.has(id), 'every one reminded');
});

test('one Checkout at a time: a second press at once is refused; a later one closes the first', async () => {
  const { household, account } = await aMember();
  const srv = await server(account);
  try {
    const [a, b] = await Promise.all([srv.send('POST', '/api/membership/checkout', { plan: 'solo' }), srv.send('POST', '/api/membership/checkout', { plan: 'solo' })]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    await query("update households set membership_checkout_at = now() - interval '3 minutes' where id = $1", [household.id]);
    calls.length = 0;
    const third = await srv.send('POST', '/api/membership/checkout', { plan: 'household' });
    assert.equal(third.status, 200, JSON.stringify(third.body));
    assert.ok(calls.some((c) => c.url === '/v1/checkout/sessions/cs_m_1/expire'), 'the first session closed');
  } finally { await srv.close(); }
});

test('a second subscription for a household already a member is cancelled, and never a row', async () => {
  const { household } = await aMember();
  const first = aSub(household.id);
  await applyStripeEvent(event('customer.subscription.created', first));
  const second = aSub(household.id);
  calls.length = 0;
  await applyStripeEvent(event('customer.subscription.created', second));
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.url.startsWith(`/v1/subscriptions/${second.id}`)));
  assert.equal(await billing.membershipBySubscription(second.id), null);
  assert.equal((await billing.runningMembership(household.id)).stripe_subscription_id, first.id);
  // Its own cancellation event, marked as a duplicate, writes nothing either.
  second.metadata.epic_duplicate = 'true'; second.status = 'canceled';
  await applyStripeEvent(event('customer.subscription.deleted', second));
  assert.equal(await billing.membershipBySubscription(second.id), null);
});

test('revenue counts the paid months only — never the trial, and still after a cancellation', async () => {
  const { membershipRevenue } = await import('../src/repositories/memberships.js');
  const { household } = await aMember();
  const sub = aSub(household.id, { trialEnd: new Date('2026-03-01T00:00:00Z') });
  sub.start_date = secs(new Date('2026-01-31T00:00:00Z'));
  sub.status = 'active';
  await applyStripeEvent(event('customer.subscription.updated', sub));
  sub.status = 'canceled'; sub.ended_at = secs(new Date('2026-05-15T00:00:00Z'));
  await applyStripeEvent(event('customer.subscription.deleted', sub));
  const m = await billing.membershipBySubscription(sub.id);
  assert.equal(m.status, 'cancelled');
  assert.equal(new Date(m.paid_from).toISOString(), '2026-03-01T00:00:00.000Z');
  // January and February were the trial; March, April and May were paid.
  const before = await membershipRevenue('2025-12-01', '2026-03-01');
  const during = await membershipRevenue('2026-03-01', '2026-06-01');
  // Nothing else in this file runs before October 2026, so these windows hold this membership alone.
  assert.equal(before.pence, 0, 'the trial is not revenue');
  assert.equal(during.pence, 3 * 599, 'March, April and May, though it is cancelled now');
});

test('a member who cancelled can join again; a Checkout just finished and not yet written down is refused', async () => {
  const { household, account } = await aMember();
  const srv = await server(account);
  try {
    assert.equal((await srv.send('POST', '/api/membership/checkout', { plan: 'solo' })).status, 200);
    await query("update households set membership_checkout_at = now() - interval '3 minutes' where id = $1", [household.id]);
    // Finished, its subscription not yet heard of: they have just joined.
    const sub = aSub(household.id);
    checkoutRead = { status: 'complete', subscription: sub.id };
    assert.equal((await srv.send('POST', '/api/membership/checkout', { plan: 'solo' })).body.error, 'already_a_member');
    // Written down, then cancelled: that Checkout is history, and joining again is allowed (without a second trial).
    await applyStripeEvent(event('customer.subscription.created', sub));
    sub.status = 'canceled'; sub.ended_at = secs(new Date());
    await applyStripeEvent(event('customer.subscription.deleted', sub));
    await query("update households set membership_checkout_at = now() - interval '3 minutes' where id = $1", [household.id]);
    const again = await srv.send('POST', '/api/membership/checkout', { plan: 'solo' });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.trialDays, 0);
  } finally { checkoutRead = { status: 'open' }; await srv.close(); }
});

test('a first payment that fails and never recovers is never revenue', async () => {
  const { household } = await aMember();
  const sub = aSub(household.id, { trialEnd: new Date(Date.now() - 2 * day) });
  sub.status = 'past_due';
  await applyStripeEvent(event('invoice.payment_failed', { id: 'in_f', object: 'invoice', subscription: sub.id }));
  assert.equal((await billing.membershipBySubscription(sub.id)).paid_from, null);
  sub.status = 'canceled'; sub.ended_at = secs(new Date());
  await applyStripeEvent(event('customer.subscription.deleted', sub));
  const billed = (await billedMemberships()).find((b) => b.householdId === household.id);
  assert.equal(billed.paidFrom, null);
});

test('an annual reminder quotes Stripe’s own amount for the year, not twelve rounded months', async () => {
  const { household } = await aMember();
  const sub = aSub(household.id, { status: 'active', trialEnd: null, amount: 6469, interval: 'year' });
  sub.items.data[0].current_period_end = secs(new Date(Date.now() + 3 * day));
  await applyStripeEvent(event('customer.subscription.created', sub));
  const m = (await billing.claimRemindersDue({ days: 7 })).find((x) => x.stripe_subscription_id === sub.id);
  assert.ok(m);
  assert.equal(m.monthly_pence, 539);
  assert.match(membership.reminderMail(m, 'https://x').text, /£64\.69 for the year/);
});

test('a plan switch never revalues the months already billed; an end on the 1st bills nothing for that month', async () => {
  const { membershipRevenue } = await import('../src/repositories/memberships.js');
  const { household } = await aMember();
  const sub = aSub(household.id, { status: 'active', trialEnd: new Date('2025-01-01T00:00:00Z') });
  await applyStripeEvent(event('customer.subscription.updated', sub));
  // Pretend the switch happened on 1 Mar 2025, after two months at Solo.
  sub.items.data[0].price.unit_amount = 1299; sub.items.data[0].price.metadata.epic_plan = 'pro';
  await applyStripeEvent(event('customer.subscription.updated', sub));
  await query("update memberships set price_history = jsonb_build_array(jsonb_build_object('until', '2025-03-01T00:00:00Z', 'monthlyPence', 599)) where stripe_subscription_id = $1", [sub.id]);
  sub.status = 'canceled'; sub.ended_at = secs(new Date('2025-05-01T00:00:00Z'));
  await applyStripeEvent(event('customer.subscription.deleted', sub));
  // Jan, Feb at 599; Mar, Apr at 1299; May not at all. Nothing else in this file is dated 2025.
  assert.equal((await membershipRevenue('2025-01-01', '2025-07-01')).pence, 2 * 599 + 2 * 1299);
});

test('a press that outlived its slot writes nothing over the press after it', async () => {
  const { household } = await aMember();
  const first = await billing.claimCheckout(household.id);
  await query("update households set membership_checkout_at = now() - interval '3 minutes' where id = $1", [household.id]);
  const aged = (await query('select membership_checkout_at::text as t from households where id = $1', [household.id])).rows[0].t;
  const second = await billing.claimCheckout(household.id);
  assert.ok(second.claimed);
  assert.equal(await billing.recordCheckout(household.id, 'cs_late', aged), false);
  assert.equal(await billing.recordCheckout(household.id, 'cs_new', second.lease), true);
  await billing.releaseCheckout(household.id, aged);
  assert.equal((await query('select membership_checkout_id, membership_checkout_at is not null as held from households where id = $1', [household.id])).rows[0].held, true);
  assert.ok(first.claimed);
});

test('a duplicate marked on a failed try is still cancelled when Stripe retries the event', async () => {
  const { household } = await aMember();
  await applyStripeEvent(event('customer.subscription.created', aSub(household.id)));
  const second = aSub(household.id);
  // Marked by an earlier try that then failed: still running at Stripe.
  second.metadata.epic_duplicate = 'true';
  calls.length = 0;
  await applyStripeEvent(event('customer.subscription.created', second));
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.url.startsWith(`/v1/subscriptions/${second.id}`)), 'the cancel resumed');
  assert.equal(calls.some((c) => c.method === 'POST' && c.url === `/v1/subscriptions/${second.id}`), false, 'not marked twice');
  assert.equal(await billing.membershipBySubscription(second.id), null);
});

test('the membership bought decides how many people a household can hold', async () => {
  const { planCapFor } = await import('../src/repositories/households.js');
  const { household } = await aMember();
  const sub = aSub(household.id, { plan: 'solo' });
  await applyStripeEvent(event('customer.subscription.created', sub));
  assert.equal((await planCapFor(household.id)).cap, 1);
  sub.items.data[0].price.metadata.epic_plan = 'household';
  await applyStripeEvent(event('customer.subscription.updated', sub));
  assert.ok((await planCapFor(household.id)).cap > 1);
});

test('a renewal that fails and never recovers stops the paid months where payment stopped', async () => {
  const { membershipRevenue } = await import('../src/repositories/memberships.js');
  const { household } = await aMember();
  const sub = aSub(household.id, { status: 'active', trialEnd: new Date('2024-01-01T00:00:00Z') });
  await applyStripeEvent(event('customer.subscription.updated', sub));
  sub.status = 'past_due';
  await applyStripeEvent(event('invoice.payment_failed', { id: 'in_r', object: 'invoice', subscription: sub.id }));
  // The pause began on 1 Mar 2024 (set by hand: the test runs today); then cancelled on 1 Jun.
  await query("update memberships set paused_at = '2024-03-01T00:00:00Z' where stripe_subscription_id = $1", [sub.id]);
  sub.status = 'canceled'; sub.ended_at = secs(new Date('2024-06-01T00:00:00Z'));
  await applyStripeEvent(event('customer.subscription.deleted', sub));
  // January and February paid; March to May never collected. Nothing else in this file is dated 2024.
  assert.equal((await membershipRevenue('2024-01-01', '2024-07-01')).pence, 2 * 599);
});

test('a Checkout whose answer was lost is closed before another opens', async () => {
  const { account } = await aMember();
  const srv = await server(account);
  try {
    // The lost one on the second page.
    openSessions = [{ id: 'cs_other', metadata: { epic_kind: 'pro' } }, { id: 'cs_lost', metadata: { epic_kind: 'membership' } }];
    calls.length = 0;
    assert.equal((await srv.send('POST', '/api/membership/checkout', { plan: 'solo' })).status, 200);
    assert.ok(calls.some((c) => c.url === '/v1/checkout/sessions/cs_lost/expire'));
    assert.equal(calls.some((c) => c.url === '/v1/checkout/sessions/cs_other/expire'), false, 'not somebody else’s kind');
  } finally { openSessions = []; await srv.close(); }
});

test('a first payment given up on is no membership; a pause and a price change are dated by Stripe', async () => {
  const { membershipFromSubscription } = await import('../src/sources/stripe.js');
  assert.equal(membershipFromSubscription({ status: 'incomplete_expired' }).status, null);
  const { household } = await aMember();
  const sub = aSub(household.id, { status: 'active', trialEnd: new Date('2023-01-01T00:00:00Z') });
  await applyStripeEvent({ ...event('customer.subscription.updated', sub), created: secs(new Date('2023-02-01T00:00:00Z')) });
  // A price change Stripe made on 10 Mar, heard of on a later day.
  sub.items.data[0].price.unit_amount = 1299; sub.items.data[0].price.metadata.epic_plan = 'pro';
  await applyStripeEvent({ ...event('customer.subscription.updated', sub), created: secs(new Date('2023-03-10T00:00:00Z')) });
  // The renewal for the period from 1 Apr fails; the event arrives days later.
  sub.status = 'past_due';
  sub.items.data[0].current_period_start = secs(new Date('2023-04-01T00:00:00Z'));
  await applyStripeEvent({ ...event('invoice.payment_failed', { id: 'in_d', object: 'invoice', subscription: sub.id, billing_reason: 'subscription_cycle' }), created: secs(new Date('2023-04-01T00:00:00Z')) });
  const m = await billing.membershipBySubscription(sub.id);
  assert.equal(new Date(m.paused_at).toISOString(), '2023-04-01T00:00:00.000Z');
  assert.equal(m.price_history[0].until.slice(0, 10), '2023-03-10');
});

test('a late event never dates a price change it did not show', async () => {
  const { household } = await aMember();
  const sub = aSub(household.id, { status: 'active', trialEnd: new Date('2022-01-01T00:00:00Z') });
  await applyStripeEvent(event('customer.subscription.updated', sub));
  // Stripe now has Pro; an old February event (showing Solo) arrives late.
  const februarySnapshot = JSON.parse(JSON.stringify(sub));
  sub.items.data[0].price = { ...sub.items.data[0].price, id: 'price_pro_1299', unit_amount: 1299, metadata: { epic_plan: 'pro' } };
  await applyStripeEvent({ ...event('customer.subscription.updated', februarySnapshot), created: secs(new Date('2022-02-01T00:00:00Z')) });
  const m = await billing.membershipBySubscription(sub.id);
  assert.equal(m.plan_key, 'pro');
  assert.notEqual(m.price_history[0].until.slice(0, 7), '2022-02', 'not dated by an event that showed the old price');
});

test('a stale event never dates a change before one already recorded; a mid-cycle failure is not dated from the cycle', async () => {
  const { household } = await aMember();
  const sub = aSub(household.id, { status: 'active', trialEnd: new Date('2021-01-01T00:00:00Z') });
  await applyStripeEvent(event('customer.subscription.updated', sub));
  const solo = JSON.parse(JSON.stringify(sub.items.data[0].price));
  sub.items.data[0].price = { ...solo, id: 'price_pro_1299', unit_amount: 1299, metadata: { epic_plan: 'pro' } };
  await applyStripeEvent({ ...event('customer.subscription.updated', sub), created: secs(new Date('2021-05-01T00:00:00Z')) });
  // Back to Solo; a stale January event that also shows Solo arrives now.
  sub.items.data[0].price = solo;
  await applyStripeEvent({ ...event('customer.subscription.updated', JSON.parse(JSON.stringify(sub))), created: secs(new Date('2021-01-15T00:00:00Z')) });
  const m = await billing.membershipBySubscription(sub.id);
  const untils = m.price_history.map((p) => new Date(p.until).getTime());
  assert.deepEqual(untils, [...untils].sort((a, b) => a - b), 'in order');
  assert.ok(untils[1] > new Date('2021-05-01T00:00:00Z').getTime());
  // A proration invoice failing mid-cycle: the pause is not dated from the cycle's start.
  sub.status = 'past_due';
  sub.items.data[0].current_period_start = secs(new Date('2021-01-01T00:00:00Z'));
  await applyStripeEvent(event('invoice.payment_failed', { id: 'in_p', object: 'invoice', subscription: sub.id, billing_reason: 'subscription_update' }));
  assert.ok(new Date((await billing.membershipBySubscription(sub.id)).paused_at).getFullYear() >= 2026);
});
