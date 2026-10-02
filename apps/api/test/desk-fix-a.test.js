import { test } from 'node:test';
import assert from 'node:assert/strict';

// The fix pass after the design audit (28 Sep 2026), agent A: the location
// filter's can't-speak state, Changes' search and person list, the Sources
// table's own failure rate and the families' "—", Dropped's two weeks across
// a month boundary, Fact automations' four header counts, Overview's seven
// growth points, and Accuracy's names for a constant first column.
// A database of this file's own, built from the committed migrations.
import { testDatabase } from './helpers/db.js';
const { query, pool } = await testDatabase();
const location = await import('../src/desk/location.js');
const changes = await import('../src/desk/changes.js');
const verification = await import('../src/desk/verification.js');
const accuracy = await import('../src/desk/accuracy.js');
const { overview } = await import('../src/desk/overview.js');

test.after(() => pool.end());

test('a count under the location filter never says a confident 0 it cannot stand behind', () => {
  const { countOf, filterSays } = location;
  assert.deepEqual(countOf(5, null), { n: 5, atLeast: false, approx: false, speaks: true }, 'no filter: the estate, exact');
  const clean = { speaks: true, capped: false, unresolved: 0, unresolvedBy: {}, unplaceable: 0, uncovered: [], atLeast: false };
  assert.deepEqual(countOf(0, clean), { n: 0, atLeast: false, approx: false, speaks: true }, 'a censused ring with nothing in it is a real 0');
  const blind = { ...clean, speaks: false, atLeast: true, uncovered: ['ZZ9'] };
  assert.equal(countOf(0, blind).n, null, 'no census: 0 is "we cannot tell", drawn —');
  assert.equal(countOf(0, blind).speaks, false);
  assert.deepEqual(countOf(3, blind), { n: 3, atLeast: true, approx: false, speaks: false }, 'no census: what was seen is a floor');
  const edge = { ...clean, unresolved: 4, unresolvedBy: { food: 4 }, atLeast: true };
  assert.equal(countOf(7, edge, { category: 'food' }).atLeast, true, 'places on the edge make that category a floor');
  assert.equal(countOf(7, edge, { category: 'sport' }).atLeast, false, 'but not a category with nobody on the edge');
  assert.equal(countOf(7, { ...clean, capped: true, atLeast: true }).atLeast, true, '120 minutes is counted at 90: at least');
  assert.deepEqual(filterSays(null), {});
  assert.equal(filterSays(blind).speaks, false);
  assert.equal(filterSays(blind).why, 'The census has not covered this area yet');
  assert.match(filterSays(edge).why, /4 places on the edge could be either side/);
});

test('a ring whose districts the census never covered cannot speak; one it covered can', async () => {
  await query(`delete from postcodes where outcode = 'ZX9'`);
  await query(`insert into postcodes (pcds, sector, outcode, lat, lng, source) values
    ('ZX9 1AA', 'ZX9 1', 'ZX9', 60.3, -1.3, 'test'), ('ZX9 1AB', 'ZX9 1', 'ZX9', 60.3002, -1.3002, 'test')`);
  await query(`insert into geo_cells (code, scheme, label, outcode, lat, lng, source) values ('sector:ZX9 1', 'sector', 'ZX9 1', 'ZX9', 60.3001, -1.3001, 'test')
               on conflict (code) do nothing`);
  await query(`delete from area_counts where area_slug = 'zx9'`);
  const before = await location.resolveLocation({ where: 'ZX9', minutes: 30, mode: 'car' });
  assert.equal(before.unknown, undefined);
  assert.equal(before.speaks, false, 'no census of ZX9: the counts cannot speak');
  assert.equal(before.atLeast, true);
  assert.deepEqual(before.uncovered, ['ZX9']);
  await query(`insert into area_counts (country_code, area_slug, category, subcategory, census_count) values ('GB', 'zx9', 'fun', 'desk-fixa', 0)`);
  const after = await location.resolveLocation({ where: 'ZX9', minutes: 30, mode: 'car' });
  assert.equal(after.speaks, true, 'censused: a 0 there is a real 0');
  assert.deepEqual(after.uncovered, []);
  assert.equal(typeof after.unresolved, 'number');
  const transit = await location.resolveLocation({ where: 'ZX9', minutes: 30, mode: 'transit' });
  assert.equal(transit.approx, true, 'public transport is approximated and says so');
  await query(`delete from area_counts where area_slug = 'zx9'`);
  await query(`delete from postcodes where outcode = 'ZX9'`);
  await query(`delete from geo_cells where code = 'sector:ZX9 1'`);
});

test('Changes finds a change by who made it and by its area, and lists people alphabetically', async () => {
  await query(`delete from bo_changes where who like 'fixa-%'`);
  await changes.logChange({ who: 'fixa-zed@epic', area: 'Mapping', what: 'Google word · fixa_word · Kept' });
  await changes.logChange({ who: 'fixa-amy@epic', area: 'Collections', what: 'Collection title · Fix A' });
  await changes.logChange({ who: 'fixa-amy@epic', area: 'Collections', what: 'Collection copy · Fix A' });
  const byWho = await changes.changes({ q: 'fixa-zed' });
  assert.deepEqual(byWho.rows.map((r) => r.who), ['fixa-zed@epic'], 'search matches who');
  const byArea = await changes.changes({ q: 'collections' });
  assert.ok(byArea.rows.some((r) => r.who === 'fixa-amy@epic'), 'search matches the area');
  const mine = byArea.people.filter((p) => p.startsWith('fixa-'));
  assert.deepEqual(mine, ['fixa-amy@epic', 'fixa-zed@epic'], 'alphabetical, not by how many changes');
  const all = (await changes.changes({})).people;
  assert.deepEqual(all, [...all].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())));
  await query(`delete from bo_changes where who like 'fixa-%'`);
});

test('Failing % is the verify step’s own fetches, and silent families are "—", not Healthy', async () => {
  const cfg = { sourceSlow: 5, sourceFailing: 15 };
  await query(`delete from place_fact_evidence where venue_ref like 'fixa:%'`);
  await query(`delete from family_answers where answered_at >= now() - interval '7 days'`);
  await query(`delete from provider_calls where purpose in ('fact-verify', 'fixa-research')`);
  await query(`insert into place_fact_evidence (venue_ref, attribute_key, source, says) values
               ('fixa:1', 'toilets', 'osm', 'yes'), ('fixa:1', 'toilets', 'wikidata', 'nothing'), ('fixa:1', 'toilets', 'site', 'yes')`);
  // Somebody else's calls to Wikidata — research, not the check — all failing.
  const { rows: [s] } = await query(`select id from sessions limit 1`).catch(() => ({ rows: [] }));
  if (s) {
    await query(`insert into provider_calls (session_id, provider, purpose, ok, failed) select $1, 'wikidata', 'fixa-research', false, 1 from generate_series(1, 5)`, [s.id]);
  }
  // The check's own fetches: 1 of 4 failed.
  await verification.noteFetch('wikidata', true);
  await verification.noteFetch('wikidata', true);
  await verification.noteFetch('wikidata', true);
  await verification.noteFetch('wikidata', false, { fault: 'timeout' });
  const srcs = await verification.sources(cfg);
  const by = Object.fromEntries(srcs.map((x) => [x.source, x]));
  assert.equal(by.wikidata.failingPct, 25, 'the verify step’s own fetches, not every call to Wikidata');
  assert.equal(by.wikidata.status, 'Failing');
  assert.equal(by.site.failingPct, null, 'the venue page is read from the copy Epic holds: nothing fetched');
  assert.match(by.site.failingWhy, /nothing fetched/);
  assert.equal(by.site.status, 'Healthy');
  assert.equal(by.families.status, '—', 'families checked nothing while machine sources ran: can’t speak');
  assert.equal(by.families.note, 'no family answers this week');
  assert.notEqual(by.families.status, 'Failing');
  await query(`delete from place_fact_evidence where venue_ref like 'fixa:%'`);
  await query(`delete from provider_calls where purpose in ('fact-verify', 'fixa-research')`);
});

test('Dropped this week and the week before come from their own fortnight, not this month', async () => {
  await query(`delete from fact_checks where venue_ref like 'fixa:%'`);
  // One dropped 10 days ago — last month for the first ten days of any month.
  await query(`insert into fact_checks (venue_ref, feature, outcome, at) values
               ('fixa:d1', 'Sauna', 'dropped', now() - interval '10 days'),
               ('fixa:d2', 'Sauna', 'dropped', now() - interval '2 days'),
               ('fixa:v1', 'Sauna', 'verified', now() - interval '1 hour')`);
  const v = await verification.verification({ period: '7d' });
  assert.ok(v.dropped.weekBefore >= 1, 'ten days ago is the week before, whatever month it fell in');
  assert.ok(v.dropped.thisWeek >= 1);
  await query(`delete from fact_checks where venue_ref like 'fixa:%'`);
});

test('Fact automations’ header counts, and the month drill-downs they open', async () => {
  await query(`delete from fact_checks where venue_ref like 'fixa:%'`);
  const before = await verification.monthResults();
  await query(`insert into fact_checks (venue_ref, feature, outcome, at) values
               ('fixa:m1', 'Sauna', 'verified', now()), ('fixa:m2', 'Sauna', 'dont_know', now()), ('fixa:m3', 'Sauna', 'verified', now())`);
  const after = await verification.monthResults();
  assert.equal(after.verified - before.verified, 2);
  assert.equal(after.dontKnow - before.dontKnow, 1);
  assert.equal(typeof after.conflicts, 'number');
  assert.equal(typeof after.backlog, 'number');
  const drill = await verification.items({ kind: 'confirmed', period: 'month' });
  assert.deepEqual(drill.rows.filter((r) => String(r.ref).startsWith('fixa:')).map((r) => r.ref).sort(), ['fixa:m1', 'fixa:m3']);
  const dk = await verification.items({ kind: 'nothingFound', period: 'month' });
  assert.deepEqual(dk.rows.filter((r) => String(r.ref).startsWith('fixa:')).map((r) => r.ref), ['fixa:m2']);
  await query(`delete from fact_checks where venue_ref like 'fixa:%'`);
});

test('Overview’s growth lines are seven weekly points, and the words say six weeks', async () => {
  const o = await overview();
  for (const g of ['places', 'facts', 'households']) assert.equal(o.growth[g].series.length, 7, `${g}: seven points`);
  assert.match(o.growth.places.line, / in 6 weeks$/);
});

test('Accuracy names every fact, category and subcategory it could show, whatever the view', async () => {
  const a = await accuracy.accuracy({ view: 'category', source: 'wikidata' });
  assert.ok(Array.isArray(a.names.facts));
  assert.ok(Array.isArray(a.names.categories));
  assert.ok(Array.isArray(a.names.subcategories));
  const b = await accuracy.accuracy({ view: 'fact' });
  assert.deepEqual(a.names, b.names, 'the same names, so the first column does not move');
});
