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
