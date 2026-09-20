/**
 * The first ten, as a household would be shown them.
 *
 * The owner, 20 Sep 2026: "I want the default view to be what the user sees…
 * if I switch to user view, then I should just see the first 10", and about a
 * row printed as `google:ChIJnVzfWQCBdkgRt1-Lo8I5wII`: "It shouldn't be in the
 * list. We need to make sure of that so that we're not displaying random
 * strings to users on our website."
 *
 * Both are one query, and both are silent when they are wrong: a nameless row
 * looks like a place with a long name, and a wrong order looks like an opinion.
 * So the two rules are pinned here — nothing without a name we may show, and
 * our own score deciding the order.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const index = await import('../src/repositories/placeIndex.js');

test.after(() => pool.end());

const AREA = 'zz-household-view';
const REFS = ['osm:node/hv-top', 'osm:node/hv-middle', 'osm:node/hv-unscored', 'google:HV-NAMELESS'];

const seed = async () => {
  await query('delete from place_areas where area_slug = $1', [AREA]);
  await query('delete from place_index where venue_ref = any($1)', [REFS]);
  await query('delete from place_records where venue_ref = any($1)', [REFS]);
  await query('delete from scout_places where venue_ref = any($1)', [REFS]);
  await query(
    `insert into localities (slug, name, kind, country_code) values ($1, 'Household view', 'postcode', 'GB')
     on conflict (slug) do nothing`, [AREA]);
  await index.noteMany(REFS.map((ref) => ({ ref, lat: 51.4, lng: -0.68, countryCode: 'GB' })), { source: 'osm' });
  await query(`update place_index set category = 'food', subcategory = 'pubs-bars' where venue_ref = any($1)`, [REFS]);
  for (const ref of REFS) {
    await query('insert into place_areas (venue_ref, area_slug) values ($1,$2) on conflict do nothing', [ref, AREA]);
  }
  // Three we may name, one we may not: a Google reference nobody owns anything
  // about, which is exactly the row the owner saw.
  await query(
    `insert into place_records (venue_ref, name, epic_score, updated_at) values
       ('osm:node/hv-top', 'The Top One', 8.2, now()),
       ('osm:node/hv-middle', 'The Middle One', 4.1, now()),
       ('osm:node/hv-unscored', 'Nobody Has Scored This', null, now())
     on conflict (venue_ref) do update set name = excluded.name, epic_score = excluded.epic_score`);
};

test('nothing without a name we may show reaches the household view', async () => {
  await seed();
  const out = await index.household(AREA, { subcategory: 'pubs-bars', limit: 10 });
  const refs = out.rows.map((r) => r.ref);

  assert.ok(!refs.includes('google:HV-NAMELESS'), 'a bare identifier is not a place anybody may be shown');
  assert.ok(out.rows.every((r) => r.name), 'every row a household sees has a name');
  // Held back rather than hidden: the board prints the number, so the gap is a
  // finding rather than silence.
  assert.equal(out.nameless, 1);
  assert.equal(out.named, 3);
});

test('our own score decides the order, and not knowing is not a high mark', async () => {
  await seed();
  const out = await index.household(AREA, { subcategory: 'pubs-bars', limit: 10 });

  assert.deepEqual(out.rows.map((r) => r.name), ['The Top One', 'The Middle One', 'Nobody Has Scored This']);
  assert.equal(out.rows[0].epicScore, 8.2);
  // A place nobody has scored says so rather than printing a nought, and sorts
  // below one that has.
  assert.equal(out.rows[2].epicScore, null);
  assert.equal(out.unscored, 1);
});

test('the freshest score is the one that ranks, not the first one found', async () => {
  await seed();
  // Swept in the spring and re-banded last night: both rows hold a score, and
  // the owned record's is the current one. Reading the sweep's first ranked the
  // board on the older number (Codex, 20 Sep 2026).
  await query(
    `insert into scout_areas (code, label, country_code, lat, lng, radius_km, keep, state, seen)
     values ($1, 'Household view', 'GB', 51.4, -0.68, 5, 20, 'swept', 1)
     on conflict (code) do nothing`, [AREA.toUpperCase()]);
  await query(
    `insert into scout_places (area_code, venue_ref, name, rank, epic_score, scored_at, last_seen)
     values ($1, 'osm:node/hv-middle', 'The Middle One', 1, 1.0, now() - interval '120 days', now())
     on conflict (area_code, venue_ref) do update set epic_score = excluded.epic_score, scored_at = excluded.scored_at`,
    [AREA.toUpperCase()]);
  await query(
    `update place_records set epic_score = 9.5, scored_at = now() where venue_ref = 'osm:node/hv-middle'`);

  const out = await index.household(AREA, { subcategory: 'pubs-bars', limit: 10 });
  assert.equal(out.rows[0].name, 'The Middle One', 'last night\u2019s score is the one that ranks');
  assert.equal(out.rows[0].epicScore, 9.5);
});

test('a banding writes no scored_at, and the board still reads it as the newer one', async () => {
  await seed();
  // The lookup's banding stamps `banded_at` and leaves `scored_at` alone, so a
  // board comparing only `scored_at` called last night's banding older than a
  // sweep from the spring (Codex, 20 Sep 2026).
  await query(
    `insert into scout_areas (code, label, country_code, lat, lng, radius_km, keep, state, seen)
     values ($1, 'Household view', 'GB', 51.4, -0.68, 5, 20, 'swept', 1)
     on conflict (code) do nothing`, [AREA.toUpperCase()]);
  await query(
    `insert into scout_places (area_code, venue_ref, name, rank, epic_score, crowd_band, scored_at, last_seen)
     values ($1, 'osm:node/hv-middle', 'The Middle One', 1, 1.0, 'mixed', now() - interval '120 days', now())
     on conflict (area_code, venue_ref) do update set epic_score = excluded.epic_score,
       crowd_band = excluded.crowd_band, scored_at = excluded.scored_at`, [AREA.toUpperCase()]);
  await query(
    `update place_records set epic_score = 9.5, crowd_band = 'top', scored_at = null, banded_at = now()
      where venue_ref = 'osm:node/hv-middle'`);

  const out = await index.household(AREA, { subcategory: 'pubs-bars', limit: 10 });
  assert.equal(out.rows[0].name, 'The Middle One');
  assert.equal(out.rows[0].epicScore, 9.5);
  // And the standing comes from the same evidence as the score, rather than
  // the score saying one thing and the word beside it another.
  assert.equal(out.rows[0].standing, 'top');
});

test('ten is what a household is shown, and the limit is the last thing applied', async () => {
  await seed();
  const one = await index.household(AREA, { subcategory: 'pubs-bars', limit: 1 });
  assert.equal(one.rows.length, 1);
  assert.equal(one.rows[0].name, 'The Top One');
  // The counts are of the whole scope, not of the page: "the first 1 of 3".
  assert.equal(one.named, 3);
  assert.equal(one.nameless, 1);
});
