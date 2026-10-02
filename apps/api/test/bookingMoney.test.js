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
async function anEvent({ lane = 'oneoff', inDays = 10, days = 1, min = null, priceMode = 'same_each', totalPence = null, guests = [{ heads: 2, charged: 4000 }], decidesInHours = null } = {}) {
  const { household: hh } = await aHousehold(query);
  const { rows: [host] } = await query(`insert into hosts (household_id, name) values ($1, 'Kate') returning *`, [hh.id]);
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
      `insert into experience_bookings (offer_id, host_id, household_id, heads, state, payment_state, charged_pence, held_pence, host_pence, stripe_payment_intent)
       values ($1, $2, $3, $4, 'confirmed', $5, $6, $7, $8, $9) returning *`,
      [offer.id, host.id, gh.id, g.heads, g.held ? 'held' : 'charged', g.held ? null : g.charged, g.held ? g.charged : null, Math.round((g.charged ?? 0) * 0.8), `pi_${offer.id.slice(0, 8)}_${i}`],
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
});

test('the host hears once when an event is under its minimum close to decides-by', async () => {
  settings.forget();
  const { hostHousehold } = await anEvent({ min: 8, decidesInHours: 20, guests: [{ heads: 3, charged: 3000 }] });
  await engine.warnUnderMinimum();
  await engine.warnUnderMinimum();
  assert.equal((await query(`select count(*)::int as n from notifications where kind = 'under_minimum' and household_id = $1`, [hostHousehold.id])).rows[0].n, 1);
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
