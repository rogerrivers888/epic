/**
 * Hosting v4, phase 1 against the database (migration 366): the settings and
 * their change log, the owner-only door in front of a change, notifications,
 * payouts and the Stripe reconciliation. Stripe is a function handed in; no
 * request leaves the machine and nothing is spent.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';

const { aHousehold, testDatabase } = await import('./helpers/db.js');
const { query, pool } = await testDatabase();
const settings = await import('../src/repositories/hostingSettings.js');
const notifications = await import('../src/repositories/notifications.js');
const ledger = await import('../src/repositories/hostingLedger.js');
const money = await import('../src/sources/hostingMoney.js');
const routes = await import('../src/routes/hostingMoney.js');
const { runAsAccount } = await import('../src/context.js');
const { hostingConfig } = await import('../src/domain/lanes.js');

test.after(async () => { settings.forget(); await pool?.end?.(); });

async function anAccount(h, member) {
  const { rows: [a] } = await query(
    "insert into accounts (household_id, member_id, email, role, status, name) values ($1,$2,$3,'customer','active','Maya') returning *",
    [h.id, member.id, `m-${crypto.randomUUID().slice(0, 8)}@example.com`],
  );
  return a;
}

async function server(account, access) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.access = access; runAsAccount(account, next); });
  app.use('/api/admin/hosting', routes.adminRouter);
  app.use('/api', routes.default);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.message }));
  const s = app.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  const out = (r) => r.json().catch(() => null).then((body) => ({ status: r.status, body }));
  return {
    close: () => new Promise((r) => s.close(r)),
    get: (p) => fetch(base + p).then(out),
    send: (method, p, body) => fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then(out),
  };
}

const STAFF = { doors: ['admin'], capabilities: new Set(['view_hosting', 'manage_hosting']), isOwner: false, role: null, elevated: false };
const OWNER = { ...STAFF, isOwner: true, elevated: true };

test('the settings are seeded from the handover, and the rules read them', async () => {
  settings.forget();
  const m = await settings.current({ fresh: true });
  assert.equal(m.private_event_fee, 1000);
  assert.equal(m.pro_monthly, 1299, 'Pro is £12.99');
  assert.equal(m.payout_release, 72, '72 hours, not 48');
  assert.deepEqual(m.public_commission.map((s) => s.pct), [20, 15, 10]);
  assert.equal(m.guarantee_pool, null, 'the owner’s to set');
  assert.equal(hostingConfig({}).proMonthlyPence, 1299, 'the lanes read the same table');
});

test('only the owner, personally signed in, changes a setting; every change is logged with why', async () => {
  const { household: h, member } = await aHousehold(query);
  const account = await anAccount(h, member);
  const staff = await server(account, STAFF);
  const owner = await server(account, OWNER);
  try {
    const list = await staff.get('/api/admin/hosting/settings');
    assert.equal(list.status, 200);
    const min = list.body.settings.find((s) => s.key === 'minimum_fee');
    assert.deepEqual([min.words, min.switchable], ['£1.50', true]);
    assert.equal(list.body.settings.find((s) => s.key === 'dbs_age').words, '—');

    const refused = await staff.send('PUT', '/api/admin/hosting/settings/minimum_fee', { value: 200, why: 'test' });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error, 'needs_personal_sign_in', 'an agent or staff session is told to file it for approval');

    assert.equal((await owner.send('PUT', '/api/admin/hosting/settings/minimum_fee', { value: 200 })).status, 400, 'a change needs a reason');
    assert.equal((await owner.send('PUT', '/api/admin/hosting/settings/minimum_fee', { value: 'two pounds', why: 'x' })).status, 400);
    assert.equal((await owner.send('PUT', '/api/admin/hosting/settings/payout_release', { isOn: false, why: 'x' })).status, 400, 'payout release has no switch');
    assert.equal((await owner.send('PUT', '/api/admin/hosting/settings/nothing_here', { value: 1, why: 'x' })).status, 404);

    const ok = await owner.send('PUT', '/api/admin/hosting/settings/minimum_fee', { value: 200, why: 'Card costs went up' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.setting.words, '£2.00');
    assert.equal((await settings.current()).minimum_fee, 200, 'read at once, no restart');
    assert.equal((await owner.send('PUT', '/api/admin/hosting/settings/minimum_fee', { value: 200, why: 'again' })).status, 409);

    const changes = await staff.get('/api/admin/hosting/changes?kind=setting&subject=minimum_fee');
    assert.equal(changes.body.changes.length, 1);
    const c = changes.body.changes[0];
    assert.deepEqual([c.before.value, c.after.value, c.why, c.by], [150, 200, 'Card costs went up', account.email]);

    await owner.send('PUT', '/api/admin/hosting/settings/minimum_fee', { isOn: false, why: 'Trying without' });
    assert.equal((await settings.current()).minimum_fee, null, 'off reads as nothing');
    await owner.send('PUT', '/api/admin/hosting/settings/minimum_fee', { value: 150, isOn: true, why: 'Back' });
  } finally { await staff.close(); await owner.close(); }
});

test('a notification is written once however often a job runs, and the household reads and clears its own', async () => {
  const { household: h, member } = await aHousehold(query);
  const other = await aHousehold(query);
  const account = await anAccount(h, member);
  const first = await notifications.notify({ householdId: h.id, kind: 'booking_confirmed', title: 'You’re booked', link: '/trips', dedupeKey: `t:${h.id}:1` });
  assert.ok(first);
  assert.equal(await notifications.notify({ householdId: h.id, kind: 'booking_confirmed', title: 'You’re booked', link: '/trips', dedupeKey: `t:${h.id}:1` }), null);
  await notifications.notify({ householdId: other.household.id, kind: 'new_booking', title: 'Not yours' });
  await assert.rejects(() => notifications.notify({ householdId: h.id, kind: 'made_up', title: 'x' }));
  await assert.rejects(() => notifications.notify({ householdId: h.id, kind: 'new_tip', title: 'x', link: 'https://evil.example' }), /app path/);
  const srv = await server(account, { doors: ['client'], capabilities: new Set(), isOwner: false, elevated: false });
  try {
    const mine = await srv.get('/api/notifications');
    assert.deepEqual([mine.body.notifications.length, mine.body.unread], [1, 1]);
    assert.equal(mine.body.notifications[0].link, '/trips');
    assert.equal((await srv.send('POST', '/api/notifications/read', { id: 'not-a-uuid' })).status, 400);
    await srv.send('POST', '/api/notifications/read', {});
    assert.equal((await srv.get('/api/notifications')).body.unread, 0);
  } finally { await srv.close(); }

  // E-mail: claimed before it is sent, so a second drain sends nothing.
  const sent = [];
  const send = async (m) => { sent.push(m); return { sent: true }; };
  const r1 = await notifications.drainEmail({ send, configured: () => true });
  const r2 = await notifications.drainEmail({ send, configured: () => true });
  assert.ok(r1.sent >= 1);
  assert.equal(r2.sent, 0);
  assert.ok(sent.some((m) => m.to === account.email && m.text.endsWith('/trips')));
});

async function aPaidSession({ endedHoursAgo = 2, tax = 'QQ123456C', ready = true, sessionsInBooking = 1 } = {}) {
  const { household: h } = await aHousehold(query);
  const { household: guest } = await aHousehold(query);
  const { rows: [host] } = await query(
    `insert into hosts (household_id, name, tax_reference, stripe_account_id, payouts_state) values ($1, 'Tom', $2, $3, $4) returning *`,
    [h.id, tax, ready ? 'acct_test_9' : null, ready ? 'ready' : 'none'],
  );
  const { rows: [offer] } = await query(`insert into host_offers (host_id, shape, lane, state, title) values ($1, 'series', 'course', 'live', 'Swim') returning *`, [host.id]);
  const ended = new Date(Date.now() - endedHoursAgo * 3_600_000);
  const london = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d).replace(',', '');
  const [day, time] = london(ended).split(' ');
  const sessions = [];
  for (let i = 0; i < sessionsInBooking; i += 1) {
    const { rows: [s] } = await query(`insert into offer_sessions (offer_id, n, on_date, starts_at, ends_at) values ($1, $2, $3, '00:00', $4) returning *`, [offer.id, i + 1, day, time]);
    sessions.push(s);
  }
  const { rows: [b] } = await query(
    `insert into experience_bookings (offer_id, host_id, household_id, payment_state, charged_pence, host_pence, fee_pence, value_pence)
     values ($1, $2, $3, 'charged', 10000, 8000, 2000, 10000) returning *`,
    [offer.id, host.id, guest.id],
  );
  for (const s of sessions) await query(`insert into booking_sessions (booking_id, session_id) values ($1, $2)`, [b.id, s.id]);
  return { host, offer, sessions, booking: b, guest };
}

test('a payout is made once per session, released 72 hours on, and never twice', async () => {
  settings.forget();
  const { host, sessions: [s], booking } = await aPaidSession({ endedHoursAgo: 2 });
  await money.schedulePayouts();
  await money.schedulePayouts();
  const { rows: payouts } = await query('select * from host_payouts where session_id = $1', [s.id]);
  assert.equal(payouts.length, 1, 'one row a session, however often the job runs');
  assert.equal(payouts[0].amount_pence, 8000);
  const transfers = [];
  const transfer = async (t) => { transfers.push(t); return { id: `tr_${transfers.length}` }; };
  const status = () => ({ ready: true, mode: 'test' });
  await money.releasePayouts({ transfer, status });
  assert.equal(transfers.length, 0, 'two hours after: waiting');

  // A guest says it happened: released early (the setting is on).
  await query(`update experience_bookings set confirmed_happened = 'yes' where id = $1`, [booking.id]);
  await money.releasePayouts({ transfer, status });
  await money.releasePayouts({ transfer, status });
  assert.equal(transfers.length, 1, 'once');
  assert.deepEqual([transfers[0].amountPence, transfers[0].destination, transfers[0].idempotencyKey], [8000, 'acct_test_9', `payout-${payouts[0].id}`]);
  const { rows: [paid] } = await query('select * from host_payouts where id = $1', [payouts[0].id]);
  assert.deepEqual([paid.state, paid.released_by, paid.stripe_transfer], ['paid', 'guest_confirmed', 'tr_1']);
  const { rows: [row] } = await query(`select * from hosting_payments where kind = 'payout' and stripe_ref = 'tr_1'`);
  assert.equal(row.host_id, host.id);
  const { rows: told } = await query(`select * from notifications where household_id = $1 and kind = 'payout_sent'`, [host.household_id]);
  assert.equal(told.length, 1);
});

test('a complaint, missing tax or an unfinished Stripe account holds a payout, and the host is told once', async () => {
  settings.forget();
  const transfers = [];
  const transfer = async (t) => { transfers.push(t); return { id: `tr_x${transfers.length}` }; };
  const status = () => ({ ready: true, mode: 'test' });
  const a = await aPaidSession({ endedHoursAgo: 100 });
  await query(`insert into hosting_complaints (session_id, booking_id, host_id, reason) values ($1, $2, $3, 'It never started')`, [a.sessions[0].id, a.booking.id, a.host.id]);
  const b = await aPaidSession({ endedHoursAgo: 100, tax: null });
  const c = await aPaidSession({ endedHoursAgo: 100, ready: false });
  await money.schedulePayouts();
  await money.releasePayouts({ transfer, status });
  await money.releasePayouts({ transfer, status });
  const held = async (x) => (await query('select state, hold_reason from host_payouts where session_id = $1', [x.sessions[0].id])).rows[0];
  assert.deepEqual(await held(a), { state: 'held', hold_reason: 'complaint' });
  assert.deepEqual(await held(b), { state: 'held', hold_reason: 'tax_details' });
  assert.deepEqual(await held(c), { state: 'held', hold_reason: 'stripe_incomplete' });
  assert.equal(transfers.filter((t) => [a, b, c].some((x) => x.host.id === t.hostId)).length, 0);
  const { rows: [{ n }] } = await query(`select count(*)::int as n from notifications where household_id = $1 and kind = 'payout_held'`, [a.host.household_id]);
  assert.equal(n, 1, 'told once, not every ten minutes');

  // Resolved: it goes.
  await query(`update hosting_complaints set state = 'resolved' where session_id = $1`, [a.sessions[0].id]);
  await money.releasePayouts({ transfer, status });
  assert.equal((await held(a)).state, 'paid');

  // Stripe not ready (a live key, or none): nothing moves at all.
  const d = await aPaidSession({ endedHoursAgo: 100 });
  await money.schedulePayouts();
  const r = await money.releasePayouts({ transfer, status: () => ({ ready: false }) });
  assert.equal(r.skipped, 'stripe_not_ready');
  assert.equal((await held(d)).state, 'scheduled');
});

test('a course booking pays per session, split evenly, refunds taken off in proportion', async () => {
  settings.forget();
  const { sessions, booking } = await aPaidSession({ endedHoursAgo: 100, sessionsInBooking: 3 });
  await query('update experience_bookings set refunded_pence = 2500 where id = $1', [booking.id]);
  await money.schedulePayouts();
  const { rows } = await query('select amount_pence from host_payouts where session_id = any($1) order by amount_pence', [sessions.map((s) => s.id)]);
  // 8000 × 7500/10000 = 6000, three ways.
  assert.deepEqual(rows.map((r) => r.amount_pence), [2000, 2000, 2000]);
  assert.equal(ledger.shareForSession(100, ['a', 'b', 'c'], 'c'), 34, 'the odd penny lands on the last session');
});

test('the reconciliation checks the ledger against Stripe and names what does not match', async () => {
  const { household: h } = await aHousehold(query);
  await ledger.record({ kind: 'charge', householdId: h.id, amountPence: 5000, state: 'succeeded', stripeRef: 'pi_ok', mode: 'test' });
  await ledger.record({ kind: 'charge', householdId: h.id, amountPence: 5000, state: 'succeeded', stripeRef: 'pi_short', mode: 'test' });
  await ledger.record({ kind: 'refund', householdId: h.id, amountPence: 1000, state: 'succeeded', stripeRef: 're_failed', mode: 'test' });
  await ledger.record({ kind: 'pro', householdId: h.id, amountPence: 1299, state: 'succeeded', stripeRef: 'sub:sub_1', mode: 'test' });
  const again = await ledger.record({ kind: 'charge', householdId: h.id, amountPence: 5000, state: 'succeeded', stripeRef: 'pi_ok', mode: 'test' });
  assert.ok(again, 'a replay returns the row it already has');
  const read = async (ref) => ({
    pi_ok: { object: 'payment_intent', status: 'succeeded', amount_received: 5000 },
    pi_short: { object: 'payment_intent', status: 'succeeded', amount_received: 4000 },
    re_failed: { object: 'refund', status: 'failed', amount: 1000 },
  })[ref] ?? null;
  const r = await money.reconcile({ read, status: () => ({ ready: true }) });
  assert.equal(r.mismatched, 2);
  assert.deepEqual(r.details.map((d) => d.ref).sort(), ['pi_short', 're_failed']);
  const { rows } = await query(`select stripe_ref, stripe_match from hosting_payments where household_id = $1 order by stripe_ref`, [h.id]);
  assert.deepEqual(Object.fromEntries(rows.map((x) => [x.stripe_ref, x.stripe_match])), { pi_ok: 'matched', pi_short: 'mismatch', re_failed: 'mismatch', 'sub:sub_1': 'not_checked' }, 'a reference it cannot read is not a match');
});

test('an incident can’t be deleted', async () => {
  const { rows: [i] } = await query(`insert into session_incidents (reporter, body) values ('host', 'A child fell') returning id`);
  await assert.rejects(() => query('delete from session_incidents where id = $1', [i.id]), /never deleted/);
});

test('Codex: a payout claimed by a run that died is picked up again, with the same transfer key', async () => {
  settings.forget();
  const { sessions: [s] } = await aPaidSession({ endedHoursAgo: 100 });
  await money.schedulePayouts();
  const { rows: [p] } = await query('select * from host_payouts where session_id = $1', [s.id]);
  await query(`update host_payouts set state = 'released', released_by = 'time', updated_at = now() - interval '20 minutes' where id = $1`, [p.id]);
  const keys = [];
  await money.releasePayouts({ transfer: async (t) => { keys.push(t.idempotencyKey); return { id: 'tr_resumed' }; }, status: () => ({ ready: true }) });
  assert.equal(keys.filter((k) => k === `payout-${p.id}`).length, 1, 'once, with its own key');
  assert.equal((await query('select state from host_payouts where id = $1', [p.id])).rows[0].state, 'paid');
});

test('Codex: Stripe unreachable leaves a payout released for the next run, not failed', async () => {
  settings.forget();
  const { sessions: [s] } = await aPaidSession({ endedHoursAgo: 100 });
  await money.schedulePayouts();
  const { rows: [p] } = await query('select * from host_payouts where session_id = $1', [s.id]);
  await query(`update host_payouts set release_at = now() - interval '1 hour' where id = $1`, [p.id]);
  await money.releasePayouts({ transfer: async () => { throw Object.assign(new Error('x'), { code: 'stripe_unreachable' }); }, status: () => ({ ready: true }) });
  assert.equal((await query('select state from host_payouts where id = $1', [p.id])).rows[0].state, 'released');
});
