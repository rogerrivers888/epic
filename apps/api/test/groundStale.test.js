/**
 * A ground count that has gone stale is not a ground count.
 *
 * Owner, 21 September 2026: "a stale FHRS contributor is being treated as a
 * complete census tile, so the tile gets skipped for 30 days and undercounts.
 * That would corrupt the denominators this run exists to produce."
 *
 * The register's counters are per council, because a tile of 8.9 by 8.3 km is
 * bigger than a London borough and two or three of them share it. A tile is
 * "counted" when every council with a share of it has answered — and the
 * question the settling asked was *whether* a council had answered, never
 * *when*. So a tile whose numbers were a month old looked complete: nothing
 * downloaded, `fhrs_at` stamped again with today's date, and the month-old
 * figures presented as this week's.
 *
 * That is worse than a gap, because the comparison it feeds is the one that
 * says which drawers the census is short on. A stale ground count does not
 * read as missing; it reads as agreement.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { sweepFhrs, FHRS_GROUND, contributorsTo, askedFhrs } from '../src/sources/groundCounts.js';
import { query, pool } from '../src/db.js';

test.after(() => pool.end());

const TILE = 'test-stale/0';
const COUNCIL = 'E09000028';
const DRAWERS = Object.keys(FHRS_GROUND);

/** A register that says one council covers the tile, and counts what it is asked. */
const registerThatCounts = (asked) => ({
  authorities: async () => new Map([[COUNCIL, { id: 4242, name: 'Southwark' }]]),
  councilsFor: async () => [{ code: COUNCIL, name: 'Southwark' }],
  points: async (id) => {
    asked.push(id);
    return {
      points: [
        { lat: 51.44, lng: -0.06, type: 1 },
        { lat: 51.45, lng: -0.05, type: 7844 },
      ],
      requests: 1,
    };
  },
});

const clean = async () => {
  await query('delete from ground_counts where grid_key = $1', [TILE]);
  await query('delete from census_tiles where grid_key = $1', [TILE]);
};

const tileThatWasCounted = async (daysAgo) => {
  await clean();
  await query(
    `insert into census_tiles (grid_key, min_lat, min_lng, max_lat, max_lng, outcodes, state,
                               censused_at, started_at, fhrs_authorities, fhrs_at)
     values ($1, 51.40, -0.12, 51.48, 0.00, array['SE1'], 'done',
             now() - ($2 || ' days')::interval, now() - ($2 || ' days')::interval,
             array[$3], now() - ($2 || ' days')::interval)`,
    [TILE, String(daysAgo), COUNCIL]);
  // What that council said at the time, one row per drawer (migration 230),
  // asked the way the sweep asks — a row that does not say what it asked cannot
  // be checked against what we would ask now, and is re-counted rather than
  // taken on trust.
  const asked = askedFhrs();
  for (const drawer of DRAWERS) {
    await query(
      `insert into ground_counts (grid_key, source, subcategory, places, asked, caveat, contributor, counted_at)
       values ($1, 'fhrs', $2, 11, $5, null, $3, now() - ($4 || ' days')::interval)
       on conflict (grid_key, source, subcategory, contributor) do update
          set places = excluded.places, counted_at = excluded.counted_at`,
      [TILE, drawer, COUNCIL, String(daysAgo), asked[drawer]]);
  }
};

test('a council whose count is older than the window has not contributed to this sweep', async (t) => {
  t.after(clean);
  await tileThatWasCounted(40);

  const fresh = await contributorsTo(TILE, 'fhrs', DRAWERS, { staleDays: 30 });
  assert.equal(fresh.size, 0, 'forty days ago is not an answer to a thirty-day question');

  // And the same council inside the window still counts, or every sweep would
  // download the whole register every time it ran.
  await tileThatWasCounted(3);
  const recent = await contributorsTo(TILE, 'fhrs', DRAWERS, { staleDays: 30 });
  assert.equal(recent.size, 1, 'three days ago is');
});

test('a stale tile is counted again rather than re-dated on the strength of old numbers', async (t) => {
  t.after(clean);
  await tileThatWasCounted(40);

  const asked = [];
  const out = await sweepFhrs({ authorities: 4, staleDays: 30, register: registerThatCounts(asked) });

  assert.deepEqual(asked, [4242], 'the council was asked again, because its answer had expired');
  assert.ok(out.tiles >= 1, 'and the tile settled on the new answer');

  const { rows } = await query(
    `select subcategory, places, extract(epoch from (now() - counted_at))::int as age
       from ground_counts where grid_key = $1 and source = 'fhrs' order by subcategory`, [TILE]);
  assert.equal(rows.length, DRAWERS.length, 'every drawer has a row');
  assert.ok(rows.every((r) => r.age < 120), 'and every row is this sweep\'s, not last month\'s');
  // One restaurant and one pub in the box, from the points above — the numbers
  // moved, which is the whole point of counting again.
  assert.equal(rows.find((r) => r.subcategory === 'restaurants').places, 1);
  assert.notEqual(rows.find((r) => r.subcategory === 'restaurants').places, 11);
});

test('a tile counted this week is left alone, and its register is not downloaded again', async (t) => {
  t.after(clean);
  await tileThatWasCounted(3);

  const asked = [];
  await sweepFhrs({ authorities: 4, staleDays: 30, register: registerThatCounts(asked) });

  assert.deepEqual(asked, [], 'a fresh count is not paid for twice');
  const { rows: [row] } = await query(
    `select places from ground_counts where grid_key = $1 and subcategory = 'restaurants'`, [TILE]);
  assert.equal(row.places, 11, 'and the number it already had is still there');
});
