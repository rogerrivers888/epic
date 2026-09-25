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

const SUB = 'test-sweep-drawer';
const THIN = 'test-sweep-thin';
const refs = (n, prefix = 'google:ChIJ_sweep_') => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(3, '0')}`);

test.before(async () => {
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

test('nothing starts without the request count, or without a household', async () => {
  await assert.rejects(() => sweep.start({ subcategories: [SUB], confirm: 35, householdId: 'h' }), (e) => e.code === 'confirm_required' && e.plan?.requests === 36);
  await assert.rejects(() => sweep.start({ subcategories: [SUB], confirm: 36, householdId: null }), (e) => e.code === 'no_household');
});

test('the work writes each place as it goes, reads its cost off the ledger, and finishes', async () => {
  const hh = '00000000-0000-4000-8000-00000000c0de';
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
    await query(`insert into provider_calls (provider, purpose, estimated_cost_usd, venue_ref) values ('google', 'own.seed', 0.032, $1)`, [ref]);
    return { state: 'done', matched: { osm: {}, wikipedia: {} }, fields: { summary: 'A lake with a boathouse.' }, problems: [] };
  };
  const reservations = [];
  const room = async (pence, { holder }) => { reservations.push({ pence, holder }); return { ok: true, reservation: `r${reservations.length}`, leftPence: 10000 }; };
  const released = [];
  const done = await sweep.work(row.id, { research, room, release: async (id) => { released.push(id); } });

  assert.equal(done.state, 'done');
  assert.equal(asked.length, 20);
  assert.equal(reservations.length, 5, 'four at a time');
  assert.equal(released.length, 5, 'every reservation given back');
  assert.ok(reservations.every((r) => r.holder === `sweep:${row.id}` && r.pence === Math.ceil(4 * 2 * sweep.pencePerRequest())));

  const f = await sweep.funnelOf(row.id);
  assert.equal(f.sampled, 20);
  assert.equal(f.held, 2);
  assert.equal(f.asked, 18);
  assert.equal(f.identified, 20);
  assert.equal(f.described, 18);
  assert.equal(f.openMap, 18);
  assert.equal(f.pending, 0);
  assert.equal(Math.round(f.spentUsd * 1000) / 1000, Math.round(18 * 0.032 * 1000) / 1000, 'the cost is the ledger’s, not a guess');
  const by = await sweep.byDrawer(row.id);
  assert.equal(by[0].subcategory, SUB);
  assert.equal(by[0].described, 18);
});

test('over the ceiling stops with the rest left pending, and does not pretend', async () => {
  await query(`update research_sweeps set state = 'done' where subcategories ? $1 and state = 'running'`, [SUB]);
  const hh = '00000000-0000-4000-8000-00000000c0de';
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
  const hh = '00000000-0000-4000-8000-00000000c0de';
  const row = await sweep.start({ subcategories: [SUB], confirm: 36, householdId: hh });
  // The process died after the first place's request was on the ledger and
  // before its row was written. Everything else is done already.
  const [first] = refs(1, 'google:ChIJ_sweep_1');
  const hit = refs(20).includes(first) ? first : (await query(`select venue_ref from research_sweep_places where sweep_id = $1 limit 1`, [row.id])).rows[0].venue_ref;
  await query(`update research_sweep_places set state = 'done', outcome = '{"state":"done"}'::jsonb where sweep_id = $1 and venue_ref <> $2`, [row.id, hit]);
  await query(`update research_sweep_places set state = 'asking', attempted_at = now() - interval '2 minutes' where sweep_id = $1 and venue_ref = $2`, [row.id, hit]);
  await query(`insert into provider_calls (provider, purpose, estimated_cost_usd, venue_ref, created_at) values ('google', 'own.seed', 0.032, $1, now() - interval '1 minute')`, [hit]);
  await query(`update research_sweeps set touched_at = now() - interval '1 hour' where id = $1`, [row.id]);

  await sweep.resume({ work: async () => {} });
  const done = await sweep.work(row.id, {
    research: async (ref) => {
      // The second attempt buys its request again.
      await query(`insert into provider_calls (provider, purpose, estimated_cost_usd, venue_ref) values ('google', 'own.seed', 0.032, $1)`, [ref]);
      return { state: 'done', matched: {}, fields: {}, problems: [] };
    },
    room: async () => ({ ok: true, reservation: 'r', leftPence: 10000 }),
    release: async () => {},
  });
  assert.equal(done.state, 'done');
  const { rows: [p] } = await query(`select cost_usd from research_sweep_places where sweep_id = $1 and venue_ref = $2`, [row.id, hit]);
  assert.equal(Math.round(Number(p.cost_usd) * 1000) / 1000, 0.064, 'both attempts are the sweep’s spend');
});

test('a sweep whose process died is picked up, and its in-air places asked again', async () => {
  await query(`update research_sweeps set state = 'done' where subcategories ? $1 and state = 'running'`, [SUB]);
  const hh = '00000000-0000-4000-8000-00000000c0de';
  const row = await sweep.start({ subcategories: [SUB], confirm: 36, householdId: hh });
  // Two were in the air, and nobody has heard from the sweep for a while.
  await query(`update research_sweep_places set state = 'asking' where sweep_id = $1 and venue_ref = any($2)`, [row.id, refs(2)]);
  await query(`update research_sweeps set touched_at = now() - interval '1 hour' where id = $1`, [row.id]);

  const picked = [];
  const r = await sweep.resume({ work: async (id) => { picked.push(id); } });
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
