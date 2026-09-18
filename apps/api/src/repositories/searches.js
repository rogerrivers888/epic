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

import { query, withTransaction } from '../db.js';

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
      sourcesQueried,
      // Source *names*, because the column is `text[]` and the replay prints
      // them as words. Two callers hand over `{ source, error, slow }` objects,
      // which Postgres stringified into the array — so a replay after any
      // provider timed out printed a lump of JSON where a source should be
      // (Codex, 18 Sep 2026).
      (degraded ?? []).map((d) => (typeof d === 'string' ? d : d?.source)).filter(Boolean),
      Number(shownTotal) === 0, tripId],
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
export async function logEvent({ searchId, kind, venueRef = null, position = null, dwellMs = null, meta = {}, householdId = null } = {}) {
  if (!searchId) return null;
  // A client holding an id from before a deploy, or from a search that was never
  // written, must not turn a tap into a five hundred. The log is worth having and
  // it is not worth that.
  try { return await writeEvent({ searchId, kind, venueRef, position, dwellMs, meta, householdId }); } catch { return null; }
}

async function writeEvent({ searchId, kind, venueRef, position, dwellMs, meta, householdId = null }) {
  // The search has to be this household's.
  //
  // Anybody signed in who got hold of another search's id could add events to
  // it and move its outcome, which is somebody else's demand figures written by
  // a stranger (Codex, 17 Sep 2026). Given a household, the write only lands on
  // a search that belongs to it; given none — the anonymous surfaces — it lands
  // as before, because there is nobody to check against.
  if (householdId) {
    const { rows } = await query(
      'select 1 from searches where id = $1 and household_id = $2', [searchId, householdId]);
    if (!rows.length) return null;
  }
  // One open per place per search, held by the database rather than only by the
  // screen (migration 176). An insert that commits and whose answer is lost
  // leaves the client thinking it never happened, so the next tap sends it
  // again — and the count went up twice for one look (Codex, 18 Sep 2026).
  //
  // Deliberately only `open`, which migration 176 says out loud: a save, a
  // shortlist and an add-to-trip are each their own act and can honestly happen
  // more than once. So a retry of one of those can leave a second row, and that
  // is a decision already taken rather than a hole — it costs a duplicate line
  // in a replay and cannot move an outcome, which only ever rises.
  const outcome = kind === 'add_to_trip' ? 'tripped' : kind === 'save' || kind === 'shortlist' ? 'saved' : kind === 'open' ? 'clicked' : null;
  const insert = [
    `insert into search_events (search_id, kind, venue_ref, position, dwell_ms, meta)
     values ($1,$2,$3,$4,$5,$6::jsonb)
     on conflict do nothing`,
    [searchId, kind, venueRef, position, dwellMs, JSON.stringify(meta ?? {})],
  ];
  // An event with no outcome behind it — a dismiss, a refine, a close — is just
  // the row, and there is nothing for it to be atomic with.
  if (!outcome) { await query(...insert); return true; }
  {
    // The move, and what it moved from — a rolled search has to take its
    // outcome with it into the bucket it was folded into.
    //
    // A shortlisted place reaches an itinerary on a later visit, sometimes much
    // later, so a search can receive the outcome the whole board is built
    // around long after it was rolled up. The row was updated and the bucket
    // was not, so the conversion read as "clicked, never tripped" for ever —
    // and with dropping on, the row is gone and it is lost outright (Codex,
    // 18 Sep 2026; migration 177 is what made a late conversion possible).
    // The row and its bucket move together, under one lock.
    //
    // `for update` serialises two events on one search: without it both could
    // read the same `before` — an open and a save arriving together — and the
    // later one would compare against a value already out of date, so an open
    // could put a search back from "saved" to "clicked" (Codex, 18 Sep 2026).
    // Outcomes only ever rise, and that is only true if they are read one at a
    // time.
    //
    // But the lock is held only for as long as the transaction, and a bare
    // `query` commits on its own — so the rollup correction ran outside it.
    // Two events on a rolled search could take the row's lock one after the
    // other and then adjust the bucket in the opposite order, leaving one
    // search counted in `tripped` *and* in `no_trip` (Codex, 19 Sep 2026). The
    // bucket holds counts, not rows, so there is nothing to reconcile it
    // against afterwards: it has to be right when it is written.
    // Answered `null` if it could not be done, not swallowed.
    //
    // The rollup statement used to swallow its own failures, which inside a
    // transaction is a lie: Postgres has already aborted it, so the commit fails
    // anyway. And it is the wrong instinct here — the route turns `null` into
    // `ok: false` and the client tries again, the event insert is idempotent,
    // and outcomes only ever rise. Half-applied is the one state there is no
    // recovering from, and that is what this transaction exists to prevent.
    let ok = true;
    await withTransaction(async (client) => {
      // The row and the outcome together.
      //
      // The insert used to commit on its own, so a failure to advance the
      // outcome left a replay event behind while Demand went on classifying the
      // search under the outcome it had before — and the retry the `ok: false`
      // asks for would insert a second row, because only `open` has a
      // uniqueness constraint to stop it (Codex, 19 Sep 2026; migration 176 is
      // the one that gave `open` its). Either the household did this and the
      // search says so, or neither is true yet.
      await client.query(...insert);
      const { rows: [moved] } = await client.query(
        `with was as (
           select id, outcome as before, empty, rolled_at, area_slug, subject, at
             from searches where id = $1::uuid for update)
         update searches s set outcome = $2, outcome_at = now()
           from was w
          where s.id = w.id
            and (case w.before when 'tripped' then 3 when 'saved' then 2 when 'clicked' then 1 else 0 end) < $3
         returning w.before, w.empty, w.rolled_at, w.area_slug, w.subject, w.at`,
        [searchId, outcome, ORDER[outcome]]);
      if (moved?.rolled_at) await moveInTheRollup(moved, outcome, client);
    }).catch(() => { ok = false; });
    if (!ok) return null;
  }
  return true;
}


/**
 * A rolled search whose outcome has since risen, moved from one column of its
 * bucket to another.
 *
 * The bucket holds counts, not rows, so the only honest correction is to take
 * one off the column the search used to be in and add one to the column it is
 * in now. `empty` never moves — it is a property of the answer, not of what
 * anybody did with it.
 */
const BUCKET = (outcome, empty) => (outcome === 'tripped' ? 'tripped'
  : outcome === 'saved' || outcome === 'clicked' ? 'no_trip'
    : empty ? null : 'no_click');

async function moveInTheRollup(was, outcome, client = null) {
  const from = BUCKET(was.before, was.empty);
  const to = BUCKET(outcome, was.empty);
  if (!to || from === to) return;
  const bump = (col, by) => `${col} = greatest(0, ${col} + ${by})`;
  // On the caller's connection where there is one, so it is inside the lock that
  // makes the move safe. It no longer swallows its own failures: the caller owns
  // that decision now, because the row and the bucket are one fact and either
  // both move or neither does.
  const run = client ? (sql, args) => client.query(sql, args) : (sql, args) => query(sql, args);
  await run(
    `update search_rollups
        set ${to ? bump(to, 1) : ''}${to && from ? ', ' : ''}${from ? bump(from, -1) : ''}
      where month = date_trunc('month', $1::timestamptz)::date
        and area_slug = coalesce($2, '') and subject = coalesce($3, '')`,
    [was.at, was.area_slug, was.subject],
  );
}

/** The three numbers, never one rate. */
/**
 * The first whole month a window of $1 days can claim from the roll-ups.
 *
 * A rolled month is one number and cannot be cut, so the folded term takes only
 * a month lying wholly inside the window. Everything before that line the live
 * rows have to answer for — including rows already rolled, which are still here
 * unless retention dropped them.
 *
 * Exported because three queries ask it and they have to agree: the two here
 * and the Demand lens inside Places, which had its own copy and went on losing
 * the edge month after the others stopped (Codex, 18 Sep 2026).
 */
export const FIRST_WHOLE_MONTH = `date_trunc('month', now() - ($1 || ' days')::interval)
       + (case when date_trunc('month', now() - ($1 || ' days')::interval)
                    >= (now() - ($1 || ' days')::interval)
               then interval '0 month' else interval '1 month' end)`;

/** A live row this window still needs: never rolled, or rolled into a month the fold cannot claim. */
export const LIVE_ROW = (t) => `(${t}.rolled_at is null or date_trunc('month', ${t}.at) < ${FIRST_WHOLE_MONTH})`;

export async function totals({ areaSlugs = null, cells = null, since = 30 } = {}) {
  // The rows we still hold, plus the months we have folded up and dropped.
  //
  // Retention is switched off by default, so today these two are the first term
  // and nothing. The moment somebody switches it on, the board would have lost
  // every search older than the window — and the log cannot be backfilled, so
  // it would have lost them for good (Codex, 17 Sep 2026). A rolled month is
  // counted whole: it is a month, and the window is in days, so it counts when
  // the whole of it is inside the window.
  const { rows: [r] } = await query(
    `with live as (
       select count(*)::int as searches,
              count(*) filter (where empty)::int as empty,
              count(*) filter (where not empty and outcome = 'none')::int as no_click,
              count(*) filter (where outcome in ('clicked','saved'))::int as no_trip,
              count(*) filter (where outcome = 'tripped')::int as tripped
         from searches
        where at > now() - ($1 || ' days')::interval
          and ($2::text[] is null or area_slug = any($2))
          and ($3::text[] is null or cell = any($3))
          -- Not the ones already folded up — unless the fold cannot claim
          -- them.
          --
          -- A roll-up without dropping leaves the rows in place *and* writes
          -- the aggregate, so counting both doubled every rolled search for
          -- ever (Codex, 17 Sep 2026). But the folded term only takes a month
          -- that lies *wholly* inside the window, so the part of the edge month
          -- inside it was counted by neither: a thirty-day report made on the
          -- 18th of September lost the 19th to the 31st of August the moment
          -- August was rolled (Codex, 18 Sep 2026). A rolled row whose month
          -- the fold leaves out is still this report's, and it is still here
          -- unless retention dropped it.
          and ${LIVE_ROW('searches')}
     ), folded as (
       select coalesce(sum(searches), 0)::int as searches, coalesce(sum(empty), 0)::int as empty,
              coalesce(sum(no_click), 0)::int as no_click, coalesce(sum(no_trip), 0)::int as no_trip,
              coalesce(sum(tripped), 0)::int as tripped
         from search_rollups
        -- Only a month that lies *wholly* inside the window. Truncating the
        -- edge to the first of the month pulled the whole of August into a
        -- thirty-day report made on the 18th of September (Codex, 17 Sep 2026),
        -- and a rolled month cannot be cut: it is one number for the month.
        where month >= date_trunc('month', now() - ($1 || ' days')::interval)
                     + (case when date_trunc('month', now() - ($1 || ' days')::interval)
                                  >= (now() - ($1 || ' days')::interval)
                             then interval '0 month' else interval '1 month' end)
          and ($2::text[] is null or area_slug = any($2))
          -- A roll-up is filed by area and has no cell, so a town scoped by its
          -- own cells takes the live rows only rather than claiming a month it
          -- cannot support.
          and $3::text[] is null
     )
     select live.searches + folded.searches as searches, live.empty + folded.empty as empty,
            live.no_click + folded.no_click as no_click, live.no_trip + folded.no_trip as no_trip,
            live.tripped + folded.tripped as tripped
       from live, folded`,
    [String(since), areaSlugs, cells]);
  return { searches: r.searches, empty: r.empty, noClick: r.no_click, noTrip: r.no_trip, tripped: r.tripped };
}

/** What was asked for, and how each subject is failing. */
export async function bySubject({ areaSlugs = null, cells = null, since = 30, limit = 40 } = {}) {
  // The rows we still hold *and* the months folded up, the same two terms the
  // headline figures add. Reading only the live rows meant the totals would
  // include a rolled month and every subject row would leave it out, which is a
  // board that does not add up — and the rollup keeps the subject on purpose
  // (Codex, 17 Sep 2026).
  const { rows } = await query(
    `with counted as (
       select coalesce(subject, '') as subject, 1 as searches,
              (case when empty then 1 else 0 end) as empty,
              (case when not empty and outcome = 'none' then 1 else 0 end) as no_click,
              (case when outcome in ('clicked','saved') then 1 else 0 end) as no_trip
         from searches
        where at > now() - ($1 || ' days')::interval
          and ($2::text[] is null or area_slug = any($2))
          and ($4::text[] is null or cell = any($4))
          -- The same rule the headline figures use: a rolled row whose month
          -- the fold leaves out is still this report's (Codex, 18 Sep 2026).
          and ${LIVE_ROW('searches')}
       union all
       select subject, searches, empty, no_click, no_trip
         from search_rollups
        -- The same rule as the headline figures: a rolled month is one number
        -- and cannot be cut, so it counts only when the whole of it is inside
        -- the window (Codex, 17 Sep 2026).
        where month >= date_trunc('month', now() - ($1 || ' days')::interval)
                     + (case when date_trunc('month', now() - ($1 || ' days')::interval)
                                  >= (now() - ($1 || ' days')::interval)
                             then interval '0 month' else interval '1 month' end)
          and ($2::text[] is null or area_slug = any($2))
          and $4::text[] is null
     )
     select subject,
            sum(searches)::int as searches, sum(empty)::int as empty,
            sum(no_click)::int as no_click, sum(no_trip)::int as no_trip
       from counted
      group by 1 order by sum(searches) desc limit $3`,
    [String(since), areaSlugs, limit, cells]);
  return rows.map((r) => ({
    subject: r.subject || null, searches: r.searches, empty: r.empty, noClick: r.no_click, noTrip: r.no_trip,
  }));
}

/** The log itself, most recent first. */
export async function recent({ areaSlugs = null, cells = null, since = 30, limit = 40 } = {}) {
  const { rows } = await query(
    `select s.id, s.at, s.surface, s.subject, s.area_slug, s.cell, s.minutes, s.mode,
            s.shown_total, s.empty, s.outcome, s.account_id, s.asked,
            (select count(*)::int from search_events e where e.search_id = s.id and e.kind = 'open') as opened,
            (select count(*)::int from search_events e where e.search_id = s.id and e.kind = 'add_to_trip') as tripped
       from searches s
      where s.at > now() - ($1 || ' days')::interval
        and ($2::text[] is null or s.area_slug = any($2))
        and ($4::text[] is null or s.cell = any($4))
      order by s.at desc limit $3`,
    [String(since), areaSlugs, limit, cells]);
  return rows;
}

/** One search, with everything that household was shown, in order. */
export async function oneSearch(id) {
  const { rows: [s] } = await query('select * from searches where id = $1', [id]);
  if (!s) return null;
  // What was on screen first, then what was one tap behind it.
  //
  // `drawn` is set by `noteDrawn` where the screen has said what it drew; a
  // search from before that, or from a surface that does not report, has no
  // mark on any row and keeps its original order (Codex, 18 Sep 2026).
  const { rows: events } = await query(
    `select kind, venue_ref, position, dwell_ms, at, meta from search_events
      where search_id = $1
      order by (meta->>'drawn' = 'false'), position nulls last, at`, [id]);
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
/**
 * How many whole months of live rows deletion always leaves behind.
 *
 * Ninety days is the longest window the Demand board offers, which can reach
 * four calendar months back at the start of a month; a rolled month cannot be
 * cut, so the live rows are the only thing that can answer inside one.
 */
const KEEP_MONTHS = 4;

export async function rollUp({ before, drop = false } = {}) {
  // Whole months only.
  //
  // A bucket is labelled with the month it belongs to and holds one number, so
  // a cutoff partway through a month made a bucket that no window can use: a
  // report whose edge falls inside it has to leave the whole thing out, and
  // with `drop` the rest of that month is gone for good (Codex, 18 Sep 2026).
  // The cutoff is moved back to the first of its own month; what is left of the
  // month waits for the next run, by which time it is complete.
  const cutoff = new Date(Date.UTC(
    new Date(before).getUTCFullYear(), new Date(before).getUTCMonth(), 1, 0, 0, 0, 0));
  // Each search exactly once, whatever order the runs are made in.
  //
  // `rolled_at` is the marker (migration 157). Counting every row before the
  // cutoff and *replacing* the month's totals lost the part an earlier run had
  // already rolled and dropped; *adding* them would double-count a run made
  // twice without dropping. Counting only the rows nobody has counted yet is
  // right in both cases (Codex, 17 Sep 2026).
  const { rows: [counted] } = await query(`
    with unrolled as (
      update searches set rolled_at = now()
       where at < $1 and rolled_at is null
      returning at, area_slug, subject, empty, outcome
    )
    , folded as (
    insert into search_rollups (month, area_slug, subject, searches, empty, no_click, no_trip, tripped)
    select date_trunc('month', at)::date, coalesce(area_slug, ''), coalesce(subject, ''),
           count(*)::int, count(*) filter (where empty)::int,
           count(*) filter (where not empty and outcome = 'none')::int,
           count(*) filter (where outcome in ('clicked','saved'))::int,
           -- The third outcome, and the only one that says something went
           -- right. Dropped, it was gone for good (Codex, 17 Sep 2026).
           count(*) filter (where outcome = 'tripped')::int
      from unrolled
     group by 1,2,3
    -- Added to, not replaced.
    --
    -- A cutoff in the middle of a month rolls that month's early rows and drops
    -- them; the next run sees only what is left, and replacing the totals threw
    -- away the part already rolled — permanently, because the rows behind it
    -- are gone (Codex, 17 Sep 2026). The log cannot be backfilled, so a rollup
    -- that loses counts loses them for good.
    on conflict (month, area_slug, subject) do update
       set searches = search_rollups.searches + excluded.searches,
           empty = search_rollups.empty + excluded.empty,
           no_click = search_rollups.no_click + excluded.no_click,
           no_trip = search_rollups.no_trip + excluded.no_trip,
           tripped = search_rollups.tripped + excluded.tripped,
           rolled_at = now()
    returning 1
    )
    -- How many searches were folded up, not how many groups they fell into: the
    -- insert returns a row per (month, area, subject), and reading the first of
    -- them reported "1" however many thousands had been rolled (Codex, 17 Sep
    -- 2026).
    select (select count(*)::int from unrolled) as rolled,
           (select count(*)::int from folded) as groups`, [cutoff]);
  let dropped = 0;
  let keptBack = null;
  if (drop) {
    // Never delete a row a report could still ask for.
    //
    // A rolled month is one number and cannot be cut, so a window whose edge
    // falls inside it reads the live rows instead (totals, bySubject). Deleting
    // them takes that away for good: after August is rolled *and dropped*, a
    // thirty-day report made on the 18th of September can never again include
    // the 19th to the 31st of August (Codex, 18 Sep 2026). The log cannot be
    // backfilled, so this is the one mistake here that cannot be undone.
    //
    // The floor is the longest window the boards offer, rounded up to whole
    // months and with a month's grace: ninety days (Demand's WINDOWS) becomes
    // four months. Rolling still happens up to the caller's date; only the
    // deleting waits.
    const floor = new Date(Date.UTC(
      new Date().getUTCFullYear(), new Date().getUTCMonth() - KEEP_MONTHS, 1, 0, 0, 0, 0));
    const safe = cutoff < floor ? cutoff : floor;
    if (safe < cutoff) keptBack = safe.toISOString().slice(0, 10);
    // And never a search that can still be converted.
    //
    // A shortlisted place reaches an itinerary on a later visit, and the item
    // remembers which search found it (migration 177). Dropping that search
    // throws the conversion away before it happens: the event arrives, finds no
    // row, and the one outcome the board is built around is lost outright
    // (Codex, 18 Sep 2026). A rolled search that is still here can have its
    // bucket corrected; a dropped one cannot.
    // Kept only while it can still become something.
    //
    // A shortlisted place reaches an itinerary on a later visit, and the item
    // remembers which search found it (migration 177) — dropping that search
    // throws the conversion away before it happens. But a search that has
    // already tripped cannot advance any further and its conversion is in the
    // bucket, so keeping it kept the log growing for exactly the searches that
    // went well (Codex, 18 Sep 2026).
    const { rowCount } = await query(
      `delete from searches s
        where s.at < $1
          and (s.outcome = 'tripped'
               or not exists (select 1 from trip_shortlist t where t.search_id = s.id))`, [safe]);
    dropped = rowCount;
  }
  // `keptBack` is not a failure: it is the answer saying the deletion stopped
  // short of what was asked, and where, so nobody has to work out why the row
  // count did not fall as far as they expected.
  return { rolled: counted?.rolled ?? 0, groups: counted?.groups ?? 0, dropped, keptBack };
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
export async function whereOf(args = {}) {
  // Fails open, like `noteSearch` does, because it is part of the same thing:
  // working out where a search was, so the log can be read by area. Six callers
  // spread it into the row they are about to write, and none of them was
  // guarded — so a hiccup working out an area turned a search that had already
  // found forty places into a 500 and threw the answer away (Codex, 18 Sep
  // 2026). The log is worth having and never worth a household's search.
  try { return await whereOfOrThrow(args); } catch { return { areaSlug: null, cell: null }; }
}

async function whereOfOrThrow({ lat = null, lng = null, areaSlug = null } = {}) {
  if (areaSlug) {
    const { rows: [l] } = await query('select slug, parent_slug, kind from localities where slug = $1', [String(areaSlug).toLowerCase()]);
    if (l) return { areaSlug: l.kind === 'town' && l.parent_slug ? l.parent_slug : l.slug, cell: null };
  }
  if (lat == null || lng == null) return { areaSlug: null, cell: null };
  // Nearest, *and near*.
  //
  // Unbounded, this filed a search in continental Europe under whichever UK
  // cell happened to be closest — and then under that cell's county, which is
  // a demand report nobody could act on and nobody could spot (Codex, 17 Sep
  // 2026). A cell is about 5 km across, so a degree either way is generous and
  // still says "not here" for anywhere we do not cover.
  const NEAR_DEGREES = 1;
  // And near in kilometres, not in degrees.
  //
  // A degree of longitude is 111 km at the equator and 70 in Britain, so the box
  // alone put Calais inside Kent's — the nearest cell was thirty-odd kilometres
  // away across the Channel and the search was filed under a county nobody in
  // it had searched (Codex, 18 Sep 2026). The box is the index-friendly first
  // cut; this is the answer. Twenty-five kilometres is wider than a cell and
  // narrower than a sea.
  const NEAR_KM = 25;
  const { rows: [cell] } = await query(
    `select code, outcode from geo_cells
      where lat between $1::double precision - $3::double precision and $1::double precision + $3::double precision
        and lng between $2::double precision - $3::double precision and $2::double precision + $3::double precision
        and 111.32 * sqrt(
              (lat - $1::double precision) * (lat - $1::double precision)
              + ((lng - $2::double precision) * cos(radians($1::double precision)))
                * ((lng - $2::double precision) * cos(radians($1::double precision)))
            ) <= $4::double precision
      order by (lat - $1::double precision) * (lat - $1::double precision)
             + ((lng - $2::double precision) * cos(radians($1::double precision)))
               * ((lng - $2::double precision) * cos(radians($1::double precision)))
      limit 1`, [lat, lng, NEAR_DEGREES, NEAR_KM]);
  // Outside the coverage: the search is written down with where it was and no
  // area at all, which is the truth and is itself a finding.
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
    // Every one of them, in chunks.
    //
    // The callers used to cut the list at sixty, but the replay is built out of
    // these rows alone — so a browse of two hundred and fifty places replayed as
    // sixty, and anything the household did with the other hundred and ninety
    // had nothing to hang off (Codex, 17 Sep 2026). Chunked because a single
    // statement of a few hundred tuples is what the parameter limit is for.
    for (let at = 0; at < items.length; at += 200) {
      const chunk = items.slice(at, at + 200);
      const values = chunk.map((_, i) => `($1, 'shown', $${i * 3 + 2}, $${i * 3 + 3}, $${i * 3 + 4}::jsonb)`).join(',');
      await query(
        `insert into search_events (search_id, kind, venue_ref, position, meta) values ${values}`,
        [searchId, ...chunk.flatMap((it, i) => [it.ref ?? null, it.position ?? at + i + 1, JSON.stringify({ score: it.score ?? null, source: it.source ?? null })])]);
    }
  } catch { /* the log is not worth a failed search */ }
}

/**
 * What the screen actually drew, which is not what the answer contained.
 *
 * Inspire hands back a pool and the screen then drops the other mode, applies
 * the travel, rating, price and category filters, and draws twelve a shelf
 * until somebody opens "All". So the answer's own count said forty where the
 * household saw nine — and where every one of them was filtered out it said
 * forty where they saw nothing at all, which is the difference between "came
 * back empty" and "clicked nothing": two faults with two different owners
 * (Codex, 18 Sep 2026).
 *
 * The `shown` events are left alone on purpose. They are what the replay hangs
 * off, and a card one tap away is a card the household could reach.
 */
export async function noteDrawn({ searchId, householdId = null, refs = [] } = {}) {
  if (!searchId) return false;
  try {
    const kept = [...new Set(refs.filter(Boolean))];
    // Whose search it is, and whether it is still the one in front of them.
    //
    // Half an hour is longer than anybody looks at one answer and short enough
    // that a stale id cannot rewrite last week (Codex, 18 Sep 2026).
    const { rows: [mine] } = await query(
      `select 1 from searches
        where id = $1::uuid and ($2::uuid is null or household_id = $2)
          and at > now() - interval '30 minutes'`, [searchId, householdId]);
    if (!mine) return false;

    // A row for anything on screen the log has none for.
    //
    // The pool the answer wrote down can be short of what the screen drew — a
    // surface that adds its own rows, or one whose answer was cut — and without
    // a row there is nothing to mark, so the place would be forgotten the moment
    // the next list arrived (Codex, 18 Sep 2026).
    if (kept.length) {
      await query(
        `insert into search_events (search_id, kind, venue_ref, position, meta)
         select $1::uuid, 'shown', d.ref, d.at, '{"drawn": true}'::jsonb
           from (select ref, ordinality::int as at from unnest($2::text[]) with ordinality as t(ref, ordinality)) d
          where not exists (
            select 1 from search_events e
             where e.search_id = $1::uuid and e.kind = 'shown' and e.venue_ref = d.ref)`,
        [searchId, kept]);
    }

    // Drawn once is drawn.
    //
    // A filter change reports a new list, and marking everything outside it as
    // not drawn took away rows the household had already seen — and where they
    // had opened one, the replay reported an open with no row to hang it on
    // (Codex, 18 Sep 2026). The position is the screen's, not the answer's: the
    // list arrives in the order it was displayed in.
    await query(
      `update search_events e
          set meta = jsonb_set(coalesce(e.meta, '{}'::jsonb), '{drawn}', 'true'::jsonb),
              -- Where the screen put it the *first* time it drew it.
              --
              -- The row already carries a position from noteShown — the pool's
              -- order, which is the answer's rather than the screen's — so the
              -- screen's order has to overwrite it once. After that it stands:
              -- a filter or a sort reports a different list, and rewriting every
              -- position to the latest one replayed a card the household found
              -- at number ten as though it had been at the top all along, on a
              -- board that orders by this field and calls it what was shown
              -- first (Codex, 18 Sep 2026). The second list is a different list,
              -- not a correction of the first.
              position = case when coalesce(e.meta->>'drawn', '') = 'true' then e.position else d.at end
         from (select ref, ordinality::int as at from unnest($2::text[]) with ordinality as t(ref, ordinality)) d
        where e.search_id = $1::uuid and e.kind = 'shown' and e.venue_ref = d.ref`, [searchId, kept]);
    await query(
      `update search_events
          set meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{drawn}', 'false'::jsonb)
        where search_id = $1::uuid and kind = 'shown'
          and not (venue_ref = any($2))
          and coalesce(meta->>'drawn', 'false') <> 'true'`, [searchId, kept]);

    // And the summary counts what the replay holds, so the two cannot disagree:
    // everything drawn on this search, not only the latest list (Codex, 18 Sep
    // 2026). A ref the log never held a `shown` row for — the pool was cut, or
    // the surface reports more than it recorded — still counts, because they
    // saw it.
    const { rows: [seen] } = await query(
      `select coalesce(array_agg(venue_ref), '{}') as refs from search_events
        where search_id = $1::uuid and kind = 'shown' and meta->>'drawn' = 'true'`, [searchId]);
    const drawn = [...new Set([...(seen?.refs ?? []), ...kept])];

    // By shelf, the same shape `logSearch` writes, and read off the index so the
    // two agree about what a place is filed under.
    const { rows: byShelf } = drawn.length
      ? await query(
        `select coalesce(subcategory, 'unshelved') as subcategory, count(*)::int as n
           from place_index where venue_ref = any($1) group by 1`, [drawn])
      : { rows: [] };
    // A place the index has never heard of is unshelved too, and it goes in the
    // same entry as the ones it has: two rows with one name is a shape nothing
    // downstream expects.
    const short = drawn.length - byShelf.reduce((n, r) => n + r.n, 0);
    if (short > 0) {
      const had = byShelf.find((r) => r.subcategory === 'unshelved');
      if (had) had.n += short; else byShelf.push({ subcategory: 'unshelved', n: short });
    }

    const { rowCount } = await query(
      `update searches
          set shown_total = $2, shown = $3::jsonb,
              -- Never empty once they have done something with it: they cannot
              -- have opened a place on a screen with nothing on it, so a filter
              -- that empties the list afterwards is not a coverage hole.
              empty = ($2 = 0 and outcome = 'none')
        where id = $1::uuid`,
      [searchId, drawn.length, JSON.stringify(byShelf.map((r) => ({ subcategory: r.subcategory, n: r.n })))]);
    return rowCount > 0;
  } catch { return false; }
}

