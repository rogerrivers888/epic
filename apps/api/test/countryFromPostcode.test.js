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

test('a place whose full postcode ONS holds becomes GB over a disagreeing stamp', async () => {
  const ref = 'osm:node/cfp-wrong';
  await seed(ref, { stamp: 'US', postcode: 'ZZ1 1AA', outcode: 'ZZ1' });
  const n = await index.settleCountryFromPostcode([ref]);
  assert.ok(n >= 1, 'it corrected the row');
  assert.equal(await countryOf(ref), 'GB', 'ZZ1 1AA is a GB postcode ONS holds, so the US stamp is overruled');
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

test('a non-GB locality must name its country — the database refuses a bare slug (migration 357)', async () => {
  // What the old area correction repaired after the fact — a GB outcode's locality
  // stamped IE by a legacy edit — cannot be written any more: outside GB a slug
  // carries its country, so a bare `zz5` is GB by construction.
  await assert.rejects(
    () => query(`insert into localities (slug, name, kind, country_code) values ('zz5x', 'ZZ5X', 'postcode', 'IE')`),
    /localities_slug_names_its_country/);
  await query(`insert into localities (slug, name, kind, country_code) values ('ie-zz5x', 'ZZ5X', 'postcode', 'IE') on conflict (slug) do nothing`);
  await query(`insert into localities (slug, name, kind, country_code) values ('ie', 'Ireland', 'country', 'IE') on conflict (slug) do nothing`);
});

test('backfillCountriesFromPostcodes corrects the place and requeues it', async (t) => {
  const ref = 'osm:node/cfp-backfill';
  await seed(ref, { stamp: 'IE', postcode: 'ZZ6 1AA', outcode: 'ZZ6' });
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

test('an Eircode is never GB: its routing key may be a GB outcode, but the full code is never in ONS', async () => {
  // W12 is a London outcode and a Dublin-area routing key (markets step 6). ONS
  // knows W12 as an outcode, so the outcode alone can no longer decide a set country.
  await seed('osm:node/cfp-w12-seed', { stamp: 'GB', postcode: null, outcode: 'W12' }); // ONS: W12 1AA
  const eircode = 'osm:node/cfp-w12-eircode';
  await seed(eircode, { stamp: 'IE', postcode: 'W12 X2Y3', outcode: null });
  await index.settleCountryFromPostcode([eircode]);
  assert.equal(await countryOf(eircode), 'IE', 'an Irish place on routing key W12 stays IE');
  // The same outcode with a full GB postcode ONS holds overrides the stamp.
  const london = 'osm:node/cfp-w12-london';
  await seed(london, { stamp: 'IE', postcode: 'W12 1AA', outcode: null });
  await index.settleCountryFromPostcode([london]);
  assert.equal(await countryOf(london), 'GB', 'a full ONS postcode is GB whatever the stamp said');
  // And a place with no country is filled from the outcode alone.
  const bare = 'osm:node/cfp-w12-bare';
  await seed(bare, { stamp: null, postcode: 'W12', outcode: null });
  await index.settleCountryFromPostcode([bare]);
  assert.equal(await countryOf(bare), 'GB', 'an outcode fills a missing country');
});

test('the outward code fills a missing country from any postcode shape, but never overrides one', async () => {
  for (const [ref, pc] of [['osm:node/cfp-s', 'ZZ4 5DD'], ['osm:node/cfp-o', 'ZZ4'], ['osm:node/cfp-n', 'ZZ45DD']]) {
    await seed(ref, { stamp: null, postcode: pc, outcode: 'ZZ4' });
    await index.settleCountryFromPostcode([ref]);
    assert.equal(await countryOf(ref), 'GB', `${pc} fills GB from ZZ4`);
  }
  for (const [ref, pc, want] of [['osm:node/cfp-us-full', 'ZZ4 1AA', 'GB'], ['osm:node/cfp-us-nospace', 'zz41aa', 'GB'],
    ['osm:node/cfp-us-out', 'ZZ4', 'US'], ['osm:node/cfp-us-unknown', 'ZZ4 5DD', 'US']]) {
    await seed(ref, { stamp: 'US', postcode: pc, outcode: 'ZZ4' });
    await index.settleCountryFromPostcode([ref]);
    assert.equal(await countryOf(ref), want, `${pc} over a US stamp: ${want === 'GB' ? 'a full ONS postcode overrides' : 'an outcode alone does not'}`);
  }
});
