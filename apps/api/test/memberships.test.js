/**
 * Members, not accounts — the one classification every report reads.
 *
 * The owner, 3 Oct 2026: "Count memberships, not accounts." A member is a
 * household with a paid or trialling membership in Stripe; nothing else makes
 * one. These pin each household class against real rows, and the money that
 * follows from them: with no membership billed yet, MRR is nought and the
 * average price is null rather than a nought nobody paid.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const memberships = await import('../src/repositories/memberships.js');
const pricing = await import('../src/repositories/pricing.js');
const insights = await import('../src/repositories/insights.js');

test.after(() => pool.end());

let n = 0;
/** A household with a lead account on `plan`, in `status`, arrived by `origin`. */
async function household({ origin = 'signup', plan = 'household', status = 'active', lead = true } = {}) {
  n += 1;
  const { rows: [h] } = await query(
    'insert into households (name, origin) values ($1, $2) returning id', [`Test ${n}`, origin]);
  if (lead) {
    await query(
      `insert into accounts (household_id, email, name, status, plan) values ($1, $2, $3, $4, $5)`,
      [h.id, `lead-${n}-${Date.now()}@member.test`, `Lead ${n}`, status, plan]);
  }
  return h.id;
}

const classOf = async (id) => (await memberships.classifyHousehold(id))?.cls ?? null;

test('the Founding household is complimentary, whatever its plan says', async () => {
  const id = await household({ origin: 'founding', plan: 'household' });
  assert.equal(await classOf(id), 'complimentary');
});

test('a lead account on Friend is complimentary', async () => {
  assert.equal(await classOf(await household({ plan: 'friend' })), 'complimentary');
  assert.equal(await classOf(await household({ plan: 'owner' })), 'complimentary');
});

test('trial and standard are not given by hand, so they are not complimentary', async () => {
  assert.equal(await classOf(await household({ plan: 'trial' })), 'none');
  assert.equal(await classOf(await household({ plan: 'standard' })), 'none');
});

test('a lead on Household who has not signed in is invited', async () => {
  assert.equal(await classOf(await household({ plan: 'household', status: 'invited' })), 'invited');
});

test('a lead on Household, active, with no Stripe record, is not a member', async () => {
  const id = await household({ plan: 'household', status: 'active' });
  const c = await memberships.classifyHousehold(id);
  assert.equal(c.cls, 'none');
  assert.equal(c.word, 'Not a member');
  assert.equal(c.monthlyPence, 0, 'a plan an administrator picked is not money');
});

test('a guest-invite household is never classified', async () => {
  const id = await household({ origin: 'guest_invite', plan: 'household' });
  assert.equal(await memberships.classifyHousehold(id), null);
  const all = await memberships.classifyHouseholds();
  assert.ok(!all.some((h) => h.householdId === id), 'not in the estate list either');
});

test('a member’s own account never adds a household', async () => {
  const id = await household({ plan: 'friend' });
  const before = memberships.summarise(await memberships.classifyHouseholds());
  const { rows: [m] } = await query("insert into members (household_id, name) values ($1, 'A daughter') returning id", [id]);
  await query(
    `insert into accounts (household_id, member_id, email, name, status, plan)
     values ($1, $2, $3, 'A daughter', 'active', 'friend')`,
    [id, m.id, `daughter-${Date.now()}@member.test`]);
  const after = memberships.summarise(await memberships.classifyHouseholds());
  assert.equal(after.households, before.households, 'one household, however many logins');
  assert.equal(after.complimentary, before.complimentary);
});

test('with no paid members, MRR is nought and the average is null', async () => {
  await household({ plan: 'household', status: 'active' });
  await household({ plan: 'solo', status: 'active' });
  const m = await memberships.readMemberships();
  // Billed through Stripe since 3 Oct 2026: nought members is a measurement, not "not billed yet".
  assert.equal(memberships.MEMBERSHIP_BILLING, true);
  assert.equal(m.billed, true);
  assert.equal(m.billedNote, null);
  assert.equal(m.members, 0);
  assert.equal(m.paid, 0);
  assert.equal(m.trialling, 0);
  assert.equal(m.mrrPence, 0);
  assert.equal(m.averagePence, null, 'an average of nobody is not a price');
  assert.equal(m.peopleCovered, 0, 'nobody is covered by a membership nobody has');

  const standing = await pricing.readStanding();
  assert.equal(standing.mrrPence, 0);
  assert.equal(standing.averagePaidPence, null);
  assert.equal(standing.billed, true);
  for (const t of await pricing.readTiers()) assert.equal(t.members, 0, t.key);

  const byPlan = await insights.mrrByPlan();
  assert.equal(byPlan.reduce((s, p) => s + p.mrr_pence + p.households, 0), 0);
});

test('every household falls into exactly one class, and the summary adds up', async () => {
  const all = await memberships.classifyHouseholds();
  for (const h of all) assert.ok(memberships.CLASSES.includes(h.cls), h.cls);
  const s = memberships.summarise(all);
  assert.equal(s.members + s.complimentary + s.invited + s.notMembers, s.households);
});

test('paid and trialling members, when Stripe has them, count apart', () => {
  // The summary is pure, so the rule for billed members is pinned now rather
  // than first exercised the day Stripe is plugged in.
  const s = memberships.summarise([
    { householdId: 'a', cls: 'member_paid', planKey: 'household', monthlyPence: 899, people: 4 },
    { householdId: 'b', cls: 'member_paid', planKey: 'solo', monthlyPence: 599, people: 1 },
    { householdId: 'c', cls: 'member_trialling', planKey: 'household', monthlyPence: 0, people: 3 },
    { householdId: 'd', cls: 'complimentary', planKey: 'friend', monthlyPence: 0, people: 2 },
  ]);
  assert.equal(s.members, 3);
  assert.equal(s.paid, 2);
  assert.equal(s.trialling, 1);
  assert.equal(s.mrrPence, 1498, 'trialling and complimentary are out of MRR');
  assert.equal(s.averagePence, 749);
  assert.equal(s.peopleCovered, 8, 'everyone on a membership, trialling included');
  assert.deepEqual(s.byPlan.household, { paid: 1, trialling: 1, mrrPence: 899 });
});

test('the Standard plan is retired: inactive, and still a row history can name (migration 370)', async () => {
  const { rows: [p] } = await query(`select active from plans where key = 'standard'`);
  assert.equal(p.active, false);
});
