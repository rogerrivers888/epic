import test from 'node:test';
import assert from 'node:assert/strict';

import {
  notable, cathedralAbbeyMinster, lastWordKind, containsKindWord,
  worshipKind, visitorFacilities, heritageNotable,
} from '../src/domain/narrowing.js';
import { testDatabase } from './helpers/db.js';

// The test database is built first, before anything that imports src/db.js is
// loaded, so the pool binds to it and not to the development database. access.js
// and the repository both pull in src/db.js, so they are imported dynamically
// here, after the env is set (CLAUDE.md: a red run has a cause — this one would
// be migrations run against the dev database).
const { query, pool } = await testDatabase();
const { requires } = await import('../src/access.js');
const narrowing = await import('../src/repositories/narrowing.js');
test.after(() => pool.end());

// ---------------------------------------------------------------------------
// The predicate — pure, both ways
// ---------------------------------------------------------------------------

test('a cathedral is kept by its name', () => {
  const v = notable({ name: 'Winchester Cathedral', heritageAvailable: true });
  assert.equal(v.status, 'kept');
  assert.equal(v.notable, true);
  assert.match(v.signals.join(' '), /cathedral/);
});

test('an abbey and a minster are kept by their name', () => {
  assert.equal(notable({ name: 'Westminster Abbey', heritageAvailable: true }).status, 'kept');
  assert.equal(notable({ name: 'York Minster', heritageAvailable: true }).status, 'kept');
});

test('an ordinary St Mary\'s Church with nothing is dropped', () => {
  const v = notable({ name: "St Mary's Church", heritageAvailable: true, heritage: null });
  assert.equal(v.status, 'dropped');
  assert.equal(v.notable, false);
  assert.equal(v.signals.length, 0);
});

test('a church with a Wikipedia article is kept', () => {
  const v = notable({ name: 'St Cuthbert\'s', hasWikipedia: true, heritageAvailable: true });
  assert.equal(v.status, 'kept');
  assert.match(v.signals.join(' '), /encyclopedia/);
});

test('a war memorial / statue / plaque with nothing is dropped', () => {
  for (const name of ['War Memorial', 'Queen Victoria Statue', 'Blue Plaque']) {
    assert.equal(notable({ name, heritageAvailable: true, heritage: null }).status, 'dropped');
  }
});

test('a monument with OSM opening_hours / tourism is kept', () => {
  const v = notable({ name: 'The Monument', heritageAvailable: true, osmTags: { opening_hours: 'Mo-Su 09:30-18:00', tourism: 'attraction' } });
  assert.equal(v.status, 'kept');
  assert.match(v.signals.join(' '), /opening hours/);
});

test('"Abbey Road Studios" is NOT kept by the abbey-name rule (not a church/abbey kind)', () => {
  const v = notable({ name: 'Abbey Road Studios', googleTypes: ['recording_studio'], heritageAvailable: true, heritage: null });
  assert.equal(cathedralAbbeyMinster({ name: 'Abbey Road Studios', googleTypes: ['recording_studio'] }), null);
  assert.equal(v.status, 'dropped');
});

test('"Abbey Church of St Alban" IS kept — the word mid-name with a worship type', () => {
  const s = { name: 'Abbey Church of St Alban', googleTypes: ['church'], heritageAvailable: true };
  assert.ok(cathedralAbbeyMinster(s));
  assert.equal(notable(s).status, 'kept');
});

test('a cathedral by OSM building type is kept even without the word in a name', () => {
  const s = { name: null, osmTags: { building: 'cathedral' }, heritageAvailable: true };
  assert.equal(cathedralAbbeyMinster(s).via, 'OSM building=cathedral');
  assert.equal(notable(s).status, 'kept');
});

test('building=abbey is a direct keep; building=monastery alone is not', () => {
  assert.equal(cathedralAbbeyMinster({ osmTags: { building: 'abbey' } }).via, 'OSM building=abbey');
  // A monastery is not one of the owner's three words: alone, with no priory/
  // friary name, this keeps nothing here.
  assert.equal(cathedralAbbeyMinster({ name: null, osmTags: { building: 'monastery' } }), null);
  assert.equal(cathedralAbbeyMinster({ name: 'St Mary', osmTags: { building: 'monastery' } }), null);
  assert.equal(notable({ name: null, osmTags: { building: 'monastery' }, heritageAvailable: true, heritage: null }).status, 'dropped');
});

test('a priory named "X Priory" with building=monastery is a flagged candidate', () => {
  const s = { name: 'Buckland Priory', osmTags: { building: 'monastery' }, heritageAvailable: true };
  const k = cathedralAbbeyMinster(s);
  assert.equal(k.word, 'priory');
  assert.equal(k.candidate, true);
  const v = notable(s);
  assert.equal(v.status, 'kept');
  assert.match(v.signals.join(' '), /likely priory/);
});

test('Grade I listed is kept; Grade II is not notability on its own', () => {
  assert.equal(notable({ name: 'x', heritageAvailable: true, heritage: { gradeI: true } }).status, 'kept');
  assert.equal(notable({ name: 'x', heritageAvailable: true, heritage: { grade2star: true } }).status, 'dropped');
  assert.equal(heritageNotable({ heritageAvailable: true, heritage: { scheduled: true } }), 'a scheduled monument');
});

test('can\'t-speak: no other signal and the Historic England list is not loaded', () => {
  const v = notable({ name: "St Mary's Church", heritageAvailable: false, heritage: null });
  assert.equal(v.status, 'cant-speak');
  assert.equal(v.notable, null);
  assert.match(v.reason, /Historic England|Grade I/);
});

test('can\'t-speak does not fire when another signal already keeps the place', () => {
  const v = notable({ name: 'Westminster Abbey', heritageAvailable: false });
  assert.equal(v.status, 'kept');
  assert.equal(v.notable, true);
});

test('helpers behave', () => {
  assert.equal(lastWordKind('Bath Abbey'), 'abbey');
  assert.equal(lastWordKind('Abbey Road Studios'), null);
  assert.equal(containsKindWord('Abbey Road Studios'), 'abbey');
  assert.equal(worshipKind({ googleTypes: ['place_of_worship'] }), true);
  assert.equal(worshipKind({ labels: ['osm:amenity=place_of_worship'] }), true);
  assert.deepEqual(visitorFacilities({}), []);
  assert.ok(visitorFacilities({ website: true }).length);
  // The one signal that can be unavailable returns null, never a false 0.
  assert.equal(heritageNotable({ heritageAvailable: false }), null);
});

test('the guard is view_library', () => {
  const run = (middleware, access) => {
    let passed = false; let refused = null;
    const res = { status(c) { refused = { c }; return this; }, json(b) { if (refused) refused.b = b; return this; } };
    middleware({ access }, res, () => { passed = true; });
    return { passed, refused };
  };
  const base = { doors: ['client', 'admin'], isOwner: false, role: { key: 'support' } };
  assert.equal(run(requires('view_library'), { ...base, capabilities: new Set(['view_library']) }).passed, true);
  assert.equal(run(requires('view_library'), { ...base, capabilities: new Set() }).passed, false);
});

// ---------------------------------------------------------------------------
// The measurement — read-only, counts add up, can't-speak honoured
// ---------------------------------------------------------------------------

async function seedPlace(ref, { subcategory, record = null, osm = null, labels = null, point = null }) {
  await query(
    'insert into place_index (venue_ref, lat, lng) values ($1,$2,$3) on conflict do nothing',
    [ref, point?.lat ?? null, point?.lng ?? null]);
  await query(
    `insert into place_subcategories (venue_ref, category, subcategory, area_slug)
       values ($1,'culture',$2,'sl5') on conflict do nothing`, [ref, subcategory]);
  if (record) {
    await query(
      `insert into place_records (venue_ref, name, wikipedia_url, opening_hours, website, osm_ref, provenance)
         values ($1,$2,$3,$4,$5,$6,$7) on conflict (venue_ref) do update
         set name=$2, wikipedia_url=$3, opening_hours=$4, website=$5, osm_ref=$6, provenance=$7`,
      [ref, record.name ?? null, record.wikipedia_url ?? null, record.opening_hours ?? null,
        record.website ?? null, record.osm_ref ?? null, JSON.stringify(record.provenance ?? { name: 'site' })]);
  }
  if (osm) {
    await query(
      `insert into osm_features (ref, name, lat, lng, tags, region, load_id)
         values ($1,$2,$3,$4,$5,'great-britain', gen_random_uuid()) on conflict (ref) do nothing`,
      [osm.ref, osm.name ?? 'x', osm.lat ?? 51.4, osm.lng ?? -0.67, JSON.stringify(osm.tags ?? {})]);
  }
  for (const l of labels ?? []) {
    await query('insert into place_index_labels (venue_ref, label) values ($1,$2) on conflict do nothing', [ref, l]);
  }
}

test('estate preview: now = kept + dropped + cant-speak, and the right places land in each', async () => {
  // Heritage not loaded (migration 308 seeds state 'never'): an ordinary church
  // with nothing is can't-speak, never a false drop.
  await seedPlace('google:cath1', { subcategory: 'churches', record: { name: 'Winchester Cathedral' } });
  await seedPlace('google:ord1', { subcategory: 'churches', record: { name: "St Mary's Church" } });
  await seedPlace('google:wiki1', { subcategory: 'churches', record: { name: "St Cuthbert's", wikipedia_url: 'https://en.wikipedia.org/wiki/x' } });
  await seedPlace('google:warmem1', { subcategory: 'monuments-memorials', record: { name: 'War Memorial' } });
  await seedPlace('osm:node/9001', { subcategory: 'monuments-memorials', osm: { ref: 'node/9001', tags: { opening_hours: 'Mo-Su 09:00-17:00', tourism: 'attraction' } } });

  const out = await narrowing.narrowingPreview({ scope: 'estate' });
  assert.equal(out.scope, 'estate');
  assert.equal(out.heritage.available, false);
  const by = Object.fromEntries(out.subcategories.map((s) => [s.key, s]));

  for (const s of out.subcategories) {
    if (!s.narrow) { assert.equal(s.comparator, true); continue; } // museums: a count, no kept/dropped
    assert.equal(s.countNow, s.kept + s.dropped + s.cantSpeak, `${s.key} adds up`);
  }

  // Churches: cathedral + wiki kept; the ordinary one can't-speak (no HE load).
  assert.equal(by.churches.countNow, 3);
  assert.equal(by.churches.kept, 2);
  assert.equal(by.churches.dropped, 0);
  assert.equal(by.churches.cantSpeak, 1);

  // Monuments: the OSM-tagged one kept; the bare war memorial can't-speak.
  assert.equal(by['monuments-memorials'].kept, 1);
  assert.equal(by['monuments-memorials'].cantSpeak, 1);

  // Examples carry a reason/why and an owned name.
  const kept = by.churches.examplesKept.find((e) => e.ref === 'google:cath1');
  assert.ok(kept && /cathedral/.test(kept.why));
  assert.equal(kept.name, 'Winchester Cathedral');
});

test('with the Historic England list loaded, the bare church is a real drop (not can\'t-speak)', async () => {
  const load = '11111111-1111-1111-1111-111111111111';
  await query(
    `update owned_source_loads set state='done', live_load=$1, load_id=$1, finished_at=now() where source='historic-england'`, [load]);
  // A Grade I listing next to one church, far from the other.
  await seedPlace('google:listed1', { subcategory: 'churches', record: { name: 'St Peter the Apostle' }, point: { lat: 51.40000, lng: -0.67000 } });
  await seedPlace('google:bare1', { subcategory: 'churches', record: { name: 'St John the Baptist' }, point: { lat: 52.50000, lng: -1.90000 } });
  // Both are in England (nation resolves via place_areas → an England county),
  // so the Historic England list can speak for them: a listing keeps, its
  // absence drops — neither is can't-speak.
  const { rows: [eng] } = await query(`select slug from localities where kind='county' and nation='England' limit 1`);
  assert.ok(eng, 'an England county is seeded');
  for (const r of ['google:listed1', 'google:bare1']) {
    await query('insert into place_areas (venue_ref, area_slug) values ($1,$2) on conflict do nothing', [r, eng.slug]);
  }
  await query(
    `insert into heritage_entries (list_entry, layer, name, grade, lat, lng, load_id)
       values (1234567,'listed-building','Church of St Peter','I',51.40003,-0.67002,$1) on conflict do nothing`, [load]);

  const out = await narrowing.narrowingPreview({ scope: 'estate' });
  assert.equal(out.heritage.available, true);
  const refs = (bucket) => new Set(bucket.map((e) => e.ref));
  const ch = out.subcategories.find((s) => s.key === 'churches');
  assert.ok(refs(ch.examplesKept).has('google:listed1'), 'the listed church is kept via Grade I');
  // The bare church, with HE loaded and no listing near it, is now a real drop.
  assert.ok(refs(ch.examplesDropped).has('google:bare1'), 'the bare church is dropped');
  // Both are in England with the list loaded, so neither is can't-speak
  // (per-ref, since other tests' churches share this file's database).
  const cs = refs(ch.examplesCantSpeak ?? []);
  assert.ok(!cs.has('google:listed1') && !cs.has('google:bare1'), 'neither English church is can\'t-speak');
  // Still adds up, for the narrowed drawers.
  for (const s of out.subcategories) {
    if (s.narrow) assert.equal(s.countNow, s.kept + s.dropped + s.cantSpeak);
  }
});

test('an atlas church whose attraction osm_ref carries opening_hours is kept on facilities', async () => {
  const { rows: [reg] } = await query('select slug from regions limit 1');
  assert.ok(reg, 'a region is seeded');
  await query(
    `insert into osm_features (ref, name, lat, lng, tags, region, load_id)
       values ('way/7777','St Example', 51.4, -0.67, $1, 'great-britain', gen_random_uuid())
       on conflict (ref) do nothing`, [JSON.stringify({ opening_hours: 'Mo-Su 10:00-16:00' })]);
  await query(`insert into place_index (venue_ref) values ('google:atlaschurch') on conflict do nothing`);
  await query(
    `insert into place_subcategories (venue_ref, category, subcategory, area_slug)
       values ('google:atlaschurch','culture','churches','sl5') on conflict do nothing`);
  // The atlas row's only OSM link is on the attraction itself; no wikidata id or
  // wikipedia url, so the keep can only come from the OSM facilities tags.
  await query(
    `insert into attractions (region_slug, name, slug, external_ref, osm_ref)
       values ($1, 'St Example Church', 'st-example-church', 'google:atlaschurch', 'way/7777')`,
    [reg.slug]);

  const out = await narrowing.narrowingPreview({ scope: 'estate' });
  const ch = out.subcategories.find((s) => s.key === 'churches');
  const kept = ch.examplesKept.find((e) => e.ref === 'google:atlaschurch');
  assert.ok(kept, 'kept on OSM opening hours read through attractions.osm_ref');
  assert.match(kept.why, /opening hours/);
});

test('negative or sentinel OSM values are not visitor facilities (Codex)', () => {
  // wheelchair=no is absence of access, not a facility; closed/off/no/fee=no too.
  assert.deepEqual(visitorFacilities({ osmTags: { wheelchair: 'no', fee: 'no', opening_hours: 'closed', tourism: 'no' } }), []);
  // Real values do fire.
  assert.ok(visitorFacilities({ osmTags: { wheelchair: 'yes' } }).length === 1);
  assert.ok(visitorFacilities({ osmTags: { opening_hours: 'Mo-Su 09:00-17:00' } }).includes('opening hours'));
  assert.ok(visitorFacilities({ osmTags: { tourism: 'attraction' } }).length === 1);
  assert.ok(visitorFacilities({ osmTags: { fee: 'yes' } }).length === 1);
  // wheelchair=limited is partial provision — still a signal.
  assert.ok(visitorFacilities({ osmTags: { wheelchair: 'limited' } }).length === 1);
});

test('an atlas place with a Wikidata id but no article is not kept on the article signal (Codex)', async () => {
  const { rows: [reg] } = await query('select slug from regions limit 1');
  // Two atlas churches: one with a Wikipedia article, one with only a wikidata id.
  for (const [slug, ext, wurl] of [['nw-article', 'wikidata:Q77001', 'https://en.wikipedia.org/wiki/x'], ['nw-idonly', 'wikidata:Q77002', null]]) {
    await query(
      `insert into attractions (region_slug, name, slug, external_ref, wikidata_id, wikipedia_url)
         values ($1, 'St Nowhere', $2, $3, substr($3,10), $4) on conflict do nothing`, [reg.slug, slug, ext, wurl]);
    await query('insert into place_index (venue_ref) values ($1) on conflict do nothing', [ext]);
    await query(`insert into place_subcategories (venue_ref, category, subcategory, area_slug) values ($1,'culture','churches','sl5') on conflict do nothing`, [ext]);
  }
  const out = await narrowing.narrowingPreview({ scope: 'estate' });
  const ch = out.subcategories.find((s) => s.key === 'churches');
  const kept = new Set(ch.examplesKept.map((e) => e.ref));
  const notKept = new Set([...(ch.examplesDropped ?? []), ...(ch.examplesCantSpeak ?? [])].map((e) => e.ref));
  assert.ok(kept.has('wikidata:Q77001'), 'the one with an article is kept');
  assert.ok(!kept.has('wikidata:Q77002'), 'the id-only one is not kept on the article rule');
  assert.ok(notKept.has('wikidata:Q77002'), 'it falls to dropped or can’t-speak, never a false keep');
});

test('a neighbour’s listing is not attributed by proximity alone — the names must agree (Codex)', async () => {
  const load = '22222222-2222-2222-2222-222222222222';
  await query(`update owned_source_loads set state='done', live_load=$1, load_id=$1, finished_at=now() where source='historic-england'`, [load]);
  // A listed church, and a war memorial 20 m away in its churchyard.
  await seedPlace('google:namech', { subcategory: 'churches', record: { name: 'St Andrew the Great' }, point: { lat: 52.20500, lng: 0.12100 } });
  await seedPlace('google:yardmem', { subcategory: 'monuments-memorials', record: { name: 'War Memorial' }, point: { lat: 52.20503, lng: 0.12104 } });
  const { rows: [eng] } = await query(`select slug from localities where kind='county' and nation='England' limit 1`);
  for (const r of ['google:namech', 'google:yardmem']) await query('insert into place_areas (venue_ref, area_slug) values ($1,$2) on conflict do nothing', [r, eng.slug]);
  await query(`insert into heritage_entries (list_entry, layer, name, grade, lat, lng, load_id)
                 values (7654321,'listed-building','Church of St Andrew the Great','I',52.20502,0.12102,$1) on conflict do nothing`, [load]);
  const out = await narrowing.narrowingPreview({ scope: 'estate' });
  const kept = new Set(out.subcategories.find((s) => s.key === 'churches').examplesKept.map((e) => e.ref));
  const memDropped = new Set(out.subcategories.find((s) => s.key === 'monuments-memorials').examplesDropped.map((e) => e.ref));
  assert.ok(kept.has('google:namech'), 'the church whose name matches the listing is kept');
  assert.ok(memDropped.has('google:yardmem'), 'the churchyard war memorial does not inherit the church’s Grade I');
});

test('a short saint name still identifies a heritage listing — St Ann’s matches Church of St Ann (Codex)', async () => {
  const load = '33333333-3333-3333-3333-333333333333';
  await query(`update owned_source_loads set state='done', live_load=$1, load_id=$1, finished_at=now() where source='historic-england'`, [load]);
  await seedPlace('google:stann', { subcategory: 'churches', record: { name: "St Ann's Church" }, point: { lat: 53.48100, lng: -2.24400 } });
  const { rows: [eng] } = await query(`select slug from localities where kind='county' and nation='England' limit 1`);
  await query('insert into place_areas (venue_ref, area_slug) values ($1,$2) on conflict do nothing', ['google:stann', eng.slug]);
  await query(`insert into heritage_entries (list_entry, layer, name, grade, lat, lng, load_id)
                 values (9988776,'listed-building','Church of St Ann','I',53.48102,-2.24402,$1) on conflict do nothing`, [load]);
  const out = await narrowing.narrowingPreview({ scope: 'estate' });
  const kept = new Set(out.subcategories.find((s) => s.key === 'churches').examplesKept.map((e) => e.ref));
  assert.ok(kept.has('google:stann'), 'St Ann’s is kept via its Grade I listing');
});

test('a three-letter token matches a whole word, not a substring — St Bee does not inherit Beech House (Codex)', async () => {
  const load = '44444444-4444-4444-4444-444444444444';
  await query(`update owned_source_loads set state='done', live_load=$1, load_id=$1, finished_at=now() where source='historic-england'`, [load]);
  await seedPlace('google:stbee', { subcategory: 'churches', record: { name: 'St Bee Church' }, point: { lat: 50.10000, lng: -5.20000 } });
  const { rows: [eng] } = await query(`select slug from localities where kind='county' and nation='England' limit 1`);
  await query('insert into place_areas (venue_ref, area_slug) values ($1,$2) on conflict do nothing', ['google:stbee', eng.slug]);
  await query(`insert into heritage_entries (list_entry, layer, name, grade, lat, lng, load_id)
                 values (5544332,'listed-building','Beech House','I',50.10002,-5.20001,$1) on conflict do nothing`, [load]);
  const out = await narrowing.narrowingPreview({ scope: 'estate' });
  const kept = new Set(out.subcategories.find((s) => s.key === 'churches').examplesKept.map((e) => e.ref));
  assert.ok(!kept.has('google:stbee'), 'St Bee Church does not inherit Beech House’s Grade I by substring');
});
