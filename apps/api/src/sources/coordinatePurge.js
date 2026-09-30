/**
 * The purge of every Google point older than thirty days, wherever it is
 * still held, written down table by table (owner, C59 step 5, 30 Sep 2026:
 * "run the purge of every Google point older than 30 days that is still left,
 * logged. You have my go-ahead for this now; it's a terms breach, so don't
 * wait for me. Saved/visited places keep working through their census box
 * until their owned point lands").
 *
 * The index has always expired its own rented points hourly
 * (census.expireRentedCoordinates). This reaches the copies the index never
 * knew about: the sweep's rows, the activity sweep's Google rows, research
 * records, saved places, shortlists, plans and visits, and the cells stamped
 * from any of them. Each copy is touched rather than rewritten, so migration
 * 307's trigger decides what it holds instead — the owned point where one has
 * landed, the census box for a household's place, or nothing — and the same
 * rule that guards every write guards the purge. Google's names go with the
 * sweep rows' points, and from research records whose name no owned source
 * gave.
 *
 * Only after the backfill: the backfill reads these very copies — a name, a
 * point — once, to find each place's owned twin, and a purge ahead of it would
 * have thrown away the only thing some places could be matched on. Until a
 * backfill has finished, only the index's own expiry runs.
 *
 * A point's age: only the index and the cells date their points. Every other
 * table's clocks move with unrelated writes, so a copy is taken as old when
 * its row was first written more than thirty days ago — every point on it is
 * at least that recent or older, and a copy written since migration 307 holds
 * no rented point at all.
 *
 * The log keeps counts and a date per table, never the references: keeping
 * those would be keeping a Google-derived list past its thirty days by
 * another name.
 */

import { query, pool } from '../db.js';
import { expireRentedCoordinates } from './census.js';
import { RENTED_SOURCES } from './ownedPoints.js';

// A rented reference: a provider's own, or an atlas one standing in for an
// unmatched activity-sweep row (epic_ref_true_source, migration 307).
const RENTED_REF = (col) => `(split_part(${col}, ':', 1) = any($1::text[]) or epic_ref_true_source(${col}) = any($1::text[]))`;

/**
 * Each table: the rows still holding a rented copy older than thirty days,
 * and how to touch them. `first` is the row's own first clock. A row the
 * trigger has already given an owned point is not touched again (Codex).
 */
export const TABLES = [
  { table: 'scout_places', first: 'first_seen',
    // Google's point and Google's name, on a row the open map never gave.
    rented: `(lat is not null or name is not null) and ${RENTED_REF('venue_ref')} and not (coalesce(from_sources, '[]'::jsonb) ? 'osm')
             and (point_from is null or not (point_from = any(epic_owned_sources())))` },
  { table: 'attractions', first: 'first_seen',
    rented: `lat is not null and (display_source = 'google' or (source = 'google' and osm_ref is null))
             and (point_from is null or not (point_from = any(epic_owned_sources())))` },
  // A research record keeps no clock that unrelated updates cannot move, and
  // no rented point can be written to one any more (migration 307): what it
  // still holds is a legacy copy, and goes whatever its apparent age (Codex).
  { table: 'place_records', first: "coalesce(first_owned, '-infinity'::timestamptz)",
    rented: `lat is not null and ${RENTED_REF('venue_ref')} and osm_ref is null
             and not (coalesce(provenance ->> 'lat', '') = any(epic_owned_sources()))
             and (point_from is null or not (point_from = any(epic_owned_sources())))` },
  { table: 'household_places', first: 'first_seen',
    rented: `lat is not null and ${RENTED_REF('venue_ref')} and (point_from is null or point_from = any($1::text[]))` },
  { table: 'trip_shortlist', first: 'added_at',
    rented: `lat is not null and ${RENTED_REF('venue_ref')} and (point_from is null or point_from = any($1::text[]))` },
  { table: 'trip_stops', first: 'created_at',
    rented: `lat is not null and ${RENTED_REF('venue_ref')} and (point_from is null or point_from = any($1::text[]))` },
  { table: 'visits', first: 'created_at',
    rented: `lat is not null and ${RENTED_REF('venue_ref')} and (point_from is null or point_from = any($1::text[]))` },
];

async function backfilled() {
  const { rows: [r] } = await query(`select 1 from owned_point_runs where kind = 'backfill' and state = 'done' limit 1`);
  return Boolean(r);
}

/**
 * The purge. `force` runs the copies' purge without a finished backfill (the
 * back office's explicit "run it now"); the hourly job never forces.
 */
export async function purgeRented({ days = 30, force = false } = {}) {
  const out = { index: await expireRentedCoordinates({ days }), tables: {} };
  if (!force && !(await backfilled())) return { ...out, copies: 'waiting for the backfill to finish' };
  const age = `(${days} || ' days')::interval`;

  // Each step in its own transaction, its log line written in the same one:
  // a purge that committed is a purge written down, whatever fails after it
  // (Codex, 30 Sep 2026). Said to be the purge, for that transaction only —
  // migration 307's trigger otherwise leaves a legacy row's unchanged point
  // for the backfill.
  const step = async (label, sql, params) => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('epic.purging', 'on', true)`);
      const { rowCount } = await client.query(sql, params);
      if (rowCount) {
        await client.query(`insert into coordinate_expiries (expired, cells, table_name, detail) values ($1, 0, $2, $3)`,
          [rowCount, label, JSON.stringify({ days, rule: 'C59 step 5' })]);
      }
      await client.query('commit');
      out.tables[label] = rowCount;
    } catch (err) {
      await client.query('rollback').catch(() => null);
      throw err;
    } finally { client.release(); }
  };

  for (const t of TABLES) {
    await step(t.table,
      `update ${t.table} set point_from = point_from
        where (${t.rented}) and ${t.first} < now() - ${age}`, t.rented.includes('$1') ? [RENTED_SOURCES] : []);
  }

  // A research record's Google name, where no owned source gave its name: the
  // drawer's look inside wrote it (the fifth hole).
  await step('place_records (names)',
    `update place_records set name = null
      where name is not null and ${RENTED_REF('venue_ref')}
        and not (coalesce(provenance ->> 'name', '') = any(epic_owned_sources()))
        and coalesce(first_owned, '-infinity'::timestamptz) < now() - ${age}`, [RENTED_SOURCES]);

  // The index's own undated rented points: written by the rebuild before it
  // recorded a source, so the hourly expiry could never see them. Before the
  // cells, so a cell copied from one goes in the same pass (Codex).
  await step('place_index (undated)',
    `update place_index set lat = null, lng = null, cell = null, coords_at = null, coords_from = null, placed_at = null
      where lat is not null and (coords_from is null or coords_at is null)
        and ${RENTED_REF('venue_ref')}
        and not exists (select 1 from owned_points o where o.venue_ref = place_index.venue_ref)
        and first_seen < now() - ${age}`, [RENTED_SOURCES]);

  // Cells stamped from a copy that is gone: a rented reference's cell whose
  // point matches no point the place still holds anywhere.
  await step('place_cells',
    `delete from place_cells c
      where (${RENTED_REF('c.venue_ref')}
             -- An atlas reference on an unmatched activity-sweep row is Google's point too.
             or exists (select 1 from attractions g
                         where g.id = (case when c.venue_ref like 'atlas:%' then epic_try_uuid(substr(c.venue_ref, 7)) end)
                           and (g.display_source = 'google' or (g.source = 'google' and g.osm_ref is null))))
        and c.lat is not null
        and c.at < now() - ${age}
        and not exists (select 1 from place_index pi where pi.venue_ref = c.venue_ref and pi.lat is not null
                          and abs(pi.lat - c.lat) <= 0.0005 and abs(pi.lng - c.lng) <= 0.0005)
        and not exists (select 1 from owned_points o where o.venue_ref = c.venue_ref
                          and abs(o.lat - c.lat) <= 0.0005 and abs(o.lng - c.lng) <= 0.0005)`, [RENTED_SOURCES]);

  return out;
}
