/**
 * The Host tab's Money screen: the server pieces behind SX9/SX14/SX16–SX20
 * (Settings revised v2, Lane 3). Migrations 321–323 added the host's pay
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
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  return { url: `http://127.0.0.1:${s.address().port}`, close: () => new Promise((r) => s.close(r)) };
}

test('GET /api/host/money returns the Money screen (intro state defined — not a 500)', async () => {
  const { household } = await aHousehold(query, 'the money route');
  const host = await repo.insertHost(household.id, { name: 'Roger', type: 'skill' });
  const offer = await repo.insertOffer(host.id, 'oneoff');
  await repo.insertBooking({ offerId: offer.id, hostId: host.id, householdId: household.id, occurrence: '2026-12-01', party: [], heads: 1, state: 'confirmed', amountPence: 10000, viaHostLink: true }, null);
  // A waitlisted request holds no place and earns nothing: it must not appear
  // in the money totals nor burn one of the first-ten intro positions (Codex).
  await repo.insertBooking({ offerId: offer.id, hostId: host.id, householdId: household.id, occurrence: '2026-12-03', party: [], heads: 1, state: 'waitlisted', amountPence: 77700 }, null);
  const srv = await hostServer(household);
  try {
    const r = await fetch(`${srv.url}/api/host/money`);
    assert.equal(r.status, 200, 'the Money screen must not 500 — the regression Codex caught');
    const body = await r.json();
    assert.equal(typeof body.intro?.active, 'boolean', 'host-wide intro state present');
    assert.equal(typeof body.trusted?.completed, 'number', 'completed count present');
    assert.ok(Array.isArray(body.totals?.lines) && Array.isArray(body.ladder) && body.ladder.length === 3);
    // A brand-new host's first booking is inside the 0% intro, which beats even
    // the 5% link rate — so the line is 0%, proving per-booking intro resolution.
    assert.ok(body.totals.lines.some((l) => l.rate === 0), 'the new host\'s booking is charged the 0% intro, not the level or link rate');
    assert.equal(body.totals.grossPence, 10000, 'the waitlisted £777 request is not revenue');
    assert.equal(body.trusted.completed, 1, 'nor a completed experience');
  } finally { await srv.close(); }
});
