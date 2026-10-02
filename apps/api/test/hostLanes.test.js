/**
 * Four ways to host — the routes (routes/hostLanes.js, migration 358).
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
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    calls.push({ method: req.method, url: req.url, body, idem: req.headers['idempotency-key'] ?? null });
    const json = (o, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/bank.json') return json({ 'england-and-wales': { events: [{ date: '2026-12-25', title: 'Christmas Day' }, { date: '2026-12-28', title: 'Boxing Day' }, { date: '2027-01-01', title: 'New Year’s Day' }] } });
    if (req.url.startsWith('/openai/responses')) return json({ model: 'gpt-5-mini', usage: { input_tokens: 400, output_tokens: 120 }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(modelAnswer) }] }] });
    if (req.url === '/v1/accounts' && req.method === 'POST') return json({ id: 'acct_test_1' });
    if (req.url.startsWith('/v1/accounts/')) return json({ id: 'acct_test_1', details_submitted: true, payouts_enabled: true });
    if (req.url === '/v1/account_links') return json({ url: 'https://connect.stripe.test/onboard' });
    if (req.url === '/v1/identity/verification_sessions' && req.method === 'POST') return json({ id: 'vs_test_1', url: 'https://verify.stripe.test/start' });
    if (req.url.startsWith('/v1/identity/verification_sessions/')) return json({ id: 'vs_test_1', status: 'verified' });
    if (req.url === '/v1/checkout/sessions' && req.method === 'POST') return json({ id: 'cs_test_1', url: 'https://checkout.stripe.test/pay' });
    if (req.url.endsWith('/expire')) return json({ id: 'cs_test_1', status: 'expired' });
    if (req.url.startsWith('/v1/checkout/sessions/')) return json(checkoutStatus === 'paid' ? { id: 'cs_test_1', mode: 'payment', status: 'complete', payment_status: 'paid', metadata: { epic_kind: 'event' } } : { id: 'cs_test_1', mode: 'payment', status: 'open', payment_status: 'unpaid', url: 'https://checkout.stripe.test/pay', metadata: { epic_kind: 'event' } });
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
    assert.equal((await p({ multiDay: true, startsOn: '2026-06-13', endsOn: '2026-06-12' })).body.error, 'ends_before_start');
    assert.equal((await p({ multiDay: true, startsOn: '2026-06-13', endsOn: '2026-06-20' })).body.error, 'too_many_days', 'a one-off runs over at most four days');
    let r = await p({ startsOn: '2026-06-13', startsAt: '13:00', endsAt: '23:00', draftStep: 'when' });
    assert.equal(r.status, 200);
    assert.equal(r.body.offer.startsAt, '13:00');
    assert.equal(r.body.offer.draftStep, 'when');
    assert.ok(!r.body.offer.missing.includes('when'));

    r = await p({ priceMode: 'same_each', pricePence: 3500, childPence: 2000, minCount: 5, maxCount: 10, refundPolicy: 'moderate' });
    assert.equal(r.body.offer.money, 'epic', 'paid defaults to Epic collecting');
    assert.equal(r.body.offer.refundWords, 'Full refund up to 5 days before');
    assert.equal(r.body.offer.decidesOnDefault, '2026-06-06', 'a week before the first session');
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
    r = await srv.send('POST', '/api/host/lanes/tax', { reference: 'AB 12 34 56 C' });
    assert.equal(r.body.host.tax, '••••56C', 'shown back only masked');
    assert.equal((await srv.send('POST', '/api/host/lanes/checked', { dbsNumber: '123', referees: [] })).body.error, 'bad_dbs');
    assert.equal((await srv.send('POST', '/api/host/lanes/checked', { dbsNumber: '001234567890', referees: [{ name: 'A', email: 'a@x.com' }] })).body.error, 'insurance_required');
  } finally { await srv.close(); }
});

/** A host with everything a private checklist asks for, but the fee. */
async function readyHost(h, member, { mobile = `077${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` } = {}) {
  const account = await anAccount(h, member, { mobile });
  const { rows: [m] } = await query("insert into host_media (household_id, kind, mime, bytes, size) values ($1, 'photo', 'image/jpeg', '\\x00', 1) returning id", [h.id]);
  const host = await repo.insertHost(h.id, { name: 'Maya Okafor', dateOfBirth: '1986-03-02', accountId: account.id });
  await repo.updateHost(host.id, { photoId: m.id });
  return account;
}

async function filledOneoff(srv, extra = {}) {
  const { body: { offer } } = await srv.send('POST', '/api/host/lanes/offers', { lane: 'oneoff', whatLabel: 'Birthday party', title: 'Maya’s 40th' });
  const r = await srv.send('PATCH', `/api/host/lanes/offers/${offer.id}`, {
    startsOn: '2026-06-13', startsAt: '13:00', endsAt: '23:00', venue: 'your_place', venueLabel: 'The Old Rectory, Henley', priceMode: 'free', maxCount: 60, visibility: 'invite', ...extra,
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
  const srv = await server(await readyHost(h, member));
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
      r = await srv.send('POST', '/api/host/lanes/verify', { offerId: o.id });
      assert.equal(r.body.url, 'https://verify.stripe.test/start');
      r = await srv.send('POST', '/api/host/lanes/payouts', { offerId: o.id });
      assert.equal(r.body.url, 'https://connect.stripe.test/onboard');
      assert.match(calls.filter((c) => c.url === '/v1/account_links').at(-1).body, /return_url=https%3A%2F%2Fapp\.epic\.test%2Fhost%2Foffers%2F/, 'they come back to the checklist');
      r = await srv.send('POST', `/api/host/lanes/offers/${o.id}/sync`);
      assert.equal(r.body.offer.checklist.find((i) => i.key === 'verified').done, true);
      assert.equal(r.body.offer.checklist.find((i) => i.key === 'payouts').done, true);
    });
    const { rows: [v] } = await query("insert into host_media (household_id, kind, mime, bytes, size, duration_s) values ($1, 'video', 'video/webm', '\\x00', 1, 48) returning id", [h.id]);
    r = await srv.send('POST', `/api/host/lanes/offers/${o.id}/video`, { videoId: v.id, madeBy: 'self', coverS: 3, onProfile: true });
    assert.equal(r.body.offer.video.seconds, 48, 'the length shown is the take’s own');
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
  try {
    const host = await repo.insertHost(h.id, { name: 'Hooked' });
    await repo.updateHost(host.id, { stripeAccountId: `acct_${host.id.slice(0, 8)}`, payoutsState: 'pending' });
    const event = (livemode) => JSON.stringify({ type: 'account.updated', livemode, data: { object: { id: `acct_${host.id.slice(0, 8)}`, details_submitted: true, payouts_enabled: true } } });
    const sign = (body, secret = 'whsec_test') => { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`; };
    let body = event(false);
    assert.equal((await srv.raw('/api/stripe/webhook', body, { 'content-type': 'application/json', 'stripe-signature': sign(body, 'whsec_wrong') })).status, 400);
    body = event(true);
    assert.equal((await srv.raw('/api/stripe/webhook', body, { 'content-type': 'application/json', 'stripe-signature': sign(body) })).body.ignored, 'live');
    assert.equal((await repo.hostById(host.id)).payouts_state, 'pending');
    body = event(false);
    assert.equal((await srv.raw('/api/stripe/webhook', body, { 'content-type': 'application/json', 'stripe-signature': sign(body) })).status, 200);
    assert.equal((await repo.hostById(host.id)).payouts_state, 'ready');
  } finally { await srv.close(); }
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
