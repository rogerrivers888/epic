/**
 * The faults the G2 inventory found (docs/g2-agent-credential-inventory.md,
 * 28 Sep 2026), each pinned so it cannot come back quietly.
 *
 * Most of them are one shape: a route that loads a row by id alone, so any
 * signed-in session reaches another household's trip, group, visit or plan by
 * knowing — or guessing — its id. Every one of those looks like a working app
 * from inside a single household, which is exactly why nobody saw them. The
 * tests here are always two households: the owner of a thing, and a stranger
 * who must get "not found" and leave the thing as it was.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { aHousehold, testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const express = (await import('express')).default;
const { runAsAccount } = await import('../src/context.js');
const { accessFor } = await import('../src/access.js');
const { accountById } = await import('../src/repositories/accounts.js');
const { insertSession, findLiveSession, revokeAllSessions } = await import('../src/repositories/sessions.js');
const { default: tripRoutes } = await import('../src/routes/trips.js');
const { default: journeyRoutes } = await import('../src/routes/journey.js');
const { default: groupRoutes } = await import('../src/routes/groups.js');
const { visits: visitRoutes } = await import('../src/routes/places.js');
const { default: planRoutes } = await import('../src/routes/plan.js');
const { default: sessionRoutes } = await import('../src/routes/session.js');
const { default: sourceSwitchRoutes } = await import('../src/routes/sourceSwitch.js');
const { SENDING_DOORS, SPEND_PREFIXES, holdSendingDoors } = await import('../src/limits.js');
const groupsRepo = await import('../src/repositories/groups.js');
const planSessions = await import('../src/repositories/planSessions.js');
const scoutRepo = await import('../src/repositories/scout.js');
const { readFoundMenus } = await import('../src/sources/scoutArea.js');

// ---------------------------------------------------------------------------
// two households, each with an account, and an app that serves as either
// ---------------------------------------------------------------------------

async function aHouseholdWithAccount(name) {
  const { household, member } = await aHousehold(query, name);
  const { rows: [account] } = await query(
    `insert into accounts (household_id, email, name, role, plan, status)
     values ($1, $2, $3, 'customer', 'trial', 'active') returning *`,
    [household.id, `${name.replace(/\W/g, '')}-${crypto.randomBytes(3).toString('hex')}@example.com`, name],
  );
  return { household, member, account };
}

const ours = await aHouseholdWithAccount('the owners');
const theirs = await aHouseholdWithAccount('the strangers');

/** The door, cut down: `x-account` says who is asking, as `requireSession` would have. */
const app = express();
app.use(express.json());
app.use(async (req, _res, next) => {
  try {
    const id = req.headers['x-account'];
    const account = id ? await accountById(String(id)) : null;
    req.account = account;
    req.session = { id: null, account_id: account?.id ?? null };
    req.access = await accessFor(req);
    return runAsAccount(account, next);
  } catch (err) { return next(err); }
});
app.use('/api/trips', journeyRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/visits', visitRoutes);
app.use('/api/plan', planRoutes);
app.use('/api', sessionRoutes);
app.use('/api', sourceSwitchRoutes);
app.use('/api', groupRoutes);
app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.code || 'internal_error', message: err.message }));
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

test.after(async () => { server.close(); await pool.end(); });

const as = (who, method, path, body) => fetch(`${base}${path}`, {
  method,
  headers: { 'content-type': 'application/json', ...(who ? { 'x-account': who.account.id } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});

async function aTrip(owner) {
  const { rows: [trip] } = await query(
    `insert into trips (household_id, title, origin_label, origin_lat, origin_lng, depart_at, return_at)
     values ($1, 'Crystal Palace', 'Home', 51.42, -0.07, now() + interval '3 days', now() + interval '3 days 8 hours') returning *`,
    [owner.household.id],
  );
  const { rows: [day] } = await query(
    "insert into trip_days (trip_id, date) values ($1, (now() + interval '3 days')::date) returning *", [trip.id],
  );
  await query('insert into trip_attendees (trip_id, member_id) values ($1, $2)', [trip.id, owner.member.id]);
  return { trip, day };
}

// ---------------------------------------------------------------------------
// 1. trips
// ---------------------------------------------------------------------------

test('a trip is read by its own household and is not found by any other', async () => {
  const { trip } = await aTrip(ours);
  const mine = await as(ours, 'GET', `/api/trips/${trip.id}`);
  assert.equal(mine.status, 200);
  assert.equal((await mine.json()).trip.title, 'Crystal Palace');

  for (const path of [`/api/trips/${trip.id}`, `/api/trips/${trip.id}/places`, `/api/trips/${trip.id}/spend`, `/api/trips/${trip.id}/journey`]) {
    const res = await as(theirs, 'GET', path);
    assert.equal(res.status, 404, `${path} must be not found for another household`);
  }
});

test('another household cannot edit, re-people, reorder or delete a trip', async () => {
  const { trip, day } = await aTrip(ours);

  assert.equal((await as(theirs, 'PATCH', `/api/trips/${trip.id}`, { title: 'Stolen' })).status, 404);
  assert.equal((await as(theirs, 'PUT', `/api/trips/${trip.id}/attendees`, { memberIds: [theirs.member.id] })).status, 404);
  assert.equal((await as(theirs, 'PATCH', `/api/trips/${trip.id}/days/${day.id}`, { notes: 'mine now' })).status, 404);
  assert.equal((await as(theirs, 'POST', `/api/trips/${trip.id}/shortlist/reorder`, { itemIds: [] })).status, 404);
  assert.equal((await as(theirs, 'DELETE', `/api/trips/${trip.id}`)).status, 404);

  const { rows: [still] } = await query('select title from trips where id = $1', [trip.id]);
  assert.equal(still?.title, 'Crystal Palace', 'the trip is still there, unchanged');
  const { rows: people } = await query('select member_id from trip_attendees where trip_id = $1', [trip.id]);
  assert.deepEqual(people.map((p) => p.member_id), [ours.member.id], 'nobody was taken off it, nobody put on');
  const { rows: [d] } = await query('select notes from trip_days where id = $1', [day.id]);
  assert.equal(d.notes ?? null, null);
});

test('a household can delete its own trip, and cannot put a stranger on it', async () => {
  const { trip } = await aTrip(ours);
  const res = await as(ours, 'PUT', `/api/trips/${trip.id}/attendees`, { memberIds: [ours.member.id, theirs.member.id] });
  assert.equal(res.status, 200);
  const { rows: people } = await query('select member_id from trip_attendees where trip_id = $1', [trip.id]);
  assert.deepEqual(people.map((p) => p.member_id), [ours.member.id], "another household's person is not added");

  assert.equal((await as(ours, 'DELETE', `/api/trips/${trip.id}`)).status, 204);
  const { rows } = await query('select id from trips where id = $1', [trip.id]);
  assert.equal(rows.length, 0);
});

test('deleteTrip refuses to run without a household', async () => {
  const tripsRepo = await import('../src/repositories/trips.js');
  const { trip } = await aTrip(ours);
  await assert.rejects(tripsRepo.deleteTrip(trip.id), /needs the household/);
  assert.equal(await tripsRepo.deleteTrip(trip.id, theirs.household.id), 0, "another household's id deletes nothing");
  assert.equal(await tripsRepo.deleteTrip(trip.id, ours.household.id), 1);
});

// ---------------------------------------------------------------------------
// 2. groups
// ---------------------------------------------------------------------------

async function aGroup(owner) {
  const { trip } = await aTrip(owner);
  const group = await groupsRepo.insertGroup(trip.id, owner.household.id, {
    name: 'The Palace lot', expectedCount: 6, minimumCount: null, maximumCount: null, wantedBy: null,
    inviteToken: crypto.randomBytes(12).toString('hex'), remindersOn: false, cadence: 'weekly', firstReminderOn: null,
  });
  return { trip, group };
}

test("another household's group is not found, and not changed", async () => {
  const { trip, group } = await aGroup(ours);
  assert.equal((await as(theirs, 'GET', `/api/trips/${trip.id}/group`)).status, 404);
  assert.equal((await as(theirs, 'PATCH', `/api/groups/${group.id}`, { name: 'Ours now' })).status, 404);
  assert.equal((await as(theirs, 'POST', `/api/groups/${group.id}/items`, { label: 'A coach' })).status, 404);
  assert.equal((await as(theirs, 'DELETE', `/api/groups/${group.id}`)).status, 404);
  const { rows: [still] } = await query('select name from trip_groups where id = $1', [group.id]);
  assert.equal(still?.name, 'The Palace lot');

  const mine = await as(ours, 'GET', `/api/trips/${trip.id}/group`);
  assert.equal(mine.status, 200, 'the organiser still sees their own');
});

test('groupById with a household is that household\'s only; without one it is the join-token read', async () => {
  const { group } = await aGroup(ours);
  assert.equal(await groupsRepo.groupById(group.id, theirs.household.id), null);
  assert.equal((await groupsRepo.groupById(group.id, ours.household.id))?.id, group.id);
  assert.equal((await groupsRepo.groupById(group.id))?.id, group.id, 'the invite link and the reminder loop still find it');
});

test("a new group cannot copy another household's people", async () => {
  const { group } = await aGroup(theirs);
  const { trip } = await aTrip(ours);
  const res = await as(ours, 'POST', `/api/trips/${trip.id}/group`, { copyFromGroupId: group.id, items: false });
  assert.equal(res.status, 404);
  const { rows } = await query('select id from trip_groups where trip_id = $1', [trip.id]);
  assert.equal(rows.length, 0, 'no group was made from it');
});

// ---------------------------------------------------------------------------
// 3. visits
// ---------------------------------------------------------------------------

test("another household's visit cannot be read, edited, re-rated or deleted", async () => {
  const { rows: [visit] } = await query(
    `insert into visits (household_id, venue_ref, venue_label, visited_on, note)
     values ($1, 'google:g2-visit', 'The Tea Hut', current_date, 'lovely') returning *`,
    [ours.household.id],
  );
  assert.equal((await as(ours, 'GET', `/api/visits/${visit.id}`)).status, 200);

  assert.equal((await as(theirs, 'GET', `/api/visits/${visit.id}`)).status, 404);
  assert.equal((await as(theirs, 'PATCH', `/api/visits/${visit.id}`, { note: 'awful' })).status, 404);
  assert.equal((await as(theirs, 'PUT', `/api/visits/${visit.id}/takes`, { takes: [] })).status, 404);
  assert.equal((await as(theirs, 'DELETE', `/api/visits/${visit.id}`)).status, 404);

  const { rows: [still] } = await query('select note from visits where id = $1', [visit.id]);
  assert.equal(still?.note, 'lovely', 'the visit is there and says what its household wrote');

  assert.equal((await as(ours, 'DELETE', `/api/visits/${visit.id}`)).status, 204);
});

// ---------------------------------------------------------------------------
// 4. plan sessions
// ---------------------------------------------------------------------------

test("another household's planning session is not found", async () => {
  const session = await planSessions.insertPlanSession(ours.household.id, { draft: true });
  assert.equal((await planSessions.livePlanSession(session.id, ours.household.id))?.id, session.id);
  assert.equal(await planSessions.livePlanSession(session.id, theirs.household.id), null);
  await assert.rejects(planSessions.livePlanSession(session.id), /needs the household/);

  const res = await as(theirs, 'POST', '/api/plan/act', { sessionId: session.id, action: { type: 'like', stopId: 'x' } });
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'session_not_found');
});

test("the plan's per-trip source diagnostic will not run on another household's trip", async () => {
  const { trip } = await aTrip(ours);
  const res = await as(theirs, 'GET', `/api/plan/trips/${trip.id}/sources`);
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'trip_not_found');
});

// ---------------------------------------------------------------------------
// 5. signing out everywhere
// ---------------------------------------------------------------------------

const aToken = () => crypto.randomBytes(32).toString('base64url');

test('"sign out everywhere" from a session with no account signs out only itself', async () => {
  const passcode = aToken(); const other = aToken(); const customer = aToken();
  await insertSession(passcode, 'passcode', null, 'agent');
  await insertSession(other, 'someone else on the passcode', null, 'agent');
  await insertSession(customer, 'a customer', ours.account.id, 'device');

  const res = await fetch(`${base}/api/session?all=1`, { method: 'DELETE', headers: { authorization: `Bearer ${passcode}` } });
  assert.equal(res.status, 204);
  assert.equal(await findLiveSession(passcode), null, 'it signed itself out');
  assert.ok(await findLiveSession(other), 'and nobody else');
  assert.ok(await findLiveSession(customer), 'least of all a customer');
});

test('"sign out everywhere" from an account signs out that account\'s devices only', async () => {
  const phone = aToken(); const laptop = aToken(); const stranger = aToken();
  await insertSession(phone, 'phone', ours.account.id, 'device');
  await insertSession(laptop, 'laptop', ours.account.id, 'device');
  await insertSession(stranger, 'stranger', theirs.account.id, 'device');

  const res = await fetch(`${base}/api/session?all=1`, { method: 'DELETE', headers: { authorization: `Bearer ${phone}` } });
  assert.equal(res.status, 204);
  assert.equal(await findLiveSession(phone), null);
  assert.equal(await findLiveSession(laptop), null);
  assert.ok(await findLiveSession(stranger), "another household's device is untouched");
  await assert.rejects(revokeAllSessions(null), /needs an account/);
});

// ---------------------------------------------------------------------------
// 6. the estate-wide source switch
// ---------------------------------------------------------------------------

test('switching a source estate-wide needs the settings capability', async () => {
  const customer = await as(ours, 'PATCH', '/api/sources/google', { on: false });
  assert.equal(customer.status, 403, 'a household account is refused');
  assert.equal((await customer.json()).capability, 'manage_settings');

  // The owner (the passcode, no account) passes the capability; an unknown key
  // then answers 404 without touching any setting.
  const owner = await as(null, 'PATCH', '/api/sources/not-a-source', { on: false });
  assert.equal(owner.status, 404);
  assert.equal((await owner.json()).error, 'unknown_source');
});

// ---------------------------------------------------------------------------
// 7–8. limits on the doors that send and the doors that spend
// ---------------------------------------------------------------------------

test('every public door that sends a text or e-mail is held to the sign-in limit', async () => {
  for (const door of ['/api/session/request-link', '/api/join/:token/code/again', '/api/join/:token/account', '/api/shared/:token/enter']) {
    assert.ok(SENDING_DOORS.includes(door), `${door} is a sending door`);
  }
  const limited = express();
  holdSendingDoors(limited);
  limited.use((_req, res) => res.json({ sent: true }));
  const s = limited.listen(0);
  await new Promise((r) => s.once('listening', r));
  try {
    const ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
    const statuses = [];
    for (let i = 0; i < 11; i += 1) {
      const res = await fetch(`http://127.0.0.1:${s.address().port}/api/join/abc/code/again`, { method: 'POST', headers: { 'x-forwarded-for': ip } });
      statuses.push(res.status);
    }
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(200));
    assert.equal(statuses[10], 429, 'the eleventh send in a quarter-hour is refused');
  } finally { s.close(); }
});

test('Inspire is under the spend limiter like Places', () => {
  assert.ok(SPEND_PREFIXES.includes('/api/inspire'));
  assert.ok(SPEND_PREFIXES.includes('/api/places'));
});

// ---------------------------------------------------------------------------
// 9. G5: the background menu reader charges the claimant, or nobody
// ---------------------------------------------------------------------------

test('the background menu queue names who claimed each place, and reads nothing nobody claimed', async () => {
  const area = `G2${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  await query(
    `insert into scout_areas (code, label, country_code, lat, lng, radius_km, keep, state, seen)
     values ($1, 'G2 area', 'GB', 51.4, -0.68, 5, 20, 'swept', 1)`, [area]);
  const claimed = `osm:node/g2-claimed-${area}`; const unclaimed = `osm:node/g2-unclaimed-${area}`;
  for (const [i, ref] of [claimed, unclaimed].entries()) {
    await query(
      `insert into scout_places (area_code, venue_ref, name, rank, last_seen) values ($1, $2, $3, $4, now())`,
      [area, ref, `Place ${i}`, i + 1]);
    await scoutRepo.recordMenuFound(ref, { venueLabel: `Place ${i}`, menuUrl: `http://127.0.0.1:9/${i}` });
  }
  await query("insert into place_claims (household_id, venue_ref, reason, claimed_at) values ($1, $2, 'saved', now() - interval '1 day')", [theirs.household.id, claimed]);
  await query("insert into place_claims (household_id, venue_ref, reason) values ($1, $2, 'shortlisted')", [ours.household.id, claimed]);

  const [row] = await scoutRepo.menusToRead(1, claimed);
  assert.equal(row.claimant, theirs.household.id, 'the first household to claim it is the one charged');
  const [nobody] = await scoutRepo.menusToRead(1, unclaimed);
  assert.equal(nobody.claimant, null);
  assert.deepEqual(await scoutRepo.menusToRead(1, unclaimed, { claimedOnly: true }), [], 'the loop never picks an unclaimed place');

  // With no household and no claimant mode, nothing is read at all.
  const refused = await readFoundMenus({ limit: 1 });
  assert.equal(refused.read, 0);
  assert.match(refused.why, /no household/);
});
