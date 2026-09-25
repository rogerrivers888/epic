/**
 * The census board's two honest columns.
 *
 * Both were added on 24 Sep 2026 so that a floor could never again read as a
 * count, and both had a way of overstating on a board of several outcodes
 * (Codex, the same day). A diagnostic that speaks when it cannot see is the
 * fault the columns exist to prevent, so each has a can't-speak state.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { censusBoardRows } from '../src/routes/placeIndex.js';
import { query, pool } from '../src/db.js';

test.after(() => pool.end());

const SLUGS = ['zz7a', 'zz7b', 'zz7c'];
const clean = () => query('delete from area_counts where area_slug = any($1)', [SLUGS]);

const row = (slug, { unresolved = 0, sourced = null, text = 0 } = {}) => query(
  `insert into area_counts (area_slug, category, subcategory, census_count, surfaced_count, scored_count, saturated,
                            censused_at, complete, unresolved, sourced, text_count)
   values ($1, 'culture', 'museums', 10, 10, 0, 0, now(), true, $2, $3, $4)
   on conflict (area_slug, category, subcategory) do update
     set unresolved = excluded.unresolved, sourced = excluded.sourced, text_count = excluded.text_count`,
  [slug, unresolved, sourced, text]);

test('unresolved is exact on one outcode and withheld on several', async (t) => {
  t.after(clean);
  await clean();
  // The same straddling place is recorded as unresolved in both outcodes it
  // straddles, on purpose, so that neither drops it.
  await row('zz7a', { unresolved: 5, sourced: 'type' });
  await row('zz7b', { unresolved: 5, sourced: 'type' });

  const [one] = await censusBoardRows(['zz7a']);
  assert.equal(one.unresolved, 5, 'on one outcode the figure is the figure');

  const [ring] = await censusBoardRows(['zz7a', 'zz7b']);
  assert.equal(ring.unresolved, null,
    'on a ring the per-outcode figures cannot say whether a straddler is inside the ring or across its edge, so nothing is claimed');
  assert.equal(ring.filed, 20, 'while the counts themselves still add up');
});

test('an outcode that has not said how it was found makes the board say mixed, not the known word', async (t) => {
  t.after(clean);
  await clean();
  await row('zz7a', { sourced: 'type' });
  await row('zz7b', { sourced: null });
  await row('zz7c', { sourced: null });

  const [mixed] = await censusBoardRows(['zz7a', 'zz7b', 'zz7c']);
  assert.equal(mixed.sourced, 'mixed', 'one known outcode among unknown ones is not authority for all three');

  await row('zz7b', { sourced: 'type' });
  await row('zz7c', { sourced: 'type' });
  const [agreed] = await censusBoardRows(['zz7a', 'zz7b', 'zz7c']);
  assert.equal(agreed.sourced, 'type', 'and when every outcode says the same thing, the board says it');

  const [nobody] = await censusBoardRows(['zz7b']);
  await row('zz7b', { sourced: null });
  const [unknown] = await censusBoardRows(['zz7b']);
  assert.equal(nobody.sourced, 'type');
  assert.equal(unknown.sourced, null, 'and where nobody has said, the board says nothing');
});

test('a row drawn while a sweep is in flight says so, carries its tiles, and sorts after the finished ones', async (t) => {
  // Owner, 25 Sep 2026: "Do not render a bare count while a sweep is in
  // flight … 'at least 340, sweeping, 4 of 11 tiles'", and "A count with
  // complete = false must never sort or compare as if it were final."
  await clean();
  t.after(async () => {
    await query(`delete from census_tiles where grid_key like 'test/board-%'`);
    await clean();
  });
  // Two drawers on one district: a big one part way through, a small one done.
  await query(
    `insert into area_counts (area_slug, category, subcategory, census_count, surfaced_count, scored_count, saturated, censused_at, complete, unresolved, sourced, text_count)
     values ('zz7a', 'culture', 'museums', 340, 340, 0, 0, now(), false, 0, 'type', 0),
            ('zz7a', 'culture', 'galleries', 12, 12, 0, 0, now(), true, 0, 'type', 0)
     on conflict (area_slug, category, subcategory) do update set census_count = excluded.census_count, surfaced_count = excluded.surfaced_count, complete = excluded.complete`);
  // Eleven tiles planned for the district, four of them answered.
  for (let i = 0; i < 11; i += 1) {
    await query(
      `insert into census_tiles (grid_key, min_lat, min_lng, max_lat, max_lng, outcodes, state, censused_at)
       values ($1, 51.4, -0.7, 51.41, -0.69, array['ZZ7A'], $2, case when $2 = 'done' then now() else null end)
       on conflict (grid_key) do update set state = excluded.state, outcodes = excluded.outcodes`,
      [`test/board-${i}`, i < 4 ? 'done' : (i === 4 ? 'doing' : 'todo')]);
  }
  const rows = await censusBoardRows(['zz7a']);
  const museums = rows.find((r) => r.subcategory === 'museums');
  assert.equal(museums.sweeping, true, 'a tile is still to do, so the row is in flight');
  assert.equal(museums.tiles, 11); assert.equal(museums.tiles_done, 4);
  assert.equal(museums.complete, false);
  assert.deepEqual(rows.map((r) => r.subcategory), ['galleries', 'museums'],
    'the finished twelve comes before the in-flight three hundred and forty, whatever the size');

  // Every tile answered: the row reads as the others do.
  await query(`update census_tiles set state = 'done', censused_at = now() where grid_key like 'test/board-%'`);
  const [after] = (await censusBoardRows(['zz7a'])).filter((r) => r.subcategory === 'museums');
  assert.equal(after.sweeping, false); assert.equal(after.tiles_done, 11);
});
