/**
 * Four ways to host — the routes (routes/hostLanes.js, migration 365).
 *
 * OpenAI, Stripe and gov.uk are one local fake server; nothing leaves the
 * machine and nothing is spent. What is pinned:
 *
 *   · a draft is made in a lane, saved step by step, and refuses answers that
 *     contradict themselves (min over max, ages backwards);
 *   · the money axis follows the price and who can come: free clears every
 *     figure, public and paid is Epic-collects only;
 *   · Say it fills a fresh draft, never overwrites an answer the host gave, and
 *     on a later step fills that step's fields only — each read on the ledger;
 *   · the host profile refuses under-eighteens; tax and Checked are validated;
 *   · publish: private pays the £10 through Stripe's Checkout (test mode) and
 *     only then sends; public goes for review with Checked and tax still to do;
 *   · a live Stripe key is refused; the webhook is admitted by its signature.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';

// --- the fake outside world, up before any source reads its base URL --------
const calls = [];
let modelAnswer = {};
let checkoutStatus = 'paid';
let dormantRead = false;
/** The account Stripe answers with when read back, when a test sets one. */
let accountRead = null;
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    calls.push({ method: req.method, url: req.url, body, idem: req.headers['idempotency-key'] ?? null });
    const json = (o, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/bank.json') return json({ 'england-and-wales': { events: [{ date: '2026-12-25', title: 'Christmas Day' }, { date: '2026-12-28', title: 'Boxing Day' }, { date: '2027-01-01', title: 'New Year’s Day' }] } });
    if (req.url.startsWith('/openai/responses')) return json({ model: 'gpt-5-mini', usage: { input_tokens: 400, output_tokens: 120 }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(modelAnswer) }] }] });
    // Accounts v2 makes the host's account; v1 sets and reads its payout schedule (register L, 3 Oct 2026).
    if (req.url === '/v2/core/accounts' && req.method === 'POST') return json({ id: 'acct_test_1', object: 'v2.core.account' });
    // Waking a dormant account: card payments asked for (owner, 3 Oct 2026).
    if (req.url.startsWith('/v2/core/accounts/') && req.method === 'POST') return json({ id: 'acct_test_1', object: 'v2.core.account' });
    if (req.url === '/v1/accounts' && req.method === 'POST') return json({ error: { code: 'invalid_request_error', message: 'Accounts v1 creation is refused' } }, 400);
    if (req.url.startsWith('/v1/accounts/') && accountRead) return json(accountRead);
    if (req.url.startsWith('/v1/accounts/')) return json({ id: 'acct_test_1', details_submitted: !dormantRead, charges_enabled: !dormantRead, payouts_enabled: !dormantRead, capabilities: dormantRead ? {} : { card_payments: 'active', transfers: 'active' }, individual: { id: 'person_test_1' }, settings: { payouts: { schedule: { interval: 'manual' } } }, requirements: { currently_due: [], eventually_due: [], past_due: [] } });
    if (req.url === '/v1/account_links') return json({ url: 'https://connect.stripe.test/onboard' });
    if (req.url === '/v1/identity/verification_sessions' && req.method === 'POST') return json({ id: 'vs_test_1', url: 'https://verify.stripe.test/start' });
    if (req.url.startsWith('/v1/identity/verification_sessions/')) return json({ id: 'vs_test_1', status: 'verified' });
    if (req.url === '/v1/checkout/sessions' && req.method === 'POST') return json({ id: 'cs_test_1', url: 'https://checkout.stripe.test/pay' });
    if (req.url.endsWith('/expire')) return json({ id: 'cs_test_1', status: 'expired' });
    if (req.url.startsWith('/v1/checkout/sessions/')) return json(checkoutStatus === 'pro-paid' ? { id: 'cs_pro_1', mode: 'subscription', status: 'complete', payment_status: 'paid', subscription: 'sub_1', metadata: { epic_kind: 'pro' } } : checkoutStatus === 'paid' ? { id: 'cs_test_1', mode: 'payment', status: 'complete', payment_status: 'paid', metadata: { epic_kind: 'event' } } : { id: 'cs_test_1', mode: 'payment', status: 'open', payment_status: 'unpaid', url: 'https://checkout.stripe.test/pay', metadata: { epic_kind: 'event' } });
    return json({ error: { code: 'not_found' } }, 404);
  });
});
fake.listen(0, '127.0.0.1');
await new Promise((r) => fake.once('listening', r));
const FAKE = `http://127.0.0.1:${fake.address().port}`;
process.env.OPENAI_API_KEY = 'sk-test-openai';
process.env.OPENAI_BASE_URL = `${FAKE}/openai`;
process.env.STRIPE_API_BASE = FAKE;
process.env.EPIC_BANK_HOLIDAYS_URL = `${FAKE}/bank.json`;
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.EPIC_APP_URL = 'https://app.epic.test';

const { aHousehold, testDatabase } = await import('./helpers/db.js');
const { query, pool } = await testDatabase();
const lanes = (await import('../src/routes/hostLanes.js'));
const { runAsAccount } = await import('../src/context.js');
const repo = await import('../src/repositories/hosting.js');
const { publishBlockers } = await import('../src/domain/hosting.js');
const { stripeStatus } = await import('../src/sources/stripe.js');

test.after(async () => { await new Promise((r) => fake.close(r)); await pool?.end?.(); });

async function server(account) {
  const app = express();
  app.use('/api', lanes.webhookRouter);
  app.use(express.json());
  app.use((req, _res, next) => { req.session = null; runAsAccount(account, next); });
  app.use('/api', lanes.default);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.code ?? 'x', message: err.message, details: err.details ?? null }));
  const s = app.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  const out = (r) => r.json().catch(() => null).then((body) => ({ status: r.status, body }));
  return {
    base,
    close: () => new Promise((r) => s.close(r)),
    get: (p) => fetch(base + p).then(out),
    send: (method, p, body) => fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(out),
    raw: (p, body, headers) => fetch(base + p, { method: 'POST', headers, body }).then(out),
  };
}

async function anAccount(h, member, { email = `host-${crypto.randomUUID().slice(0, 8)}@example.com`, mobile = null } = {}) {
  const { rows: [a] } = await query(
    "insert into accounts (household_id, member_id, email, mobile, role, status, name) values ($1,$2,$3,$4,'customer','active','Maya Okafor') returning *",
    [h.id, member.id, email, mobile],
  );
  return a;
}

const withStripe = async (key, fn) => { const was = process.env.STRIPE_SECRET_KEY; if (key) process.env.STRIPE_SECRET_KEY = key; else delete process.env.STRIPE_SECRET_KEY; try { return await fn(); } finally { if (was) process.env.STRIPE_SECRET_KEY = was; else delete process.env.STRIPE_SECRET_KEY; } };

// ---------------------------------------------------------------------------

test('a draft is made in a lane, with the lane’s steps, and only on asking', async () => {
  const { household: h, member } = await aHousehold(query);
  const srv = await server(await anAccount(h, member));
  try {
    const home = await srv.get('/api/host/lanes');
    assert.equal(home.status, 200);
    assert.deepEqual(home.body.drafts, [], 'opening the Host tab leaves nothing behind');
    assert.equal(home.body.config.seq.course.length, 9);
    assert.ok(home.body.config.bankHolidays.some((b) => b.date === '2026-12-25'), 'gov.uk’s list, England and Wales');
    assert.equal((await srv.send('POST', '/api/host/lanes/offers', { lane: 'fortnightly' })).status, 400);
    assert.equal((await srv.send('POST', '/api/host/lanes/offers', { lane: 'oneoff', minCount: 9, maxCount: 3 })).body.error, 'min_over_max');
    assert.equal(Number((await query("select count(*) from host_offers o join hosts h on h.id = o.host_id where h.household_id = $1", [h.id])).rows[0].count), 0, 'a refused first save leaves no draft behind');
    for (const lane of ['oneoff', 'weekly', 'course', 'onrequest']) {
      const r = await srv.send('POST', '/api/host/lanes/offers', { lane, whatLabel: 'Something', title: `A ${lane}`, draftStep: 'what' });
      assert.equal(r.status, 201, lane);
      assert.equal(r.body.offer.lane, lane);
      assert.equal(r.body.offer.state, 'draft');
      assert.equal(r.body.offer.steps.at(-1), 'who');
    }
    const after = await srv.get('/api/host/lanes');
    assert.equal(after.body.drafts.length, 4, 'Save and finish later comes back to all four');
    const shapes = (await query("select lane, shape from host_offers where host_id = (select id from hosts where household_id = $1)", [h.id])).rows;
    assert.deepEqual(Object.fromEntries(shapes.map((r) => [r.lane, r.shape])), { oneoff: 'oneoff', weekly: 'series', course: 'series', onrequest: 'anytime' }, 'the old readers see the old shapes');
  } finally { await srv.close(); }
});

test('a step saves; answers that contradict themselves are refused; the money follows the price', async () => {
  const { household: h, member } = await aHousehold(query);
  const srv = await server(await anAccount(h, member));
  try {
    const { body: { offer } } = await srv.send('POST', '/api/host/lanes/offers', { lane: 'oneoff', whatLabel: 'Birthday party', title: 'Maya’s 40th' });
    const p = (body) => srv.send('PATCH', `/api/host/lanes/offers/${offer.id}`, body);
    assert.equal((await p({ minCount: 12, maxCount: 10 })).body.error, 'min_over_max');
    assert.equal((await p({ ageMin: 12, ageMax: 5 })).body.error, 'ages_backwards');
    assert.equal((await p({ multiDay: true, startsOn: '2027-06-12', endsOn: '2027-06-11' })).body.error, 'ends_before_start');
    assert.equal((await p({ multiDay: true, startsOn: '2027-06-12', endsOn: '2027-06-19' })).body.error, 'too_many_days', 'a one-off runs over at most four days');
    let r = await p({ startsOn: '2027-06-12', startsAt: '13:00', endsAt: '23:00', draftStep: 'when' });
    assert.equal(r.status, 200);
    assert.equal(r.body.offer.startsAt, '13:00');
    assert.equal(r.body.offer.draftStep, 'when');
    assert.ok(!r.body.offer.missing.includes('when'));

    r = await p({ priceMode: 'same_each', pricePence: 3500, childPence: 2000, minCount: 5, maxCount: 10, refundPolicy: 'moderate' });
    assert.equal((await p({ decidesOn: '2027-06-19' })).body.error, 'decides_after_start', 'decides by comes before the first session');
    assert.equal(r.body.offer.money, 'epic', 'paid defaults to Epic collecting');
    assert.equal(r.body.offer.refundWords, 'Full refund up to 5 days before');
    assert.equal(r.body.offer.decidesOnDefault, '2027-06-05', 'a week before the first session');
    r = await p({ money: 'direct' });
    assert.equal(r.body.offer.money, 'direct', 'a private host may be paid directly');
    r = await p({ visibility: 'public' });
    assert.equal(r.body.offer.money, 'epic', 'public and paid is Epic-collects only');
    r = await p({ priceMode: 'free' });
    assert.equal(r.body.offer.pricePence, null);
    assert.equal(r.body.offer.childPence, null);
    assert.equal(r.body.offer.money, 'free');
    assert.equal(r.body.offer.refundPolicy, null, 'no refund policy on a free event');

    // The children's path, and its answer going when the range does.
    r = await p({ ageMin: 5, ageMax: 11 });
    assert.equal(r.body.offer.asksParents, true);
    r = await p({ parents: 'drop_off' });
    assert.equal(r.body.offer.needsChecked, true, 'public, under 18, dropped off');
    r = await p({ ageMin: null, ageMax: null });
    assert.equal(r.body.offer.parents, null, 'Anyone: no children’s path');

    // Guest questions are only what the toggles allow.
    r = await p({ guestQuestions: { diet: { on: true, ticks: ['vegan', 'chocolate'] }, bring: { on: true, items: [{ id: 'x1', name: 'A salad', qty: 4 }] } } });
    assert.deepEqual(r.body.offer.guestQuestions.diet.ticks, ['vegan']);
    assert.equal(r.body.offer.guestQuestions.bring.items[0].qty, 4);

    // Co-hosts: the whole list, in order.
    r = await p({ cohosts: [{ name: 'Dan Reid', role: 'cohost', canEdit: true }, { name: 'Ollie Hart', role: 'helper' }] });
    assert.deepEqual(r.body.offer.cohosts.map((c) => [c.name, c.role, c.canEdit]), [['Dan Reid', 'cohost', true], ['Ollie Hart', 'helper', false]]);
  } finally { await srv.close(); }
});

test('weekly: more than one day, its own price boxes, and the run skipping bank holidays', async () => {
  const { household: h, member } = await aHousehold(query);
  const srv = await server(await anAccount(h, member));
  try {
    const { body: { offer } } = await srv.send('POST', '/api/host/lanes/offers', { lane: 'weekly', whatLabel: 'Yoga class', title: 'Thursday yoga' });
    const r = await srv.send('PATCH', `/api/host/lanes/offers/${offer.id}`, { weekdays: [4, 2], firstDate: '2026-12-22', startsAt: '19:00', durationMin: 60, excludeBankHolidays: true, skippedDates: ['2026-12-29'], dropInPence: 1200, bookAheadPence: 1000, dropInGroupPct: 10, dropInGroupMin: 4, minCount: 4, maxCount: 12, refundPolicy: 'flexible' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.offer.weekdays, [2, 4]);
    const { body: { offer: c } } = await srv.send('POST', '/api/host/lanes/offers', { lane: 'course', sessions: 30 });
    assert.equal(c.sessions, 20, 'a course is held to the configured most sessions');
    assert.equal((await query('select join_mode from host_offers where id = $1', [c.id])).rows[0].join_mode, 'whole', 'a course is booked whole, never one session');
    assert.deepEqual(r.body.offer.run.dates.slice(0, 3), ['2026-12-22', '2026-12-24', '2026-12-31'], 'Christmas Eve is no holiday; 29 Dec is the host’s');
    assert.equal(r.body.offer.paid, true);
    assert.equal(r.body.offer.priceMode, 'same_each');
    assert.deepEqual(r.body.offer.missing, ['where', 'who']);
  } finally { await srv.close(); }
});

test('the photo picked on step 1 travels with the first save', async () => {
  const { household: h, member } = await aHousehold(query);
  const srv = await server(await anAccount(h, member));
  try {
    const { rows: [m] } = await query("insert into host_media (household_id, kind, mime, bytes, size) values ($1, 'photo', 'image/jpeg', '\\x00', 1) returning id", [h.id]);
    const r = await srv.send('POST', '/api/host/lanes/offers', { lane: 'oneoff', whatLabel: 'BBQ', title: 'A BBQ', photoIds: [m.id] });
    assert.deepEqual(r.body.offer.photos.map((p) => p.id), [m.id]);
    const other = await aHousehold(query);
    const { rows: [theirs] } = await query("insert into host_media (household_id, kind, mime, bytes, size) values ($1, 'photo', 'image/jpeg', '\\x00', 1) returning id", [other.household.id]);
    assert.equal((await srv.send('POST', '/api/host/lanes/offers', { lane: 'oneoff', photoIds: [theirs.id] })).body.error, 'not_your_media');
  } finally { await srv.close(); }
});

test('somebody else’s draft is not yours', async () => {
  const a = await aHousehold(query);
  const b = await aHousehold(query);
  const mine = await server(await anAccount(a.household, a.member));
  const theirs = await server(await anAccount(b.household, b.member));
  try {
    const { body: { offer } } = await mine.send('POST', '/api/host/lanes/offers', { lane: 'course' });
    assert.equal((await theirs.get(`/api/host/lanes/offers/${offer.id}`)).status, 404);
    assert.equal((await theirs.send('PATCH', `/api/host/lanes/offers/${offer.id}`, { title: 'Mine now' })).status, 404);
  } finally { await mine.close(); await theirs.close(); }
});

test('Say it fills a fresh draft, never overwrites the host, and a later step takes only its own fields', async () => {
  const { household: h, member } = await aHousehold(query);
  const srv = await server(await anAccount(h, member));
  try {
    modelAnswer = { whatLabel: 'Birthday party', title: 'Maya’s 40th in the garden', line: 'Drinks, a long lunch and a band.', startsOn: '2026-06-13', startsAt: '13:00', endsAt: '23:00', endsOn: null,
      runningOrder: [{ time: '13:00', title: 'Drinks on the lawn' }], venue: 'your_place', place: 'The Old Rectory, Henley RG9 2AB', weekdays: null, firstDate: null, durationMin: null, sessions: null, outcome: null, topics: null, whyYou: null,
      freeHours: null, sessionLengths: null, priceMode: null, pricePence: null, childPence: null, totalPence: null, minCount: null, maxCount: 60, dropInPence: null, bookAheadPence: null, visibility: 'invite', ageMin: null, ageMax: null, parents: null, otherHosts: ['Dan Reid'] };
    const before = Number((await query("select count(*) from provider_calls where household_id = $1 and provider = 'openai'", [h.id])).rows[0].count);
    let r = await srv.send('POST', '/api/host/lanes/extract', { lane: 'oneoff', text: 'It’s Maya’s fortieth, a garden party at ours…' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const id = r.body.offer.id;
    assert.equal(r.body.offer.title, 'Maya’s 40th in the garden');
    assert.equal(r.body.offer.venueLabel, 'The Old Rectory, Henley RG9 2AB');
    assert.equal(r.body.offer.runningOrder[0].title, 'Drinks on the lawn');
    assert.deepEqual(r.body.offer.cohosts.map((c) => c.name), ['Dan Reid']);
    assert.equal(r.body.offer.draftSource, 'said');
    assert.ok(r.body.found.includes('title'));
    const after = Number((await query("select count(*) from provider_calls where household_id = $1 and provider = 'openai' and purpose = 'host.draft.extract'", [h.id])).rows[0].count);
    assert.equal(after, before + 1, 'the read is on the ledger');

    // The host changes the title; a second read does not undo it.
    await srv.send('PATCH', `/api/host/lanes/offers/${id}`, { title: 'Maya at forty' });
    modelAnswer = { ...modelAnswer, title: 'Something else', startsAt: '14:00' };
    r = await srv.send('POST', '/api/host/lanes/extract', { lane: 'oneoff', offerId: id, text: 'again' });
    assert.equal(r.body.offer.title, 'Maya at forty');
    assert.equal(r.body.offer.startsAt, '13:00', 'a filled field stays');

    // The header mic on the When step: When's fields take what was said, nothing else moves.
    r = await srv.send('POST', '/api/host/lanes/extract', { lane: 'oneoff', offerId: id, step: 'when', text: 'two till eleven' });
    assert.equal(r.body.offer.startsAt, '14:00');
    assert.equal(r.body.offer.title, 'Maya at forty');
    assert.deepEqual(r.body.found.sort(), ['endsAt', 'startsAt', 'startsOn']);
    const steps = Number((await query("select count(*) from provider_calls where household_id = $1 and purpose = 'host.draft.step'", [h.id])).rows[0].count);
    assert.equal(steps, 1);
  } finally { await srv.close(); }
});

test('Upload it reads a text note, and refuses what it cannot read', async () => {
  const { household: h, member } = await aHousehold(query);
  const srv = await server(await anAccount(h, member));
  try {
    modelAnswer = { whatLabel: 'Cooking lesson', title: 'A Thai cooking lesson at yours', line: null, startsOn: null, startsAt: null, endsAt: null, endsOn: null, runningOrder: null, venue: 'their_place', place: 'Reading RG1', weekdays: null, firstDate: null, durationMin: null, sessions: null, outcome: null, topics: null, whyYou: 'Ten years in Bangkok kitchens.', freeHours: [{ weekday: 6, from: '14:00', to: '17:00' }], sessionLengths: [120, 180], priceMode: 'same_each', pricePence: 8000, childPence: null, totalPence: null, minCount: null, maxCount: 4, dropInPence: null, bookAheadPence: null, visibility: null, ageMin: null, ageMax: null, parents: null, otherHosts: null };
    let r = await srv.raw('/api/host/lanes/read?lane=onrequest', 'I teach Thai cooking…', { 'content-type': 'text/plain' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.offer.whyYou, 'Ten years in Bangkok kitchens.');
    assert.deepEqual(r.body.offer.freeHours, { 6: [['14:00', '17:00']] });
    assert.equal(r.body.offer.venueArea, 'Reading RG1', 'their place: the area, not an address');
    assert.equal(r.body.offer.venue, 'their_place', 'the set-up speaks from the host’s side');
    assert.equal((await query('select venue from host_offers where id = $1', [r.body.offer.id])).rows[0].venue, 'your_place', 'stored from the guest’s side, as the guest page and booking read it');
    assert.equal(r.body.offer.draftSource, 'uploaded');
    r = await srv.raw('/api/host/lanes/read?lane=onrequest', 'x', { 'content-type': 'application/zip' });
    assert.equal(r.status, 415);
    const before = calls.length;
    r = await srv.raw('/api/host/lanes/read?lane=onrequest', 'x', { 'content-type': 'image/heic' });
    assert.equal(r.body.error, 'heic', 'an iPhone photo the reader cannot look at is turned away');
    assert.equal(calls.length, before, 'before anything is paid for');
  } finally { await srv.close(); }
});

test('the profile sheet: date of birth always, eighteen or over; tax and Checked are checked', async () => {
  const { household: h, member } = await aHousehold(query);
  const srv = await server(await anAccount(h, member));
  try {
    const young = new Date(); young.setUTCFullYear(young.getUTCFullYear() - 17);
    assert.equal((await srv.send('PATCH', '/api/host/lanes/profile', { dateOfBirth: young.toISOString().slice(0, 10) })).body.error, 'too_young');
    assert.equal((await srv.send('PATCH', '/api/host/lanes/profile', { dateOfBirth: '1986-02-30' })).body.error, 'dob_required');
    let r = await srv.send('PATCH', '/api/host/lanes/profile', { name: 'Maya Okafor', line: 'Henley local', dateOfBirth: '1986-03-02', mobile: '07700 900 118' });
    assert.equal(r.status, 200);
    assert.equal(r.body.host.dateOfBirth, '1986-03-02');
    assert.equal(r.body.host.mobile, '07700900118');
    assert.equal((await srv.send('POST', '/api/host/lanes/tax', { reference: '12345' })).body.error, 'bad_tax_reference');
    assert.equal((await srv.send('POST', '/api/host/lanes/tax', { reference: 'QQ 12 34 56 C' })).body.error, 'bad_tax_reference', 'HMRC’s specimen prefix is never a real number');
    assert.equal((await srv.send('POST', '/api/host/lanes/tax', { reference: 'AO123456A' })).body.error, 'bad_tax_reference', 'O is never the second letter');
    assert.equal((await srv.send('POST', '/api/host/lanes/tax', { reference: 'GB123456A' })).body.error, 'bad_tax_reference', 'GB is never issued');
    r = await srv.send('POST', '/api/host/lanes/tax', { reference: 'AB 12 34 56 C' });
    assert.equal(r.body.host.tax, '••••56C', 'shown back only masked');
    assert.equal((await srv.send('POST', '/api/host/lanes/checked', { dbsNumber: '123', referees: [] })).body.error, 'bad_dbs');
    assert.equal((await srv.send('POST', '/api/host/lanes/checked', { dbsNumber: '001234567890', referees: [{ name: 'A', email: 'a@x.com' }] })).body.error, 'insurance_required');
  } finally { await srv.close(); }
});

/** A host with everything a private checklist asks for, but the fee. */
async function readyHost(h, member, { mobile = `077${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, verified = true } = {}) {
  const account = await anAccount(h, member, { mobile });
  const { rows: [m] } = await query("insert into host_media (household_id, kind, mime, bytes, size) values ($1, 'photo', 'image/jpeg', '\\x00', 1) returning id", [h.id]);
  const host = await repo.insertHost(h.id, { name: 'Maya Okafor', dateOfBirth: '1986-03-02', accountId: account.id });
  // Every host proves who they are once (L7); a test about that check starts with a host who hasn't.
  await repo.updateHost(host.id, { photoId: m.id, introText: 'Henley local', ...(verified ? { identityState: 'verified', identityVerifiedAt: new Date('2026-09-01T10:00:00Z') } : {}) });
  return account;
}

async function filledOneoff(srv, extra = {}) {
  const { body: { offer } } = await srv.send('POST', '/api/host/lanes/offers', { lane: 'oneoff', whatLabel: 'Birthday party', title: 'Maya’s 40th' });
  const r = await srv.send('PATCH', `/api/host/lanes/offers/${offer.id}`, {
    startsOn: '2027-06-12', startsAt: '13:00', endsAt: '23:00', venue: 'your_place', venueLabel: 'The Old Rectory, Henley', priceMode: 'free', maxCount: 60, visibility: 'invite', ...extra,
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.offer;
}

test('private: nothing is sent before the £10 is paid through Stripe (test mode); then the invites go', async () => {
  const { household: h, member } = await aHousehold(query);
  const srv = await server(await readyHost(h, member));
  try {
    const offer = await filledOneoff(srv);
    assert.deepEqual(offer.blockers, []);
    assert.equal(offer.action.label, 'Pay £10 · send the invites');
    // A date that has gone is never sent or paid for.
    await query("update host_offers set starts_on = '2026-01-10' where id = $1", [offer.id]);
    assert.equal((await srv.send('POST', `/api/host/lanes/offers/${offer.id}/publish`, { plan: 'event' })).body.error, 'in_the_past');
    await query("update host_offers set starts_on = '2027-06-12' where id = $1", [offer.id]);
    await query("insert into offer_invites (offer_id, name, contact, contact_kind, heads, token) values ($1, 'Auntie Carol', '07700900412', 'mobile', 2, $2)", [offer.id, crypto.randomUUID()]);

    await withStripe(null, async () => {
      const r = await srv.send('POST', `/api/host/lanes/offers/${offer.id}/publish`, { plan: 'event' });
      assert.equal(r.status, 503);
      assert.equal(r.body.error, 'stripe_not_configured');
    });
    await withStripe('sk_live_nope', async () => {
      assert.equal(stripeStatus().ready, false, 'a live key is refused until the owner approves going live');
      assert.equal((await srv.send('POST', `/api/host/lanes/offers/${offer.id}/publish`, { plan: 'event' })).body.error, 'stripe_live_refused');
    });
    await withStripe('sk_test_fake', async () => {
      let r = await srv.send('POST', `/api/host/lanes/offers/${offer.id}/publish`, { plan: 'event' });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.pay.url, 'https://checkout.stripe.test/pay');
      const checkout = calls.filter((c) => c.url === '/v1/checkout/sessions').at(-1);
      assert.match(checkout.body, /unit_amount%5D=1000/, 'the £10 placeholder, in pence');
      assert.equal(checkout.idem, `fee-${offer.id}-event-0`, 'a lost answer retried gets the same Checkout back');
      assert.equal((await query('select state from host_offers where id = $1', [offer.id])).rows[0].state, 'draft', 'not sent before it is paid');
      const pay = (await query("select * from hosting_payments where offer_id = $1", [offer.id])).rows[0];
      assert.equal(pay.kind, 'private_fee'); assert.equal(pay.mode, 'test'); assert.equal(pay.amount_pence, 1000);
      const ledger = Number((await query("select count(*) from provider_calls where household_id = $1 and provider = 'stripe'", [h.id])).rows[0].count);
      assert.ok(ledger >= 1, 'every Stripe call is on the ledger');

      // Pressed again before paying: the same session, never a second one that could also be paid.
      checkoutStatus = 'open';
      const made = calls.filter((c) => c.url === '/v1/checkout/sessions' && c.method === 'POST').length;
      r = await srv.send('POST', `/api/host/lanes/offers/${offer.id}/publish`, { plan: 'event' });
      assert.equal(r.body.pay.url, 'https://checkout.stripe.test/pay');
      assert.equal(calls.filter((c) => c.url === '/v1/checkout/sessions' && c.method === 'POST').length, made, 'no second Checkout');
      // Switching to Pro closes the open one first.
      r = await srv.send('POST', `/api/host/lanes/offers/${offer.id}/publish`, { plan: 'pro' });
      assert.ok(calls.some((c) => c.url.endsWith('/expire')), 'the £10 session is expired before Pro is offered');
      assert.equal((await query("select state from hosting_payments where offer_id = $1 and kind = 'private_fee'", [offer.id])).rows[0].state, 'cancelled');
      await srv.send('PATCH', `/api/host/lanes/offers/${offer.id}`, { privatePlan: 'event' });
      await query("update host_offers set private_fee_state = 'pending', private_fee_ref = 'cs_test_1' where id = $1", [offer.id]);
      checkoutStatus = 'paid';
      // Back from Checkout: Stripe is asked, not the return URL believed.
      r = await srv.send('POST', `/api/host/lanes/offers/${offer.id}/sync`);
      assert.equal(r.body.offer.privateFeeState, 'paid');
      assert.equal(r.body.offer.action.label, 'Send the invites');
      r = await srv.send('POST', `/api/host/lanes/offers/${offer.id}/publish`, {});
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.offer.state, 'live');
      // A household that joined Pro from the checklist is Pro for its next private event too.
      await query("insert into hosting_payments (kind, household_id, amount_pence, state, stripe_ref, mode) values ('pro', $1, 1299, 'succeeded', 'cs_pro_test', 'test')", [h.id]);
      const next = await filledOneoff(srv);
      assert.equal(next.action.label, 'Send the invites', 'not asked to buy Pro again');
      // Pro ended: an event it covered but never sent asks for the £10 again.
      await query("update host_offers set private_fee_state = 'included' where id = $1", [next.id]);
      await query("update hosting_payments set state = 'cancelled' where household_id = $1 and kind = 'pro'", [h.id]);
      assert.equal((await srv.get(`/api/host/lanes/offers/${next.id}`)).body.offer.action.label, 'Pay £10 · send the invites');
      assert.equal(r.body.ending.kind, 'invites');
      assert.equal(r.body.ending.invited, 2);
      assert.equal(r.body.offer.sessionRows.length, 1, 'the one date laid down');
      assert.equal((await srv.send('PATCH', `/api/host/lanes/offers/${offer.id}`, { title: 'Changed' })).status, 409, 'out is out: changes are host management’s');
    });
  } finally { await srv.close(); }
});

test('private: the profile blocks sending; a missing mobile blocks it too', async () => {
  const { household: h, member } = await aHousehold(query);
  const srv = await server(await readyHost(h, member, { mobile: null }));
  try {
    const offer = await filledOneoff(srv);
    assert.deepEqual(offer.blockers, ['phone']);
    const r = await srv.send('POST', `/api/host/lanes/offers/${offer.id}/publish`, {});
    assert.equal(r.status, 422);
    assert.equal(r.body.error, 'checklist');
  } finally { await srv.close(); }
});

test('public: Verified and the video block review; Checked and tax wait; then it is sent for review', async () => {
  const { household: h, member } = await aHousehold(query);
  const srv = await server(await readyHost(h, member, { verified: false }));
  try {
    const { body: { offer: o } } = await srv.send('POST', '/api/host/lanes/offers', { lane: 'course', whatLabel: 'Swimming lessons', title: 'Learn to swim' });
    let r = await srv.send('PATCH', `/api/host/lanes/offers/${o.id}`, {
      firstDate: '2027-01-09', startsAt: '09:00', durationMin: 45, sessions: 8, outcome: 'Swim a width on their own.', parents: 'drop_off',
      venue: 'out_about', venueLabel: 'Marlow Leisure Centre', priceMode: 'same_each', pricePence: 9600, minCount: 4, maxCount: 8, refundPolicy: 'strict', visibility: 'public', ageMin: 5, ageMax: 8,
      topics: [{ n: 1, title: 'In the water' }, { n: 2, title: 'Floating' }],
    });
    assert.deepEqual(r.body.offer.missing, []);
    assert.deepEqual(r.body.offer.blockers, ['verified', 'video', 'payouts']);
    assert.equal(r.body.offer.action.label, 'Carry on · Verified');
    assert.equal(r.body.offer.charges.sharePct, 20, 'a new host starts at 20%');
    assert.equal((await srv.send('POST', `/api/host/lanes/offers/${o.id}/publish`)).body.error, 'checklist');

    await withStripe('sk_test_fake', async () => {
      // Consent to the face match first (L7): without it, nothing is opened.
      assert.equal((await srv.send('POST', '/api/host/lanes/verify', { offerId: o.id })).body.error, 'consent_required');
      // Stripe's form can't come before the passport check (owner, 3 Oct 2026).
      assert.equal((await srv.send('POST', '/api/host/lanes/payouts', { offerId: o.id })).body.error, 'verify_first');
      r = await srv.send('POST', '/api/host/lanes/verify', { offerId: o.id, consent: true });
      assert.equal(r.body.url, 'https://verify.stripe.test/start');
      r = await srv.send('POST', '/api/host/lanes/payouts', { offerId: o.id });
      assert.equal(r.body.url, 'https://connect.stripe.test/onboard');
      assert.match(calls.filter((c) => c.url === '/v1/account_links').at(-1).body, /return_url=https%3A%2F%2Fapp\.epic\.test%2Fhost%2Foffers%2F/, 'they come back to the checklist');
      // L3/L6: the account is made by Accounts v2 and put on manual payouts explicitly, before Stripe's form opens.
      const made = calls.findIndex((c) => c.url === '/v2/core/accounts' && c.method === 'POST');
      const manual = calls.findIndex((c) => c.url === '/v1/accounts/acct_test_1' && c.method === 'POST' && /settings%5Bpayouts%5D%5Bschedule%5D%5Binterval%5D=manual/.test(c.body));
      const link = calls.findIndex((c) => c.url === '/v1/account_links');
      assert.ok(made >= 0 && manual > made && link > manual, 'made, then manual payouts, then the hosted form');
      assert.equal(calls.filter((c) => c.url === '/v1/accounts' && c.method === 'POST').length, 0, 'never Accounts v1 creation');
      const h1 = await repo.hostByHousehold(h.id);
      assert.deepEqual([h1.stripe_account_model, h1.stripe_person_id, h1.stripe_payouts_manual], ['v2', 'person_test_1', true]);
      r = await srv.send('POST', `/api/host/lanes/offers/${o.id}/sync`);
      assert.equal(r.body.offer.checklist.find((i) => i.key === 'verified').done, true);
      assert.equal(r.body.offer.checklist.find((i) => i.key === 'payouts').done, true);
    });
    const { rows: [v] } = await query("insert into host_media (household_id, kind, mime, bytes, size, duration_s) values ($1, 'video', 'video/webm', '\\x00', 1, 48) returning id", [h.id]);
    r = await srv.send('POST', `/api/host/lanes/offers/${o.id}/video`, { videoId: v.id, madeBy: 'self', coverS: 3, onProfile: true });
    assert.equal(r.body.offer.video.seconds, 48, 'the length shown is the take’s own');
    const { rows: [tiny] } = await query("insert into host_media (household_id, kind, mime, bytes, size, duration_s) values ($1, 'video', 'video/webm', '\\x00', 1, 3) returning id", [h.id]);
    assert.equal((await srv.send('POST', `/api/host/lanes/offers/${o.id}/video`, { videoId: tiny.id, madeBy: 'self' })).body.error, 'video_length', 'three seconds is not an offer video');
    assert.deepEqual(r.body.offer.blockers, []);
    assert.equal(r.body.offer.action.label, 'Send for review');

    process.env.OPENAI_API_KEY = '';
    try { r = await srv.send('POST', `/api/host/lanes/offers/${o.id}/publish`); } finally { process.env.OPENAI_API_KEY = 'sk-test-openai'; }
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.offer.state, 'in_review');
    assert.equal(r.body.ending.kind, 'review');
    assert.deepEqual(r.body.ending.stillToDo, ['checked', 'tax']);
    assert.equal(r.body.offer.sessionRows.length, 8);
    assert.equal(r.body.offer.sessionRows[0].topic, 'In the water');
    // Checked: evidence changed after a pass goes back to be read again.
    const { rows: [ins] } = await query("insert into host_media (household_id, kind, mime, bytes, size) values ($1, 'doc', 'application/pdf', '\\x00', 1) returning id", [h.id]);
    const referees = [{ name: 'A Ref', email: 'a@example.com' }, { name: 'B Ref', email: 'b@example.com' }];
    r = await srv.send('POST', '/api/host/lanes/checked', { dbsNumber: '001234567890', insuranceMediaId: ins.id, referees });
    assert.equal(r.body.host.checked, 'submitted');
    await query("update hosts set checked_state = 'passed' where household_id = $1", [h.id]);
    r = await srv.send('POST', '/api/host/lanes/checked', { dbsNumber: '001234567890', insuranceMediaId: ins.id, referees });
    assert.equal(r.body.host.checked, 'passed', 'the same evidence keeps its pass');
    r = await srv.send('POST', '/api/host/lanes/checked', { dbsNumber: '009999999999', insuranceMediaId: ins.id, referees });
    assert.equal(r.body.host.checked, 'submitted', 'a new DBS number is read again');
    await query("update hosts set checked_state = 'none' where household_id = $1", [h.id]);
    // The back office cannot put it live while Checked is outstanding.
    const row = await repo.offerById(o.id);
    const host = await repo.hostByHousehold(h.id);
    assert.ok(publishBlockers(row, host).some((b) => /Checked/.test(b)));
    await repo.updateHost(host.id, { checkedState: 'passed' });
    assert.deepEqual(publishBlockers(row, await repo.hostByHousehold(h.id)), []);
  } finally { await srv.close(); }
});

test('Stripe’s webhook: admitted by its signature, test mode only', async () => {
  const { household: h, member } = await aHousehold(query);
  const srv = await server(await anAccount(h, member));
  // An account event is applied from the account read back from Stripe: the fake answers with this one.
  accountRead = { id: 'acct_hook', details_submitted: true, charges_enabled: true, payouts_enabled: true, settings: { payouts: { schedule: { interval: 'manual' } } }, capabilities: { card_payments: 'active', transfers: 'active' }, requirements: { currently_due: [], eventually_due: [], past_due: [], disabled_reason: null } };
  const was = process.env.STRIPE_SECRET_KEY; process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
  try {
    const host = await repo.insertHost(h.id, { name: 'Hooked' });
    await repo.updateHost(host.id, { stripeAccountId: `acct_${host.id.slice(0, 8)}`, payoutsState: 'pending', stripeAccountModel: 'v2' });
    let n = 0;
    const event = (livemode, id = `evt_${host.id.slice(0, 8)}_${(n += 1)}`) => JSON.stringify({ id, type: 'account.updated', livemode, data: { object: { id: `acct_${host.id.slice(0, 8)}`, details_submitted: true, charges_enabled: true, payouts_enabled: true, settings: { payouts: { schedule: { interval: 'manual' } } } } } });
    const sign = (body, secret = 'whsec_test') => { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`; };
    let body = event(false);
    assert.equal((await srv.raw('/api/stripe/webhook', body, { 'content-type': 'application/json', 'stripe-signature': sign(body, 'whsec_wrong') })).status, 400);
    body = event(true);
    assert.equal((await srv.raw('/api/stripe/webhook', body, { 'content-type': 'application/json', 'stripe-signature': sign(body) })).body.ignored, 'live');
    assert.equal((await repo.hostById(host.id)).payouts_state, 'pending');
    body = event(false, `evt_${host.id.slice(0, 8)}_once`);
    assert.equal((await srv.raw('/api/stripe/webhook', body, { 'content-type': 'application/json', 'stripe-signature': sign(body) })).status, 200);
    const ready = await repo.hostById(host.id);
    assert.deepEqual([ready.payouts_state, ready.stripe_charges_enabled, ready.stripe_payouts_manual], ['ready', true, true], 'only the facts the brief allows, never a bank detail');
    // Stripe delivers at least once: the same event again is recognised and not applied twice.
    await repo.updateHost(host.id, { payoutsState: 'pending' });
    const again = await srv.raw('/api/stripe/webhook', body, { 'content-type': 'application/json', 'stripe-signature': sign(body) });
    assert.deepEqual([again.status, again.body.duplicate], [200, true]);
    assert.equal((await repo.hostById(host.id)).payouts_state, 'pending', 'a second delivery changes nothing');
    // An event without Stripe's id is not one Epic can hold to once-only.
    const bare = JSON.stringify({ type: 'account.updated', livemode: false, data: { object: {} } });
    assert.equal((await srv.raw('/api/stripe/webhook', bare, { 'content-type': 'application/json', 'stripe-signature': sign(bare) })).status, 400);
  } finally { await srv.close(); accountRead = null; if (was) process.env.STRIPE_SECRET_KEY = was; else delete process.env.STRIPE_SECRET_KEY; }
});

test('a child on a booking has an age or a date of birth — exactly one', async () => {
  const { household: h } = await aHousehold(query);
  const host = await repo.insertHost(h.id, { name: 'Kids host' });
  const offer = await repo.insertOffer(host.id, 'series', { lane: 'course' });
  const { rows: [b] } = await query('insert into experience_bookings (offer_id, host_id, household_id) values ($1,$2,$3) returning id', [offer.id, host.id, h.id]);
  await query('insert into booking_children (booking_id, age) values ($1, 7)', [b.id]);
  await query("insert into booking_children (booking_id, date_of_birth) values ($1, '2019-04-01')", [b.id]);
  await assert.rejects(query('insert into booking_children (booking_id) values ($1)', [b.id]), /age_or_dob/);
  await assert.rejects(query("insert into booking_children (booking_id, age, date_of_birth) values ($1, 7, '2019-04-01')", [b.id]), /age_or_dob/);
});

test('a co-host list is replaced whole or not at all, and a time zone must be real', async () => {
  const { household: h, member } = await aHousehold(query);
  const srv = await server(await anAccount(h, member));
  try {
    const { body: { offer } } = await srv.send('POST', '/api/host/lanes/offers', { lane: 'oneoff', cohosts: [{ name: 'Dan Reid', role: 'cohost' }] });
    const r = await srv.send('PATCH', `/api/host/lanes/offers/${offer.id}`, { cohosts: [{ name: 'Ollie', contactId: 'not-a-uuid' }, { name: 'Sam', contactId: '00000000-0000-0000-0000-000000000000' }] });
    assert.equal(r.status, 200, 'a link that is not this household’s is dropped, not fatal');
    assert.deepEqual(r.body.offer.cohosts.map((c) => [c.name, c.contactId]), [['Ollie', null], ['Sam', null]]);
    assert.equal((await srv.send('PATCH', `/api/host/lanes/offers/${offer.id}`, { timeZone: 'Mars/Olympus' })).body.error, 'bad_time_zone');
    assert.equal((await srv.send('PATCH', `/api/host/lanes/offers/${offer.id}`, { timeZone: 'Europe/London' })).status, 200);
  } finally { await srv.close(); }
});

test('a venue picked from a provider keeps its reference, and its name is never stored as the host’s', async () => {
  const { household: h, member } = await aHousehold(query);
  const srv = await server(await anAccount(h, member));
  try {
    const { body: { offer } } = await srv.send('POST', '/api/host/lanes/offers', { lane: 'oneoff' });
    const r = await srv.send('PATCH', `/api/host/lanes/offers/${offer.id}`, { venue: 'out_about', venueLabel: 'Greenlands, Hambleden RG9 3AU', venueRef: 'google:ChIJabc123' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const row = (await query('select venue_label, venue_label_from, venue_ref from host_offers where id = $1', [offer.id])).rows[0];
    assert.equal(row.venue_ref, 'google:ChIJabc123');
    assert.notEqual(row.venue_label_from, 'host', 'never marked as the host’s own words');
    assert.ok(!row.venue_label, 'the provider’s name is not kept');
    assert.ok(!r.body.offer.missing.includes('where'), 'the reference is enough for the step');
  } finally { await srv.close(); }
});

test('a Pro Checkout paid but never synced sends on the next press — never a second subscription', async () => {
  const { household: h, member } = await aHousehold(query);
  const srv = await server(await readyHost(h, member));
  try {
    const offer = await filledOneoff(srv);
    await withStripe('sk_test_fake', async () => {
      await query("update host_offers set private_plan = 'pro', private_fee_state = 'pending', private_fee_ref = 'cs_pro_1' where id = $1", [offer.id]);
      await query("insert into hosting_payments (kind, offer_id, household_id, amount_pence, state, stripe_ref, mode) values ('pro', $1, $2, 1299, 'pending', 'cs_pro_1', 'test')", [offer.id, h.id]);
      checkoutStatus = 'pro-paid';
      const made = calls.filter((c) => c.url === '/v1/checkout/sessions' && c.method === 'POST').length;
      const r = await srv.send('POST', `/api/host/lanes/offers/${offer.id}/publish`, { plan: 'pro' });
      checkoutStatus = 'paid';
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.offer?.state, 'live', 'sent, not asked to pay again');
      assert.equal(calls.filter((c) => c.url === '/v1/checkout/sessions' && c.method === 'POST').length, made, 'no second Checkout');
    });
  } finally { await srv.close(); }
});

test('a Checkout paid before Epic wrote it down is still recorded by the webhook', async () => {
  const { household: h, member } = await aHousehold(query);
  const srv = await server(await readyHost(h, member));
  try {
    const offer = await filledOneoff(srv);
    const body = JSON.stringify({ id: 'evt_cs_race_1', type: 'checkout.session.completed', livemode: false, data: { object: { id: 'cs_race_1', mode: 'payment', status: 'complete', payment_status: 'paid', amount_total: 1000, metadata: { epic_kind: 'event', epic_offer_id: offer.id, epic_household_id: h.id } } } });
    const t = Math.floor(Date.now() / 1000);
    const sig = `t=${t},v1=${crypto.createHmac('sha256', 'whsec_test').update(`${t}.${body}`).digest('hex')}`;
    assert.equal((await srv.raw('/api/stripe/webhook', body, { 'content-type': 'application/json', 'stripe-signature': sig })).status, 200);
    assert.equal((await query('select private_fee_state from host_offers where id = $1', [offer.id])).rows[0].private_fee_state, 'paid');
    assert.equal((await query("select state from hosting_payments where stripe_ref = 'cs_race_1'")).rows[0].state, 'succeeded');
  } finally { await srv.close(); }
});

test('the older offer routes refuse a lane offer: it is sent only through its own checklist', async () => {
  const { household: h, member } = await aHousehold(query);
  const account = await anAccount(h, member);
  const srv = await server(account);
  const legacy = (await import('../src/routes/hosting.js')).default;
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.session = null; runAsAccount(account, next); });
  app.use('/api', legacy);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.code ?? 'x' }));
  const s = app.listen(0, '127.0.0.1'); await new Promise((r) => s.once('listening', r));
  const base = `http://127.0.0.1:${s.address().port}`;
  try {
    const { body: { offer } } = await srv.send('POST', '/api/host/lanes/offers', { lane: 'oneoff', whatLabel: 'BBQ', title: 'A BBQ' });
    const r = await fetch(`${base}/api/host/offers/${offer.id}/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal((await r.json()).error, 'use_lane_setup');
    const p = await fetch(`${base}/api/host/offers/${offer.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'x' }) });
    assert.equal((await p.json()).error, 'use_lane_setup');
    const d = await fetch(`${base}/api/host/offers/${offer.id}`, { method: 'DELETE' });
    assert.equal((await d.json()).error, 'use_lane_setup', 'nor deleted from the old door');
    // Nor called off from the old door: its "refund" moves no money, so on a lane event it would tell guests they
    // had been paid back when nothing had moved (Hosting v7 handover, 3 Oct 2026). The repository refuses too.
    await query(`update host_offers set state = 'live' where id = $1`, [offer.id]);
    const c = await fetch(`${base}/api/host/offers/${offer.id}/cancel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal((await c.json()).error, 'use_lane_setup', 'not called off from the old door');
    await assert.rejects(repo.cancelOfferAndRefund(offer.id, 'x'), (e) => e.code === 'use_lane_setup');
    assert.equal((await query('select state, cancelled_at from host_offers where id = $1', [offer.id])).rows[0].cancelled_at, null, 'and nothing was ended');
  } finally { await srv.close(); await new Promise((r) => s.close(r)); }
});

test('L7: the passport check is tied to the host’s Stripe Person only while Stripe allows it — before the hosted form opens', async () => {
  const { household: h, member } = await aHousehold(query);
  const srv = await server(await readyHost(h, member, { verified: false }));
  try {
    const host = await repo.hostByHousehold(h.id);
    await repo.updateHost(host.id, { stripeAccountId: 'acct_test_1', stripeAccountModel: 'v2', stripePersonId: 'person_test_1' });
    const sessions = () => calls.filter((c) => c.url === '/v1/identity/verification_sessions' && c.method === 'POST');
    await withStripe('sk_test_fake', async () => {
      await srv.send('POST', '/api/host/lanes/verify', { offerId: null, consent: true });
      const tied = new URLSearchParams(sessions().at(-1).body);
      assert.deepEqual([tied.get('related_person[account]'), tied.get('related_person[person]')], ['acct_test_1', 'person_test_1']);
      assert.equal(tied.get('options[document][allowed_types][0]'), 'passport');
      assert.equal(tied.get('options[document][allowed_types][1]'), null, 'passport only while the licence setting is off');
      // Once Stripe's form has been opened Stripe refuses the tie, so it isn't asked for.
      await repo.updateHost(host.id, { identityState: 'none', identitySessionId: null, stripeLinkMadeAt: new Date() });
      await srv.send('POST', '/api/host/lanes/verify', { offerId: null, consent: true });
      assert.equal(new URLSearchParams(sessions().at(-1).body).get('related_person[account]'), null);
    });
  } finally { await srv.close(); }
});

test('an account from before register L is left alone for the owner’s void, never replaced by set-up', async () => {
  const { household: h, member } = await aHousehold(query);
  const srv = await server(await readyHost(h, member));
  try {
    const host = await repo.hostByHousehold(h.id);
    await repo.updateHost(host.id, { stripeAccountId: 'acct_old_1', payoutsState: 'ready' });
    const made = () => calls.filter((c) => c.url === '/v2/core/accounts').length;
    const before = made();
    await withStripe('sk_test_fake', async () => {
      const r = await srv.send('POST', '/api/host/lanes/payouts', { offerId: null });
      assert.deepEqual([r.status, r.body.error], [409, 'old_stripe_account']);
    });
    assert.equal(made(), before, 'no new account made');
    assert.equal((await repo.hostById(host.id)).stripe_account_id, 'acct_old_1', 'the old id is still there for the void to keep');
  } finally { await srv.close(); }
});

test('L7: every host — free or paid — gets a dormant Stripe account at the passport step, tied to the check; it wakes when they first take money', async () => {
  const { household: h, member } = await aHousehold(query);
  const srv = await server(await readyHost(h, member, { verified: false }));
  try {
    const host = await repo.hostByHousehold(h.id);
    const free = await repo.insertOffer(host.id, 'oneoff', { lane: 'oneoff' });
    const made = () => calls.filter((c) => c.url === '/v2/core/accounts' && c.method === 'POST');
    const before = made().length;
    const linksBefore = calls.filter((c) => c.url === '/v1/account_links').length;
    await withStripe('sk_test_fake', async () => {
      // A free host: an account is made silently and dormant — no capabilities asked for — and the check tied to it.
      await srv.send('POST', '/api/host/lanes/verify', { offerId: free.id, consent: true });
      assert.equal(made().length, before + 1, 'made at the passport step, free host too');
      const body = JSON.parse(made().at(-1).body);
      assert.equal(body.configuration.merchant.capabilities, undefined, 'dormant: nothing requested');
      assert.equal(body.configuration.recipient, undefined);
      const tied = new URLSearchParams(calls.filter((c) => c.url === '/v1/identity/verification_sessions' && c.method === 'POST').at(-1).body);
      assert.deepEqual([tied.get('related_person[account]'), tied.get('related_person[person]')], ['acct_test_1', 'person_test_1']);
      assert.ok(calls.some((c) => c.url === '/v1/accounts/acct_test_1' && /interval%5D=manual/.test(c.body ?? '')), 'manual payouts, dormant or not');
      assert.equal(calls.filter((c) => c.url === '/v1/account_links').length, linksBefore, 'the host never sees Stripe');
      // A second check (the first dropped) uses the same account: one account a host.
      await repo.updateHost(host.id, { identityState: 'none', identitySessionId: null });
      await srv.send('POST', '/api/host/lanes/verify', { offerId: free.id, consent: true });
      assert.equal(made().length, before + 1);
      // A check already open is carried on only with the yes too.
      await repo.updateHost(host.id, { identityState: 'pending', identitySessionId: 'vs_test_1' });
      assert.equal((await srv.send('POST', '/api/host/lanes/verify', { offerId: free.id })).body.error, 'consent_required');
    });
    // Each yes to the face match is logged with its date.
    const { rows: consents } = await query(`select after from hosting_changes where subject_kind = 'host' and subject_id = $1 and field = 'identity_consent'`, [host.id]);
    assert.equal(consents.length, 2, 'two yeses, and none logged for the refused resume');
    assert.equal(consents[0].after.biometric, true);
    assert.ok(Date.parse(consents[0].after.at));
  } finally { await srv.close(); }
});

test('the dormant account wakes when its host first takes money: card payments asked for, then Stripe’s form', async () => {
  const stripe = await import('../src/sources/stripe.js');
  assert.equal(stripe.accountAwake({ capabilities: {} }), false);
  assert.equal(stripe.accountAwake({ capabilities: { card_payments: 'inactive', transfers: 'inactive' } }), true);
  assert.deepEqual(stripe.connectAccountBody({ hostId: 'h', dormant: true }).configuration.merchant, { statement_descriptor: { prefix: 'EPIC' } });
  const { household: h, member } = await aHousehold(query);
  const srv = await server(await readyHost(h, member));
  try {
    const host = await repo.hostByHousehold(h.id);
    await repo.updateHost(host.id, { stripeAccountId: 'acct_test_1', stripeAccountModel: 'v2', stripePersonId: 'person_test_1' });
    // The fake reads card_payments as asked for already; make this read dormant so the wake is exercised.
    const wakes = () => calls.filter((c) => c.url === '/v2/core/accounts/acct_test_1' && c.method === 'POST' && /card_payments/.test(c.body ?? ''));
    const before = wakes().length;
    dormantRead = true;
    try {
      await withStripe('sk_test_fake', async () => {
        const r = await srv.send('POST', '/api/host/lanes/payouts', { offerId: null });
        assert.equal(r.body.url, 'https://connect.stripe.test/onboard');
      });
    } finally { dormantRead = false; }
    assert.equal(wakes().length, before + 1, 'woken once, before the form');
    const body = JSON.parse(wakes().at(-1).body);
    assert.deepEqual(body.configuration.merchant.capabilities, { card_payments: { requested: true } });
    assert.match(body.defaults.profile.business_url, /\/hosts\//);
    const wakeAt = calls.findLastIndex((c) => c.url === '/v2/core/accounts/acct_test_1');
    const linkAt = calls.findLastIndex((c) => c.url === '/v1/account_links');
    assert.ok(wakeAt < linkAt, 'woken before Stripe’s form opens');
    // An account made before transfers were known to be needed — awake, Stripe's form already opened — is upgraded too.
    await repo.updateHost(host.id, { stripeLinkMadeAt: new Date() });
    const asked = () => calls.filter((c) => c.url === '/v2/core/accounts/acct_test_1' && c.method === 'POST' && /stripe_transfers/.test(c.body ?? '') && !/card_payments/.test(c.body ?? '')).length;
    const n = asked();
    await withStripe('sk_test_fake', async () => { await srv.send('POST', '/api/host/lanes/payouts', { offerId: null }); });
    assert.equal(asked(), n + 1, 'transfers asked for on its own, every time');
  } finally { await srv.close(); }
});

test('L7: what counts as Stripe asking for ID — a document, proof of liveness, or a risk review’s identity check', async () => {
  const stripe = await import('../src/sources/stripe.js');
  assert.deepEqual(stripe.asksForIdAgain({ requirements: { currently_due: ['external_account', 'individual.verification.document'], eventually_due: ['individual.verification.document'] } }), ['individual.verification.document']);
  assert.deepEqual(stripe.asksForIdAgain({ requirements: { currently_due: ['external_account', 'individual.address.city'] } }), []);
  assert.deepEqual(stripe.storedIdAsks({ currentlyDue: ['person_1.proof_of_liveness'], eventuallyDue: ['interv_1.identity_verification.challenge'] }), ['person_1.proof_of_liveness', 'interv_1.identity_verification.challenge']);
  assert.deepEqual(stripe.storedIdAsks(null), []);
});

test('L7: the host’s public page shows the day Stripe confirmed their passport, and nothing else of the check', async () => {
  const { household: h } = await aHousehold(query);
  const host = await repo.insertHost(h.id, { name: 'Dated Fact' });
  const hosting = await import('../src/routes/hosting.js');
  const app = express(); app.use(express.json()); app.use('/api', hosting.publicRouter);
  const s = app.listen(0, '127.0.0.1'); await new Promise((r) => s.once('listening', r));
  const get = async () => (await fetch(`http://127.0.0.1:${s.address().port}/api/hosts/${host.id}`)).json();
  try {
    assert.equal((await get()).host?.verifiedOn ?? (await get()).verifiedOn ?? null, null, 'not verified: no date');
    await repo.updateHost(host.id, { identityState: 'verified', identityVerifiedAt: new Date('2026-09-20T09:00:00Z'), identitySessionId: 'vs_secret_1' });
    const page = await get();
    const shown = page.host ?? page;
    assert.equal(shown.verifiedOn, '2026-09-20');
    assert.ok(!JSON.stringify(page).includes('vs_secret_1'), 'never the session id');
  } finally { await new Promise((r) => s.close(r)); }
});

test('L15: Stripe disabling or closing a host’s account is written down when it starts and when it ends — from the account as it is now', async () => {
  const { household: h } = await aHousehold(query);
  const host = await repo.insertHost(h.id, { name: 'Troubled' });
  await repo.updateHost(host.id, { stripeAccountId: 'acct_trouble_1', stripeAccountModel: 'v2' });
  const { applyStripeEvent } = await import('../src/routes/hostLanes.js');
  const acct = (extra) => ({ id: 'acct_trouble_1', details_submitted: true, charges_enabled: true, payouts_enabled: true, settings: { payouts: { schedule: { interval: 'manual' } } }, capabilities: { card_payments: 'active', transfers: 'active' }, requirements: { currently_due: [], eventually_due: [], past_due: [], disabled_reason: null }, ...extra });
  const review = acct({ charges_enabled: false, capabilities: { card_payments: 'inactive', transfers: 'active' }, requirements: { currently_due: [], eventually_due: [], past_due: [], disabled_reason: 'under_review' } });
  const log = async () => (await query(`select after from hosting_changes where subject_kind = 'host' and subject_id = $1 and field = 'stripe_account_trouble' order by at`, [host.id])).rows.map((r) => r.after);
  // Each event is applied from Stripe's account as it is now (what the fake reads back), not the event's snapshot.
  const deliver = async (now, snapshot = now) => { accountRead = now; try { await withStripe('sk_test_fake', () => applyStripeEvent({ type: 'account.updated', data: { object: snapshot } })); } finally { accountRead = null; } };
  await deliver(acct());
  assert.deepEqual(await log(), [], 'well: nothing written');
  await deliver(review);
  await deliver(review);
  assert.deepEqual((await log()).map((x) => x.reason ?? 'cleared'), ['under_review'], 'once, however often Stripe repeats it');
  await deliver(acct());
  assert.equal((await log()).at(-1).cleared, true, 'and when Stripe says it is well again');
  // An old "under review" event arriving after the recovery: the account read back is well, so nothing changes.
  await deliver(acct(), review);
  assert.equal((await log()).length, 2, 'a late, stale event adds nothing');
  // Closed or disconnected: its own event on the Connect endpoint.
  await applyStripeEvent({ type: 'account.application.deauthorized', account: 'acct_trouble_1', data: { object: { id: 'ca_x' } } });
  assert.equal((await log()).at(-1).reason, 'account_closed');
  const after = await repo.hostById(host.id);
  assert.deepEqual([after.stripe_charges_enabled, after.stripe_payouts_enabled], [false, false]);
});
