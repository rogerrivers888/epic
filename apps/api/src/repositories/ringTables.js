/**
 * A ring's counts and its order, as owned rows.
 *
 * The owner, 20 Sep 2026: "Store the counts and the ranking — place IDs by Epic
 * score, per category per band — as owned data, refreshed on the 30-day census
 * cycle. The count on Inspire should be read from that table, instantly, every
 * time, never computed while the household waits."
 *
 * Two tables (migration 245), keyed on the ring — a sector, a way of travelling,
 * a number of minutes — and never on a household: everybody whose home snaps to
 * the same sector reads the same rows.
 *
 *   · `ring_counts`    — what the census placed inside the *band*, per category,
 *                        with the floor rule carried on the row.
 *   · `ring_rankings`  — the same places, the ones with an Epic score, in score
 *                        order. Identifiers and a number that is ours; nothing
 *                        rented (data policy, 19 Sep 2026).
 *
 * Three rules about when it is written:
 *
 *   · **Never while a household waits.** `countsFor` reads and returns. A ring
 *     with no rows answers "no depth yet" and the caller refreshes in the
 *     background; the next look reads it.
 *   · **On registration and on any home-location change**, for the bands the
 *     app offers (`BANDS`), because that is when the ring a household reads
 *     becomes known.
 *   · **On the 30-day cycle**, matching the census: a ring older than that is
 *     counted again from whatever the census now knows.
 *   · **When a census run finishes**, every ring counted before it finished is
 *     counted again (Codex, 24 Sep 2026): a home that asked for its districts
 *     to be censused would otherwise keep reading the snapshot taken before
 *     the census found anything — and a ring counted *during* the run read a
 *     half-filled index, so the cutoff is the moment the run ended, not the
 *     moment it began.
 *
 * A ring that has been counted and holds nothing is still a ring that has been
 * counted: it carries a marker row (category '') so the cycle can find it and
 * `countsFor` can tell "nothing here" from "nobody has looked" (Codex, 24 Sep
 * 2026). The marker never reaches a household — `countsFor` leaves it out.
 *
 * The band, not the finder: the finder's ten-minute allowance belongs to the
 * search and never to a number a household reads (`domain/reach.js`).
 */

import { query, withTransaction } from '../db.js';
import { censusInRing } from './censusRing.js';
import { ringFor, cellAt } from './reach.js';
import { travelMode } from '../domain/travel.js';

/**
 * The bands the app offers (`HOW_FAR` in the web's inspireList.ts: 20, 30, 60
 * and 120 minutes), so every one a household can pick is already counted —
 * with two hours read as ninety, which is where the reachability matrix and
 * the Inspire route both cap a band. Keep in step with HOW_FAR by hand; a band
 * the app can ask for that is not here is a band that reads "no depth yet".
 */
export const BANDS = [20, 30, 60, 90];
/** The census's own cycle. */
export const CYCLE_DAYS = 30;
/** Enough of an order to page through; nobody scrolls past this. */
const RANK_CAP = 500;
/** The ring-level row: counted, whether or not anything was found. */
const MARKER = '';

/**
 * Count one ring and write its order down. Returns what it wrote.
 *
 * `cell` is the ring's own sector code (`sector:SL5 7`). The ring is drawn from
 * it directly rather than from a point, so the row is about exactly the ring
 * its key names.
 */
export async function refreshRing({ cell, mode = 'driving', minutes = 30, force = false } = {}) {
  const kind = travelMode(mode);
  // One count of a ring at a time, in this process (Codex, 25 Sep 2026).
  //
  // A plain refresh — a page load finding the ring uncounted or stale — joins
  // the count already in flight for the same key rather than queueing another
  // behind it: a burst of N looks is one count, not N. A *forced* refresh —
  // the walk after a matrix or census refresh, which exists to replace what
  // an in-flight count may be reading — queues behind it and counts again
  // once it has written, rather than racing it and losing. A count that
  // failed does not block the next.
  const key = ringKey({ cell, mode: kind, minutes });
  const going = inFlight.get(key);
  if (going && !force) return going;
  const run = (going ?? Promise.resolve()).catch(() => null).then(() => countRing({ cell, kind, minutes }));
  inFlight.set(key, run);
  try { return await run; }
  finally { if (inFlight.get(key) === run) inFlight.delete(key); }
}

/** Counts in flight, by ring key — what serialises `refreshRing`. */
const inFlight = new Map();

async function countRing({ cell, kind, minutes }) {
  // The row is dated from the moment the count began reading, not the moment
  // it wrote: a count that read the matrix or the census before a refresh and
  // wrote after it would otherwise carry a date newer than the refresh's
  // cutoff and be skipped by the walk that follows, while holding the old
  // shape (Codex, 25 Sep 2026). Dated from the start, it is inside the walk.
  const { rows: [{ at: startedAt }] } = await query('select now() as at');
  const ring = await ringFor({ cell, minutes, mode: kind });
  if (!ring) return null;
  const band = ring.band ?? ring.cells;

  const [placed, seen] = await Promise.all([
    censusInRing({ cells: band, outcodes: ring.outcodes }),
    query('select distinct area_slug, category from area_counts where area_slug = any($1)',
      [ring.outcodes.map((o) => o.toLowerCase())]),
  ]);
  const censused = new Set(seen.rows.map((r) => r.area_slug));
  const notCensused = ring.outcodes.filter((o) => !censused.has(o.toLowerCase())).length;

  // Every category the census knows in these districts, so a category it
  // looked for and found nothing of is written as nought rather than left
  // out — nought from a census that looked is an answer; a missing row is not.
  const categories = new Set([
    ...Object.keys(placed.counts), ...Object.keys(placed.unresolved),
    ...seen.rows.map((r) => r.category).filter((c) => c && c !== MARKER),
  ]);
  const counts = [];
  for (const category of categories) {
    const unresolved = placed.unresolved[category] ?? 0;
    counts.push({
      category,
      places: placed.counts[category] ?? 0,
      unresolved,
      // A district nobody has looked at contributes nought, and nought is not
      // an answer — so it makes the count a floor, exactly as an unresolved box
      // does.
      floor: unresolved > 0 || notCensused > 0,
    });
  }
  // The ring's own row, always: what makes an empty ring a counted one.
  counts.push({ category: MARKER, places: 0, unresolved: 0, floor: notCensused > 0 });

  // The order: the places the count is made of, joined to the freshest score
  // we hold for each — the same rule `household()` ranks by, so a shelf and a
  // list never disagree about who is first.
  const refs = [...new Set(Object.values(placed.refs ?? {}).flat())];
  const scored = refs.length
    ? (await query(
      `select t.venue_ref,
              case
                when sp.epic_score is null then coalesce(r.epic_score, a.epic_score)
                when r.epic_score is null then sp.epic_score
                when coalesce(greatest(r.scored_at, r.banded_at), to_timestamp(0)) >= coalesce(sp.scored_at, to_timestamp(0)) then r.epic_score
                else sp.epic_score end as epic
         from unnest($1::text[]) as t(venue_ref)
         left join place_records r on r.venue_ref = t.venue_ref
         left join lateral (select s2.epic_score, s2.scored_at from scout_places s2 where s2.venue_ref = t.venue_ref order by s2.last_seen desc limit 1) sp on true
         left join lateral (
           select a2.epic_score from attractions a2
            where (a2.venue_ref = t.venue_ref or 'atlas:' || a2.id::text = t.venue_ref) and a2.state <> 'hidden'
            order by a2.last_seen desc limit 1) a on true`,
      [refs])).rows
    : [];
  const scoreOf = new Map(scored.filter((r) => r.epic != null).map((r) => [r.venue_ref, Number(r.epic)]));

  const rankings = [];
  for (const category of categories) {
    const ordered = (placed.refs?.[category] ?? [])
      .filter((ref) => scoreOf.has(ref))
      .sort((x, y) => scoreOf.get(y) - scoreOf.get(x) || (x < y ? -1 : 1))
      .slice(0, RANK_CAP);
    ordered.forEach((ref, i) => rankings.push({ category, venueRef: ref, epicScore: scoreOf.get(ref), rank: i + 1 }));
  }

  // Written whole, on one connection: a ring half counted is worse than a ring
  // counted last month, and `begin` through the pool is not a transaction —
  // each statement may land on a different client.
  await withTransaction(async (client) => {
    await client.query('delete from ring_counts where cell = $1 and mode = $2 and minutes = $3', [cell, kind, minutes]);
    await client.query('delete from ring_rankings where cell = $1 and mode = $2 and minutes = $3', [cell, kind, minutes]);
    await client.query(
      `insert into ring_counts (cell, mode, minutes, category, places, unresolved, floor, computed_at)
       select $1, $2, $3, c.category, c.places, c.unresolved, c.floor, $8::timestamptz
         from unnest($4::text[], $5::int[], $6::int[], $7::boolean[]) as c(category, places, unresolved, floor)`,
      [cell, kind, minutes, counts.map((c) => c.category), counts.map((c) => c.places),
        counts.map((c) => c.unresolved), counts.map((c) => c.floor), startedAt]);
    if (rankings.length) {
      await client.query(
        `insert into ring_rankings (cell, mode, minutes, category, venue_ref, epic_score, rank, computed_at)
         select $1, $2, $3, r.category, r.venue_ref, r.epic_score, r.rank, $8::timestamptz
           from unnest($4::text[], $5::text[], $6::real[], $7::int[]) as r(category, venue_ref, epic_score, rank)`,
        [cell, kind, minutes, rankings.map((r) => r.category), rankings.map((r) => r.venueRef),
          rankings.map((r) => r.epicScore), rankings.map((r) => r.rank), startedAt]);
    }
  });
  return {
    cell, mode: kind, minutes, counts: counts.filter((c) => c.category !== MARKER), ranked: rankings.length, notCensused,
    computedAt: startedAt,
    // Named, so the caller can ask the census to look at them.
    notCensusedOutcodes: ring.outcodes.filter((o) => !censused.has(o.toLowerCase())),
  };
}

/**
 * What a home-location change kicks off: every band, for the sector the home
 * snaps to. Returns the districts in the widest band that the census has never
 * looked at, so the caller can start a run for them — a ring is only as good
 * as the census under it.
 */
export async function refreshForHome({ lat, lng, mode = 'driving', bands = BANDS } = {}) {
  if (lat == null || lng == null) return null;
  const at = await cellAt({ lat: Number(lat), lng: Number(lng) }).catch(() => null);
  if (!at?.code) return null;
  const done = await refreshBands({ cell: at.code, mode, bands });
  const widest = done.filter(Boolean).sort((a, b) => b.minutes - a.minutes)[0] ?? null;
  return { cell: at.code, bands: done, notCensusedOutcodes: widest?.notCensusedOutcodes ?? [] };
}

/** Every band the app offers, for one ring. What a home-location change kicks off. */
export async function refreshBands({ cell, mode = 'driving', bands = BANDS } = {}) {
  const out = [];
  for (const minutes of bands) out.push(await refreshRing({ cell, mode, minutes }));
  return out;
}

/**
 * The counts a household reads. A read and nothing else.
 *
 * `null` means "not counted yet", and the caller's job is to refresh behind the
 * screen — never in front of it. `{}` means counted, and nothing there: a
 * different fact, and one that must not send the caller counting again.
 */
export async function countsFor({ cell, mode = 'driving', minutes = 30 } = {}) {
  const { rows } = await query(
    `select category, places, unresolved, floor, computed_at
       from ring_counts where cell = $1 and mode = $2 and minutes = $3`,
    [cell, travelMode(mode), minutes]);
  if (!rows.length) return null;
  return Object.fromEntries(rows.filter((r) => r.category !== MARKER).map((r) => [r.category, {
    places: r.places, unresolved: r.unresolved, floor: r.floor, computedAt: r.computed_at,
  }]));
}

/** The order a household is shown, for one category of one ring. */
export async function rankingFor({ cell, mode = 'driving', minutes = 30, category, limit = 50 } = {}) {
  const { rows } = await query(
    `select venue_ref, epic_score, rank from ring_rankings
      where cell = $1 and mode = $2 and minutes = $3 and category = $4
      order by rank limit $5`,
    [cell, travelMode(mode), minutes, category, limit]);
  return rows.map((r) => ({ venueRef: r.venue_ref, epicScore: Number(r.epic_score), rank: r.rank }));
}

/**
 * The 30-day cycle: every ring older than the census's own window is counted
 * again. Rings are only ever added by a household's home, so this is bounded
 * by the number of homes, not the number of sectors.
 *
 * `before` names a moment instead of an age: a census run that has just
 * finished passes the moment it started, and every ring counted before it
 * is counted again from what the run found.
 */
export const ringKey = ({ cell, mode, minutes }) => `${cell}|${mode}|${minutes}`;

export async function refreshDue({ olderThanDays = CYCLE_DAYS, before = null, limit = 200, skip = [] } = {}) {
  const cutoff = before ? new Date(before) : new Date(Date.now() - olderThanDays * 86_400_000);
  const { rows } = await query(
    `select cell, mode, minutes, min(computed_at) as at
       from ring_counts
      where cell || '|' || mode || '|' || minutes::text <> all($3::text[])
      group by cell, mode, minutes
     having min(computed_at) < $1::timestamptz
      order by at limit $2`, [cutoff.toISOString(), limit, skip]);
  const done = [];
  for (const r of rows) {
    const key = { cell: r.cell, mode: r.mode, minutes: r.minutes };
    // Every ring tried is handed back, counted or not, so a walk can skip it.
    // Forced: a due ring is counted again even if a count of it is in flight.
    try { done.push((await refreshRing({ ...key, force: true })) ?? { ...key, ring: null }); }
    catch (err) { done.push({ ...key, error: String(err.message).slice(0, 120) }); }
  }
  return done;
}

/**
 * Every ring counted before a moment, however many there are: `refreshDue`
 * takes a page, and a counted ring leaves the page, so asking again with the
 * same moment walks the rest (Codex, 24 Sep 2026: one page of a thousand left
 * the rings beyond it on their pre-census snapshot). A ring that fails to
 * count — or resolves to nothing — stays before the cutoff, so every ring
 * tried is handed back as one to skip: a page of failures does not hide the
 * rings behind it, and nothing is tried twice in a pass.
 *
 * Two passes, with a wait between them for every count in flight in this
 * process, because a ring counted for the first time while the walk was
 * going — from the old shape, dated before the cutoff — has no row for the
 * first pass to find, and the walk cannot end before that count has written
 * or the row lands after it and keeps the old shape for a cycle (Codex, 25
 * Sep 2026, twice). The wait lets every in-flight count write; the second
 * pass then finds any row dated before the cutoff and counts it again,
 * forced, behind anything still going. A ring the first pass counted is
 * dated after the cutoff and is not touched again; only a ring that failed
 * is tried once more.
 */
export async function refreshAllBefore({ before, pageSize = 200, maxPages = 10_000, passes = 2 } = {}) {
  const out = [];
  for (let pass = 0; pass < passes; pass += 1) {
    if (pass > 0) await Promise.allSettled([...inFlight.values()]);
    const tried = new Set();
    for (let pages = 0; pages < maxPages; pages += 1) {
      const page = await refreshDue({ before, limit: pageSize, skip: [...tried] });
      if (!page.length) break;
      for (const r of page) tried.add(ringKey(r));
      out.push(...page);
    }
  }
  return out;
}
