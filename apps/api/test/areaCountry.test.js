/**
 * An area belongs to a country (markets step 6; migration 357; owner, 2 Oct 2026).
 *
 * W12 is a London outcode and a Dublin-area Eircode routing key. Before this, one
 * slug held both: an Irish place filed under `w12` sat on a London district's board,
 * and an Irish census would have overwritten London's counts. Now a non-GB area's
 * slug carries its country (`ie-w12`), `area_counts` keys on the country, and a
 * postcode decides a country by one rule — a full ONS postcode is GB whatever the
 * stamp said, an outcode alone only fills a missing country.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const index = await import('../src/repositories/placeIndex.js');
const { ensureLocality } = await import('../src/sources/localities.js');
const admission = await import('../src/sources/admission.js');
const { ownedCostBand } = await import('../src/repositories/questionSets.js');
test.after(() => pool.end());

test('two markets may count an area with the same slug, and a count must say whose it is', async () => {
  await query(`insert into area_counts (country_code, area_slug, category, subcategory, census_count) values
               ('GB', 'w12', 'fun', 'zoos-wildlife', 3), ('IE', 'w12', 'fun', 'zoos-wildlife', 9)`);
  const { rows } = await query(`select country_code, census_count from area_counts where area_slug = 'w12' order by 1`);
  assert.deepEqual(rows.map((r) => [r.country_code, r.census_count]), [['GB', 3], ['IE', 9]], 'neither overwrote the other');
  await assert.rejects(
    () => query(`insert into area_counts (area_slug, category, subcategory, census_count) values ('w13', 'fun', 'zoos-wildlife', 1)`),
    /null value in column "country_code"/, 'a writer that forgets the country fails, never files under GB');
});

test('a locality outside GB is created under its country\'s prefix; GB is unchanged', async () => {
  assert.equal(await ensureLocality({ name: 'Newport', kind: 'town' }), 'newport');
  assert.equal(await ensureLocality({ name: 'Newport', kind: 'town', countryCode: 'IE' }), 'ie-newport', 'two Newports, two rows');
  assert.equal(await ensureLocality({ name: 'IE', kind: 'country', countryCode: 'IE' }), 'ie', 'a country is its own code');
});

test('an Irish place on routing key W12 is filed under ie-w12, a London one under w12', async () => {
  const irish = 'osm:node/ac-dublin';
  const london = 'osm:node/ac-london';
  await index.noteMany([
    { ref: irish, lat: 53.35, lng: -6.26, countryCode: 'IE' },
    { ref: london, lat: 51.51, lng: -0.23, countryCode: 'GB' },
  ], { source: 'osm' });
  for (const [ref, pc, lat, lng] of [[irish, 'W12 X2Y3', 53.35, -6.26], [london, 'W12 7RJ', 51.51, -0.23]]) {
    await query(`insert into place_records (venue_ref, postcode, updated_at) values ($1,$2, now())
                 on conflict (venue_ref) do update set postcode = excluded.postcode`, [ref, pc]);
    await query(`insert into place_cells (venue_ref, cell, lat, lng) values ($1, null, $2, $3)
                 on conflict (venue_ref) do update set lat = excluded.lat, lng = excluded.lng`, [ref, lat, lng]);
  }
  await query('update place_index set placed_at = null, settle_tried_at = null where venue_ref = any($1)', [[irish, london]]);
  await index.settleNew();
  const areas = async (ref) => (await query(
    `select area_slug from place_areas where venue_ref = $1 and area_slug like '%w12' order by 1`, [ref])).rows.map((r) => r.area_slug);
  assert.deepEqual(await areas(irish), ['ie-w12'], 'the Dublin place is not on the London board');
  assert.deepEqual(await areas(london), ['w12']);
  const country = async (ref) => (await query('select country_code from place_index where venue_ref = $1', [ref])).rows[0].country_code;
  assert.equal(await country(irish), 'IE', 'and the settle did not make it GB from the shared outcode');
  // Filing made the district a row of its own, so it joins to something (Codex)…
  const { rows: [loc] } = await query(`select name, kind, country_code from localities where slug = 'ie-w12'`);
  assert.deepEqual(loc, { name: 'W12', kind: 'postcode', country_code: 'IE' });
  // …and what a person is shown and edits is the outcode, never the routing slug.
  const { OUTCODE_OF_LOCALITY } = index;
  const { rows: [shown] } = await query(
    `select ${OUTCODE_OF_LOCALITY('l')} as outcode from place_areas pa join localities l on l.slug = pa.area_slug
      where pa.venue_ref = $1 and l.kind = 'postcode'`, [irish]);
  assert.equal(shown.outcode, 'W12');
});

test('admission: a full ONS postcode settles GB over a stale stamp; an Eircode never does', async () => {
  await query(`insert into postcodes (pcds, sector, outcode, lat, lng, source)
               values ('ZA8 1AB', 'ZA8 1', 'ZA8', 51.5, -0.6, 'test') on conflict (pcds) do nothing`);
  const stale = 'osm:node/ac-adm-stale';
  const eire = 'osm:node/ac-adm-eire';
  for (const ref of [stale, eire]) await index.noteMany([{ ref, lat: 51.5, lng: -0.6, countryCode: 'IE' }], { source: 'osm' });
  // Codex asked four times for a GB postcode to override a stale stamp; with the
  // full-postcode rule that is safe, because no Eircode is an ONS postcode.
  assert.deepEqual(await admission.recordAdmissionAnswer(stale, { free: true }, { sourceUrl: 'https://x.example', postcode: 'ZA8 1AB' }),
    { state: 'answered', choice: 'free' });
  assert.equal(await ownedCostBand(stale), 'free');
  // The outcode ZA8 is GB's, but an outcode alone never overrides a set country.
  assert.equal(await admission.recordAdmissionAnswer(eire, { free: true }, { sourceUrl: 'https://x.ie', postcode: 'ZA8 X2Y3' }), null);
  assert.equal(await ownedCostBand(eire), null);
});

test('a full Eircode never fills a missing country from its routing key', async () => {
  // Codex: with no stamp, W12 X2Y3 missed the exact lookup and fell back to W12.
  await query(`insert into postcodes (pcds, sector, outcode, lat, lng, source)
               values ('W12 7RJ', 'W12 7', 'W12', 51.51, -0.23, 'test') on conflict (pcds) do nothing`);
  const ref = 'osm:node/ac-unstamped-eircode';
  await index.noteMany([{ ref, lat: 53.35, lng: -6.26 }], { source: 'osm' });
  await query('update place_index set country_code = null where venue_ref = $1', [ref]);
  await query(`insert into place_records (venue_ref, postcode, updated_at) values ($1, 'W12 X2Y3', now())
               on conflict (venue_ref) do update set postcode = excluded.postcode`, [ref]);
  await index.settleCountryFromPostcode([ref]);
  const { rows: [pi] } = await query('select country_code from place_index where venue_ref = $1', [ref]);
  assert.equal(pi.country_code, null, 'left unknown, not made GB');
  assert.equal(await index.postcodeSaysGb('W12 X2Y3', null), false);
  assert.equal(await index.postcodeSaysGb('W12', null), true, 'an outcode alone still fills');
  assert.equal(await index.postcodeSaysGb('W12 9ZZ', null), true, 'a GB-shaped postcode ONS has not loaded yet still fills');
});

test('a non-GB postcode locality stands for its outcode without the prefix', async () => {
  const { outcodeOfLocality } = await import('../src/repositories/localities.js');
  assert.equal(outcodeOfLocality({ slug: 'ie-w12', country_code: 'IE' }), 'W12');
  assert.equal(outcodeOfLocality({ slug: 'w12', country_code: 'GB' }), 'W12');
  // refreshCounts reads the same outcode: an IE district counts its own places.
  await query(`insert into localities (slug, name, kind, country_code) values ('ie-zq9', 'ZQ9', 'postcode', 'IE') on conflict (slug) do nothing`);
  await query(`insert into scout_areas (code, country_code, lat, lng) values ('ZQ9', 'IE', 53.3, -6.3) on conflict (code) do nothing`);
  await query(`insert into scout_places (area_code, venue_ref, name, rank, outcode, from_sources) values ('ZQ9', 'osm:node/ac-zq9', 'A place', 1, 'ZQ9', '["osm"]') on conflict do nothing`);
  const { refreshCounts } = await import('../src/sources/localities.js');
  await refreshCounts();
  const { rows: [l] } = await query(`select to_eat_count from localities where slug = 'ie-zq9'`);
  assert.equal(l.to_eat_count, 1);
});

test('a source area stamped abroad does not file a place the postcode rule settled in GB', async () => {
  // Codex: an IE-stamped scout area held a place whose own record says GB; filing by
  // the source area's country put it on the Irish board as well as the London one.
  const ref = 'osm:node/ac-scout-gb';
  await query(`insert into scout_areas (code, country_code, lat, lng) values ('ZQ7', 'IE', 53.3, -6.3) on conflict (code) do nothing`);
  await query(`insert into scout_places (area_code, venue_ref, name, rank, outcode, from_sources) values ('ZQ7', $1, 'A pub', 1, 'ZQ7', '["osm"]') on conflict do nothing`, [ref]);
  await index.noteMany([{ ref, lat: 51.5, lng: -0.2, countryCode: 'GB' }], { source: 'osm' });
  await query(`insert into place_cells (venue_ref, cell, lat, lng) values ($1, null, 51.5, -0.2)
               on conflict (venue_ref) do update set lat = excluded.lat, lng = excluded.lng`, [ref]);
  await query('update place_index set country_code = $2, placed_at = null, settle_tried_at = null where venue_ref = $1', [ref, 'GB']);
  await index.settleNew();
  const { rows } = await query(`select area_slug from place_areas where venue_ref = $1 and area_slug like '%zq7' order by 1`, [ref]);
  assert.deepEqual(rows.map((r) => r.area_slug), ['zq7'], 'filed under its own country, not the source area\'s');
});
