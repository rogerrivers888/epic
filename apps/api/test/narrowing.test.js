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
const surfacing = await import('../src/repositories/placeSurfacing.js');
const placeStatus = await import('../src/repositories/placeStatus.js');
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

test('Grade I and Grade II* are kept (owner, 1 Oct 2026); plain Grade II is not on its own', () => {
  assert.equal(notable({ name: 'x', heritageAvailable: true, heritage: { gradeI: true } }).status, 'kept');
  assert.equal(notable({ name: 'x', heritageAvailable: true, heritage: { grade2star: true } }).status, 'kept');
  assert.equal(heritageNotable({ heritageAvailable: true, heritage: { grade2star: true } }), 'Grade II* listed');
  // Plain Grade II is reported by the gatherer but is not notability here.
  assert.equal(notable({ name: 'x', heritageAvailable: true, heritage: { grade2: true } }).status, 'dropped');
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
  // The narrowing count now reconciles to the Categories screen (desk/categories.js
  // FILED_SQL): the primary drawer is place_index.subcategory, fence-filtered.
  await query(
    `insert into place_index (venue_ref, lat, lng, subcategory) values ($1,$2,$3,$4)
       on conflict (venue_ref) do update set subcategory = excluded.subcategory,
         lat = coalesce(place_index.lat, excluded.lat), lng = coalesce(place_index.lng, excluded.lng)`,
    [ref, point?.lat ?? null, point?.lng ?? null, subcategory]);
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

test('estate preview: now = surfaced + notSurfaced (dropped + can\'t-speak fold together)', async () => {
  // Heritage not loaded here: an ordinary church with nothing is a FACTS
  // can't-speak, but for SURFACING there is no can't-tell — it is not surfaced.
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
    if (!s.narrow) { assert.equal(s.comparator, true); continue; } // comparators: a count, no split
    assert.equal(s.countNow, s.surfaced + s.notSurfaced, `${s.key} adds up`);
  }

  // Churches: cathedral + wiki surface; the ordinary one is not surfaced.
  assert.equal(by.churches.countNow, 3);
  assert.equal(by.churches.surfaced, 2);
  assert.equal(by.churches.notSurfaced, 1);

  // Monuments: the OSM-tagged one surfaces; the bare war memorial does not.
  assert.equal(by['monuments-memorials'].surfaced, 1);
  assert.equal(by['monuments-memorials'].notSurfaced, 1);

  // Surfaced examples carry a why and an owned name.
  const kept = by.churches.examplesSurfaced.find((e) => e.ref === 'google:cath1');
  assert.ok(kept && /cathedral/.test(kept.why));
  assert.equal(kept.name, 'Winchester Cathedral');
  // Not-surfaced examples carry the TRUE reason, never "listing data is not loaded".
  const ns = by.churches.examplesNotSurfaced.find((e) => e.ref === 'google:ord1');
  assert.ok(ns, 'the ordinary church is not surfaced');
  assert.match(ns.why, /no notable evidence held/);
  assert.doesNotMatch(ns.why, /not loaded/);

  // The full Culture total, before and after, is on the response.
  assert.ok(out.cultureTotal && Number.isInteger(out.cultureTotal.now) && Number.isInteger(out.cultureTotal.after));
  assert.ok(out.cultureTotal.after <= out.cultureTotal.now);
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
  assert.ok(refs(ch.examplesSurfaced).has('google:listed1'), 'the listed church surfaces via Grade I');
  // The bare church, with HE loaded and no listing near it, is not surfaced.
  assert.ok(refs(ch.examplesNotSurfaced).has('google:bare1'), 'the bare church is not surfaced');
  // Still adds up, for the narrowed drawers.
  for (const s of out.subcategories) {
    if (s.narrow) assert.equal(s.countNow, s.surfaced + s.notSurfaced);
  }
});

test('an atlas church whose attraction osm_ref carries opening_hours is kept on facilities', async () => {
  const { rows: [reg] } = await query('select slug from regions limit 1');
  assert.ok(reg, 'a region is seeded');
  await query(
    `insert into osm_features (ref, name, lat, lng, tags, region, load_id)
       values ('way/7777','St Example', 51.4, -0.67, $1, 'great-britain', gen_random_uuid())
       on conflict (ref) do nothing`, [JSON.stringify({ opening_hours: 'Mo-Su 10:00-16:00' })]);
  await query(`insert into place_index (venue_ref, subcategory) values ('google:atlaschurch', 'churches') on conflict (venue_ref) do update set subcategory = 'churches'`);
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
  const kept = ch.examplesSurfaced.find((e) => e.ref === 'google:atlaschurch');
  assert.ok(kept, 'surfaced on OSM opening hours read through attractions.osm_ref');
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
    await query(`insert into place_index (venue_ref, subcategory) values ($1, 'churches') on conflict (venue_ref) do update set subcategory = 'churches'`, [ext]);
    await query(`insert into place_subcategories (venue_ref, category, subcategory, area_slug) values ($1,'culture','churches','sl5') on conflict do nothing`, [ext]);
  }
  const out = await narrowing.narrowingPreview({ scope: 'estate' });
  const ch = out.subcategories.find((s) => s.key === 'churches');
  const surfaced = new Set(ch.examplesSurfaced.map((e) => e.ref));
  const notSurfaced = new Set((ch.examplesNotSurfaced ?? []).map((e) => e.ref));
  assert.ok(surfaced.has('wikidata:Q77001'), 'the one with an article surfaces');
  assert.ok(!surfaced.has('wikidata:Q77002'), 'the id-only one does not surface on the article rule');
  assert.ok(notSurfaced.has('wikidata:Q77002'), 'it is not surfaced, never a false keep');
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
  const kept = new Set(out.subcategories.find((s) => s.key === 'churches').examplesSurfaced.map((e) => e.ref));
  const memDropped = new Set(out.subcategories.find((s) => s.key === 'monuments-memorials').examplesNotSurfaced.map((e) => e.ref));
  assert.ok(kept.has('google:namech'), 'the church whose name matches the listing is surfaced');
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
  const kept = new Set(out.subcategories.find((s) => s.key === 'churches').examplesSurfaced.map((e) => e.ref));
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
  const kept = new Set(out.subcategories.find((s) => s.key === 'churches').examplesSurfaced.map((e) => e.ref));
  assert.ok(!kept.has('google:stbee'), 'St Bee Church does not inherit Beech House’s Grade I by substring');
});

test('an all-caps Historic England name still matches (lower before stripping) (Codex)', async () => {
  const load = '55555555-5555-5555-5555-555555555555';
  await query(`update owned_source_loads set state='done', live_load=$1, load_id=$1, finished_at=now() where source='historic-england'`, [load]);
  await seedPlace('google:allcaps', { subcategory: 'churches', record: { name: "St Oswald's Church" }, point: { lat: 54.30000, lng: -2.75000 } });
  const { rows: [eng] } = await query(`select slug from localities where kind='county' and nation='England' limit 1`);
  await query('insert into place_areas (venue_ref, area_slug) values ($1,$2) on conflict do nothing', ['google:allcaps', eng.slug]);
  await query(`insert into heritage_entries (list_entry, layer, name, grade, lat, lng, load_id)
                 values (1212121,'listed-building','CHURCH OF ST OSWALD','I',54.30001,-2.75001,$1) on conflict do nothing`, [load]);
  const out = await narrowing.narrowingPreview({ scope: 'estate' });
  const kept = new Set(out.subcategories.find((s) => s.key === 'churches').examplesSurfaced.map((e) => e.ref));
  assert.ok(kept.has('google:allcaps'), 'the uppercase listing still matches on the word Oswald');
});

// ---------------------------------------------------------------------------
// Base reconciliation + atlas dedup (item 3)
// ---------------------------------------------------------------------------

const churchesNow = async () => (await narrowing.narrowingPreview({ scope: 'estate' }))
  .subcategories.find((s) => s.key === 'churches').countNow;

test('base reconciliation: a fenced-out place is not counted (matches the Categories screen)', async () => {
  const before = await churchesNow();
  // In place_subcategories (the old 29,265 base) but fenced out of Epic: the
  // Categories screen does not count it, and nor does the narrowing base now.
  await query(`insert into place_index (venue_ref, subcategory, not_in_epic_at) values ('google:fenced1','churches', now())
                 on conflict (venue_ref) do update set subcategory='churches', not_in_epic_at=now()`);
  await query(`insert into place_subcategories (venue_ref, category, subcategory, area_slug)
                 values ('google:fenced1','culture','churches','sl5') on conflict do nothing`);
  assert.equal(await churchesNow(), before, 'a fenced place adds nothing to the base');
});

test('atlas dedup: a place held as both an atlas entry and a census id counts once (item 3)', async () => {
  const { rows: [reg] } = await query('select slug from regions limit 1');
  const before = await churchesNow();
  // The same physical church, held two ways — a census google id and a wikidata
  // id — linked by one attraction (external_ref + wikidata_id). Deduped to one.
  await query(`insert into place_index (venue_ref, subcategory) values ('google:dupchurch','churches'),('wikidata:Qdup9001','churches')
                 on conflict (venue_ref) do update set subcategory='churches'`);
  await query(`insert into attractions (region_slug, name, slug, external_ref, wikidata_id)
                 values ($1, 'Holy Trinity', 'holy-trinity-dup-9001', 'google:dupchurch', 'Qdup9001') on conflict do nothing`, [reg.slug]);
  assert.equal(await churchesNow(), before + 1, 'two refs for one place add a single church, not two');
});

// ---------------------------------------------------------------------------
// Part B — the gated, reversible apply path
// ---------------------------------------------------------------------------

test('Part B: not-surfaced hides once applied; notable and filed-elsewhere never do; reversible', async () => {
  // A bare church (candidate, not notable), a cathedral (notable), and a church
  // that also surfaces as a museum (filed in a non-low-attraction drawer).
  await seedPlace('google:pb_bare', { subcategory: 'churches', record: { name: "St Nobody's" } });
  await seedPlace('google:pb_cath', { subcategory: 'churches', record: { name: 'Exeter Cathedral' } });
  await seedPlace('google:pb_else', { subcategory: 'churches', record: { name: 'Chapel Rooms' } });
  await query(`insert into word_targets (namespace, word, subcategory_key, is_primary) values ('google','museum','museums', false) on conflict do nothing`);
  await query(`insert into place_words (venue_ref, label) values ('google:pb_else','google:museum') on conflict do nothing`);

  // The check writes determinations with applied = false and records a 'done'
  // check; nothing hidden yet.
  const run = await surfacing.runSurfacingCheck({ by: 'test' });
  assert.ok(run.checkId, 'a full check records itself');
  let hidden = await placeStatus.hiddenAmong(['google:pb_bare', 'google:pb_cath', 'google:pb_else']);
  assert.equal(hidden.size, 0, 'nothing is hidden before the owner applies (gated like C57)');

  // The owner's OK: only this completed check's determinations take effect.
  const { applied } = await surfacing.applySurfacing({ by: 'test', checkId: run.checkId });
  assert.ok(applied >= 1);
  hidden = await placeStatus.hiddenAmong(['google:pb_bare', 'google:pb_cath', 'google:pb_else']);
  assert.ok(hidden.has('google:pb_bare'), 'the bare church is now not surfaced');
  assert.ok(!hidden.has('google:pb_cath'), 'the cathedral still surfaces (notable)');
  assert.ok(!hidden.has('google:pb_else'), 'a church filed as a museum too is never hidden');

  // Reversible: un-applying restores it with no deletion.
  await query(`update place_surfacing set applied = false where venue_ref = 'google:pb_bare'`);
  hidden = await placeStatus.hiddenAmong(['google:pb_bare']);
  assert.equal(hidden.size, 0, 'un-applied, the place is shown again');
});

test('Part B (Codex #2): a cluster with evidence on one ref stays surfaced — no notable twin is hidden', async () => {
  const { rows: [reg] } = await query('select slug from regions limit 1');
  // An evidence-poor census id (the candidate), and its notable twin held under a
  // wikidata ref with an article — the same place, linked only by provider_matches,
  // so gatherSignals on the census id alone would miss the article.
  await seedPlace('google:clu_poor', { subcategory: 'churches', record: { name: 'St Twin' } });
  await query(`insert into attractions (region_slug, name, slug, venue_ref, wikidata_id, wikipedia_url)
                 values ($1, 'St Twin', 'st-twin-clu', 'wikidata:Qclu7777', 'Qclu7777', 'https://en.wikipedia.org/wiki/st_twin') on conflict do nothing`, [reg.slug]);
  await query(`insert into provider_matches (source, source_ref, venue_ref, missing) values ('google','clu_poor','wikidata:Qclu7777', false)
                 on conflict do nothing`);
  const run = await surfacing.runSurfacingCheck({ by: 'test' });
  await surfacing.applySurfacing({ by: 'test', checkId: run.checkId });
  const hidden = await placeStatus.hiddenAmong(['google:clu_poor', 'wikidata:Qclu7777']);
  assert.equal(hidden.size, 0, 'the whole place is surfaced on its twin’s article — neither ref is hidden');
});

test('Part B (Codex #3): apply refuses a null id and a non-done check', async () => {
  assert.equal((await surfacing.applySurfacing({ by: 'test', checkId: null })).error, 'check_required');
  const id = await surfacing.startCheck({ by: 'test' });
  assert.equal((await surfacing.applySurfacing({ by: 'test', checkId: id })).error, 'check_not_done');
  await surfacing.finishCheck(id, { counts: {} });
  const ok = await surfacing.applySurfacing({ by: 'test', checkId: id });
  assert.equal(ok.error, undefined, 'a completed check applies (zero rows here, but no error)');
});

test('Part B (Codex #4): a rerun restores a place that is no longer a candidate (refiled, no reconsider)', async () => {
  await seedPlace('google:pb_refile', { subcategory: 'churches', record: { name: "St Refile's" } });
  let run = await surfacing.runSurfacingCheck({ by: 'test' });
  await surfacing.applySurfacing({ by: 'test', checkId: run.checkId });
  assert.ok((await placeStatus.hiddenAmong(['google:pb_refile'])).has('google:pb_refile'), 'hidden at first');
  // A category edit re-primaries it to a comparator drawer; reconsider is not called.
  await query(`update place_index set subcategory = 'museums' where venue_ref = 'google:pb_refile'`);
  run = await surfacing.runSurfacingCheck({ by: 'test' });
  assert.ok(run.restored >= 1, 'the rerun restored at least one place');
  assert.equal((await placeStatus.hiddenAmong(['google:pb_refile'])).size, 0, 'no longer a candidate, so un-hidden');
});

test('Part B: reconsider surfaces a held-back place once evidence arrives (normal use, C38)', async () => {
  await seedPlace('google:pb_grow', { subcategory: 'churches', record: { name: "St Growing's" } });
  const run = await surfacing.runSurfacingCheck({ by: 'test' });
  await surfacing.applySurfacing({ by: 'test', checkId: run.checkId });
  assert.ok((await placeStatus.hiddenAmong(['google:pb_grow'])).has('google:pb_grow'), 'held back at first');
  // Evidence arrives: an encyclopedia article on the owned record.
  await query(`update place_records set wikipedia_url = 'https://en.wikipedia.org/wiki/growing' where venue_ref = 'google:pb_grow'`);
  const r = await surfacing.reconsider('google:pb_grow');
  assert.equal(r.surfaced, true);
  assert.equal((await placeStatus.hiddenAmong(['google:pb_grow'])).size, 0, 'it comes back on its own');
});

test('Part B (Codex #1/#5): apply needs the owner personally signed in — a non-owner device is refused', async () => {
  const express = (await import('express')).default;
  const { narrowingRoutes } = await import('../src/routes/narrowing.js');
  const mk = (access) => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.access = { doors: ['client', 'admin'], role: { key: 'support' }, capabilities: new Set(['manage_settings', 'view_library']), ...access };
      req.session = { kind: 'device' };
      req.account = { email: 'person@epic.day' };
      next();
    });
    app.use('/api/admin/narrowing', narrowingRoutes);
    const server = app.listen(0);
    return server;
  };
  // A delegated admin on a device, with manage_settings but NOT owner-elevated.
  const notOwner = mk({ isOwner: false, elevated: false });
  await new Promise((r) => notOwner.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${notOwner.address().port}/api/admin/narrowing/apply`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    assert.equal(res.status, 403, 'a non-owner cannot apply an estate-wide hiding');
    assert.equal((await res.json()).error, 'needs_personal_sign_in');
  } finally { notOwner.close(); }
  // The owner, elevated, clears the gate (then stops on the missing checkId, not 403).
  const owner = mk({ isOwner: true, elevated: true });
  await new Promise((r) => owner.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${owner.address().port}/api/admin/narrowing/apply`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    assert.notEqual(res.status, 403, 'the elevated owner is past the sign-in gate');
    assert.equal((await res.json()).error, 'check_required', 'and is asked for a completed check');
  } finally { owner.close(); }
});

// ---------------------------------------------------------------------------
// Part B — the clustering follow-ups (Codex, second pass)
// ---------------------------------------------------------------------------

test('Part B (Codex #1): a cluster whose twin is filed as a museum is never a candidate (not hidden)', async () => {
  const { rows: [reg] } = await query('select slug from regions limit 1');
  // A church ref and its linked twin, where the TWIN is filed as a museum. The
  // single-ref test would keep the church a candidate; the cluster-wide test must
  // not, or applying it would hide the museum twin via HIDDEN_REFS.
  await seedPlace('google:cm_church', { subcategory: 'churches', record: { name: 'St Museum' } });
  await seedPlace('wikidata:Qcm9090', { subcategory: 'museums', record: { name: 'St Museum Collection' } });
  await query(`insert into provider_matches (source, source_ref, venue_ref, missing) values ('google','cm_church','wikidata:Qcm9090', false) on conflict do nothing`);
  const run = await surfacing.runSurfacingCheck({ by: 'test' });
  await surfacing.applySurfacing({ by: 'test', checkId: run.checkId });
  const hidden = await placeStatus.hiddenAmong(['google:cm_church', 'wikidata:Qcm9090']);
  assert.equal(hidden.size, 0, 'the place surfaces as a museum elsewhere — neither ref is hidden');
});

test('Part B (Codex #2): a determination matching only an attraction external_ref hides every alias', async () => {
  const { rows: [reg] } = await query('select slug from regions limit 1');
  // An attraction linked to the census id ONLY by external_ref (no venue_ref).
  const { rows: [a] } = await query(
    `insert into attractions (region_slug, name, slug, external_ref) values ($1, 'Ext Only', 'ext-only-chk', 'google:ext_only') returning id`, [reg.slug]);
  await seedPlace('google:ext_only', { subcategory: 'churches', record: { name: 'Ext Only' } });
  const run = await surfacing.runSurfacingCheck({ by: 'test' });
  await surfacing.applySurfacing({ by: 'test', checkId: run.checkId });
  const hidden = await placeStatus.hiddenAmong(['google:ext_only', `atlas:${a.id}`]);
  assert.ok(hidden.has('google:ext_only'), 'the census id is hidden');
  assert.ok(hidden.has(`atlas:${a.id}`), 'and so is its atlas alias, reached via external_ref');
});

test('Part B (Codex D): reconsider via ANY alias resolves to the cluster root and un-hides', async () => {
  const { rows: [reg] } = await query('select slug from regions limit 1');
  // The determination is written on the census id; the twin gains evidence and
  // research lands under the TWIN's ref. Reconsider must resolve the alias to the
  // same place and update the one determination.
  await seedPlace('google:rc_poor', { subcategory: 'churches', record: { name: 'St RC' } });
  await query(`insert into attractions (region_slug, name, slug, venue_ref, wikidata_id) values ($1, 'St RC', 'st-rc-recon', 'wikidata:Qrc8888', 'Qrc8888') on conflict do nothing`, [reg.slug]);
  await query(`insert into provider_matches (source, source_ref, venue_ref, missing) values ('google','rc_poor','wikidata:Qrc8888', false) on conflict do nothing`);
  const run = await surfacing.runSurfacingCheck({ by: 'test' });
  await surfacing.applySurfacing({ by: 'test', checkId: run.checkId });
  assert.ok((await placeStatus.hiddenAmong(['google:rc_poor'])).has('google:rc_poor'), 'held back at first');
  // Evidence arrives on the twin; reconsider is called under the TWIN's alias.
  await query(`update attractions set wikipedia_url = 'https://en.wikipedia.org/wiki/st_rc' where wikidata_id = 'Qrc8888'`);
  const r = await surfacing.reconsider('wikidata:Qrc8888');
  assert.equal(r.surfaced, true, 'the alias resolves to the place and it surfaces');
  assert.equal((await placeStatus.hiddenAmong(['google:rc_poor'])).size, 0, 'the one determination under the census id is updated');
});

test('Part B (Codex B): two primary refs of one place yield ONE determination (no double-count)', async () => {
  const { rows: [reg] } = await query('select slug from regions limit 1');
  // One attraction, two census ids — its venue_ref and its external_ref — both
  // filed primary as a church, neither notable.
  await seedPlace('google:tp_a', { subcategory: 'churches', record: { name: 'Twin Primary' } });
  await seedPlace('google:tp_b', { subcategory: 'churches', record: { name: 'Twin Primary' } });
  await query(`insert into attractions (region_slug, name, slug, venue_ref, external_ref) values ($1, 'Twin Primary', 'twin-primary-tp', 'google:tp_a', 'google:tp_b') on conflict do nothing`, [reg.slug]);
  const run = await surfacing.runSurfacingCheck({ by: 'test' });
  await surfacing.applySurfacing({ by: 'test', checkId: run.checkId });
  const { rows: [{ n }] } = await query(
    `select count(*)::int n from place_surfacing where venue_ref in ('google:tp_a','google:tp_b') and not surfaced`);
  assert.equal(n, 1, 'one physical place, one not-surfaced determination');
  const hidden = await placeStatus.hiddenAmong(['google:tp_a', 'google:tp_b']);
  assert.ok(hidden.has('google:tp_a') && hidden.has('google:tp_b'), 'both census ids are hidden from the one determination');
});

test('Part B (Codex E): the run reservation is DB-level — a second concurrent reservation is refused', async () => {
  const id = await surfacing.startCheck({ by: 'e1' });
  // A second instance's reservation, while the first still runs, is refused by the
  // single-running unique index (not an in-memory flag).
  await assert.rejects(surfacing.startCheck({ by: 'e2' }), (e) => e && e.code === '23505');
  await surfacing.finishCheck(id, { counts: {} });
  // Slot freed — a reservation succeeds again.
  const id2 = await surfacing.startCheck({ by: 'e3' });
  await surfacing.finishCheck(id2, { counts: {} });
});

test('Part B (Codex #4): two concurrent /check calls do not split a run', async () => {
  const express = (await import('express')).default;
  const { narrowingRoutes } = await import('../src/routes/narrowing.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.access = { doors: ['client', 'admin'], role: { key: 'owner' }, capabilities: new Set(['manage_settings', 'view_library']), isOwner: true, elevated: true };
    req.session = { kind: 'device' };
    req.account = { email: 'owner@epic.day' };
    next();
  });
  app.use('/api/admin/narrowing', narrowingRoutes);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const url = `http://127.0.0.1:${server.address().port}/api/admin/narrowing/check`;
  try {
    const [a, b] = await Promise.all([
      fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
      fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
    ]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [202, 409], 'exactly one check starts; the other is refused');
    // Let the started run finish so it does not leak into the next test.
    for (let i = 0; i < 200 && await surfacing.runningCheck(); i += 1) await new Promise((r) => setTimeout(r, 25));
    await new Promise((r) => setTimeout(r, 60));
  } finally { server.close(); }
});

// ---------------------------------------------------------------------------
// Part B — preview == check, transitive hiding, and count invalidation (Codex P2)
// ---------------------------------------------------------------------------

test('Part B (Codex): the preview judges across the whole cluster, so cultureTotal matches the check', async () => {
  const { rows: [reg] } = await query('select slug from regions limit 1');
  // An evidence-poor church, provider-matched to a Wikidata attraction that holds
  // the article. The preview must read the twin's evidence (like the check), not
  // judge the filed ref alone.
  await seedPlace('google:pv_church', { subcategory: 'churches', record: { name: 'St Preview' } });
  await query(`insert into attractions (region_slug, name, slug, venue_ref, wikidata_id, wikipedia_url) values ($1,'St Preview','st-preview-pv','wikidata:Qpv1234','Qpv1234','https://en.wikipedia.org/wiki/st_preview') on conflict do nothing`, [reg.slug]);
  await query(`insert into provider_matches (source, source_ref, venue_ref, missing) values ('google','pv_church','wikidata:Qpv1234', false) on conflict do nothing`);
  const run = await surfacing.runSurfacingCheck({ by: 'test' });
  const out = await narrowing.narrowingPreview({ scope: 'estate' });
  // The preview holds back exactly the places the check marks not-surfaced.
  assert.equal(out.cultureTotal.now - out.cultureTotal.after, run.notSurfaced, 'preview held-back == check not-surfaced');
  const { rows: pv } = await query(`select surfaced from place_surfacing where venue_ref = 'google:pv_church'`);
  assert.ok(pv.length && pv[0].surfaced === true, 'the church surfaces on its linked twin’s article');
});

test('Part B (Codex): HIDDEN_REFS is transitive — a 3-hop alias graph is fully hidden after apply', async () => {
  const { rows: [reg] } = await query('select slug from regions limit 1');
  // google:h0 —provider_match→ wikidata:Qh1 —(attraction A1)→ osm:way/h2 —(attraction A2)→ wikidata:Qh3.
  await seedPlace('google:h0', { subcategory: 'churches', record: { name: 'Hop Zero' } });
  await query(`insert into provider_matches (source, source_ref, venue_ref, missing) values ('google','h0','wikidata:Qh1', false) on conflict do nothing`);
  await query(`insert into attractions (region_slug, name, slug, wikidata_id, osm_ref) values ($1,'Hop A1','hop-a1','Qh1','way/h2') on conflict do nothing`, [reg.slug]);
  await query(`insert into attractions (region_slug, name, slug, wikidata_id, osm_ref) values ($1,'Hop A2','hop-a2','Qh3','way/h2') on conflict do nothing`, [reg.slug]);
  const run = await surfacing.runSurfacingCheck({ by: 'test' });
  await surfacing.applySurfacing({ by: 'test', checkId: run.checkId });
  const hidden = await placeStatus.hiddenAmong(['google:h0', 'wikidata:Qh1', 'osm:way/h2', 'wikidata:Qh3']);
  assert.ok(hidden.has('google:h0'), 'the seed is hidden');
  assert.ok(hidden.has('wikidata:Qh1'), 'hop 1 hidden');
  assert.ok(hidden.has('osm:way/h2'), 'hop 2 hidden');
  assert.ok(hidden.has('wikidata:Qh3'), 'hop 3 (the far alias) hidden by the recursive closure');
});

test('Part B (Codex): onResurfaced invalidates counts/cache only when it un-hides an applied place', async () => {
  await seedPlace('google:inv_x', { subcategory: 'churches', record: { name: 'St Invalidate' } });
  const run = await surfacing.runSurfacingCheck({ by: 'test' });
  await surfacing.applySurfacing({ by: 'test', checkId: run.checkId });
  assert.ok((await placeStatus.hiddenAmong(['google:inv_x'])).has('google:inv_x'), 'applied-hidden first');
  let calls = 0;
  // Research that changes nothing: still not notable, nothing un-hidden, no invalidation.
  await surfacing.onResearched('google:inv_x', { invalidate: () => { calls += 1; } });
  assert.equal(calls, 0, 'no un-hide, no invalidation');
  // Evidence arrives → un-hide → the invalidation hook fires once.
  await query(`update place_records set wikipedia_url = 'https://en.wikipedia.org/wiki/inv' where venue_ref = 'google:inv_x'`);
  const r = await surfacing.onResearched('google:inv_x', { invalidate: () => { calls += 1; } });
  assert.equal(r.unhid, true, 'the applied hidden place was un-hidden');
  assert.equal(calls, 1, 'un-hiding invalidates the counts and collections cache');
  assert.equal((await placeStatus.hiddenAmong(['google:inv_x'])).size, 0, 'and it is shown again');
});

// ---------------------------------------------------------------------------
// Part B — one live row per cluster, check-driven un-hide, transitive Closed marker
// ---------------------------------------------------------------------------

test('Part B (Codex): one live row per cluster — a representative change then research still un-hides', async () => {
  const { rows: [reg] } = await query('select slug from regions limit 1');
  // Two census ids of one place, linked by one attraction; rp0 sorts first.
  await seedPlace('google:rp0', { subcategory: 'churches', record: { name: 'Rep Change' } });
  await seedPlace('google:rpA', { subcategory: 'churches', record: { name: 'Rep Change' } });
  await query(`insert into attractions (region_slug, name, slug, venue_ref, external_ref) values ($1,'Rep Change','rep-change-rc','google:rp0','google:rpA') on conflict do nothing`, [reg.slug]);
  let run = await surfacing.runSurfacingCheck({ by: 'test' });
  await surfacing.applySurfacing({ by: 'test', checkId: run.checkId });
  assert.ok((await placeStatus.hiddenAmong(['google:rp0'])).has('google:rp0'), 'hidden on the first representative');
  // A category edit fences the old representative; the next check moves the row.
  await query(`update place_index set not_in_epic_at = now() where venue_ref = 'google:rp0'`);
  run = await surfacing.runSurfacingCheck({ by: 'test' });
  const { rows: live } = await query(`select venue_ref, surfaced, applied from place_surfacing where venue_ref in ('google:rp0','google:rpA')`);
  assert.equal(live.length, 1, 'one live determination for the cluster — the obsolete row is gone');
  assert.equal(live[0].venue_ref, 'google:rpA');
  assert.equal(live[0].surfaced, false);
  assert.equal(live[0].applied, true, 'the owner’s OK carried to the new representative');
  assert.ok((await placeStatus.hiddenAmong(['google:rpA'])).has('google:rpA'), 'still hidden across the move');
  // Evidence arrives; research lands under the OLD alias — the place actually shows.
  await query(`update attractions set wikipedia_url = 'https://en.wikipedia.org/wiki/rep_change' where slug = 'rep-change-rc'`);
  const r = await surfacing.reconsider('google:rp0');
  assert.equal(r.surfaced, true, 'reconsider updates the active row, not an obsolete one');
  assert.equal((await placeStatus.hiddenAmong(['google:rp0', 'google:rpA'])).size, 0, 'the place is actually visible');
});

test('Part B (Codex): a check that un-hides applied places calls the same invalidation apply uses', async () => {
  await seedPlace('google:inv2_x', { subcategory: 'churches', record: { name: 'St Check Invalidate' } });
  let run = await surfacing.runSurfacingCheck({ by: 'test' });
  await surfacing.applySurfacing({ by: 'test', checkId: run.checkId });
  assert.ok((await placeStatus.hiddenAmong(['google:inv2_x'])).has('google:inv2_x'), 'applied-hidden first');
  // Refiled to a comparator: the next full check restores it, and must invalidate
  // the counts/cache — not wait for an unrelated refresh.
  await query(`update place_index set subcategory = 'museums' where venue_ref = 'google:inv2_x'`);
  let calls = 0;
  run = await surfacing.runSurfacingCheck({ by: 'test', invalidate: () => { calls += 1; } });
  assert.ok(run.restored >= 1, 'the rerun restored it');
  assert.ok(run.unhid >= 1, 'an applied hidden place was un-hidden');
  assert.equal(calls, 1, 'the check invalidated collections/region/ring counts once');
  assert.equal((await placeStatus.hiddenAmong(['google:inv2_x'])).size, 0);
});

test('Part B (Codex): a 3-hop chain’s far alias still resolves its Closed marker (saved list)', async () => {
  const { rows: [reg] } = await query('select slug from regions limit 1');
  // google:c0hop (permanently closed, applied) —PM— wikidata:Qch1 —A1— osm:way/c2hop —A2— wikidata:Qch3.
  await query(`insert into provider_matches (source, source_ref, venue_ref, missing) values ('google','c0hop','wikidata:Qch1', false) on conflict do nothing`);
  await query(`insert into attractions (region_slug, name, slug, wikidata_id, osm_ref) values ($1,'Closed A1','closed-a1-hop','Qch1','way/c2hop') on conflict do nothing`, [reg.slug]);
  await query(`insert into attractions (region_slug, name, slug, wikidata_id, osm_ref) values ($1,'Closed A2','closed-a2-hop','Qch3','way/c2hop') on conflict do nothing`, [reg.slug]);
  await placeStatus.propose({ ref: 'google:c0hop', status: 'permanently_closed', confirmed: true, source: 'osm', reason: 'gone', evidence: 'tag', applied: true });
  // SHOWN_REF hides the far alias…
  assert.ok((await placeStatus.hiddenAmong(['wikidata:Qch3'])).has('wikidata:Qch3'), 'the far alias is hidden');
  // …and the saved list resolves its Closed marker through the same transitive walk.
  const marks = await placeStatus.markedAmong(['wikidata:Qch3']);
  const mark = marks.get('wikidata:Qch3');
  assert.ok(mark, 'the far alias carries its Closed mark');
  assert.equal(mark.status, 'permanently_closed');
  assert.equal(mark.hidden, true);
});

test('an attraction whose osm_ref is stored as relation/N is reached from an osm:relation/N seed (Codex)', async () => {
  // The hidden row is keyed by the relation spelling; the attraction stores
  // 'relation/909090' and carries a wikidata alias that must hide with it.
  const { rows: [reg] } = await query('select slug from regions limit 1');
  await query(`insert into attractions (region_slug, name, slug, external_ref, wikidata_id, osm_ref)
                 values ($1, 'Relation Keyed', 'nw-relkey', 'wikidata:Q955001', 'Q955001', 'relation/909090')
                 on conflict do nothing`, [reg.slug]);
  // The live alias walk now serves the C57 closed branch only (a surfacing row
  // hides its judged snapshot, never a live expansion), so the osm-spelling walk
  // is exercised through an applied closure seeded in the relation spelling.
  await placeStatus.propose({ ref: 'osm:relation/909090', status: 'permanently_closed', confirmed: true, source: 'osm', reason: 'gone', evidence: 'tag', applied: true });
  const hidden = await placeStatus.hiddenAmong(['wikidata:Q955001', 'osm:909090', 'osm:relation/909090']);
  assert.ok(hidden.has('osm:relation/909090'), 'the seed spelling itself');
  assert.ok(hidden.has('osm:909090'), 'the bare spelling');
  assert.ok(hidden.has('wikidata:Q955001'), 'the wikidata alias through the relation-stored osm_ref');
  await query(`delete from place_status where venue_ref = 'osm:relation/909090'`);
});

test('the determination walk reaches both osm spellings too, so it judges the same set hiding expands (Codex)', async () => {
  // An attraction storing osm_ref 'relation/919191': a seed in the bare
  // spelling must join the relation spelling and the wikidata alias, exactly
  // as HIDDEN_REFS does — otherwise evidence on one spelling is missed while
  // a determination on the other hides it.
  const { rows: [reg] } = await query('select slug from regions limit 1');
  await query(`insert into attractions (region_slug, name, slug, external_ref, wikidata_id, osm_ref)
                 values ($1, 'Relation Walk', 'nw-relwalk', 'wikidata:Q955101', 'Q955101', 'relation/919191')
                 on conflict do nothing`, [reg.slug]);
  const { rootOf } = await narrowing.aliasClosure(['osm:919191']);
  const root = rootOf.get('osm:919191');
  assert.ok(root, 'the bare seed is in the closure');
  assert.equal(rootOf.get('osm:relation/919191'), root, 'the relation spelling is the same place');
  assert.equal(rootOf.get('wikidata:Q955101'), root, 'and so is the wikidata alias');
});

// ---------------------------------------------------------------------------
// Part B — the surfacing hide is the judged SNAPSHOT, never a live expansion (Codex P1)
// ---------------------------------------------------------------------------

test('Part B (Codex): an applied determination hides exactly the snapshot of refs it judged', async () => {
  const { rows: [reg] } = await query('select slug from regions limit 1');
  await seedPlace('google:sn_judged', { subcategory: 'churches', record: { name: 'St Snapshot' } });
  const { rows: [a] } = await query(
    `insert into attractions (region_slug, name, slug, external_ref, wikidata_id) values ($1,'St Snapshot','st-snapshot-sn','google:sn_judged','Qsn5050') returning id`, [reg.slug]);
  const run = await surfacing.runSurfacingCheck({ by: 'test' });
  await surfacing.applySurfacing({ by: 'test', checkId: run.checkId });
  const { rows } = await query(`select member_ref from place_surfacing_members where venue_ref = 'google:sn_judged'`);
  const snap = new Set(rows.map((r) => r.member_ref));
  for (const ref of ['google:sn_judged', `atlas:${a.id}`, 'wikidata:Qsn5050']) {
    assert.ok(snap.has(ref), `${ref} is in the judged snapshot`);
  }
  const hidden = await placeStatus.hiddenAmong(['google:sn_judged', `atlas:${a.id}`, 'wikidata:Qsn5050']);
  assert.equal(hidden.size, 3, 'every judged alias is hidden');
});

test('Part B (Codex): an alias linked AFTER the check stays visible until a check judges it; filed elsewhere → restored', async () => {
  // A held-back church, applied.
  await seedPlace('google:sn_church', { subcategory: 'churches', record: { name: 'St Later' } });
  let run = await surfacing.runSurfacingCheck({ by: 'test' });
  await surfacing.applySurfacing({ by: 'test', checkId: run.checkId });
  assert.ok((await placeStatus.hiddenAmong(['google:sn_church'])).has('google:sn_church'), 'held back');

  // After the check: a newly harvested museum gets provider-matched to the church.
  await seedPlace('wikidata:Qsnmus', { subcategory: 'museums', record: { name: 'Later Museum' } });
  await query(`insert into provider_matches (source, source_ref, venue_ref, missing) values ('google','sn_church','wikidata:Qsnmus', false) on conflict do nothing`);
  let hidden = await placeStatus.hiddenAmong(['google:sn_church', 'wikidata:Qsnmus']);
  assert.ok(hidden.has('google:sn_church'), 'the judged church is still held back');
  assert.ok(!hidden.has('wikidata:Qsnmus'), 'the museum linked after the check does NOT disappear');

  // The next check re-judges the enlarged cluster: a member is filed as a museum,
  // so the cluster is no longer a candidate and is restored.
  run = await surfacing.runSurfacingCheck({ by: 'test' });
  assert.ok(run.restored >= 1);
  hidden = await placeStatus.hiddenAmong(['google:sn_church', 'wikidata:Qsnmus']);
  assert.equal(hidden.size, 0, 'the enlarged cluster surfaces as a museum — both visible');
  const { rows: [{ n }] } = await query(`select count(*)::int n from place_surfacing_members where venue_ref = 'google:sn_church'`);
  assert.equal(n, 0, 'a surfaced row carries no snapshot');
});

test('Part B (Codex): a new plain alias is visible until the next check, which judges it into the snapshot', async () => {
  await seedPlace('google:sn_grow', { subcategory: 'churches', record: { name: 'St Enlarge' } });
  let run = await surfacing.runSurfacingCheck({ by: 'test' });
  await surfacing.applySurfacing({ by: 'test', checkId: run.checkId });
  // A plain (unfiled, evidence-free) alias is linked after the check.
  await query(`insert into provider_matches (source, source_ref, venue_ref, missing) values ('google','sn_grow','wikidata:Qsngrow', false) on conflict do nothing`);
  assert.ok(!(await placeStatus.hiddenAmong(['wikidata:Qsngrow'])).has('wikidata:Qsngrow'), 'visible before any check judges it');
  // The next check judges the enlarged cluster: still not notable, not filed elsewhere.
  run = await surfacing.runSurfacingCheck({ by: 'test' });
  const hidden = await placeStatus.hiddenAmong(['google:sn_grow', 'wikidata:Qsngrow']);
  assert.ok(hidden.has('google:sn_grow') && hidden.has('wikidata:Qsngrow'), 'now judged, the alias joins the snapshot and is held back with the place');
});

test('Part B (Codex): a snapshot that grows invalidates the family counts, not only an un-hide', async () => {
  await seedPlace('google:sn_inval', { subcategory: 'churches', record: { name: 'St Recount' } });
  let run = await surfacing.runSurfacingCheck({ by: 'test', invalidate: async () => {} });
  await surfacing.applySurfacing({ by: 'test', checkId: run.checkId });
  await query(`insert into provider_matches (source, source_ref, venue_ref, missing) values ('google','sn_inval','wikidata:Qsninval', false) on conflict do nothing`);
  let calls = 0;
  run = await surfacing.runSurfacingCheck({ by: 'test', invalidate: async () => { calls += 1; } });
  assert.ok(run.hiddenGrew >= 1, 'the applied hidden set grew by the newly judged alias');
  assert.equal(calls, 1, 'and that change invalidated the caches and counts once');
  assert.ok((await placeStatus.hiddenAmong(['wikidata:Qsninval'])).has('wikidata:Qsninval'));
});

test('Part B (Codex): apply refuses while a check is running, under the shared lock', async () => {
  const done = await surfacing.startCheck({ by: 'test' });
  await surfacing.finishCheck(done, { counts: {} });
  const running = await surfacing.startCheck({ by: 'test' });
  try {
    const out = await surfacing.applySurfacing({ by: 'test', checkId: done });
    assert.equal(out.error, 'check_running', 'a running check blocks the apply rather than racing it');
    assert.equal(out.running, running);
  } finally {
    await surfacing.finishCheck(running, { counts: {} });
  }
  const ok = await surfacing.applySurfacing({ by: 'test', checkId: done });
  assert.equal(ok.error, undefined, 'once the running check finishes, the completed one applies');
});
