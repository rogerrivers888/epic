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
  // Three open-map places in the mid-tail: no Google request to identify
  // them, so they are researched free and are no reason to stop when Google
  // is off (Codex, 25 Sep 2026).
  await query(`delete from place_index where venue_ref like 'osm:node/sweep_%'`);
  //
  // Placed where the sampler's mid-tail picks fall: with 123 places the
  // window is indices 49–98 and the eight picks are every 6.125 from 49, so
  // ranks 56, 73 and 90 — each sorted ahead of the Google place sharing its
  // rank by an earlier first_seen, and each shifted by the open-map rows
  // before it — land on picks 55, 73 and 91.
  for (const [ref, rank] of [['osm:node/sweep_a', 56], ['osm:node/sweep_b', 73], ['osm:node/sweep_c', 90]]) {
    await query(`insert into place_index (venue_ref, subcategory, found_rank, first_seen) values ($1, $2, $3, now() - interval '400 minutes')`, [ref, SUB, rank]);
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
  await query(`delete from place_index where venue_ref like 'google:ChIJ_sweep_%' or venue_ref like 'google:ChIJ_thin_%' or venue_ref like 'osm:node/sweep_%'`);
  await query(`delete from place_records where venue_ref like 'google:ChIJ_sweep_%'`);
  await query(`delete from provider_calls where venue_ref like 'google:ChIJ_sweep_%'`);
  await query(`delete from spend_reservations where holder like 'sweep:%'`);
  await pool.end();
});

test('a drawer under the floor is not worth a set, and is not sampled', async () => {
  const d = await sweep.drawers({ subcategories: [SUB, THIN] });
  assert.deepEqual(d.map((x) => x.key), [SUB]);
  assert.equal(d[0].places, 123, '120 from Google and three from the open map');
});

test('twelve from the top and eight from the mid-tail, by rank', async () => {
  const s = await sweep.sampleFor(SUB);
  assert.equal(s.length, 20);
  assert.equal(s.filter((x) => x.tier === 'top').length, 12);
  assert.deepEqual(s.slice(0, 12).map((x) => x.venue_ref), refs(12), 'the top twelve are the twelve best ranked');
  // The mid-tail comes from the 40th–80th percentile: indices 49–98 of 123,
  // which is Google ranks 49–96 and the three open-map places set among them.
  for (const x of s.slice(12)) {
    if (x.venue_ref.startsWith('osm:')) continue;
    const rank = Number(x.venue_ref.slice(-3)) + 1;
    assert.ok(rank >= 48 && rank <= 96, `${x.venue_ref} is mid-tail`);
  }
  assert.equal(s.filter((x) => x.venue_ref.startsWith('osm:')).length, 3);
});

test('the price is for what will go out, at two requests a Google place, and says so', async () => {
  const e = await sweep.estimate({ subcategories: [SUB] });
  assert.equal(e.sampled, 20);
  assert.equal(e.held, 2, 'the two already researched cost nothing');
  // The open-map places in the sample are researched free: not priced, not
  // reserved for, and not a reason to need Google.
  const osmInSample = e.drawers[0].sample.filter((s) => s.venue_ref.startsWith('osm:')).length;
  assert.equal(osmInSample, 3, 'the mid-tail reaches all three open-map places');
  assert.equal(e.free, osmInSample);
  assert.equal(e.asked, 18 - osmInSample);
  assert.equal(e.requests, e.asked * 2, 'the number to confirm with is the most it can cost');
  assert.ok(e.costGbpHigh > e.costGbpLow && e.costGbpLow > 0);
  assert.match(e.basis, new RegExp(`${e.asked} to ask Google`));
  assert.match(e.basis, new RegExp(`${e.free} researched free`));
  // And the sample it priced is the one `start` will write down.
  assert.equal(e.drawers[0].sample.length, 20);
});

test('a sweep with places to ask does not start without Google', async () => {
  // A census place is an ID and nothing else; without Google every asked
  // place is "could not ask" and the sweep would finish having done none of
  // what it was confirmed for (Codex, 25 Sep 2026).
  setOffKeys(['google']);
  try {
    const need = (await sweep.estimate({ subcategories: [SUB] })).requests;
    await assert.rejects(() => sweep.start({ subcategories: [SUB], confirm: need, householdId: HH }), (e) => e.code === 'google_unavailable' && /switched off/.test(e.message));
  } finally { setOffKeys([]); }
});

test('nothing starts without the request count, or without a household', async () => {
  await assert.rejects(() => sweep.start({ subcategories: [SUB], confirm: 1, householdId: 'h' }), (e) => e.code === 'confirm_required' && e.plan?.requests > 1);
  const need = (await sweep.estimate({ subcategories: [SUB] })).requests;
  await assert.rejects(() => sweep.start({ subcategories: [SUB], confirm: need, householdId: null }), (e) => e.code === 'no_household');
});

test('the work writes each place as it goes, reads its cost off the ledger, and finishes', async () => {
  const hh = HH;
  const row = await sweep.start({ subcategories: [SUB], confirm: (await sweep.estimate({ subcategories: [SUB] })).requests, householdId: hh, startedBy: 'test' });
  assert.equal(row.state, 'running');
  assert.equal(row.places, 20);

  // A second one may not start while this is running.
  const need = (await sweep.estimate({ subcategories: [SUB] })).requests;
  await assert.rejects(() => sweep.start({ subcategories: [SUB], confirm: need, householdId: hh }), (e) => e.code === 'already_running');

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
  // spend, so it reserves for two rather than four (Codex, 25 Sep 2026); and
  // an open-map place in a later batch is not reserved for either. Over the
  // sweep the reservations add up to exactly the Google places asked.
  const perPlace = 2 * sweep.pencePerRequest();
  assert.equal(reservations[0].pence, Math.ceil(2 * perPlace));
  const plan = await sweep.estimate({ subcategories: [SUB] });
  const reservedFor = reservations.reduce((n, r) => n + r.pence, 0);
  assert.ok(Math.abs(reservedFor - plan.asked * perPlace) < 5, `reserved ${reservedFor}p for ${plan.asked} Google places`);

  const f = await sweep.funnelOf(row.id);
  assert.equal(f.sampled, 20);
  assert.equal(f.held, 2);
  assert.equal(f.asked, 18, 'asked of somebody — the open-map ones of the open map');
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
  const row = await sweep.start({ subcategories: [SUB], confirm: (await sweep.estimate({ subcategories: [SUB] })).requests, householdId: HH });
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
  // The stray call is covered by its batch's own reservation, which is kept
  // until it settles rather than released and taken again (Codex, 25 Sep
  // 2026, twice): no second hold, and no gap.
  assert.equal(holders.filter((h) => h.holder !== `sweep:${row.id}`).length, 0, 'no separate late hold');
  assert.equal(holders.length, 5, 'one reservation a batch, as before');
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
  const row = await sweep.start({ subcategories: [SUB], confirm: (await sweep.estimate({ subcategories: [SUB] })).requests, householdId: HH });
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
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(released.includes(`sweep:${row.id}`), 'the batch’s reservation is given back once its stray settles');
  const { rows: [p] } = await query(`select state, outcome, cost_usd from research_sweep_places where sweep_id = $1 and venue_ref = $2`, [row.id, lateRef]);
  assert.equal(p.state, 'failed', 'it was given up on at the time');
  assert.equal(p.outcome.late, true, 'and its answer was written when it came');
  assert.equal(Math.round(Number(p.cost_usd) * 1000) / 1000, 0.032, 'the money it spent afterwards is on the sweep');
});

test('over the ceiling stops with the rest left pending, and does not pretend', async () => {
  await query(`update research_sweeps set state = 'done' where subcategories ? $1 and state = 'running'`, [SUB]);
  const hh = HH;
  const row = await sweep.start({ subcategories: [SUB], confirm: (await sweep.estimate({ subcategories: [SUB] })).requests, householdId: hh });
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
  const row = await sweep.start({ subcategories: [SUB], confirm: (await sweep.estimate({ subcategories: [SUB] })).requests, householdId: hh });
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

test('Google switched off mid-sweep stops it before the next batch, with the rest left as they were', async () => {
  // `start` checks Google once. Switched off afterwards, `enrich` cannot
  // identify a bare census ID and the worker would have drained the sample
  // marking rows done that were never researched (Codex, 25 Sep 2026).
  await query(`update research_sweeps set state = 'done' where subcategories ? $1 and state = 'running'`, [SUB]);
  const row = await sweep.start({ subcategories: [SUB], confirm: (await sweep.estimate({ subcategories: [SUB] })).requests, householdId: HH });
  let calls = 0;
  const done = await sweep.work(row.id, {
    research: async () => { calls += 1; if (calls === 4) setOffKeys(['google']); return { state: 'done', matched: {}, fields: {}, problems: [] }; },
    room: async (_p, { holder }) => ({ ok: true, reservation: holder, leftPence: 10000 }),
    release: async () => {},
  });
  setOffKeys([]);
  assert.equal(done.state, 'failed');
  assert.match(done.problem, /switched off/);
  assert.equal(calls, 4, 'the batch in hand finished; no new batch was claimed');
  const f = await sweep.funnelOf(row.id);
  assert.equal(f.pending, 16);
  assert.equal(f.asking, 0);
});

test('a sweep with only held places left finishes without Google', async () => {
  await query(`update research_sweeps set state = 'done' where subcategories ? $1 and state = 'running'`, [SUB]);
  const row = await sweep.start({ subcategories: [SUB], confirm: (await sweep.estimate({ subcategories: [SUB] })).requests, householdId: HH });
  // Everything but the two held places is done already; the two need no
  // request, so a switched-off Google is no reason to stop.
  await query(`update research_sweep_places set state = 'done', outcome = '{"state":"done"}'::jsonb where sweep_id = $1 and venue_ref <> all($2)`, [row.id, refs(2)]);
  setOffKeys(['google']);
  try {
    const done = await sweep.work(row.id, {
      research: async () => ({ state: 'done', skipped: 'already researched', matched: {}, fields: {}, problems: [] }),
      room: async (_p, { holder }) => ({ ok: true, reservation: holder, leftPence: 10000 }),
      release: async () => {},
    });
    assert.equal(done.state, 'done');
  } finally { setOffKeys([]); }
});

test('open-map places left in a sweep are researched with Google off', async () => {
  await query(`update research_sweeps set state = 'done' where subcategories ? $1 and state = 'running'`, [SUB]);
  const row = await sweep.start({ subcategories: [SUB], confirm: (await sweep.estimate({ subcategories: [SUB] })).requests, householdId: HH });
  // Everything Google-backed is done; only the open-map places remain.
  await query(`update research_sweep_places set state = 'done', outcome = '{"state":"done"}'::jsonb where sweep_id = $1 and venue_ref like 'google:%'`, [row.id]);
  const { rows: left } = await query(`select venue_ref from research_sweep_places where sweep_id = $1 and state = 'pending'`, [row.id]);
  assert.ok(left.length >= 1 && left.every((r) => r.venue_ref.startsWith('osm:')));
  setOffKeys(['google']);
  const asked = [];
  try {
    const done = await sweep.work(row.id, {
      research: async (ref) => { asked.push(ref); return { state: 'done', matched: { osm: {} }, fields: {}, problems: [] }; },
      room: async (pence, { holder }) => { assert.equal(pence, 0, 'nothing to reserve for the open map'); return { ok: true, reservation: holder, leftPence: 0 }; },
      release: async () => {},
    });
    assert.equal(done.state, 'done');
    assert.equal(asked.length, left.length);
  } finally { setOffKeys([]); }
});

test('a place that throws after its deadline still has its spend booked', async () => {
  // The rejection path did nothing, so a request ledgered after the deadline
  // read at the deadline was never booked to the place (Codex, 25 Sep 2026).
  await query(`update research_sweeps set state = 'done' where subcategories ? $1 and state = 'running'`, [SUB]);
  const row = await sweep.start({ subcategories: [SUB], confirm: (await sweep.estimate({ subcategories: [SUB] })).requests, householdId: HH });
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
  const row = await sweep.start({ subcategories: [SUB], confirm: (await sweep.estimate({ subcategories: [SUB] })).requests, householdId: hh });
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

test('a finished sweep\u2019s failures can be asked again, seeded from the record, and nothing is bought twice', async () => {
  await query(`update research_sweeps set state = 'done' where subcategories ? $1 and state = 'running'`, [SUB]);
  const need = (await sweep.estimate({ subcategories: [SUB] })).requests;
  const row = await sweep.start({ subcategories: [SUB], confirm: need, householdId: HH });
  // Everything done but three, which failed the way Overpass fails.
  await query(`update research_sweep_places set state = 'done', outcome = '{"state":"done"}'::jsonb where sweep_id = $1`, [row.id]);
  const failed = refs(3, 'google:ChIJ_sweep_0').map((r) => r.replace('_0', '_0').slice(0, 25) + r.slice(-2));
  const { rows: three } = await query(`select venue_ref from research_sweep_places where sweep_id = $1 order by venue_ref limit 3`, [row.id]);
  await query(`update research_sweep_places set state = 'failed', outcome = '{"state":"failed","problems":["OpenStreetMap: timeout"]}'::jsonb where sweep_id = $1 and venue_ref = any($2)`, [row.id, three.map((r) => r.venue_ref)]);
  await query(`update research_sweeps set state = 'done', finished_at = now() where id = $1`, [row.id]);
  // They have records with a name and a point from the first go.
  for (const r of three) await query(`insert into place_records (venue_ref, name, lat, lng) values ($1, 'Known', 51.5, -0.6) on conflict (venue_ref) do update set name = 'Known', lat = 51.5, lng = -0.6`, [r.venue_ref]);

  const reopened = await sweep.retryFailed(row.id, { confirm: (await sweep.retryEstimate(row.id)).requests });
  assert.equal(reopened.retried, 3);
  assert.equal(reopened.state, 'running');
  const seeds = [];
  const done = await sweep.work(row.id, {
    research: async (ref, opts) => { seeds.push(ref); return { state: 'done', matched: { osm: {} }, fields: {}, problems: [] }; },
    room: async (_p, { holder }) => ({ ok: true, reservation: holder, leftPence: 10000 }),
    release: async () => {},
  });
  assert.equal(done.state, 'done');
  assert.deepEqual(seeds.sort(), three.map((r) => r.venue_ref).sort(), 'only the three failed were asked again');
  const f = await sweep.funnelOf(row.id);
  assert.equal(f.failed, 0);
  const { rows: [again] } = await query(`select outcome from research_sweep_places where sweep_id = $1 and venue_ref = $2`, [row.id, three[0].venue_ref]);
  assert.equal(again.outcome.retried, true, 'the row says it was asked twice');
  // And the sample sweep's research now seeds from the record, so a retry
  // does not buy the place back: the seed a real run would pass is the
  // record's own.
  void failed;
});

test('a place still in flight at its deadline is not asked again until its answer lands', async () => {
  await query(`update research_sweeps set state = 'done' where subcategories ? $1 and state = 'running'`, [SUB]);
  const need = (await sweep.estimate({ subcategories: [SUB] })).requests;
  const row = await sweep.start({ subcategories: [SUB], confirm: need, householdId: HH });
  const { rows: two } = await query(`select venue_ref from research_sweep_places where sweep_id = $1 order by venue_ref limit 2`, [row.id]);
  await query(`update research_sweep_places set state = 'done', outcome = '{"state":"done"}'::jsonb where sweep_id = $1`, [row.id]);
  // One gave up at its deadline and has not settled; one gave up and then did.
  await query(`update research_sweep_places set state = 'failed', outcome = '{"state":"failed","problems":["gave up after 120s"]}'::jsonb where sweep_id = $1 and venue_ref = $2`, [row.id, two[0].venue_ref]);
  await query(`update research_sweep_places set state = 'failed', outcome = '{"state":"failed","late":true,"problems":["gave up after 120s","their website did not answer"]}'::jsonb where sweep_id = $1 and venue_ref = $2`, [row.id, two[1].venue_ref]);
  await query(`update research_sweeps set state = 'done', finished_at = now() where id = $1`, [row.id]);
  const reopened = await sweep.retryFailed(row.id, { confirm: (await sweep.retryEstimate(row.id)).requests });
  assert.equal(reopened.retried, 1, 'only the settled one');
  const { rows } = await query(`select venue_ref, state from research_sweep_places where sweep_id = $1 and venue_ref = any($2) order by venue_ref`, [row.id, two.map((r) => r.venue_ref)]);
  assert.deepEqual(rows.map((r) => r.state), ['failed', 'pending']);
  // An hour on, nothing can still be holding the other one — its process is
  // gone or its promise never settled — and it is not stranded for ever
  // (Codex, 25 Sep 2026).
  await query(`update research_sweeps set state = 'done', finished_at = now() where id = $1`, [row.id]);
  await query(`update research_sweep_places set state = 'failed' where sweep_id = $1 and venue_ref = $2`, [row.id, two[1].venue_ref]);
  await query(`update research_sweep_places set attempted_at = now() - interval '1 hour' where sweep_id = $1 and venue_ref = $2`, [row.id, two[0].venue_ref]);
  const later = await sweep.retryEstimate(row.id);
  assert.ok(later.refs.includes(two[0].venue_ref), 'an orphaned stray is retryable once its reservation has long expired');
  await query(`update research_sweeps set state = 'done' where id = $1`, [row.id]);
});

test('a retry of a seeded place needs no Google and reserves nothing', async () => {
  // The retried place has a name, a point and a website on its record, so a
  // switched-off Google is no reason to stop, and nothing is reserved for it
  // (Codex, 25 Sep 2026).
  await query(`update research_sweeps set state = 'done' where subcategories ? $1 and state = 'running'`, [SUB]);
  const need = (await sweep.estimate({ subcategories: [SUB] })).requests;
  const row = await sweep.start({ subcategories: [SUB], confirm: need, householdId: HH });
  const { rows: [one] } = await query(`select venue_ref from research_sweep_places where sweep_id = $1 and venue_ref like 'google:%' order by venue_ref limit 1`, [row.id]);
  await query(`update research_sweep_places set state = 'done', outcome = '{"state":"done"}'::jsonb where sweep_id = $1 and venue_ref <> $2`, [row.id, one.venue_ref]);
  await query(`update research_sweep_places set state = 'failed', outcome = '{"state":"failed","problems":["OpenStreetMap: timeout"]}'::jsonb where sweep_id = $1 and venue_ref = $2`, [row.id, one.venue_ref]);
  await query(`insert into place_records (venue_ref, name, lat, lng, website) values ($1, 'Known', 51.5, -0.6, 'https://known.example') on conflict (venue_ref) do update set name = 'Known', lat = 51.5, lng = -0.6, website = 'https://known.example', enrich_state = 'failed'`, [one.venue_ref]);
  await query(`update research_sweeps set state = 'done', finished_at = now() where id = $1`, [row.id]);
  await sweep.retryFailed(row.id, { confirm: (await sweep.retryEstimate(row.id)).requests });
  setOffKeys(['google']);
  const holds = [];
  try {
    const done = await sweep.work(row.id, {
      research: async () => ({ state: 'done', matched: { osm: {} }, fields: {}, problems: [] }),
      room: async (pence, { holder }) => { holds.push(pence); return { ok: true, reservation: holder, leftPence: 0 }; },
      release: async () => {},
    });
    assert.equal(done.state, 'done');
    assert.deepEqual(holds, [0], 'nothing reserved for a place we can seed');
  } finally { setOffKeys([]); }
});

test('a retry that could spend is confirmed with its number, like the sweep it reopens', async () => {
  await query(`update research_sweeps set state = 'done' where subcategories ? $1 and state = 'running'`, [SUB]);
  const need = (await sweep.estimate({ subcategories: [SUB] })).requests;
  const row = await sweep.start({ subcategories: [SUB], confirm: need, householdId: HH });
  const { rows: [one] } = await query(`select venue_ref from research_sweep_places where sweep_id = $1 and venue_ref like 'google:%' order by venue_ref desc limit 1`, [row.id]);
  await query(`update research_sweep_places set state = 'done', outcome = '{"state":"done"}'::jsonb where sweep_id = $1 and venue_ref <> $2`, [row.id, one.venue_ref]);
  await query(`update research_sweep_places set state = 'failed', outcome = '{"state":"failed","problems":["Google Places 503"]}'::jsonb where sweep_id = $1 and venue_ref = $2`, [row.id, one.venue_ref]);
  // Never identified: two requests to retry, which the caller has to have seen.
  await query('delete from place_records where venue_ref = $1', [one.venue_ref]);
  await query(`update research_sweeps set state = 'done', finished_at = now() where id = $1`, [row.id]);
  const e = await sweep.retryEstimate(row.id);
  assert.equal(e.places, 1);
  assert.equal(e.requests, 2);
  await assert.rejects(() => sweep.retryFailed(row.id), (x) => x.code === 'confirm_required' && x.plan.requests === 2);
  await assert.rejects(() => sweep.retryFailed(row.id, { confirm: 1 }), (x) => x.code === 'confirm_required');
  const reopened = await sweep.retryFailed(row.id, { confirm: 2 });
  assert.equal(reopened.retried, 1);
  await query(`update research_sweeps set state = 'done' where id = $1`, [row.id]);
});

test('reopening a sweep that stopped short prices what it never reached as well as what failed', async () => {
  await query(`update research_sweeps set state = 'done' where subcategories ? $1 and state = 'running'`, [SUB]);
  const need = (await sweep.estimate({ subcategories: [SUB] })).requests;
  const row = await sweep.start({ subcategories: [SUB], confirm: need, householdId: HH });
  const { rows: refsHere } = await query(`select venue_ref from research_sweep_places where sweep_id = $1 and venue_ref like 'google:%' order by venue_ref`, [row.id]);
  // Stopped at the ceiling: two done, one failed, one still in the air, the rest never reached.
  await query(`update research_sweep_places set state = 'done', outcome = '{"state":"done"}'::jsonb where sweep_id = $1 and venue_ref = any($2)`, [row.id, refsHere.slice(0, 2).map((r) => r.venue_ref)]);
  await query(`update research_sweep_places set state = 'failed', outcome = '{"state":"failed","problems":["OpenStreetMap: timeout"]}'::jsonb where sweep_id = $1 and venue_ref = $2`, [row.id, refsHere[2].venue_ref]);
  await query(`update research_sweep_places set state = 'asking' where sweep_id = $1 and venue_ref = $2`, [row.id, refsHere[3].venue_ref]);
  await query(`update research_sweeps set state = 'failed', problem = 'over this month\u2019s ceiling', finished_at = now() where id = $1`, [row.id]);
  const e = await sweep.retryEstimate(row.id);
  const { rows: [{ n }] } = await query(`select count(*)::int n from research_sweep_places where sweep_id = $1 and state <> 'done'`, [row.id]);
  assert.equal(e.places, n, 'every row the sweep would work is in the plan');
  const reopened = await sweep.retryFailed(row.id, { confirm: e.requests });
  assert.equal(reopened.retried, n);
  const { rows: states } = await query(`select state, count(*)::int n from research_sweep_places where sweep_id = $1 group by state order by state`, [row.id]);
  assert.deepEqual(states, [{ state: 'done', n: 2 }, { state: 'pending', n }], 'nothing left in the air');
  await query(`update research_sweeps set state = 'done' where id = $1`, [row.id]);
});

test('a retry prices a held sample place at nothing, since the worker will skip it', async () => {
  await query(`update research_sweeps set state = 'done' where subcategories ? $1 and state = 'running'`, [SUB]);
  const need = (await sweep.estimate({ subcategories: [SUB] })).requests;
  const row = await sweep.start({ subcategories: [SUB], confirm: need, householdId: HH });
  await query(`update research_sweep_places set state = 'done', outcome = '{"state":"done"}'::jsonb where sweep_id = $1`, [row.id]);
  // Given up on, then its late answer landed and identified it — fresh,
  // identified, no website: `enrich` skips it, so the retry must not price
  // the page lead the record would otherwise imply.
  const [held] = refs(1);
  await query(`update research_sweep_places set state = 'failed', outcome = '{"state":"failed","late":true,"problems":["gave up after 120s"]}'::jsonb where sweep_id = $1 and venue_ref = $2`, [row.id, held]);
  await query(`update place_records set website = null, enrich_state = 'done', provenance = '{"name":"osm"}'::jsonb, enriched_at = now(), research_version = 3 where venue_ref = $1`, [held]);
  await query(`update research_sweeps set state = 'done', finished_at = now() where id = $1`, [row.id]);
  const e = await sweep.retryEstimate(row.id);
  assert.deepEqual(e.refs, [held]);
  assert.equal(e.requests, 0);
  await query(`update research_sweeps set state = 'done' where id = $1`, [row.id]);
});

test('a late answer from an earlier go does not overwrite the retry\u2019s', async () => {
  // The stray's promise cannot be cancelled; retried while it is still slow,
  // its answer must land on nothing (Codex, 25 Sep 2026).
  await query(`update research_sweeps set state = 'done' where subcategories ? $1 and state = 'running'`, [SUB]);
  const need = (await sweep.estimate({ subcategories: [SUB] })).requests;
  const row = await sweep.start({ subcategories: [SUB], confirm: need, householdId: HH });
  let lateRef = null;
  let settleLate;
  const done = await sweep.work(row.id, {
    deadlineMs: 30,
    research: async (ref) => {
      if (!lateRef) { lateRef = ref; return new Promise((resolve) => { settleLate = resolve; }); }
      return { state: 'done', matched: {}, fields: {}, problems: [] };
    },
    room: async (_p, { holder }) => ({ ok: true, reservation: holder, leftPence: 10000 }),
    release: async () => {},
  });
  assert.equal(done.state, 'done');
  const { rows: [first] } = await query(`select outcome from research_sweep_places where sweep_id = $1 and venue_ref = $2`, [row.id, lateRef]);
  assert.equal(first.outcome.attempt, 1);
  // Retried (an hour on, so it counts as orphaned), and the second go answers.
  await query(`update research_sweep_places set attempted_at = now() - interval '1 hour' where sweep_id = $1 and venue_ref = $2`, [row.id, lateRef]);
  await sweep.retryFailed(row.id, { confirm: (await sweep.retryEstimate(row.id)).requests });
  const again = await sweep.work(row.id, {
    research: async () => ({ state: 'done', matched: { osm: {} }, fields: {}, problems: ['second go'] }),
    room: async (_p, { holder }) => ({ ok: true, reservation: holder, leftPence: 10000 }),
    release: async () => {},
  });
  assert.equal(again.state, 'done');
  // Now the first go's slow answer arrives.
  settleLate({ state: 'done', matched: { wikipedia: {} }, fields: {}, problems: ['first go, late'] });
  await new Promise((r) => setTimeout(r, 150));
  const { rows: [after] } = await query(`select state, outcome from research_sweep_places where sweep_id = $1 and venue_ref = $2`, [row.id, lateRef]);
  assert.equal(after.outcome.attempt, 2);
  assert.equal(after.state, 'done');
  assert.deepEqual(after.outcome.problems, ['second go'], 'the retry\u2019s answer stands');
  assert.equal(after.outcome.late, undefined);
});
