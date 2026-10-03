/**
 * When an event changes under booked guests (sources/bookingMoney.js, hosting
 * v4 §5): cancel, change date, decides-by and the refund queue. Stripe is a
 * function handed in; nothing leaves the machine.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.STRIPE_SECRET_KEY = 'sk_test_fake';

const { aHousehold, testDatabase } = await import('./helpers/db.js');
const { query, pool } = await testDatabase();
const engine = await import('../src/sources/bookingMoney.js');
const settings = await import('../src/repositories/hostingSettings.js');
const { plusDays, localDay } = await import('../src/domain/lanes.js');

test.after(async () => { settings.forget(); await pool?.end?.(); });

const today = () => localDay(new Date(), 'Europe/London');
const ready = () => ({ ready: true, mode: 'test' });

/** A live event with `days` sessions (first one `inDays` away) and guests booked on all of them. */
async function anEvent({ lane = 'oneoff', inDays = 10, days = 1, min = null, priceMode = 'same_each', totalPence = null, guests = [{ heads: 2, charged: 4000 }], decidesInHours = null, destination = false } = {}) {
  const { household: hh } = await aHousehold(query);
  // destination: the register-L way — the host's own account took the money, Epic's 20% fee its application fee.
  const { rows: [host] } = await query(
    `insert into hosts (household_id, name, stripe_account_id, stripe_account_model, stripe_payouts_manual) values ($1, 'Kate', $2, $3, $4) returning *`,
    [hh.id, destination ? `acct_k_${hh.id.slice(0, 6)}` : null, destination ? 'v2' : null, destination]);
  const { rows: [offer] } = await query(
    `insert into host_offers (host_id, shape, lane, state, title, min_count, price_mode, total_pence, starts_on, starts_at)
     values ($1, $2, $3, 'live', 'Pottery', $4, $5, $6, $7, '10:00') returning *`,
    [host.id, lane === 'oneoff' ? 'oneoff' : 'series', lane, min, priceMode, totalPence, plusDays(today(), inDays)],
  );
  const sessions = [];
  for (let i = 0; i < days; i += 1) {
    const decides = decidesInHours == null ? null : new Date(Date.now() + decidesInHours * 3_600_000);
    const { rows: [s] } = await query(
      `insert into offer_sessions (offer_id, n, on_date, starts_at, ends_at, decides_at) values ($1, $2, $3, '10:00', '12:00', $4) returning *`,
      [offer.id, i + 1, plusDays(today(), inDays + i * 7), decides],
    );
    sessions.push(s);
  }
  const bookings = [];
  for (const [i, g] of guests.entries()) {
    const { household: gh } = await aHousehold(query);
    const { rows: [b] } = await query(
      `insert into experience_bookings (offer_id, host_id, household_id, heads, state, payment_state, charged_pence, held_pence, host_pence, fee_pence, stripe_payment_intent, charge_model, cancellation_fee_pct)
       values ($1, $2, $3, $4, 'confirmed', $5, $6, $7, $8, $9, $10, $11, $12) returning *`,
      [offer.id, host.id, gh.id, g.heads, g.held ? 'held' : 'charged', g.held ? null : g.charged, g.held ? g.charged : null, Math.round((g.charged ?? 0) * 0.8), Math.round((g.charged ?? 0) * 0.2), `pi_${offer.id.slice(0, 8)}_${i}`, destination ? 'destination' : null, destination && g.feePct !== null ? (g.feePct ?? 5) : null],
    );
    for (const s of g.sessions ? g.sessions.map((n) => sessions[n]) : sessions) await query('insert into booking_sessions (booking_id, session_id) values ($1, $2)', [b.id, s.id]);
    bookings.push(b);
  }
  return { host, offer, sessions, bookings, hostHousehold: hh };
}

const pendingFor = async (offerId) => (await query(`select * from hosting_payments where offer_id = $1 and state = 'pending' order by amount_pence`, [offerId])).rows;

test('cancelling the whole event refunds everyone in full, tells them, and ends it', async () => {
  settings.forget();
  const { host, offer, bookings } = await anEvent({ guests: [{ heads: 2, charged: 4000 }, { heads: 1, charged: 2000 }] });
  await assert.rejects(() => engine.cancelSessions({ offerId: offer.id, hostId: host.id, reason: 'bored' }), /Choose why first/);
  const r = await engine.cancelSessions({ offerId: offer.id, hostId: host.id, reason: 'illness' });
  assert.deepEqual([r.cancelled, r.refunds, r.late], [1, 2, false]);
  const owed = await pendingFor(offer.id);
  assert.deepEqual(owed.map((p) => [p.kind, p.amount_pence, p.cause]), [['refund', 2000, 'host_cancelled'], ['refund', 4000, 'host_cancelled']]);
  const { rows: [o] } = await query('select state, cancelled_at, cancel_reason from host_offers where id = $1', [offer.id]);
  assert.equal(o.state, 'ended');
  assert.equal(o.cancel_reason, 'illness');
  const { rows: told } = await query(`select household_id from notifications where kind = 'cancelled' and household_id = any($1)`, [bookings.map((b) => b.household_id)]);
  assert.equal(told.length, 2);
  await assert.rejects(() => engine.cancelSessions({ offerId: offer.id, hostId: host.id, reason: 'illness' }), /nothing left/);
});

test('a cancel inside 48 hours counts against the host', async () => {
  settings.forget();
  const { host, offer, sessions } = await anEvent({ inDays: 1 });
  const r = await engine.cancelSessions({ offerId: offer.id, hostId: host.id, reason: 'weather' });
  assert.equal(r.late, true);
  assert.equal((await query('select late from offer_sessions where id = $1', [sessions[0].id])).rows[0].late, true);
});

test('one session of a course: that session’s share back, the rest still booked', async () => {
  settings.forget();
  const { host, offer, sessions, bookings: [b] } = await anEvent({ lane: 'course', days: 4, guests: [{ heads: 1, charged: 8000 }] });
  await engine.cancelSessions({ offerId: offer.id, hostId: host.id, sessionIds: [sessions[1].id], reason: 'venue' });
  const owed = await pendingFor(offer.id);
  assert.deepEqual(owed.map((p) => p.amount_pence), [2000], 'a quarter of the course');
  const { rows: [bk] } = await query('select state, refunded_pence from experience_bookings where id = $1', [b.id]);
  assert.deepEqual([bk.state, bk.refunded_pence], ['confirmed', 2000]);
  const { rows: bs } = await query('select state from booking_sessions where booking_id = $1 order by state', [b.id]);
  assert.deepEqual(bs.map((x) => x.state), ['booked', 'booked', 'booked', 'cancelled']);
  assert.equal((await query('select state from host_offers where id = $1', [offer.id])).rows[0].state, 'live');
});

test('a held card is let go, never refunded', async () => {
  settings.forget();
  const { host, offer } = await anEvent({ guests: [{ heads: 1, charged: 3000, held: true }] });
  await engine.cancelSessions({ offerId: offer.id, hostId: host.id, reason: 'other', note: 'Flooded' });
  assert.deepEqual((await pendingFor(offer.id)).map((p) => [p.kind, p.cause]), [['release', 'host_cancelled']]);
});

test('the refund queue: sent once with its own key, the booking marked, the guest told', async () => {
  settings.forget();
  // Earlier tests leave refunds owed; send those first so this one counts its own.
  await engine.processRefunds({ status: ready, refund: async () => ({ id: 're_x' }), release: async (pi) => ({ id: pi }) });
  const { host, offer, bookings } = await anEvent({ guests: [{ heads: 2, charged: 4000 }, { heads: 1, charged: 2000, held: true }] });
  await engine.cancelSessions({ offerId: offer.id, hostId: host.id, reason: 'illness' });
  const sent = [];
  const refund = async (r) => { sent.push(['refund', r.idempotencyKey, r.amountPence]); return { id: `re_${sent.length}` }; };
  const release = async (pi, o) => { sent.push(['release', o.idempotencyKey, pi]); return { id: pi }; };
  assert.equal((await engine.processRefunds({ status: () => ({ ready: false }), refund, release })).skipped, 'stripe_not_ready');
  const r1 = await engine.processRefunds({ status: ready, refund, release });
  const r2 = await engine.processRefunds({ status: ready, refund, release });
  assert.equal(r1.sent, 2);
  assert.equal(r2.sent, 0, 'never twice');
  assert.ok(sent.every((x) => /^cancel:/.test(x[1])), 'each carries its own idempotency key');
  const { rows } = await query('select id, payment_state from experience_bookings where offer_id = $1 order by charged_pence nulls first', [offer.id]);
  assert.deepEqual(rows.map((x) => x.payment_state), ['released', 'refunded']);
  const { rows: told } = await query(`select * from notifications where kind = 'refund_issued' and household_id = $1`, [bookings[0].household_id]);
  assert.equal(told.length, 1);
  assert.match(told[0].title, /£40\.00/);
});

test('Stripe refusing a refund marks it for a person; Stripe unreachable leaves it for the next run', async () => {
  settings.forget();
  await engine.processRefunds({ status: ready, refund: async () => ({ id: 're_y' }), release: async (pi) => ({ id: pi }) });
  const { host, offer } = await anEvent({ guests: [{ heads: 1, charged: 1000 }, { heads: 1, charged: 2000 }] });
  await engine.cancelSessions({ offerId: offer.id, hostId: host.id, reason: 'illness' });
  const refund = async (r) => { throw Object.assign(new Error('x'), r.amountPence === 1000 ? { code: 'stripe_refused', detail: 'charge_already_refunded' } : { code: 'stripe_unreachable' }); };
  const out = await engine.processRefunds({ status: ready, refund });
  assert.deepEqual([out.failed, out.waiting], [1, 1]);
  const { rows } = await query(`select amount_pence, state, reason from hosting_payments where offer_id = $1 order by amount_pence`, [offer.id]);
  assert.deepEqual(rows.map((x) => [x.amount_pence, x.state]), [[1000, 'failed'], [2000, 'pending']]);
});

test('change date: a preview writes nothing; this and all after moves the rest by the same amount', async () => {
  settings.forget();
  const { host, offer, sessions, bookings } = await anEvent({ lane: 'course', days: 3, decidesInHours: 24 * 5 });
  const to = plusDays(today(), 12);
  const preview = await engine.changeDate({ offerId: offer.id, hostId: host.id, sessionId: sessions[0].id, toDate: to, scope: 'after', dryRun: true });
  assert.deepEqual(preview.moved.map((m) => m.to.date), [to, plusDays(to, 7), plusDays(to, 14)]);
  assert.equal(preview.guests, 1);
  assert.equal(String((await query('select on_date from offer_sessions where id = $1', [sessions[0].id])).rows[0].on_date).slice(0, 10) === plusDays(today(), 10), true, 'nothing written');

  const r = await engine.changeDate({ offerId: offer.id, hostId: host.id, sessionId: sessions[0].id, toDate: to, toTime: '11:30', scope: 'after' });
  assert.equal(r.moved.length, 3);
  const { rows } = await query(`select to_char(on_date, 'YYYY-MM-DD') as d, to_char(starts_at, 'HH24:MI') as t, to_char(ends_at, 'HH24:MI') as e, changed_from, decides_at from offer_sessions where offer_id = $1 order by on_date`, [offer.id]);
  assert.deepEqual(rows.map((x) => [x.d, x.t, x.e]), [[to, '11:30', '13:30'], [plusDays(to, 7), '11:30', '13:30'], [plusDays(to, 14), '11:30', '13:30']]);
  assert.equal(rows[0].changed_from.onDate, plusDays(today(), 10));
  assert.equal(Math.round((new Date(rows[0].decides_at) - sessions[0].decides_at) / 86_400_000), 2, 'decides-by follows');
  assert.equal((await query(`select to_char(starts_on, 'YYYY-MM-DD') as d from host_offers where id = $1`, [offer.id])).rows[0].d, to);
  const { rows: told } = await query(`select body from notifications where kind = 'date_changed' and household_id = $1`, [bookings[0].household_id]);
  assert.equal(told.length, 1);
  assert.match(told[0].body, /full refund/);
  // The guest who booked before the move may leave with everything.
  const { rows: now } = await query('select changed_from from offer_sessions where offer_id = $1', [offer.id]);
  assert.equal(engine.movedSinceBooking(bookings[0], now), true);

  await assert.rejects(() => engine.changeDate({ offerId: offer.id, hostId: host.id, sessionId: sessions[1].id, toDate: plusDays(today(), -1) }), /future/);
  await assert.rejects(() => engine.changeDate({ offerId: offer.id, hostId: host.id, sessionId: sessions[1].id, toDate: '2026-02-30' }), /Pick a date/);
});

test('this session only moves one; a change inside 48 hours is marked late', async () => {
  settings.forget();
  const { host, offer, sessions } = await anEvent({ lane: 'weekly', inDays: 1, days: 3 });
  const r = await engine.changeDate({ offerId: offer.id, hostId: host.id, sessionId: sessions[0].id, toDate: plusDays(today(), 3), scope: 'this' });
  assert.deepEqual([r.moved.length, r.late], [1, true]);
  const { rows } = await query(`select to_char(on_date, 'YYYY-MM-DD') as d from offer_sessions where offer_id = $1 order by n`, [offer.id]);
  assert.deepEqual(rows.map((x) => x.d), [plusDays(today(), 3), plusDays(today(), 8), plusDays(today(), 15)]);
});

test('decides-by: under the minimum it is called off with full refunds; the host is told', async () => {
  settings.forget();
  const { offer, sessions, bookings, hostHousehold } = await anEvent({ lane: 'course', days: 2, min: 5, decidesInHours: -1, guests: [{ heads: 2, charged: 4000 }] });
  const [r] = (await engine.decideDue()).filter((x) => x.sessionIds.includes(sessions[0].id));
  assert.deepEqual([r.outcome, r.heads, r.min], ['called_off', 2, 5]);
  assert.deepEqual((await query(`select state from offer_sessions where offer_id = $1`, [offer.id])).rows.map((x) => x.state), ['called_off', 'called_off'], 'a course decides as one');
  assert.deepEqual((await pendingFor(offer.id)).map((p) => [p.amount_pence, p.cause]), [[4000, 'called_off']]);
  assert.equal((await query('select state from experience_bookings where id = $1', [bookings[0].id])).rows[0].state, 'cancelled');
  assert.equal((await query(`select count(*)::int as n from notifications where kind = 'event_called_off' and household_id = $1`, [hostHousehold.id])).rows[0].n, 1);
  // Each side opens the right page: the guest their booking, the host the event's own page — never the old per-offer
  // screen, whose "Call it off" is not for a lane event (Hosting v7 handover, 3 Oct 2026).
  const link = async (kind, household) => (await query(`select link from notifications where kind = $1 and household_id = $2`, [kind, household])).rows.map((x) => x.link);
  assert.deepEqual(await link('event_called_off', hostHousehold.id), [`/host/events/${offer.id}`]);
  assert.deepEqual(await link('called_off', bookings[0].household_id), [`/bookings/${bookings[0].id}`]);
  assert.equal((await engine.decideDue()).filter((x) => x.sessionIds.includes(sessions[0].id)).length, 0, 'decided once');
});

test('decides-by: depends on numbers gives back the difference once it is going ahead', async () => {
  settings.forget();
  // £300 for the group, minimum 6: everybody paid £50 a head. Ten came: £30 each, £20 a head back.
  const { offer, bookings } = await anEvent({ min: 6, priceMode: 'by_numbers', totalPence: 30000, decidesInHours: -1, guests: [{ heads: 6, charged: 30000 }, { heads: 4, charged: 20000 }] });
  await engine.decideDue();
  assert.deepEqual((await pendingFor(offer.id)).map((p) => [p.amount_pence, p.cause]), [[8000, 'numbers_settled'], [12000, 'numbers_settled']]);
  const { rows } = await query('select final_price_pence from experience_bookings where offer_id = $1 order by heads', [offer.id]);
  assert.deepEqual(rows.map((x) => x.final_price_pence), [12000, 18000]);
  assert.equal((await query(`select count(*)::int as n from notifications where kind = 'decides_by_result' and household_id = $1`, [bookings[0].household_id])).rows[0].n, 1);
  assert.equal((await query(`select link from notifications where kind = 'decides_by_result' and household_id = $1`, [bookings[0].household_id])).rows[0].link, `/bookings/${bookings[0].id}`, 'going ahead opens the booking');
});

test('the host hears once when an event is under its minimum close to decides-by', async () => {
  settings.forget();
  const { hostHousehold, offer } = await anEvent({ min: 8, decidesInHours: 20, guests: [{ heads: 3, charged: 3000 }] });
  await engine.warnUnderMinimum();
  await engine.warnUnderMinimum();
  assert.equal((await query(`select count(*)::int as n from notifications where kind = 'under_minimum' and household_id = $1`, [hostHousehold.id])).rows[0].n, 1);
  // It opens the event's own page with its cancel sheet, which runs the lane refund path.
  assert.equal((await query(`select link from notifications where kind = 'under_minimum' and household_id = $1`, [hostHousehold.id])).rows[0].link, `/host/events/${offer.id}?sheet=cancel`);
});

test('Codex: a time move keeps the session’s length across midnight, and a weekly deadline follows the new time', async () => {
  settings.forget();
  const { host, offer, sessions } = await anEvent({ lane: 'weekly', inDays: 6, days: 1, decidesInHours: 24 * 5 });
  await query(`update offer_sessions set starts_at = '23:00', ends_at = '01:00', ends_on = on_date + 1 where id = $1`, [sessions[0].id]);
  const { rows: [before] } = await query('select decides_at from offer_sessions where id = $1', [sessions[0].id]);
  await engine.changeDate({ offerId: offer.id, hostId: host.id, sessionId: sessions[0].id, toDate: plusDays(today(), 6), toTime: '01:00', scope: 'this' });
  const { rows: [after] } = await query(`select to_char(starts_at, 'HH24:MI') as s, to_char(ends_at, 'HH24:MI') as e, ends_on, decides_at from offer_sessions where id = $1`, [sessions[0].id]);
  assert.deepEqual([after.s, after.e, after.ends_on], ['01:00', '03:00', null], 'two hours, all on the one day');
  assert.equal(Math.round((new Date(after.decides_at) - new Date(before.decides_at)) / 3_600_000), -22, 'the deadline moves with the start');
});

// ---------------------------------------------------------------------------
// Phase 3: cancellations and the 5% (register L5; owner, 3 Oct 2026)
// ---------------------------------------------------------------------------

test('L5: the fee is kept only where the guest would otherwise get everything back — never on a part refund or a moved date', async () => {
  const { cancelQuote } = await import('../src/domain/booking.js');
  const at = (h) => new Date(Date.now() + h * 3_600_000);
  const booking = { charged_pence: 4000, refunded_pence: 0, payment_state: 'charged', refund_policy: 'flexible' };
  const terms = { flexible: { fullHoursBefore: 24 }, strict: { partHoursBefore: 168, partPct: 50 } };
  const one = (b, sessions) => cancelQuote({ booking: b, lane: 'oneoff', sessions, losing: sessions.map((x) => x.id), terms, feePct: 5 });
  assert.deepEqual(['pence', 'feeKeptPence'].map((k) => one(booking, [{ id: 's', startsAt: at(72) }])[k]), [3800, 200], 'in time: all of it, less 5%');
  assert.equal(one({ ...booking, refund_policy: 'strict' }, [{ id: 's', startsAt: at(200) }]).feeKeptPence, 0, 'a part refund: exactly what the policy says');
  assert.equal(one({ ...booking, refund_policy: 'strict' }, [{ id: 's', startsAt: at(200) }]).pence, 2000);
  assert.deepEqual(['pence', 'feeKeptPence', 'cause'].map((k) => one(booking, [{ id: 's', startsAt: at(72), movedAfterBooking: true }])[k]), [4000, 0, 'date_changed'], 'the host moved it: all of it');
  assert.equal(cancelQuote({ booking, lane: 'oneoff', sessions: [{ id: 's', startsAt: at(72) }], losing: ['s'], terms, feePct: null }).feeKeptPence, 0, 'no fee set, none kept');
  // A weekly: one session the host moved and one the guest gives up in time — the moved part said apart, the fee on the rest.
  const w = cancelQuote({ booking: { ...booking, all_sessions_count: 2 }, lane: 'weekly', sessions: [{ id: 'a', startsAt: at(72), movedAfterBooking: true }, { id: 'b', startsAt: at(96) }], losing: ['a', 'b'], terms, feePct: 5 });
  assert.deepEqual([w.pence, w.movedPence, w.feeKeptPence], [3900, 2000, 100]);
});

test('L5: a guest cancelling in time gets it back less 5%; the host keeps none of it; Epic keeps exactly the fee', async () => {
  settings.forget();
  const { offer, bookings } = await anEvent({ destination: true, guests: [{ heads: 1, charged: 6000 }] });
  const b = bookings[0];
  const { withTransaction } = await import('../src/db.js');
  await withTransaction(async (c) => {
    const { rows: [fresh] } = await c.query('select * from experience_bookings where id = $1', [b.id]);
    await engine.owe(c, fresh, { amountPence: 5700, cause: 'guest_cancelled', key: `t:${b.id}`, feeKeptPence: 300, triggeredBy: 'guest' });
  });
  const [line] = await pendingFor(offer.id);
  // £60 charged, Epic's fee £12: the host's £48 of it comes back to Epic, the guest gets £57, Epic is left with £3.
  assert.deepEqual([line.amount_pence, line.fee_kept_pence, line.refund_mode, line.triggered_by, line.host_pence, line.epic_pence], [5700, 300, 'keep_fee', 'guest', 4800, 900]);
  const sent = [];
  await engine.processRefunds({
    status: () => ({ ready: true }),
    // Other tests' refunds are in the queue too; only this booking's calls are looked at.
    refund: async (r) => { if (r.bookingId === b.id) sent.push(['refund', r.amountPence, r.keepFee]); return { id: `re_${r.bookingId.slice(0, 6)}` }; },
    reverseHostShare: async (r) => { if (r.idempotencyKey.startsWith(`t:${b.id}`)) sent.push(['reverse', r.amountPence, r.idempotencyKey]); return { id: 'trr_k' }; },
  });
  assert.deepEqual(sent, [['refund', 5700, true], ['reverse', 4800, `t:${b.id}:host_share`]], 'the guest’s part, then the host’s whole share');
  const { rows: [after] } = await query('select refunded_pence, cancellation_fee_pence, payment_state from experience_bookings where id = $1', [b.id]);
  assert.deepEqual([after.refunded_pence, after.cancellation_fee_pence, after.payment_state], [5700, 300, 'refunded'], 'all of it settled: none left to pay the host');
  assert.equal((await query(`select count(*)::int as n from hosting_payments where kind = 'host_recovery' and booking_id = $1`, [b.id])).rows[0].n, 0, 'the guest’s own cancellation: nothing recovered from the host');
});

test('L5: a host cancelling refunds in full and Epic recovers 5% from the host’s balance — when it is there, before any payout', async () => {
  settings.forget();
  const { host, offer, bookings } = await anEvent({ destination: true, guests: [{ heads: 1, charged: 4000 }] });
  await engine.cancelSessions({ offerId: offer.id, hostId: host.id, reason: 'illness' });
  const [line] = await pendingFor(offer.id);
  assert.deepEqual([line.cause, line.triggered_by, line.refund_mode, line.fee_kept_pence], ['host_cancelled', 'host', 'proportional', 0]);
  await engine.processRefunds({ status: () => ({ ready: true }), refund: async () => ({ id: 're_h' }) });
  const { rows: [rec] } = await query(`select * from hosting_payments where kind = 'host_recovery' and booking_id = $1`, [bookings[0].id]);
  assert.deepEqual([rec.amount_pence, rec.state, rec.cause, rec.triggered_by, rec.recovers], [200, 'pending', 'host_cancelled', 'host', line.id], '5% of the £40 refunded');
  const money = await import('../src/sources/hostingMoney.js');
  const debits = [];
  // Not enough in the host's balance yet: it waits, and takes nothing below nought.
  let r = await money.processRecoveries({ status: () => ({ ready: true }), balance: async () => ({ availablePence: 150 }), debit: async (d) => { debits.push(d); return { id: 'py_x' }; } });
  assert.deepEqual([r.waiting >= 1, debits.length], [true, 0]);
  r = await money.processRecoveries({ status: () => ({ ready: true }), balance: async () => ({ availablePence: 5000 }), debit: async (d) => { debits.push(d); return { id: 'py_1' }; } });
  assert.deepEqual(debits.map((d) => [d.accountId, d.amountPence, d.idempotencyKey]), [[host.stripe_account_id, 200, `recovery:${line.id}`]]);
  assert.deepEqual((await query('select state, stripe_ref from hosting_payments where id = $1', [rec.id])).rows.map((x) => [x.state, x.stripe_ref]), [['succeeded', 'py_1']]);
  await engine.processRefunds({ status: () => ({ ready: true }), refund: async () => ({ id: 're_h' }) });
  assert.equal((await query(`select count(*)::int as n from hosting_payments where kind = 'host_recovery' and booking_id = $1`, [bookings[0].id])).rows[0].n, 1, 'one recovery a refund');
});

test('L5: a missed minimum refunds in full and recovers nothing — unless the owner switches it on', async () => {
  settings.forget();
  const off = await anEvent({ destination: true, min: 5, decidesInHours: -1, guests: [{ heads: 2, charged: 4000 }] });
  await engine.decideDue();
  await engine.processRefunds({ status: () => ({ ready: true }), refund: async () => ({ id: 're_m' }) });
  assert.equal((await query(`select count(*)::int as n from hosting_payments where kind = 'host_recovery' and booking_id = $1`, [off.bookings[0].id])).rows[0].n, 0, 'off by default');
  await query(`update hosting_settings set value = 'true' where key = 'recovery_on_minimum'`);
  settings.forget();
  try {
    const on = await anEvent({ destination: true, min: 5, decidesInHours: -1, guests: [{ heads: 2, charged: 4000 }] });
    await engine.decideDue();
    await engine.processRefunds({ status: () => ({ ready: true }), refund: async () => ({ id: 're_m2' }) });
    const { rows: [rec] } = await query(`select amount_pence, triggered_by from hosting_payments where kind = 'host_recovery' and booking_id = $1`, [on.bookings[0].id]);
    assert.deepEqual([rec.amount_pence, rec.triggered_by], [200, 'epic']);
  } finally { await query(`update hosting_settings set value = 'false' where key = 'recovery_on_minimum'`); settings.forget(); }
});

test('Codex: the fee is the one agreed at booking — a booking from before it has none to keep or recover', async () => {
  settings.forget();
  const { host, offer, bookings } = await anEvent({ destination: true, guests: [{ heads: 1, charged: 4000, feePct: null }] });
  await engine.cancelSessions({ offerId: offer.id, hostId: host.id, reason: 'illness' });
  await engine.processRefunds({ status: () => ({ ready: true }), refund: async () => ({ id: 're_old' }) });
  assert.equal((await query(`select count(*)::int as n from hosting_payments where kind = 'host_recovery' and booking_id = $1`, [bookings[0].id])).rows[0].n, 0, 'no rate agreed: nothing recovered');
});

test('Codex: a host recovery Stripe refuses stays owed — held back from payouts, and retried once a person says so', async () => {
  settings.forget();
  const { host, offer, bookings } = await anEvent({ destination: true, guests: [{ heads: 1, charged: 4000 }] });
  await engine.cancelSessions({ offerId: offer.id, hostId: host.id, reason: 'illness' });
  await engine.processRefunds({ status: () => ({ ready: true }), refund: async () => ({ id: 're_r' }) });
  const money = await import('../src/sources/hostingMoney.js');
  const { rows: [rec] } = await query(`select * from hosting_payments where kind = 'host_recovery' and booking_id = $1`, [bookings[0].id]);
  // The balance moved since the check: still pending, it simply waits.
  await money.processRecoveries({ status: () => ({ ready: true }), balance: async () => ({ availablePence: 9999 }), debit: async () => { throw Object.assign(new Error('x'), { code: 'stripe_refused', detail: 'balance_insufficient' }); } });
  assert.equal((await query('select state from hosting_payments where id = $1', [rec.id])).rows[0].state, 'pending');
  // Refused for another reason: failed for a person — and still counted against the host's payouts.
  await money.processRecoveries({ status: () => ({ ready: true }), balance: async () => ({ availablePence: 9999 }), debit: async () => { throw Object.assign(new Error('x'), { code: 'stripe_refused', detail: 'account_invalid' }); } });
  assert.equal((await query('select state from hosting_payments where id = $1', [rec.id])).rows[0].state, 'failed');
  const { rows: [owed] } = await query(`select coalesce(sum(amount_pence), 0)::int as n from hosting_payments where kind = 'host_recovery' and state in ('pending', 'failed') and host_id = $1`, [host.id]);
  assert.equal(owed.n, 200, 'still held back from payouts');
});

test('Codex: a host recovery already sent to Stripe is asked again with the same key — not held up by the balance it took', async () => {
  settings.forget();
  const { host, offer, bookings } = await anEvent({ destination: true, guests: [{ heads: 1, charged: 4000 }] });
  await engine.cancelSessions({ offerId: offer.id, hostId: host.id, reason: 'illness' });
  await engine.processRefunds({ status: () => ({ ready: true }), refund: async () => ({ id: 're_s' }) });
  const money = await import('../src/sources/hostingMoney.js');
  const { rows: [rec] } = await query(`select * from hosting_payments where kind = 'host_recovery' and booking_id = $1`, [bookings[0].id]);
  // Stripe took it, but the reply was lost.
  await money.processRecoveries({ status: () => ({ ready: true }), balance: async () => ({ availablePence: 9999 }), debit: async () => { throw Object.assign(new Error('x'), { code: 'stripe_unreachable' }); } });
  assert.equal((await query('select reason, state from hosting_payments where id = $1', [rec.id])).rows[0].reason, 'debit_sent');
  // Next run: the balance is now short (Stripe already took it) — the same debit is asked for anyway, and recorded.
  const keys = [];
  await money.processRecoveries({ status: () => ({ ready: true }), balance: async () => ({ availablePence: 0 }), debit: async (d) => { if (d.recoveryId === rec.id) keys.push(d.idempotencyKey); return { id: 'py_replay' }; } });
  assert.deepEqual(keys, [`recovery:${rec.recovers}`]);
  assert.deepEqual((await query('select state, stripe_ref from hosting_payments where id = $1', [rec.id])).rows.map((x) => [x.state, x.stripe_ref]), [['succeeded', 'py_replay']]);
});
