/**
 * The Host tab's Money screen: the server pieces behind SX9/SX14/SX16–SX20
 * (Settings revised v2, Lane 3). Migrations 345–347 added the host's pay
 * schedule, company tax fields and the banks it is paid into, and a booking's
 * own-link flag. The rules worth pinning:
 *
 *   · the pay schedule and the company tax fields round-trip through updateHost,
 *     and the host's own payload (ownHost) carries them back;
 *   · one bank is the payout account at a time — activating a second stands the
 *     first down, kept honest by the partial unique index;
 *   · a payout account's payload shows only a label and the last four digits,
 *     never an account number;
 *   · the fee shown over a period comes from the engine, and a host-link booking
 *     is charged 5% against the level rate on an Epic-brought one.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { aHousehold, testDatabase } from './helpers/db.js';

const { query } = await testDatabase();
const repo = await import('../src/repositories/hosting.js');
const { ownHost, payoutAccountPayload } = await import('../src/routes/hosting.js');
const { feesForPeriod, LEVEL_RATE, LINK_RATE } = await import('../src/domain/hostFees.js');
const { outstandingFrom } = await import('../src/domain/hosting.js');

const addAccount = (hostId, label, last4, active = false) =>
  query('insert into host_payout_accounts (host_id, label, last4, holder_name, is_active) values ($1,$2,$3,$4,$5) returning *',
    [hostId, label, last4, 'R Sumner', active]).then((r) => r.rows[0]);

test('the pay schedule and company tax fields round-trip, and ownHost carries them', async () => {
  const { household } = await aHousehold(query, 'a host who gets paid');
  const host = await repo.insertHost(household.id, { name: 'Roger', type: 'skill' });
  // Defaults the migration set.
  assert.equal(ownHost(host).paySchedule, 'weekly');
  assert.equal(ownHost(host).taxIsCompany, false);
  assert.equal(ownHost(host).companyNumber, null);

  const updated = await repo.updateHost(host.id, { paySchedule: 'monthly', taxIsCompany: true, companyNumber: '12345678' });
  assert.equal(updated.pay_schedule, 'monthly');
  assert.equal(updated.tax_is_company, true);
  assert.equal(updated.company_number, '12345678');
  const payload = ownHost(updated);
  assert.equal(payload.paySchedule, 'monthly');
  assert.equal(payload.taxIsCompany, true);
  assert.equal(payload.companyNumber, '12345678');

  // The schedule is constrained to the three the screen offers.
  await assert.rejects(repo.updateHost(host.id, { paySchedule: 'fortnightly' }), /pay_schedule/i, 'only weekly/weekday/monthly');
});

test('one bank is the payout account at a time', async () => {
  const { household } = await aHousehold(query, 'a host with two banks');
  const host = await repo.insertHost(household.id, { name: 'Pay Me', type: 'skill' });
  const monzo = await addAccount(host.id, 'Monzo', '42', true);
  const starling = await addAccount(host.id, 'Starling', '07', false);

  let accounts = await repo.payoutAccountsOf(host.id);
  assert.equal(accounts.filter((a) => a.is_active).length, 1);
  assert.equal(accounts.find((a) => a.is_active).id, monzo.id);

  const active = await repo.setActivePayoutAccount(host.id, starling.id);
  assert.equal(active.id, starling.id);
  accounts = await repo.payoutAccountsOf(host.id);
  assert.equal(accounts.filter((a) => a.is_active).length, 1, 'still only one is active');
  assert.equal(accounts.find((a) => a.is_active).id, starling.id, 'the second one now, the first stood down');

  // A bank that is not this host's cannot be made the payout account.
  const other = await aHousehold(query, 'someone else');
  const otherHost = await repo.insertHost(other.household.id, { name: 'Not you', type: 'skill' });
  const theirs = await addAccount(otherHost.id, 'Lloyds', '99', true);
  assert.equal(await repo.setActivePayoutAccount(host.id, theirs.id), null, 'not one of yours');
  // And a rejected activation must not have stood the real one down (Codex).
  accounts = await repo.payoutAccountsOf(host.id);
  assert.equal(accounts.filter((a) => a.is_active).length, 1, 'a failed activation leaves exactly one active');
  assert.equal(accounts.find((a) => a.is_active).id, starling.id, 'the host still has their payout account');
});

test("a booking remembers it came through the host's own link (the 5% fee); otherwise false", async () => {
  const { household } = await aHousehold(query, 'a host with a link');
  const host = await repo.insertHost(household.id, { name: 'Linked', type: 'skill' });
  const offer = await repo.insertOffer(host.id, 'oneoff');
  const viaLink = await repo.insertBooking({ offerId: offer.id, hostId: host.id, householdId: household.id, occurrence: '2026-12-01', party: [], heads: 1, state: 'confirmed', amountPence: 10000, viaHostLink: true }, null);
  assert.equal(viaLink.via_host_link, true);
  const epicSurface = await repo.insertBooking({ offerId: offer.id, hostId: host.id, householdId: household.id, occurrence: '2026-12-02', party: [], heads: 1, state: 'confirmed', amountPence: 10000 }, null);
  assert.equal(epicSurface.via_host_link, false, 'an Epic-surface booking is not a host-link booking');
});

test('a payout account payload shows only a label and the last four digits', async () => {
  const { household } = await aHousehold(query, 'a host with a bank');
  const host = await repo.insertHost(household.id, { name: 'Shown', type: 'skill' });
  const acct = await addAccount(host.id, 'Monzo', '42', true);
  const p = payoutAccountPayload(acct);
  assert.deepEqual(Object.keys(p).sort(), ['addedOn', 'holderName', 'id', 'isActive', 'label', 'last4'].sort());
  assert.equal(p.label, 'Monzo');
  assert.equal(p.last4, '42');
  assert.equal(p.isActive, true);
  assert.ok(!('account_number' in p) && !('sortCode' in p), 'no account number ever leaves the server');
});

test('the period fee comes from the engine: 5% on a host-link booking, the level rate otherwise', () => {
  const level = 'checked';
  const period = feesForPeriod([
    { amountPence: 10000, level, viaHostLink: false, intro: null },
    { amountPence: 10000, level, viaHostLink: true, intro: null },
  ]);
  // Two rates, two lines: the Checked level rate and the own-link rate.
  const rates = period.lines.map((l) => l.rate).sort((a, b) => a - b);
  assert.deepEqual(rates, [LINK_RATE, LEVEL_RATE[level]]);
  // Fee = 15% of £100 + 5% of £100 = £15 + £5 = £20 on £200 gross.
  assert.equal(period.grossPence, 20000);
  assert.equal(period.feePence, 2000);
  assert.equal(period.netPence, 18000);
});

import express from 'express';
const { default: hostingRouter } = await import('../src/routes/hosting.js');
const { runAsAccount } = await import('../src/context.js');

async function hostServer(household, account) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { id: null, account_id: account?.id ?? null }; runAsAccount(account ?? { id: null, household_id: household.id, member_id: null, role: 'owner', status: 'active' }, next); });
  app.use('/api', hostingRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: err.code ?? 'x', message: err.message }));
  const s = app.listen(0, '127.0.0.1');
  await new Promise((r) => s.once('listening', r));
  return { url: `http://127.0.0.1:${s.address().port}`, close: () => new Promise((r) => s.close(r)) };
}

test('GET /api/host/money returns the Money screen (intro state defined — not a 500)', async () => {
  const { household } = await aHousehold(query, 'the money route');
  const host = await repo.insertHost(household.id, { name: 'Roger', type: 'skill' });
  // A one-off is dated by its offer: December's is still to come, June's has run.
  const offer = await repo.insertOffer(host.id, 'oneoff', { startsOn: '2026-12-01' });
  const ran = await repo.insertOffer(host.id, 'oneoff', { startsOn: '2025-06-01' });
  await repo.insertBooking({ offerId: offer.id, hostId: host.id, householdId: household.id, occurrence: '2026-12-01', party: [], heads: 1, state: 'confirmed', amountPence: 10000, viaHostLink: true }, null);
  // A waitlisted request holds no place and earns nothing: it must not appear
  // in the money totals nor burn one of the first-ten intro positions (Codex).
  await repo.insertBooking({ offerId: offer.id, hostId: host.id, householdId: household.id, occurrence: '2026-12-03', party: [], heads: 1, state: 'waitlisted', amountPence: 77700 }, null);
  // One date already run: the only thing the Trusted ladder may count, and the
  // only money the Past tab's per-offer block may show (Codex, 1 Oct 2026).
  await repo.insertBooking({ offerId: ran.id, hostId: host.id, householdId: household.id, occurrence: '2025-06-01', party: [], heads: 2, state: 'attended', amountPence: 5000 }, null);
  const srv = await hostServer(household);
  try {
    const r = await fetch(`${srv.url}/api/host/money`);
    assert.equal(r.status, 200, 'the Money screen must not 500 — the regression Codex caught');
    const body = await r.json();
    assert.equal(typeof body.intro?.active, 'boolean', 'host-wide intro state present');
    assert.ok(Array.isArray(body.totals?.lines) && Array.isArray(body.ladder) && body.ladder.length === 3);
    // A brand-new host's first booking is inside the 0% intro, which beats even
    // the 5% link rate — so the line is 0%, proving per-booking intro resolution.
    assert.ok(body.totals.lines.some((l) => l.rate === 0), 'the new host\'s booking is charged the 0% intro, not the level or link rate');
    assert.equal(body.totals.grossPence, 15000, 'the waitlisted £777 request is not revenue');
    // The confirmed December date is still to come: a booking made is not an
    // experience run, so the ladder counts only the June date.
    assert.equal(body.trusted.completed, 1, 'only the past date counts toward Epic Trusted');
    assert.equal(body.byOffer[offer.id].grossPence, 0, "the December offer's Past money is nothing yet");
    assert.equal(body.byOffer[ran.id].grossPence, 5000, "the Past tab's per-offer money is past dates only");
  } finally { await srv.close(); }
});

test('a waitlisted request never blocks leaving: outstanding counts held places only', async () => {
  const offer = { id: 'o1', shape: 'oneoff' };
  const future = '2099-01-01';
  const waitlistedOnly = outstandingFrom([offer], [{ offer_id: 'o1', state: 'waitlisted', occurrence: future, heads: 3 }]);
  assert.equal(waitlistedOnly.blocked, false, 'a waitlist holds no place');
  assert.equal(waitlistedOnly.guests, 0);
  const held = outstandingFrom([offer], [
    { offer_id: 'o1', state: 'confirmed', occurrence: future, heads: 2 },
    { offer_id: 'o1', state: 'waitlisted', occurrence: future, heads: 3 },
  ]);
  assert.equal(held.blocked, true, 'a confirmed place still blocks');
  assert.equal(held.guests, 2, 'and only the held places are the guests to tell');
});

test('cancelling an early booking never slides a later one into the 0% intro', async () => {
  const { household } = await aHousehold(query, 'the fixed ten');
  const host = await repo.insertHost(household.id, { name: 'Ivo', type: 'skill' });
  const offer = await repo.insertOffer(host.id, 'oneoff', { startsOn: '2099-03-01' });
  const made = [];
  for (let i = 0; i < 11; i += 1) {
    made.push(await repo.insertBooking({ offerId: offer.id, hostId: host.id, householdId: household.id, occurrence: '2099-03-01', party: [], heads: 1, state: 'confirmed', amountPence: 10000 }, null));
  }
  assert.deepEqual(made.map((b) => b.intro_ordinal), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 'each booking is stamped its place in turn as it is made');
  const srv = await hostServer(household);
  const money = async () => (await fetch(`${srv.url}/api/host/money`)).json();
  try {
    const before = await money();
    const paidBefore = before.totals.lines.find((l) => l.rate > 0);
    assert.equal(paidBefore?.count, 1, 'the eleventh pays the level rate');
    // The second booking is called off. It used a place in the ten; the
    // eleventh stays outside it, and the intro does not reopen.
    await repo.updateBooking(made[1].id, { state: 'cancelled', cancelledAt: new Date(), cancelledBy: 'guest' });
    const after = await money();
    const paidAfter = after.totals.lines.find((l) => l.rate > 0);
    assert.equal(paidAfter?.count, 1, 'the eleventh is still charged — never re-priced at 0%');
    assert.equal(after.intro.bookingsLeft, 0, 'the ten are spent; a cancellation does not give one back');
  } finally { await srv.close(); }
  assert.equal(await repo.confirmedBookingsSoFar(host.id), 11, 'the host-wide count reads the stamps, cancelled one included');
});

test("a host moving up a level never re-prices what they already earned", async () => {
  const { household } = await aHousehold(query, 'the frozen level');
  const host = await repo.insertHost(household.id, { name: 'Lia', type: 'skill' });
  // Past the intro, so the level rate is what applies.
  await query("update hosts set created_at = now() - interval '200 days', trust = 'verified' where id = $1", [host.id]);
  const offer = await repo.insertOffer(host.id, 'oneoff', { startsOn: '2099-04-01' });
  const before = await repo.insertBooking({ offerId: offer.id, hostId: host.id, householdId: household.id, occurrence: '2099-04-01', party: [], heads: 1, state: 'confirmed', amountPence: 10000 }, null);
  assert.equal(before.fee_level, 'verified', 'the level is stamped when the booking first holds a place');
  await query("update hosts set trust = 'trusted' where id = $1", [host.id]);
  await repo.insertBooking({ offerId: offer.id, hostId: host.id, householdId: household.id, occurrence: '2099-04-01', party: [], heads: 1, state: 'confirmed', amountPence: 10000 }, null);
  const srv = await hostServer(household);
  try {
    const body = await (await fetch(`${srv.url}/api/host/money`)).json();
    const rates = body.totals.lines.map((l) => [l.rate, l.count]).sort((a, b) => a[0] - b[0]);
    assert.deepEqual(rates, [[LEVEL_RATE.trusted, 1], [LEVEL_RATE.verified, 1]],
      'the earlier booking keeps the Verified rate; only the later one has the Trusted rate');
  } finally { await srv.close(); }
});

test("migration 347's back-fill counts a paid-then-cancelled booking, so nobody after it slides into the 0%", async () => {
  const { readFileSync } = await import('node:fs');
  const sql = readFileSync(new URL('../migrations/347_a_booking_through_the_hosts_own_link.sql', import.meta.url), 'utf8');
  const backfill = sql.slice(sql.lastIndexOf('update experience_bookings b set intro_ordinal'));
  const { household } = await aHousehold(query, 'the back-fill');
  const host = await repo.insertHost(household.id, { name: 'Bo', type: 'skill' });
  const offer = await repo.insertOffer(host.id, 'oneoff', { startsOn: '2099-02-01' });
  const add = (state) => repo.insertBooking({ offerId: offer.id, hostId: host.id, householdId: household.id, occurrence: '2099-02-01', party: [], heads: 1, state, amountPence: 1000 }, null);
  const first = await add('confirmed');
  const refunded = await add('confirmed');
  const neverHeld = await add('pending');
  const last = await add('confirmed');
  await query("update experience_bookings set state = 'cancelled', payment_status = 'refunded', refunded_at = now() where id = $1", [refunded.id]);
  await query("update experience_bookings set state = 'cancelled' where id = $1", [neverHeld.id]);
  // As if these rows predated the column: wipe the stamps, then run the
  // migration's own back-fill statement over them.
  await query('update experience_bookings set intro_ordinal = null, fee_level = null where host_id = $1', [host.id]);
  await query(backfill);
  const { rows } = await query('select id, intro_ordinal, fee_level from experience_bookings where host_id = $1', [host.id]);
  const by = new Map(rows.map((r) => [r.id, r]));
  assert.equal(by.get(first.id).intro_ordinal, 1);
  assert.equal(by.get(refunded.id).intro_ordinal, 2, 'a refunded cancellation did hold a place, and keeps it');
  assert.equal(by.get(neverHeld.id).intro_ordinal, null, 'a cancellation with no evidence of a place is not guessed at');
  assert.equal(by.get(last.id).intro_ordinal, 3, 'so the last is third, never renumbered down');
  assert.equal(by.get(last.id).fee_level, 'verified', "and carries the host's level");
});

test("the publish estimate prices each booking, so the £1.50 minimum applies per booking", async () => {
  const host = { trust: 'verified', created_at: new Date(Date.now() - 200 * 86400000) };
  const o = { id: 'x', price_mode: 'same_each', per: 'person', price_pence: 50, expected_count: 10, min_count: null, total_pence: null };
  const { publishFeeEstimate } = await import('../src/routes/hosting.js');
  const fee = publishFeeEstimate(o, host, 10);
  assert.equal(fee.grossPence, 500);
  assert.equal(fee.feePence, 500, 'ten 50p bookings, each held to the minimum (capped at its price): £5, not one £1.50');
  // A new host's remaining intro places are used one booking at a time.
  const fresh = publishFeeEstimate({ ...o, price_pence: 2000 }, { trust: 'verified', created_at: new Date() }, 7);
  const byRate = {};
  for (const l of fresh.lines) byRate[l.rate] = (byRate[l.rate] ?? 0) + l.count;
  assert.deepEqual(byRate, { 0: 3, 20: 7 }, 'three intro places left at 0%, the other seven at the level rate');
});

test('company reporting is never on without a Companies House number', async () => {
  const { household } = await aHousehold(query, 'the company host');
  await repo.insertHost(household.id, { name: 'Co', type: 'skill' });
  const srv = await hostServer(household);
  const patch = (body) => fetch(`${srv.url}/api/host`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await patch({ taxIsCompany: true })).status, 400, 'the switch alone, with no number, is refused');
    assert.equal((await patch({ taxIsCompany: true, companyNumber: '12345' })).status, 400, 'not a company number');
    assert.equal((await patch({ taxIsCompany: true, companyNumber: 'sc 123456' })).status, 200, 'two letters and six digits, spacing forgiven');
    const { rows: [h] } = await query('select tax_is_company, company_number from hosts where household_id = $1', [household.id]);
    assert.deepEqual([h.tax_is_company, h.company_number], [true, 'SC123456']);
  } finally { await srv.close(); }
});
