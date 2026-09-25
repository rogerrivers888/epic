/**
 * The deep reference set — src/sources/referenceSet.js.
 *
 * What is pinned: the twenty a category are taken bucket by bucket for the
 * reasons the owner gave — dense, thin, chain, small, and two where sources
 * are likely to disagree — each place once, the reason written beside it;
 * the price is only for Google places we cannot seed; and the run researches
 * everything again, with the record's own name and point as the seed.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from '../test/helpers/db.js';

const { query, pool } = await testDatabase();
const ref = await import('../src/sources/referenceSet.js');
const sweep = await import('../src/sources/researchSweep.js');
const { setOffKeys } = await import('../src/sources/switches.js');
process.env.GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || 'test-key-never-sent';

const HH = '00000000-0000-4000-8000-0000000000ef';
const CAT = 'test-ref-cat';
const SUB = 'test-ref-drawer';

test.after(async () => {
  await query(`delete from research_sweeps where subcategories ? $1`, [SUB]);
  await query(`delete from place_facts where venue_ref like 'google:ChIJ_ref_%'`);
  await query(`delete from place_areas where venue_ref like 'google:ChIJ_ref_%'`);
  await query(`delete from place_index where venue_ref like 'google:ChIJ_ref_%'`);
  await query(`delete from place_records where venue_ref like 'google:ChIJ_ref_%'`);
  await query(`delete from shelf_subcategories where key = $1`, [SUB]);
  await query(`delete from shelf_categories where key = $1`, [CAT]);
  await pool.end();
});

// A synthetic category: forty places over four areas of very different sizes,
// a chain, some small identified places, and one real disagreement.
const rows = [];
const areas = { 'dense-town': 30, 'busy-town': 20, 'quiet-village': 4, 'hamlet': 2 };
let i = 0;
for (const [area, n] of Object.entries(areas)) {
  for (let k = 0; k < n; k += 1) {
    i += 1;
    const id = `google:ChIJ_ref_${String(i).padStart(3, '0')}`;
    rows.push({ venue_ref: id, area, score: 100 - i, name: `Place ${i}`, lat: 51 + i / 1000, website: i % 9 === 0 ? 'https://www.bigchain.example/branch' + i : `https://place${i}.example` });
  }
}

test.before(async () => {
  await query(`insert into households (id, name) values ($1, 'Reference test household') on conflict (id) do nothing`, [HH]);
  await query(`insert into shelf_categories (key, label, active) values ($1, 'Ref test', true) on conflict (key) do update set active = true`, [CAT]);
  await query(`insert into shelf_subcategories (key, label, category_key) values ($1, 'Ref drawer', $2) on conflict do nothing`, [SUB, CAT]);
  for (const r of rows) {
    await query(`insert into place_index (venue_ref, subcategory, found_rank) values ($1, $2, $3) on conflict (venue_ref) do update set subcategory = excluded.subcategory`, [r.venue_ref, SUB, 100 - r.score]);
    await query(`insert into place_areas (venue_ref, area_slug) values ($1, $2) on conflict do nothing`, [r.venue_ref, r.area]);
    await query(`insert into place_records (venue_ref, name, lat, lng, epic_score, website, enrich_state, provenance, enriched_at, research_version)
                 values ($1, $2, $3, -0.6, $4, $5, 'done', '{"name":"osm"}'::jsonb, now(), 3)
                 on conflict (venue_ref) do update set name = excluded.name, lat = excluded.lat, epic_score = excluded.epic_score, website = excluded.website`,
      [r.venue_ref, r.name, r.lat, r.score, r.website]);
  }
  // Place 7 was matched by both the open map and Wikipedia: not a
  // disagreement yet, but where one is likeliest, which is the fallback.
  await query(`update place_records set matched = '{"osm":{"ref":"node/7"},"wikipedia":{"title":"Place 7"}}'::jsonb where venue_ref = 'google:ChIJ_ref_007'`);
  // Place 5 is known by two names to two sources.
  for (const [source, value] of [['osm', 'The Old Bull'], ['wikipedia', 'Bull Inn, Dense Town']]) {
    await query(`insert into place_facts (venue_ref, field, source, value, licence, retention, confidence, expires_at) values ($1, 'name', $2, $3, 'x', 'indefinite', 1, null)
                 on conflict do nothing`, ['google:ChIJ_ref_005', source, JSON.stringify(value)]);
  }
});

test('twenty a category, bucket by bucket, each once, with the reason written beside it', async () => {
  const [c] = (await ref.propose()).filter((x) => x.category === CAT);
  assert.equal(c.picks.length, 20);
  assert.equal(new Set(c.picks.map((p) => p.venue_ref)).size, 20, 'each place once');
  const by = Object.groupBy(c.picks, (p) => p.picked_for);
  assert.equal(by.dense.length, 6);
  assert.ok(by.dense.every((p) => Number(p.venue_ref.slice(-3)) <= 30), 'dense picks come from the biggest area');
  assert.equal(by.thin.length, 4);
  assert.ok(by.thin.every((p) => Number(p.venue_ref.slice(-3)) > 50), 'thin picks come from the small areas');
  assert.equal(by.chain.length, 4);
  assert.equal(by.small.length, 4);
  assert.ok(by.small.every((p) => Number(p.venue_ref.slice(-3)) > 40), 'small is the low end of the ranking');
  assert.deepEqual(by.disagree.map((p) => p.venue_ref), ['google:ChIJ_ref_005'], 'the one that really does');
  assert.deepEqual(by['disagree?'].map((p) => p.venue_ref), ['google:ChIJ_ref_007'], 'and the one likeliest to, to make the two');
});

test('the price is for Google places we cannot seed, and everything else is free', async () => {
  const e = await ref.estimate();
  const mine = e.categories.find((c) => c.category === CAT);
  assert.equal(mine.picks.length, 20);
  // Every synthetic place has a name and a point, so none of these costs a request.
  assert.ok(e.seeded >= 20);
  assert.match(e.basis, /free/);
});

test('the run is a research sweep in reference mode: everything again, seeded from the record, hygiene included', async () => {
  const e = await ref.estimate();
  await assert.rejects(() => ref.start({ confirm: e.requests + 1, householdId: HH }), (x) => x.code === 'confirm_required');
  const row = await ref.start({ confirm: e.requests, householdId: HH, startedBy: 'test' });
  assert.equal(row.params.mode, 'reference');
  const { rows: picked } = await query('select picked_for from research_sweep_places where sweep_id = $1', [row.id]);
  assert.ok(picked.length >= 20 && picked.every((p) => p.picked_for));

  // Only this category's places are researched here: the rest are written off
  // so the test stays inside its own data.
  await query(`update research_sweep_places set state = 'done', outcome = '{"state":"done"}'::jsonb where sweep_id = $1 and subcategory <> $2`, [row.id, SUB]);
  const asked = [];
  const done = await sweep.work(row.id, {
    research: async (venueRef) => {
      asked.push(venueRef);
      return { state: 'done', matched: { osm: {} }, provenance: { summary: 'wikipedia' }, problems: [] };
    },
    room: async (_p, { holder }) => ({ ok: true, reservation: holder, leftPence: 10000 }),
    release: async () => {},
  });
  assert.equal(done.state, 'done');
  assert.equal(asked.length, 20);
});

test('reference mode is the run\u2019s, so a resume researches the same way the start did', async () => {
  const { rows: [r] } = await query(`select params from research_sweeps where subcategories ? $1 order by started_at desc limit 1`, [SUB]);
  assert.equal(r.params.mode, 'reference');
  // And the seed is the record's own name and point, so a known place is
  // never bought back from Google: `referenceResearch` reads exactly this.
  const { rows: [rec] } = await query('select name, lat, lng from place_records where venue_ref = $1', ['google:ChIJ_ref_001']);
  assert.ok(rec.name && rec.lat != null && rec.lng != null);
});
