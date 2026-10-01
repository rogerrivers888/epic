/**
 * A place's country from its own postcode (settleCountryFromPostcode; owner, 1 Oct
 * 2026, Option C). The durable postcode is owned and permanent where the coordinate
 * is rented and the country_code stamp is a copy, so its outcode's locality country
 * wins over a disagreeing stamp and fills a null one. Migration 310 does the same
 * one-time over the existing corpus; this exercises the ongoing path settle runs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const index = await import('../src/repositories/placeIndex.js');
const owned = await import('../src/repositories/ownedPlaces.js');
test.after(() => pool.end());

// A test outcode nobody's real data uses, with a chosen country, plus a place in
// place_index (the stamp) and a place_records postcode that resolves to it.
async function seed(ref, { stamp, postcode, outcode, outcodeCountry }) {
  await index.noteMany([{ ref, lat: 51.5, lng: -0.6, countryCode: stamp }], { source: 'osm' });
  if (outcode) {
    await query(
      `insert into localities (slug, name, kind, country_code) values ($1,$2,'postcode',$3)
       on conflict (slug) do update set country_code = excluded.country_code`,
      [outcode.toLowerCase(), outcode, outcodeCountry]);
  }
  if (postcode) {
    await query(
      `insert into place_records (venue_ref, postcode, updated_at) values ($1,$2, now())
       on conflict (venue_ref) do update set postcode = excluded.postcode`, [ref, postcode]);
  }
}
const countryOf = async (ref) => (await query('select country_code from place_index where venue_ref = $1', [ref])).rows[0]?.country_code ?? null;

test('the postcode wins over a disagreeing stamp — the place moves to the country ONS puts it in', async () => {
  const ref = 'osm:node/cfp-wrong';
  await seed(ref, { stamp: 'GB', postcode: 'ZZ1 1AA', outcode: 'ZZ1', outcodeCountry: 'IE' });
  const n = await index.settleCountryFromPostcode([ref]);
  assert.ok(n >= 1, 'it corrected the row');
  assert.equal(await countryOf(ref), 'IE', 'the ZZ1 outcode is in IE, so the GB stamp is overruled');
});

test('a null stamp is filled from the postcode', async () => {
  const ref = 'osm:node/cfp-null';
  await seed(ref, { stamp: null, postcode: 'ZZ2 3BB', outcode: 'ZZ2', outcodeCountry: 'GB' });
  await index.settleCountryFromPostcode([ref]);
  assert.equal(await countryOf(ref), 'GB');
});

test('an agreeing stamp, and a place with no postcode, are left alone', async () => {
  const agree = 'osm:node/cfp-agree';
  const nopc = 'osm:node/cfp-nopc';
  await seed(agree, { stamp: 'GB', postcode: 'ZZ3 4CC', outcode: 'ZZ3', outcodeCountry: 'GB' });
  await seed(nopc, { stamp: 'US', postcode: null });
  const n = await index.settleCountryFromPostcode([agree, nopc]);
  assert.equal(n, 0, 'nothing to correct: one agrees, one has no postcode');
  assert.equal(await countryOf(nopc), 'US', 'a place with no postcode keeps its stamp');
});

test('a postcode change requeues a placed row, so settle re-resolves its country', async () => {
  const ref = 'osm:node/cfp-requeue';
  await index.noteMany([{ ref, lat: 51.5, lng: -0.6, countryCode: 'GB' }], { source: 'osm' });
  await query(`insert into place_records (venue_ref, postcode, updated_at) values ($1,'ZZ8 1AA', now())
               on conflict (venue_ref) do update set postcode = excluded.postcode`, [ref]);
  await query('update place_index set placed_at = now() where venue_ref = $1', [ref]);
  // Changing the postcode through the owned-record writer must clear placed_at, or
  // settle (which only revisits placed_at-null rows) never re-resolves the country.
  await owned.writeRecord(ref, ['postcode'], ['ZZ9 2BB'], {}, {});
  const { rows: [pi] } = await query('select placed_at from place_index where venue_ref = $1', [ref]);
  assert.equal(pi.placed_at, null, 'the postcode change requeued the place for settling');
});

test('a UK outcode wrongly stamped non-GB is normalised, so its places resolve to GB', async () => {
  const ref = 'osm:node/cfp-legacy';
  // Legacy damage: a UK-format outcode locality the old edit path stamped IE.
  await query(`insert into localities (slug, name, kind, country_code) values ('zz5','ZZ5','postcode','IE')
               on conflict (slug) do update set country_code = 'IE'`);
  await index.noteMany([{ ref, lat: 51.5, lng: -0.6, countryCode: 'IE' }], { source: 'osm' });
  await query(`insert into place_records (venue_ref, postcode, updated_at) values ($1,'ZZ5 1AA', now())
               on conflict (venue_ref) do update set postcode = excluded.postcode`, [ref]);
  // Migration 310's normalisation: a UK-format postcode locality is GB by definition.
  await query(`update localities set country_code = 'GB'
                where kind = 'postcode' and slug ~ '^[a-z]{1,2}[0-9][a-z0-9]?$' and upper(country_code) <> 'GB'`);
  const { rows: [loc] } = await query(`select country_code from localities where slug = 'zz5'`);
  assert.equal(loc.country_code, 'GB', 'the UK outcode locality is corrected to GB');
  await index.settleCountryFromPostcode([ref]);
  assert.equal(await countryOf(ref), 'GB', 'and the place follows the corrected outcode, not its IE stamp');
});

test('the outward code is read from any postcode shape', async () => {
  // Full with a space, outcode-only, and no-space full all resolve to the same outcode.
  for (const [ref, pc] of [['osm:node/cfp-s', 'ZZ4 5DD'], ['osm:node/cfp-o', 'ZZ4'], ['osm:node/cfp-n', 'ZZ45DD']]) {
    await seed(ref, { stamp: 'GB', postcode: pc, outcode: 'ZZ4', outcodeCountry: 'IE' });
    await index.settleCountryFromPostcode([ref]);
    assert.equal(await countryOf(ref), 'IE', `${pc} resolves to ZZ4 (IE)`);
  }
});
