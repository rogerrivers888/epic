/**
 * The owned layer: what Epic has researched for itself about a place, and may
 * keep for good.
 *
 * This is the other half of the rented/owned split (Technical Constraints
 * §13.10). A household act claims a place; the researcher then goes to
 * OpenStreetMap, the venue's own published page and the open encyclopedias, and
 * what it finds lands in `place_facts` and is composed into `place_records`.
 *
 * Two things about these statements are the licence rather than the schema:
 *
 *  - **`place_facts` carries its own terms.** Every row records the licence it
 *    came under and when it expires, so `discardExpiredFacts` can keep the
 *    promise the moment a source with a clock is enabled.
 *  - **A source that answers replaces everything it said before.** A match that
 *    turns out to be wrong has to be able to go away, which it cannot if a
 *    re-check only overwrites the fields it happens to find this time. Silence
 *    is not a correction, so this is only ever called once a source has
 *    actually answered.
 */

import { query } from '../db.js';
import { noteMany } from './placeIndex.js';
import { ownedRecordSql, holdsAnOwnedFact } from '../domain/placeIndex.js';

// ---------------------------------------------------------------------------
// facts, with their terms
// ---------------------------------------------------------------------------

export async function putFact(venueRef, f) {
  await query(
    `insert into place_facts (venue_ref, field, source, value, licence, retention, confidence, fetched_at, expires_at)
     values ($1,$2,$3,$4,$5,$6,$7, now(), $8)
     on conflict (venue_ref, field, source) do update set
       value = excluded.value, licence = excluded.licence, retention = excluded.retention,
       confidence = excluded.confidence, fetched_at = now(), expires_at = excluded.expires_at`,
    [venueRef, f.field, f.source, JSON.stringify(f.value), f.licence, f.retention, f.confidence ?? null, f.expiresAt],
  );
}

export function forgetSourceFacts(venueRef, sources) {
  return query('delete from place_facts where venue_ref = $1 and source = any($2)', [venueRef, sources]);
}

export async function liveFacts(venueRef, { keepableOnly = false } = {}) {
  const { rows } = await query(
    // `expires_at is null` is "ours for good"; a licensed fact that has not yet
    // expired is also ours *now*, and one that has expired is nobody's. Reading
    // only the first left a live licensed fact out and, worse, let an expired
    // one through anywhere the predicate was looser (Codex, 18 Sep 2026).
    //
    // `keepableOnly` is for the one caller that is building something we cannot
    // take back. `place_records` is the offline record and goes out to devices,
    // so a fact with an expiry must never reach it — the expiry sweep can empty
    // a table on our own server and cannot reach a phone in somebody's pocket.
    // Widening this predicate for display quietly widened it for that too
    // (Codex, 19 Sep 2026). Rented is rented: CLAUDE.md, and `compose` said so
    // in its own docstring all along.
    `select field, source, value, confidence from place_facts
      where venue_ref = $1
        and ${keepableOnly ? 'expires_at is null' : '(expires_at is null or expires_at > now())'}`,
    [venueRef],
  );
  return rows;
}

/** Throw away every fact whose licence says its time is up. */
export async function discardExpiredFacts() {
  const { rows } = await query('delete from place_facts where expires_at is not null and expires_at <= now() returning venue_ref');
  return rows.map((r) => r.venue_ref);
}

// ---------------------------------------------------------------------------
// the composed record
// ---------------------------------------------------------------------------

export async function ensureRecord(venueRef) {
  // `scored` is a row that exists only to hold an arithmetic result — the score
  // tab writes one for a harvested place so a recalculation can be read back,
  // and deliberately keeps it out of the research queue (repositories/scout.js).
  // A household touching the place *is* a reason to research it, so that is the
  // moment it joins the queue (Codex, 18 Sep 2026).
  await query(
    `insert into place_records (venue_ref) values ($1)
     on conflict (venue_ref) do update
        set enrich_state = case when place_records.enrich_state = 'scored' then 'pending'
                                else place_records.enrich_state end`,
    [venueRef]);
  // The row, not the claim.
  //
  // `ensureRecord` runs *before* the research does, so calling the place owned
  // here marked an empty record — and a failed one — as a place we hold our own
  // facts about. Collect then skipped it as not worth a paid call and left the
  // free window closed on it for a year, while coverage said the county was in
  // better shape than it was (Codex, 17 Sep 2026). Ownership is claimed by
  // `own()` when a fact actually lands.
  //
  // And no source row either: `place_index_sources.last_seen` for `own` is what
  // the twelve-month staleness window reads, so stamping it before the research
  // ran — or after one that found nothing — shut the free pass out of that
  // place for a year, which is the exact case this is meant to fix (Codex,
  // 17 Sep 2026).
  await noteMany([{ ref: venueRef }]);
}

/**
 * Now we hold something of our own about it.
 *
 * Called from the research itself, once a fact has been written. This is the
 * only place the index is told a place is owned outside a full rebuild, and the
 * rebuild asks the same question of the same columns.
 */
export async function noteOwned(venueRef) {
  await noteMany([{ ref: venueRef, ownership: 'owned' }], { source: 'own' });
}

/**
 * What this place's ownership *is*, after whatever just happened to it.
 *
 * `noteOwned` only ever moves upward, which is right for research arriving and
 * wrong for a fact being cleared: an administrator emptying a place's only
 * owned field left it marked owned for good, so coverage overstated the county
 * and Collect skipped a place that needed it (Codex, 17 Sep 2026). This asks
 * the question from scratch — the same three columns the index and the rebuild
 * ask — and is the only thing that can take an ownership down again.
 */
export async function settleOwnership(venueRef) {
  // Does the *record* hold a fact of ours? That is the question the `own`
  // source row answers, and it is not the same as "is this place owned": an
  // attraction with a summary of its own makes the place owned without our
  // having researched anything, and a fabricated `own` row there both
  // overstated the sources lens and started the twelve-month free-collection
  // window (Codex, 17 Sep 2026).
  const { rows: [rec] } = await query(
    `select ${ownedRecordSql('r')} as ours from place_records r where r.venue_ref = $1`, [venueRef]);
  const oursToo = Boolean(rec?.ours);

  // Both claim paths, as the rebuild reads them. A shortlist suggestion, a trip
  // base, a stay and a visit are only ever in `place_claims`, so reading
  // `household_places` alone dropped them back to identified the moment an
  // administrator cleared the last owned field — and the collection lane then
  // treated a place somebody had claimed as one nobody had (Codex, 18 Sep 2026).
  const { rows } = await query(
    `update place_index pi set ownership = case
         when $2 then 'owned'
         when exists (
           select 1 from attractions a
            where (a.venue_ref = pi.venue_ref or 'atlas:' || a.id::text = pi.venue_ref)
              and a.state <> 'hidden'
              and coalesce(a.summary, a.website, a.wikipedia_url) is not null)
           then 'owned'
         when exists (select 1 from household_places hp where hp.venue_ref = pi.venue_ref)
              or exists (select 1 from place_claims pc where pc.venue_ref = pi.venue_ref)
           then 'claimed'
         else 'identified' end
      where pi.venue_ref = $1
      returning ownership`, [venueRef, oursToo]);

  // The source row follows the *record*, not the ownership: its timestamp is
  // what the free-collection window reads, and the rebuild only writes one for
  // a record that holds something.
  if (oursToo) await noteMany([{ ref: venueRef, ownership: 'owned' }], { source: 'own' });
  else await query(`delete from place_index_sources where venue_ref = $1 and source = 'own'`, [venueRef]);
  return rows[0]?.ownership ?? null;
}

export async function recordFor(venueRef) {
  const { rows } = await query('select * from place_records where venue_ref = $1', [venueRef]);
  return rows[0] ?? null;
}

export async function recordsFor(refs) {
  const { rows } = await query('select * from place_records where venue_ref = any($1)', [refs]);
  return rows;
}

export async function enrichStateOf(venueRef) {
  const { rows } = await query(
    'select enrich_state, enriched_at, provenance, research_version, matched from place_records where venue_ref = $1',
    [venueRef],
  );
  return rows[0] ?? null;
}

export async function knownCategory(venueRef) {
  const { rows } = await query('select category, website, address from place_records where venue_ref = $1', [venueRef]);
  return rows[0] ?? {};
}

/**
 * Write the composed record.
 *
 * The columns are assembled from the caller's precedence table rather than
 * written out, because which fields exist is that table's business and one list
 * is easier to keep right than two.
 */
export async function writeRecord(venueRef, columns, values, attribution, provenance) {
  const sets = columns.map((c, i) => `${c} = $${i + 2}`).join(', ');
  // Whether the classification moved, decided in the statement that moves it.
  //
  // Only over the columns this pass actually wrote: one it did not write cannot
  // have changed. `is distinct from` rather than `<>`, because null is one of
  // the values that matters here — a kind being *withdrawn* has to travel as
  // surely as one arriving.
  const changed = ['category', 'experiences']
    .map((name) => [name, columns.indexOf(name)])
    .filter(([, at]) => at >= 0)
    .map(([name, at]) => `w.${name} is distinct from $${at + 2}${name === 'experiences' ? '::jsonb' : ''}`);
  const { rows } = await query(
    // Three things in one statement, on one snapshot.
    //
    // `returning` can only see the new row, and the question is whether the
    // classification *changed* — so the previous values come from a CTE. And the
    // re-shelving has to be in here too: as two statements, a process that died
    // between them left the record saying one thing and the index shelved by
    // another, and the retry would compare the new value against itself, find
    // nothing moved, and leave the place on its old shelf until somebody ran a
    // full rebuild (Codex, 19 Sep 2026).
    `with was as (
       select venue_ref, category, experiences from place_records where venue_ref = $1),
     upd as (
       update place_records set ${sets},
         attribution = $${columns.length + 2}, provenance = $${columns.length + 3}, updated_at = now()
       from was w
       where place_records.venue_ref = w.venue_ref
       returning ${ownedRecordSql('place_records')} as holds_something)
     ${changed.length ? `, reshelve as (
       update place_index pi set placed_at = null
         from was w
        where pi.venue_ref = w.venue_ref and (${changed.join(' or ')})
       returning 1)` : ''}
     select holds_something from upd`,
    [venueRef, ...values, JSON.stringify(attribution), JSON.stringify(provenance)],
  );
  // This is the moment a place becomes ours: a fact of our own has landed on
  // it. Before this, the record is an empty row `ensureRecord` made so the
  // research had somewhere to write (Codex, 17 Sep 2026).
  if (rows[0]?.holds_something) await noteOwned(venueRef);
}

export async function recordAttempt(venueRef, a) {
  const { rows } = await query(
    `update place_records set
       enrich_state = $2, enriched_at = now(), enrich_attempts = enrich_attempts + 1,
       enrich_error = $3, matched = $4, research_version = $5, updated_at = now()
     where venue_ref = $1 returning enrich_attempts`,
    [venueRef, a.state, a.error ?? null, JSON.stringify(a.matched), a.researchVersion],
  );
  return rows[0]?.enrich_attempts ?? 1;
}

export async function scheduleRetry(venueRef, at) {
  await query('update place_records set next_attempt_at = $2 where venue_ref = $1', [venueRef, at]);
}

// ---------------------------------------------------------------------------
// what to describe, and what has been claimed
// ---------------------------------------------------------------------------

/**
 * The rented record read as a description of what to look for in the open
 * world: a name and a point. Nothing from it is stored.
 */
export async function seedFromHousehold(venueRef) {
  const { rows } = await query(
    `select label, category, lat, lng, venue, locality from household_places
      where venue_ref = $1 and lat is not null order by last_seen desc limit 1`,
    [venueRef],
  );
  return rows[0] ?? null;
}

export async function seedFromShortlist(venueRef) {
  const { rows } = await query(
    `select venue_label as label, category, lat, lng, venue from trip_shortlist
      where venue_ref = $1 and lat is not null order by added_at desc limit 1`,
    [venueRef],
  );
  return rows[0] ?? null;
}

/** A household act claiming a place, and the record it starts. */
export async function claim(householdId, venueRef, reason) {
  await query('insert into place_claims (household_id, venue_ref, reason) values ($1,$2,$3) on conflict do nothing', [householdId, venueRef, reason]);
  await ensureRecord(venueRef);
  // And the index hears about it now, not at the next rebuild. A suggested
  // shortlist item and a trip's base come through here and nowhere else, so
  // without this the places somebody actually asked for sat in the index as
  // "identified" and Collect's claimed lane could not see them (Codex, 18 Sep
  // 2026). Never a failed claim on somebody's screen.
  await noteMany([{ ref: venueRef }], { ownership: 'claimed' }).catch(() => null);
}

/** Has any household actually asked for this place, or is it only swept? */
export async function isClaimed(venueRef) {
  const { rows } = await query('select 1 from place_claims where venue_ref = $1 limit 1', [venueRef]);
  return rows.length > 0;
}

/**
 * Places claimed but never researched, or due to be tried again.
 *
 * Three kinds of second chance are in here on purpose: one written off by an
 * earlier build that called a place done the first time it found nothing, one
 * whose backoff has come round, and one made by an older researcher than the
 * one running now.
 */
export async function dueForResearch(limit, maxAttempts, researchVersion) {
  const { rows } = await query(
    `select venue_ref from place_records
      -- A row written only to hold a score is not a research job, whatever
      -- version of the researcher last ran: research_version < $3 was picking
      -- those up regardless of their state and going off to OpenStreetMap,
      -- Nominatim and the encyclopedias from an operation that says "free"
      -- (Codex, 18 Sep 2026).
      where enrich_state <> 'scored'
        and (enrich_state = 'pending'
         or (enrich_state in ('failed', 'partial') and next_attempt_at is not null and next_attempt_at <= now())
         or (enrich_state = 'done' and provenance = '{}'::jsonb and enrich_attempts < $2)
         or research_version < $3)
      order by research_version, enrich_attempts, first_owned limit $1`,
    [limit, maxAttempts, researchVersion],
  );
  return rows.map((r) => r.venue_ref);
}

/**
 * The sweep's places that have never been told apart.
 *
 * A place with no `category` is one the Food strip cannot offer under any word
 * but Restaurants, and the reason is almost always that it was never matched to
 * the open map. Ordered by how prominent the sweep thought it was, so the ones
 * a household would actually see are identified first.
 */
export async function needingKind(limit = 25) {
  // No ceiling on attempts, deliberately. All 764 of these had spent all six,
  // and every one was spent on a question that could not be answered: the loop
  // re-queued them with no seed, so `enrich` had no name and no point to search
  // the open map with and failed on the spot. Attempts made without a seed are
  // not evidence about the place, and this pass brings one.
  //
  // But least-tried first, or the pass never moves. Ranked by prominence alone
  // it handed back the same twenty-five every time — and OpenStreetMap has
  // never heard of some of them, so those twenty-five failed, were asked again,
  // and failed again while seven hundred untried places waited behind them
  // (found 8 Sep 2026: fourteen batches, three hundred and fifty jobs, backlog
  // unchanged). Attempts ascending rotates through the whole list, and anything
  // that keeps failing sinks to the bottom by itself.
  //
  // `distinct on` has to be ordered by its own key first, so the ranking has to
  // happen outside it — ordered inside, the limit took an arbitrary slice in
  // venue_ref order and the batch was whichever places sorted early by id.
  //
  // And not only the sweep's places. The join was an inner one, so a place the
  // sweep never saw could not reach this list however much we held about it —
  // "Royal Chapel of All Saints" in SL4 had its name from our own research, a
  // position, and no kind, and nothing in the system would ever have given it
  // one. Unshelved means invisible on the category board while still counted in
  // the header above it, which is a screen that does not add up (18 Sep 2026,
  // found by opening SL4 on the live site). The seed is the record's own name
  // and point where it has them, the sweep's where it does not, and the index's
  // position as the last resort — every one of them ours to keep.
  const { rows } = await query(
    `select venue_ref, name, lat, lng, website from (
       select distinct on (r.venue_ref)
              r.venue_ref,
              coalesce(r.name, p.name)                   as name,
              coalesce(r.lat, p.lat, pi.lat)             as lat,
              coalesce(r.lng, p.lng, pi.lng)             as lng,
              coalesce(r.website, p.website)             as website,
              p.epic_score, r.enrich_attempts
         from place_records r
         left join scout_places p on p.venue_ref = r.venue_ref
         left join place_index pi on pi.venue_ref = r.venue_ref
        where r.category is null
          and r.osm_ref is null
          and coalesce(r.name, p.name) is not null
          and coalesce(r.lat, p.lat, pi.lat) is not null
          and coalesce(r.lng, p.lng, pi.lng) is not null
        order by r.venue_ref, p.epic_score desc nulls last
     ) best
      order by enrich_attempts asc, epic_score desc nulls last
      limit $1`,
    [limit],
  );
  // The sweep's own row, not the record's: the record is empty — that is the
  // whole reason these are on this list — and the open map cannot be asked
  // about a place with no name and no point.
  return rows.map((r) => ({ ref: r.venue_ref, name: r.name, lat: r.lat, lng: r.lng, website: r.website }));
}

/**
 * What a sweep already knows about these places, for a researcher that would
 * otherwise ask the open map about a nameless point.
 */
export async function sweepSeeds(refs) {
  if (!refs?.length) return {};
  const { rows } = await query(
    `select distinct on (venue_ref) venue_ref, name, lat, lng, website
       from scout_places where venue_ref = any($1)
      order by venue_ref, epic_score desc nulls last`,
    [refs],
  );
  return Object.fromEntries(rows.map((r) => [r.venue_ref, { name: r.name, lat: r.lat, lng: r.lng, website: r.website }]));
}

/**
 * The backlog behind `needingKind`, broken down by what is holding each one up.
 *
 * "Asked 0" with no reason is the empty tab this codebase keeps refusing to
 * ship. A place can be unidentified for three different reasons and only one of
 * them is worth another try, so the back office is told which.
 */
export async function kindBacklog(maxAttempts = 6) {
  const { rows } = await query(
    // The same three seeds `needingKind` uses, and the same left joins — counting
    // only the sweep's places meant the backlog screen said there was nothing to
    // do while places it could not see waited (18 Sep 2026).
    `select count(*)::int as unidentified,
            count(*) filter (where coalesce(r.name, p.name) is null
                                or coalesce(r.lat, p.lat, pi.lat) is null
                                or coalesce(r.lng, p.lng, pi.lng) is null)::int as nothing_to_ask_with,
            count(*) filter (where r.enrich_attempts >= $1)::int as tried_enough,
            count(*) filter (where coalesce(r.name, p.name) is not null
                               and coalesce(r.lat, p.lat, pi.lat) is not null
                               and coalesce(r.lng, p.lng, pi.lng) is not null
                               and r.enrich_attempts < $1)::int as ready
       from place_records r
       left join scout_places p on p.venue_ref = r.venue_ref
       left join place_index pi on pi.venue_ref = r.venue_ref
      where r.category is null and r.osm_ref is null`,
    [maxAttempts],
  );
  return rows[0] ?? { unidentified: 0, nothing_to_ask_with: 0, tried_enough: 0, ready: 0 };
}

/** How much of the household's research is owned, for Settings and the offline card. */
export async function summaryFor(householdId, behindVersion = 3) {
  const { rows } = await query(
    `select count(*)::int as claimed,
            count(*) filter (where r.enrich_state = 'done')::int as researched,
            count(*) filter (where r.osm_ref is not null)::int as in_open_map,
            count(*) filter (where r.summary is not null)::int as described,
            count(*) filter (where r.enrich_state in ('pending', 'partial'))::int as waiting,
            count(*) filter (where r.enrich_state = 'failed')::int as failed,
            count(*) filter (where r.research_version < $2)::int as behind,
            max(r.updated_at) as last_change
       from (select distinct venue_ref from place_claims where household_id = $1) c
       join place_records r on r.venue_ref = c.venue_ref`,
    [householdId, behindVersion],
  );
  return rows[0] ?? null;
}

/**
 * Every place we own within a radius of a point, nearest first.
 *
 * This is what makes Find survive a bad afternoon (owner, 5 Sep 2026: "surely
 * you could just leave the placeholders that I saw there so that they're
 * always available, because the moment it is completely empty"). When
 * OpenStreetMap times out and Google has spent its daily quota, the live sweep
 * comes back with nothing but event listings and the two tiles a family
 * actually opens read zero.
 *
 * Nothing licensed is reached for here. `place_records` is the owned layer by
 * construction — researched from the open map, the venue's own page and the
 * open encyclopedias — so serving it when the rented sources are down breaks
 * no terms and needs no expiry. It is also small: these are only the places
 * this household has already claimed.
 */
export async function ownedNear(householdId, lat, lng, radiusKm, limit = 60) {
  const { rows } = await query(
    `select * from (
       select r.*,
              (select count(*)::int from visits v where v.household_id = $1 and v.venue_ref = r.venue_ref) as visits,
              6371 * acos(least(1, greatest(-1,
                sin(radians($2)) * sin(radians(r.lat)) +
                cos(radians($2)) * cos(radians(r.lat)) * cos(radians(r.lng) - radians($3))))) as km
         from place_records r
         join household_places hp on hp.venue_ref = r.venue_ref and hp.household_id = $1
        where r.lat is not null and r.lng is not null and r.name is not null
     ) near
      where km <= $4
      order by km
      limit $5`,
    [householdId, lat, lng, radiusKm, limit],
  );
  return rows;
}

/**
 * Every owned record around a point, whoever claimed it.
 *
 * `ownedNear` above is one household's: it joins `household_places`, because a
 * household's offline fallback may only hold what that household has claimed.
 * The back office asks a different question — what does Epic itself hold
 * around here — and that is the whole table, which is small and entirely ours
 * (§13.10). Nothing rented is in it by construction.
 */
export async function recordsNear(lat, lng, radiusKm, limit = 500) {
  const { rows } = await query(
    `select * from (
       select r.*,
              6371 * acos(least(1, greatest(-1,
                sin(radians($1)) * sin(radians(r.lat)) +
                cos(radians($1)) * cos(radians(r.lat)) * cos(radians(r.lng) - radians($2))))) as km
         from place_records r
        where r.lat is not null and r.lng is not null and r.name is not null
     ) near
      where km <= $3
      order by km
      limit $4`,
    [lat, lng, radiusKm, limit],
  );
  return rows;
}
