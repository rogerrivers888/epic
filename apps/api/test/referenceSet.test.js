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

// package.json says Node 20 or later, and Object.groupBy arrived in 21 (Codex
// via epic-00, 25 Sep 2026).
const groupBy = (list, key) => list.reduce((out, x) => { (out[key(x)] ??= []).push(x); return out; }, {});
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
  // Place 20 is well scored but has few reviews on its owned band: small.
  await query(`update place_records set count_band = 'few' where venue_ref = 'google:ChIJ_ref_020'`);
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
  const [c] = (await ref.propose({ categories: [CAT] })).filter((x) => x.category === CAT);
  assert.equal(c.picks.length, 20);
  assert.equal(new Set(c.picks.map((p) => p.venue_ref)).size, 20, 'each place once');
  const by = groupBy(c.picks, (p) => p.picked_for);
  assert.equal(by.dense.length, 6);
  assert.ok(by.dense.every((p) => Number(p.venue_ref.slice(-3)) <= 30), 'dense picks come from the biggest area');
  assert.equal(by.thin.length, 4);
  assert.ok(by.thin.every((p) => Number(p.venue_ref.slice(-3)) > 50), 'thin picks come from the small areas');
  assert.equal(by.chain.length, 4);
  assert.equal(by.small.length, 4);
  // Small means small: the two with few reviews on their owned band come
  // first, then independents deep in Google's own ranking — never the
  // lowest score (owner, 25 Sep 2026).
  assert.ok(by.small.some((p) => p.venue_ref === 'google:ChIJ_ref_020'), 'few reviews, though highly scored');
  assert.ok(!by.small.some((p) => Number(p.venue_ref.slice(-3)) % 9 === 0), 'never a chain');
  assert.deepEqual(by.disagree.map((p) => p.venue_ref), ['google:ChIJ_ref_005'], 'the one that really does');
  assert.deepEqual(by['disagree?'].map((p) => p.venue_ref), ['google:ChIJ_ref_007'], 'and the one likeliest to, to make the two');
});

test('the price is what each place may still cost: two to identify, one for a page lead, nought with a website', async () => {
  // Place 2 has a name and a point but no website: forced research buys the
  // website lead, one request, which the first estimate called free (Codex,
  // 25 Sep 2026).
  await query(`update place_records set website = null where venue_ref = 'google:ChIJ_ref_002'`);
  const e = await ref.estimate({ categories: [CAT] });
  const mine = e.categories.find((c) => c.category === CAT);
  assert.equal(mine.picks.length, 20);
  assert.ok(mine.picks.some((p) => p.venue_ref === 'google:ChIJ_ref_002'), 'place 2 is near the top of the busiest area');
  assert.ok(e.toFindPage >= 1);
  assert.ok(e.requests >= 1);
  assert.match(e.basis, /without a website \(one, the page lead\)/);
});

test('a place sits in the smallest of its areas, not in all of them', async () => {
  // Every synthetic place is also in a "country" that holds them all. Counted
  // there, every one of them is dense (Codex, 25 Sep 2026).
  for (const r of rows) await query(`insert into place_areas (venue_ref, area_slug) values ($1, 'test-country') on conflict do nothing`, [r.venue_ref]);
  const [c] = (await ref.propose({ categories: [CAT] })).filter((x) => x.category === CAT);
  const by = groupBy(c.picks, (p) => p.picked_for);
  assert.ok(by.thin.every((p) => Number(p.venue_ref.slice(-3)) > 50), 'thin still means the small areas');
  assert.ok(by.dense.every((p) => Number(p.venue_ref.slice(-3)) <= 30), 'dense still means the biggest town');
});

test('a category the census has not reached does not start a smaller set', async () => {
  // A second, thin category alongside the full one.
  await query(`insert into shelf_categories (key, label, active) values ('test-ref-thin-cat', 'Thin', true) on conflict (key) do update set active = true`);
  await query(`insert into shelf_subcategories (key, label, category_key) values ('test-ref-thin-drawer', 'Thin drawer', 'test-ref-thin-cat') on conflict do nothing`);
  await query(`insert into place_index (venue_ref, subcategory, found_rank) values ('google:ChIJ_ref_thin_1', 'test-ref-thin-drawer', 1) on conflict (venue_ref) do update set subcategory = excluded.subcategory`);
  try {
    const e = await ref.estimate({ categories: [CAT, 'test-ref-thin-cat'] });
    await assert.rejects(() => ref.start({ categories: [CAT, 'test-ref-thin-cat'], confirm: e.requests, householdId: HH }), (x) => x.code === 'short_category' && /test-ref-thin-cat \(1\)/.test(x.message));
  } finally {
    await query(`delete from place_index where venue_ref = 'google:ChIJ_ref_thin_1'`);
    await query(`delete from shelf_subcategories where key = 'test-ref-thin-drawer'`);
    await query(`delete from shelf_categories where key = 'test-ref-thin-cat'`);
  }
});

test('a category that is not one is refused, not skipped', async () => {
  await assert.rejects(() => ref.propose({ categories: [CAT, 'not-a-category'] }), (x) => x.code === 'unknown_category' && /not-a-category/.test(x.message));
});

test('a set that needs Google does not start without it', async () => {
  await query(`update place_records set website = null where venue_ref = 'google:ChIJ_ref_002'`);
  const e = await ref.estimate({ categories: [CAT] });
  assert.ok(e.requests > 0);
  setOffKeys(['google']);
  try {
    await assert.rejects(() => ref.start({ categories: [CAT], confirm: e.requests, householdId: HH }), (x) => x.code === 'google_unavailable');
  } finally { setOffKeys([]); }
});

test('a second sweep does not start while one is running', async () => {
  const e = await ref.estimate({ categories: [CAT] });
  const row = await ref.start({ categories: [CAT], confirm: e.requests, householdId: HH });
  await assert.rejects(() => ref.start({ categories: [CAT], confirm: e.requests, householdId: HH }), (x) => x.code === 'already_running');
  await query(`update research_sweeps set state = 'done' where id = $1`, [row.id]);
});

test('the run is a research sweep in reference mode: everything again, seeded from the record, hygiene included', async () => {
  const e = await ref.estimate({ categories: [CAT] });
  await assert.rejects(() => ref.start({ categories: [CAT], confirm: e.requests + 1, householdId: HH }), (x) => x.code === 'confirm_required');
  const row = await ref.start({ categories: [CAT], confirm: e.requests, householdId: HH, startedBy: 'test' });
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

test('an atlas place with no record of its own is seeded from the atlas', async () => {
  // `referenceResearch` hands `enrich` a seed; with the researcher stubbed
  // out through the fetch it would make, what matters is that the atlas
  // place is asked about by name and point rather than "could not ask".
  const { rows: [at] } = await query(`insert into attractions (name, slug, region_slug, lat, lng) values ('Test Atlas Arena', 'test-atlas-arena', 'aberdeen-city', 51.4, -0.7) returning id`);
  const ref = `atlas:${at.id}`;
  const wasFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('no network in this test'); };
  try {
    const out = await sweep.referenceResearch(ref, { householdId: HH, paid: false, search: false });
    // Every source failed for want of a network — but it *asked*, which it
    // only does with a name and a point.
    assert.ok(!(out.problems ?? []).some((p) => /could not ask|nothing to go on/i.test(p)), JSON.stringify(out.problems));
    assert.ok((out.problems ?? []).some((p) => /OpenStreetMap/.test(p)), 'the open map was asked');
  } finally {
    globalThis.fetch = wasFetch;
    await query('delete from place_facts where venue_ref = $1', [ref]);
    await query('delete from place_records where venue_ref = $1', [ref]);
    await query('delete from attractions where id = $1', [at.id]);
  }
});

test('the facts behind a disagreement can be read, field by field and source by source', async () => {
  const [row] = (await query(`select id from research_sweeps where subcategories ? $1 order by started_at desc limit 1`, [SUB])).rows;
  const out = await ref.disagreements(row.id);
  const five = out.find((p) => p.venue_ref === 'google:ChIJ_ref_005');
  assert.ok(five, 'place 5 is known by two names');
  assert.deepEqual(five.fields.name, { osm: 'The Old Bull', wikipedia: 'Bull Inn, Dense Town' });
  // The same list in a different order is not a disagreement (Codex, 26 Sep 2026).
  for (const [source, value] of [['osm', ['italian', 'pizza']], ['site', ['pizza', 'italian']]]) {
    await query(`insert into place_facts (venue_ref, field, source, value, licence, retention, confidence, expires_at) values ('google:ChIJ_ref_006', 'cuisines', $1, $2, 'x', 'indefinite', 1, null) on conflict do nothing`, [source, JSON.stringify(value)]);
  }
  const again = await ref.disagreements(row.id, { limit: 200 });
  assert.equal(again.find((p) => p.venue_ref === 'google:ChIJ_ref_006'), undefined, 'order alone is no difference');
  const held = await ref.held(row.id);
  assert.equal(held.find((p) => p.venue_ref === 'google:ChIJ_ref_006').disagreements, 0);

  // What twenty of the first set's disagreements turned out to be, and must
  // not count (owner, 26 Sep 2026): the same website written four ways; the
  // venue's postal postcode beside the one Nominatim derives for its point;
  // two summaries, which differ by design; a name with and without "The".
  const seven = 'google:ChIJ_ref_007';
  const put = (field, source, value) => query(`insert into place_facts (venue_ref, field, source, value, licence, retention, confidence, expires_at) values ($1, $2, $3, $4, 'x', 'indefinite', 1, null) on conflict do nothing`, [seven, field, source, JSON.stringify(value)]);
  await put('website', 'osm', 'https://www.birdworld.co.uk/');
  await put('website', 'site', 'https://birdworld.co.uk');
  await put('website', 'wikidata', 'http://www.birdworld.co.uk/?utm_source=x');
  await put('postcode', 'site', 'SO51 6AL');
  await put('postcode', 'nominatim', 'SO51 6GQ');
  await put('summary', 'site', 'Visit Birdworld, the UK\u2019s only dedicated bird park.');
  await put('summary', 'wikipedia', 'Birdworld is the United Kingdom\u2019s largest bird park.');
  await put('phone', 'osm', '+44 20 7416 5000');
  await put('phone', 'site', '020 7416 5000');
  await put('phone', 'wikipedia', '+44 (0)20 7416 5000');
  await put('name', 'osm', 'Birdworld!');
  await put('name', 'wikipedia', 'The Birdworld');
  const heldSeven = (await ref.held(row.id)).find((p) => p.venue_ref === seven);
  assert.equal(heldSeven.disagreements, 0, 'none of those is two answers to one question');
  // Two numbers are two true answers, and a visit page against a root is
  // the same site (owner, 26 Sep 2026); a different host is not.
  await put('phone', 'wikidata', '020 7091 3067');
  await put('website', 'fsa', 'https://www.birdworld.co.uk/visit/today');
  assert.equal((await ref.held(row.id)).find((p) => p.venue_ref === seven).disagreements, 0);
  await put('website', 'nominatim', 'https://www.everyoneactive.com/centre/x');
  assert.equal((await ref.held(row.id)).find((p) => p.venue_ref === seven).disagreements, 1, 'another operator\u2019s site is a disagreement');
});
