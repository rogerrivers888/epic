/**
 * Item 6's after-check (owner, 2 Oct 2026): a fixed read, counts only, that
 * tells whether Google's stored types are gone and our own words are kept.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const { googleTypesCheck } = await import('../src/repositories/googleTypesCheck.js');

test.after(async () => {
  await query(`delete from place_index where venue_ref like 'gtc:%'`);
  await pool.end();
});

const byRow = (rows) => Object.fromEntries(rows.map((r) => [r.row, r.count]));

test('ten numbered counts, and nothing that names a place', async () => {
  await query(`insert into place_index (venue_ref, google_types) values ('gtc:named', array['establishment'])
               on conflict (venue_ref) do update set google_types = excluded.google_types`);
  const rows = await googleTypesCheck();
  assert.deepEqual(rows.map((r) => r.row), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const r of rows) assert.ok(Number.isInteger(r.count) && r.count >= 0, `row ${r.row} is a count`);
  assert.ok(!JSON.stringify(rows).includes('gtc:named'), 'no place reference leaves the check');
  assert.ok(!JSON.stringify(rows).includes('establishment'), 'and no word either');
  await query(`delete from place_index where venue_ref = 'gtc:named'`);
});

test('a place still holding Google types shows in rows 1, 2, 4 and 6, and clearing it takes it out', async () => {
  const before = byRow(await googleTypesCheck());

  // A rented-only word (no census word behind it) and an owned one on another place.
  await query(`insert into place_index (venue_ref, google_types) values ('gtc:rented', array['bus_stop'])
               on conflict (venue_ref) do update set google_types = excluded.google_types`);
  await query(`insert into place_index (venue_ref, found_by) values ('gtc:owned', 'park')
               on conflict (venue_ref) do update set found_by = excluded.found_by`);
  const held = byRow(await googleTypesCheck());
  for (const r of [1, 2, 4, 6]) assert.equal(held[r], before[r] + 1, `row ${r} counts the held types`);
  assert.equal(held[7], before[7] + 1, 'the census word is backed');
  assert.equal(held[5], held[6] + held[7], 'every place_words row is one or the other');

  // The clear, as migration 320 did it.
  await query(`update place_index set google_types = null where venue_ref = 'gtc:rented'`);
  const after = byRow(await googleTypesCheck());
  for (const r of [1, 2, 4, 6]) assert.equal(after[r], before[r], `row ${r} is back where it was`);
  assert.equal(after[5], after[7] + after[6], 'and the total still splits');
  for (const r of [8, 9, 10]) assert.equal(after[r], before[r], `row ${r}, our own words, untouched`);
});
