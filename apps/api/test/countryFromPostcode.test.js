/**
 * A place's country from its own postcode (settleCountryFromPostcode; owner, 1 Oct
 * 2026, Option C). The durable postcode is owned and permanent where the coordinate
 * is rented and the country_code stamp is a copy. The authoritative record of which
 * outcodes are British is the ONS postcode load (`postcodes`, GB-only), read
 * directly — not the derived `localities` cache, which research does not always
 * create — so a place whose outcode ONS knows becomes GB over a disagreeing or null
 * stamp. Migration 311 does the same one-time over the corpus; this exercises the
 * ongoing paths.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const index = await import('../src/repositories/placeIndex.js');
const owned = await import('../src/repositories/ownedPlaces.js');
test.after(() => pool.end());

// A place in place_index (its stamp) with a place_records postcode. `inOns` seeds the
// outcode into the GB-only ONS table (so it resolves as GB); `localityCountry` seeds
// the derived area locality (only the normalisation tests need it).
async function seed(ref, { stamp, postcode, outcode, inOns = true, localityCountry = null }) {
  await index.noteMany([{ ref, lat: 51.5, lng: -0.6, countryCode: stamp }], { source: 'osm' });
  if (outcode && inOns) {
    await query(`insert into postcodes (pcds, sector, outcode, lat, lng, source)
                 values ($1,$2,$3,51.5,-0.6,'test') on conflict (pcds) do nothing`,
    [`${outcode} 1AA`, `${outcode} 1`, outcode]);
  }
  if (outcode && localityCountry) {
    await query(`insert into localities (slug, name, kind, country_code) values ($1,$2,'postcode',$3)
                 on conflict (slug) do update set country_code = excluded.country_code`,
    [outcode.toLowerCase(), outcode, localityCountry]);
  }
  if (postcode) {
    await query(`insert into place_records (venue_ref, postcode, updated_at) values ($1,$2, now())
                 on conflict (venue_ref) do update set postcode = excluded.postcode`, [ref, postcode]);
  }
}
const countryOf = async (ref) => (await query('select country_code from place_index where venue_ref = $1', [ref])).rows[0]?.country_code ?? null;

test('a place whose outcode ONS knows becomes GB over a disagreeing stamp', async () => {
  const ref = 'osm:node/cfp-wrong';
  await seed(ref, { stamp: 'US', postcode: 'ZZ1 1AA', outcode: 'ZZ1' });
  const n = await index.settleCountryFromPostcode([ref]);
  assert.ok(n >= 1, 'it corrected the row');
  assert.equal(await countryOf(ref), 'GB', 'ZZ1 is a GB outcode ONS knows, so the US stamp is overruled');
});

test('a null stamp is filled from the postcode', async () => {
  const ref = 'osm:node/cfp-null';
  await seed(ref, { stamp: null, postcode: 'ZZ2 3BB', outcode: 'ZZ2' });
  await index.settleCountryFromPostcode([ref]);
  assert.equal(await countryOf(ref), 'GB');
});

test('an outcode ONS does not know, an agreeing stamp, and no postcode are left alone', async () => {
  const unknown = 'osm:node/cfp-unknown';
  const agree = 'osm:node/cfp-agree';
  const nopc = 'osm:node/cfp-nopc';
  // A postcode whose outcode ONS has never heard of (not in `postcodes`): not resolved.
  await seed(unknown, { stamp: 'IE', postcode: 'ZX9 9ZZ', outcode: 'ZX9', inOns: false });
  await seed(agree, { stamp: 'GB', postcode: 'ZZ3 4CC', outcode: 'ZZ3' });
  await seed(nopc, { stamp: 'US', postcode: null });
  const n = await index.settleCountryFromPostcode([unknown, agree, nopc]);
  assert.equal(n, 0, 'nothing to correct: one outcode is unknown, one agrees, one has no postcode');
  assert.equal(await countryOf(unknown), 'IE', 'an outcode ONS does not know leaves the stamp (it may be another market)');
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

// Migration 311's locality normalisation, run against the test's own data: a postcode
// locality is corrected to GB only where its slug is a GB outcode ONS knows.
const normaliseLegacyOutcodes = () => query(`update localities loc set country_code = 'GB'
   where loc.kind = 'postcode' and upper(loc.country_code) <> 'GB'
     and exists (select 1 from postcodes p where p.outcode = upper(loc.slug))`);

test('a GB outcode locality wrongly stamped non-GB is normalised, and its places resolve to GB', async () => {
  const ref = 'osm:node/cfp-legacy';
  // Legacy damage: a GB outcode's locality the old edit path stamped IE. It is a real
  // GB outcode, so ONS knows it, and both the locality and the place must end GB.
  await seed(ref, { stamp: 'IE', postcode: 'ZZ5 1AA', outcode: 'ZZ5', localityCountry: 'IE' });
  await normaliseLegacyOutcodes();
  const { rows: [loc] } = await query(`select country_code from localities where slug = 'zz5'`);
  assert.equal(loc.country_code, 'GB', 'the GB outcode locality is corrected to GB');
  await index.settleCountryFromPostcode([ref]);
  assert.equal(await countryOf(ref), 'GB', 'and the place resolves to GB from ONS, not its IE stamp');
});

test('backfillCountriesFromPostcodes corrects the place and requeues it', async (t) => {
  const ref = 'osm:node/cfp-backfill';
  await seed(ref, { stamp: 'IE', postcode: 'ZZ6 1AA', outcode: 'ZZ6', localityCountry: 'IE' });
  await query('update place_index set placed_at = now() where venue_ref = $1', [ref]);
  t.after(() => query(`update postcode_releases set country_backfilled_release = null where one`));
  const { corrected, deferred } = await index.backfillCountriesFromPostcodes('2099-03');
  assert.equal(deferred, false, 'the lock was free, so it ran');
  assert.ok(corrected >= 1, 'it corrected at least this place');
  const { rows: [pi] } = await query('select country_code, placed_at from place_index where venue_ref = $1', [ref]);
  assert.equal(pi.country_code, 'GB', 'ZZ6 is a GB outcode, so the place is GB');
  assert.equal(pi.placed_at, null, 'and the place is requeued so settle refiles it under GB');
  const { rows: [rel] } = await query('select country_backfilled_release from postcode_releases where one');
  assert.equal(rel.country_backfilled_release, '2099-03', 'it stamps the release it was handed, not the stale loaded_release');
});

test('a deferred backfill is applied when it is pending, and stamped so it is not redone', async (t) => {
  const ref = 'osm:node/cfp-pending';
  t.after(() => query(`update postcode_releases set loaded_release = null, country_backfilled_release = null where one`));
  await seed(ref, { stamp: 'IE', postcode: 'ZZ7 1AA', outcode: 'ZZ7' });
  await query('update place_index set placed_at = now() where venue_ref = $1', [ref]);
  // A load happened but the backfill has not caught up — pending.
  await query(`update postcode_releases set loaded_release = '2099-01', country_backfilled_release = null where one`);
  const n = await index.applyPendingCountryBackfill();
  assert.ok(n >= 1, 'the pending backfill ran');
  assert.equal(await countryOf(ref), 'GB', 'and corrected the place');
  const { rows: [rel] } = await query('select country_backfilled_release from postcode_releases where one');
  assert.equal(rel.country_backfilled_release, '2099-01', 'and stamped the release');
  assert.equal(await index.applyPendingCountryBackfill(), 0, 'running again is a no-op — no longer pending');
});

test('an Eircode routing key is not reclassified as GB — syntax overlaps but ONS does not know it', async () => {
  // D02 is a valid Eircode routing key and matches the UK outward-code shape, but it
  // is not a GB outcode, so ONS has no row for it and normalisation leaves it IE.
  await query(`delete from postcodes where outcode = 'D02'`);
  await query(`insert into localities (slug, name, kind, country_code) values ('d02','D02','postcode','IE')
               on conflict (slug) do update set country_code = 'IE'`);
  await normaliseLegacyOutcodes();
  const { rows: [loc] } = await query(`select country_code from localities where slug = 'd02'`);
  assert.equal(loc.country_code, 'IE', 'the Irish routing key stays IE');
  // And a place on that Eircode is not made GB either.
  const ref = 'osm:node/cfp-eircode';
  await seed(ref, { stamp: 'IE', postcode: 'D02 AF30', outcode: 'D02', inOns: false });
  await index.settleCountryFromPostcode([ref]);
  assert.equal(await countryOf(ref), 'IE', 'the place keeps IE — D02 is not a GB outcode');
});

test('the outward code is read from any postcode shape', async () => {
  // Full with a space, outcode-only, and no-space full all resolve to the same outcode.
  for (const [ref, pc] of [['osm:node/cfp-s', 'ZZ4 5DD'], ['osm:node/cfp-o', 'ZZ4'], ['osm:node/cfp-n', 'ZZ45DD']]) {
    await seed(ref, { stamp: 'US', postcode: pc, outcode: 'ZZ4' });
    await index.settleCountryFromPostcode([ref]);
    assert.equal(await countryOf(ref), 'GB', `${pc} resolves to ZZ4, a GB outcode`);
  }
});
