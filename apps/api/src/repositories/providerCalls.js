/**
 * The spend ledger: every outbound call Epic has made, what it was for, and
 * what it is estimated to have cost.
 *
 * Technical Constraints §2 — every provider call is attributed to a household
 * and a session, from the first day, "without it there is never evidence to
 * drop a source". So this table is written on the way out of every integration,
 * and read by the caps that stop one running away with the owner's money.
 *
 * Nothing here holds a provider's *content*: a row is a provider, a purpose, a
 * count and a cost.
 */

import os from 'node:os';
import { query } from '../db.js';
import { canBill } from '../constants.js';
import { currentSpender } from '../context.js';
import { costOf } from '../domain/providerPrices.js';
import { healthOf } from '../sources/meter.js';

// ---------------------------------------------------------------------------
// writing
// ---------------------------------------------------------------------------

/**
 * One call, with whatever units the provider counts in.
 *
 * `venueRef` is which place it was about, where a call is about one — the
 * History tab on a place reads the ledger by it. It is not part of the meter:
 * the meter is priced by adding up its keys, and a reference is not a unit of
 * anything (Codex, 18 Sep 2026).
 */
/**
 * The session a row is written against when nobody said.
 *
 * Owner, 26 Sep 2026: "Add a session id to every provider call … With five
 * agents on a shared tree, spend nobody can attribute is spend nobody can
 * stop, and yesterday four sessions spent an afternoon chasing £16.39 that
 * turned out to be this. Make it required rather than optional on the
 * ledger." A request's session is in the store (auth.js puts it there); a
 * census run or a research sweep carries the session that started it; and
 * work nobody started — the boot loops — is the server's own, which is a
 * session too: one row in api_sessions per process, labelled with the host
 * and the commit, expired at birth so it can never sign anybody in. Nothing
 * reaches the ledger without one of the three.
 */
let service = null;
export function serviceSessionId() {
  // The promise, not the id: two unattributed calls arriving together before
  // the row existed each made one, and the last to finish won the cache while
  // the other's rows sat on a session nothing else would name (Codex, 26 Sep
  // 2026). A creation that fails is forgotten, so the next call tries again.
  if (!service) {
    const label = `service: ${os.hostname()} ${process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local'} pid ${process.pid}`;
    service = query(
      `insert into api_sessions (token_hash, label, expires_at, revoked_at)
       values ('service:' || gen_random_uuid()::text, $1, now(), now()) returning id`, [label])
      .then(({ rows: [row] }) => row.id)
      .catch((err) => { service = null; throw err; });
  }
  return service;
}

/** Who a row is written against: the caller's word, the request's or job's session, else the server's own. */
export async function sessionFor(sessionId = null) {
  return sessionId ?? currentSpender().sessionId ?? await serviceSessionId();
}

export async function record(householdId, provider, purpose, units = null, sessionId = null, venueRef = null) {
  // The money as well as the meter. The monthly ceiling is a sum of
  // `estimated_cost_usd`, so a row with a meter and no price is a call the
  // limit cannot see — and the matcher's Nearby Search was exactly that
  // (Codex, 17 Sep 2026). `units` arrives here as JSON text from some callers
  // and as an object from others; both are priced.
  const meter = typeof units === 'string' ? (() => { try { return JSON.parse(units); } catch { return null; } })() : units;
  /**
   * How it went, where the adapter observed it (`sources/meter.js`).
   *
   * `ok` stays null for an adapter nobody has instrumented, which reads on the
   * supplier record as "not recorded" — a different fact from "it worked", and
   * the reason this is not defaulted to true.
   */
  const health = healthOf(typeof units === 'string' ? null : units);
  const session = await sessionFor(sessionId);
  await query(
    `insert into provider_calls (household_id, session_id, provider, purpose, units, estimated_cost_usd, venue_ref, ok, ms, failed, fault, watched)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [householdId, session, provider, purpose, units, costOf(units, provider) || null, venueRef,
      health.ok, health.ms, health.failed, health.fault, health.watched],
  );
  void meter;
}

/** One Claude call, billed in tokens rather than requests. */
export async function recordTokens(c) {
  const session = await sessionFor(c.sessionId ?? null);
  await query(
    `insert into provider_calls
       (household_id, session_id, provider, purpose, input_tokens, output_tokens,
        cache_read_tokens, cache_write_tokens, estimated_cost_usd, ok, ms, failed, fault, watched)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [c.householdId, session, c.provider, c.purpose, c.inputTokens ?? null, c.outputTokens ?? null,
      c.cacheReadTokens ?? null, c.cacheWriteTokens ?? null, c.costUsd,
      c.ok ?? null, c.ms ?? null, c.ok === false ? 1 : 0, c.fault ?? null,
      // One request, which is what a token-billed call always is.
      c.ok == null ? null : 1],
  );
}

/**
 * A call that never came back, and so has no units and no cost.
 *
 * Without this a failure is simply an absence — the ledger records what was
 * spent, and a request that fell over spent nothing. A failure rate needs a
 * numerator, so the failure gets a row of its own with a cost of nought.
 */
export async function recordFailure({ householdId = null, sessionId = null, provider, purpose, ms = null, fault }) {
  // Named like every other row: with the column required, a failure written
  // with no session was refused and the refusal swallowed, so the failure
  // never reached the supplier's numbers (Codex, 26 Sep 2026).
  const session = await sessionFor(sessionId).catch(() => null);
  if (!session) return;
  await query(
    `insert into provider_calls (household_id, session_id, provider, purpose, estimated_cost_usd, ok, ms, failed, fault, watched)
     values ($1, $2, $3, $4, 0, false, $5, 1, $6, 1)`,
    [householdId, session, provider, purpose, ms, String(fault ?? 'error').slice(0, 40)],
  ).catch(() => null);
}

/**
 * One call billed in units *and* estimated in money — a minute of speech, say.
 * `units` is the object form (`{ 'openai-minutes': 0.4 }`) so the Settings
 * spend table can add it up by key, and the cost is the list price for it.
 */
export async function recordMetered({ householdId, sessionId = null, provider, purpose, units, costUsd = null, ok = null, ms = null, fault = null }) {
  await query(
    `insert into provider_calls (household_id, session_id, provider, purpose, units, estimated_cost_usd, ok, ms, failed, fault, watched)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [householdId, sessionId, provider, purpose, units, costUsd, ok, ms, ok === false ? 1 : 0, fault,
      ok == null ? null : 1],
  );
}

// ---------------------------------------------------------------------------
// the caps
// ---------------------------------------------------------------------------

// The two counts the spend bounds are judged on. Both ask what could have cost
// money rather than what happened: the open map, the encyclopedias and the
// address lookup are free, and a guard against an unbounded bill that they can
// fill is a guard against using Epic (owner, 6 Sep 2026). `constants.js`
// `canBill` holds the list; everything is still recorded either way.
const billable = (rows) => rows.reduce((n, r) => n + (canBill(r.provider) ? r.n : 0), 0);

/**
 * Calls, counted as the provider counts them.
 *
 * One ledger row is often several requests: a search hands one meter to the
 * adapter and writes a single row with `{google: 3}` in it. Counted as one
 * row, the cap on calls that can cost money let a household make three
 * requests for one — and the in-process count that closed that gap while the
 * process lived was empty after a restart (Codex, 25 Sep 2026). A row that
 * metered Google requests counts them — whatever its provider says, since a
 * search over several sources is recorded as `fixtures+osm+google` with the
 * Google requests in its units (Codex, same day) — and every other row
 * counts one.
 *
 * Only the requests that can cost money. A census slice on the IDs Only mask
 * is free — that is the whole point of the census — and its row carries
 * thousands of requests under `google` and `google-essentials`. Counted as
 * calls, one day's census put the founding household past its bound and
 * every Claude and Google call it made was refused (found within the hour,
 * 25 Sep 2026). So a row that says which tier its requests were priced at is
 * counted by the priced tiers alone; a row from before the tiers were
 * recorded counts its Google requests; anything else counts one.
 */
const PRICED_TIERS = ['google-pro', 'google-search', 'google-details', 'google-photos', 'google-routes'];
const CALLS_IN_ROW = `case
    when units ?| array['google-essentials', ${PRICED_TIERS.map((t) => `'${t}'`).join(', ')}]
      then ${PRICED_TIERS.map((t) => `coalesce((units->>'${t}')::int, 0)`).join(' + ')}
    else greatest(1, coalesce((units->>'google')::int, 1))
  end`;

export async function countForSession(sessionId) {
  const { rows } = await query(
    `select provider, sum(${CALLS_IN_ROW})::int as n from provider_calls where session_id = $1 group by provider`,
    [sessionId],
  );
  return billable(rows);
}

export async function countThisMonth(householdId) {
  const { rows } = await query(
    `select provider, sum(${CALLS_IN_ROW})::int as n from provider_calls
      where household_id = $1 and created_at >= date_trunc('month', now())
      group by provider`,
    [householdId],
  );
  return billable(rows);
}

/**
 * How many times one purpose has run in a window.
 *
 * The window is named rather than passed as a date so that every cap is judged
 * against the database's clock, the same one the allowances use — a cap that
 * disagreed with the figure shown beside it would be worse than no cap.
 */
export async function countOfPurpose(householdId, provider, purposeLike, window = 'month') {
  const since = window === 'day' ? "date_trunc('day', now())" : "date_trunc('month', now())";
  const { rows } = await query(
    `select count(*)::int as n from provider_calls
      where household_id = $1 and provider = $2 and purpose like $3 and created_at >= ${since}`,
    [householdId, provider, purposeLike],
  );
  return rows[0].n;
}

/**
 * How much of one unit a purpose has used in a window — the minutes of speech
 * a household has sent this month, for the voice purse. Same clock as above.
 */
export async function unitsOfPurpose(householdId, provider, purposeLike, unitKey, window = 'month') {
  const since = window === 'day' ? "date_trunc('day', now())" : "date_trunc('month', now())";
  const { rows } = await query(
    `select coalesce(sum((units ->> $4)::numeric), 0)::float as n from provider_calls
      where household_id = $1 and provider = $2 and purpose like $3
        and jsonb_typeof(units) = 'object' and units ? $4 and created_at >= ${since}`,
    [householdId, provider, purposeLike, unitKey],
  );
  return rows[0].n;
}

// ---------------------------------------------------------------------------
// what it has all cost
// ---------------------------------------------------------------------------

/** Cost and call counts for one session, and for the household this month. */
export async function summary(householdId, sessionId) {
  const { rows } = await query(
    `select
       count(*) filter (where session_id = $2)::int                                   as session_calls,
       coalesce(sum(estimated_cost_usd) filter (where session_id = $2), 0)::float      as session_cost_usd,
       count(*) filter (where created_at >= date_trunc('month', now()))::int          as month_calls,
       coalesce(sum(estimated_cost_usd) filter (where created_at >= date_trunc('month', now())), 0)::float as month_cost_usd
     from provider_calls where household_id = $1`,
    [householdId, sessionId],
  );
  return rows[0];
}

/**
 * Calls in a window, split by the unit each provider counts in.
 *
 * A row written with `units` as an object is a provider that told us what it
 * billed for; the lateral join turns each key into its own line, so "Google
 * Places" and "Google Routes elements" are counted separately even though they
 * arrived on the same row.
 */
export async function meteredUnits(householdId, from, to) {
  const { rows } = await query(
    `select k.key, count(*)::int as calls, coalesce(sum(k.value::numeric), 0)::float as units
       from provider_calls pc
       cross join lateral jsonb_each_text(case when jsonb_typeof(pc.units) = 'object' then pc.units else '{}'::jsonb end) k
      where pc.household_id = $1 and pc.created_at >= $2 and pc.created_at < $3
      group by k.key`,
    [householdId, from, to],
  );
  return rows;
}

/** The same window by provider and purpose, for rows written before units existed. */
export async function callsByPurpose(householdId, from, to) {
  const { rows } = await query(
    `select provider, purpose, (units is null or jsonb_typeof(units) <> 'object') as legacy,
            count(*)::int as calls, coalesce(sum(estimated_cost_usd), 0)::float as cost_usd,
            coalesce(sum(case when jsonb_typeof(units) = 'number' then (units #>> '{}')::numeric end), 0)::float as num_units
       from provider_calls where household_id = $1 and created_at >= $2 and created_at < $3
      group by provider, purpose, (units is null or jsonb_typeof(units) <> 'object')`,
    [householdId, from, to],
  );
  return rows;
}

/**
 * The calendar windows allowances live in, read from the database clock.
 *
 * Deliberately not `new Date()`: the caps' own statements use `now()`, and a
 * month boundary that disagreed by a few hours would show a household an
 * allowance that had reset when it had not.
 */
export async function windows() {
  const { rows } = await query(
    `select date_trunc('month', now()) as month_start,
            date_trunc('month', now()) - interval '1 month' as last_month_start,
            date_trunc('month', now()) + interval '1 month' as next_month_start,
            date_trunc('day', now()) as today_start,
            date_trunc('day', now()) + interval '1 day' as tomorrow_start,
            now() as now`,
  );
  return rows[0];
}

/** The same two reads again, grouped by month, for the spend chart. */
export async function meteredUnitsByMonth(householdId, since) {
  const { rows } = await query(
    `select to_char(date_trunc('month', pc.created_at), 'YYYY-MM') as month, k.key,
            count(*)::int as calls, coalesce(sum(k.value::numeric), 0)::float as units
       from provider_calls pc
       cross join lateral jsonb_each_text(case when jsonb_typeof(pc.units) = 'object' then pc.units else '{}'::jsonb end) k
      where pc.household_id = $1 and pc.created_at >= $2
      group by 1, 2`,
    [householdId, since],
  );
  return rows;
}

export async function callsByPurposeByMonth(householdId, since) {
  const { rows } = await query(
    `select to_char(date_trunc('month', created_at), 'YYYY-MM') as month, provider, purpose,
            (units is null or jsonb_typeof(units) <> 'object') as legacy,
            count(*)::int as calls, coalesce(sum(estimated_cost_usd), 0)::float as cost_usd,
            coalesce(sum(case when jsonb_typeof(units) = 'number' then (units #>> '{}')::numeric end), 0)::float as num_units
       from provider_calls where household_id = $1 and created_at >= $2
      group by 1, 2, 3, 4`,
    [householdId, since],
  );
  return rows;
}
