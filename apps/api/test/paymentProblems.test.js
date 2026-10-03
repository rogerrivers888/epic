/**
 * The payment problems log (repositories/paymentProblems.js, migration 374): written as things go wrong, one row a
 * problem however often it is seen, closed by Epic's jobs when Stripe puts it right or by a person with a sentence.
 * Stripe is never called; its events are handed in.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
const { aHousehold, testDatabase } = await import('./helpers/db.js');
const { query, pool } = await testDatabase();
const problems = await import('../src/repositories/paymentProblems.js');
const admin = await import('../src/routes/hostingAdmin.js');
const { runAsAccount } = await import('../src/context.js');

test.after(async () => { await pool?.end?.(); });

const STAFF = { doors: ['admin'], capabilities: new Set(['view_hosting', 'manage_hosting']), isOwner: false, role: null, elevated: false };

async function server(access = STAFF) {
  const { household, member } = await aHousehold(query);
  const { rows: [account] } = await query("insert into accounts (household_id, member_id, email, role, status, name) values ($1,$2,$3,'customer','active','Staff') returning *", [household.id, member.id, `s-${crypto.randomUUID().slice(0, 8)}@example.com`]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.access = access; runAsAccount(account, next); });
  app.use('/api/admin/hosting', admin.default);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.code ?? 'x', message: err.message }));
  const s = app.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  const out = (r) => r.json().then((body) => ({ status: r.status, body }));
  return { account, close: () => new Promise((r) => s.close(r)), get: (p) => fetch(base + p).then(out), send: (m, p, b) => fetch(base + p, { method: m, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b ?? {}) }).then(out) };
}

/** A paid, destination-charged booking with its host and event. */
async function aBooking({ pi = `pi_${crypto.randomUUID().slice(0, 10)}`, paymentState = 'charged' } = {}) {
  const { household: hh } = await aHousehold(query);
  const { rows: [host] } = await query(`insert into hosts (household_id, name) values ($1, 'Kate') returning *`, [hh.id]);
  const { rows: [offer] } = await query(`insert into host_offers (host_id, shape, lane, state, title) values ($1, 'oneoff', 'oneoff', 'live', 'Pottery') returning *`, [host.id]);
  const { household: gh } = await aHousehold(query);
  const { rows: [b] } = await query(
    `insert into experience_bookings (offer_id, host_id, household_id, heads, state, payment_state, charged_pence, held_pence, value_pence, stripe_payment_intent, charge_model)
     values ($1, $2, $3, 1, 'confirmed', $4, 4000, 4000, 4000, $5, 'destination') returning *`, [offer.id, host.id, gh.id, paymentState, pi]);
  return { host, offer, booking: b, guest: gh };
}

test('one row a problem however often it is seen; a resolved one opens again only when asked', async () => {
  const key = `t:${crypto.randomUUID()}`;
  const a = await problems.record({ kind: 'payout_failed', dedupeKey: key, amountPence: 100, detail: { first: true } });
  const b = await problems.record({ kind: 'payout_failed', dedupeKey: key, amountPence: 150, stage: 'bounced', detail: { second: true } });
  assert.equal(a.id, b.id);
  assert.deepEqual([b.amount_pence, b.stage, b.detail], [150, 'bounced', { first: true, second: true }]);
  const r = await problems.resolve({ dedupeKey: key, resolution: 'Paid on a later try', by: 'epic' });
  assert.deepEqual([r.status, r.resolved_by], ['resolved', 'epic']);
  assert.equal(await problems.resolve({ dedupeKey: key, resolution: 'again', by: 'epic' }), null, 'only open ones');
  assert.equal((await problems.record({ kind: 'payout_failed', dedupeKey: key })).status, 'resolved', 'seen again, still resolved');
  assert.equal((await problems.record({ kind: 'payout_failed', dedupeKey: key, reopen: true })).status, 'open', 'reopened when it happens again');
  assert.equal(await problems.record({ kind: 'not_a_kind', dedupeKey: 'x' }), null, 'an unknown kind is never written');
});

test('the summary covers all thirteen kinds in five groups; a kind with nothing in either window has no trend', async () => {
  const groups = await problems.summary();
  assert.deepEqual(groups.map((g) => g.group), ['guest_payments', 'memberships', 'fraud', 'host_money', 'our_records']);
  assert.equal(groups.flatMap((g) => g.kinds).length, 13);
  const quiet = groups.flatMap((g) => g.kinds).find((k) => k.kind === 'near_90_day_limit');
  assert.equal(quiet.trend, null);
});

test('the back office lists, filters and resolves — a resolution needs a sentence', async () => {
  const { booking, host, offer } = await aBooking();
  const p = await problems.record({ kind: 'refund_failed', dedupeKey: `t:${booking.id}`, amountPence: 4000, bookingId: booking.id, householdId: booking.household_id, hostId: host.id, offerId: offer.id });
  const srv = await server();
  try {
    const list = await srv.get(`/api/admin/hosting/payment-problems?booking=${booking.id}`);
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.deepEqual(list.body.problems.map((x) => [x.kind, x.words, x.group, x.offerTitle, x.hostName, x.status]), [['refund_failed', 'Refund failed', 'guest_payments', 'Pottery', 'Kate', 'open']]);
    assert.equal((await srv.get('/api/admin/hosting/payment-problems/summary')).body.groups.length, 5);
    assert.equal((await srv.send('POST', `/api/admin/hosting/payment-problems/${p.id}/resolve`, {})).status, 400);
    const done = await srv.send('POST', `/api/admin/hosting/payment-problems/${p.id}/resolve`, { resolution: 'Refunded by hand in Stripe' });
    assert.deepEqual([done.status, done.body.problem.status, done.body.problem.resolution, done.body.problem.resolvedBy], [200, 'resolved', 'Refunded by hand in Stripe', srv.account.email]);
    assert.equal((await srv.send('POST', `/api/admin/hosting/payment-problems/${p.id}/resolve`, { resolution: 'x' })).status, 404);
  } finally { await srv.close(); }
  const viewer = await server({ ...STAFF, capabilities: new Set(['view_hosting']) });
  try { assert.equal((await viewer.send('POST', `/api/admin/hosting/payment-problems/${p.id}/resolve`, { resolution: 'x' })).status, 403); } finally { await viewer.close(); }
});

test('a chargeback is one row through its stages, closed when the bank decides', async () => {
  const { booking } = await aBooking();
  const { applyStripeEvent } = await import('../src/routes/hostLanes.js');
  const dispute = (status) => ({ id: 'dp_1', object: 'dispute', amount: 4000, payment_intent: booking.stripe_payment_intent, status, reason: 'fraudulent', evidence_details: { due_by: 1_800_000_000 } });
  await applyStripeEvent({ id: 'evt_d1', type: 'charge.dispute.created', data: { object: dispute('needs_response') } });
  await applyStripeEvent({ id: 'evt_d2', type: 'charge.dispute.updated', data: { object: dispute('under_review') } });
  let [row] = (await query(`select * from payment_problems where dedupe_key = 'chargeback:dp_1'`)).rows;
  assert.deepEqual([row.stage, row.status, row.booking_id, row.detail.reason], ['under_review', 'open', booking.id, 'fraudulent']);
  assert.match(row.detail.dueBy, /^2027-01-15/);
  assert.equal((await query('select dispute_state from experience_bookings where id = $1', [booking.id])).rows[0].dispute_state, 'open');
  await applyStripeEvent({ id: 'evt_d3', type: 'charge.dispute.closed', data: { object: dispute('won') } });
  [row] = (await query(`select * from payment_problems where dedupe_key = 'chargeback:dp_1'`)).rows;
  assert.deepEqual([row.stage, row.status, row.resolved_by], ['won', 'resolved', 'stripe']);
});

test('an early fraud warning, a payment blocked as fraud and a hold Stripe let go are each in the log', async () => {
  const { booking } = await aBooking();
  const { applyStripeEvent } = await import('../src/routes/hostLanes.js');
  await applyStripeEvent({ id: 'evt_f', type: 'radar.early_fraud_warning.created', data: { object: { id: 'issfr_1', payment_intent: booking.stripe_payment_intent, fraud_type: 'stolen_card', actionable: true } } });
  assert.deepEqual((await query(`select kind, booking_id from payment_problems where dedupe_key = 'efw:issfr_1'`)).rows.map((x) => [x.kind, x.booking_id]), [['early_fraud_warning', booking.id]]);

  const { applyPaymentIntent } = await import('../src/routes/guestBookings.js');
  const blocked = await aBooking({ paymentState: 'none' });
  await applyPaymentIntent({ id: blocked.booking.stripe_payment_intent, status: 'requires_payment_method', amount: 4000, metadata: { epic_booking_id: blocked.booking.id }, last_payment_error: { code: 'card_declined', decline_code: 'fraudulent' } });
  assert.equal((await query(`select kind from payment_problems where booking_id = $1`, [blocked.booking.id])).rows[0].kind, 'blocked_fraud');
  const declined = await aBooking({ paymentState: 'none' });
  await applyPaymentIntent({ id: declined.booking.stripe_payment_intent, status: 'requires_payment_method', amount: 4000, metadata: { epic_booking_id: declined.booking.id }, last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds' } });
  const [failed] = (await query(`select kind, detail from payment_problems where booking_id = $1`, [declined.booking.id])).rows;
  assert.deepEqual([failed.kind, failed.detail.declineCode], ['payment_failed', 'insufficient_funds']);

  const held = await aBooking({ paymentState: 'held' });
  await applyPaymentIntent({ id: held.booking.stripe_payment_intent, status: 'canceled', cancellation_reason: 'automatic', amount: 4000, metadata: { epic_booking_id: held.booking.id } });
  assert.equal((await query(`select kind from payment_problems where booking_id = $1`, [held.booking.id])).rows[0].kind, 'hold_expired');
});

test('a reconciliation row that doesn’t match Stripe is a problem until it does', async () => {
  const { booking, host, offer } = await aBooking();
  const { rows: [line] } = await query(
    `insert into hosting_payments (kind, booking_id, offer_id, host_id, household_id, amount_pence, state, stripe_ref, mode) values ('charge', $1, $2, $3, $4, 4000, 'succeeded', $5, 'test') returning *`,
    [booking.id, offer.id, host.id, booking.household_id, `pi_rec_${booking.id.slice(0, 8)}`]);
  const money = await import('../src/sources/hostingMoney.js');
  const status = () => ({ ready: true });
  // Stripe says it was never paid: a mismatch, in the log.
  await money.reconcile({ status, read: async (ref) => (ref === line.stripe_ref ? { object: 'payment_intent', id: ref, status: 'requires_payment_method', amount: 4000 } : null) });
  let [row] = (await query(`select status, booking_id from payment_problems where dedupe_key = $1`, [`reconcile:${line.id}`])).rows;
  assert.deepEqual([row.status, row.booking_id], ['open', booking.id]);
  // Stripe agrees now: closed by the job.
  await money.reconcile({ status, read: async (ref) => (ref === line.stripe_ref ? { object: 'payment_intent', id: ref, status: 'succeeded', amount: 4000, amount_received: 4000 } : null) });
  [row] = (await query(`select status, resolved_by from payment_problems where dedupe_key = $1`, [`reconcile:${line.id}`])).rows;
  assert.deepEqual([row.status, row.resolved_by], ['resolved', 'epic']);
});

test('within ten days of the 90-day limit: a problem and one e-mail to the owner; paid out, put right', async () => {
  const { booking, host, offer } = await aBooking();
  const { rows: [s] } = await query(`insert into offer_sessions (offer_id, n, on_date, starts_at) values ($1, 1, current_date - 2, '10:00') returning *`, [offer.id]);
  await query(`insert into booking_sessions (booking_id, session_id) values ($1, $2)`, [booking.id, s.id]);
  await query(`update experience_bookings set host_pence = 3200 where id = $1`, [booking.id]);
  await query(`insert into hosting_payments (kind, booking_id, offer_id, host_id, household_id, amount_pence, state, stripe_ref, mode, created_at)
               values ('charge', $1, $2, $3, $4, 4000, 'succeeded', $5, 'test', now() - interval '85 days')`, [booking.id, offer.id, host.id, booking.household_id, `pi_old_${booking.id.slice(0, 8)}`]);
  const money = await import('../src/sources/hostingMoney.js');
  const sent = [];
  const send = async (m) => { sent.push(m); return { sent: true }; };
  await money.watchNinetyDays({ send });
  await money.watchNinetyDays({ send });
  const [p] = (await query(`select status, amount_pence from payment_problems where dedupe_key = $1`, [`near_90:${booking.id}`])).rows;
  assert.deepEqual([p.status, p.amount_pence], ['open', 3200]);
  assert.equal(sent.filter((m) => m.text.includes('Pottery')).length, 1, 'one e-mail, however often it runs');
  assert.match(sent[0].subject, /90-day limit/);
  await query(`insert into host_payouts (host_id, offer_id, session_id, amount_pence, state, release_at) values ($1, $2, $3, 3200, 'paid', now())`, [host.id, offer.id, s.id]);
  await money.watchNinetyDays({ send });
  assert.equal((await query(`select status from payment_problems where dedupe_key = $1`, [`near_90:${booking.id}`])).rows[0].status, 'resolved');
});
