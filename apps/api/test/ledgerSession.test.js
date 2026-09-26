/**
 * Every provider call names its session.
 *
 * Owner, 26 Sep 2026: "With five agents on a shared tree, spend nobody can
 * attribute is spend nobody can stop … Make it required rather than optional
 * on the ledger." Three kinds of session can be named — a request's, the one
 * that started a job, the server's own — and nothing reaches the ledger
 * without one of them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const providerCalls = await import('../src/repositories/providerCalls.js');
const { runAsSpender } = await import('../src/context.js');

test.after(() => pool.end());

const rowsFor = async (purpose) => (await query(
  'select session_id, household_id from provider_calls where purpose = $1 order by created_at desc', [purpose])).rows;

test('the ledger will not hold a call with no session', async () => {
  const { rows: [col] } = await query(
    `select is_nullable from information_schema.columns where table_name = 'provider_calls' and column_name = 'session_id'`);
  assert.equal(col.is_nullable, 'NO', 'required, not optional (migration 254)');
  await assert.rejects(
    query(`insert into provider_calls (household_id, session_id, provider, purpose) values (null, null, 'google', 'test.bare')`),
    /null value in column "session_id"/);
});

test('a call made inside a request or a job carries that session', async (t) => {
  const { rows: [s] } = await query(
    `insert into api_sessions (token_hash, label) values ('test:ledger-session', 'test device') on conflict (token_hash) do update set label = excluded.label returning id`);
  t.after(async () => {
    await query(`delete from provider_calls where purpose like 'test.ledger.%'`);
    await query(`delete from api_sessions where token_hash = 'test:ledger-session'`);
  });
  await runAsSpender({ householdId: null, sessionId: s.id }, () => providerCalls.record(null, 'google', 'test.ledger.request', { google: 1 }));
  const [inRequest] = await rowsFor('test.ledger.request');
  assert.equal(inRequest.session_id, s.id, 'the request\'s own session, from the store');

  await providerCalls.record(null, 'google', 'test.ledger.given', { google: 1 }, s.id);
  const [given] = await rowsFor('test.ledger.given');
  assert.equal(given.session_id, s.id, 'or the one the caller named');

  await runAsSpender({ householdId: null, sessionId: s.id }, () => providerCalls.recordTokens({ householdId: null, provider: 'anthropic', purpose: 'test.ledger.tokens', costUsd: 0.001 }));
  const [tokens] = await rowsFor('test.ledger.tokens');
  assert.equal(tokens.session_id, s.id, 'and a token-billed call the same');
});

test('a call nobody made on anybody\'s behalf is the server\'s own, and says so', async (t) => {
  t.after(async () => { await query(`delete from provider_calls where purpose = 'test.ledger.service'`); });
  await providerCalls.record(null, 'osm-overpass', 'test.ledger.service', { 'osm-overpass': 1 });
  const [row] = await rowsFor('test.ledger.service');
  assert.ok(row.session_id, 'a session all the same');
  const { rows: [session] } = await query(
    'select label, expires_at <= now() as expired, revoked_at is not null as revoked from api_sessions where id = $1', [row.session_id]);
  assert.match(session.label, /^service: /, 'the server\'s own, named for the host and commit');
  assert.ok(session.expired && session.revoked, 'and it can never sign anybody in');
  assert.equal(await providerCalls.serviceSessionId(), row.session_id, 'one per process');
});

test('the calls made before today carry the session that says they were not attributed', async () => {
  const { rows: [s] } = await query(`select id, label from api_sessions where token_hash = 'service:unattributed-before-2026-09-26'`);
  assert.ok(s, 'the backfill session exists');
  assert.match(s.label, /unattributed/);
});

test('nothing but an api session can be written, and a plan session is recorded as the request\'s session', async (t) => {
  // Owner, 26 Sep 2026: "Unify the session ids." Migration 256.
  await assert.rejects(
    query(`insert into provider_calls (household_id, session_id, provider, purpose) values (null, gen_random_uuid(), 'google', 'test.stray')`),
    /provider_calls_session_fk/, 'an id that is not an api session is refused');
  const { rows: [plans] } = await query(`select id from api_sessions where token_hash = 'service:plan-sessions-before-2026-09-26'`);
  assert.ok(plans, 'and the old plan-session rows have a named session of their own');

  const { rows: [s] } = await query(
    `insert into api_sessions (token_hash, label) values ('test:ledger-plan', 'planner') on conflict (token_hash) do update set label = excluded.label returning id`);
  t.after(async () => {
    await query(`delete from provider_calls where purpose = 'test.ledger.plan'`);
    await query(`delete from api_sessions where token_hash = 'test:ledger-plan'`);
  });
  const planSessions = await import('../src/repositories/planSessions.js');
  const planId = '00000000-0000-4000-8000-00000000abcd';
  await runAsSpender({ householdId: null, sessionId: s.id }, () => planSessions.recordSessionCall(null, planId, 'google', 'test.ledger.plan', { google: 1 }));
  const [row] = await rowsFor('test.ledger.plan');
  assert.equal(row.session_id, s.id, 'the request\'s session, not the plan\'s id');
});

test('a session the ledger names survives the sweep of dead sessions', async (t) => {
  const { sweepDeadSessions } = await import('../src/repositories/sessions.js');
  const { rows: [spent] } = await query(
    `insert into api_sessions (token_hash, label, expires_at, revoked_at) values ('test:ledger-dead-spent', 'spent', now() - interval '60 days', now() - interval '60 days') returning id`);
  const { rows: [idle] } = await query(
    `insert into api_sessions (token_hash, label, expires_at, revoked_at) values ('test:ledger-dead-idle', 'idle', now() - interval '60 days', now() - interval '60 days') returning id`);
  t.after(async () => {
    await query(`delete from provider_calls where purpose = 'test.ledger.dead'`);
    await query(`delete from api_sessions where token_hash like 'test:ledger-dead-%'`);
  });
  await providerCalls.record(null, 'google', 'test.ledger.dead', { google: 1 }, spent.id);
  await sweepDeadSessions();
  const { rows } = await query(`select token_hash from api_sessions where token_hash like 'test:ledger-dead-%' order by 1`);
  assert.deepEqual(rows.map((r) => r.token_hash), ['test:ledger-dead-spent'], 'the idle one goes, the one with spend on it stays');
});
