/**
 * Complaints that end in money and chargebacks Epic answers (sources/bookingMoney.js refundComplaint &c.,
 * sources/disputes.js; migration 378). Stripe is handed in; nothing leaves the machine.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
const { aHousehold, testDatabase } = await import('./helpers/db.js');
const { query, pool } = await testDatabase();
const money = await import('../src/sources/bookingMoney.js');
const disputes = await import('../src/sources/disputes.js');
const settings = await import('../src/repositories/hostingSettings.js');
const admin = await import('../src/routes/hostingAdmin.js');
const { runAsAccount } = await import('../src/context.js');

test.after(async () => { settings.forget(); await pool?.end?.(); });

/** A paid booking of `charged` pence over `sessions` sessions, with a complaint about the first session `hoursAgo` old. */
async function aComplaint({ charged = 4000, sessions = 1, hoursAgo = 50, pi = `pi_${crypto.randomUUID().slice(0, 10)}` } = {}) {
  const { household: hh } = await aHousehold(query);
  const { rows: [host] } = await query(`insert into hosts (household_id, name) values ($1, 'Kate') returning *`, [hh.id]);
  const { rows: [offer] } = await query(`insert into host_offers (host_id, shape, lane, state, title) values ($1, 'oneoff', 'oneoff', 'live', 'Pottery') returning *`, [host.id]);
  const list = [];
  for (let i = 0; i < sessions; i += 1) list.push((await query(`insert into offer_sessions (offer_id, n, on_date, starts_at) values ($1, $2, current_date - 3, '10:00') returning *`, [offer.id, i + 1])).rows[0]);
  const { household: gh } = await aHousehold(query);
  const { rows: [b] } = await query(
    `insert into experience_bookings (offer_id, host_id, household_id, heads, state, payment_state, charged_pence, value_pence, fee_pence, host_pence, stripe_payment_intent, charge_model)
     values ($1, $2, $3, 1, 'attended', 'charged', $4, $4, $5, $6, $7, 'destination') returning *`, [offer.id, host.id, gh.id, charged, Math.round(charged * 0.2), Math.round(charged * 0.8), pi]);
  for (const s of list) await query(`insert into booking_sessions (booking_id, session_id, state) values ($1, $2, 'booked')`, [b.id, s.id]);
  const { rows: [k] } = await query(
    `insert into hosting_complaints (booking_id, session_id, offer_id, host_id, household_id, reason, created_at) values ($1, $2, $3, $4, $5, 'It never started', now() - make_interval(hours => $6)) returning *`,
    [b.id, list[0].id, offer.id, host.id, gh.id, hoursAgo]);
  return { host, offer, booking: b, complaint: k };
}

const lineFor = async (complaintId) => (await query(`select p.amount_pence, p.cause, p.triggered_by, p.state from hosting_payments p join hosting_complaints k on k.refund_line = p.id where k.id = $1`, [complaintId])).rows[0];

test('a complaint refunded: its session’s share through the refund queue, the complaint paid, its payout hold lifted', async () => {
  const { booking, complaint } = await aComplaint({ charged: 6000, sessions: 3 });
  const r = await money.refundComplaint({ complaintId: complaint.id, by: 'staff', why: 'It never started' });
  assert.equal(r.refundPence, 2000, 'one session of three');
  assert.deepEqual(await lineFor(complaint.id), { amount_pence: 2000, cause: 'complaint', triggered_by: 'staff', state: 'pending' });
  const { rows: [k] } = await query('select state, amount_pence, refunded_by from hosting_complaints where id = $1', [complaint.id]);
  assert.deepEqual([k.state, k.amount_pence, k.refunded_by], ['paid', 2000, 'staff']);
  assert.equal((await query('select refunded_pence from experience_bookings where id = $1', [booking.id])).rows[0].refunded_pence, 2000);
  await assert.rejects(() => money.refundComplaint({ complaintId: complaint.id, by: 'staff' }), /settled already/);
});

test('the host offers a refund: paid at once and closed; disputed: it waits for a person', async () => {
  const offered = await aComplaint({ hoursAgo: 2 });
  const r = await money.hostAnswerComplaint({ complaintId: offered.complaint.id, hostId: offered.host.id, offerPence: 1500 });
  assert.equal(r.refundPence, 1500);
  assert.equal((await lineFor(offered.complaint.id)).triggered_by, 'host');
  const disputed = await aComplaint({ hoursAgo: 2 });
  await money.hostAnswerComplaint({ complaintId: disputed.complaint.id, hostId: disputed.host.id, dispute: true });
  assert.equal((await query('select state, host_disputes from hosting_complaints where id = $1', [disputed.complaint.id])).rows[0].host_disputes, true);
  await assert.rejects(() => money.hostAnswerComplaint({ complaintId: disputed.complaint.id, hostId: crypto.randomUUID(), offerPence: 100 }), /isn’t open/);
});

test('48 hours unanswered and within £50: refunded automatically; over the limit, too soon or disputed: left for a person', async () => {
  settings.forget();
  const within = await aComplaint({ charged: 4000, hoursAgo: 49 });
  const over = await aComplaint({ charged: 9000, hoursAgo: 49 });
  const soon = await aComplaint({ charged: 1000, hoursAgo: 10 });
  const out = await money.autoRefundComplaints();
  assert.ok(out.refunded >= 1 && out.overLimit >= 1);
  assert.equal((await lineFor(within.complaint.id)).triggered_by, 'epic');
  for (const x of [over, soon]) assert.equal((await query('select state from hosting_complaints where id = $1', [x.complaint.id])).rows[0].state, 'open');
});

test('a chargeback’s evidence is sent automatically two days before the deadline — once, from Epic’s own records', async () => {
  const { booking } = await aComplaint();
  const due = new Date(Date.now() + 10 * 86_400_000);
  await disputes.applyDispute({ id: 'dp_test_1', amount: 4000, payment_intent: booking.stripe_payment_intent, status: 'needs_response', reason: 'product_not_received', evidence_details: { due_by: Math.floor(due.getTime() / 1000) } });
  const sent = [];
  const submit = async (id, evidence, o) => { sent.push({ id, evidence, o }); return { id }; };
  const status = () => ({ ready: true });
  assert.equal((await disputes.sendDueEvidence({ status, submit })).sent, 0, 'ten days out: not yet');
  const out = await disputes.sendDueEvidence({ now: new Date(due.getTime() - 2 * 86_400_000 + 1000), status, submit });
  assert.equal(out.sent, 1);
  assert.equal(sent[0].id, 'dp_test_1');
  assert.match(sent[0].evidence.product_description, /Pottery with Kate/);
  assert.match(sent[0].evidence.access_activity_log, /Sessions booked/);
  assert.equal(sent[0].o.submit, true);
  const { rows: [cb] } = await query('select evidence_sent_by, booking_id from chargebacks where id = $1', ['dp_test_1']);
  assert.deepEqual([cb.evidence_sent_by, cb.booking_id], ['epic', booking.id]);
  assert.equal((await disputes.sendDueEvidence({ now: new Date(due.getTime()), status, submit })).sent, 0, 'once');
  assert.equal(await disputes.acceptChargeback('dp_test_1', { by: 'x', accept: async () => ({}) }), null, 'answered: no accepting it now');
  assert.equal((await query(`select stage from payment_problems where dedupe_key = 'chargeback:dp_test_1'`)).rows[0].stage, 'evidence_sent');
});

test('sending evidence, accepting a chargeback or refunding a complaint from the back office needs a person signed in', async () => {
  const STAFF = { doors: ['admin'], capabilities: new Set(['view_hosting', 'manage_hosting']), isOwner: false, role: null, elevated: false };
  const { household, member } = await aHousehold(query);
  const { rows: [account] } = await query("insert into accounts (household_id, member_id, email, role, status, name) values ($1,$2,$3,'customer','active','Staff') returning *", [household.id, member.id, `s-${crypto.randomUUID().slice(0, 8)}@example.com`]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.access = STAFF; runAsAccount(account, next); });
  app.use('/api/admin/hosting', admin.default);
  const s = app.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  try {
    for (const p of ['/chargebacks/dp_test_1/evidence', '/chargebacks/dp_test_1/accept', `/complaints/${crypto.randomUUID()}/refund`]) {
      const r = await fetch(`${base}/api/admin/hosting${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"why":"x"}' });
      assert.equal(r.status, 403, p);
      assert.equal((await r.json()).error, 'needs_personal_sign_in');
    }
    const list = await (await fetch(`${base}/api/admin/hosting/chargebacks`)).json();
    assert.ok(list.chargebacks.some((c) => c.id === 'dp_test_1'));
  } finally { await new Promise((r) => s.close(r)); }
});

test('a session complaint after an earlier refund refunds a share of what is left, not of the first charge', async () => {
  const { booking, complaint } = await aComplaint({ charged: 6000, sessions: 3 });
  // One session already refunded (£20) and given back: two sessions and £40 left.
  await query(`update experience_bookings set refunded_pence = 2000 where id = $1`, [booking.id]);
  await query(`update booking_sessions set state = 'cancelled' where booking_id = $1 and session_id <> $2 and session_id = (select session_id from booking_sessions where booking_id = $1 and session_id <> $2 limit 1)`, [booking.id, complaint.session_id]);
  const r = await money.refundComplaint({ complaintId: complaint.id, by: 'staff' });
  assert.equal(r.refundPence, 2000, '£40 left over two sessions');
});

test('the evidence job looks only at chargebacks in the mode Stripe is in', async () => {
  await query(`insert into chargebacks (id, status, due_by, mode) values ('dp_live_x', 'needs_response', now() + interval '1 day', 'live')`);
  const sent = [];
  await disputes.sendDueEvidence({ status: () => ({ ready: true, mode: 'test' }), submit: async (id) => { sent.push(id); return {}; } });
  assert.equal(sent.includes('dp_live_x'), false);
});
