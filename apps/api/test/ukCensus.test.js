/**
 * The census of the rest of the UK, a day at a time (sources/ukCensus.js).
 *
 * Owner, 28 Sep 2026: a new run each day, capped at 70,000, only if the
 * previous day's census was billed £0 or pennies (or not billed yet), stopped
 * and alerted on any day over £5, attributed as before, reported daily.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const uk = await import('../src/sources/ukCensus.js');

test.after(() => pool.end());

const DAY1 = '2026-09-28T17:39:00Z';
const clean = async () => {
  await query(`delete from census_runs where label like 'The rest of the UK — day %'`);
  await query(`delete from billing_days where invoice_month = '202609' and sku like 'test %'`);
  await query(`delete from api_sessions where label like 'census: The rest of the UK — day %'`);
};

const dayOne = async (over = {}) => {
  const { rows: [r] } = await query(
    `insert into census_runs (label, areas, tile_lat, tile_lng, max_requests, rate_per_sec, fresh_days, state, problem,
                              started_at, finished_at, requests, places, tiles_total, tiles_done)
     values ('The rest of the UK — day 1 (70,000, then stop)', array['TR'], 0.08, 0.12, 70000, 5, 30, $1, $2, $3, $4, 70000, 35462, 3194, 685)
     returning *`,
    [over.state ?? 'paused', over.problem ?? 'stopped at the 70000-request ceiling; resume to carry on',
      over.started ?? DAY1, over.finished ?? '2026-09-28T21:49:00Z']);
  return r;
};
const SKU = {
  'google-essentials': 'Text Search Essentials (IDs Only)',
  'google-pro': 'Place Details Pro',
  'details-essentials': 'Place Details Essentials',
  unmapped: 'Something Google has not told us about',
};
const billed = (day, meter, cost) => query(
  `insert into billing_days (invoice_month, day, service, sku, sku_id, meter, usage, unit, cost, credits, promo, currency)
   values ('202609', $1, 'Places API', $2, 'x', $3, 1, 'count', $4, 0, 0, 'GBP')`,
  [day, `test ${SKU[meter]} ${Math.random()}`, meter === 'unmapped' ? null : meter === 'details-essentials' ? 'google-essentials' : meter, cost]);

/** A stand-in for startRun: records what it was asked and returns a row. */
const recorder = () => {
  const calls = [];
  const start = async (args) => { calls.push(args); return { id: crypto.randomUUID(), label: args.label }; };
  return { calls, start };
};

test('a database with no programme run starts nothing', async (t) => {
  await clean(); t.after(clean);
  const r = recorder();
  const out = await uk.tick({ now: new Date('2026-09-29T08:00:00Z'), start: r.start });
  assert.equal(out.action, 'off');
  assert.equal(r.calls.length, 0);
});

test('the day after a run stopped at its ceiling, the next day starts: 70,000, every area, a session of its own', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  const r = recorder();
  // Still the 28th in Los Angeles: not yet.
  const early = await uk.tick({ now: new Date('2026-09-29T06:30:00Z'), start: r.start });
  assert.equal(early.action, 'today');
  assert.equal(r.calls.length, 0);
  // The quota day has turned; billing has not written the 28th — run anyway.
  const out = await uk.tick({ now: new Date('2026-09-29T07:30:00Z'), start: r.start });
  assert.equal(out.action, 'start');
  assert.equal(r.calls.length, 1);
  const [a] = r.calls;
  assert.equal(a.label, 'The rest of the UK — day 2');
  assert.equal(a.maxRequests, 70_000);
  assert.equal(a.nightShare, 70_000, 'its own share of the day, which advances it one worker at a time');
  assert.equal(a.paused, true, 'built paused, switched on once its plan is whole');
  assert.deepEqual(a.areas, uk.UK_AREAS);
  assert.ok(a.areas.includes('BT') && a.areas.length === 121);
  const { rows: [s] } = await query('select label, kind from api_sessions where id = $1', [a.startedSessionId]);
  assert.deepEqual([s.label, s.kind], ['census: The rest of the UK — day 2', 'service'], 'every ledger row of the day names the day');
});

test('a census day billed above pennies holds the next day', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  await billed('2026-09-28', 'google-essentials', 1.2);
  const r = recorder();
  const told = [];
  const out = await uk.tick({ now: new Date('2026-09-29T08:00:00Z'), start: r.start, tell: (x) => told.push(x) });
  assert.equal(out.action, 'held');
  assert.equal(r.calls.length, 0);
  assert.match(told[0].subject, /held/);
});

test('pennies are not a hold', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  await billed('2026-09-28', 'google-essentials', 0.04);
  const r = recorder();
  const out = await uk.tick({ now: new Date('2026-09-29T08:00:00Z'), start: r.start });
  assert.equal(out.action, 'start');
});

test('any day over £5 of Google stops the census and starts nothing again', async (t) => {
  await clean(); t.after(clean);
  const run = await dayOne({ state: 'running', problem: null, finished: null });
  await billed('2026-09-28', 'google-pro', 5.01);
  const stopped = []; const told = []; const r = recorder();
  const out = await uk.tick({
    now: new Date('2026-09-29T08:00:00Z'), start: r.start,
    stop: async (id) => { stopped.push(id); }, tell: (x) => told.push(x),
  });
  assert.equal(out.action, 'halted');
  assert.deepEqual(stopped, [run.id], 'the running day is stopped');
  assert.match(told[0].subject, /Census stopped: Google billed £5\.01 on 2026-09-28/);
  // And after it is stopped, still nothing starts.
  await query(`update census_runs set state = 'paused', problem = 'stopped at the 70000-request ceiling; resume to carry on' where id = $1`, [run.id]);
  const later = await uk.tick({ now: new Date('2026-09-30T08:00:00Z'), start: r.start, stop: async () => {} });
  assert.equal(later.action, 'halted');
  assert.equal(r.calls.length, 0);
});

test('a person\'s stop is not undone, and a finished UK is complete', async (t) => {
  await clean(); t.after(clean);
  const run = await dayOne({ state: 'stopped', problem: null });
  const r = recorder();
  assert.equal((await uk.tick({ now: new Date('2026-09-30T08:00:00Z'), start: r.start })).action, 'stopped');
  await query(`update census_runs set state = 'done' where id = $1`, [run.id]);
  assert.equal((await uk.tick({ now: new Date('2026-09-30T08:00:00Z'), start: r.start })).action, 'complete');
  assert.equal(r.calls.length, 0);
});

test('the report carries the five figures, billed or not yet', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  const st = await uk.status(new Date('2026-09-28T23:00:00Z'));
  assert.equal(st.days.length, 1);
  const line = uk.reportLine(st.days[0], 184, 12);
  assert.match(line, /^Day 1 \(2026-09-28\): 184 districts done, 35,462 places added, 70,000 requests, not billed yet, about 12 days remaining\.$/);
  await billed('2026-09-28', 'google-essentials', 0);
  const again = await uk.status(new Date('2026-09-29T23:00:00Z'));
  assert.match(uk.reportLine(again.days[0], 184, 12), /billed £0\.00 for the census \(Google £0\.00 that day\)/);
});

test('a day\'s run that met the shared cap is ended for the day, never woken into tomorrow, and tomorrow starts its own', async (t) => {
  await clean(); t.after(clean);
  const { resumeInterrupted, ONE_DAY_RUNS } = await import('../src/sources/censusRun.js');
  const run = await dayOne({ state: 'waiting', problem: '75,000 requests today, which is the 75,000 assumed daily cap', finished: null });
  await query(`update census_runs set started_by = $2, resume_after = now() - interval '1 minute' where id = $1`, [run.id, ONE_DAY_RUNS]);
  // The reset clock leaves it (Codex, 28 Sep 2026).
  const woke = await resumeInterrupted();
  assert.ok(!(woke.runs ?? []).some((r) => r.id === run.id), 'the reset clock does not wake a one-day run');
  // The tick ends it for the day, and the next quota day starts a new one.
  const r = recorder();
  const out = await uk.tick({ now: new Date('2026-09-29T08:00:00Z'), start: r.start });
  const { rows: [after] } = await query('select state, problem from census_runs where id = $1', [run.id]);
  assert.equal(after.state, 'paused');
  assert.match(after.problem, /^ended for the day: 75,000 requests today/);
  assert.equal(out.action, 'start');
  assert.equal(r.calls[0].label, 'The rest of the UK — day 2');
});

test('two ticks at once start the day once', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  const r = recorder();
  const slow = async (args) => { await new Promise((ok) => setTimeout(ok, 200)); return r.start(args); };
  const outs = await Promise.all([
    uk.tick({ now: new Date('2026-09-29T08:00:00Z'), start: slow }),
    uk.tick({ now: new Date('2026-09-29T08:00:00Z'), start: slow }),
  ]);
  assert.equal(r.calls.length, 1, 'one start, however many ticks');
  assert.deepEqual(outs.map((o) => o.action).sort(), ['busy', 'start']);
});

test('a day ended just after the reset still belongs to the day it met the cap in, and day 1 is never woken either', async (t) => {
  await clean(); t.after(clean);
  const { resumeInterrupted } = await import('../src/sources/censusRun.js');
  // Day 1 was started by hand: known by its label, not who started it.
  const run = await dayOne({ state: 'waiting', problem: 'Google refused: 429', finished: null });
  await query(`update census_runs set started_by = 'the owner (passcode)', resume_after = now() - interval '1 minute', day = '2026-09-28' where id = $1`, [run.id]);
  const woke = await resumeInterrupted();
  assert.ok(!(woke.runs ?? []).some((r) => r.id === run.id), 'day 1 is not woken into day 2');
  // Closed off at 00:20 Pacific on the 29th, having asked its last on the 28th.
  await query(`update census_runs set state = 'paused', problem = 'ended for the day: Google refused: 429', finished_at = '2026-09-29T07:20:00Z' where id = $1`, [run.id]);
  const r = recorder();
  const out = await uk.tick({ now: new Date('2026-09-29T09:00:00Z'), start: r.start });
  assert.equal(out.action, 'start', 'the 29th still gets its own run');
});

test('the census cost is its own SKU, and the £5 stop is every line billed', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  // Place Details Essentials shares the census's meter, and is not the census
  // (Codex, 28 Sep 2026): £2 of it holds nothing.
  await billed('2026-09-28', 'details-essentials', 2);
  const r = recorder();
  assert.equal((await uk.tick({ now: new Date('2026-09-29T08:00:00Z'), start: r.start })).action, 'start');
  // A line the mapping does not know is still money: over £5 stops the census.
  await clean();
  await dayOne();
  await billed('2026-09-28', 'unmapped', 6);
  assert.equal((await uk.tick({ now: new Date('2026-09-29T08:00:00Z'), start: r.start, stop: async () => {} })).action, 'halted');
});

test('a run done with a square given up on is not the UK complete: the next day tries again', async (t) => {
  await clean(); t.after(async () => {
    await query(`delete from census_run_tiles where grid_key = 'uktest/failed'`);
    await query(`delete from census_tiles where grid_key = 'uktest/failed'`);
    await clean();
  });
  const run = await dayOne({ state: 'done', problem: null });
  await query(
    `insert into census_tiles (grid_key, min_lat, min_lng, max_lat, max_lng, outcodes, state, failures)
     values ('uktest/failed', 48, -6, 48.08, -5.88, array['ZZ9Q'], 'failed', 3) on conflict (grid_key) do update set state = 'failed', failures = 3`);
  await query(`insert into census_run_tiles (run_id, grid_key) values ($1, 'uktest/failed')`, [run.id]);
  const r = recorder();
  const out = await uk.tick({ now: new Date('2026-09-29T08:00:00Z'), start: r.start });
  assert.equal(out.action, 'start', 'not complete while a square is unasked');
});

test('a day\'s run is switched on only once its plan is written, and a plan cut short is replaced the same day', async (t) => {
  await clean();
  t.after(async () => {
    await query(`delete from census_run_tiles where run_id in (select id from census_runs where label like 'The rest of the UK — day %')`);
    await query(`delete from geo_cells where code like 'ZZ0D%'`);
    await clean();
  });
  await dayOne();
  await query(
    `insert into geo_cells (code, scheme, label, outcode, lat, lng, source) values ('ZZ0D 1', 'sector', 'ZZ0D 1', 'ZZ0D', 48.24, -5.94, 'test')
     on conflict (code) do update set outcode = excluded.outcode, lat = excluded.lat, lng = excluded.lng`);
  const { startRun } = await import('../src/sources/censusRun.js');
  // The real start, on one sea district rather than the UK.
  let seenWhilePlanning = null;
  const start = async (args) => {
    const run = await startRun({ ...args, areas: [], outcodes: ['ZZ0D'], padKm: 0 });
    seenWhilePlanning = (await query('select state from census_runs where id = $1', [run.id])).rows[0].state;
    return run;
  };
  const out = await uk.tick({ now: new Date('2026-09-29T08:00:00Z'), start });
  assert.equal(seenWhilePlanning, 'paused', 'nobody can work it while it is being planned');
  const { rows: [on] } = await query('select state, night_share, started_by from census_runs where id = $1', [out.started.id]);
  assert.deepEqual([on.state, on.night_share], ['running', 70000]);
  // Now a plan that was cut short: built paused by the programme a while ago.
  await query(`update census_runs set state = 'paused', problem = 'built paused; resume to start', started_at = now() - interval '20 minutes' where id = $1`, [out.started.id]);
  const r = recorder();
  const again = await uk.tick({ now: new Date('2026-09-29T08:30:00Z'), start: r.start });
  assert.equal(again.action, 'replan');
  assert.equal(r.calls[0].label, 'The rest of the UK — day 2', 'the same day, the same number');
  const { rows: [old] } = await query('select state, problem from census_runs where id = $1', [out.started.id]);
  assert.deepEqual([old.state, old.problem], ['stopped', 'planning cut short; replaced by the next run']);
});

test('a day\'s run still going after its quota day turned is brought to its ceiling, and today gets its own', async (t) => {
  await clean(); t.after(clean);
  const run = await dayOne({ state: 'running', problem: null, finished: null });
  await query('update census_runs set requests = 51234 where id = $1', [run.id]);
  const r = recorder();
  const out = await uk.tick({ now: new Date('2026-09-29T08:00:00Z'), start: r.start });
  assert.equal(out.action, 'overran');
  const { rows: [after] } = await query('select max_requests from census_runs where id = $1', [run.id]);
  assert.equal(after.max_requests, 51234, 'it pauses where it stands');
  // Once paused at that ceiling, today's run starts.
  await query(`update census_runs set state = 'paused', problem = 'stopped at the 51234-request ceiling; resume to carry on', finished_at = '2026-09-29T08:05:00Z' where id = $1`, [run.id]);
  const next = await uk.tick({ now: new Date('2026-09-29T08:10:00Z'), start: r.start });
  assert.equal(next.action, 'start');
});

test('a day\'s run is not switched on over a census somebody else started meanwhile', async (t) => {
  await clean();
  t.after(async () => {
    await query(`delete from census_runs where label = 'test by hand'`);
    await clean();
  });
  await dayOne();
  const start = async (args) => {
    const { rows: [run] } = await query(
      `insert into census_runs (label, areas, tile_lat, tile_lng, max_requests, rate_per_sec, fresh_days, state, problem, started_by)
       values ($1, array['ZZ'], 0.08, 0.12, 70000, 5, 30, 'paused', 'built paused; resume to start', $2) returning *`, [args.label, args.startedBy]);
    await query(`insert into census_runs (label, areas, tile_lat, tile_lng, max_requests, rate_per_sec, fresh_days, state) values ('test by hand', array['ZZ'], 0.08, 0.12, 10, 5, 30, 'running')`);
    return run;
  };
  const out = await uk.tick({ now: new Date('2026-09-29T08:00:00Z'), start });
  const { rows: [mine] } = await query('select state from census_runs where id = $1', [out.started.id]);
  assert.equal(mine.state, 'paused', 'left built-paused, not a second live run');
});

test('a replaced plan is not a day in the report', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  await query(
    `insert into census_runs (label, areas, tile_lat, tile_lng, max_requests, rate_per_sec, fresh_days, state, problem, started_at)
     values ('The rest of the UK — day 2', array['ZZ'], 0.08, 0.12, 70000, 5, 30, 'stopped', 'planning cut short; replaced by the next run', '2026-09-29T07:10:00Z')`);
  const st = await uk.status(new Date('2026-09-29T09:00:00Z'));
  assert.equal(st.days.length, 1);
});
