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

export async function liveFacts(venueRef) {
  const { rows } = await query(
    'select field, source, value, confidence from place_facts where venue_ref = $1 and expires_at is null',
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
  await query('insert into place_records (venue_ref) values ($1) on conflict do nothing', [venueRef]);
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
  await query(
    `update place_records set ${sets},
       attribution = $${columns.length + 2}, provenance = $${columns.length + 3}, updated_at = now()
     where venue_ref = $1`,
    [venueRef, ...values, JSON.stringify(attribution), JSON.stringify(provenance)],
  );
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
      where enrich_state = 'pending'
         or (enrich_state in ('failed', 'partial') and next_attempt_at is not null and next_attempt_at <= now())
         or (enrich_state = 'done' and provenance = '{}'::jsonb and enrich_attempts < $2)
         or research_version < $3
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
  const { rows } = await query(
    `select venue_ref, name, lat, lng, website from (
       select distinct on (r.venue_ref)
              r.venue_ref, p.name, p.lat, p.lng, p.website, p.epic_score, r.enrich_attempts
         from place_records r
         join scout_places p on p.venue_ref = r.venue_ref
        where r.category is null
          and r.osm_ref is null
          and p.name is not null and p.lat is not null and p.lng is not null
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
    `select count(*)::int as unidentified,
            count(*) filter (where p.name is null or p.lat is null or p.lng is null)::int as nothing_to_ask_with,
            count(*) filter (where r.enrich_attempts >= $1)::int as tried_enough,
            count(*) filter (where p.name is not null and p.lat is not null and p.lng is not null
                               and r.enrich_attempts < $1)::int as ready
       from place_records r
       join scout_places p on p.venue_ref = r.venue_ref
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
