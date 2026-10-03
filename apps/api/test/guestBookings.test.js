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
const setups = new Map();
let declineLater = false;
const calls = [];
let n = 0;
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    calls.push({ method: req.method, url: req.url, body, idem: req.headers['idempotency-key'] ?? null });
    const json = (o, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const form = new URLSearchParams(body);
    // A booking far ahead (L4): the household's customer and the card saved, for the host as merchant.
    if (req.url === '/v1/customers' && req.method === 'POST') return json({ id: `cus_${crypto.randomUUID().slice(0, 12)}` });
    if (req.url === '/v1/setup_intents' && req.method === 'POST') {
      if (!/^acct_/.test(form.get('on_behalf_of') ?? '') || form.get('usage') !== 'off_session' || !/^cus_/.test(form.get('customer') ?? '')) return json({ error: { code: 'bad_setup' } }, 400);
      n += 1;
      const meta = {}; for (const [k, v] of form) { const mm = /^metadata\[(.+)\]$/.exec(k); if (mm) meta[mm[1]] = v; }
      const si = { id: `seti_${n}`, object: 'setup_intent', client_secret: `seti_${n}_secret`, status: 'requires_payment_method', metadata: meta };
      setups.set(si.id, si);
      return json(si);
    }
    const sm = /^\/v1\/setup_intents\/([^/?]+)$/.exec(req.url);
    if (sm) return setups.has(sm[1]) ? json(setups.get(sm[1])) : json({ error: { code: 'resource_missing' } }, 404);
    // The later charge, off-session on the saved card: declined when the test says so (Stripe answers 402).
    if (req.url === '/v1/payment_intents' && req.method === 'POST' && form.get('off_session') === 'true') {
      const dest = form.get('transfer_data[destination]');
      if (!/^acct_/.test(dest ?? '') || form.get('on_behalf_of') !== dest || form.get('confirm') !== 'true' || !form.get('payment_method') || !form.get('customer')) return json({ error: { code: 'l1_no_destination' } }, 400);
      if (declineLater) return json({ error: { type: 'card_error', code: 'card_declined', decline_code: 'insufficient_funds' } }, 402);
      n += 1;
      const meta = {}; for (const [k, v] of form) { const mm = /^metadata\[(.+)\]$/.exec(k); if (mm) meta[mm[1]] = v; }
      const pi = { id: `pi_${n}`, object: 'payment_intent', status: 'succeeded', amount: Number(form.get('amount')), amount_received: Number(form.get('amount')), metadata: meta };
      intents.set(pi.id, pi);
      return json(pi);
    }
    if (req.url === '/v1/payment_intents' && req.method === 'POST') {
      // L1, held for every test in this file: a guest's payment is a destination charge to the host's own account,
      // with the host as merchant of record. A payment without them is refused here, so no test can pass making one.
      const dest = form.get('transfer_data[destination]');
      if (!/^acct_/.test(dest ?? '') || form.get('on_behalf_of') !== dest) return json({ error: { code: 'l1_no_destination', message: 'Booking money must go to the host’s account (L1).' } }, 400);
      if (failIntents) return json({ error: { code: 'api_error' } }, 500);
      n += 1;
      const meta = {}; for (const [k, v] of form) { const m = /^metadata\[(.+)\]$/.exec(k); if (m) meta[m[1]] = v; }
      const pi = { id: `pi_${n}`, object: 'payment_intent', client_secret: `pi_${n}_secret`, amount: Number(form.get('amount')), amount_received: 0, status: form.get('capture_method') === 'manual' ? 'requires_payment_method' : 'requires_payment_method', manual: form.get('capture_method') === 'manual', metadata: meta };
      intents.set(pi.id, pi);
      return json(pi);
    }
    // The host's share of a cancelled amount, taken back from their balance when the fee is kept (L5).
    const rev = /^\/v1\/transfers\/([^/]+)\/reversals$/.exec(req.url);
    if (rev && req.method === 'POST') return json({ id: `trr_${calls.length}`, object: 'transfer_reversal', amount: Number(form.get('amount')), transfer: rev[1] });
    const m = /^\/v1\/payment_intents\/([^/?]+)(\/(capture|cancel))?(\?.*)?$/.exec(req.url);
    if (m) {
      const pi = intents.get(m[1]);
      if (!pi) return json({ error: { code: 'resource_missing' } }, 404);
      if (m[3] === 'capture') { pi.status = 'succeeded'; pi.amount_received = pi.amount; }
      if (m[3] === 'cancel') pi.status = 'canceled';
      // Read back with its charge: the charge's transfer to the host is what a kept fee reverses.
      if (m[4] && m[4].includes('latest_charge')) return json({ ...pi, latest_charge: { id: `ch_${pi.id}`, transfer: `tr_${pi.id}` } });
      return json(pi);
    }
    if (req.url === '/v1/refunds' && req.method === 'POST') {
      // A refund of a destination charge comes back out of the host's balance, and Epic's fee in proportion (K11) —
      // except a guest's own cancellation that keeps the fee (L5), whose host share comes back by a reversal instead.
      const keepsFee = form.get('metadata[epic_cause]') === 'guest_cancelled' && form.get('reverse_transfer') == null;
      if (!keepsFee && (form.get('reverse_transfer') !== 'true' || form.get('refund_application_fee') !== 'true')) return json({ error: { code: 'l1_refund_from_platform' } }, 400);
      return json({ id: `re_${calls.length}`, object: 'refund', status: 'succeeded', amount: Number(form.get('amount')) });
    }
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
    get: (p, headers = {}) => fetch(base + p, { headers }).then(out),
    send: (method, p, body) => fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then(out),
  };
}

async function anEvent({ lane = 'oneoff', price = null, priceMode = 'free', max = 10, min = null, total = null, policy = 'flexible', ageMin = null, ageMax = null, parents = null, waitlist = false, sessions = 1, firstIn = 10, money = 'epic', hostOld = true } = {}) {
  const host = await aPerson('Kate Morris');
  // The host's own Stripe account, made the L1 way, takes the guest's money (register L, 3 Oct 2026).
  const { rows: [h] } = await query(
    `insert into hosts (household_id, name, created_at, stripe_account_id, stripe_account_model, stripe_charges_enabled, stripe_payouts_enabled, stripe_payouts_manual, payouts_state)
     values ($1, 'Kate Morris', $2, $3, 'v2', true, true, true, 'ready') returning *`,
    [host.household.id, hostOld ? new Date(Date.now() - 400 * 86_400_000) : new Date(), `acct_test_${Math.random().toString(36).slice(2, 10)}`],
  );
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
    assert.equal(quote.body.pence, 3800, 'flexible, five days out: everything back less the 5% cancellation fee (L5)');
    // Inside a day: nothing.
    const soon = new Date(Date.now() + 5 * 3_600_000);
    await query(`update offer_sessions set on_date = $2, starts_at = $3, ends_at = null where offer_id = $1`, [flex.o.id, localDay(soon, 'Europe/London'), soon.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })]);
    assert.equal((await srv.get(`/api/booked/${id}/cancel-quote`)).body.pence, 0);
    // The host moved it after they booked: everything, whatever the policy.
    // A second in the past: "Keep my place" stamps the database's own now(), and this process's clock may run a
    // millisecond ahead of it — the move would then look newer than the keep (a red full-suite run, 3 Oct 2026).
    // The booking goes back a minute, so the order is still booked, moved, kept.
    await query(`update experience_bookings set created_at = created_at - interval '1 minute' where id = $1`, [id]);
    await query(`update offer_sessions set changed_from = $2::jsonb where offer_id = $1`, [flex.o.id, JSON.stringify({ onDate: '2026-01-01', at: new Date(Date.now() - 1000).toISOString() })]);
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
    assert.deepEqual([one.body.refundPence, one.body.whole], [950, false], 'one session of four: its share, less the 5% cancellation fee (L5)');
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

test('G11: the booking page says whether the account is a free guest one, so Booked can say the invite was emailed', async () => {
  const { o } = await anEvent({ firstIn: 3 });
  const member = await aPerson();
  const visitor = await aPerson('Sam Guest');
  await query(`update accounts set plan = 'guest' where id = $1`, [visitor.account.id]);
  const ms = await server(member.account);
  const vs = await server({ ...visitor.account, plan: 'guest' });
  try {
    const m = await ms.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 } });
    const v = await vs.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 } });
    assert.equal((await ms.get(`/api/booked/${m.body.booking.id}`)).body.booking.guest, false, 'a member is not told about the emailed invite');
    assert.equal((await vs.get(`/api/booked/${v.body.booking.id}`)).body.booking.guest, true, 'a free guest account is');
  } finally { await ms.close(); await vs.close(); }
});

test('a refund says the day it went through, not the day it was first written down', async () => {
  const { o } = await anEvent({ firstIn: 3 });
  const p = await aPerson();
  const srv = await server(p.account);
  try {
    const made = await srv.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 } });
    const id = made.body.booking.id;
    await query(`insert into hosting_payments (kind, booking_id, host_id, amount_pence, state, mode, created_at, updated_at)
                 values ('refund', $1, $2, 500, 'succeeded', 'test', now() - interval '3 days', now() - interval '1 day'),
                        ('refund', $1, $2, 300, 'pending', 'test', now() - interval '2 days', now() - interval '2 days')`, [id, o.host_id]);
    const refunds = (await srv.get(`/api/booked/${id}`)).body.booking.money.refunds;
    const done = refunds.find((r) => r.state === 'succeeded');
    assert.ok(done.doneAt && new Date(done.doneAt) > new Date(done.at), 'the day it went through');
    assert.equal(refunds.find((r) => r.state === 'pending').doneAt, null, 'a refund still waiting has no such day');
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
    // One tip, never two. The second request is refused (409) if it lands before the first reaches Stripe, or handed
    // that same tip back to pay (200) if it lands after — both keep the rule, and which one is timing.
    const made = both.find((x) => x.status === 201);
    const other = both.find((x) => x !== made);
    assert.ok(made, 'one is made');
    assert.ok(other.status === 409 || (other.status === 200 && other.body.tip?.id === made.body.tip.id), `the other is refused or is the same tip (${other.status})`);
    assert.equal((await query(`select count(*)::int as n from booking_tips where booking_id = $1`, [r.body.booking.id])).rows[0].n, 1, 'one tip row');
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
  // Depends on numbers: the booking page carries the floor the price can reach.
  const { o } = await anEvent({ priceMode: 'by_numbers', total: 12000, min: 4, max: 12 });
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    // Card payment stays off until the Stripe work switches it on, whatever keys are set; then only a test key beside a test secret.
    const was = { s: process.env.STRIPE_SECRET_KEY, p: process.env.STRIPE_PUBLISHABLE_KEY, f: process.env.EPIC_GUEST_CARD_PAYMENTS };
    try {
      process.env.STRIPE_SECRET_KEY = 'sk_test_x'; process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_abc';
      delete process.env.EPIC_GUEST_CARD_PAYMENTS;
      assert.equal((await srv.get('/api/payments/config')).body.publishableKey, null, 'off by default');
      process.env.EPIC_GUEST_CARD_PAYMENTS = 'on';
      assert.equal((await srv.get('/api/payments/config')).body.publishableKey, 'pk_test_abc');
      process.env.STRIPE_PUBLISHABLE_KEY = 'pk_live_abc';
      assert.equal((await srv.get('/api/payments/config')).body.publishableKey, null, 'never a live key');
    } finally {
      for (const [k, v] of [['STRIPE_SECRET_KEY', was.s], ['STRIPE_PUBLISHABLE_KEY', was.p], ['EPIC_GUEST_CARD_PAYMENTS', was.f]]) { if (v == null) delete process.env[k]; else process.env[k] = v; }
    }
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

test('Codex: a lane booking is booked — the host’s notice reaches its inbox, and a private event opens again without its link', async () => {
  const { o, h } = await anEvent();
  await query(`update host_offers set visibility = 'invite' where id = $1`, [o.id]);
  const a = await aPerson();
  await query(`insert into experience_bookings (offer_id, host_id, household_id, state) values ($1, $2, $3, 'confirmed')`, [o.id, h.id, a.household.id]);
  const { rows: [hostMember] } = await query(`select m.id from members m join hosts x on x.household_id = m.household_id where x.id = $1 limit 1`, [h.id]);
  await query(`insert into chat_topics (context_type, context_id, tag_kind, tag_ref, audience, author_member_id, title) values ('offer', $1, 'offer_aspect', 'offer', 'everyone', $2, 'Bring wellies')`, [o.id, hostMember.id]);
  const srv = await server(a.account);
  try {
    const inbox = await srv.get('/api/messages');
    assert.equal(inbox.body.threads.find((x) => x.offerId === o.id)?.last, 'Bring wellies');
    // A public path: the household is known from the token itself, as in production.
    const { openSession } = await import('../src/auth.js');
    const { token } = await openSession('phone', a.account.id, 'device', 'link');
    const opt = await srv.get(`/api/experiences/${o.id}/booking/options`, { authorization: `Bearer ${token}` });
    assert.equal(opt.status, 200, JSON.stringify(opt.body));
    assert.equal((await srv.get(`/api/experiences/${o.id}/booking/options`)).status, 404, 'and still shut to the public');
  } finally { await srv.close(); }
});

test('Codex: a public page knows a signed-in household by its token, and nobody without one', async () => {
  const { openSession, householdOnPublicPath } = await import('../src/auth.js');
  const a = await aPerson();
  const { token } = await openSession('phone', a.account.id, 'device', 'link');
  const req = (h) => ({ method: 'GET', path: '/api/experiences/x/booking/options', headers: h });
  assert.equal(await householdOnPublicPath(req({ authorization: `Bearer ${token}` })), a.household.id);
  assert.equal(await householdOnPublicPath(req({})), null);
  assert.equal(await householdOnPublicPath(req({ authorization: 'Bearer not-a-token' })), null);
});

test('Codex: a host’s reviews past the first fifty come fifty at a time', async () => {
  const repo = await import('../src/repositories/hosting.js');
  const { o, h } = await anEvent();
  for (let i = 0; i < 52; i += 1) {
    const p = await aPerson(`Guest ${i}`);
    const { rows: [b] } = await query(`insert into experience_bookings (offer_id, host_id, household_id, state) values ($1, $2, $3, 'attended') returning id`, [o.id, h.id, p.household.id]);
    await query(`insert into host_reviews (booking_id, offer_id, host_id, household_id, stars, text, publish_on) values ($1, $2, $3, $4, 5, $5, current_date - 1)`, [b.id, o.id, h.id, p.household.id, `Review ${i}`]);
  }
  const first = await repo.publishedReviews(h.id);
  const rest = await repo.publishedReviews(h.id, { offset: first.length });
  assert.deepEqual([first.length, rest.length], [50, 2]);
  assert.equal(new Set([...first, ...rest].map((r) => r.text)).size, 52, 'none twice, none missed');
});


test('Codex: a place offered from the waiting list can be booked, and a private event’s list opens its page', async () => {
  settings.forget();
  const { o, h } = await anEvent({ max: 2, waitlist: true });
  await query(`update host_offers set visibility = 'invite' where id = $1`, [o.id]);
  const a = await aPerson();
  const b = await aPerson();
  await query(`insert into experience_bookings (offer_id, host_id, household_id, state, heads) values ($1, $2, $3, 'confirmed', 1)`, [o.id, h.id, b.household.id]);
  await query(`insert into offer_waitlist (offer_id, household_id, party, state, offer_expires_at) values ($1, $2, 1, 'offered', now() + interval '3 hours')`, [o.id, a.household.id]);
  const { openSession } = await import('../src/auth.js');
  const { token } = await openSession('phone', a.account.id, 'device', 'link');
  const srv = await server(a.account);
  try {
    const opt = await srv.get(`/api/experiences/${o.id}/booking/options`, { authorization: `Bearer ${token}` });
    assert.equal(opt.status, 200, JSON.stringify(opt.body));
    assert.equal(opt.body.action, 'book', 'the held place is theirs to book');
    assert.ok(opt.body.waitlist.offeredUntil);
  } finally { await srv.close(); }
});

test('events near you: within reach, at one place, matching words, and in their Inspire lane', async () => {
  settings.forget();
  const { o, h } = await anEvent({ firstIn: 3 });
  await query(`update host_offers set venue_lat = 51.4, venue_lng = -0.62, venue_ref = 'osm:node/42', title = 'Fossil hunting on the beach' where id = $1`, [o.id]);
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const near = await srv.get('/api/events/near?lat=51.39&lng=-0.62&minutes=30');
    const e = near.body.events.find((x) => x.id === o.id);
    assert.ok(e, 'two km away, inside half an hour');
    assert.equal(e.mood, 'outdoors');
    assert.equal(near.body.estimated, true, 'the reach is said to be an estimate');
    assert.equal((await srv.get('/api/events/near?lat=53.48&lng=-2.24&minutes=30')).body.events.some((x) => x.id === o.id), false, 'Manchester is not near Sunningdale');
    assert.ok((await srv.get('/api/events/near?lat=0&lng=0&minutes=60&ref=osm%3Anode%2F42')).body.events.some((x) => x.id === o.id), 'at its place, wherever you are');
    assert.ok((await srv.get('/api/events/near?lat=51.39&lng=-0.62&minutes=30&q=fossil')).body.events.some((x) => x.id === o.id));
    assert.equal((await srv.get('/api/events/near?lat=51.39&lng=-0.62&minutes=30&q=pottery')).body.events.some((x) => x.id === o.id), false);
    await query('update hosts set paused = true where id = $1', [h.id]);
    assert.equal((await srv.get('/api/events/near?lat=51.39&lng=-0.62&minutes=30')).body.events.some((x) => x.id === o.id), false, 'a paused host’s events are not offered');
  } finally { await srv.close(); }
  const { moodOf } = await import('../src/routes/guestBookings.js');
  assert.equal(moodOf('Sport and fitness', 'Run club'), 'sport');
  assert.equal(moodOf('Arts and crafts', 'Clay'), 'fun');
  assert.equal(moodOf('Talks and tasters', 'Wine'), 'educational');
});

test('Codex: a paid event is not a yes without a booking, and a session already started today is not the next one', async () => {
  settings.forget();
  const { o } = await anEvent({ priceMode: 'same_each', price: 1500 });
  const token = crypto.randomUUID();
  await query(`insert into offer_invites (offer_id, name, contact, heads, token) values ($1, 'Cy', 'cy@example.com', 2, $2)`, [o.id, token]);
  const hosting = await import('../src/routes/hosting.js');
  const app = express(); app.use(express.json()); app.use('/api', hosting.publicRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.code ?? 'x' }));
  const s = app.listen(0, '127.0.0.1'); await new Promise((r) => s.once('listening', r));
  try {
    const yes = await fetch(`http://127.0.0.1:${s.address().port}/api/invited/${token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rsvp: 'yes', heads: 2 }) });
    assert.equal(yes.status, 409);
    assert.equal((await yes.json()).error, 'needs_booking');
  } finally { await new Promise((r) => s.close(r)); }

  // Today at 00:01 has already started by the time anybody reads this; the one after it is next.
  const { o: w } = await anEvent({ lane: 'weekly', sessions: 2, firstIn: 0 });
  await query(`update host_offers set venue_lat = 51.4, venue_lng = -0.62 where id = $1`, [w.id]);
  await query(`update offer_sessions set starts_at = '00:01' where offer_id = $1 and on_date = current_date`, [w.id]);
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const e = (await srv.get('/api/events/near?lat=51.39&lng=-0.62&minutes=30')).body.events.find((x) => x.id === w.id);
    assert.ok(e, 'still offered, by its next session');
    assert.notEqual(e.date, new Date().toISOString().slice(0, 10), 'a started session is not offered as the next');
  } finally { await srv.close(); }
});

test('Codex: a held waiting-list place makes an event card full, and a course shows on each of its days', async () => {
  settings.forget();
  const { o } = await anEvent({ max: 1, waitlist: true });
  await query(`update host_offers set venue_lat = 51.4, venue_lng = -0.62 where id = $1`, [o.id]);
  const b = await aPerson();
  await query(`insert into offer_waitlist (offer_id, household_id, party, state, offer_expires_at) values ($1, $2, 1, 'offered', now() + interval '3 hours')`, [o.id, b.household.id]);
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const e = (await srv.get('/api/events/near?lat=51.39&lng=-0.62&minutes=30')).body.events.find((x) => x.id === o.id);
    assert.equal(e.full, true, 'the one place is held for somebody');
    assert.equal(e.needs, null);
  } finally { await srv.close(); }

  const { o: c } = await anEvent({ lane: 'course', sessions: 3 });
  const p = await aPerson();
  const sp = await server(p.account);
  try {
    const r = await sp.send('POST', `/api/experiences/${c.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1, children: [] } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const card = (await sp.get('/api/booked')).body.upcoming.find((x) => x.id === r.body.booking.id);
    assert.equal(card.dates.length, 3, 'every session’s day');
  } finally { await sp.close(); }
});

test('a course card counts room across the whole run, and an event carries its kind and description for search', async () => {
  settings.forget();
  const { o, h } = await anEvent({ lane: 'course', sessions: 3, max: 2 });
  await query(`update host_offers set venue_lat = 51.4, venue_lng = -0.62, what_label = 'Pottery', summary = 'Wheel throwing for beginners' where id = $1`, [o.id]);
  // The last session is full; the first two have room.
  const { rows: [last] } = await query(`select id from offer_sessions where offer_id = $1 order by on_date desc limit 1`, [o.id]);
  const x = await aPerson();
  const { rows: [b] } = await query(`insert into experience_bookings (offer_id, host_id, household_id, state, heads) values ($1, $2, $3, 'confirmed', 2) returning id`, [o.id, h.id, x.household.id]);
  await query(`insert into booking_sessions (booking_id, session_id, state) values ($1, $2, 'booked')`, [b.id, last.id]);
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const e = (await srv.get('/api/events/near?lat=51.39&lng=-0.62&minutes=30')).body.events.find((y) => y.id === o.id);
    assert.equal(e.full, true, 'one full session fills the run');
    assert.match(e.words, /Pottery/);
    assert.match(e.words, /Wheel throwing/);
  } finally { await srv.close(); }
});

test('L1: a host whose account was made the old way can’t be booked or tipped — nothing is charged to Epic’s balance', async () => {
  settings.forget();
  const { o, h } = await anEvent({ price: 3000, priceMode: 'same_each' });
  // An account from before register L: Stripe holds it, but it took money on Epic's own balance.
  await query(`update hosts set stripe_account_model = null where id = $1`, [h.id]);
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const before = calls.filter((c) => c.url === '/v1/payment_intents').length;
    const r = await srv.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 } });
    assert.deepEqual([r.status, r.body.error], [409, 'host_not_ready']);
    assert.equal(calls.filter((c) => c.url === '/v1/payment_intents').length, before, 'no payment was even started');
    assert.equal((await query('select count(*)::int as n from experience_bookings where offer_id = $1', [o.id])).rows[0].n, 0, 'and no booking written');
    // A new-model account off manual payouts, or with payouts off, is refused too: Stripe could pay the money out
    // before Epic's release checks, or not be able to pay it out at all (Codex, 3 Oct 2026).
    for (const set of ['stripe_payouts_manual = false', 'stripe_payouts_enabled = false']) {
      await query(`update hosts set stripe_account_model = 'v2', stripe_payouts_manual = true, stripe_payouts_enabled = true where id = $1`, [h.id]);
      await query(`update hosts set ${set} where id = $1`, [h.id]);
      const x = await srv.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 } });
      assert.deepEqual([x.status, x.body.error], [409, 'host_not_ready'], set);
    }
  } finally { await srv.close(); }
});

test('L1: a booking is a destination charge to the host, Epic’s fee the application fee, and the booking says so', async () => {
  settings.forget();
  const { o, h: host } = await anEvent({ price: 5000, priceMode: 'same_each' });
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const id = await paidBooking(srv, o, { kind: 'whole' });
    const made = calls.filter((c) => c.url === '/v1/payment_intents' && c.method === 'POST').at(-1);
    const form = new URLSearchParams(made.body);
    const { rows: [b] } = await query('select * from experience_bookings where id = $1', [id]);
    assert.equal(form.get('transfer_data[destination]'), host.stripe_account_id);
    assert.equal(form.get('on_behalf_of'), host.stripe_account_id, 'the host is merchant of record (L2)');
    assert.equal(Number(form.get('application_fee_amount')), b.fee_pence, 'Epic takes only its fee');
    assert.equal(form.get('transfer_group'), null, 'no transfer group: nothing is passed on later');
    assert.equal(b.charge_model, 'destination');
  } finally { await srv.close(); }
});

test('a tip charged after the guest had tipped again is given back in full, as a duplicate tip; on its own, it counts', async () => {
  settings.forget();
  const { o } = await anEvent({ firstIn: 1 });
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const r = await srv.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 } });
    const bookingId = r.body.booking.id;
    await query(`update offer_sessions set on_date = $2 where offer_id = $1`, [o.id, plusDays(today(), -1)]);
    // The first tip's card fails.
    const first = await srv.send('POST', `/api/booked/${bookingId}/tip`, { amountPence: 500 });
    const pi1 = intents.get(first.body.pay.paymentIntent);
    Object.assign(pi1, { status: 'requires_payment_method', last_payment_error: { code: 'card_declined' } });
    await guest.applyPaymentIntent(pi1);
    assert.equal((await query('select state from booking_tips where id = $1', [first.body.tip.id])).rows[0].state, 'failed');
    // The guest tips again, and that one goes through.
    const second = await srv.send('POST', `/api/booked/${bookingId}/tip`, { amountPence: 700 });
    assert.equal(second.status, 201);
    pays(second.body.pay.paymentIntent);
    await guest.applyPaymentIntent(intents.get(second.body.pay.paymentIntent));
    // Then the first is charged after all.
    Object.assign(pi1, { status: 'succeeded', amount_received: pi1.amount, last_payment_error: null });
    await guest.applyPaymentIntent(pi1);
    await guest.applyPaymentIntent(pi1);
    const { rows: lines } = await query(`select * from hosting_payments where tip_id = $1`, [first.body.tip.id]);
    assert.equal(lines.length, 1, 'one refund line, however often Stripe says so');
    assert.deepEqual([lines[0].kind, lines[0].reason, lines[0].cause, lines[0].amount_pence, lines[0].refund_of], ['tip_refund', 'duplicate tip', 'duplicate_tip', pi1.amount, pi1.id]);
    // Its own kind: no report counts a tip given back as a refund of the booking's price (Codex, 3 Oct 2026).
    assert.equal((await query(`select count(*)::int as n from hosting_payments where booking_id = $1 and kind = 'refund'`, [bookingId])).rows[0].n, 0);
    assert.equal((await query(`select count(*)::int as n from hosting_payments where kind = 'tip' and stripe_ref = $1`, [pi1.id])).rows[0].n, 0, 'never credited to the host');
    await engine.processRefunds();
    const sent = calls.filter((c) => c.url === '/v1/refunds').at(-1);
    assert.equal(new URLSearchParams(sent.body).get('payment_intent'), pi1.id, 'the late tip’s own payment, not the booking’s');
    assert.equal((await query('select state from booking_tips where id = $1', [first.body.tip.id])).rows[0].state, 'refunded');
    assert.equal((await query('select state from booking_tips where id = $1', [second.body.tip.id])).rows[0].state, 'paid', 'the tip the guest meant stands');
  } finally { await srv.close(); }

  // On its own — the guest only tried the same card again — the late charge is the tip, and the host has it.
  const solo = await anEvent({ firstIn: 1 });
  const b = await aPerson();
  const sb = await server(b.account);
  try {
    const r = await sb.send('POST', `/api/experiences/${solo.o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 } });
    await query(`update offer_sessions set on_date = $2 where offer_id = $1`, [solo.o.id, plusDays(today(), -1)]);
    const t = await sb.send('POST', `/api/booked/${r.body.booking.id}/tip`, { amountPence: 400 });
    const pi = intents.get(t.body.pay.paymentIntent);
    Object.assign(pi, { status: 'requires_payment_method', last_payment_error: { code: 'card_declined' } });
    await guest.applyPaymentIntent(pi);
    Object.assign(pi, { status: 'succeeded', amount_received: pi.amount, last_payment_error: null });
    await guest.applyPaymentIntent(pi);
    assert.equal((await query('select state from booking_tips where id = $1', [t.body.tip.id])).rows[0].state, 'paid');
    assert.equal((await query(`select count(*)::int as n from hosting_payments where tip_id = $1`, [t.body.tip.id])).rows[0].n, 0, 'nothing refunded');
  } finally { await sb.close(); }
});

test('a guest’s money news opens the booking itself, not the Plans list', async () => {
  settings.forget();
  const flex = await anEvent({ price: 4000, priceMode: 'same_each', firstIn: 5 });
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const id = await paidBooking(srv, flex.o, { kind: 'whole' });
    await srv.send('POST', `/api/booked/${id}/cancel`, {});
    await engine.processRefunds();
    const { rows } = await query(`select link from notifications where household_id = $1 and kind = 'refund_issued'`, [a.household.id]);
    assert.deepEqual(rows.map((x) => x.link), [`/bookings/${id}`]);
  } finally { await srv.close(); }
});

test('G18: passing on a place offered from the waiting list hands it to the next person straight away', async () => {
  settings.forget();
  const { o, h } = await anEvent({ max: 1, waitlist: true });
  const taken = await aPerson();
  await query(`insert into experience_bookings (offer_id, host_id, household_id, state, heads) values ($1, $2, $3, 'confirmed', 1)`, [o.id, h.id, taken.household.id]);
  const first = await aPerson();
  const second = await aPerson();
  await query(`insert into offer_waitlist (offer_id, household_id, party, state, offer_expires_at, created_at) values ($1, $2, 1, 'offered', now() + interval '11 hours', now() - interval '2 hours')`, [o.id, first.household.id]);
  await query(`insert into offer_waitlist (offer_id, household_id, party, state, created_at) values ($1, $2, 1, 'waiting', now() - interval '1 hour')`, [o.id, second.household.id]);
  // The place frees: the confirmed booking is cancelled, so there is a place for the list.
  await query(`update experience_bookings set state = 'cancelled' where offer_id = $1 and household_id = $2`, [o.id, taken.household.id]);
  const srv = await server(first.account);
  try {
    const out = await srv.send('DELETE', `/api/experiences/${o.id}/waitlist`);
    assert.deepEqual([out.body.left, out.body.passed], [true, true]);
    const { rows: [next] } = await query(`select state from offer_waitlist where offer_id = $1 and household_id = $2`, [o.id, second.household.id]);
    assert.equal(next.state, 'offered', 'the next in line is offered it now');
  } finally { await srv.close(); }
});

// ---------------------------------------------------------------------------
// Bookings more than 80 days ahead (register L4, Phase 5)
// ---------------------------------------------------------------------------

test('L4: when the money is taken — 80 days before, or decides-by if earlier; nearer than two days, now', () => {
  const now = new Date('2026-10-03T12:00:00Z');
  const day = 86_400_000;
  assert.equal(guest.laterChargeDue({ start: new Date(now.getTime() + 60 * day), now }), null, 'within 80 days: charged now');
  assert.equal(guest.laterChargeDue({ start: new Date(now.getTime() + 81 * day), now }), null, 'a day short of the window: charged now');
  assert.equal(guest.laterChargeDue({ start: new Date(now.getTime() + 100 * day), now }).toISOString(), new Date(now.getTime() + 20 * day).toISOString());
  const decides = new Date(now.getTime() + 10 * day);
  assert.equal(guest.laterChargeDue({ start: new Date(now.getTime() + 100 * day), decidesAt: decides, now }).toISOString(), decides.toISOString(), 'decides-by first');
});

test('L4: a booking 100 days ahead saves the card, is confirmed, and is charged on its day — the same destination charge', async () => {
  settings.forget();
  const { o, h } = await anEvent({ price: 4000, priceMode: 'same_each', firstIn: 100 });
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    calls.length = 0;
    const r = await srv.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.match(r.body.pay.setupIntent, /^seti_/);
    assert.match(r.body.pay.clientSecret, /^seti_/);
    assert.ok(r.body.pay.later.chargeOn);
    assert.equal(calls.some((c) => c.url === '/v1/payment_intents'), false, 'nothing charged at booking');
    const setup = calls.find((c) => c.url === '/v1/setup_intents');
    assert.equal(setup.idem, `setup-${r.body.booking.id}`);
    assert.match(decodeURIComponent(setup.body), new RegExp(`on_behalf_of=${h.stripe_account_id}`));
    // The card saved (Stripe's word, read back): confirmed, nothing charged.
    const si = setups.get(r.body.pay.setupIntent);
    Object.assign(si, { status: 'succeeded', payment_method: 'pm_saved_1' });
    const paid = await srv.send('POST', `/api/booked/${r.body.booking.id}/payment`, { paymentIntent: si.id });
    assert.deepEqual([paid.body.state, paid.body.paymentState], ['confirmed', 'card_saved']);
    const { rows: [b] } = await query('select * from experience_bookings where id = $1', [r.body.booking.id]);
    assert.deepEqual([b.saved_payment_method, b.charged_pence ?? 0], ['pm_saved_1', 0]);
    assert.ok(Math.abs(new Date(b.charge_due_at).getTime() - (Date.now() + 20 * 86_400_000)) < 2 * 86_400_000, 'about 20 days from now');

    // Not yet due: nothing happens. Due: charged off-session on that card, to the host's account, once.
    const ready = () => ({ ready: true, mode: 'test' });
    assert.equal((await engine.chargeLaterDue({ status: ready })).charged, 0);
    calls.length = 0;
    const later = new Date(new Date(b.charge_due_at).getTime() + 3_600_000);
    const out = await engine.chargeLaterDue({ now: later, status: ready });
    assert.equal(out.charged, 1);
    const charge = calls.find((c) => c.url === '/v1/payment_intents');
    assert.equal(charge.idem, `booking-later-${b.id}`);
    const f = new URLSearchParams(charge.body);
    assert.deepEqual([f.get('amount'), f.get('transfer_data[destination]'), f.get('payment_method'), f.get('off_session')], ['4000', h.stripe_account_id, 'pm_saved_1', 'true']);
    const { rows: [after] } = await query('select payment_state, charged_pence, state from experience_bookings where id = $1', [b.id]);
    assert.deepEqual([after.payment_state, after.charged_pence, after.state], ['charged', 4000, 'confirmed']);
    assert.equal((await query(`select state from hosting_payments where booking_id = $1 and kind = 'charge'`, [b.id])).rows[0].state, 'succeeded');
    assert.equal((await engine.chargeLaterDue({ now: later, status: ready })).charged, 0, 'never twice');
  } finally { await srv.close(); }
});

test('L4: a later charge the card refuses keeps the place, asks the guest, opens a problem — and paying puts it right', async () => {
  settings.forget();
  const { o } = await anEvent({ price: 4000, priceMode: 'same_each', firstIn: 100 });
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const r = await srv.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 } });
    Object.assign(setups.get(r.body.pay.setupIntent), { status: 'succeeded', payment_method: 'pm_saved_2' });
    await srv.send('POST', `/api/booked/${r.body.booking.id}/payment`, {});
    const id = r.body.booking.id;
    const { rows: [b] } = await query('select charge_due_at from experience_bookings where id = $1', [id]);
    declineLater = true;
    try { assert.equal((await engine.chargeLaterDue({ now: new Date(new Date(b.charge_due_at).getTime() + 1000), status: () => ({ ready: true }) })).failed, 1); } finally { declineLater = false; }
    const { rows: [after] } = await query('select state, payment_state from experience_bookings where id = $1', [id]);
    assert.deepEqual([after.state, after.payment_state], ['confirmed', 'charge_failed'], 'not cancelled (L4 is open)');
    const [problem] = (await query(`select kind, status, amount_pence from payment_problems where booking_id = $1`, [id])).rows;
    assert.deepEqual([problem.kind, problem.status, problem.amount_pence], ['later_charge_failed', 'open', 4000]);
    assert.equal((await query(`select count(*)::int as n from notifications where household_id = $1 and kind = 'payment_needed'`, [a.household.id])).rows[0].n, 1);
    // The guest pays from the booking: a new payment, in the browser, the same destination charge.
    const pay = await srv.send('POST', `/api/booked/${id}/pay-now`, {});
    assert.equal(pay.status, 200, JSON.stringify(pay.body));
    // A second press (another tab) gets the same payment back, never a second one beside it.
    const again = await srv.send('POST', `/api/booked/${id}/pay-now`, {});
    assert.equal(again.body.pay.paymentIntent, pay.body.pay.paymentIntent);
    pays(pay.body.pay.paymentIntent);
    const done = await srv.send('POST', `/api/booked/${id}/payment`, {});
    assert.deepEqual([done.body.state, done.body.paymentState], ['confirmed', 'charged']);
    assert.equal((await query(`select status from payment_problems where booking_id = $1`, [id])).rows[0].status, 'resolved');
    assert.equal((await srv.send('POST', `/api/booked/${id}/pay-now`, {})).status, 409, 'nothing left to pay');
  } finally { await srv.close(); }
});

test('L4: a booking far ahead cancelled before its charge is never charged, and keeps no fee', async () => {
  settings.forget();
  const { o } = await anEvent({ price: 4000, priceMode: 'same_each', firstIn: 100 });
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const r = await srv.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 } });
    Object.assign(setups.get(r.body.pay.setupIntent), { status: 'succeeded', payment_method: 'pm_saved_3' });
    await srv.send('POST', `/api/booked/${r.body.booking.id}/payment`, {});
    const quote = await srv.get(`/api/booked/${r.body.booking.id}/cancel-quote`);
    assert.equal(quote.status, 200);
    const c = await srv.send('POST', `/api/booked/${r.body.booking.id}/cancel`, {});
    assert.equal(c.status, 200, JSON.stringify(c.body));
    const { rows: [b] } = await query('select state, charge_due_at, cancellation_fee_pence from experience_bookings where id = $1', [r.body.booking.id]);
    assert.deepEqual([b.state, b.cancellation_fee_pence], ['cancelled', 0]);
    assert.equal((await query(`select count(*)::int as n from hosting_payments where booking_id = $1`, [r.body.booking.id])).rows[0].n, 0, 'no refund line: nothing was taken');
    calls.length = 0;
    await engine.chargeLaterDue({ now: new Date(new Date(b.charge_due_at).getTime() + 1000), status: () => ({ ready: true }) });
    assert.equal(calls.some((x) => x.url === '/v1/payment_intents'), false);
  } finally { await srv.close(); }
});

test('L4: part of a booking far ahead cancelled before its charge comes off it; the fee follows what is charged, once', async () => {
  settings.forget();
  const { o, sessions } = await anEvent({ lane: 'weekly', price: 1500, priceMode: 'same_each', sessions: 3, firstIn: 100 });
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const r = await srv.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'book_ahead', sessionIds: [sessions[0].id, sessions[2].id] }, party: { adults: 2 } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    Object.assign(setups.get(r.body.pay.setupIntent), { status: 'succeeded', payment_method: 'pm_saved_4' });
    await srv.send('POST', `/api/booked/${r.body.booking.id}/payment`, {});
    // £15 × 2 × 2 = £60, 20% fee £12. One of the two sessions cancelled long before: half comes off, no fee kept.
    const c = await srv.send('POST', `/api/booked/${r.body.booking.id}/cancel`, { sessionIds: [sessions[2].id] });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    const { rows: [b] } = await query('select later_off_pence, fee_pence, charge_due_at, cancellation_fee_pence from experience_bookings where id = $1', [r.body.booking.id]);
    assert.deepEqual([b.later_off_pence, b.fee_pence, b.cancellation_fee_pence], [3000, 1200, 0]);
    const page = await srv.get(`/api/booked/${r.body.booking.id}`);
    assert.deepEqual([page.body.booking.money.later.pence, page.body.booking.money.later.failed], [3000, false]);
    // A charge Stripe couldn't be reached for: tried again later with the same amounts — the fee not prorated twice.
    const unreachable = async () => { throw Object.assign(new Error('x'), { code: 'stripe_unreachable' }); };
    const due = new Date(new Date(b.charge_due_at).getTime() + 1000);
    await engine.chargeLaterDue({ now: due, status: () => ({ ready: true }), charge: unreachable });
    await query('update experience_bookings set later_charge_claimed_at = null where id = $1', [r.body.booking.id]);
    calls.length = 0;
    await engine.chargeLaterDue({ now: due, status: () => ({ ready: true }) });
    const f = new URLSearchParams(calls.find((x) => x.url === '/v1/payment_intents').body);
    assert.deepEqual([f.get('amount'), f.get('application_fee_amount')], ['3000', '600']);
    const { rows: [after] } = await query('select charged_pence, fee_pence, host_pence from experience_bookings where id = $1', [r.body.booking.id]);
    assert.deepEqual([after.charged_pence, after.fee_pence, after.host_pence], [3000, 600, 2400]);
  } finally { await srv.close(); }
});

test('L4: two parts cancelled separately come off the same whole; a part cancelled during the charge comes back', async () => {
  settings.forget();
  const { o, sessions } = await anEvent({ lane: 'weekly', price: 1000, priceMode: 'same_each', sessions: 3, firstIn: 100 });
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const r = await srv.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'book_ahead', sessionIds: sessions.map((s) => s.id) }, party: { adults: 2 } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    Object.assign(setups.get(r.body.pay.setupIntent), { status: 'succeeded', payment_method: 'pm_saved_5' });
    await srv.send('POST', `/api/booked/${r.body.booking.id}/payment`, {});
    // £10 × 2 × 3 = £60. Cancel the third, then the second: £20 each, leaving £20.
    assert.equal((await srv.send('POST', `/api/booked/${r.body.booking.id}/cancel`, { sessionIds: [sessions[2].id] })).status, 200);
    assert.equal((await srv.send('POST', `/api/booked/${r.body.booking.id}/cancel`, { sessionIds: [sessions[1].id] })).status, 200);
    assert.equal((await query('select later_off_pence from experience_bookings where id = $1', [r.body.booking.id])).rows[0].later_off_pence, 4000);

    // The charge was made for £20 — and Stripe's answer lands after a cancellation that took £20 more off:
    // charged, then the part cancelled comes straight back.
    const { rows: [b] } = await query('select * from experience_bookings where id = $1', [r.body.booking.id]);
    await query('update experience_bookings set later_off_pence = 6000 where id = $1', [b.id]);
    const pi = { id: `pi_race_${b.id.slice(0, 6)}`, object: 'payment_intent', status: 'succeeded', amount: 2000, amount_received: 2000, metadata: { epic_kind: 'booking', epic_booking_id: b.id } };
    await query('update experience_bookings set stripe_payment_intent = $2 where id = $1', [b.id, pi.id]);
    await guest.applyPaymentIntent(pi);
    const { rows: [line] } = await query(`select amount_pence, cause from hosting_payments where booking_id = $1 and kind = 'refund'`, [b.id]);
    assert.deepEqual([line.amount_pence, line.cause], [2000, 'guest_cancelled']);
  } finally { await srv.close(); }
});

test('L4: the charge date follows the sessions — the earliest cancelled, it moves to the next', async () => {
  settings.forget();
  const { o, sessions } = await anEvent({ lane: 'weekly', price: 1000, priceMode: 'same_each', sessions: 3, firstIn: 100 });
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const r = await srv.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'book_ahead', sessionIds: sessions.map((x) => x.id) }, party: { adults: 1 } });
    Object.assign(setups.get(r.body.pay.setupIntent), { status: 'succeeded', payment_method: 'pm_saved_6' });
    await srv.send('POST', `/api/booked/${r.body.booking.id}/payment`, {});
    const due = async () => new Date((await query('select charge_due_at from experience_bookings where id = $1', [r.body.booking.id])).rows[0].charge_due_at).getTime();
    const first = await due();
    assert.equal((await srv.send('POST', `/api/booked/${r.body.booking.id}/cancel`, { sessionIds: [sessions[0].id] })).status, 200);
    assert.equal(Math.round((await due() - first) / 86_400_000), 7, 'a week later, with the next session');
  } finally { await srv.close(); }
});

// ---------------------------------------------------------------------------
// Change how many are going (the hosting chat's hook: changeParty / partyQuote)
// ---------------------------------------------------------------------------

/** A paid one-off, booked and paid for by `adults` adults. */
async function aPaidBooking({ adults = 2, firstIn = 30, max = 10, policy = 'flexible' } = {}) {
  const ev = await anEvent({ price: 2000, priceMode: 'same_each', firstIn, max, policy });
  const a = await aPerson();
  const srv = await server(a.account);
  const r = await srv.send('POST', `/api/experiences/${ev.o.id}/booking`, { when: { kind: 'whole' }, party: { adults } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  pays(r.body.pay.paymentIntent);
  await srv.send('POST', `/api/booked/${r.body.booking.id}/payment`, {});
  return { ...ev, a, srv, id: r.body.booking.id };
}

test('more going: only with room, the places held at once, the difference paid as a destination charge; failing gives them back', async () => {
  settings.forget();
  const { srv, id, h } = await aPaidBooking({ adults: 2, max: 4 });
  try {
    assert.equal((await srv.send('POST', `/api/booked/${id}/party`, { adults: 5 })).body.error, 'full', 'four places, two taken by them: five is too many');
    const q = await srv.get(`/api/booked/${id}/party-quote?adults=4`);
    assert.deepEqual([q.body.fromHeads, q.body.toHeads, q.body.chargePence, q.body.refundPence], [2, 4, 4000, 0]);
    calls.length = 0;
    const r = await srv.send('POST', `/api/booked/${id}/party`, { adults: 4 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.change.fromHeads, r.body.change.toHeads, r.body.pay.amountPence], [2, 4, 4000]);
    const f = new URLSearchParams(calls.find((c) => c.url === '/v1/payment_intents').body);
    assert.deepEqual([f.get('transfer_data[destination]'), f.get('application_fee_amount'), f.get('metadata[epic_kind]')], [h.stripe_account_id, '800', 'party_change']);
    // The places are theirs while they pay: nobody else can have them.
    assert.equal((await query('select heads from experience_bookings where id = $1', [id])).rows[0].heads, 4);
    assert.equal((await srv.send('POST', `/api/booked/${id}/party`, { adults: 3 })).body.error, 'change_waiting', 'one change at a time');
    pays(r.body.pay.paymentIntent);
    const done = await srv.send('POST', `/api/booked/${id}/payment`, { paymentIntent: r.body.pay.paymentIntent });
    assert.equal(done.status, 200);
    const { rows: [b] } = await query('select heads, charged_pence, value_pence, fee_pence, host_pence from experience_bookings where id = $1', [id]);
    assert.deepEqual([b.heads, b.charged_pence, b.value_pence, b.fee_pence, b.host_pence], [4, 8000, 8000, 1600, 6400]);
    assert.equal((await query(`select state from booking_party_changes where booking_id = $1`, [id])).rows[0].state, 'done');

  } finally { await srv.close(); }
});

test('more going, never paid: the places go back after 30 minutes', async () => {
  settings.forget();
  const { srv, id } = await aPaidBooking({ adults: 1, max: 4 });
  try {
    const r = await srv.send('POST', `/api/booked/${id}/party`, { adults: 3 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await guest.expirePartyChanges({ now: new Date(Date.now() + 31 * 60_000) });
    assert.equal((await query('select heads from experience_bookings where id = $1', [id])).rows[0].heads, 1);
    assert.equal((await query(`select state from booking_party_changes where booking_id = $1`, [id])).rows[0].state, 'expired');
  } finally { await srv.close(); }
});

test('fewer going: their share comes back under the refund policy, through the refund queue, with the 5% where it would all come back', async () => {
  settings.forget();
  const { srv, id } = await aPaidBooking({ adults: 4, firstIn: 30 });
  try {
    const q = await srv.get(`/api/booked/${id}/party-quote?adults=3`);
    // £80 for four; one fewer is £20 of it — a full refund under Flexible this far ahead, less the 5% cancellation fee (L5).
    assert.deepEqual([q.body.refundPence, q.body.feeKeptPence, q.body.chargePence], [1900, 100, 0]);
    const r = await srv.send('POST', `/api/booked/${id}/party`, { adults: 3 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.pay, null);
    const { rows: [line] } = await query(`select amount_pence, fee_kept_pence, cause, triggered_by, state from hosting_payments where booking_id = $1 and kind = 'refund'`, [id]);
    assert.deepEqual([line.amount_pence, line.fee_kept_pence, line.cause, line.triggered_by, line.state], [1900, 100, 'party_reduced', 'guest', 'pending']);
    const { rows: [b] } = await query('select heads, refunded_pence, cancellation_fee_pence from experience_bookings where id = $1', [id]);
    assert.deepEqual([b.heads, b.refunded_pence, b.cancellation_fee_pence], [3, 1900, 100]);
    assert.equal((await srv.send('POST', `/api/booked/${id}/party`, { adults: 3 })).body.error, 'no_change');
  } finally { await srv.close(); }
});

test('a host removing people refunds them in full; the hook answers only to the booking’s own household or host', async () => {
  settings.forget();
  const { srv, id, h } = await aPaidBooking({ adults: 2 });
  try {
    await assert.rejects(() => guest.changeParty({ bookingId: id, householdId: crypto.randomUUID(), party: { adults: 1 } }), /isn’t yours/);
    const r = await guest.changeParty({ bookingId: id, hostId: h.id, party: { adults: 1 }, by: 'host' });
    assert.deepEqual([r.change.refundPence, r.change.feeKeptPence], [2000, 0]);
    const { rows: [line] } = await query(`select cause, triggered_by from hosting_payments where booking_id = $1 and kind = 'refund'`, [id]);
    assert.deepEqual([line.cause, line.triggered_by], ['host_cancelled', 'host']);
  } finally { await srv.close(); }
});

test('paid on the day: a party change keeps the booking’s value in step, so Epic’s fee on the organiser follows it', async () => {
  settings.forget();
  const { o } = await anEvent({ price: 2000, priceMode: 'same_each', money: 'direct' });
  await query(`update host_offers set visibility = 'private' where id = $1`, [o.id]);
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const r = await srv.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 }, linkToken: o.link_token });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.pay, null, 'nothing paid through Epic');
    const c = await srv.send('POST', `/api/booked/${r.body.booking.id}/party`, { adults: 2 });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.equal((await query('select value_pence from experience_bookings where id = $1', [r.body.booking.id])).rows[0].value_pence, 4000);
  } finally { await srv.close(); }
});

test('a booking paid in two payments is refunded from both, newest first, under keys a retry repeats', async () => {
  settings.forget();
  const { srv, id } = await aPaidBooking({ adults: 2, max: 6, firstIn: 30 });
  try {
    const r = await srv.send('POST', `/api/booked/${id}/party`, { adults: 4 });
    pays(r.body.pay.paymentIntent);
    await srv.send('POST', `/api/booked/${id}/payment`, { paymentIntent: r.body.pay.paymentIntent });
    const { rows: [b] } = await query('select stripe_payment_intent, charged_pence from experience_bookings where id = $1', [id]);
    assert.equal(b.charged_pence, 8000);
    // All of it cancelled, a month ahead under Flexible: £80 less the 5% fee — £76 back.
    assert.equal((await srv.send('POST', `/api/booked/${id}/cancel`, {})).status, 200);
    calls.length = 0;
    await engine.processRefunds({ status: () => ({ ready: true }) });
    const refunds = calls.filter((c) => c.url === '/v1/refunds').map((c) => { const f = new URLSearchParams(c.body); return [f.get('payment_intent'), f.get('amount'), c.idem]; });
    const mine = refunds.filter(([pi]) => pi === r.body.pay.paymentIntent || pi === b.stripe_payment_intent);
    assert.equal(mine.length, 2, JSON.stringify(refunds));
    assert.deepEqual(mine[0].slice(0, 2), [r.body.pay.paymentIntent, '4000'], 'the payment for more places first');
    assert.deepEqual(mine[1].slice(0, 2), [b.stripe_payment_intent, '3600']);
    assert.match(mine[0][2], /:0$/);
    const { rows: [line] } = await query(`select state, refund_split from hosting_payments where booking_id = $1 and kind = 'refund' and cause = 'guest_cancelled'`, [id]);
    assert.equal(line.state, 'succeeded');
    assert.equal(line.refund_split.length, 2);
  } finally { await srv.close(); }
});

test('a payment for more places that lands after the booking was cancelled is given straight back', async () => {
  settings.forget();
  const { srv, id } = await aPaidBooking({ adults: 1, max: 6, firstIn: 30 });
  try {
    const r = await srv.send('POST', `/api/booked/${id}/party`, { adults: 2 });
    assert.equal((await srv.send('POST', `/api/booked/${id}/cancel`, {})).status, 200);
    pays(r.body.pay.paymentIntent);
    await srv.send('POST', `/api/booked/${id}/payment`, { paymentIntent: r.body.pay.paymentIntent });
    const { rows: [line] } = await query(`select amount_pence, refund_of, cause from hosting_payments where booking_id = $1 and cause = 'party_paid_after_cancel'`, [id]);
    assert.deepEqual([line.amount_pence, line.refund_of], [2000, r.body.pay.paymentIntent]);
    assert.equal((await query('select charged_pence from experience_bookings where id = $1', [id])).rows[0].charged_pence, 2000, 'never counted on the booking');
  } finally { await srv.close(); }
});

test('a refund that fits in a later payment for more places is taken from that payment', async () => {
  settings.forget();
  const { srv, id } = await aPaidBooking({ adults: 2, max: 6, firstIn: 30 });
  try {
    const r = await srv.send('POST', `/api/booked/${id}/party`, { adults: 4 });
    pays(r.body.pay.paymentIntent);
    await srv.send('POST', `/api/booked/${id}/payment`, { paymentIntent: r.body.pay.paymentIntent });
    // One person fewer: £20 less the 5% — fits in the £40 payment for more places.
    assert.equal((await srv.send('POST', `/api/booked/${id}/party`, { adults: 3 })).status, 200);
    calls.length = 0;
    await engine.processRefunds({ status: () => ({ ready: true }) });
    const mine = calls.filter((c) => c.url === '/v1/refunds').map((c) => new URLSearchParams(c.body)).filter((f) => f.get('metadata[epic_booking_id]') === id);
    assert.deepEqual(mine.map((f) => [f.get('payment_intent'), f.get('amount')]), [[r.body.pay.paymentIntent, '1900']]);
  } finally { await srv.close(); }
});

test('more places: Stripe unreadable at expiry leaves the change pending; paid after it was let go is refunded; its chargeback holds the booking', async () => {
  settings.forget();
  const { srv, id } = await aPaidBooking({ adults: 1, max: 6, firstIn: 30 });
  try {
    const r = await srv.send('POST', `/api/booked/${id}/party`, { adults: 2 });
    const later = new Date(Date.now() + 31 * 60_000);
    await guest.expirePartyChanges({ now: later, read: async () => { throw new Error('down'); } });
    assert.equal((await query(`select state from booking_party_changes where booking_id = $1`, [id])).rows[0].state, 'pending');
    await guest.expirePartyChanges({ now: later, read: async () => ({ status: 'requires_payment_method' }), cancel: async () => ({}) });
    assert.equal((await query(`select state from booking_party_changes where booking_id = $1`, [id])).rows[0].state, 'expired');
    pays(r.body.pay.paymentIntent);
    await guest.applyPaymentIntent(await (await fetch(`${process.env.STRIPE_API_BASE}/v1/payment_intents/${r.body.pay.paymentIntent}`, { headers: { authorization: 'Bearer x' } })).json());
    assert.equal((await query(`select count(*)::int as n from hosting_payments where refund_of = $1 and cause = 'party_paid_after_cancel'`, [r.body.pay.paymentIntent])).rows[0].n, 1);
    const { markDispute } = await import('../src/repositories/hostingLedger.js');
    await query(`insert into hosting_payments (kind, booking_id, amount_pence, state, stripe_ref, mode) values ('charge', $1, 2000, 'succeeded', 'pi_extra_dispute', 'test')`, [id]);
    await markDispute({ paymentIntent: 'pi_extra_dispute', open: true });
    assert.equal((await query('select dispute_state from experience_bookings where id = $1', [id])).rows[0].dispute_state, 'open');
  } finally { await srv.close(); }
});

// --- guest side batch B ------------------------------------------------------

test('G4/G30: a reopened event page knows its own place on the waiting list', async () => {
  settings.forget();
  const { o } = await anEvent({ max: 1, waitlist: true });
  const [a, b, c] = [await aPerson(), await aPerson(), await aPerson()];
  const { openSession } = await import('../src/auth.js');
  const { token } = await openSession('phone', c.account.id, 'device', 'link');
  const [sa, sb, sc] = [await server(a.account), await server(b.account), await server(c.account)];
  try {
    await sa.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 } });
    await sb.send('POST', `/api/experiences/${o.id}/waitlist`, { party: 1 });
    const before = await sc.get(`/api/experiences/${o.id}/booking/options`, { authorization: `Bearer ${token}` });
    assert.deepEqual(before.body.waitlist.mine, [], 'not on it yet: Join the waiting list');
    assert.equal((await sc.send('POST', `/api/experiences/${o.id}/waitlist`, { party: 1 })).body.position, 2);
    const after = await sc.get(`/api/experiences/${o.id}/booking/options`, { authorization: `Bearer ${token}` });
    assert.deepEqual(after.body.waitlist.mine, [{ sessionId: null, position: 2, state: 'waiting' }], '"You’re #2 on the list", read back');
    // Signed out, the page can't know whose place it is.
    assert.equal((await sc.get(`/api/experiences/${o.id}/booking/options`)).body.waitlist.mine.length, 0);
    // B leaves: C moves up.
    await sb.send('DELETE', `/api/experiences/${o.id}/waitlist`, {});
    assert.equal((await sc.get(`/api/experiences/${o.id}/booking/options`, { authorization: `Bearer ${token}` })).body.waitlist.mine[0].position, 1);
  } finally { await sa.close(); await sb.close(); await sc.close(); }
});

test('G14 and the booking page: the party by name, grown-ups too', async () => {
  const { o } = await anEvent({ ageMin: 3, ageMax: 99 });
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const r = await srv.send('POST', `/api/experiences/${o.id}/booking`, {
      when: { kind: 'whole' },
      party: { adults: 2, adultNames: ['Priya', '  '], children: [{ name: 'Ava', age: 7 }, { name: 'Ravi', age: 4 }] },
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const card = (await srv.get('/api/booked')).body.upcoming.find((x) => x.id === r.body.booking.id);
    assert.deepEqual(card.who, ['Priya', 'Ava', 'Ravi'], 'a blank name is no name');
    const page = (await srv.get(`/api/booked/${r.body.booking.id}`)).body.booking;
    assert.deepEqual(page.who.adults, [{ name: 'Priya' }, { name: null }]);
    assert.deepEqual(page.who.children.map((k) => k.name), ['Ava', 'Ravi']);
    assert.equal(page.similar, null, 'only a booking that didn’t happen points elsewhere');
    // Never more names than grown-ups.
    const r2 = await srv.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1, adultNames: ['Dev', 'Extra'] } });
    assert.deepEqual((await srv.get(`/api/booked/${r2.body.booking.id}`)).body.booking.who.adults, [{ name: 'Dev' }]);
    assert.deepEqual(guest.partyNames(null), []);
  } finally { await srv.close(); }
});

test('G17 and G28: a booking called off, or an Ask to book declined, shows similar events nearby from other hosts', async () => {
  settings.forget();
  const place = async (ev, lat, lng, category = 'pottery') => query(`update host_offers set what_category = $2, what_label = 'Pottery class', venue_lat = $3, venue_lng = $4 where id = $1`, [ev.o.id, category, lat, lng]);
  const off = await anEvent({ firstIn: 3 });
  const ask = await anEvent({ lane: 'onrequest' });
  const near = await anEvent({ firstIn: 4 });
  const far = await anEvent({ firstIn: 4 });
  const unlike = await anEvent({ firstIn: 4 });
  await place(off, 51.4, -0.62); await place(ask, 51.4, -0.62); await place(near, 51.41, -0.6);
  await place(far, 53.48, -2.24); await place(unlike, 51.41, -0.6, 'yoga');
  await query(`update host_offers set what_label = 'Yoga' where id = $1`, [unlike.o.id]);
  const a = await aPerson();
  const srv = await server(a.account);
  const hostSrv = await server(ask.host.account);
  try {
    const r = await srv.send('POST', `/api/experiences/${off.o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 } });
    await query(`update experience_bookings set state = 'cancelled', cancel_cause = 'called_off', cancelled_by = 'epic' where id = $1`, [r.body.booking.id]);
    const page = (await srv.get(`/api/booked/${r.body.booking.id}`)).body.booking;
    assert.equal(page.chip, 'called_off');
    const ids = page.similar.map((x) => x.offerId);
    assert.ok(ids.includes(near.o.id), 'like it, and near');
    assert.ok(!ids.includes(far.o.id), 'Manchester is not nearby');
    assert.ok(!ids.includes(unlike.o.id), 'yoga is not like pottery');
    assert.ok(!ids.includes(off.o.id), 'never itself');

    const day = (await srv.get(`/api/experiences/${ask.o.id}/booking/options`)).body.slots[0];
    const q = await srv.send('POST', `/api/experiences/${ask.o.id}/booking`, { when: { kind: 'request', date: day.date, time: day.times[0], lengthMin: 60 }, party: { adults: 1 } });
    assert.equal((await srv.get(`/api/booked/${q.body.booking.id}`)).body.booking.similar, null, 'still asked: nothing else yet');
    assert.equal((await hostSrv.send('POST', `/api/host/lanes/requests/${q.body.booking.id}/decline`, {})).status, 200);
    const declined = (await srv.get(`/api/booked/${q.body.booking.id}`)).body.booking;
    assert.ok(declined.similar.some((x) => x.offerId === near.o.id), 'Similar hosts nearby');
    assert.ok(declined.similar.every((x) => x.offerId !== ask.o.id));
    // With no point to measure from, nothing is called near.
    await query(`update host_offers set venue_lat = null, venue_lng = null where id = $1`, [ask.o.id]);
    assert.deepEqual((await srv.get(`/api/booked/${q.body.booking.id}`)).body.booking.similar, []);
  } finally { await srv.close(); await hostSrv.close(); }
});

test('What you told the host: every question the host asked, from the host’s own lists, until 24 hours before', async () => {
  const { o } = await anEvent({ firstIn: 5 });
  await query(`update host_offers set guest_questions = $2::jsonb where id = $1`, [o.id, JSON.stringify({
    diet: { on: true, ticks: ['vegan', 'halal'] }, plusOne: { on: true },
    bring: { on: true, items: [{ id: 'i1', name: 'Salad' }, { id: 'i2', name: 'Bread' }] },
    stay: { on: true, places: [{ id: 'p1', name: 'The barn' }] },
  })]);
  const [a, b] = [await aPerson(), await aPerson()];
  const [sa, sb] = [await server(a.account), await server(b.account)];
  try {
    await sb.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 }, answers: { bring: 'Bread' } });
    const r = await sa.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 }, answers: { dietary: ['Vegan'] } });
    const id = r.body.booking.id;
    const page = (await sa.get(`/api/booked/${id}`)).body.booking;
    assert.equal(page.asked.diet.on, true, 'the host’s questions, so the edit asks the same');
    assert.deepEqual(page.taken, ['Bread'], 'what somebody else is bringing');
    const edit = (answers) => sa.send('PATCH', `/api/booked/${id}/answers`, { answers });
    const ok = await edit({ dietary: ['halal', 'Vegan'], plusOne: true, bring: 'Salad', stay: 'The barn', note: ' Arriving late ' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(ok.body.answers, { dietary: ['Halal', 'Vegan'], plusOne: true, bring: 'Salad', stay: 'The barn', note: 'Arriving late' });
    assert.equal((await edit({ dietary: ['Vegetarian'] })).status, 400, 'not on the host’s list');
    assert.equal((await edit({ bring: 'Bread' })).body.error, 'taken', 'somebody else is bringing that');
    assert.equal((await edit({ bring: 'Cake' })).status, 400);
    assert.equal((await edit({ stay: 'A tent' })).status, 400);
    assert.deepEqual((await edit({ plusOne: false, note: '' })).body.answers, {}, 'taken back: nothing told');
    assert.deepEqual((await sa.get(`/api/booked/${id}`)).body.booking.answers, {});
    // Unasked: no plus-one.
    await query(`update host_offers set guest_questions = '{}'::jsonb where id = $1`, [o.id]);
    assert.equal((await edit({ plusOne: true })).status, 400);
    assert.equal((await edit({ dietary: 'Vegetarian' })).body.answers.dietary, 'Vegetarian', 'no list set: the usual six');
    // Inside 24 hours: refused by the server, whatever the screen shows.
    const soon = new Date(Date.now() + 20 * 3_600_000);
    await query(`update offer_sessions set on_date = $2, starts_at = $3, ends_at = null where offer_id = $1`, [o.id, localDay(soon, 'Europe/London'), soon.toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })]);
    assert.equal((await edit({ note: 'late' })).status, 409);
    assert.equal((await sa.get(`/api/booked/${id}`)).body.booking.answersEditable, false);
  } finally { await sa.close(); await sb.close(); }
});

test('What you told the host on an Ask to book not answered yet: until 24 hours before the slot asked for', async () => {
  const { o } = await anEvent({ lane: 'onrequest' });
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const slots = (await srv.get(`/api/experiences/${o.id}/booking/options`)).body.slots;
    const day = slots[slots.length - 1];
    const r = await srv.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'request', date: day.date, time: day.times[0], lengthMin: 60 }, party: { adults: 1 } });
    assert.equal((await srv.get(`/api/booked/${r.body.booking.id}`)).body.booking.answersEditable, true);
    assert.equal((await srv.send('PATCH', `/api/booked/${r.body.booking.id}/answers`, { answers: { note: 'Hello' } })).status, 200);
  } finally { await srv.close(); }
});

test('G22: a booking’s Receipt is Settings › Payments narrowed to that booking, asked of the database', async () => {
  settings.forget();
  const { o } = await anEvent({ price: 2500, priceMode: 'same_each' });
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    const one = await paidBooking(srv, o, { kind: 'whole' });
    const two = await paidBooking(srv, o, { kind: 'whole' });
    assert.equal((await srv.get('/api/payments')).body.payments.length, 2);
    const mine = await srv.get(`/api/payments?booking=${one}`);
    assert.deepEqual(mine.body.payments.map((p) => p.bookingId), [one]);
    assert.notEqual(one, two);
    assert.equal((await srv.get('/api/payments?booking=not-a-uuid')).body.payments.length, 2, 'a malformed id narrows nothing');
    const other = await aPerson();
    const os = await server(other.account);
    try { assert.equal((await os.get(`/api/payments?booking=${one}`)).body.payments.length, 0, 'never somebody else’s'); } finally { await os.close(); }
  } finally { await srv.close(); }
});

test('Codex: booking checks what the guest tells the host as the edit does — the host’s lists, and one guest per thing to bring', async () => {
  const { o } = await anEvent({ firstIn: 5, max: 10 });
  await query(`update host_offers set guest_questions = $2::jsonb where id = $1`, [o.id, JSON.stringify({
    diet: { on: true, ticks: ['vegan'] }, plusOne: { on: false },
    bring: { on: true, items: [{ id: 'i1', name: 'Salad' }, { id: 'i2', name: 'Bread' }] }, stay: { on: false, places: [{ id: 'p1', name: 'The barn' }] },
  })]);
  const [a, b] = [await aPerson(), await aPerson()];
  const [sa, sb] = [await server(a.account), await server(b.account)];
  const book = (srv, answers) => srv.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 }, answers });
  try {
    const first = await book(sa, { bring: 'Bread', dietary: ['vegan'] });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.deepEqual((await sa.get(`/api/booked/${first.body.booking.id}`)).body.booking.answers, { bring: 'Bread', dietary: ['Vegan'] });
    const again = await book(sb, { bring: 'Bread' });
    assert.deepEqual([again.status, again.body.error, again.body.message], [409, 'taken', 'Someone else is bringing that.'], 'two guests can’t claim the same thing');
    assert.equal((await book(sb, { bring: 'Cake' })).status, 400, 'not on the host’s list');
    assert.equal((await book(sb, { dietary: ['Halal'] })).status, 400, 'not one of the host’s ticks');
    assert.equal((await book(sb, { stay: 'The barn' })).status, 400, 'stay over is off');
    assert.equal((await book(sb, { plusOne: true })).status, 400, 'a plus-one wasn’t asked');
    assert.equal((await query('select count(*)::int as n from experience_bookings where offer_id = $1 and household_id = $2', [o.id, b.household.id])).rows[0].n, 0, 'a refused answer books nothing');
    // A cancelled booking gives its thing back.
    await sa.send('POST', `/api/booked/${first.body.booking.id}/cancel`, {});
    assert.equal((await book(sb, { bring: 'Bread' })).status, 201);
  } finally { await sa.close(); await sb.close(); }
});

test('Codex: dietary turned off by the host is refused; the usual six only when the event has no dietary setting at all', async () => {
  const { o } = await anEvent({ firstIn: 5 });
  const a = await aPerson();
  const srv = await server(a.account);
  try {
    await query(`update host_offers set guest_questions = $2::jsonb where id = $1`, [o.id, JSON.stringify({ diet: { on: false, ticks: [] } })]);
    const r = await srv.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 }, answers: { dietary: ['Vegan'] } });
    assert.equal(r.status, 400, 'turned off: not asked');
    const ok = await srv.send('POST', `/api/experiences/${o.id}/booking`, { when: { kind: 'whole' }, party: { adults: 1 }, answers: { note: 'Hi' } });
    assert.equal(ok.status, 201);
    assert.equal((await srv.send('PATCH', `/api/booked/${ok.body.booking.id}/answers`, { answers: { dietary: 'Vegan' } })).status, 400, 'nor on the edit');
    await query(`update host_offers set guest_questions = '{}'::jsonb where id = $1`, [o.id]);
    assert.equal((await srv.send('PATCH', `/api/booked/${ok.body.booking.id}/answers`, { answers: { dietary: 'Vegan' } })).status, 200, 'no setting at all: the usual six');
    assert.throws(() => guest.editedAnswers({ dietary: 'Vegan' }, { diet: { on: false } }), /didn’t ask/);
  } finally { await srv.close(); }
});
