/**
 * Correcting a place's postcode by hand.
 *
 * Two things had to be true and were not: the correction had to be one write,
 * and the outcode had to exist before anything pointed at it. An outcode nobody
 * has swept yet is not in `localities`, so a correction to a real but unvisited
 * one broke `place_areas`' foreign key *after* the record had already been
 * changed — a 500 with half the correction applied (Codex, 18 Sep 2026).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const index = await import('../src/repositories/placeIndex.js');

test.after(() => pool.end());

// The route's own work, called the way the route calls it.
const { withTransaction } = await testDatabase();
const setPostcode = async (ref, value) => {
  const outcode = value ? String(value).toUpperCase().trim() : null;
  await withTransaction(async (client) => {
    await client.query(
      `insert into place_records (venue_ref, postcode, updated_at) values ($1,$2, now())
       on conflict (venue_ref) do update set postcode = excluded.postcode, updated_at = now()`, [ref, outcode]);
    await client.query(
      'delete from place_areas pa using localities l where l.slug = pa.area_slug and pa.venue_ref = $1 and l.kind = $2',
      [ref, 'postcode']);
    if (outcode) {
      const place = (await client.query('select country_code from place_index where venue_ref = $1', [ref])).rows[0] ?? null;
      await client.query(
        `insert into localities (slug, name, kind, country_code) values ($1,$2,'postcode',$3) on conflict (slug) do nothing`,
        [outcode.toLowerCase(), outcode, place?.country_code ?? 'GB']);
      await client.query('insert into place_areas (venue_ref, area_slug) values ($1,$2) on conflict do nothing',
        [ref, outcode.toLowerCase()]);
    }
  });
};

test('an outcode nobody has swept is made, not refused', async () => {
  const ref = 'osm:node/postcode-correction';
  await index.noteMany([{ ref, lat: 51.5, lng: -0.7, countryCode: 'GB' }], { source: 'osm' });
  await query(`delete from localities where slug = 'zz99'`);

  await setPostcode(ref, 'zz99');
  assert.equal((await query('select postcode from place_records where venue_ref = $1', [ref])).rows[0].postcode, 'ZZ99');
  assert.equal((await query(`select kind from localities where slug = 'zz99'`)).rows[0].kind, 'postcode');
  assert.equal((await query(`select count(*)::int as n from place_areas where venue_ref = $1 and area_slug = 'zz99'`, [ref])).rows[0].n, 1);

  // Correcting it again moves the link rather than keeping both.
  await setPostcode(ref, 'ZZ98');
  const areas = (await query(
    `select pa.area_slug from place_areas pa join localities l on l.slug = pa.area_slug
      where pa.venue_ref = $1 and l.kind = 'postcode'`, [ref])).rows.map((r) => r.area_slug);
  assert.deepEqual(areas, ['zz98']);

  // And clearing it leaves nothing pointing anywhere.
  await setPostcode(ref, null);
  assert.equal((await query('select postcode from place_records where venue_ref = $1', [ref])).rows[0].postcode, null);
  assert.equal((await query(
    `select count(*)::int as n from place_areas pa join localities l on l.slug = pa.area_slug
      where pa.venue_ref = $1 and l.kind = 'postcode'`, [ref])).rows[0].n, 0);
});

test('a call about a place says which place', async () => {
  const providerCalls = await import('../src/repositories/providerCalls.js');
  const ref = 'google:CALL-ATTRIBUTION';
  await query(`delete from provider_calls where venue_ref = $1`, [ref]);

  // The meter is priced by adding up its keys, so the reference lives in its
  // own column — and the History tab reads it there.
  await providerCalls.record(null, 'google', 'admin.lookup.compare', { google: 1 }, null, ref);
  const { rows } = await query(
    'select venue_ref, units, estimated_cost_usd from provider_calls where venue_ref = $1', [ref]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].venue_ref, ref);
  assert.deepEqual(rows[0].units, { google: 1 }, 'the reference is not in the meter');
  assert.ok(Number(rows[0].estimated_cost_usd) > 0, 'and the call is still priced');
  await query(`delete from provider_calls where venue_ref = $1`, [ref]);
});
