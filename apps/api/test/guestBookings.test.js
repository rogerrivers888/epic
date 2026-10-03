/**
 * The guest side (routes/guestBookings.js, hosting v4 §4): booking each lane,
 * who may come, paying through a fake Stripe, Ask to book, the waiting list,
 * cancelling under the policy, Trips › Booked, after the event, tips and
 * invitations. Nothing leaves the machine and nothing is spent.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';

// --- a fake Stripe: PaymentIntents whose state the test sets ---------------
const intents = new Map();
let failIntents = false;
const calls = [];
let n = 0;
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    calls.push({ method: req.method, url: req.url, body, idem: req.headers['idempotency-key'] ?? null });
    const json = (o, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const form = new URLSearchParams(body);
    if (req.url === '/v1/payment_intents' && req.method === 'POST') {
      if (failIntents) return json({ error: { code: 'api_error' } }, 500);
      n += 1;
      const meta = {}; for (const [k, v] of form) { const m = /^metadata\[(.+)\]$/.exec(k); if (m) meta[m[1]] = v; }
      const pi = { id: `pi_${n}`, object: 'payment_intent', client_secret: `pi_${n}_secret`, amount: Number(form.get('amount')), amount_received: 0, status: form.get('capture_method') === 'manual' ? 'requires_payment_method' : 'requires_payment_method', manual: form.get('capture_method') === 'manual', metadata: meta };
      intents.set(pi.id, pi);
      return json(pi);
    }
    const m = /^\/v1\/payment_intents\/([^/]+)(\/(capture|cancel))?$/.exec(req.url);
    if (m) {
      const pi = intents.get(m[1]);
      if (!pi) return json({ error: { code: 'resource_missing' } }, 404);
      if (m[3] === 'capture') { pi.status = 'succeeded'; pi.amount_received = pi.amount; }
      if (m[3] === 'cancel') pi.status = 'canceled';
      return json(pi);
    }
    if (req.url === '/v1/refunds' && req.method === 'POST') return json({ id: `re_${calls.length}`, object: 'refund', status: 'succeeded', amount: Number(form.get('amount')) });
    return json({ error: { code: 'not_found' } }, 404);
  });
});
fake.listen(0, '127.0.0.1');
await new Promise((r) => fake.once('listening', r));
process.env.STRIPE_API_BASE = `http://127.0.0.1:${fake.address().port}`;
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';

/** The guest pays: the card goes through (or, for a hold, is held). */
const pays = (id) => { const pi = intents.get(id); if (pi.manual) pi.status = 'requires_capture'; else { pi.status = 'succeeded'; pi.amount_received = pi.amount; } };

const { aHousehold, testDatabase } = await import('./helpers/db.js');
const { query, pool } = await testDatabase();
const guest = await import('../src/routes/guestBookings.js');
const settings = await import('../src/repositories/hostingSettings.js');
const engine = await import('../src/sources/bookingMoney.js');
const { runAsAccount } = await import('../src/context.js');
const { plusDays, localDay } = await import('../src/domain/lanes.js');

test.after(async () => { settings.forget(); await new Promise((r) => fake.close(r)); await pool?.end?.(); });

const today = () => localDay(new Date(), 'Europe/London');

async function aPerson(name = 'Priya Patel') {
  const { household, member } = await aHousehold(query);
  const { rows: [account] } = await query(
    "insert into accounts (household_id, member_id, email, role, status, name) values ($1,$2,$3,'customer','active',$4) returning *",
    [household.id, member.id, `g-${crypto.randomUUID().slice(0, 8)}@example.com`, name],
  );
  return { household, account };
}

async function server(account) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = null; runAsAccount(account, next); });
  app.use('/api', guest.publicRouter);
  app.use('/api', guest.default);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.code ?? 'x', message: err.message }));
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

async function anEvent({ lane = 'oneoff', price = null, priceMode = 'free', max = 10, min = null, total = null, policy = 'flexible', ageMin = null, ageMax = null, parents = null, waitlist = false, sessions = 1, firstIn = 10, money = 'epic', hostOld = true } = {}) {
  const host = await aPerson('Kate Morris');
  const { rows: [h] } = await query(`insert into hosts (household_id, name, created_at) values ($1, 'Kate Morris', $2) returning *`, [host.household.id, hostOld ? new Date(Date.now() - 400 * 86_400_000) : new Date()]);
  const { rows: [o] } = await query(
    `insert into host_offers (host_id, shape, lane, state, title, visibility, max_count, min_count, price_pence, drop_in_pence, book_ahead_pence, price_mode, total_pence, refund_policy, age_min, age_max, parents, waitlist_on, money, free_hours, session_lengths, notice_hours)
     values ($1, $2, $3, 'live', 'Pottery', 'public', $4, $5, $6, $6, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, '[60]'::jsonb, 0) returning *`,
    [h.id, lane === 'oneoff' ? 'oneoff' : lane === 'onrequest' ? 'anytime' : 'series', lane, max, min, price, priceMode, total, policy, ageMin, ageMax, parents, waitlist, money,
      JSON.stringify(Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [String(d), [['09:00', '17:00']]])))],
  );
  const list = [];
  for (let i = 0; i < (lane === 'onrequest' ? 0 : sessions); i += 1) {
    const { rows: [s] } = await query(`insert into offer_sessions (offer_id, n, on_date, starts_at, ends_at) values ($1, $2, $3, '10:00', '12:00') returning *`, [o.id, i + 1, plusDays(today(), firstIn + i * 7)]);
    list.push(s);
  }
  return { host, h, o, sessions: list };
}

test('a free one-off: booked at once, both told, and the places counted', async () => {
  settings.forget();
  const { o, host } = await anEvent({ max: 3 });
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const opts = await srv.get(`/api/experiences/${o.id}/booking/options`);
    assert.equal(opts.body.action, 'book');
    assert.deepEqual(opts.body.kinds, ['whole']);
    const r = await srv.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 2 } });
    assert.equal(r.status, 201);
    assert.equal(r.body.booking.state, 'confirmed');
    assert.equal(r.body.pay, null);
    const { rows: told } = await query(`select kind from notifications where household_id = any($1) order by kind`, [[a.household.id, host.household.id]]);
    assert.deepEqual(told.map((x) => x.kind), ['booking_confirmed', 'new_booking']);
    const b2 = await aPerson();
    const srv2 = await server(b2.account);
    try {
      const full = await srv2.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 2 } });
      assert.equal(full.status, 409, 'three places, two taken: two more is too many');
      assert.equal((await srv2.get(`/api/experiences/${o.id}/booking/options`)).body.sessions[0].placesLeft, 1);
    } finally { await srv2.close(); }
  } finally { await srv.close(); }
});

test('who can come: adults only needs the tick; drop off needs a number per child; ages in range', async () => {
  const adults = await anEvent({ ageMin: 18 });
  const kids = await anEvent({ ageMin: 5, ageMax: 8, parents: 'drop_off' });
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    assert.equal((await srv.send('POST', `/api/experiences/${adults.o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 } })).body.error, 'adult_tick');
    assert.equal((await srv.send('POST', `/api/experiences/${adults.o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1, children: [{ age: 9 }], adultConfirmed: true } })).body.error, 'adults_only');
    assert.equal((await srv.send('POST', `/api/experiences/${kids.o.id}/booking`, { when: { kind: 'whole' }, party: { children: [{ age: 6 }] } })).body.error, 'emergency_contact');
    assert.equal((await srv.send('POST', `/api/experiences/${kids.o.id}/booking`, { when: { kind: 'whole' }, party: { children: [{ age: 4, emergencyContact: '07700 900 111' }] } })).body.error, 'too_young');
    const dob = `${Number(today().slice(0, 4)) - 7}-01-15`;
    const ok = await srv.send('POST', `/api/experiences/${kids.o.id}/booking`, { when: { kind: 'whole' }, party: { children: [{ name: 'Ava', dob, emergencyContact: '07700 900 111' }] } });
    assert.equal(ok.status, 201, 'a date of birth instead of an age');
    const { rows: [k] } = await query('select age, date_of_birth from booking_children where booking_id = $1', [ok.body.booking.id]);
    assert.deepEqual([k.age, String(k.date_of_birth).slice(0, 10)], [null, dob], 'age or date of birth, never both');
  } finally { await srv.close(); }
});

test('paid weekly, book ahead: a PaymentIntent with its own key; paying confirms it and the fee is stored as it was', async () => {
  settings.forget();
  const { o, sessions } = await anEvent({ lane: 'weekly', price: 1500, priceMode: 'same_each', sessions: 3 });
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const q = await srv.send('POST', `/api/experiences/${o.id}/booking/quote`, { when: { kind: 'book_ahead', sessionIds: [sessions[0].id, sessions[2].id] }, party: { adults: 2 } });
    assert.equal(q.body.valuePence, 6000, '£15 × 2 people × 2 sessions');
    const r = await srv.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'book_ahead', sessionIds: [sessions[0].id, sessions[2].id] }, party: { adults: 2 } });
    assert.equal(r.status, 201);
    assert.equal(r.body.booking.state, 'pending_payment');
    const pi = r.body.pay.paymentIntent;
    assert.equal(calls.find((c) => c.url === '/v1/payment_intents' && c.body.includes(r.body.booking.id))?.idem, `booking-${r.body.booking.id}`);
    const { rows: [b] } = await query('select * from experience_bookings where id = $1', [r.body.booking.id]);
    assert.deepEqual([b.fee_reason, Number(b.fee_rate_pct), b.fee_pence, b.host_pence], ['standard', 20, 1200, 4800], 'a host out of the intro, no ratings: 20%');
    pays(pi);
    const confirm = await srv.send('POST', `/api/booked/${b.id}/payment`, {});
    assert.deepEqual([confirm.body.state, confirm.body.paymentState], ['confirmed', 'charged']);
    const { rows: [row] } = await query(`select state, epic_pence, host_pence from hosting_payments where stripe_ref = $1`, [pi]);
    assert.deepEqual([row.state, row.epic_pence, row.host_pence], ['succeeded', 1200, 4800]);
  } finally { await srv.close(); }
});

test('depends on numbers: everyone pays the minimum-numbers price now', async () => {
  const { o } = await anEvent({ priceMode: 'by_numbers', total: 30000, min: 6 });
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const q = await srv.send('POST', `/api/experiences/${o.id}/booking/quote`, { when: { kind: 'whole' }, party: { adults: 2 } });
    assert.equal(q.body.valuePence, 10000, '£300 ÷ 6 = £50 each, two of them');
    assert.equal(q.body.numbers.nowEach, 5000);
  } finally { await srv.close(); }
});

test('Ask to book: the card is held; the host accepts and it is charged, with a session made', async () => {
  settings.forget();
  const { o, host } = await anEvent({ lane: 'onrequest', price: 6000, priceMode: 'same_each' });
  const a = await aPerson();
  const srv = await server(a.account);
  const hostSrv = await server(host.account);
  try {
    const opts = await srv.get(`/api/experiences/${o.id}/booking/options`);
    assert.equal(opts.body.action, 'ask');
    const day = opts.body.slots[1];
    const r = await srv.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'request', date: day.date, time: day.times[0], lengthMin: 60 }, party: { adults: 1 } });
    assert.equal(r.status, 201);
    assert.equal(r.body.pay.hold, true);
    assert.ok(intents.get(r.body.pay.paymentIntent).manual, 'held, not charged');
    pays(r.body.pay.paymentIntent);
    await srv.send('POST', `/api/booked/${r.body.booking.id}/payment`, {});
    assert.equal((await query('select payment_state from experience_bookings where id = $1', [r.body.booking.id])).rows[0].payment_state, 'held');
    const acc = await hostSrv.send('POST', `/api/host/lanes/requests/${r.body.booking.id}/accept`, {});
    assert.equal(acc.status, 200);
    const { rows: [b] } = await query('select state, payment_state, request_state, charged_pence from experience_bookings where id = $1', [r.body.booking.id]);
    assert.deepEqual([b.state, b.payment_state, b.request_state, b.charged_pence], ['confirmed', 'charged', 'accepted', 6000]);
    assert.equal((await query('select count(*)::int as n from booking_sessions where booking_id = $1', [r.body.booking.id])).rows[0].n, 1);
    assert.equal((await hostSrv.send('POST', `/api/host/lanes/requests/${r.body.booking.id}/decline`, {})).status, 409, 'answered once');
  } finally { await srv.close(); await hostSrv.close(); }
});

test('a request nobody answers lapses; the hold is let go and the guest told', async () => {
  const { o } = await anEvent({ lane: 'onrequest' });
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const day = (await srv.get(`/api/experiences/${o.id}/booking/options`)).body.slots[0];
    const r = await srv.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'request', date: day.date, time: day.times[0], lengthMin: 60 }, party: { adults: 1 } });
    await query(`update experience_bookings set respond_by = now() - interval '1 minute' where id = $1`, [r.body.booking.id]);
    await guest.lapseRequests();
    const { rows: [b] } = await query('select state, request_state from experience_bookings where id = $1', [r.body.booking.id]);
    assert.deepEqual([b.state, b.request_state], ['cancelled', 'lapsed']);
    assert.equal((await query(`select count(*)::int as n from notifications where household_id = $1 and kind = 'ask_to_book_declined'`, [a.household.id])).rows[0].n, 1);
  } finally { await srv.close(); }
});

async function paidBooking(srv, o, when, party = { adults: 1 }) {
  const r = await srv.send('POST', `/api/experiences/${o.id}/booking`, { when, party });
  pays(r.body.pay.paymentIntent);
  await srv.send('POST', `/api/booked/${r.body.booking.id}/payment`, {});
  return r.body.booking.id;
}

test('cancelling: the policy agreed at booking, a full refund after a date change, nothing once a course has started', async () => {
  settings.forget();
  const flex = await anEvent({ price: 4000, priceMode: 'same_each', firstIn: 5 });
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const id = await paidBooking(srv, flex.o, { kind: 'whole' });
    const quote = await srv.get(`/api/booked/${id}/cancel-quote`);
    assert.equal(quote.body.pence, 4000, 'flexible, five days out: everything');
    // Inside a day: nothing.
    const soon = new Date(Date.now() + 5 * 3_600_000);
    await query(`update offer_sessions set on_date = $2, starts_at = $3, ends_at = null where offer_id = $1`, [flex.o.id, localDay(soon, 'Europe/London'), soon.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })]);
    assert.equal((await srv.get(`/api/booked/${id}/cancel-quote`)).body.pence, 0);
    // The host moved it after they booked: everything, whatever the policy.
    await query(`update offer_sessions set changed_from = $2::jsonb where offer_id = $1`, [flex.o.id, JSON.stringify({ onDate: '2026-01-01', at: new Date().toISOString() })]);
    const moved = await srv.get(`/api/booked/${id}/cancel-quote`);
    assert.deepEqual([moved.body.pence, moved.body.cause], [4000, 'date_changed']);
    // Keep my place accepts the move: the policy applies again (Codex, 2 Oct 2026).
    await srv.send('POST', `/api/booked/${id}/keep`, {});
    assert.equal((await srv.get(`/api/booked/${id}/cancel-quote`)).body.pence, 0);
    await query(`update experience_bookings set change_seen_at = null where id = $1`, [id]);
    const c = await srv.send('POST', `/api/booked/${id}/cancel`, {});
    assert.equal(c.body.refundPence, 4000);
    assert.equal((await query(`select cause from hosting_payments where booking_id = $1 and kind = 'refund'`, [id])).rows[0].cause, 'date_changed');
    assert.equal((await srv.send('POST', `/api/booked/${id}/cancel`, {})).status, 409, 'once');
  } finally { await srv.close(); }

  const weekly = await anEvent({ lane: 'weekly', price: 1000, priceMode: 'same_each', sessions: 4 });
  const b = await aPerson();
  const srv2 = await server(b.account);
  try {
    const ids = weekly.sessions.map((s) => s.id);
    const id = await paidBooking(srv2, weekly.o, { kind: 'book_ahead', sessionIds: ids });
    const one = await srv2.send('POST', `/api/booked/${id}/cancel`, { sessionIds: [ids[3]] });
    assert.deepEqual([one.body.refundPence, one.body.whole], [1000, false], 'one session of four: its share');
  } finally { await srv2.close(); }
});

test('the waiting list: join when full, a freed place is offered to the first in line and held for them', async () => {
  settings.forget();
  const { o } = await anEvent({ max: 2, waitlist: true });
  const [a, b, c] = [await aPerson(), await aPerson(), await aPerson()];
  const [sa, sb, sc] = [await server(a.account), await server(b.account), await server(c.account)];
  try {
    const first = await sa.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 2 } });
    assert.equal((await sb.get(`/api/experiences/${o.id}/booking/options`)).body.action, 'waitlist');
    assert.equal((await sb.send('POST', `/api/experiences/${o.id}/waitlist`, { party: 1 })).body.position, 1);
    assert.equal((await sc.send('POST', `/api/experiences/${o.id}/waitlist`, { party: 1 })).body.position, 2);
    assert.equal((await sb.send('POST', `/api/experiences/${o.id}/waitlist`, { party: 1 })).status, 409, 'once');
    await sa.send('POST', `/api/booked/${first.body.booking.id}/cancel`, {});
    await guest.offerFreedPlaces();
    assert.equal((await query(`select state from offer_waitlist where household_id = $1`, [b.household.id])).rows[0].state, 'offered');
    // Two places free, one held for B: C can't take B's; B can.
    assert.equal((await sc.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 2 } })).status, 409);
    assert.equal((await sb.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 } })).status, 201);
    assert.equal((await query(`select state from offer_waitlist where household_id = $1`, [b.household.id])).rows[0].state, 'taken');
    // Two places were freed: the next run offers the second one to C, first in line now.
    await guest.offerFreedPlaces();
    const booked = await sc.get('/api/booked');
    assert.equal(booked.body.upcoming.find((x) => x.chip === 'waitlist')?.chipWords, 'Your place is ready');
  } finally { await sa.close(); await sb.close(); await sc.close(); }
});

test('Trips › Booked and the booking page: upcoming, past, invites; answers editable until a day before', async () => {
  const { o } = await anEvent({ firstIn: 3 });
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const r = await srv.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 }, answers: { dietary: 'Vegetarian', sneaky: 'dropped' } });
    const list = await srv.get('/api/booked');
    assert.equal(list.body.upcoming[0].id, r.body.booking.id);
    assert.equal(list.body.upcoming[0].chip, 'on');
    const page = await srv.get(`/api/booked/${r.body.booking.id}`);
    assert.deepEqual(page.body.booking.answers, { dietary: 'Vegetarian' }, 'only what the host may ask');
    assert.equal(page.body.booking.answersEditable, true);
    assert.equal((await srv.send('PATCH', `/api/booked/${r.body.booking.id}/answers`, { answers: { dietary: 'Vegan' } })).body.answers.dietary, 'Vegan');
    await query(`update offer_sessions set on_date = $2 where offer_id = $1`, [o.id, plusDays(today(), 0)]);
    await query(`update offer_sessions set starts_at = '23:58' where offer_id = $1`, [o.id]);
    assert.equal((await srv.send('PATCH', `/api/booked/${r.body.booking.id}/answers`, { answers: { dietary: 'x' } })).status, 409);
    const other = await aPerson();
    const os = await server(other.account);
    try { assert.equal((await os.get(`/api/booked/${r.body.booking.id}`)).status, 404, 'somebody else’s booking is not there'); } finally { await os.close(); }
  } finally { await srv.close(); }
});

test('after the event: did it happen (a complaint holds the payout), rate once, tip within a week', async () => {
  settings.forget();
  const { o, h } = await anEvent({ firstIn: 1 });
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const r = await srv.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 } });
    const id = r.body.booking.id;
    assert.equal((await srv.send('POST', `/api/booked/${id}/happened`, { answer: 'yes' })).status, 409, 'not before it happens');
    await query(`update offer_sessions set on_date = $2 where offer_id = $1`, [o.id, plusDays(today(), -1)]);
    assert.equal((await srv.send('POST', `/api/booked/${id}/happened`, { answer: 'wrong', reason: 'It never started' })).status, 200);
    assert.equal((await query(`select count(*)::int as n from hosting_complaints where booking_id = $1 and state = 'open'`, [id])).rows[0].n, 1);
    assert.equal((await srv.send('POST', `/api/booked/${id}/rate`, { stars: 4, text: 'Good fun', chips: ['Patient'] })).status, 201);
    assert.equal((await srv.send('POST', `/api/booked/${id}/rate`, { stars: 5 })).status, 409);
    // Shown only after the review window, to the hour; the host hears of it when it shows, not before (Codex, 3 Oct 2026).
    const { rows: [rv] } = await query(`select id, publish_on >= (now() + interval '48 hours')::date as later from host_reviews where booking_id = $1`, [id]);
    assert.equal(rv.later, true, 'not before 48 hours have passed');
    const told = async () => (await query(`select count(*)::int as n from notifications where dedupe_key = $1`, [`review:${rv.id}`])).rows[0].n;
    assert.equal(await told(), 0, 'not told before it shows');
    await query(`update host_reviews set publish_on = current_date where id = $1`, [rv.id]);
    await guest.guestPrompts();
    await guest.guestPrompts();
    assert.equal(await told(), 1, 'told once when it shows');
    // A window of nought shows it the same day.
    await query(`update hosting_settings set value = '0'::jsonb where key = 'review_window'`);
    settings.forget();
    const { rows: [b2] } = await query(`select id from experience_bookings where id = $1`, [id]);
    await query(`delete from host_reviews where booking_id = $1`, [b2.id]);
    await query(`update experience_bookings set rated_at = null where id = $1`, [b2.id]);
    assert.equal((await srv.send('POST', `/api/booked/${id}/rate`, { stars: 4 })).status, 201);
    assert.equal((await query(`select publish_on = current_date as today from host_reviews where booking_id = $1`, [id])).rows[0].today, true);
    await query(`update hosting_settings set value = '48'::jsonb where key = 'review_window'`);
    settings.forget();
    const tip = await srv.send('POST', `/api/booked/${id}/tip`, { amountPence: 500 });
    assert.equal(tip.status, 201);
    assert.deepEqual([tip.body.tip.feePence, tip.body.tip.totalPence], [30, 530], '£5 tip + 30p fee');
    const pi = intents.get(tip.body.pay.paymentIntent);
    assert.equal(pi.metadata.epic_kind, 'tip');
    pays(pi.id);
    // The page reads the tip back itself, rather than waiting on the webhook (Codex, 3 Oct 2026).
    const back = await srv.send('POST', `/api/booked/${id}/tip/payment`, {});
    assert.equal(back.body.state, 'paid', JSON.stringify(back.body));
    const { rows: [t] } = await query('select state from booking_tips where booking_id = $1', [id]);
    assert.equal(t.state, 'paid');
    const { rows: [row] } = await query(`select host_pence, epic_pence from hosting_payments where kind = 'tip' and booking_id = $1`, [id]);
    assert.deepEqual([row.host_pence, row.epic_pence], [500, 30], 'the host keeps all of it');
    void h;
    await query(`update offer_sessions set on_date = $2 where offer_id = $1`, [o.id, plusDays(today(), -9)]);
    assert.equal((await srv.send('POST', `/api/booked/${id}/tip`, { amountPence: 500 })).body.error, 'tip_closed', 'tips close after seven days');
  } finally { await srv.close(); }
});

test('an invitation answered on Epic becomes a booking in Trips; can’t come is recorded', async () => {
  const { o } = await anEvent();
  await query(`update host_offers set visibility = 'invite' where id = $1`, [o.id]);
  const tokenYes = crypto.randomUUID();
  const tokenNo = crypto.randomUUID();
  await query(`insert into offer_invites (offer_id, name, contact, heads, token) values ($1, 'Ann', 'ann@example.com', 2, $2), ($1, 'Bo', 'bo@example.com', 1, $3)`, [o.id, tokenYes, tokenNo]);
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const yes = await srv.send('POST', `/api/invited/${tokenYes}/book`, { rsvp: 'yes', when: { kind: 'whole' }, party: { adults: 2 } });
    assert.equal(yes.status, 201);
    const { rows: [inv] } = await query('select rsvp, booking_id, household_id from offer_invites where token = $1', [tokenYes]);
    assert.deepEqual([inv.rsvp, inv.booking_id, inv.household_id], ['yes', yes.body.booking.id, a.household.id]);
    assert.equal((await query('select source from experience_bookings where id = $1', [yes.body.booking.id])).rows[0].source, 'invite');
    assert.equal((await srv.send('POST', `/api/invited/${tokenYes}/book`, { rsvp: 'yes', when: { kind: 'whole' }, party: { adults: 1 } })).status, 409);
    assert.equal((await srv.send('POST', `/api/invited/${tokenNo}/book`, { rsvp: 'no' })).body.rsvp, 'no');
  } finally { await srv.close(); }
});

test('a host who has paused takes no new bookings; nobody books their own event', async () => {
  const { o, h, host } = await anEvent();
  await query('update hosts set paused = true where id = $1', [h.id]);
  const a = await aPerson();
  const srv = await server(a.account);
  const own = await server(host.account);
  try {
    assert.equal((await srv.get(`/api/experiences/${o.id}/booking/options`)).body.action, 'closed');
    assert.equal((await srv.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 } })).body.error, 'host_paused');
    await query('update hosts set paused = false where id = $1', [h.id]);
    assert.equal((await own.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 } })).body.error, 'own_event');
  } finally { await srv.close(); await own.close(); }
});

test('the refund queue sends a guest cancellation through Stripe once', async () => {
  const before = calls.filter((c) => c.url === '/v1/refunds').length;
  const out = await engine.processRefunds();
  assert.ok(out.sent >= 1);
  assert.equal((await engine.processRefunds()).sent, 0);
  assert.ok(calls.filter((c) => c.url === '/v1/refunds').length > before);
});

test('Codex: Stripe failing mid-way never strands a booking, a tip, an accepted request or a waiting-list place', async () => {
  settings.forget();
  // A waiting list only when it is full.
  const roomy = await anEvent({ max: 5, waitlist: true });
  const a = await aPerson();
  const sa = await server(a.account);
  try {
    assert.equal((await sa.send('POST', `/api/experiences/${roomy.o.id}/waitlist`, { party: 1 })).body.error, 'not_full');
  } finally { await sa.close(); }

  // PaymentIntent creation fails: the places go back.
  const paid = await anEvent({ price: 2000, priceMode: 'same_each', max: 2 });
  const b = await aPerson();
  const sb = await server(b.account);
  try {
    failIntents = true;
    const r = await sb.send('POST', `/api/experiences/${paid.o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 2 } });
    assert.ok(r.status >= 500);
    const { rows: [bk] } = await query('select state, cancel_cause from experience_bookings where offer_id = $1', [paid.o.id]);
    assert.deepEqual([bk.state, bk.cancel_cause], ['cancelled', 'payment_setup_failed']);
  } finally { failIntents = false; await sb.close(); }
  const c = await aPerson();
  const sc = await server(c.account);
  try {
    assert.equal((await sc.send('POST', `/api/experiences/${paid.o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 2 } })).status, 201, 'the two places came back');
  } finally { await sc.close(); }
});

test('Codex: a guest who cancels inside the no-refund window gives the place back, and the host is still paid for it', async () => {
  settings.forget();
  const ev = await anEvent({ price: 3000, priceMode: 'same_each', firstIn: 5, max: 2 });
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const id = await paidBooking(srv, ev.o, { kind: 'whole' }, { adults: 2 });
    const soon = new Date(Date.now() + 3 * 3_600_000);
    await query(`update offer_sessions set on_date = $2, starts_at = $3, ends_at = null where offer_id = $1`, [ev.o.id, localDay(soon, 'Europe/London'), soon.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })]);
    const c = await srv.send('POST', `/api/booked/${id}/cancel`, {});
    assert.equal(c.body.refundPence, 0, 'flexible, three hours out: nothing back');
    assert.equal((await query('select state from booking_sessions where booking_id = $1', [id])).rows[0].state, 'forfeited');
    assert.equal((await srv.get(`/api/experiences/${ev.o.id}/booking/options`)).body.sessions[0].placesLeft, 2, 'the places are free again');
    const ledger = await import('../src/repositories/hostingLedger.js');
    const rows = await ledger.paidBookingsOfSession(ev.sessions[0].id);
    assert.equal(rows.length, 1, 'the payout still counts the money kept');
  } finally { await srv.close(); }
});

test('Codex: a payment that lands after the booking was let go is refunded in full, and nobody is told it is on', async () => {
  settings.forget();
  const ev = await anEvent({ price: 2500, priceMode: 'same_each' });
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const r = await srv.send('POST', `/api/experiences/${ev.o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 } });
    await query(`update experience_bookings set created_at = now() - interval '1 hour' where id = $1`, [r.body.booking.id]);
    await guest.dropUnpaid();
    pays(r.body.pay.paymentIntent);
    await srv.send('POST', `/api/booked/${r.body.booking.id}/payment`, {});
    const { rows: [b] } = await query('select state, payment_state, refunded_pence from experience_bookings where id = $1', [r.body.booking.id]);
    assert.deepEqual([b.state, b.payment_state, b.refunded_pence], ['cancelled', 'charged', 2500]);
    assert.equal((await query(`select count(*)::int as n from notifications where household_id = $1 and kind = 'booking_confirmed'`, [a.household.id])).rows[0].n, 0);
  } finally { await srv.close(); }
});

test('Codex: a private event needs its link or an invitation, and the host-link rate needs the host’s token', async () => {
  settings.forget();
  const priv = await anEvent();
  await query(`update host_offers set visibility = 'invite', link_token = 'tok123' where id = $1`, [priv.o.id]);
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    assert.equal((await srv.get(`/api/experiences/${priv.o.id}/booking/options`)).status, 404);
    assert.equal((await srv.get(`/api/experiences/${priv.o.id}/booking/options?l=tok123`)).status, 200);
    assert.equal((await srv.send('POST', `/api/experiences/${priv.o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 } })).status, 404);
    assert.equal((await srv.send('POST', `/api/experiences/${priv.o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 }, linkToken: 'tok123' })).status, 201);
  } finally { await srv.close(); }
  const pub = await anEvent({ price: 4000, priceMode: 'same_each' });
  const { rows: [{ link_token: tok }] } = await query('select link_token from hosts where id = $1', [pub.h.id]);
  const b = await aPerson();
  const sb = await server(b.account);
  try {
    const flagged = await sb.send('POST', `/api/experiences/${pub.o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 }, viaHostLink: true, source: 'link' });
    assert.equal((await query('select fee_reason from experience_bookings where id = $1', [flagged.body.booking.id])).rows[0].fee_reason, 'standard', 'a flag alone earns nothing');
    const c = await aPerson();
    const sc = await server(c.account);
    try {
      const real = await sc.send('POST', `/api/experiences/${pub.o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 }, hostLink: tok });
      assert.equal((await query('select fee_reason from experience_bookings where id = $1', [real.body.booking.id])).rows[0].fee_reason, 'host_link');
    } finally { await sc.close(); }
  } finally { await sb.close(); }
});

test('Codex: two tips at once make one, and a request cancelled before its hold lands lets the card go', async () => {
  settings.forget();
  const { o } = await anEvent({ firstIn: 1 });
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const r = await srv.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 } });
    await query(`update offer_sessions set on_date = $2 where offer_id = $1`, [o.id, plusDays(today(), -1)]);
    const both = await Promise.all([srv.send('POST', `/api/booked/${r.body.booking.id}/tip`, { amountPence: 500 }), srv.send('POST', `/api/booked/${r.body.booking.id}/tip`, { amountPence: 500 })]);
    assert.deepEqual(both.map((x) => x.status).sort(), [201, 409]);
  } finally { await srv.close(); }

  const ask = await anEvent({ lane: 'onrequest', price: 6000, priceMode: 'same_each' });
  const b = await aPerson();
  const sb = await server(b.account);
  try {
    const day = (await sb.get(`/api/experiences/${ask.o.id}/booking/options`)).body.slots[1];
    const req = await sb.send('POST', `/api/experiences/${ask.o.id}/booking`, { when: { kind: 'request', date: day.date, time: day.times[0], lengthMin: 60 }, party: { adults: 1 } });
    await sb.send('POST', `/api/booked/${req.body.booking.id}/cancel`, {});
    pays(req.body.pay.paymentIntent);
    await sb.send('POST', `/api/booked/${req.body.booking.id}/payment`, {});
    await engine.processRefunds();
    assert.equal(intents.get(req.body.pay.paymentIntent).status, 'canceled', 'the hold is let go, through the queue that retries');
    assert.equal((await query('select payment_state from experience_bookings where id = $1', [req.body.booking.id])).rows[0].payment_state, 'released');
  } finally { await sb.close(); }
});

test('Codex: a host can’t accept two requests that overlap', async () => {
  settings.forget();
  const { o, host } = await anEvent({ lane: 'onrequest' });
  const [a, b] = [await aPerson(), await aPerson()];
  const [sa, sb, sh] = [await server(a.account), await server(b.account), await server(host.account)];
  try {
    const day = (await sa.get(`/api/experiences/${o.id}/booking/options`)).body.slots[1];
    const ra = await sa.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'request', date: day.date, time: day.times[0], lengthMin: 60 }, party: { adults: 1 } });
    const rb = await sb.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'request', date: day.date, time: day.times[0], lengthMin: 60 }, party: { adults: 1 } });
    assert.equal((await sh.send('POST', `/api/host/lanes/requests/${ra.body.booking.id}/accept`)).status, 200);
    const second = await sh.send('POST', `/api/host/lanes/requests/${rb.body.booking.id}/accept`);
    assert.equal(second.body.error, 'clash');
  } finally { await sa.close(); await sb.close(); await sh.close(); }
});

test('the guest pages’ reads: payments config, the inbox, Not this time, and what is due back if the most come', async () => {
  settings.forget();
  // Payments: a publishable key only beside a test secret, and only a test one.
  const was = { s: process.env.STRIPE_SECRET_KEY, p: process.env.STRIPE_PUBLISHABLE_KEY };
  const { publishableKey } = await import('../src/sources/stripe.js');
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  assert.equal(publishableKey('pk_test_abc'), 'pk_test_abc');
  assert.equal(publishableKey('pk_live_abc'), null, 'a live key never beside a test secret');
  process.env.STRIPE_SECRET_KEY = 'sk_live_x';
  assert.equal(publishableKey('pk_test_abc'), null, 'nothing while Stripe is live and refused');
  process.env.STRIPE_SECRET_KEY = was.s; process.env.STRIPE_PUBLISHABLE_KEY = was.p;

  // Depends on numbers: the booking page carries the floor the price can reach.
  const { o } = await anEvent({ priceMode: 'by_numbers', total: 12000, min: 4, max: 12 });
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const cfg = await srv.get('/api/payments/config');
    assert.equal(typeof cfg.body.ready, 'boolean');
    const r = await srv.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 2 } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const page = await srv.get(`/api/booked/${r.body.booking.id}`);
    assert.equal(page.body.booking.numbers.paidEach, 3000, '£120 between the 4 it needs');
    assert.deepEqual(page.body.booking.numbers.atMost, { count: 12, each: 1000, dueBackPence: 4000 }, 'if 12 come, £10 each and £20 back on each of 2');
    assert.ok('topic' in page.body.booking.sessions[0]);

    // An Ask to book the host declined reads "Not this time", with the hold released.
    await query(`update experience_bookings set request_state = 'declined', state = 'cancelled' where id = $1`, [r.body.booking.id]);
    const list = await srv.get('/api/booked');
    const card = [...list.body.upcoming, ...list.body.past].find((c) => c.id === r.body.booking.id);
    assert.equal(card.chip, 'not_this_time');
    assert.equal(card.chipWords, 'Not this time');
    assert.equal(card.holdReleased, true);

    // The inbox: a question asked before booking is a thread, unread once the host answers.
    const { rows: [m] } = await query('select id from members where household_id = $1 limit 1', [a.household.id]);
    const { rows: [t] } = await query(
      `insert into chat_topics (context_type, context_id, tag_kind, tag_ref, audience, author_member_id, title) values ('offer', $1, 'offer_aspect', 'offer', 'host_only', $2, 'Is there parking?') returning id`,
      [o.id, m.id],
    );
    await query(`insert into chat_reads (target_type, target_id, member_id) values ('topic', $1, $2)`, [t.id, m.id]);
    const { rows: [hostMember] } = await query(`select m.id from members m join hosts h on h.household_id = m.household_id where h.id = $1 limit 1`, [o.host_id]);
    await query(`insert into chat_replies (topic_id, author_member_id, body) values ($1, $2, 'Yes, behind the hall')`, [t.id, hostMember.id]);
    // What is said to everyone booked is not for somebody who only asked (Codex, 3 Oct 2026).
    await query(
      `insert into chat_topics (context_type, context_id, tag_kind, tag_ref, audience, author_member_id, title, created_at) values ('offer', $1, 'offer_aspect', 'offer', 'everyone', $2, 'Door code is 4417', now() + interval '1 minute')`,
      [o.id, hostMember.id],
    );
    const inbox = await srv.get('/api/messages');
    assert.equal(inbox.status, 200, JSON.stringify(inbox.body));
    const thread = inbox.body.threads.find((x) => x.offerId === o.id);
    assert.equal(thread.last, 'Yes, behind the hall');
    assert.equal(thread.unread, 1);
    assert.equal(thread.topicId, t.id);
    assert.equal(inbox.body.unread >= 1, true);
  } finally { await srv.close(); }
});

test('a host’s profile: reviews with their replies, the total, and no reply time from too little', async () => {
  const repo = await import('../src/repositories/hosting.js');
  const { o, h } = await anEvent();
  const a = await aPerson('Amara Okoro');
  const { rows: [b] } = await query(`insert into experience_bookings (offer_id, host_id, household_id, state) values ($1, $2, $3, 'attended') returning id`, [o.id, h.id, a.household.id]);
  await query(`insert into host_reviews (booking_id, offer_id, host_id, household_id, stars, text, publish_on, reply) values ($1, $2, $3, $4, 3, 'Started late.', current_date - 1, 'Sorry — the start is 13:15 now.')`, [b.id, o.id, h.id, a.household.id]);
  const [r] = await repo.publishedReviews(h.id);
  assert.equal(r.reply, 'Sorry — the start is 13:15 now.');
  assert.equal(r.who, 'Amara', 'the reviewer by first name only');
  assert.equal(await repo.publishedReviewCount(h.id), 1);
  assert.equal(await repo.replyMinutesOf(h.id), null, 'never "usually replies within" from fewer than three answers');
});

test('a weekly class offers only the ways of booking its host priced: never a drop in at nothing', async () => {
  settings.forget();
  const { o } = await anEvent({ lane: 'weekly', priceMode: 'same_each', price: 1200, sessions: 3 });
  await query('update host_offers set drop_in_pence = null, book_ahead_pence = 1000 where id = $1', [o.id]);
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    assert.deepEqual((await srv.get(`/api/experiences/${o.id}/booking/options`)).body.kinds, ['book_ahead']);
    const dropIn = await srv.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'drop_in' }, party: { adults: 1 } });
    assert.equal(dropIn.status, 400, 'a drop in the host never priced is refused, not booked free');
    // An older offer with only its one price: both ways, at that price.
    await query('update host_offers set drop_in_pence = null, book_ahead_pence = null where id = $1', [o.id]);
    const guest = await import('../src/routes/guestBookings.js');
    assert.deepEqual(guest.kindsFor({ ...o, drop_in_pence: null, book_ahead_pence: null }), ['drop_in', 'book_ahead']);
    assert.deepEqual(guest.kindsFor({ ...o, drop_in_pence: 900, book_ahead_pence: null }), ['drop_in']);
    assert.deepEqual(guest.kindsFor({ ...o, price_mode: 'free' }), ['drop_in', 'book_ahead']);
  } finally { await srv.close(); }
});

test('a tip whose card failed and then went through on the same payment is paid and credited, once', async () => {
  settings.forget();
  const { o } = await anEvent({ firstIn: 1 });
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const r = await srv.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 } });
    await query(`update offer_sessions set on_date = $2 where offer_id = $1`, [o.id, plusDays(today(), -1)]);
    const tip = await srv.send('POST', `/api/booked/${r.body.booking.id}/tip`, { amountPence: 500 });
    assert.equal(tip.status, 201, JSON.stringify(tip.body));
    await query(`update booking_tips set state = 'failed' where id = $1`, [tip.body.tip.id]);
    const pi = intents.get(tip.body.pay.paymentIntent);
    pays(pi.id);
    await guest.applyPaymentIntent(pi);
    await guest.applyPaymentIntent(pi);
    assert.equal((await query('select state from booking_tips where id = $1', [tip.body.tip.id])).rows[0].state, 'paid');
    assert.equal((await query(`select count(*)::int as n from hosting_payments where kind = 'tip' and stripe_ref = $1`, [pi.id])).rows[0].n, 1, 'credited once');
  } finally { await srv.close(); }
});
