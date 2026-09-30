/**
 * The census of the rest of the UK, a day at a time (sources/ukCensus.js).
 *
 * Owner, 28 Sep 2026: a new run each day, capped at 70,000, only if the
 * previous day's census was billed £0 or pennies (or not billed yet), stopped
 * and alerted on any day over £5, attributed as before, reported daily.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const uk = await import('../src/sources/ukCensus.js');

test.after(() => pool.end());

const DAY1 = '2026-09-28T17:39:00Z';
const clean = async () => {
  await query(`delete from bo_settings where key like 'census:uk-day:%' or key like 'census:mailed%' or key in ('census:uk-complete', 'census:uk-hold-lifted')`);
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
const billed = (day, meter, cost, { credits = 0, promo = 0 } = {}) => query(
  `insert into billing_days (invoice_month, day, service, sku, sku_id, meter, usage, unit, cost, credits, promo, currency)
   values ('202609', $1, 'Places API', $2, $7, $3, 1, 'count', $4, $5, $6, 'GBP')`,
  [day, `test ${SKU[meter]} ${Math.random()}`, meter === 'unmapped' ? null : meter === 'details-essentials' ? 'google-essentials' : meter, cost, credits, promo, `x${Math.random()}`]);

/** A stand-in for startRun: records what it was asked and returns a row. */
const recorder = () => {
  const calls = [];
  // A real row, built paused as startRun builds one, so the tick can switch it on.
  const start = async (args) => {
    calls.push(args);
    const { rows: [run] } = await query(
      `insert into census_runs (label, areas, tile_lat, tile_lng, max_requests, rate_per_sec, fresh_days, state, problem, started_by, night_share)
       values ($1, array['ZZ'], 0.08, 0.12, $2, 5, 30, 'paused', 'built paused; resume to start', $3, $4) returning *`,
      [args.label, args.maxRequests, args.startedBy, args.nightShare]);
    return run;
  };
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
  assert.equal(out.action, 'halted');
  assert.equal(r.calls.length, 0);
  assert.match(told[0].subject, /^Census stopped: Places cost £1\.20 after credits/);
});

test('pennies are not a hold', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  await billed('2026-09-28', 'google-essentials', 0.04, { credits: -0.04 }); // fully credited: nothing charged
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
  // Stopped where it stands, as a day ends: its ceiling brought down to what it has asked.
  const { rows: [trim] } = await query('select max_requests, requests from census_runs where id = $1', [run.id]);
  assert.equal(trim.max_requests, trim.requests, 'the running day is stopped');
  assert.deepEqual(stopped, [], 'not as a person\'s stop');
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
  await query(`update census_runs set state = 'done', tiles_done = tiles_total where id = $1`, [run.id]);
  assert.equal((await uk.tick({ now: new Date('2026-09-30T08:00:00Z'), start: r.start })).action, 'complete');
  assert.equal(r.calls.length, 0);
});

test('the daily report is one line: calls, new places, areas left, £ that day', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  const st = await uk.status(new Date('2026-09-28T23:00:00Z'));
  assert.equal(st.days.length, 1);
  const d = { ...st.days[0], newPlaces: 35462, districtsLeft: 1995, areasLeft: 97 };
  assert.equal(uk.reportLine(d), 'Census day 1 (2026-09-28): 70,000 calls · 35,462 new places · 1,995 districts left in 97 areas · billing export: nothing yet');
  await billed('2026-09-28', 'google-essentials', 0);
  await billed('2026-09-29', 'google-essentials', 0);
  const again = await uk.status(new Date('2026-09-30T23:00:00Z'));
  assert.match(uk.reportLine(again.days[0]), / · £0\.00 that day$/);
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
  assert.equal((await uk.tick({ now: new Date('2026-09-29T08:00:00Z'), start: r.start, stop: async () => {} })).action, 'halted', 'any Places spend after credits stops it, whichever SKU (29 Sep 2026)');
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
  await query(`update census_runs set state = 'paused', problem = 'built paused; resume to start', started_at = '2026-09-29T08:10:00Z', last_seen_at = '2026-09-29T08:10:00Z' where id = $1`, [out.started.id]);
  // Twenty minutes before the tick below, on the tick's own clock: aged by the
  // database's real now(), this went red for good once the wall clock passed
  // 08:30 on 29 Sep 2026 (epic-4f).
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
  const told = [];
  const out = await uk.tick({ now: new Date('2026-09-29T08:00:00Z'), start, tell: (x) => told.push(x) });
  assert.equal(out.action, 'blocked');
  const { rows: [mine] } = await query('select state from census_runs where id = $1', [out.built.id]);
  assert.equal(mine.state, 'paused', 'left built-paused, not a second live run');
  assert.equal(told.length, 0, 'and nobody is told it started');
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

test('a quota day is billed across two London days, and both count', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  // 60p on each London day the Pacific 28th spans: £1.20 in all is a hold.
  await billed('2026-09-28', 'google-essentials', 0.6);
  await billed('2026-09-29', 'google-essentials', 0.6);
  const r = recorder();
  assert.equal((await uk.tick({ now: new Date('2026-09-29T09:00:00Z'), start: r.start })).action, 'halted');
});

test('a starting census waits while a day\'s plan is being written', async (t) => {
  await clean(); t.after(clean);
  const { startRun, ONE_DAY_RUNS } = await import('../src/sources/censusRun.js');
  await query(
    `insert into census_runs (label, areas, tile_lat, tile_lng, max_requests, rate_per_sec, fresh_days, state, problem, started_by)
     values ('The rest of the UK — day 2', array['ZZ'], 0.08, 0.12, 70000, 5, 30, 'paused', 'built paused; resume to start', $1)`, [ONE_DAY_RUNS]);
  await assert.rejects(() => startRun({ label: 'test by hand', outcodes: ['SL5'], padKm: 0 }), /is being planned/);
});

test('a notice is mailed once however many processes say it', async (t) => {
  await clean();
  const subject = `test notice ${Math.random()}`;
  t.after(() => query(`delete from mail_messages where subject = $1`, [subject]));
  const { recordSend } = await import('../src/repositories/mail.js');
  let sent = 0;
  const send = async ({ to, subject: s }) => { sent += 1; await new Promise((ok) => setTimeout(ok, 100)); await recordSend({ to, subject: s, purpose: 'census', status: 'sent' }); return { sent: true }; };
  await Promise.all([1, 2, 3].map(() => uk.notify({ subject, send, configured: () => true })));
  assert.equal(sent, 1);
});

test('usage paid by credit, free-tier or promotional, is £0 net', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  // £40 of IDs-only usage, all of it free tier: nothing charged, nothing held.
  await billed('2026-09-28', 'google-essentials', 40, { credits: -40, promo: 0 });
  const r = recorder();
  assert.equal((await uk.tick({ now: new Date('2026-09-29T09:00:00Z'), start: r.start })).action, 'start');
  // £6 of Place Details paid from the promotional credit is £0 net too (owner,
  // 29 Sep 2026: "usage paid by credit counts as £0 net") — not a £5 stop.
  await clean();
  await dayOne();
  await billed('2026-09-28', 'google-pro', 6, { credits: -6, promo: -6 });
  assert.equal((await uk.tick({ now: new Date('2026-09-29T09:00:00Z'), start: r.start, stop: async () => {} })).action, 'start');
  // £6 with £5 of credit is £1 net: Places cost money, and it stops.
  await clean();
  await dayOne();
  await billed('2026-09-28', 'google-pro', 6, { credits: -5, promo: -5 });
  assert.equal((await uk.tick({ now: new Date('2026-09-29T09:00:00Z'), start: r.start, stop: async () => {} })).action, 'halted');
});

test('the report bills a day across both London days, as the decision does', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  await billed('2026-09-29', 'google-essentials', 0.02);
  const st = await uk.status(new Date('2026-09-29T23:00:00Z'));
  assert.equal(st.days[0].billed?.censusGbp, 0.02, 'a charge that landed on the next London day is still day 1\'s');
  assert.equal(st.days[0].billed.final, false, 'one of its two export days is in: billed so far');
  assert.match(uk.reportLine(st.days[0]), /£0\.02 that day so far$/);
  await billed('2026-09-28', 'google-essentials', 0);
  const both = await uk.status(new Date('2026-09-30T23:00:00Z'));
  assert.equal(both.days[0].billed.final, true);
});

test('a quota day over £5 across its two London days stops the census', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  await billed('2026-09-28', 'google-pro', 3);
  await billed('2026-09-29', 'google-pro', 3);
  const r = recorder();
  const out = await uk.tick({ now: new Date('2026-09-29T09:00:00Z'), start: r.start, stop: async () => {} });
  assert.equal(out.action, 'halted');
  assert.equal(out.over.google_gbp, 6);
});

test('a resume waits while a day\'s plan is being written', async (t) => {
  await clean();
  t.after(async () => { await query(`delete from census_runs where label = 'test older'`); await clean(); });
  const { resume, ONE_DAY_RUNS } = await import('../src/sources/censusRun.js');
  const { rows: [older] } = await query(
    `insert into census_runs (label, areas, tile_lat, tile_lng, max_requests, rate_per_sec, fresh_days, state, problem)
     values ('test older', array['ZZ'], 0.08, 0.12, 10, 5, 30, 'paused', 'stopped at the 10-request ceiling; resume to carry on') returning id`);
  await query(
    `insert into census_runs (label, areas, tile_lat, tile_lng, max_requests, rate_per_sec, fresh_days, state, problem, started_by)
     values ('The rest of the UK — day 2', array['ZZ'], 0.08, 0.12, 70000, 5, 30, 'paused', 'built paused; resume to start', $1)`, [ONE_DAY_RUNS]);
  await assert.rejects(() => resume(older.id), /is being planned/);
});

test('a restart after setting a plan aside still passes through the billing gate', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  await query(
    `insert into census_runs (label, areas, tile_lat, tile_lng, max_requests, rate_per_sec, fresh_days, state, problem, started_at)
     values ('The rest of the UK — day 2', array['ZZ'], 0.08, 0.12, 70000, 5, 30, 'stopped', 'planning cut short; replaced by the next run', '2026-09-29T07:10:00Z')`);
  // Day 1's census was billed above pennies: the replacement is held, not started (Codex, 29 Sep 2026).
  await billed('2026-09-28', 'google-essentials', 2);
  const r = recorder();
  const out = await uk.tick({ now: new Date('2026-09-29T08:00:00Z'), start: r.start });
  assert.equal(out.action, 'halted');
  assert.equal(r.calls.length, 0);
});

test('a square given up on is still a day left', async (t) => {
  await clean(); t.after(async () => {
    await query(`delete from census_run_tiles where grid_key = 'uktest/failed2'`);
    await query(`delete from census_tiles where grid_key = 'uktest/failed2'`);
    await clean();
  });
  const run = await dayOne({ state: 'done', problem: null });
  await query(
    `insert into census_tiles (grid_key, min_lat, min_lng, max_lat, max_lng, outcodes, state, failures)
     values ('uktest/failed2', 48, -6, 48.08, -5.88, array['ZZ9Q'], 'failed', 3) on conflict (grid_key) do update set state = 'failed', failures = 3`);
  await query(`insert into census_run_tiles (run_id, grid_key) values ($1, 'uktest/failed2')`, [run.id]);
  await query(`insert into census_slices (area_slug, min_lat, min_lng, max_lat, max_lng, category, subcategory, google_type, query, returned, new_ids, saturated, depth, requests, ran_at, census_run_id)
               values ('uktest/failed2', 48, -6, 48.08, -5.88, 'sport', 'golf', 'golf_course', 'golf', 0, 0, false, 0, 1, now(), $1)`, [run.id]);
  t.after(() => query(`delete from census_slices where area_slug = 'uktest/failed2'`));
  const st = await uk.status(new Date('2026-09-29T09:00:00Z'));
  assert.equal(st.tilesLeft, 1);
  assert.ok(st.daysLeft >= 1, 'not "0 days remaining" while a run is still owed');
});

test('each day reports its own figures, as they stood when it ended', async (t) => {
  await clean();
  t.after(async () => {
    await query(`delete from census_run_tiles where grid_key like 'uktest/day%'`);
    await query(`delete from census_tiles where grid_key like 'uktest/day%'`);
    await clean();
  });
  const one = await dayOne();
  await query(
    `insert into census_tiles (grid_key, min_lat, min_lng, max_lat, max_lng, outcodes, state, censused_at) values
       ('uktest/day/a', 48, -6, 48.08, -5.88, array['ZZ8Q'], 'done', '2026-09-28T20:00:00Z'),
       ('uktest/day/b', 48.08, -6, 48.16, -5.88, array['ZZ8R'], 'todo', null)
     on conflict (grid_key) do update set state = excluded.state, censused_at = excluded.censused_at`);
  await query(`insert into census_run_tiles (run_id, grid_key) values ($1, 'uktest/day/a'), ($1, 'uktest/day/b')`, [one.id]);
  // Written down when it ended, as every run's end does.
  const { keepDayFigures } = await import('../src/sources/censusRun.js');
  await keepDayFigures(one.id);
  const before = await uk.status(new Date('2026-09-29T01:00:00Z'));
  assert.deepEqual([before.days[0].districts, before.days[0].tilesLeft], [1, 1]);
  // Day 2 finishes the other square; day 1's line does not change.
  await query(`update census_tiles set state = 'done', censused_at = '2026-09-29T20:00:00Z' where grid_key = 'uktest/day/b'`);
  const after = await uk.status(new Date('2026-09-30T01:00:00Z'));
  assert.deepEqual([after.days[0].districts, after.days[0].tilesLeft], [1, 1], 'day 1 says what day 1 knew');
  // And still, after its done square is censused again a month on.
  await query(`update census_tiles set censused_at = '2026-10-30T00:00:00Z' where grid_key = 'uktest/day/a'`);
  const month = await uk.status(new Date('2026-10-30T01:00:00Z'));
  assert.deepEqual([month.days[0].districts, month.days[0].tilesLeft], [1, 1], 'kept, not recomputed');
  assert.deepEqual([after.days[0].districtsLeft, after.days[0].areasLeft], [1, 1], 'ZZ8R is left, in one area');
  assert.match(uk.reportLine(after.days[0]), /^Census day 1 \(2026-09-28\): 70,000 calls · \d+ new places · 1 districts left in 1 areas/);
});

test('a plan not switched on is not a finished day in the reports', async (t) => {
  await clean(); t.after(clean);
  const { ONE_DAY_RUNS } = await import('../src/sources/censusRun.js');
  await dayOne();
  await query(
    `insert into census_runs (label, areas, tile_lat, tile_lng, max_requests, rate_per_sec, fresh_days, state, problem, started_by, started_at)
     values ('The rest of the UK — day 2', array['ZZ'], 0.08, 0.12, 70000, 5, 30, 'paused', 'built paused; resume to start', $1, now())`, [ONE_DAY_RUNS]);
  const st = await uk.status(new Date('2026-09-29T09:00:00Z'));
  assert.deepEqual(st.days.map((d) => [d.day, d.ended]), [[1, true], [2, false]]);
});

test('a slow planner still holds off other starts while it beats', async (t) => {
  await clean(); t.after(clean);
  const { startRun, ONE_DAY_RUNS } = await import('../src/sources/censusRun.js');
  await query(
    `insert into census_runs (label, areas, tile_lat, tile_lng, max_requests, rate_per_sec, fresh_days, state, problem, started_by, started_at, last_seen_at)
     values ('The rest of the UK — day 2', array['ZZ'], 0.08, 0.12, 70000, 5, 30, 'paused', 'built paused; resume to start', $1, now() - interval '40 minutes', now() - interval '1 minute')`, [ONE_DAY_RUNS]);
  await assert.rejects(() => startRun({ label: 'test by hand', outcodes: ['SL5'], padKm: 0 }), /is being planned/);
});

test('a person\'s stop on a sleeping day\'s run is not overruled by ending the day', async (t) => {
  await clean(); t.after(clean);
  const { endForTheDay } = await import('../src/sources/censusRun.js');
  const run = await dayOne({ state: 'waiting', problem: '75,000 requests today', finished: null });
  await query('update census_runs set stop_requested = true where id = $1', [run.id]);
  assert.equal(await endForTheDay(run.id), false, 'left to the stop');
  const { rows: [r] } = await query('select state from census_runs where id = $1', [run.id]);
  assert.equal(r.state, 'waiting');
});

test('a stale square being asked again is not done in a day\'s figures', async (t) => {
  await clean();
  t.after(async () => {
    await query(`delete from census_run_tiles where grid_key = 'uktest/stale'`);
    await query(`delete from census_tiles where grid_key = 'uktest/stale'`);
    await clean();
  });
  const one = await dayOne({ state: 'running', problem: null, finished: null });
  await query(
    `insert into census_tiles (grid_key, min_lat, min_lng, max_lat, max_lng, outcodes, state, censused_at, started_at)
     values ('uktest/stale', 48, -6, 48.08, -5.88, array['ZZ7Q'], 'todo', now() - interval '40 days', now() - interval '1 hour')
     on conflict (grid_key) do update set state = 'todo', censused_at = excluded.censused_at, started_at = excluded.started_at`);
  await query(`insert into census_run_tiles (run_id, grid_key) values ($1, 'uktest/stale')`, [one.id]);
  const st = await uk.status(new Date('2026-09-28T23:00:00Z'));
  assert.deepEqual([st.days[0].districts, st.days[0].tilesLeft], [0, 1]);
});

test('the UK once complete stays complete, whatever later censuses do to its squares', async (t) => {
  await clean();
  t.after(async () => {
    await query(`delete from census_run_tiles where grid_key = 'uktest/whole'`);
    await query(`delete from census_tiles where grid_key = 'uktest/whole'`);
    await clean();
  });
  const run = await dayOne({ state: 'done', problem: null });
  await query('update census_runs set tiles_done = tiles_total where id = $1', [run.id]);
  await query(
    `insert into census_tiles (grid_key, min_lat, min_lng, max_lat, max_lng, outcodes, state, censused_at)
     values ('uktest/whole', 48, -6, 48.08, -5.88, array['ZZ6Q'], 'done', now()) on conflict (grid_key) do update set state = 'done'`);
  await query(`insert into census_run_tiles (run_id, grid_key) values ($1, 'uktest/whole')`, [run.id]);
  const r = recorder();
  assert.equal((await uk.tick({ now: new Date('2026-10-20T08:00:00Z'), start: r.start })).action, 'complete');
  // A later census takes the square again.
  await query(`update census_tiles set state = 'todo' where grid_key = 'uktest/whole'`);
  assert.equal((await uk.tick({ now: new Date('2026-11-20T08:00:00Z'), start: r.start })).action, 'complete');
  assert.equal(r.calls.length, 0);
});

test('a person\'s plan being written holds off the census too', async (t) => {
  await clean();
  t.after(async () => { await query(`delete from census_runs where label = 'test planning by hand'`); await clean(); });
  const { startRun } = await import('../src/sources/censusRun.js');
  await query(
    `insert into census_runs (label, areas, tile_lat, tile_lng, max_requests, rate_per_sec, fresh_days, state, problem, started_by, last_seen_at)
     values ('test planning by hand', array['ZZ'], 0.08, 0.12, 10, 5, 30, 'paused', 'built paused; resume to start', 'the owner (passcode)', now())`);
  await assert.rejects(() => startRun({ label: 'The rest of the UK — day 9', outcodes: ['SL5'], padKm: 0 }), /is being planned/);
});

test('another census going: the day waits, and makes no session', async (t) => {
  await clean();
  t.after(async () => { await query(`delete from census_runs where label = 'test by hand, going'`); await clean(); });
  await dayOne();
  await query(`insert into census_runs (label, areas, tile_lat, tile_lng, max_requests, rate_per_sec, fresh_days, state) values ('test by hand, going', array['ZZ'], 0.08, 0.12, 10, 5, 30, 'running')`);
  const r = recorder();
  const out = await uk.tick({ now: new Date('2026-09-29T08:00:00Z'), start: r.start });
  assert.equal(out.action, 'waiting on another census');
  const { rows } = await query(`select 1 from api_sessions where label like 'census: The rest of the UK — day %'`);
  assert.equal(rows.length, 0);
});

test('a plan still being written cannot be resumed, even by name', async (t) => {
  await clean(); t.after(clean);
  const { resume } = await import('../src/sources/censusRun.js');
  const { rows: [p] } = await query(
    `insert into census_runs (label, areas, tile_lat, tile_lng, max_requests, rate_per_sec, fresh_days, state, problem, last_seen_at)
     values ('The rest of the UK — day 2', array['ZZ'], 0.08, 0.12, 70000, 5, 30, 'paused', 'built paused; resume to start', now()) returning id`);
  await assert.rejects(() => resume(p.id), /is being planned/);
});

test('a held programme stays held until a person decides, and a finished one is not halted by later spending', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  await billed('2026-09-28', 'google-essentials', 2);
  const r = recorder();
  // Days later, still held: "stay paused and report the figure".
  assert.equal((await uk.tick({ now: new Date('2026-10-02T08:00:00Z'), start: r.start })).action, 'halted');
  assert.equal(r.calls.length, 0);
  // A finished UK stays finished whatever Google bills after.
  await clean();
  await dayOne({ state: 'done', problem: null });
  await query(`insert into bo_settings (key, value, updated_by) values ('census:uk-complete', '{}', 'test')`);
  await billed('2026-10-10', 'google-pro', 9);
  assert.equal((await uk.tick({ now: new Date('2026-10-11T08:00:00Z'), start: r.start, stop: async () => {} })).action, 'complete');
});

test('a day is billed for good once the export has moved past it, even if a day of it had no usage', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  await billed('2026-09-28', 'google-essentials', 0);
  await billed('2026-10-01', 'google-pro', 0.1); // the export has moved on; the 29th had no Google at all
  const st = await uk.status(new Date('2026-10-02T09:00:00Z'));
  assert.equal(st.days[0].billed.final, true);
});

test('a notice cut off mid-send is sent again', async (t) => {
  await clean();
  const subject = `test cut off ${Math.random()}`;
  t.after(() => query(`delete from mail_messages where subject = $1`, [subject]));
  await query(`insert into mail_messages (to_address, subject, purpose, status, sent_at) values ('x@y', $1, 'census', 'sending', now() - interval '1 hour')`, [subject]);
  let sent = 0;
  await uk.notify({ subject, send: async () => { sent += 1; return { sent: true }; }, configured: () => true });
  assert.equal(sent, 1);
});

test('a day\'s plan written while another census went is switched on once that one stops', async (t) => {
  await clean();
  t.after(async () => { await query(`delete from census_runs where label = 'test by hand, going'`); await clean(); });
  const { ONE_DAY_RUNS, PLAN_WRITTEN } = await import('../src/sources/censusRun.js');
  await dayOne();
  const { rows: [plan] } = await query(
    `insert into census_runs (label, areas, tile_lat, tile_lng, max_requests, rate_per_sec, fresh_days, state, problem, started_by, started_at)
     values ('The rest of the UK — day 2', array['ZZ'], 0.08, 0.12, 70000, 5, 30, 'paused', $2, $1, '2026-09-29T07:10:00Z') returning id`,
    [ONE_DAY_RUNS, PLAN_WRITTEN]);
  const { rows: [other] } = await query(`insert into census_runs (label, areas, tile_lat, tile_lng, max_requests, rate_per_sec, fresh_days, state) values ('test by hand, going', array['ZZ'], 0.08, 0.12, 10, 5, 30, 'running') returning id`);
  assert.equal((await uk.tick({ now: new Date('2026-09-29T08:00:00Z') })).action, 'waiting on another census');
  await query(`update census_runs set state = 'done' where id = $1`, [other.id]);
  assert.equal((await uk.tick({ now: new Date('2026-09-29T08:10:00Z') })).action, 'switched on');
  const { rows: [on] } = await query('select state from census_runs where id = $1', [plan.id]);
  assert.equal(on.state, 'running');
});

test('a census bill that arrives late for an earlier day holds the programme too', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  await query(
    `insert into census_runs (label, areas, tile_lat, tile_lng, max_requests, rate_per_sec, fresh_days, state, problem, started_at, finished_at)
     values ('The rest of the UK — day 2', array['ZZ'], 0.08, 0.12, 70000, 5, 30, 'paused', 'stopped at the 70000-request ceiling; resume to carry on', '2026-09-29T07:10:00Z', '2026-09-29T12:00:00Z')`);
  await billed('2026-09-28', 'google-essentials', 2); // day 1's bill, arriving after day 2 ran
  const r = recorder();
  assert.equal((await uk.tick({ now: new Date('2026-09-30T08:00:00Z'), start: r.start })).action, 'halted');
});

test('a day\'s written plan is not switched on while another plan is being written', async (t) => {
  await clean();
  t.after(async () => { await query(`delete from census_runs where label = 'test planning by hand'`); await clean(); });
  const { ONE_DAY_RUNS, PLAN_WRITTEN } = await import('../src/sources/censusRun.js');
  await dayOne();
  await query(
    `insert into census_runs (label, areas, tile_lat, tile_lng, max_requests, rate_per_sec, fresh_days, state, problem, started_by, started_at)
     values ('The rest of the UK — day 2', array['ZZ'], 0.08, 0.12, 70000, 5, 30, 'paused', $2, $1, '2026-09-29T07:10:00Z')`, [ONE_DAY_RUNS, PLAN_WRITTEN]);
  await query(
    `insert into census_runs (label, areas, tile_lat, tile_lng, max_requests, rate_per_sec, fresh_days, state, problem, started_by, last_seen_at)
     values ('test planning by hand', array['ZZ'], 0.08, 0.12, 10, 5, 30, 'paused', 'built paused; resume to start', 'the owner (passcode)', now())`);
  assert.equal((await uk.tick({ now: new Date('2026-09-29T08:00:00Z') })).action, 'waiting on another census');
});

test('a notice Postmark refused is tried again at once', async (t) => {
  await clean();
  const subject = `test refused ${Math.random()}`;
  t.after(() => query(`delete from mail_messages where subject = $1`, [subject]));
  await query(`insert into mail_messages (to_address, subject, purpose, status, sent_at) values ('x@y', $1, 'census', 'failed', now())`, [subject]);
  let sent = 0;
  await uk.notify({ subject, send: async () => { sent += 1; return { sent: true }; }, configured: () => true });
  assert.equal(sent, 1);
});

test('a finished UK reads complete from its own record, and has nothing left', async (t) => {
  await clean();
  t.after(async () => {
    await query(`delete from census_run_tiles where grid_key = 'uktest/reused'`);
    await query(`delete from census_tiles where grid_key = 'uktest/reused'`);
    await clean();
  });
  const run = await dayOne({ state: 'done', problem: null });
  await query('update census_runs set tiles_done = tiles_total where id = $1', [run.id]);
  // Before the tick saw it, a later census took one of its squares again.
  await query(
    `insert into census_tiles (grid_key, min_lat, min_lng, max_lat, max_lng, outcodes, state)
     values ('uktest/reused', 48, -6, 48.08, -5.88, array['ZZ5Q'], 'todo') on conflict (grid_key) do update set state = 'todo'`);
  await query(`insert into census_run_tiles (run_id, grid_key) values ($1, 'uktest/reused')`, [run.id]);
  const r = recorder();
  assert.equal((await uk.tick({ now: new Date('2026-10-20T08:00:00Z'), start: r.start })).action, 'complete');
  const st = await uk.status(new Date('2026-10-20T09:00:00Z'));
  assert.deepEqual([st.complete, st.tilesLeft, st.daysLeft], [true, 0, 0]);
});

test('a person lifts the hold, and only a later bill holds it again', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  await billed('2026-09-28', 'google-essentials', 2);
  const r = recorder();
  assert.equal((await uk.tick({ now: new Date('2026-09-30T08:00:00Z'), start: r.start })).action, 'halted');
  await uk.liftHold({ who: 'test', now: new Date('2026-09-30T09:00:00Z') });
  assert.equal((await uk.tick({ now: new Date('2026-09-30T10:00:00Z'), start: r.start })).action, 'start');
});

test('a lift covers only the bills the export held when it was made', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  await query(
    `insert into census_runs (label, areas, tile_lat, tile_lng, max_requests, rate_per_sec, fresh_days, state, problem, started_at, finished_at)
     values ('The rest of the UK — day 2', array['ZZ'], 0.08, 0.12, 70000, 5, 30, 'paused', 'stopped at the 70000-request ceiling; resume to carry on', '2026-09-30T07:10:00Z', '2026-09-30T12:00:00Z')`);
  await billed('2026-09-28', 'google-essentials', 2);
  await uk.liftHold({ who: 'test', now: new Date('2026-10-01T09:00:00Z') }); // the export holds the 28th only
  await billed('2026-09-30', 'google-essentials', 3); // day 2's bill arrives after the lift
  const r = recorder();
  assert.equal((await uk.tick({ now: new Date('2026-10-01T10:00:00Z'), start: r.start })).action, 'halted');
});

test('a finished census whose last day comes in costly is still said', async (t) => {
  await clean(); t.after(clean);
  await dayOne({ state: 'done', problem: null });
  await query(`insert into bo_settings (key, value, updated_by) values ('census:uk-complete', '{}', 'test')`);
  await billed('2026-09-28', 'google-pro', 7);
  const told = [];
  const out = await uk.tick({ now: new Date('2026-10-01T08:00:00Z'), tell: (x) => told.push(x) });
  assert.equal(out.action, 'complete');
  assert.match(told[0]?.subject ?? '', /Census \(finished\) was billed £7\.00/);
});

test('a charge backfilled onto a day already lifted holds it again', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  await billed('2026-09-28', 'google-essentials', 2);
  await billed('2026-09-30', 'google-pro', 0.1); // the export has reached the 30th
  await uk.liftHold({ who: 'test' });
  const r = recorder();
  // Lifted: £2 on the 28th was seen.
  const { action } = await uk.decide(new Date('2026-10-01T08:00:00Z'));
  assert.equal(action, 'start');
  // Then £1.50 more is backfilled onto the 28th, behind a watermark at the 30th.
  await billed('2026-09-28', 'google-essentials', 1.5);
  assert.equal((await uk.tick({ now: new Date('2026-10-01T09:00:00Z'), start: r.start })).action, 'halted');
});

test('the day that ended is kept before the next day starts', async (t) => {
  await clean(); t.after(clean);
  const one = await dayOne();
  const r = recorder();
  await uk.tick({ now: new Date('2026-09-29T08:00:00Z'), start: r.start });
  const { rows } = await query(`select 1 from bo_settings where key = $1`, [`census:uk-day:${one.id}`]);
  assert.equal(rows.length, 1);
});

test('a day\'s figures are kept the moment its run ends', async (t) => {
  await clean();
  t.after(async () => {
    await query(`delete from census_run_tiles where grid_key = 'uktest/kept'`);
    await query(`delete from census_tiles where grid_key = 'uktest/kept'`);
    await clean();
  });
  const { requestStop } = await import('../src/sources/censusRun.js');
  const run = await dayOne({ state: 'waiting', problem: 'x', finished: null });
  await query(
    `insert into census_tiles (grid_key, min_lat, min_lng, max_lat, max_lng, outcodes, state, censused_at)
     values ('uktest/kept', 48, -6, 48.08, -5.88, array['ZZ4Q'], 'done', now() - interval '1 hour') on conflict (grid_key) do update set state = 'done', censused_at = excluded.censused_at`);
  await query(`insert into census_run_tiles (run_id, grid_key) values ($1, 'uktest/kept')`, [run.id]);
  await requestStop(run.id); // a stop while it slept: it ends here
  // A later census takes the square before anybody reads the report.
  await query(`update census_tiles set state = 'todo' where grid_key = 'uktest/kept'`);
  const { rows: [kept] } = await query(`select value from bo_settings where key = $1`, [`census:uk-day:${run.id}`]);
  assert.deepEqual(kept?.value, { districts: 1, left: 0, districtsLeft: 0, areasLeft: 0 });
});

test('a census notice goes to the report address, logged as a census alert or report', async (t) => {
  await clean();
  const subject = `test to ${Math.random()}`;
  const sent = [];
  await uk.notify({ subject, purpose: 'census_alert', configured: () => true,
    send: async (m) => { sent.push(m); return { sent: true }; } });
  assert.deepEqual(sent.map((m) => [m.to, m.purpose]), [['roger@epic.day', 'census_alert']]);
  assert.deepEqual(uk.reportTo(), ['roger@epic.day'], 'while Postmark is in test mode, the address Epic owns');
});

test('Google\'s limit decides the size of the day: 150,000 once it reads 160,000, 70,000 when it cannot be read', async (t) => {
  const { limitFrom } = await import('../src/sources/googleQuota.js');
  const q = (value, extra = {}) => ({ quotaId: 'SearchTextRequestsPerDayPerProject', metric: 'places.googleapis.com/search_text_requests', refreshInterval: 'day', dimensionsInfos: [{ dimensions: {}, details: { value: String(value) } }], ...extra });
  assert.deepEqual(limitFrom([q(75000)]), { speaks: true, limit: 75000 });
  assert.deepEqual(limitFrom([q(160000), { quotaId: 'SearchTextRequestsPerMinute', refreshInterval: 'minute', dimensionsInfos: [{ details: { value: '6000' } }] }]), { speaks: true, limit: 160000 });
  assert.equal(limitFrom([q(-1)]).limit, Infinity);
  assert.deepEqual(limitFrom([q(160000, { refreshInterval: '86400s' })]), { speaks: true, limit: 160000 }, 'a day written as a duration');
  assert.equal(limitFrom([]).speaks, false);
  assert.deepEqual(uk.daySize({ speaks: true, limit: 160000 }), { requests: 150000, cap: 160000 });
  assert.deepEqual(uk.daySize({ speaks: true, limit: 75000 }), { requests: 70000, cap: 75000 });
  assert.deepEqual(uk.daySize({ speaks: false, why: 'x' }), { requests: 70000, cap: 75000 });
  assert.deepEqual(uk.daySize({ speaks: true, limit: 50000 }), { requests: 45000, cap: 50000 }, 'a lower limit is kept to');

  await clean(); t.after(clean);
  await dayOne();
  const r = recorder(); const told = [];
  const out = await uk.tick({ now: new Date('2026-09-29T08:00:00Z'), start: r.start, tell: (x) => told.push(x), quota: async () => ({ speaks: true, limit: 160000 }) });
  assert.equal(out.action, 'start');
  assert.deepEqual([r.calls[0].maxRequests, r.calls[0].nightShare, r.calls[0].dailyCap], [150000, 150000, 160000]);
  assert.ok(told.some((x) => /^Census raised to 150,000 a day/.test(x.subject)), 'and it says so, with the days left');
  // The next raised day says nothing more.
  await query(`update census_runs set state = 'paused', problem = 'stopped at the 150000-request ceiling; resume to carry on', max_requests = 150000, finished_at = '2026-09-29T20:00:00Z' where label = 'The rest of the UK — day 2'`);
  const again = [];
  await uk.tick({ now: new Date('2026-09-30T08:00:00Z'), start: r.start, tell: (x) => again.push(x), quota: async () => ({ speaks: true, limit: 160000 }) });
  assert.ok(!again.some((x) => /^Census raised/.test(x.subject)), 'said once, on the day it changed');
});

test('a limit Google will not tell leaves the day at 70,000', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  const r = recorder();
  await uk.tick({ now: new Date('2026-09-29T08:00:00Z'), start: r.start, quota: async () => ({ speaks: false, why: '403' }) });
  assert.equal(r.calls[0].maxRequests, 70000);
});

test('a notice goes to every recipient, and one sent does not stand for the rest', async (t) => {
  await clean();
  const subject = `test two ${Math.random()}`;
  t.after(() => query(`delete from mail_messages where subject = $1`, [subject]));
  await query(`insert into mail_messages (to_address, subject, purpose, status) values ('a@epic.day', $1, 'census_report', 'sent')`, [subject]);
  const sent = [];
  await uk.notify({ subject, configured: () => true, to: ['a@epic.day', 'b@epic.day'], send: async (m) => { sent.push(m.to); return { sent: true }; } });
  assert.deepEqual(sent, ['b@epic.day']);
});

test('a day closed off early keeps its size for the days left and the raise notice', async (t) => {
  await clean(); t.after(clean);
  const one = await dayOne();
  // A 150,000 day brought to its ceiling at 40,000 when it ran past midnight.
  await query('update census_runs set night_share = 150000, max_requests = 40000, requests = 40000 where id = $1', [one.id]);
  assert.equal(uk.daySizeOf((await query('select * from census_runs where id = $1', [one.id])).rows[0]), 150000);
  const r = recorder(); const told = [];
  await uk.tick({ now: new Date('2026-09-29T08:00:00Z'), start: r.start, tell: (x) => told.push(x), quota: async () => ({ speaks: true, limit: 160000 }) });
  assert.ok(!told.some((x) => /^Census raised/.test(x.subject)), 'not announced again');
});

test('a Google limit that leaves the census nothing: it waits, and makes nothing', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  const r = recorder();
  const out = await uk.tick({ now: new Date('2026-09-29T08:00:00Z'), start: r.start, quota: async () => ({ speaks: true, limit: 4000 }) });
  assert.equal(out.action, 'no quota for the census');
  assert.equal(r.calls.length, 0);
});

test('Places spend after every credit decides: fully credited runs on, a penny charged stops it', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  // £40.96 of usage, all of it covered by credit, promotional included: £0 net (owner, 29 Sep 2026).
  await billed('2026-09-28', 'google-pro', 4.96, { credits: -4.96, promo: -4.96 });
  const r = recorder();
  assert.equal((await uk.tick({ now: new Date('2026-09-29T08:00:00Z'), start: r.start })).action, 'start');
  // A day where credit ran short by 3p.
  await clean();
  await dayOne({ state: 'running', problem: null, finished: null });
  await billed('2026-09-28', 'google-pro', 2, { credits: -1.97 });
  const told = [];
  const out = await uk.tick({ now: new Date('2026-09-29T08:00:00Z'), start: r.start, stop: async () => {}, tell: (x) => told.push(x) });
  assert.equal(out.action, 'halted');
  assert.equal(out.over.kind, 'net');
  assert.match(told[0].subject, /^Census stopped: Places cost £0\.03 after credits on 2026-09-28/);
});

test('a fraction of a penny is above £0, Routes is not Places, and a finished census still says a late Places charge', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  await billed('2026-09-28', 'google-pro', 0.003); // a single request, a fraction of a penny
  const r = recorder();
  assert.equal((await uk.tick({ now: new Date('2026-09-29T08:00:00Z'), start: r.start, stop: async () => {} })).action, 'halted');
  await clean();
  await dayOne();
  await query(
    `insert into billing_days (invoice_month, day, service, sku, sku_id, meter, usage, unit, cost, credits, promo, currency)
     values ('202609', '2026-09-28', 'Routes API', 'test Routes', $1, 'google-routes', 1, 'count', 2, 0, 0, 'GBP')`, [`x${Math.random()}`]);
  assert.equal((await uk.tick({ now: new Date('2026-09-29T08:00:00Z'), start: r.start })).action, 'start', 'a Routes charge is not Places spend');
  await clean();
  await dayOne({ state: 'done', problem: null });
  await query(`insert into bo_settings (key, value, updated_by) values ('census:uk-complete', '{}', 'test')`);
  await billed('2026-09-28', 'google-pro', 0.5);
  const told = [];
  assert.equal((await uk.tick({ now: new Date('2026-10-01T08:00:00Z'), tell: (x) => told.push(x) })).action, 'complete');
  assert.match(told[0]?.subject ?? '', /^Census \(finished\): Places cost £0\.50 after credits/);
});

test('a charge lifted before the finish is not said again after it, and an old day with no record stays unknown', async (t) => {
  await clean(); t.after(clean);
  await dayOne({ state: 'done', problem: null });
  await billed('2026-09-28', 'google-pro', 0.5);
  await uk.liftHold({ who: 'test' });
  await query(`insert into bo_settings (key, value, updated_by) values ('census:uk-complete', '{}', 'test')`);
  const told = [];
  assert.equal((await uk.tick({ now: new Date('2026-10-01T08:00:00Z'), tell: (x) => told.push(x) })).action, 'complete');
  assert.equal(told.length, 0, 'lifted, and not grown: nothing to say');
  // Seen from two months on with no record kept: not reconstructed.
  await query(`delete from bo_settings where key like 'census:uk-day:%'`);
  const st = await uk.status(new Date('2026-12-01T08:00:00Z'));
  assert.deepEqual([st.days[0].districtsLeft, st.days[0].areasLeft], [null, null]);
  // Its new places are still counted once and kept, with the rest left unknown.
  const { rows: [k] } = await query(`select value from bo_settings where key like 'census:uk-day:%'`);
  assert.equal(typeof k?.value?.newPlaces, 'number');
  assert.equal(k.value.districtsLeft, null);
});

test('a lift clears what it saw, export day and quota day alike, and fractions of a penny are said as such', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  await billed('2026-09-28', 'google-pro', 1);
  await billed('2026-09-29', 'google-pro', 1, { credits: -2 }); // a credit on the next day pulls the quota-day total to £0
  const r = recorder();
  assert.equal((await uk.tick({ now: new Date('2026-09-30T08:00:00Z'), start: r.start, stop: async () => {} })).action, 'halted');
  await uk.liftHold({ who: 'test' });
  assert.equal((await uk.tick({ now: new Date('2026-09-30T09:00:00Z'), start: r.start })).action, 'start', 'lifted means lifted');
  assert.equal(uk.gbp(0.003), '£0.003');
  assert.equal(uk.gbp(0.00004), '£0.00004', 'every figure that can stop it is said');
  assert.equal(uk.gbp(1.2), '£1.20');
});

test('stopped on a bill, lifted, and the next day follows', async (t) => {
  await clean(); t.after(clean);
  const run = await dayOne({ state: 'running', problem: null, finished: null });
  await billed('2026-09-28', 'google-pro', 0.2);
  const r = recorder();
  assert.equal((await uk.tick({ now: new Date('2026-09-28T22:00:00Z'), start: r.start })).action, 'halted');
  // The engine pauses it at the brought-down ceiling, as a day ends.
  await query(`update census_runs set state = 'paused', problem = 'stopped at the ' || max_requests || '-request ceiling; resume to carry on', finished_at = '2026-09-28T22:05:00Z' where id = $1`, [run.id]);
  await uk.liftHold({ who: 'test' });
  assert.equal((await uk.tick({ now: new Date('2026-09-29T08:00:00Z'), start: r.start })).action, 'start', 'the census carries on');
});

test('a finished census is not blamed for Places used long after, and the report says a fraction of a penny', async (t) => {
  await clean(); t.after(clean);
  await dayOne({ state: 'done', problem: null });
  await query(`insert into bo_settings (key, value, updated_by) values ('census:uk-complete', '{}', 'test')`);
  await billed('2026-10-28', 'google-pro', 3); // a month on
  const told = [];
  await uk.tick({ now: new Date('2026-10-29T08:00:00Z'), tell: (x) => told.push(x) });
  assert.equal(told.length, 0);
  assert.match(uk.reportLine({ day: 1, date: '2026-09-28', requests: 1, newPlaces: 0, billed: { placesNetGbp: 0.003, final: true } }), /£0\.003 that day$/);
});

test('a lift written before the new maps still covers what it saw, and a day keeps its new places', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  await billed('2026-09-28', 'google-pro', 0.4);
  // The old shape: only `seen`, and when.
  await query(`insert into bo_settings (key, value, updated_by) values ('census:uk-hold-lifted', $1, 'test')`,
    [JSON.stringify({ seen: { '2026-09-28': 0 }, at: '2026-09-29T09:00:00Z' })]);
  const r = recorder();
  assert.equal((await uk.tick({ now: new Date('2026-09-30T08:00:00Z'), start: r.start })).action, 'start', 'not stopped again on a charge already lifted');
  // Converted to a finite baseline: a later rise on that day still stops it.
  await billed('2026-09-28', 'google-pro', 0.1);
  assert.equal((await uk.tick({ now: new Date('2026-09-30T09:00:00Z'), start: r.start, stop: async () => {} })).action, 'halted', 'growth after the lift still stops it');
  // A day kept once has its new places stored with it.
  await uk.status(new Date('2026-09-30T09:00:00Z'));
  await uk.status(new Date('2026-09-30T09:10:00Z'));
  const { rows: [k] } = await query(`select value from bo_settings where key like 'census:uk-day:%' limit 1`);
  assert.equal(typeof k?.value?.newPlaces, 'number');
});

test('an old day whose squares were asked again since is not rebuilt', async (t) => {
  await clean();
  t.after(async () => {
    await query(`delete from census_run_tiles where grid_key = 'uktest/revisit'`);
    await query(`delete from census_tiles where grid_key = 'uktest/revisit'`);
    await clean();
  });
  const one = await dayOne();
  await query(
    `insert into census_tiles (grid_key, min_lat, min_lng, max_lat, max_lng, outcodes, state, censused_at)
     values ('uktest/revisit', 48, -6, 48.08, -5.88, array['ZZ3Q'], 'done', '2026-09-29T10:00:00Z') on conflict (grid_key) do update set state = 'done', censused_at = excluded.censused_at`);
  await query(`insert into census_run_tiles (run_id, grid_key) values ($1, 'uktest/revisit')`, [one.id]);
  // Its record from before it carried what was left.
  await query(`insert into bo_settings (key, value, updated_by) values ($1, '{"districts": 5, "left": 3}', 'test')`, [`census:uk-day:${one.id}`]);
  const st = await uk.status(new Date('2026-09-30T09:00:00Z'));
  assert.deepEqual([st.days[0].districts, st.days[0].districtsLeft], [5, null], 'what it said stands; what it did not, stays unknown');
});

test('a charge lifted before the next day existed is not held against that day, and the day record fills a blank', async (t) => {
  await clean(); t.after(clean);
  const one = await dayOne();
  await billed('2026-09-29', 'google-pro', 0.5); // day 1's second export day
  await uk.liftHold({ who: 'test' });
  // Day 2 comes to exist; its quota day spans the 29th too.
  await query(
    `insert into census_runs (label, areas, tile_lat, tile_lng, max_requests, rate_per_sec, fresh_days, state, problem, started_at, finished_at, night_share)
     values ('The rest of the UK — day 2', array['ZZ'], 0.08, 0.12, 70000, 5, 30, 'paused', 'stopped at the 70000-request ceiling; resume to carry on', '2026-09-29T07:10:00Z', '2026-09-29T12:00:00Z', 70000)`);
  const r = recorder();
  assert.equal((await uk.tick({ now: new Date('2026-09-30T08:00:00Z'), start: r.start })).action, 'start', 'the lifted 50p is not a new charge on day 2');
  // A blank record written at the very moment the day ended is filled by the day's own record.
  const { keepDayFigures } = await import('../src/sources/censusRun.js');
  await query(`insert into bo_settings (key, value, updated_by) values ($1, '{"districts": null, "left": null, "newPlaces": 7}', 'test')
               on conflict (key) do update set value = excluded.value`, [`census:uk-day:${one.id}`]);
  await keepDayFigures(one.id);
  const { rows: [k] } = await query(`select value from bo_settings where key = $1`, [`census:uk-day:${one.id}`]);
  assert.notEqual(k.value.districts, null);
  assert.equal(k.value.newPlaces, 7, 'and keeps what else it held');
});

test('a late charge after the finish is on the status, to be looked at and lifted', async (t) => {
  await clean(); t.after(clean);
  await dayOne({ state: 'done', problem: null });
  await query(`insert into bo_settings (key, value, updated_by) values ('census:uk-complete', '{}', 'test')`);
  await billed('2026-09-28', 'google-pro', 0.5);
  const st = await uk.status(new Date('2026-10-01T08:00:00Z'));
  assert.equal(st.complete, true);
  assert.equal(st.halted?.kind, 'net');
  await uk.liftHold({ who: 'test' });
  assert.equal((await uk.status(new Date('2026-10-01T09:00:00Z'))).halted, null, 'and gone once lifted');
});

test('a notice that went but could not be written down is not sent again every tick', async () => {
  const subject = `Census — unlogged ${Date.now()}`;
  let sent = 0;
  const send = async () => { sent += 1; return { sent: true, logged: false, logError: 'no row' }; };
  for (let i = 0; i < 3; i += 1) await uk.notify({ subject, send, configured: () => true, to: ['roger@epic.day'] });
  assert.equal(sent, 1, 'the census keeps its own ledger, and does not read the mail log to know');
  const { rows } = await query(`select value from bo_settings where key like 'census:mailed:%' and value->>'subject' = $1`, [subject]);
  assert.equal(rows[0]?.value.state, 'sent');
});

test('a notice refused by the sender is cleared from the ledger and tried again', async (t) => {
  await clean(); t.after(clean);
  const subject = `Census — refused ${Date.now()}`;
  let tries = 0;
  const send = async () => { tries += 1; return tries === 1 ? { sent: false, message: 'refused' } : { sent: true }; };
  await uk.notify({ subject, send, configured: () => true, to: ['roger@epic.day'] });
  await uk.notify({ subject, send, configured: () => true, to: ['roger@epic.day'] });
  await uk.notify({ subject, send, configured: () => true, to: ['roger@epic.day'] });
  assert.equal(tries, 2);
});

test('the legacy mark from the night of 30 Sep still counts as sent', async (t) => {
  await clean(); t.after(clean);
  const crypto = await import('node:crypto');
  const subject = 'Census — the rest of the UK, day 1';
  const key = `census:mailed-unlogged:${crypto.createHash('sha256').update(`${subject}\nroger@epic.day`).digest('hex').slice(0, 32)}`;
  await query(`insert into bo_settings (key, value, updated_by) values ($1, '{}', 'test')`, [key]);
  let sent = 0;
  await uk.notify({ subject, send: async () => { sent += 1; return { sent: true }; }, configured: () => true, to: ['roger@epic.day'] });
  assert.equal(sent, 0);
});

// Owner, 30 Sep 2026 (C58 amended): no daily e-mails, no "day started"; a
// Monday summary; otherwise only what needs acting on or knowing.
const mailbox = () => { const got = []; return { got, send: async (m) => { got.push(m); return { sent: true }; } }; };

test('a day ending or starting is not e-mailed', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  const r = recorder(); const box = mailbox();
  // Tuesday 29 Sep, 09:10 London: day 1 has ended, day 2 starts.
  await uk.daily(new Date('2026-09-29T08:10:00Z'), { send: box.send, start: r.start, quota: async () => ({ speaks: true, limit: 75000 }) });
  assert.equal(r.calls.length, 1, 'day 2 was started');
  assert.deepEqual(box.got.map((m) => m.subject), [], 'and nobody was e-mailed about either');
});

test('Monday morning brings one weekly summary with the six figures', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  const r = recorder(); const box = mailbox();
  const q = async () => ({ speaks: true, limit: 75000 });
  // Monday 5 Oct, 06:30 London: not yet.
  await uk.daily(new Date('2026-10-05T05:30:00Z'), { send: box.send, start: r.start, quota: q });
  assert.ok(!box.got.some((m) => /weekly summary/.test(m.subject)), 'not before seven');
  for (const at of ['2026-10-05T07:10:00Z', '2026-10-05T07:20:00Z', '2026-10-05T11:00:00Z']) {
    await uk.daily(new Date(at), { send: box.send, start: r.start, quota: q });
  }
  const weekly = box.got.filter((m) => /weekly summary/.test(m.subject));
  assert.equal(weekly.length, 1, 'once');
  assert.equal(weekly[0].subject, 'Census — weekly summary, week to 2026-10-05');
  for (const word of ['Calls:', 'New places:', 'Areas left:', 'Days to finish:', '£ spent', 'Billing export:']) {
    assert.ok(weekly[0].text.includes(word), word);
  }
});

test('an empty billing export after Friday 2 October is said once', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  const r = recorder(); const box = mailbox();
  const q = async () => ({ speaks: true, limit: 75000 });
  await uk.daily(new Date('2026-10-02T12:00:00Z'), { send: box.send, start: r.start, quota: q });
  assert.ok(!box.got.some((m) => /billing export is still empty/.test(m.subject)), 'not on the Friday');
  await uk.daily(new Date('2026-10-03T09:00:00Z'), { send: box.send, start: r.start, quota: q });
  await uk.daily(new Date('2026-10-03T09:10:00Z'), { send: box.send, start: r.start, quota: q });
  assert.equal(box.got.filter((m) => /billing export is still empty/.test(m.subject)).length, 1);
});

test('a running day that has not moved for an hour is a stall, said once', async (t) => {
  await clean(); t.after(clean);
  const run = await dayOne({ state: 'running', started: '2026-09-29T07:05:00Z', finished: null });
  await query(`update census_runs set last_seen_at = '2026-09-29T09:00:00Z', max_requests = 70000, requests = 1000, night_share = 70000 where id = $1`, [run.id]);
  const box = mailbox();
  await uk.daily(new Date('2026-09-29T10:30:00Z'), { send: box.send, start: recorder().start, quota: async () => ({ speaks: true, limit: 75000 }) });
  await uk.daily(new Date('2026-09-29T10:40:00Z'), { send: box.send, start: recorder().start, quota: async () => ({ speaks: true, limit: 75000 }) });
  assert.equal(box.got.filter((m) => /^Census stalled/.test(m.subject)).length, 1);
});

test('a net Places charge stops it and is e-mailed', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  await billed('2026-09-28', 'google-essentials', 0.02);
  const box = mailbox();
  const out = await uk.daily(new Date('2026-09-29T08:10:00Z'), { send: box.send, start: recorder().start, quota: async () => ({ speaks: true, limit: 75000 }) });
  assert.equal(out.action, 'halted');
  assert.ok(box.got.some((m) => /^Census stopped: Places cost/.test(m.subject)));
});

test('the weekly £ is the export\'s own days, each counted once', () => {
  const day = (n, date) => ({ day: n, date, requests: 70000, newPlaces: 100, billed: { placesNetGbp: 0.3, final: true } });
  const st = { days: [day(1, '2026-09-28'), day(2, '2026-09-29')], tilesLeft: 10, daysLeft: 3, dayRequests: 70000, complete: false };
  // Three London days, 10p each: the two quota days' figures overlap on the 29th.
  const bills = ['2026-09-28', '2026-09-29', '2026-09-30'].map((d) => ({ day: d, places_net_gbp: 0.1 }));
  const w = uk.weeklySummary(st, bills, new Date('2026-10-05T07:10:00Z'));
  assert.match(w.text, /£ spent \(Places, after credits\): £0\.30 over 3 billed days/);
  // A week with no census days still says what the export billed.
  const idle = uk.weeklySummary({ ...st, days: [] }, bills, new Date('2026-10-05T07:10:00Z'));
  assert.match(idle.text, /£ spent \(Places, after credits\): £0\.30 over 3 billed days/);
  assert.match(w.text, /Billing export: rows up to 2026-09-30/);
});

test('a day whose plan is being written is not a stall', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  await query(
    `insert into census_runs (label, areas, tile_lat, tile_lng, max_requests, rate_per_sec, fresh_days, state, problem, started_by, started_at, last_seen_at)
     values ('The rest of the UK — day 2', array['ZZ'], 0.08, 0.12, 70000, 5, 30, 'paused', 'built paused; plan written; resume to start', $1, '2026-09-28T23:00:00Z', '2026-09-29T11:55:00Z')`,
    [(await import('../src/sources/censusRun.js')).ONE_DAY_RUNS]);
  const box = mailbox();
  await uk.daily(new Date('2026-09-29T12:00:00Z'), { send: box.send, start: recorder().start, switchOn: async () => false, quota: async () => ({ speaks: true, limit: 75000 }) });
  assert.ok(!box.got.some((m) => /^Census stalled/.test(m.subject)), box.got.map((m) => m.subject).join(' | '));
});

test('a scheduler failure is one e-mail a day, whatever its words', async (t) => {
  await clean(); t.after(clean);
  await dayOne();
  const box = mailbox();
  let n = 0;
  const start = async () => { n += 1; throw new Error(`planning broke at tile ${n}`); };
  for (const at of ['2026-09-29T08:10:00Z', '2026-09-29T08:20:00Z', '2026-09-29T08:30:00Z']) {
    await uk.daily(new Date(at), { send: box.send, start, quota: async () => ({ speaks: true, limit: 75000 }) });
  }
  assert.deepEqual(box.got.map((m) => m.subject), ['Census failed on 2026-09-29']);
  assert.match(box.got[0].text, /planning broke at tile 1/);
});

test('the penny alarm and a Google refusal are each a failure, e-mailed once', async (t) => {
  await clean(); t.after(clean);
  const q = async () => ({ speaks: true, limit: 75000 });
  const run = await dayOne({ state: 'paused', started: '2026-09-29T07:05:00Z', finished: '2026-09-29T09:00:00Z',
    problem: 'stopped on the first penny: the census ledgered $0.0320, and IDs Only is free — something is asking Google for a field the census may not buy' });
  const box = mailbox();
  await uk.daily(new Date('2026-09-29T10:00:00Z'), { send: box.send, start: recorder().start, quota: q });
  await uk.daily(new Date('2026-09-29T10:10:00Z'), { send: box.send, start: recorder().start, quota: q });
  assert.equal(box.got.filter((m) => /^Census failed: day 1$/.test(m.subject)).length, 1);
  assert.match(box.got.find((m) => /^Census failed/.test(m.subject)).text, /first penny/);

  await clean();
  await dayOne({ state: 'waiting', started: '2026-09-29T07:05:00Z', finished: null });
  await query(`update census_runs set refused_at = '2026-09-29T09:00:00Z', refusal = '429 RESOURCE_EXHAUSTED' where label like 'The rest of the UK — day 1%'`);
  const box2 = mailbox();
  await uk.daily(new Date('2026-09-29T10:00:00Z'), { send: box2.send, start: recorder().start, quota: q });
  assert.ok(box2.got.some((m) => /^Census failed/.test(m.subject) && /429 RESOURCE_EXHAUSTED/.test(m.text)), box2.got.map((m) => m.subject).join(' | '));
  void run;
});

test('a run stopped for a person is not a missing day, day after day', async (t) => {
  await clean(); t.after(clean);
  await dayOne({ state: 'paused', started: '2026-09-29T07:05:00Z', finished: '2026-09-29T09:00:00Z',
    problem: 'stopped on the first penny: the census ledgered $0.0320, and IDs Only is free — something is asking Google for a field the census may not buy' });
  const box = mailbox();
  const r = recorder();
  for (const at of ['2026-09-30T12:00:00Z', '2026-10-01T12:00:00Z']) {
    const out = await uk.daily(new Date(at), { send: box.send, start: r.start, quota: async () => ({ speaks: true, limit: 75000 }) });
    assert.equal(out.action, 'stopped');
  }
  assert.equal(r.calls.length, 0);
  assert.ok(!box.got.some((m) => /^Census stalled/.test(m.subject)), box.got.map((m) => m.subject).join(' | '));
});
