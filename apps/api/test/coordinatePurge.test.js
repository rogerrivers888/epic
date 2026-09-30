/**
 * The purge of every Google point older than thirty days (owner, C59 step 5,
 * 30 Sep 2026): logged by table, after the backfill, the census box standing
 * in for a saved place.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const { purgeRented } = await import('../src/sources/coordinatePurge.js');

test.after(() => pool.end());

/** A copy written before migration 307, as the purge will find them. */
const legacy = async (table, sql, params) => {
  await query(`alter table ${table} disable trigger keep_owned_point`);
  try { await query(sql, params); } finally { await query(`alter table ${table} enable trigger keep_owned_point`); }
};

test('nothing but the index is purged before the backfill has read the copies', async () => {
  await query('delete from owned_point_runs');
  const out = await purgeRented();
  assert.equal(out.copies, 'waiting for the backfill to finish');
});

test('after the backfill, old copies go, a saved place keeps its census box, and each table is logged', async () => {
  await query(`insert into owned_point_runs (kind, state, finished_at) values ('backfill', 'done', now())`);
  const { rows: [h] } = await query(`insert into households (name) values ('Purge test') returning id`);
  const saved = `google:purge-saved-${randomUUID()}`;
  const young = `google:purge-young-${randomUUID()}`;
  const swept = `google:purge-swept-${randomUUID()}`;
  const twin = `google:purge-twin-${randomUUID()}`;
  await query(`insert into place_index (venue_ref, slice) values ($1, '51.40,-0.62,51.48,-0.50')`, [saved]);
  await legacy('household_places', `insert into household_places (household_id, venue_ref, label, lat, lng, first_seen) values
    ($1, $2, 'Old', 51.4123, -0.6011, now() - interval '40 days'), ($1, $3, 'New', 51.4, -0.6, now() - interval '3 days')`, [h.id, saved, young]);
  await query(`insert into scout_areas (code, lat, lng) values ('ZZ7', 51.4, -0.6) on conflict do nothing`);
  await legacy('scout_places', `insert into scout_places (area_code, venue_ref, name, rank, lat, lng, from_sources, first_seen) values
    ('ZZ7', $1, 'Google''s name', 1, 51.5, -0.1, '["google"]', now() - interval '60 days'),
    ('ZZ7', $2, 'The Open Map''s', 2, 51.5, -0.1, '["osm","google"]', now() - interval '60 days')`, [swept, twin]);

  const before = (await query('select count(*)::int as n from coordinate_expiries')).rows[0].n;
  const out = await purgeRented();
  assert.ok(out.tables.household_places >= 1);
  assert.ok(out.tables.scout_places >= 1);

  const hp = (await query('select venue_ref, lat, lng, point_from from household_places where venue_ref = any($1)', [[saved, young]])).rows;
  const s = hp.find((r) => r.venue_ref === saved);
  assert.equal(s.point_from, 'census-box', 'the saved place keeps working through its box');
  assert.ok(Math.abs(s.lat - 51.44) < 1e-9);
  assert.equal(hp.find((r) => r.venue_ref === young).lat, 51.4, 'a copy under thirty days old waits its turn');

  const sp = (await query('select venue_ref, name, lat from scout_places where venue_ref = any($1)', [[swept, twin]])).rows;
  assert.deepEqual(sp.find((r) => r.venue_ref === swept), { venue_ref: swept, name: null, lat: null }, 'Google\'s point and name gone');
  assert.equal(sp.find((r) => r.venue_ref === twin).lat, 51.5, 'the open map\'s point stays');

  const logged = (await query(`select table_name, expired from coordinate_expiries order by at desc limit 20`)).rows;
  assert.ok((await query('select count(*)::int as n from coordinate_expiries')).rows[0].n > before);
  assert.ok(logged.some((r) => r.table_name === 'household_places'));
  assert.ok(logged.every((r) => !JSON.stringify(r).includes('google:')), 'counts, never references');
});
