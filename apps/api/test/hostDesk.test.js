/**
 * The Host tab for hosts who already host (routes/hostDesk.js, hosting v4
 * E1–E13): the four states, the tiles, To do, At risk, the event page with
 * what a co-host may see, earnings, fees, reviews, and the things a host can
 * change about themselves. Nothing leaves the machine.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import express from 'express';

const { aHousehold, testDatabase } = await import('./helpers/db.js');
const { query, pool } = await testDatabase();
const desk = await import('../src/routes/hostDesk.js');
const settings = await import('../src/repositories/hostingSettings.js');
const { runAsAccount } = await import('../src/context.js');
const { plusDays, localDay } = await import('../src/domain/lanes.js');
const domain = await import('../src/domain/hostDesk.js');

test.after(async () => { settings.forget(); await pool?.end?.(); });

const today = () => localDay(new Date(), 'Europe/London');

async function anAccount(householdId, memberId, extra = {}) {
  const { rows: [a] } = await query(
    "insert into accounts (household_id, member_id, email, mobile, role, status, name) values ($1,$2,$3,$4,'customer','active',$5) returning *",
    [householdId, memberId, `d-${crypto.randomUUID().slice(0, 8)}@example.com`, extra.mobile ?? null, extra.name ?? 'Kate Morris'],
  );
  return a;
}

async function server(account) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = null; runAsAccount(account, next); });
  app.use('/api', desk.default);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.code ?? 'x', message: err.message }));
  const s = app.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  const out = (r) => (r.headers.get('content-type')?.includes('json') ? r.json() : r.text()).catch(() => null).then((body) => ({ status: r.status, body }));
  return {
    close: () => new Promise((r) => s.close(r)),
    get: (p) => fetch(base + p).then(out),
    send: (method, p, body) => fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then(out),
  };
}

/** A host with an account, ready to have events. */
async function aHost({ tax = 'QQ123456C' } = {}) {
  const { household, member } = await aHousehold(query);
  const account = await anAccount(household.id, member.id);
  const { rows: [host] } = await query(`insert into hosts (household_id, name, tax_reference, payouts_state) values ($1, 'Kate Morris', $2, 'ready') returning *`, [household.id, tax]);
  return { household, member, account, host };
}

async function anOffer(host, { lane = 'weekly', visibility = 'public', state = 'live', min = null, max = 8, price = 2000, priceMode = 'same_each', draftStep = null } = {}) {
  const { rows: [o] } = await query(
    `insert into host_offers (host_id, shape, lane, state, title, visibility, min_count, max_count, price_pence, price_mode, draft_step, money)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'epic') returning *`,
    [host.id, lane === 'oneoff' ? 'oneoff' : 'series', lane, state, `A ${lane}`, visibility, min, max, price, priceMode, draftStep],
  );
  return o;
}

async function aSession(offer, inDays, { decidesInHours = null } = {}) {
  const { rows: [s] } = await query(
    `insert into offer_sessions (offer_id, on_date, starts_at, ends_at, decides_at) values ($1, $2, '10:00', '12:00', $3) returning *`,
    [offer.id, plusDays(today(), inDays), decidesInHours == null ? null : new Date(Date.now() + decidesInHours * 3_600_000)],
  );
  return s;
}

let phones = 0;
const aPhone = () => `07700 9${String(Date.now() % 100000).padStart(5, '0')}${(phones += 1)}`;

async function aBooking(offer, sessions, { heads = 1, charged = 2000, hostPence = 1600, mobile = aPhone(), state = 'confirmed', pay = 'charged' } = {}) {
  const { household, member } = await aHousehold(query);
  await anAccount(household.id, member.id, { mobile, name: 'Priya Patel' });
  const { rows: [b] } = await query(
    `insert into experience_bookings (offer_id, host_id, household_id, heads, state, payment_state, charged_pence, host_pence, fee_pence, fee_rate_pct, fee_reason, value_pence)
     values ($1, $2, $3, $4, $8, $9, $5, $6, $7, 20, 'standard', $5) returning *`,
    [offer.id, offer.host_id, household.id, heads, charged, hostPence, charged - hostPence, state, pay],
  );
  for (const s of sessions) await query('insert into booking_sessions (booking_id, session_id) values ($1, $2)', [b.id, s.id]);
  return b;
}

test('a host with nothing yet gets 4e; a quiet host gets their unfinished draft', async () => {
  const { account, host } = await aHost();
  const srv = await server(account);
  try {
    assert.deepEqual((await srv.get('/api/host/desk')).body, { home: '4e' });
    await anOffer(host, { lane: 'oneoff', state: 'draft', draftStep: 'when' });
    const r = await srv.get('/api/host/desk');
    assert.equal(r.body.state, 'quiet');
    assert.equal(r.body.nextUp, null);
    assert.match(r.body.draft.words, /^Step \d+ of 8$/);
    assert.deepEqual(r.body.tiles.atRisk, 0, 'a tile with nothing in it is 0, not missing');
  } finally { await srv.close(); }
});

test('busy: next up, the three after, tiles, earnings and the ladder', async () => {
  settings.forget();
  const { account, host } = await aHost();
  const weekly = await anOffer(host, { min: 5 });
  const s1 = await aSession(weekly, 2);
  const s2 = await aSession(weekly, 9);
  const s3 = await aSession(weekly, 16, { decidesInHours: 24 * 5 });
  const past = await aSession(weekly, -3);
  await aBooking(weekly, [s1], { heads: 6 });
  await aBooking(weekly, [s3], { heads: 3 });
  await aBooking(weekly, [s3], { heads: 4, state: 'pending', pay: 'none' }); // a checkout not yet paid holds no place towards the minimum
  await aBooking(weekly, [past], { heads: 2, hostPence: 3000 });
  const srv = await server(account);
  try {
    const r = await srv.get('/api/host/desk');
    assert.equal(r.status, 200);
    assert.equal(r.body.state, 'busy');
    assert.equal(r.body.nextUp.first.sessionId, s1.id);
    assert.equal(r.body.nextUp.first.chip, 'on');
    assert.deepEqual(r.body.nextUp.more.map((m) => m.sessionId), [s2.id, s3.id]);
    assert.equal(r.body.nextUp.more[1].underMin, true, '3 of 8 · min 5');
    assert.equal(r.body.tiles.atRisk, 1);
    assert.equal(r.body.earnings.bars.length, 6);
    assert.ok(r.body.earnings.bookedAheadPence >= 3200);
    assert.equal(r.body.status.feePct, 0, 'a new host is in the 0% intro');
    assert.equal(r.body.status.standing.words, null, 'standing thresholds not set: can’t speak');
    assert.match(r.body.status.standing.reason, /not set/);

    const todo = await srv.get('/api/host/desk/todo');
    assert.ok([...todo.body.today, ...todo.body.week, ...todo.body.soon].some((t) => t.kind === 'attendance'), 'a finished session wants its attendance');

    const risk = await srv.get('/api/host/desk/at-risk');
    assert.equal(risk.body.atRisk.length, 1);
    assert.match(risk.body.atRisk[0].line, /called off, and the 3 booked get £20 back in full/);
  } finally { await srv.close(); }
});

test('private and free: no earnings hero, a party card; paid privately: the payment fee, no ladder', async () => {
  settings.forget();
  const a = await aHost();
  const party = await anOffer(a.host, { lane: 'oneoff', visibility: 'invite', priceMode: 'free', price: null });
  await aSession(party, 5);
  await query(`insert into offer_invites (offer_id, name, contact, heads, rsvp, token) values ($1, 'Ann', 'a@x.test', 2, 'yes', $2), ($1, 'Bo', 'b@x.test', 1, 'no', $3), ($1, 'Cy', 'c@x.test', 1, null, $4)`,
    [party.id, crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()]);
  const srv = await server(a.account);
  try {
    const r = await srv.get('/api/host/desk');
    assert.equal(r.body.state, 'private_free');
    assert.equal(r.body.earnings, null);
    assert.deepEqual([r.body.party.coming, r.body.party.cantCome, r.body.party.noReply], [2, 1, 1]);
    assert.equal(r.body.status.private, true);
  } finally { await srv.close(); }

  const b = await aHost();
  const chess = await anOffer(b.host, { visibility: 'invite', price: 500 });
  await aSession(chess, 3);
  const srv2 = await server(b.account);
  try {
    const r = await srv2.get('/api/host/desk');
    assert.equal(r.body.state, 'private_paid');
    assert.ok(r.body.earnings, 'a paid private host has earnings');
    assert.equal(r.body.status.paymentFeePct, 3);
    assert.equal(r.body.status.progress, undefined, 'no rating ladder');
  } finally { await srv2.close(); }
});

test('the event page: guests with their numbers until it finishes, children, attendance that releases nothing', async () => {
  const { account, host } = await aHost();
  const club = await anOffer(host, { min: null });
  await query(`update host_offers set parents = 'drop_off' where id = $1`, [club.id]);
  const ahead = await aSession(club, 4);
  const done = await aSession(club, -2);
  const phone = aPhone();
  const b1 = await aBooking(club, [ahead, done], { heads: 1, mobile: phone });
  await query(`insert into booking_children (booking_id, name, age, needs, emergency_contact) values ($1, 'Ava', 7, '["Nut allergy"]', '07700 900 999')`, [b1.id]);
  const srv = await server(account);
  try {
    const r = await srv.get(`/api/host/desk/events/${club.id}?session=${ahead.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.guests.length, 1);
    assert.equal(r.body.guests[0].phone, phone, 'shown from booking until the session finishes');
    assert.equal(r.body.guests[0].children[0].parentPhone, '07700 900 999', 'drop off: the parent’s number per child');
    assert.equal(r.body.guests[0].status, 'Paid');
    const past = await srv.get(`/api/host/desk/events/${club.id}?session=${done.id}`);
    assert.equal(past.body.guests[0].phone, null, 'hidden once it has finished');

    assert.equal((await srv.send('POST', `/api/host/desk/events/${club.id}/attendance`, { sessionId: ahead.id, marks: [] })).status, 409, 'not before it has happened');
    const saved = await srv.send('POST', `/api/host/desk/events/${club.id}/attendance`, { sessionId: done.id, marks: [{ bookingId: b1.id, present: true }] });
    assert.deepEqual([saved.body.in, saved.body.out], [1, 0]);
    assert.equal((await query(`select count(*)::int as n from host_payouts where session_id = $1 and state in ('released', 'paid')`, [done.id])).rows[0].n, 0, 'attendance releases nothing');

    assert.equal((await srv.send('POST', `/api/host/desk/events/${club.id}/waitlist`, { on: true })).body.on, true);
    assert.equal((await query('select waitlist_on from host_offers where id = $1', [club.id])).rows[0].waitlist_on, true);
  } finally { await srv.close(); }
});

test('lowering the minimum: only down, and never on Depends on numbers', async () => {
  const { account, host } = await aHost();
  const course = await anOffer(host, { lane: 'course', min: 5 });
  const split = await anOffer(host, { lane: 'oneoff', min: 6, priceMode: 'by_numbers' });
  const srv = await server(account);
  try {
    assert.equal((await srv.send('POST', `/api/host/desk/events/${course.id}/minimum`, { minCount: 7 })).status, 409);
    assert.equal((await srv.send('POST', `/api/host/desk/events/${course.id}/minimum`, { minCount: 3 })).body.minCount, 3);
    const r = await srv.send('POST', `/api/host/desk/events/${split.id}/minimum`, { minCount: 3 });
    assert.equal(r.status, 409);
    assert.match(r.body.message, /Depends-on-numbers/);
  } finally { await srv.close(); }
});

test('a co-host sees only what the host allowed, and nobody else sees the event at all', async () => {
  const owner = await aHost();
  // A co-host who hosts nothing of their own (Codex, 2 Oct 2026).
  const { household: hh, member: hm } = await aHousehold(query);
  const helper = { account: await anAccount(hh.id, hm.id, { name: 'Lena Ford' }) };
  const stranger = await aHost();
  const walk = await anOffer(owner.host);
  const s = await aSession(walk, 3);
  await aBooking(walk, [s]);
  await query(`insert into offer_cohosts (offer_id, account_id, name, role, sees_guests, can_message, can_see_money) values ($1, $2, 'Lena', 'cohost', true, true, false)`, [walk.id, helper.account.id]);
  const h = await server(helper.account);
  const x = await server(stranger.account);
  try {
    assert.equal((await h.get(`/api/host/desk/events/${walk.id}`)).status, 404, 'nothing before they accept');
    const invites = await h.get('/api/host/desk/cohost-invites');
    assert.equal(invites.body.invites.length, 1);
    assert.equal((await h.send('POST', `/api/host/desk/cohost-invites/${invites.body.invites[0].id}/accept`)).status, 200);
    const r = await h.get(`/api/host/desk/events/${walk.id}`);
    assert.equal(r.status, 200);
    assert.deepEqual([r.body.view.guests, r.body.view.money, r.body.view.dates, r.body.view.owner], [true, false, false, false]);
    assert.equal(r.body.money, null, 'no money');
    assert.equal((await h.send('POST', `/api/host/desk/events/${walk.id}/waitlist`, { on: true })).status, 403);
    const list = await h.get('/api/host/desk/events');
    assert.equal(list.body.helping.length, 1);
    assert.equal(list.body.helping[0].chip, 'cohost');
    assert.equal((await x.get(`/api/host/desk/events/${walk.id}`)).status, 404);
  } finally { await h.close(); await x.close(); }
});

test('fees: the ladder by rating, every booking’s fee as stored, your link', async () => {
  settings.forget();
  const { account, host } = await aHost();
  await query(`update hosts set created_at = now() - interval '200 days' where id = $1`, [host.id]);
  const o = await anOffer(host);
  const s = await aSession(o, 3);
  const b = await aBooking(o, [s]);
  await query(`update experience_bookings set fee_reason = 'host_link', fee_rate_pct = 5, fee_pence = 100 where id = $1`, [b.id]);
  const srv = await server(account);
  try {
    const r = await srv.get('/api/host/desk/fees');
    assert.equal(r.body.ratePct, 20);
    assert.deepEqual(r.body.ladder.map((x) => x.pct), [20, 15, 10]);
    assert.equal(r.body.ladder[0].current, true);
    assert.equal(r.body.movesBack, null, 'nowhere back from the first step');
    assert.equal(r.body.bookings[0].reasonWords, 'Through your link');
    assert.match(r.body.link.url, new RegExp(`/hosts/${host.id}\\?via=[0-9a-f]{32}$`));
    assert.ok(!JSON.stringify(r.body).includes('Trusted'), 'no "Epic Trusted" anywhere');
  } finally { await srv.close(); }
});

test('reviews: one public reply each, and a report goes to Epic once', async () => {
  const { account, host, household } = await aHost();
  const o = await anOffer(host);
  const s = await aSession(o, -5);
  const b = await aBooking(o, [s]);
  const { rows: [rev] } = await query(
    `insert into host_reviews (booking_id, offer_id, host_id, household_id, stars, text, publish_on, chips) values ($1, $2, $3, $4, 5, 'So patient.', current_date - 1, '["Patient"]') returning id`,
    [b.id, o.id, host.id, b.household_id],
  );
  void household;
  const srv = await server(account);
  try {
    const r = await srv.get('/api/host/desk/reviews');
    assert.equal(r.body.count, 1);
    assert.deepEqual(r.body.stars.map((x) => x.count), [1, 0, 0, 0, 0]);
    assert.equal(r.body.needsReply, 1);
    assert.equal((await srv.send('POST', `/api/host/desk/reviews/${rev.id}/reply`, { text: 'Thank you!' })).status, 200);
    assert.equal((await srv.send('POST', `/api/host/desk/reviews/${rev.id}/reply`, { text: 'Again' })).status, 409, 'one reply');
    assert.equal((await srv.send('POST', `/api/host/desk/reviews/${rev.id}/report`, {})).status, 400);
    assert.equal((await srv.send('POST', `/api/host/desk/reviews/${rev.id}/report`, { reason: 'Not about my event' })).status, 200);
  } finally { await srv.close(); }
});

test('profile: stop hosting is refused while a booking is outstanding; pause, co-hosts, quick replies, an incident', async () => {
  const { account, host } = await aHost();
  const o = await anOffer(host);
  const s = await aSession(o, 5);
  await aBooking(o, [s]);
  const srv = await server(account);
  try {
    const p = await srv.get('/api/host/desk/profile');
    assert.equal(p.body.settings.canStop, false);
    const stop = await srv.send('POST', '/api/host/desk/stop', {});
    assert.equal(stop.status, 409);
    assert.match(stop.body.message, /1 booking is still to happen/);
    const prof = (await srv.get('/api/host/desk/profile')).body.settings;
    assert.equal(prof.canStop, false, 'the settings say so before anyone presses Stop');
    assert.equal(prof.outstanding.bookings, 1);
    assert.equal((await srv.send('POST', '/api/host/desk/pause', { paused: true })).body.paused, true);

    assert.equal((await srv.send('POST', '/api/host/desk/cohosts', { name: 'Lena', contact: 'not a contact' })).status, 400);
    assert.equal((await srv.send('POST', '/api/host/desk/cohosts', { name: 'Lena Ford', contact: 'lena@example.com', guests: true })).status, 201);
    const after = await srv.get('/api/host/desk/profile');
    assert.equal(after.body.settings.cohosts.length, 1);
    assert.equal(after.body.settings.cohosts[0].guests, true);
    assert.equal(after.body.settings.cohosts[0].money, false);
    assert.equal((await srv.send('PATCH', `/api/host/desk/cohosts/${encodeURIComponent('lena ford')}`, { money: true })).status, 200);
    assert.equal((await srv.send('PATCH', `/api/host/desk/cohosts/${encodeURIComponent('lena ford')}`, { remove: true })).status, 200);

    const q = await srv.send('POST', '/api/host/desk/quick-replies', { body: 'Bring an apron.' });
    assert.equal(q.status, 201);
    assert.equal((await srv.send('DELETE', `/api/host/desk/quick-replies/${q.body.id}`)).status, 200);
    assert.equal((await srv.send('PUT', '/api/host/desk/auto-messages/reminder', { on: false })).status, 200);
    assert.equal((await srv.get('/api/host/desk/profile')).body.autoMessages.find((m) => m.kind === 'reminder').on, false);

    const inc = await srv.send('POST', '/api/host/desk/incidents', { sessionId: s.id, body: 'A child cut a finger; first aid given.', children: ['Ava'] });
    assert.equal(inc.status, 201);
    await assert.rejects(() => query('delete from session_incidents where id = $1', [inc.body.id]), /never deleted/);
  } finally { await srv.close(); }
});

test('a statement is a CSV with the DAC7 lines', async () => {
  const { account, host } = await aHost();
  await query(`insert into hosting_payments (kind, host_id, amount_pence, epic_pence, state, mode) values ('charge', $1, 2000, 400, 'succeeded', 'test'), ('payout', $1, 1600, null, 'succeeded', 'test')`, [host.id]);
  const srv = await server(account);
  try {
    const r = await srv.get(`/api/host/desk/statements/${today().slice(0, 7)}.csv`);
    assert.equal(r.status, 200);
    assert.match(r.body, /DAC7 summary/);
    assert.match(r.body, /Epic's fees \(£\),4\.00/);
    assert.match(r.body, /Paid out to you \(£\),16\.00/);
    assert.equal((await srv.get('/api/host/desk/statements/last-year.csv')).status, 400);
  } finally { await srv.close(); }
});

test('the rules underneath: To do groups, standing, response time, moves back', () => {
  const now = new Date('2026-10-02T09:00:00Z');
  const g = domain.groupTodo([
    { kind: 'draft', title: 'd' },
    { kind: 'tax', title: 't', now: true, blocking: true },
    { kind: 'ask', title: 'a', due: '2026-10-02T14:00:00Z' },
    { kind: 'att', title: 'm', due: '2026-10-05T10:00:00Z' },
  ], now);
  assert.deepEqual([g.today.map((x) => x.kind), g.week.map((x) => x.kind), g.soon.map((x) => x.kind)], [['tax', 'ask'], ['att'], ['draft']]);
  assert.equal(g.today[0].red, true);
  assert.equal(domain.standingOf({ thresholds: null }).words, null);
  assert.equal(domain.standingOf({ thresholds: { avgBelowAtRisk: 4 }, avg: 3.5, ratedEvents: 6 }).words, 'At risk');
  assert.equal(domain.responseMinutes([10, 20]), null, 'two replies is not enough to say');
  assert.equal(domain.responseWords(domain.responseMinutes([60, 100, 200])), '1 h 40 min');
  assert.deepEqual(domain.movesBack([{ pct: 20 }, { pct: 15, ratedEvents: 5, avgAtLeast: 4.5 }], 15).words, 'Average under 4.5 · back to 20%');
});

test('a host’s switched-off notification sends no e-mail, wherever it comes from (Codex)', async () => {
  const { household, host } = await aHost();
  await query(`update hosts set notification_prefs = '{"new_booking": false}' where id = $1`, [host.id]);
  const notifications = await import('../src/repositories/notifications.js');
  const off = await notifications.notify({ householdId: household.id, kind: 'new_booking', title: 'x', dedupeKey: `nb:${host.id}` });
  const on = await notifications.notify({ householdId: household.id, kind: 'payout_sent', title: 'y', dedupeKey: `ps:${host.id}` });
  assert.deepEqual([off.email_state, on.email_state], ['none', 'queued'], 'still written; only the e-mail follows the switch');
});

test('Codex: a host’s automatic message goes with the guest’s notification, and switched off it doesn’t', async () => {
  const notifications = await import('../src/repositories/notifications.js');
  const { host } = await aHost();
  assert.match(await notifications.hostWords(host.id, 'confirmed'), /Thanks for booking/);
  await query(`insert into host_auto_messages (host_id, kind, is_on, body) values ($1, 'confirmed', true, 'Bring an apron!')`, [host.id]);
  assert.equal(await notifications.hostWords(host.id, 'confirmed'), 'Bring an apron!');
  await query(`update host_auto_messages set is_on = false where host_id = $1`, [host.id]);
  assert.equal(await notifications.hostWords(host.id, 'confirmed'), null);
});

test('offers made before the lanes: in All events, counted by Stop hosting, and the desk holds the tax details (Roger, 3 Oct 2026)', async () => {
  const { account, host } = await aHost();
  // One older offer still to come, one long past.
  const { rows: [soon] } = await query(
    `insert into host_offers (host_id, shape, lane, state, title, visibility, starts_on) values ($1, 'oneoff', null, 'live', 'Older walk', 'public', $2) returning *`,
    [host.id, plusDays(today(), 5)],
  );
  await query(`insert into host_offers (host_id, shape, lane, state, title, visibility, starts_on) values ($1, 'oneoff', null, 'live', 'Older talk', 'public', $2)`, [host.id, plusDays(today(), -40)]);
  const srv = await server(account);
  try {
    const home = (await srv.get('/api/host/desk')).body;
    assert.equal(home.home, 'desk', 'a host with only older offers has a desk');
    assert.notEqual(home.state, 'quiet', 'and something on');
    const ev = (await srv.get('/api/host/desk/events')).body;
    const live = ev.live.find((r) => r.title === 'Older walk');
    assert.ok(live?.older, 'still to come: Live, and it opens on its own page');
    assert.equal(live.lane, null);
    assert.ok(ev.finished.some((r) => r.title === 'Older talk' && r.older), 'past its date: Finished');
    // A series under way: its next date, not its first.
    await query(`insert into host_offers (host_id, shape, lane, state, title, visibility, first_date, weekday, sessions) values ($1, 'series', null, 'live', 'Older class', 'public', $2, $3, 6)`,
      [host.id, plusDays(today(), -14), new Date(`${plusDays(today(), -14)}T12:00:00Z`).getUTCDay()]);
    const series = (await srv.get('/api/host/desk/events')).body.live.find((r) => r.title === 'Older class');
    assert.ok(series?.next, JSON.stringify(series));
    assert.ok(series.next.date >= today(), `next is ${series.next.date}, not the first date`);

    // A booking on the older offer stops Stop hosting.
    const { household } = await aHousehold(query);
    await query(`insert into experience_bookings (offer_id, host_id, household_id, heads, state) values ($1, $2, $3, 2, 'confirmed')`, [soon.id, host.id, household.id]);
    const stop = await srv.send('POST', '/api/host/desk/stop');
    assert.equal(stop.status, 409, JSON.stringify(stop.body));
    assert.match(stop.body.message, /1 booking is still to happen/);

    // Payouts and tax: legal name, address and company, from their own columns.
    await query(`update hosts set legal_name = 'Katherine Morris', tax_address = '1 High St, Ascot', tax_is_company = true, company_number = '12345678' where id = $1`, [host.id]);
    const t = (await srv.get('/api/host/desk/profile')).body.settings.payouts.taxDetails;
    assert.deepEqual(t, { legalName: 'Katherine Morris', address: '1 High St, Ascot', isCompany: true, companyNumber: '12345678' });
  } finally { await srv.close(); }
});
