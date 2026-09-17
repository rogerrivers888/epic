/**
 * The search log — what people asked us for, and whether we had it.
 *
 * **None of this can be backfilled.** The search used to be thrown away the
 * moment the response was sent, so every day it is not written is a day of
 * demand nobody will ever be able to look at. That is why writing it is the
 * first thing that happens and why a search that returned nothing is logged as
 * loudly as one that returned forty.
 *
 * What is stored is our own vocabulary: an area, a cell, one of our
 * subcategories, counts. Never a provider's label, never a provider's content,
 * and never a place's name — a replay re-resolves names at display and says what
 * that costs.
 */

import { query } from '../db.js';

const ORDER = { none: 0, clicked: 1, saved: 2, tripped: 3 };

/**
 * Write the search. Returns its id, which is the `queryId` the client already
 * carries — so `source_impressions.query_id`, which pointed at nothing at all,
 * now points here.
 */
export async function logSearch({
  id = null, householdId = null, accountId = null, sessionId = null, surface,
  areaSlug = null, lat = null, lng = null, cell = null, radiusKm = null, mode = null, minutes = null,
  asked = {}, subject = null, shownTotal = 0, shown = [], sourcesQueried = [], degraded = [], tripId = null,
} = {}) {
  const { rows } = await query(
    `insert into searches (id, household_id, account_id, session_id, surface, area_slug, lat, lng, cell,
                           radius_km, mode, minutes, asked, subject, shown_total, shown,
                           sources_queried, degraded, empty, trip_id)
     values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9,
             $10, $11, $12, $13::jsonb, $14, $15, $16::jsonb, $17, $18, $19, $20)
     on conflict (id) do update
        set shown_total = excluded.shown_total, shown = excluded.shown, empty = excluded.empty
     returning id`,
    [id, householdId, accountId, sessionId, surface, areaSlug, lat, lng, cell,
      radiusKm, mode, minutes, JSON.stringify(asked ?? {}), subject, shownTotal, JSON.stringify(shown ?? []),
      sourcesQueried, degraded, Number(shownTotal) === 0, tripId],
  );
  return rows[0].id;
}

/**
 * One thing a household did to one result.
 *
 * The outcome on the search itself only ever moves forward — a save after a
 * click does not undo the click — because the three faults are counted off it
 * and a number that can go backwards is a number nobody can act on.
 */
export async function logEvent({ searchId, kind, venueRef = null, position = null, dwellMs = null, meta = {} } = {}) {
  if (!searchId) return null;
  // A client holding an id from before a deploy, or from a search that was never
  // written, must not turn a tap into a five hundred. The log is worth having and
  // it is not worth that.
  try { return await writeEvent({ searchId, kind, venueRef, position, dwellMs, meta }); } catch { return null; }
}

async function writeEvent({ searchId, kind, venueRef, position, dwellMs, meta }) {
  await query(
    `insert into search_events (search_id, kind, venue_ref, position, dwell_ms, meta)
     values ($1,$2,$3,$4,$5,$6::jsonb)`,
    [searchId, kind, venueRef, position, dwellMs, JSON.stringify(meta ?? {})]);
  const outcome = kind === 'add_to_trip' ? 'tripped' : kind === 'save' || kind === 'shortlist' ? 'saved' : kind === 'open' ? 'clicked' : null;
  if (outcome) {
    await query(
      `update searches set outcome = $2, outcome_at = now()
        where id = $1 and (case outcome when 'tripped' then 3 when 'saved' then 2 when 'clicked' then 1 else 0 end) < $3`,
      [searchId, outcome, ORDER[outcome]]);
  }
  return true;
}

/** The three numbers, never one rate. */
export async function totals({ areaSlug = null, since = 30 } = {}) {
  const { rows: [r] } = await query(
    `select count(*)::int as searches,
            count(*) filter (where empty)::int as empty,
            count(*) filter (where not empty and outcome = 'none')::int as no_click,
            count(*) filter (where outcome in ('clicked','saved'))::int as no_trip,
            count(*) filter (where outcome = 'tripped')::int as tripped
       from searches
      where at > now() - ($1 || ' days')::interval and ($2::text is null or area_slug = $2)`,
    [String(since), areaSlug]);
  return { searches: r.searches, empty: r.empty, noClick: r.no_click, noTrip: r.no_trip, tripped: r.tripped };
}

/** What was asked for, and how each subject is failing. */
export async function bySubject({ areaSlug = null, since = 30, limit = 40 } = {}) {
  const { rows } = await query(
    `select coalesce(subject, '') as subject,
            count(*)::int as searches,
            count(*) filter (where empty)::int as empty,
            count(*) filter (where not empty and outcome = 'none')::int as no_click,
            count(*) filter (where outcome in ('clicked','saved'))::int as no_trip
       from searches
      where at > now() - ($1 || ' days')::interval and ($2::text is null or area_slug = $2)
      group by 1 order by count(*) desc limit $3`,
    [String(since), areaSlug, limit]);
  return rows.map((r) => ({
    subject: r.subject || null, searches: r.searches, empty: r.empty, noClick: r.no_click, noTrip: r.no_trip,
  }));
}

/** The log itself, most recent first. */
export async function recent({ areaSlug = null, since = 30, limit = 40 } = {}) {
  const { rows } = await query(
    `select s.id, s.at, s.surface, s.subject, s.area_slug, s.cell, s.minutes, s.mode,
            s.shown_total, s.empty, s.outcome, s.account_id, s.asked,
            (select count(*)::int from search_events e where e.search_id = s.id and e.kind = 'open') as opened,
            (select count(*)::int from search_events e where e.search_id = s.id and e.kind = 'add_to_trip') as tripped
       from searches s
      where s.at > now() - ($1 || ' days')::interval and ($2::text is null or s.area_slug = $2)
      order by s.at desc limit $3`,
    [String(since), areaSlug, limit]);
  return rows;
}

/** One search, with everything that household was shown, in order. */
export async function oneSearch(id) {
  const { rows: [s] } = await query('select * from searches where id = $1', [id]);
  if (!s) return null;
  const { rows: events } = await query(
    'select kind, venue_ref, position, dwell_ms, at, meta from search_events where search_id = $1 order by position nulls last, at', [id]);
  return { search: s, events };
}

/**
 * The aggregate-and-drop path, built now and switched off.
 *
 * Owner, 17 Sep 2026: "I think we should retain all searches for now, but once
 * that starts to become too big, then we can certainly start to remove or
 * aggregate." So this exists and nothing calls it on a timer — switching it on
 * is a setting rather than a migration written under pressure.
 */
export async function rollUp({ before, drop = false } = {}) {
  const { rows: [n] } = await query(`
    insert into search_rollups (month, area_slug, subject, searches, empty, no_click, no_trip)
    select date_trunc('month', at)::date, coalesce(area_slug, ''), coalesce(subject, ''),
           count(*)::int, count(*) filter (where empty)::int,
           count(*) filter (where not empty and outcome = 'none')::int,
           count(*) filter (where outcome in ('clicked','saved'))::int
      from searches where at < $1
     group by 1,2,3
    on conflict (month, area_slug, subject) do update
       set searches = excluded.searches, empty = excluded.empty,
           no_click = excluded.no_click, no_trip = excluded.no_trip, rolled_at = now()
    returning 1`, [before]);
  let dropped = 0;
  if (drop) {
    const { rowCount } = await query('delete from searches where at < $1', [before]);
    dropped = rowCount;
  }
  return { rolled: n ? 1 : 0, dropped };
}

/** How big the log has got — the trigger to revisit retention is a count, not a date. */
export const size = async () => (await query(
  'select count(*)::bigint as rows, min(at) as oldest from searches')).rows[0];

/** Erasure reaches both tables: the household cascades, the account sets null. */
export async function forgetAccount(accountId) {
  const { rowCount } = await query('update searches set account_id = null where account_id = $1', [accountId]);
  return { anonymised: rowCount };
}

/**
 * Where a search was, in the vocabulary the back office counts in.
 *
 * A point becomes a cell, and the cell becomes an area — the county its own
 * places fall in — so "Berkshire, last 30 days" is one indexed read rather than
 * a geometry question asked at report time.
 */
export async function whereOf({ lat = null, lng = null, areaSlug = null } = {}) {
  if (areaSlug) {
    const { rows: [l] } = await query('select slug, parent_slug, kind from localities where slug = $1', [String(areaSlug).toLowerCase()]);
    if (l) return { areaSlug: l.kind === 'town' && l.parent_slug ? l.parent_slug : l.slug, cell: null };
  }
  if (lat == null || lng == null) return { areaSlug: null, cell: null };
  const { rows: [cell] } = await query(
    `select code, outcode from geo_cells
      order by (lat - $1) * (lat - $1) + (lng - $2) * (lng - $2) limit 1`, [lat, lng]);
  if (!cell) return { areaSlug: null, cell: null };
  // The county an outcode's own places fall in. An outcode does not nest under a
  // county, so this is the commonest answer rather than a claimed one.
  const { rows: [county] } = await query(
    `select l.slug from place_areas pa
       join localities l on l.slug = pa.area_slug and l.kind = 'county'
      where pa.venue_ref in (select venue_ref from place_cells where cell = $1)
      group by l.slug order by count(*) desc limit 1`, [cell.code]);
  return { areaSlug: county?.slug ?? null, cell: cell.code };
}

/**
 * The one call every search path makes.
 *
 * Wrapped so a failure to log can never be the reason a household's search
 * fails: the log matters, and it does not matter that much.
 */
export async function noteSearch(input) {
  try { return await logSearch(input); } catch { return input.id ?? null; }
}

/** The rows a search showed, written once so a replay can print them in order. */
export async function noteShown(searchId, items = []) {
  if (!searchId || !items.length) return;
  try {
    const values = items.map((_, i) => `($1, 'shown', $${i * 3 + 2}, $${i * 3 + 3}, $${i * 3 + 4}::jsonb)`).join(',');
    await query(
      `insert into search_events (search_id, kind, venue_ref, position, meta) values ${values}`,
      [searchId, ...items.flatMap((it, i) => [it.ref ?? null, it.position ?? i + 1, JSON.stringify({ score: it.score ?? null, source: it.source ?? null })])]);
  } catch { /* the log is not worth a failed search */ }
}
