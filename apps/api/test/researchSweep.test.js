/**
 * The research sweep — src/sources/researchSweep.js.
 *
 * What is pinned: the sample is twelve top and eight mid-tail from the
 * census; the price is for what will actually go out; nothing starts without
 * the request count the estimate reported; the work writes each place as it
 * goes and reads its cost off the ledger; the ceiling stops it with the rest
 * left pending; and a sweep whose process died is picked up with its in-air
 * places asked again.
 *
 * The research itself is stubbed — this is about the sweep, not about
 * Overpass — and so is the ceiling.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const sweep = await import('../src/sources/researchSweep.js');
const { setOffKeys } = await import('../src/sources/switches.js');

// Every test here that starts a sweep needs Google to be usable: the key is a
// gate only, since the research is stubbed and nothing goes out.
process.env.GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || 'test-key-never-sent';

const SUB = 'test-sweep-drawer';
const THIN = 'test-sweep-thin';
const refs = (n, prefix = 'google:ChIJ_sweep_') => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(3, '0')}`);

const HH = '00000000-0000-4000-8000-00000000c0de';

test.before(async () => {
  await query(`insert into households (id, name) values ($1, 'Sweep test household') on conflict (id) do nothing`, [HH]);
  await query("insert into shelf_categories (key, label) values ('test-cat', 'Test') on conflict do nothing");
  await query(`insert into shelf_subcategories (key, label, category_key) values ($1, 'Sweep drawer', 'test-cat'), ($2, 'Thin drawer', 'test-cat') on conflict do nothing`, [SUB, THIN]);
  await query(`delete from place_index where venue_ref like 'google:ChIJ_sweep_%' or venue_ref like 'google:ChIJ_thin_%'`);
  await query(`delete from place_records where venue_ref like 'google:ChIJ_sweep_%'`);
  // 120 census places, ranked by Google's own rank since none has a score.
  for (const [i, ref] of refs(120).entries()) {
    await query(`insert into place_index (venue_ref, subcategory, found_rank, first_seen) values ($1, $2, $3, now() - ($4 || ' minutes')::interval)`, [ref, SUB, i + 1, String(120 - i)]);
  }
  for (const [i, ref] of refs(30, 'google:ChIJ_thin_').entries()) {
    await query(`insert into place_index (venue_ref, subcategory, found_rank) values ($1, $2, $3)`, [ref, THIN, i + 1]);
  }
  // Two at the top already researched and identified by the current
  // researcher: they cost nothing, and `enrich` will skip them.
  for (const ref of refs(2)) {
    await query(`insert into place_records (venue_ref, enrich_state, provenance, enriched_at, research_version) values ($1, 'done', '{"name":"osm"}'::jsonb, now(), 3)
                 on conflict (venue_ref) do update set enrich_state = 'done', provenance = '{"name":"osm"}'::jsonb, enriched_at = now(), research_version = 3`, [ref]);
  }
  // Two more that *look* researched and are not: one by an older researcher,
  // one identified by nothing but a street address. `enrich` asks both again,
  // so the estimate must count both — a copy of the test counted them as free
  // and the sweep then paid for them (Codex, 25 Sep 2026).
  await query(`insert into place_records (venue_ref, enrich_state, provenance, enriched_at, research_version) values ($1, 'done', '{"name":"osm"}'::jsonb, now(), 1)
               on conflict (venue_ref) do update set enrich_state = 'done', provenance = '{"name":"osm"}'::jsonb, enriched_at = now(), research_version = 1`, [refs(3)[2]]);
  await query(`insert into place_records (venue_ref, enrich_state, provenance, enriched_at, research_version) values ($1, 'done', '{"address":"nominatim"}'::jsonb, now(), 3)
               on conflict (venue_ref) do update set enrich_state = 'done', provenance = '{"address":"nominatim"}'::jsonb, enriched_at = now(), research_version = 3`, [refs(4)[3]]);
});

test.after(async () => {
  await query(`delete from research_sweeps where subcategories ? $1`, [SUB]);
  await query(`delete from place_index where venue_ref like 'google:ChIJ_sweep_%' or venue_ref like 'google:ChIJ_thin_%'`);
  await query(`delete from place_records where venue_ref like 'google:ChIJ_sweep_%'`);
  await query(`delete from provider_calls where venue_ref like 'google:ChIJ_sweep_%'`);
  await query(`delete from spend_reservations where holder like 'sweep:%'`);
  await pool.end();
});

test('a drawer under the floor is not worth a set, and is not sampled', async () => {
  const d = await sweep.drawers({ subcategories: [SUB, THIN] });
  assert.deepEqual(d.map((x) => x.key), [SUB]);
  assert.equal(d[0].places, 120);
});

test('twelve from the top and eight from the mid-tail, by rank', async () => {
  const s = await sweep.sampleFor(SUB);
  assert.equal(s.length, 20);
  assert.equal(s.filter((x) => x.tier === 'top').length, 12);
  assert.deepEqual(s.slice(0, 12).map((x) => x.venue_ref), refs(12), 'the top twelve are the twelve best ranked');
  // The mid-tail comes from the 40th–80th percentile: ranks 49–96 of 120.
  for (const x of s.slice(12)) {
    const rank = Number(x.venue_ref.slice(-3)) + 1;
    assert.ok(rank >= 48 && rank <= 96, `${x.venue_ref} is mid-tail`);
  }
});

test('the price is for what will go out, at two requests a place, and says so', async () => {
  const e = await sweep.estimate({ subcategories: [SUB] });
  assert.equal(e.sampled, 20);
  assert.equal(e.held, 2, 'the two already researched cost nothing');
  assert.equal(e.asked, 18);
  assert.equal(e.requests, 36, 'the number to confirm with is the most it can cost');
  assert.ok(e.costGbpHigh > e.costGbpLow && e.costGbpLow > 0);
  assert.match(e.basis, /18 to ask/);
});

test('a sweep with places to ask does not start without Google', async () => {
  // A census place is an ID and nothing else; without Google every asked
  // place is "could not ask" and the sweep would finish having done none of
  // what it was confirmed for (Codex, 25 Sep 2026).
  setOffKeys(['google']);
  try {
    await assert.rejects(() => sweep.start({ subcategories: [SUB], confirm: 36, householdId: HH }), (e) => e.code === 'google_unavailable' && /switched off/.test(e.message));
  } finally { setOffKeys([]); }
});

test('nothing starts without the request count, or without a household', async () => {
  await assert.rejects(() => sweep.start({ subcategories: [SUB], confirm: 35, householdId: 'h' }), (e) => e.code === 'confirm_required' && e.plan?.requests === 36);
  await assert.rejects(() => sweep.start({ subcategories: [SUB], confirm: 36, householdId: null }), (e) => e.code === 'no_household');
});

test('the work writes each place as it goes, reads its cost off the ledger, and finishes', async () => {
  const hh = HH;
  const row = await sweep.start({ subcategories: [SUB], confirm: 36, householdId: hh, startedBy: 'test' });
  assert.equal(row.state, 'running');
  assert.equal(row.places, 20);

  // A second one may not start while this is running.
  await assert.rejects(() => sweep.start({ subcategories: [SUB], confirm: 36, householdId: hh }), (e) => e.code === 'already_running');

  const asked = [];
  const research = async (ref, opts) => {
    asked.push(ref);
    assert.equal(opts.paid, true, 'this is the paid exception, and it says so');
    assert.equal(opts.force, false, 'a fresh identified record is left alone');
    if (refs(2).includes(ref)) return { state: 'done', skipped: 'already researched', matched: {}, fields: {}, problems: [] };
    // One Place Details request on the ledger, attributed to the place.
    // No household on the ledger row: this test's household is a made-up id
    // and the ledger keys households for real. What is under test is that the
    // cost is read back by the place.
    await query(`insert into provider_calls (household_id, provider, purpose, estimated_cost_usd, venue_ref) values ($1, 'google', 'own.seed', 0.032, $2)`, [hh, ref]);
    // Somebody else's display search on the same place, in the same window,
    // is not the sweep's to book (Codex, 25 Sep 2026).
    await query(`insert into provider_calls (provider, purpose, estimated_cost_usd, venue_ref) values ('google', 'display', 0.04, $1)`, [ref]);
    // A description landed, and the record says so.
    await query(`insert into place_records (venue_ref, summary) values ($1, $2) on conflict (venue_ref) do update set summary = excluded.summary`, [ref, 'A lake with a boathouse and a jetty, and a tearoom open at weekends through the summer months.']);
    return { state: 'done', matched: { osm: {}, wikipedia: {} }, provenance: { summary: 'wikipedia' }, problems: [] };
  };
  const reservations = [];
  const room = async (pence, { holder }) => { reservations.push({ pence, holder }); return { ok: true, reservation: `r${reservations.length}`, leftPence: 10000 }; };
  const released = [];
  const done = await sweep.work(row.id, { research, room, release: async (id) => { released.push(id); } });

  assert.equal(done.state, 'done');
  assert.equal(asked.length, 20);
  assert.equal(reservations.length, 5, 'four at a time');
  assert.equal(released.length, 5, 'every reservation given back');
  assert.ok(reservations.every((r) => r.holder === `sweep:${row.id}`));
  // The first batch holds the two already-researched places, which cannot
  // spend, so it reserves for two rather than four (Codex, 25 Sep 2026).
  const perPlace = 2 * sweep.pencePerRequest();
  assert.equal(reservations[0].pence, Math.ceil(2 * perPlace));
  assert.ok(reservations.slice(1).every((r) => r.pence === Math.ceil(4 * perPlace)));

  const f = await sweep.funnelOf(row.id);
  assert.equal(f.sampled, 20);
  assert.equal(f.held, 2);
  assert.equal(f.asked, 18);
  assert.equal(f.identified, 20);
  assert.equal(f.described, 18, 'counted from the record, not the outcome');
  assert.equal(f.openMap, 18);
  assert.equal(f.pending, 0);
  assert.equal(Math.round(f.spentUsd * 1000) / 1000, Math.round(18 * 0.032 * 1000) / 1000, 'the cost is the ledger’s, not a guess');
  const by = await sweep.byDrawer(row.id);
  assert.equal(by[0].subcategory, SUB);
  assert.equal(by[0].described, 18);
  const listed = await sweep.places(row.id);
  assert.equal(listed.length, 20);
  assert.equal(listed.filter((p) => p.described).length, 18);
  assert.equal(listed[0].tier, 'top', 'top of the drawer first');
});

test('a place that never answers is given up on, and the sweep moves on', async () => {
  // Awaited directly, a research call that never settled held the whole
  // sweep — and the heartbeat kept saying it was fine (Codex, 25 Sep 2026).
  await query(`update research_sweeps set state = 'done' where subcategories ? $1 and state = 'running'`, [SUB]);
  const row = await sweep.start({ subcategories: [SUB], confirm: 36, householdId: HH });
  let calls = 0;
  const holders = [];
  const done = await sweep.work(row.id, {
    deadlineMs: 50,
    research: async (ref) => {
      calls += 1;
      if (calls === 3) return new Promise(() => {}); // never
      return { state: 'done', matched: {}, fields: {}, problems: [] };
    },
    room: async (pence, { holder }) => { holders.push({ pence, holder }); return { ok: true, reservation: holder, leftPence: 10000 }; },
    release: async () => {},
  });
  assert.equal(done.state, 'done');
  assert.equal(calls, 20, 'every place was still asked');
  // The stray call is covered by a hold taken after its batch's reservation
  // is released — not alongside it, which counted the same work twice — and
  // kept until it settles (Codex, 25 Sep 2026).
  const late = holders.filter((h) => h.holder === `sweep:${row.id}:late`);
  assert.equal(late.length, 1);
  assert.equal(late[0].pence, Math.ceil(2 * sweep.pencePerRequest()));
  const order = holders.map((h) => h.holder);
  assert.ok(order.indexOf(`sweep:${row.id}:late`) > order.indexOf(`sweep:${row.id}`), 'after the batch, not during it');
  const f = await sweep.funnelOf(row.id);
  assert.equal(f.failed, 1);
  const { rows: [hung] } = await query(`select outcome from research_sweep_places where sweep_id = $1 and state = 'failed'`, [row.id]);
  assert.match(hung.outcome.problems[0], /gave up after/);
});

test('a place that answers after its deadline still has its spend booked', async () => {
  // The research cannot be cancelled from the sweep, so a call that outlives
  // its deadline may go on to spend. What it cost is written to the place
  // when it finally settles (Codex, 25 Sep 2026).
  await query(`update research_sweeps set state = 'done' where subcategories ? $1 and state = 'running'`, [SUB]);
  const row = await sweep.start({ subcategories: [SUB], confirm: 36, householdId: HH });
  const released = [];
  let lateRef = null;
  let settled;
  const settledLate = new Promise((r) => { settled = r; });
  const done = await sweep.work(row.id, {
    deadlineMs: 30,
    research: async (ref) => {
      if (!lateRef) {
        lateRef = ref;
        // Answers well after the deadline, having spent on the way.
        return new Promise((resolve) => setTimeout(async () => {
          await query(`insert into provider_calls (household_id, provider, purpose, estimated_cost_usd, venue_ref) values ($1, 'google', 'own.seed', 0.032, $2)`, [HH, ref]);
          resolve({ state: 'done', matched: { osm: {} }, fields: {}, problems: [] });
          setTimeout(settled, 100);
        }, 120));
      }
      return { state: 'done', matched: {}, fields: {}, problems: [] };
    },
    room: async (_pence, { holder }) => ({ ok: true, reservation: holder, leftPence: 10000 }),
    release: async (r) => { released.push(r); },
  });
  assert.equal(done.state, 'done');
  await settledLate;
  assert.ok(released.includes(`sweep:${row.id}:late`), 'the stray’s reservation is given back once it settles');
  const { rows: [p] } = await query(`select state, outcome, cost_usd from research_sweep_places where sweep_id = $1 and venue_ref = $2`, [row.id, lateRef]);
  assert.equal(p.state, 'failed', 'it was given up on at the time');
  assert.equal(p.outcome.late, true, 'and its answer was written when it came');
  assert.equal(Math.round(Number(p.cost_usd) * 1000) / 1000, 0.032, 'the money it spent afterwards is on the sweep');
});

test('over the ceiling stops with the rest left pending, and does not pretend', async () => {
  await query(`update research_sweeps set state = 'done' where subcategories ? $1 and state = 'running'`, [SUB]);
  const hh = HH;
  const row = await sweep.start({ subcategories: [SUB], confirm: 36, householdId: hh });
  const done = await sweep.work(row.id, {
    research: async () => { throw new Error('should not be asked'); },
    room: async () => ({ ok: false, reservation: null, leftPence: 120 }),
    release: async () => {},
  });
  assert.equal(done.state, 'failed');
  assert.match(done.problem, /ceiling/);
  const f = await sweep.funnelOf(row.id);
  assert.equal(f.pending, 20, 'nothing was asked and nothing is in the air');
  assert.equal(f.asking, 0);
});

test('a place asked again after a deploy is costed from its first attempt', async () => {
  await query(`update research_sweeps set state = 'done' where subcategories ? $1 and state = 'running'`, [SUB]);
  const hh = HH;
  const row = await sweep.start({ subcategories: [SUB], confirm: 36, householdId: hh });
  // The process died after the first place's request was on the ledger and
  // before its row was written. Everything else is done already.
  //
  // Chosen deterministically, and its ledger cleared first: picked with a
  // bare `limit 1` this sometimes landed on a place an earlier test had
  // already costed, and the assertion below counted that row too — green
  // alone, red in the suite (25 Sep 2026).
  const hit = refs(1)[0];
  await query('delete from provider_calls where venue_ref = $1', [hit]);
  await query(`update research_sweep_places set state = 'done', outcome = '{"state":"done"}'::jsonb where sweep_id = $1 and venue_ref <> $2`, [row.id, hit]);
  await query(`update research_sweep_places set state = 'asking', attempted_at = now() - interval '2 minutes' where sweep_id = $1 and venue_ref = $2`, [row.id, hit]);
  await query(`insert into provider_calls (household_id, provider, purpose, estimated_cost_usd, venue_ref, created_at) values ($1, 'google', 'own.seed', 0.032, $2, now() - interval '1 minute')`, [hh, hit]);
  await query(`update research_sweeps set touched_at = now() - interval '1 hour' where id = $1`, [row.id]);

  await sweep.resume({ work: async () => {} });
  const done = await sweep.work(row.id, {
    research: async (ref) => {
      // The second attempt buys its request again.
      await query(`insert into provider_calls (household_id, provider, purpose, estimated_cost_usd, venue_ref) values ($1, 'google', 'own.seed', 0.032, $2)`, [hh, ref]);
      return { state: 'done', matched: {}, fields: {}, problems: [] };
    },
    room: async () => ({ ok: true, reservation: 'r', leftPence: 10000 }),
    release: async () => {},
  });
  assert.equal(done.state, 'done');
  const { rows: [p] } = await query(`select cost_usd from research_sweep_places where sweep_id = $1 and venue_ref = $2`, [row.id, hit]);
  assert.equal(Math.round(Number(p.cost_usd) * 1000) / 1000, 0.064, 'both attempts are the sweep’s spend');
});

test('when the ceiling cannot cover a stray call, nothing more starts', async () => {
  await query(`update research_sweeps set state = 'done' where subcategories ? $1 and state = 'running'`, [SUB]);
  const row = await sweep.start({ subcategories: [SUB], confirm: 36, householdId: HH });
  let calls = 0;
  const done = await sweep.work(row.id, {
    deadlineMs: 30,
    research: async () => { calls += 1; if (calls === 1) return new Promise(() => {}); return { state: 'done', matched: {}, fields: {}, problems: [] }; },
    // Room for the batches, none for a stray.
    room: async (_pence, { holder }) => (holder.endsWith(':late') ? { ok: false, reservation: null, leftPence: 3 } : { ok: true, reservation: holder, leftPence: 10000 }),
    release: async () => {},
  });
  assert.equal(done.state, 'failed');
  assert.match(done.problem, /ceiling.*slow place/);
  assert.equal(calls, 4, 'the batch it was in finished; no further batch began');
  const f = await sweep.funnelOf(row.id);
  assert.equal(f.pending, 16);
});

test('a place that throws after its deadline still has its spend booked', async () => {
  // The rejection path did nothing, so a request ledgered after the deadline
  // read at the deadline was never booked to the place (Codex, 25 Sep 2026).
  await query(`update research_sweeps set state = 'done' where subcategories ? $1 and state = 'running'`, [SUB]);
  const row = await sweep.start({ subcategories: [SUB], confirm: 36, householdId: HH });
  let lateRef = null;
  let settled;
  const settledLate = new Promise((r) => { settled = r; });
  const done = await sweep.work(row.id, {
    deadlineMs: 30,
    research: async (ref) => {
      if (!lateRef) {
        lateRef = ref;
        return new Promise((_, reject) => setTimeout(async () => {
          await query(`insert into provider_calls (household_id, provider, purpose, estimated_cost_usd, venue_ref) values ($1, 'google', 'own.seed', 0.032, $2)`, [HH, ref]);
          reject(new Error('their website did not answer'));
          setTimeout(settled, 100);
        }, 120));
      }
      return { state: 'done', matched: {}, fields: {}, problems: [] };
    },
    room: async () => ({ ok: true, reservation: 'r', leftPence: 10000 }),
    release: async () => {},
  });
  assert.equal(done.state, 'done');
  await settledLate;
  const { rows: [p] } = await query(`select state, outcome, cost_usd from research_sweep_places where sweep_id = $1 and venue_ref = $2`, [row.id, lateRef]);
  assert.equal(p.state, 'failed');
  assert.equal(p.outcome.late, true);
  assert.match(p.outcome.problems.join(' '), /gave up after.*did not answer/);
  assert.equal(Math.round(Number(p.cost_usd) * 1000) / 1000, 0.032, 'spent after the deadline, and still the sweep’s');
});

test('a sweep whose process died is picked up, and its in-air places asked again', async () => {
  await query(`update research_sweeps set state = 'done' where subcategories ? $1 and state = 'running'`, [SUB]);
  const hh = HH;
  const row = await sweep.start({ subcategories: [SUB], confirm: 36, householdId: hh });
  // Two were in the air, and nobody has heard from the sweep for a while.
  await query(`update research_sweep_places set state = 'asking' where sweep_id = $1 and venue_ref = any($2)`, [row.id, refs(2)]);
  await query(`update research_sweeps set touched_at = now() - interval '1 hour' where id = $1`, [row.id]);

  // And the reservation the dead process held.
  await query(`insert into spend_reservations (pence, holder) values (20, $1)`, [`sweep:${row.id}`]);
  const picked = [];
  const r = await sweep.resume({ work: async (id) => { picked.push(id); } });
  const { rows: held } = await query('select 1 from spend_reservations where holder = $1', [`sweep:${row.id}`]);
  assert.equal(held.length, 0, 'the stale reservation is given back before the work restarts');
  assert.equal(r.resumed, 1);
  assert.deepEqual(picked, [row.id]);
  const f = await sweep.funnelOf(row.id);
  assert.equal(f.asking, 0, 'back to pending, to be asked again');
  assert.equal(f.pending, 20);

  // A sweep that is still heartbeating is not stranded.
  await query(`update research_sweeps set touched_at = now() where id = $1`, [row.id]);
  assert.equal((await sweep.resume({ work: async () => {} })).resumed, 0);
  await query(`update research_sweeps set state = 'done' where id = $1`, [row.id]);
});
