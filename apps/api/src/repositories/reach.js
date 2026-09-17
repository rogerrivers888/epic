/**
 * The cells, and the matrix between them.
 *
 * Owner, 17 Sep 2026: "instead of having to do map distance calculations every
 * time someone does a search, we will already hold and know instantly which
 * activities are within their particular area."
 *
 * Three passes, and they are deliberately separate because they fail
 * differently and resume differently:
 *
 *   stamp   Every place we hold gets a postcode and therefore a cell, from ONS
 *           in batches of a hundred. Resumable: a place with a row in
 *           `place_cells` is never asked about again.
 *   build   Every cell gets its neighbours within ninety minutes. Pure
 *           arithmetic, no network, and rebuilt from scratch rather than
 *           patched — the same rule as `score()`.
 *   read    A search asks for the cells within N minutes and gets an indexed
 *           answer. This is the one that has to be fast, and it is the only one
 *           that runs while somebody is waiting.
 *
 * Nothing licensed goes near any of it: a cell is a postcode sector, which is
 * ONS's under the Open Government Licence, and a travel time is our own
 * arithmetic over open coordinates.
 */

import { query } from '../db.js';
import { CAP_MINUTES, EDGE_MINUTES, HORIZON_MINUTES, cellCode, labelOf, nearestCell, outcodeOf, reachFrom, recentre, sectorOf } from '../domain/reach.js';
import { travelMode } from '../domain/travel.js';
import { outcodesFor } from '../sources/localities.js';
import * as providerCalls from './providerCalls.js';

/** ONS's bulk reverse takes 100 points a request. */
const BULK = 100;

// ---------------------------------------------------------------------------
// cells
// ---------------------------------------------------------------------------

/**
 * Put a point into its cell, making the cell if it is new and nudging its
 * centre if it is not.
 *
 * The centre is a running mean of the postcodes seen inside it, so a sector
 * that Epic knows one place in is roughly right and one it knows forty in is
 * very nearly exact. `points` carries the count that makes the mean work.
 */
export async function noteCell({ sector, lat, lng, source = 'postcodes.io' }) {
  const code = cellCode('sector', sector);
  const { rows } = await query('select code, lat, lng, points from geo_cells where code = $1', [code]);
  if (!rows.length) {
    await query(
      `insert into geo_cells (code, scheme, label, country_code, outcode, lat, lng, points, source)
       values ($1, 'sector', $2, 'GB', $3, $4, $5, 1, $6)
       on conflict (code) do nothing`,
      [code, sector, outcodeOf(sector), lat, lng, source],
    );
    return code;
  }
  const moved = recentre(rows[0], { lat, lng });
  await query('update geo_cells set lat = $2, lng = $3, points = $4, updated_at = now() where code = $1',
    [code, moved.lat, moved.lng, moved.points]);
  return code;
}

/** Every cell, as the matrix build wants them. */
export async function allCells({ scheme = 'sector', country = 'GB' } = {}) {
  const { rows } = await query(
    'select code, label, lat, lng from geo_cells where scheme = $1 and country_code = $2 order by code',
    [scheme, country],
  );
  return rows;
}

/**
 * The places still without a cell, from the three stores that hold places.
 *
 * One query rather than three passes so that a run always works on the oldest
 * thing missing, whichever table it is in — otherwise the atlas is finished
 * twice over before the sweep is started once.
 */
async function unstamped(limit) {
  const { rows } = await query(
    `select ref, lat, lng from (
        select coalesce(a.venue_ref, 'atlas:' || a.id::text) as ref, a.lat, a.lng
          from attractions a where a.lat is not null
       union all
        select s.venue_ref as ref, s.lat, s.lng
          from scout_places s where s.lat is not null
       union all
        select r.venue_ref as ref, r.lat, r.lng
          from place_records r where r.lat is not null
     ) p
     where not exists (select 1 from place_cells c where c.venue_ref = p.ref)
     limit $1`,
    [limit],
  );
  // The same venue can be in two stores; the union keeps both and the insert
  // would then collide inside one batch rather than at the database.
  const seen = new Set();
  return rows.filter((r) => r.ref && !seen.has(r.ref) && seen.add(r.ref));
}

/**
 * Give every place we hold a postcode, and therefore a cell.
 *
 * Resumable by construction, because a deploy will interrupt it: what has a row
 * in `place_cells` is never asked about again, so the next run carries on from
 * where this one stopped rather than starting at the beginning.
 */
export async function stampPlaces({ limit = 2000, householdId = null } = {}) {
  let looked = 0;
  let placed = 0;
  let unplaced = 0;
  let failed = 0;
  let requests = 0;
  for (;;) {
    const batch = await unstamped(Math.min(BULK, limit - looked));
    if (!batch.length) break;
    const answers = await outcodesFor(batch.map((r) => ({ lat: r.lat, lng: r.lng })));
    requests += 1;
    looked += batch.length;
    for (let i = 0; i < batch.length; i += 1) {
      const a = answers[i];
      // A request that failed is not a place that cannot be placed. Writing the
      // one down as the other would exclude a whole batch from the map for good
      // on a single timeout, so a failed ask leaves no row and is asked again
      // next run (Codex, 17 Sep 2026).
      if (a?.failed) { failed += 1; continue; }
      const sector = sectorOf(a?.postcode);
      if (!sector) {
        // Asked and answered, and there is nothing there: in the sea, outside
        // the United Kingdom, or further from a postcode than ONS will look.
        // Remembered so the next run does not spend a request on it again.
        await query(
          `insert into place_cells (venue_ref, cell, postcode, lat, lng, why)
           values ($1, null, null, $2, $3, $4)
           on conflict (venue_ref) do nothing`,
          [batch[i].ref, batch[i].lat, batch[i].lng, a ? 'no postcode near it' : 'no answer for this point'],
        );
        unplaced += 1;
        continue;
      }
      // The cell's centre is where ONS puts the postcode, not where the place
      // is: a castle sits in the middle of a park and would drag the sector's
      // centre across a field with it.
      const at = { lat: a.lat ?? batch[i].lat, lng: a.lng ?? batch[i].lng };
      const cell = await noteCell({ sector, lat: at.lat, lng: at.lng });
      await query(
        `insert into place_cells (venue_ref, cell, postcode, lat, lng)
         values ($1, $2, $3, $4, $5)
         on conflict (venue_ref) do update set cell = excluded.cell, postcode = excluded.postcode, at = now()`,
        [batch[i].ref, cell, a.postcode, batch[i].lat, batch[i].lng],
      );
      placed += 1;
    }
    if (looked >= limit) break;
    // Every point in the batch failed, so the same rows come back next time
    // round. Stop and say so rather than spinning on an outage.
    if (answers.every((a) => a?.failed)) break;
  }
  if (requests) {
    await providerCalls.record(householdId, 'postcodes', 'reach.stamp', { requests }).catch(() => null);
  }
  await refreshCellCounts();
  // A run that could not reach ONS says so rather than reporting a quiet zero:
  // "nothing left to place" and "nobody answered" look identical otherwise.
  return { looked, placed, unplaced, failed, requests };
}

/** How many places sit in each cell. Refreshed rather than incremented. */
export async function refreshCellCounts() {
  await query(
    `update geo_cells g
        set places = coalesce(c.n, 0), updated_at = now()
       from (select cell, count(*)::int as n from place_cells where cell is not null group by cell) c
      where c.cell = g.code`,
  );
}

// ---------------------------------------------------------------------------
// the matrix
// ---------------------------------------------------------------------------

/**
 * Work out, for every cell, which cells are within reach of it.
 *
 * Rebuilt rather than adjusted: `reachFrom` is pure, so two builds of the same
 * cells agree exactly and nothing has to remember what the last one said. The
 * rows for a cell are replaced one cell at a time inside its own statement, so
 * an interrupted run leaves a table that is short rather than one that is wrong.
 */
export async function buildMatrix({ mode = 'driving', capMinutes = HORIZON_MINUTES, scheme = 'sector', onProgress = null } = {}) {
  // Canonical from here down. `reachFrom` writes `driving`; a delete or a read
  // with the screen's word for it — `drive` — matches nothing at all, so a
  // rebuild would leave the old rows in place and a search would come back
  // empty (Codex, 17 Sep 2026).
  const canonical = travelMode(mode);
  const cells = await allCells({ scheme });
  const { rows: [run] } = await query(
    `insert into reach_runs (scheme, mode, method, cap_minutes, cells) values ($1, $2, 'estimate', $3, $4) returning id`,
    [scheme, canonical, capMinutes, cells.length],
  );
  let pairs = 0;
  try {
    for (let i = 0; i < cells.length; i += 1) {
      const rows = reachFrom(cells[i], cells, { mode: canonical, capMinutes });
      await query('delete from reach where from_cell = $1 and mode = $2', [cells[i].code, canonical]);
      if (rows.length) {
        await query(
          `insert into reach (from_cell, to_cell, mode, minutes, km, method)
           select * from unnest($1::text[], $2::text[], $3::text[], $4::smallint[], $5::real[], $6::text[])
           on conflict (from_cell, to_cell, mode) do update set minutes = excluded.minutes, km = excluded.km, method = excluded.method`,
          [rows.map((r) => r.from_cell), rows.map((r) => r.to_cell), rows.map((r) => r.mode),
           rows.map((r) => r.minutes), rows.map((r) => r.km), rows.map(() => 'estimate')],
        );
      }
      pairs += rows.length;
      if (onProgress && i % 100 === 0) { try { onProgress({ done: i + 1, of: cells.length, pairs }); } catch { /* not the build */ } }
    }
    await query('update reach_runs set state = $2, pairs = $3, finished_at = now() where id = $1', [run.id, 'done', pairs]);
  } catch (err) {
    await query('update reach_runs set state = $2, why = $3, pairs = $4, finished_at = now() where id = $1',
      [run.id, 'failed', String(err?.message ?? err).slice(0, 400), pairs]);
    throw err;
  }
  return { cells: cells.length, pairs, runId: run.id };
}

// ---------------------------------------------------------------------------
// reading it
// ---------------------------------------------------------------------------

/** The cell a coordinate falls in, or the nearest one we know about. */
export async function cellAt({ lat, lng, withinKm = 25 }) {
  // A degree of latitude is 111km everywhere; a degree of longitude is less the
  // further north you go, and at 58° it is 59km. The box is generous and the
  // exact pick is done in `nearestCell`.
  const dLat = withinKm / 111;
  const dLng = withinKm / (111 * Math.max(0.3, Math.cos((lat * Math.PI) / 180)));
  const { rows } = await query(
    `select code, label, lat, lng, places from geo_cells
      where lat between $1 and $2 and lng between $3 and $4`,
    [lat - dLat, lat + dLat, lng - dLng, lng + dLng],
  );
  const near = nearestCell({ lat, lng }, rows);
  // The box is not the circle: its corner is half again as far as its edge, so
  // a cell 35km away can sit inside a 25km box. Without this the caller is told
  // it found something within the limit when it did not (Codex, 17 Sep 2026).
  return near && near.km <= withinKm ? near : null;
}

/**
 * Every cell within `minutes` of this one — the read a search actually makes.
 *
 * One index, one range, no arithmetic. This is the whole point of the table.
 */
export async function reachableCells(cell, { minutes = 30, mode = 'driving', edge = EDGE_MINUTES } = {}) {
  const { rows } = await query(
    'select to_cell, minutes, km from reach where from_cell = $1 and mode = $2 and minutes <= $3 order by minutes',
    [cell, travelMode(mode), Math.min(HORIZON_MINUTES, minutes + edge)],
  );
  return rows;
}

/** The places inside those cells, by ref. The join the screens will want. */
export async function placesWithin(cell, { minutes = 30, mode = 'driving', edge = EDGE_MINUTES } = {}) {
  const { rows } = await query(
    `select p.venue_ref, p.cell, p.lat, p.lng, r.minutes
       from reach r join place_cells p on p.cell = r.to_cell
      where r.from_cell = $1 and r.mode = $2 and r.minutes <= $3`,
    [cell, travelMode(mode), Math.min(HORIZON_MINUTES, minutes + edge)],
  );
  return rows;
}

/** What has been built, for the back office and for the tests. */
export async function state() {
  const { rows: [cells] } = await query(
    `select count(*)::int as cells,
            count(*) filter (where places > 0)::int as with_places,
            coalesce(sum(places), 0)::int as places
       from geo_cells`,
  );
  const { rows: [matrix] } = await query(
    `select count(*)::bigint as pairs, coalesce(max(minutes), 0)::int as cap,
            count(distinct from_cell)::int as from_cells
       from reach`,
  );
  const { rows: [stamped] } = await query(
    `select count(*) filter (where cell is not null)::int as n,
            count(*) filter (where cell is null)::int as unplaced
       from place_cells`,
  );
  const { rows: runs } = await query('select * from reach_runs order by started_at desc limit 5');
  return {
    cells: cells.cells, cellsWithPlaces: cells.with_places,
    stamped: stamped.n, unplaced: stamped.unplaced,
    pairs: Number(matrix.pairs), fromCells: matrix.from_cells, capMinutes: matrix.cap,
    runs,
  };
}

export { labelOf };
