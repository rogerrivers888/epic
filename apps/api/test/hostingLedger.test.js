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
    // An account made the L1 way: Accounts v2, card payments on, manual payouts (register L, 3 Oct 2026).
    `insert into hosts (household_id, name, tax_reference, stripe_account_id, payouts_state, stripe_account_model, stripe_charges_enabled, stripe_payouts_manual)
     values ($1, 'Tom', $2, $3, $4, $5, $6, $6) returning *`,
    [h.id, tax, ready ? 'acct_test_9' : null, ready ? 'ready' : 'none', ready ? 'v2' : null, ready],
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
    `insert into experience_bookings (offer_id, host_id, household_id, payment_state, charged_pence, host_pence, fee_pence, value_pence, charge_model)
     values ($1, $2, $3, 'charged', 10000, 8000, 2000, 10000, 'destination') returning *`,
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
  const transfer = async (t) => { transfers.push(t); return { id: `po_${transfers.length}` }; };
  const status = () => ({ ready: true, mode: 'test' });
  await money.releasePayouts({ payout: transfer, status });
  assert.equal(transfers.length, 0, 'two hours after: waiting');

  // A guest says it happened: released early (the setting is on).
  await query(`update experience_bookings set confirmed_happened = 'yes' where id = $1`, [booking.id]);
  await money.releasePayouts({ payout: transfer, status });
  await money.releasePayouts({ payout: transfer, status });
  assert.equal(transfers.length, 1, 'once');
  assert.deepEqual([transfers[0].amountPence, transfers[0].accountId, transfers[0].idempotencyKey], [8000, 'acct_test_9', `payout-${payouts[0].id}`]);
  const { rows: [paid] } = await query('select * from host_payouts where id = $1', [payouts[0].id]);
  assert.deepEqual([paid.state, paid.released_by, paid.stripe_payout], ['paid', 'guest_confirmed', 'po_1']);
  const { rows: [row] } = await query(`select * from hosting_payments where kind = 'payout' and stripe_ref = 'po_1'`);
  assert.equal(row.host_id, host.id);
  const { rows: told } = await query(`select * from notifications where household_id = $1 and kind = 'payout_sent'`, [host.household_id]);
  assert.equal(told.length, 1);
});

test('a complaint, missing tax or an unfinished Stripe account holds a payout, and the host is told once', async () => {
  settings.forget();
  const transfers = [];
  const transfer = async (t) => { transfers.push(t); return { id: `po_x${transfers.length}` }; };
  const status = () => ({ ready: true, mode: 'test' });
  const a = await aPaidSession({ endedHoursAgo: 100 });
  await query(`insert into hosting_complaints (session_id, booking_id, host_id, reason) values ($1, $2, $3, 'It never started')`, [a.sessions[0].id, a.booking.id, a.host.id]);
  const b = await aPaidSession({ endedHoursAgo: 100, tax: null });
  const c = await aPaidSession({ endedHoursAgo: 100, ready: false });
  await money.schedulePayouts();
  await money.releasePayouts({ payout: transfer, status });
  await money.releasePayouts({ payout: transfer, status });
  const held = async (x) => (await query('select state, hold_reason from host_payouts where session_id = $1', [x.sessions[0].id])).rows[0];
  assert.deepEqual(await held(a), { state: 'held', hold_reason: 'complaint' });
  assert.deepEqual(await held(b), { state: 'held', hold_reason: 'tax_details' });
  assert.deepEqual(await held(c), { state: 'held', hold_reason: 'stripe_incomplete' });
  assert.equal(transfers.filter((t) => [a, b, c].some((x) => x.host.id === t.hostId)).length, 0);
  const { rows: [{ n }] } = await query(`select count(*)::int as n from notifications where household_id = $1 and kind = 'payout_held'`, [a.host.household_id]);
  assert.equal(n, 1, 'told once, not every ten minutes');

  // Resolved: it goes.
  await query(`update hosting_complaints set state = 'resolved' where session_id = $1`, [a.sessions[0].id]);
  await money.releasePayouts({ payout: transfer, status });
  assert.equal((await held(a)).state, 'paid');

  // Stripe not ready (a live key, or none): nothing moves at all.
  const d = await aPaidSession({ endedHoursAgo: 100 });
  await money.schedulePayouts();
  const r = await money.releasePayouts({ payout: transfer, status: () => ({ ready: false }) });
  assert.equal(r.skipped, 'stripe_not_ready');
  assert.equal((await held(d)).state, 'scheduled');
});

test('the owner releases a held payout over a complaint, never over missing tax details', async () => {
  settings.forget();
  const transfers = [];
  const transfer = async (t) => { transfers.push(t); return { id: `po_o${transfers.length}` }; };
  const status = () => ({ ready: true, mode: 'test' });
  const a = await aPaidSession({ endedHoursAgo: 2 });
  await query(`insert into hosting_complaints (session_id, booking_id, host_id, reason) values ($1, $2, $3, 'Late start')`, [a.sessions[0].id, a.booking.id, a.host.id]);
  const b = await aPaidSession({ endedHoursAgo: 100, tax: null });
  await money.schedulePayouts();
  await money.releasePayouts({ payout: transfer, status });
  const row = async (x) => (await query('select id, state, released_by from host_payouts where session_id = $1', [x.sessions[0].id])).rows[0];
  assert.equal(transfers.filter((t) => [a, b].some((x) => x.host.id === t.hostId)).length, 0, 'not due, and a complaint is open');
  // The owner's Release (hostingAdmin): scheduled now, released_by owner — before the 72 hours and over the complaint.
  // A second in the past: the job asks "due by now?" with JavaScript's clock, in milliseconds, and Postgres's now() is in
  // microseconds — set in the same millisecond, the row could be a few microseconds in the job's future and not due.
  for (const x of [a, b]) await query(`update host_payouts set state = 'scheduled', release_at = now() - interval '1 second', released_by = 'owner', hold_reason = null where id = $1`, [(await row(x)).id]);
  await money.releasePayouts({ payout: transfer, status });
  assert.deepEqual([(await row(a)).state, (await row(a)).released_by], ['paid', 'owner']);
  assert.equal((await row(b)).state, 'held', 'no tax details, no transfer, whoever says so');
  assert.equal((await row(b)).released_by, null, 'held again, the owner’s release is spent');
  // A failed transfer retried: a complaint raised since holds it, whoever released it before.
  await query(`update host_payouts set state = 'failed' where id = $1`, [(await row(a)).id]);
  await query(`insert into hosting_complaints (session_id, booking_id, host_id, reason) values ($1, $2, $3, 'Raised after')`, [a.sessions[0].id, a.booking.id, a.host.id]);
  // As the Retry route leaves it (hostingAdmin.test checks the route itself).
  await query(`update host_payouts set state = 'scheduled', hold_reason = null, released_by = null where id = $1`, [(await row(a)).id]);
  await money.releasePayouts({ payout: transfer, status });
  assert.equal((await row(a)).state, 'held');
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

test('Codex: a payout claimed by a run that died is picked up again, with the same payout key', async () => {
  settings.forget();
  const { sessions: [s] } = await aPaidSession({ endedHoursAgo: 100 });
  await money.schedulePayouts();
  const { rows: [p] } = await query('select * from host_payouts where session_id = $1', [s.id]);
  await query(`update host_payouts set state = 'released', released_by = 'time', updated_at = now() - interval '20 minutes' where id = $1`, [p.id]);
  const keys = [];
  await money.releasePayouts({ payout: async (t) => { keys.push(t.idempotencyKey); return { id: 'po_resumed' }; }, status: () => ({ ready: true }) });
  assert.equal(keys.filter((k) => k === `payout-${p.id}`).length, 1, 'once, with its own key');
  assert.equal((await query('select state from host_payouts where id = $1', [p.id])).rows[0].state, 'paid');
});

test('Codex: Stripe unreachable leaves a payout released for the next run, not failed', async () => {
  settings.forget();
  const { sessions: [s] } = await aPaidSession({ endedHoursAgo: 100 });
  await money.schedulePayouts();
  const { rows: [p] } = await query('select * from host_payouts where session_id = $1', [s.id]);
  await query(`update host_payouts set release_at = now() - interval '1 hour' where id = $1`, [p.id]);
  await money.releasePayouts({ payout: async () => { throw Object.assign(new Error('x'), { code: 'stripe_unreachable' }); }, status: () => ({ ready: true }) });
  assert.equal((await query('select state from host_payouts where id = $1', [p.id])).rows[0].state, 'released');
});

test('Codex: a refund after the first session was paid reduces only what is left, and a released hold matches Stripe', async () => {
  settings.forget();
  const { booking, sessions } = await aPaidSession({ endedHoursAgo: 100, sessionsInBooking: 2 });
  // Only the first session has ended: pay it.
  await query('update offer_sessions set on_date = current_date + 5 where id = $1', [sessions[1].id]);
  await money.schedulePayouts();
  const { rows: [first] } = await query('select amount_pence from host_payouts where session_id = $1', [sessions[0].id]);
  assert.equal(first.amount_pence, 4000, 'half of the £80 host share');
  // Half the booking comes back, then the second session ends.
  await query('update experience_bookings set refunded_pence = 5000 where id = $1', [booking.id]);
  await query('update offer_sessions set on_date = current_date - 5 where id = $1', [sessions[1].id]);
  await money.schedulePayouts();
  const { rows: [second] } = await query('select amount_pence from host_payouts where session_id = $1', [sessions[1].id]);
  assert.equal(first.amount_pence + (second?.amount_pence ?? 0), 4000, 'the host is paid £40 in all — the share left after the refund — never more');
  assert.equal(money.compareRow({ kind: 'release', state: 'succeeded', amount_pence: 100 }, { amountPence: 0, ok: false, held: false }), 'matched');
});

test('Codex: a tip that comes after the last payout gets a payout of its own', async () => {
  settings.forget();
  const { host, offer, booking } = await aPaidSession({ endedHoursAgo: 300 });
  await money.schedulePayouts();
  await query(`update host_payouts set state = 'paid' where host_id = $1`, [host.id]);
  await query(`insert into booking_tips (booking_id, offer_id, host_id, household_id, amount_pence, admin_fee_pence, charge_model, state, created_at) values ($1, $2, $3, $4, 500, 30, 'destination', 'paid', now() - interval '100 hours')`, [booking.id, offer.id, host.id, booking.household_id]);
  await money.schedulePayouts();
  const keys = [];
  await money.releasePayouts({ payout: async (t) => { keys.push(t); return { id: 'po_tip' }; }, status: () => ({ ready: true }) });
  const mine = keys.filter((t) => t.hostId === host.id);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].amountPence, 500, 'the tip, whole');
});

test('L3: a released payout is a Payout on the host’s own account; a chargeback or a non-manual account holds it; uncleared money waits', async () => {
  settings.forget();
  const status = () => ({ ready: true, mode: 'test' });
  const row = async (sessionId) => (await query('select * from host_payouts where session_id = $1', [sessionId])).rows[0];

  // An open chargeback holds the payout, and the owner's Release does not override the guest's bank.
  const a = await aPaidSession({ endedHoursAgo: 100 });
  await query(`update experience_bookings set dispute_state = 'open' where id = $1`, [a.booking.id]);
  await money.schedulePayouts();
  await query(`update host_payouts set released_by = 'owner' where session_id = $1`, [a.sessions[0].id]);
  const made = [];
  await money.releasePayouts({ payout: async (p) => { made.push(p); return { id: `po_${made.length}` }; }, status });
  assert.deepEqual([(await row(a.sessions[0].id)).state, (await row(a.sessions[0].id)).hold_reason], ['held', 'dispute']);
  assert.equal(made.filter((p) => p.accountId === a.host.stripe_account_id).length, 0);

  // Won: it goes, as a Payout on the host's own account for the released amount only.
  await query(`update experience_bookings set dispute_state = 'won' where id = $1`, [a.booking.id]);
  await money.releasePayouts({ payout: async (p) => { made.push(p); return { id: `po_${made.length}` }; }, status });
  const aRow = await row(a.sessions[0].id);
  const paid = made.find((p) => p.payoutId === aRow.id);
  assert.ok(paid, 'paid once the dispute is closed');
  assert.deepEqual([paid.accountId, paid.amountPence], [a.host.stripe_account_id, 8000]);
  assert.equal((await row(a.sessions[0].id)).stripe_payout, `po_${made.length}`);

  // An account Stripe shows off manual payouts is held for a person rather than paid.
  const b = await aPaidSession({ endedHoursAgo: 100 });
  await query(`update hosts set stripe_payouts_manual = false where id = $1`, [b.host.id]);
  await money.schedulePayouts();
  await money.releasePayouts({ payout: async (p) => { made.push(p); return { id: `po_${made.length}` }; }, status });
  assert.deepEqual([(await row(b.sessions[0].id)).state, (await row(b.sessions[0].id)).hold_reason], ['held', 'not_manual']);

  // Money in the host's balance that has not cleared yet: the payout waits, released, for the next run — not failed.
  const c = await aPaidSession({ endedHoursAgo: 100 });
  await money.schedulePayouts();
  await money.releasePayouts({ payout: async () => { throw Object.assign(new Error('x'), { code: 'funds_pending' }); }, status });
  assert.equal((await row(c.sessions[0].id)).state, 'released');
});

test('L1: a booking charged the old way, on Epic’s balance, is never paid out from the host’s', async () => {
  settings.forget();
  const old = await aPaidSession({ endedHoursAgo: 100 });
  await query(`update experience_bookings set charge_model = null where id = $1`, [old.booking.id]);
  await money.schedulePayouts();
  assert.equal((await query('select count(*)::int as n from host_payouts where session_id = $1', [old.sessions[0].id])).rows[0].n, 0, 'no payout row: those rows wait to be voided');
});

test('Codex: a payout that failed for certain is retried as a new Payout; one Stripe bounced is failed on the ledger too', async () => {
  settings.forget();
  const status = () => ({ ready: true, mode: 'test' });
  const row = async (x) => (await query('select * from host_payouts where session_id = $1', [x.sessions[0].id])).rows[0];
  const a = await aPaidSession({ endedHoursAgo: 100 });
  await money.schedulePayouts();
  const keys = [];
  // Stripe refuses it outright: failed, for a person to retry.
  await money.releasePayouts({ payout: async (p) => { if (p.hostId !== a.host.id) return { id: 'po_other' }; keys.push(p.idempotencyKey); throw Object.assign(new Error('no'), { code: 'stripe_refused' }); }, status });
  assert.deepEqual([(await row(a)).state, (await row(a)).attempt], ['failed', 1]);
  // The owner's Retry (hostingAdmin) puts it back; the retry is a new attempt with a new key.
  await query(`update host_payouts set state = 'scheduled', hold_reason = null where id = $1`, [(await row(a)).id]);
  await money.releasePayouts({ payout: async (p) => { if (p.hostId !== a.host.id) return { id: 'po_other' }; keys.push(p.idempotencyKey); return { id: 'po_second' }; }, status });
  const id = (await row(a)).id;
  assert.deepEqual(keys, [`payout-${id}`, `payout-${id}-a1`], 'never Stripe replaying the Payout that failed');
  assert.equal((await row(a)).stripe_payout, 'po_second');

  // Then the host's bank bounces it: the payout and its ledger line both say failed, and the next try is new again.
  const out = await ledger.markPayoutOutcome({ stripePayout: 'po_second', accountId: a.host.stripe_account_id, paid: false, failure: 'account_closed' });
  assert.equal(out.state, 'failed');
  assert.equal((await query(`select state from hosting_payments where stripe_ref = 'po_second' and kind = 'payout'`)).rows[0].state, 'failed', 'no report counts it as paid');
  assert.equal((await row(a)).attempt, 2);
  // Another host's account can't touch it.
  assert.equal(await ledger.markPayoutOutcome({ stripePayout: 'po_second', accountId: 'acct_someone_else', paid: false }), null);
});

test('Codex: Stripe’s payout.failed arriving before Epic wrote the Payout down still fails it, and it is never announced as paid', async () => {
  settings.forget();
  const status = () => ({ ready: true, mode: 'test' });
  const a = await aPaidSession({ endedHoursAgo: 100 });
  await money.schedulePayouts();
  const { rows: [p] } = await query('select * from host_payouts where session_id = $1', [a.sessions[0].id]);
  // The webhook lands while the Payout call is still in flight: the row is released, with no Stripe id yet.
  await money.releasePayouts({
    payout: async (x) => {
      if (x.hostId !== a.host.id) return { id: 'po_other' };
      await ledger.markPayoutOutcome({ stripePayout: 'po_early', accountId: a.host.stripe_account_id, paid: false, failure: 'account_closed', payoutId: x.payoutId });
      return { id: 'po_early' };
    },
    status,
  });
  const { rows: [after] } = await query('select * from host_payouts where id = $1', [p.id]);
  assert.deepEqual([after.state, after.stripe_payout, after.attempt], ['failed', 'po_early', 1]);
  assert.equal((await query(`select count(*)::int as n from hosting_payments where stripe_ref = 'po_early' and kind = 'payout'`)).rows[0].n, 0, 'never recorded as paid');
  assert.equal((await query(`select count(*)::int as n from notifications where dedupe_key = $1`, [`payout_sent:${p.id}`])).rows[0].n, 0, 'nor announced');
});

test('Codex: money not yet cleared is checked for first, and a refusal Stripe would remember moves the payout to a new key', async () => {
  settings.forget();
  const status = () => ({ ready: true, mode: 'test' });
  const a = await aPaidSession({ endedHoursAgo: 100 });
  await money.schedulePayouts();
  const { rows: [p] } = await query('select * from host_payouts where session_id = $1', [a.sessions[0].id]);
  const asked = [];
  const payout = async (x) => { if (x.hostId === a.host.id) asked.push(x.idempotencyKey); return { id: `po_${asked.length}_${x.payoutId.slice(0, 4)}` }; };
  // Not there yet: Stripe is not even asked.
  await money.releasePayouts({ payout, balance: async () => ({ availablePence: 100, pendingPence: 7900 }), status });
  assert.deepEqual([asked.length, (await query('select state from host_payouts where id = $1', [p.id])).rows[0].state], [0, 'released']);
  // A released payout is picked up again by a later run (ten minutes on); this is that run.
  const later = () => query(`update host_payouts set updated_at = now() - interval '1 hour' where id = $1`, [p.id]);
  await later();
  // The balance said yes but Stripe still refused: the next try is a new attempt, with a new key.
  await money.releasePayouts({ payout: async (x) => { if (x.hostId === a.host.id) { asked.push(x.idempotencyKey); throw Object.assign(new Error('x'), { code: 'funds_pending' }); } return { id: 'po_other' }; }, balance: async () => ({ availablePence: 999999 }), status });
  await later();
  await money.releasePayouts({ payout, balance: async () => ({ availablePence: 999999 }), status });
  assert.deepEqual(asked, [`payout-${p.id}`, `payout-${p.id}-a1`]);
  assert.equal((await query('select state from host_payouts where id = $1', [p.id])).rows[0].state, 'paid');
});

test('Codex: a chargeback the host lost is never paid out — left out when the payout is made, held if it was in one', async () => {
  settings.forget();
  const status = () => ({ ready: true, mode: 'test' });
  const made = [];
  const payout = async (x) => { made.push(x); return { id: `po_lost_${made.length}` }; };
  // Lost before the session's payout was made: that booking's share is not in it.
  const a = await aPaidSession({ endedHoursAgo: 100 });
  await query(`update experience_bookings set dispute_state = 'lost' where id = $1`, [a.booking.id]);
  await money.schedulePayouts();
  assert.equal((await query('select count(*)::int as n from host_payouts where session_id = $1', [a.sessions[0].id])).rows[0].n, 0, 'nothing payable');
  assert.equal((await ledger.sessionsEndedWithoutPayout()).some((r) => r.session_id === a.sessions[0].id), false, 'and not picked up again every run');
  // Lost after: the payout carrying it is held for the owner, and goes only on his Release.
  const b = await aPaidSession({ endedHoursAgo: 100 });
  await money.schedulePayouts();
  await query(`update experience_bookings set dispute_state = 'lost' where id = $1`, [b.booking.id]);
  await money.releasePayouts({ payout, balance: async () => ({ availablePence: 999999 }), status });
  const row = async () => (await query('select * from host_payouts where session_id = $1', [b.sessions[0].id])).rows[0];
  assert.deepEqual([(await row()).state, (await row()).hold_reason], ['held', 'dispute_lost']);
  assert.equal(made.filter((x) => x.hostId === b.host.id).length, 0);
  await query(`update host_payouts set released_by = 'owner' where id = $1`, [(await row()).id]);
  await money.releasePayouts({ payout, balance: async () => ({ availablePence: 999999 }), status });
  assert.equal((await row()).state, 'paid', 'the owner, having looked, can still pay it');
});

test('Codex: a bounce reported between the Payout and its ledger line leaves no paid line and no "on its way"', async () => {
  settings.forget();
  const status = () => ({ ready: true, mode: 'test' });
  const a = await aPaidSession({ endedHoursAgo: 100 });
  await money.schedulePayouts();
  const { rows: [p] } = await query('select * from host_payouts where session_id = $1', [a.sessions[0].id]);
  // Paid, then the bank bounces it straight away: the webhook finds the row and its ledger line together.
  await money.releasePayouts({ payout: async (x) => ({ id: x.hostId === a.host.id ? 'po_bounce' : 'po_other' }), balance: async () => ({ availablePence: 999999 }), status });
  await ledger.markPayoutOutcome({ stripePayout: 'po_bounce', accountId: a.host.stripe_account_id, paid: false, failure: 'account_closed' });
  assert.equal((await query('select state from host_payouts where id = $1', [p.id])).rows[0].state, 'failed');
  assert.equal((await query(`select state from hosting_payments where stripe_ref = 'po_bounce' and kind = 'payout'`)).rows[0].state, 'failed', 'the line written with it, failed with it');
  // And payoutPaid on a row no longer released writes nothing.
  assert.equal(await ledger.payoutPaid(p.id, { stripePayout: 'po_late', ledgerLine: { kind: 'payout', hostId: a.host.id, amountPence: 1 } }), null);
  assert.equal((await query(`select count(*)::int as n from hosting_payments where stripe_ref = 'po_late'`)).rows[0].n, 0);
});

test('Codex: a Payout Stripe made but Epic failed to write down is asked for again with the same key — never paid twice', async () => {
  settings.forget();
  const status = () => ({ ready: true, mode: 'test' });
  const a = await aPaidSession({ endedHoursAgo: 100 });
  await money.schedulePayouts();
  const { rows: [p] } = await query('select * from host_payouts where session_id = $1', [a.sessions[0].id]);
  const keys = [];
  const payout = async (x) => { if (x.hostId !== a.host.id) return { id: 'po_other' }; keys.push(x.idempotencyKey); return { id: 'po_boom' }; };
  // Epic's write after Stripe said yes fails (here: the ledger refuses the line).
  await query(`create or replace function test_payout_boom() returns trigger language plpgsql as $$ begin if new.stripe_ref = 'po_boom' then raise exception 'disk full'; end if; return new; end $$`);
  await query(`create trigger boom before insert on hosting_payments for each row execute function test_payout_boom()`);
  try {
    await money.releasePayouts({ payout, balance: async () => ({ availablePence: 999999 }), status });
  } finally { await query('drop trigger if exists boom on hosting_payments'); await query('drop function if exists test_payout_boom()'); }
  const mid = (await query('select * from host_payouts where id = $1', [p.id])).rows[0];
  assert.deepEqual([mid.state, mid.attempt], ['released', 0], 'not failed, not moved to a new key');
  // Not sure whether Stripe acted at all (an error that is not Stripe's refusal): the same.
  await query(`update host_payouts set updated_at = now() - interval '1 hour' where id = $1`, [p.id]);
  await money.releasePayouts({ payout: async (x) => { if (x.hostId === a.host.id) { keys.push(x.idempotencyKey); throw new Error('socket hang up'); } return { id: 'po_other' }; }, balance: async () => ({ availablePence: 999999 }), status });
  assert.equal((await query('select attempt from host_payouts where id = $1', [p.id])).rows[0].attempt, 0);
  // The next run: the same key, so Stripe answers with the Payout it already made.
  await query(`update host_payouts set updated_at = now() - interval '1 hour' where id = $1`, [p.id]);
  await money.releasePayouts({ payout, balance: async () => ({ availablePence: 999999 }), status });
  assert.deepEqual(keys, [`payout-${p.id}`, `payout-${p.id}`, `payout-${p.id}`]);
  assert.equal((await query('select state from host_payouts where id = $1', [p.id])).rows[0].state, 'paid');
});

test('Codex: host accounts stored before the trouble watch are read back from Stripe, so one already in trouble shows at once', async () => {
  const { household } = await aHousehold(query);
  const { rows: [h] } = await query(
    `insert into hosts (household_id, name, stripe_account_id, stripe_account_model, stripe_requirements) values ($1, 'Old Facts', 'acct_oldfacts', 'v2', $2::jsonb) returning *`,
    [household.id, JSON.stringify({ currentlyDue: [], eventuallyDue: [], pastDue: [], disabledReason: 'requirements.past_due' })],
  );
  const read = async (id) => ({ id, details_submitted: true, charges_enabled: false, payouts_enabled: false, capabilities: { card_payments: 'inactive', transfers: 'active' }, settings: { payouts: { schedule: { interval: 'manual' } } }, requirements: { currently_due: ['external_account'], eventually_due: [], past_due: ['external_account'], disabled_reason: 'requirements.past_due' } });
  const out = await money.refreshAccountFacts({ limit: 1000, status: () => ({ ready: true }), read });
  assert.ok(out.refreshed >= 1);
  const now = (await query('select stripe_requirements from hosts where id = $1', [h.id])).rows[0].stripe_requirements;
  assert.equal(now.detailsSubmitted, true);
  assert.equal((await query(`select after from hosting_changes where subject_kind = 'host' and subject_id = $1 and field = 'stripe_account_trouble'`, [h.id])).rows[0].after.reason, 'requirements.past_due', 'its trouble written down');
  const again = await money.refreshAccountFacts({ limit: 1000, status: () => ({ ready: true }), read: async () => { throw new Error('should not be asked again'); } });
  assert.equal(again.refreshed, 0, 'refreshed once: every account’s facts are whole now');
});

test('Codex: an older account Stripe won’t let Epic read is marked closed for Safety, and never holds up the rest', async () => {
  const { household } = await aHousehold(query);
  const { rows: [h] } = await query(
    `insert into hosts (household_id, name, stripe_account_id, stripe_account_model, stripe_requirements) values ($1, 'Gone Away', 'acct_gone', 'v2', $2::jsonb) returning *`,
    [household.id, JSON.stringify({ currentlyDue: [], eventuallyDue: [], pastDue: [], disabledReason: null })],
  );
  // A refusal that says nothing about one account (a key without permission) closes nothing and stops the run.
  const before = (await query('select stripe_requirements from hosts where id = $1', [h.id])).rows[0].stripe_requirements;
  const platformWide = await money.refreshAccountFacts({ limit: 1000, status: () => ({ ready: true }), read: async () => { throw Object.assign(new Error('no'), { code: 'stripe_refused', detail: 'permission_error', httpStatus: 403 }); } });
  assert.equal(platformWide.refreshed, 0);
  assert.deepEqual((await query('select stripe_requirements from hosts where id = $1', [h.id])).rows[0].stripe_requirements, before, 'untouched');
  const read = async (id) => { if (id === 'acct_gone') throw Object.assign(new Error('no'), { code: 'stripe_refused', detail: 'account_invalid', httpStatus: 403 }); return { id, details_submitted: true, charges_enabled: true, payouts_enabled: true, capabilities: {}, settings: { payouts: { schedule: { interval: 'manual' } } }, requirements: {} }; };
  await money.refreshAccountFacts({ limit: 1000, status: () => ({ ready: true }), read });
  const facts = (await query('select stripe_requirements from hosts where id = $1', [h.id])).rows[0].stripe_requirements;
  assert.equal(facts.disabledReason, 'account_closed');
  assert.equal((await query(`select after from hosting_changes where subject_kind = 'host' and subject_id = $1 and field = 'stripe_account_trouble'`, [h.id])).rows[0].after.reason, 'account_closed');
  assert.equal((await money.refreshAccountFacts({ limit: 1000, status: () => ({ ready: true }), read: async () => { throw new Error('not again'); } })).refreshed, 0);
});
