/**
 * The name-check: a live Google name against the owned match it should agree with.
 *
 * Owner, 1 Oct 2026: "when a live Google name is fetched, compare it in memory
 * with the owned name; a material difference marks the owned match as suspect
 * (re-match, don't trust its coordinates), storing only the flag, never
 * Google's name. Report the counts in the Monday summary."
 *
 * Names arrive in memory (sources/liveNames.js) the moment a Places answer is
 * read, and a drain once a minute takes a batch of them:
 *
 *  · a place with an owned point is judged against the name its owned source
 *    holds itself — FSA, Historic England, OS Open Names or the open map —
 *    with the matcher's own measure (openMatch.js nameScore). Three answers,
 *    and the third is a real one (CLAUDE.md, the can't-speak rule):
 *      agrees      — as alike as the matcher demands of a match: stamped `checked_at`;
 *      doubtful    — clearly different: the match is set aside (it leaves
 *                    owned_points, so nothing trusts its coordinates any more,
 *                    and is written down in owned_point_suspects), and the
 *                    place is re-matched on the live name, in memory;
 *      can't speak — in between, or a name too generic to judge: nothing is
 *                    written, and the match stands.
 *  · a place with no owned point yet is matched on the live name at first
 *    sight. The stored labels the weekly re-match has read names from are
 *    being cleared (owner, 1 Oct 2026), so this is how a place keeps getting
 *    an owned point once they are gone.
 *
 * Nothing here writes Google's name anywhere: not the reason, not a log line.
 * A Wikidata match is by identifier, not by name, and its source holds no
 * name here to judge it against, so it is not checked.
 */

import { query, pool } from '../db.js';
import { nameScore, significantStems } from './openMatch.js';
import { matchPlace, boxOf, ownedNameGaps } from './ownedMatch.js';
import { recordOwnedPoint, OWNED_POINT_NAME, lockPlace } from './ownedPoints.js';
import { takeLiveNames, noteLiveName } from './liveNames.js';

/** As alike as the matcher demands of a match (ownedMatch.js RULES). */
export const AGREE_AT = 0.85;
/** Below this the two are not the same place's name. */
export const DOUBT_BELOW = 0.5;
/** The owned sources whose own name can be read, and so judged. */
const NAMED_SOURCES = ['fsa', 'historic-england', 'os-open-names', 'osm'];

/** How a live name stands against an owned one: 'agrees', 'doubtful' or 'cant-speak'. */
export function judge(live, owned) {
  if (!live || !owned) return { verdict: 'cant-speak', why: 'no name on one side' };
  // A name with nothing distinctive in it — "The Crown", "Cafe" — cannot tell
  // one place from another either way.
  if (!significantStems(live).length || !significantStems(owned).length) return { verdict: 'cant-speak', why: 'a name too plain to judge' };
  const score = nameScore(live, owned);
  if (score >= AGREE_AT) return { verdict: 'agrees', score };
  // Clearly different means unalike *and* sharing no distinctive word: "Kelpie
  // Fish Grill" against "Kelpie Seafood Shack" scores low but is as likely a
  // renamed menu as another business, and setting a true match aside costs the
  // place its point. That one is not ours to call.
  const shared = significantStems(live).some((x) => significantStems(owned).includes(x));
  if (score < DOUBT_BELOW && !shared) return { verdict: 'doubtful', score };
  return { verdict: 'cant-speak', score, why: shared ? 'they share a distinctive word' : 'neither clearly the same nor clearly different' };
}

// A place checked in the last day is not checked again for every search it
// turns up in. In memory and bounded; a restart only means one more check.
const DAY_MS = 86_400_000;
const recently = new Map(); // ref -> checked at
const seenRecently = (ref, now) => {
  const at = recently.get(ref);
  return at != null && now - at < DAY_MS;
};
const remember = (ref, now) => {
  if (recently.size >= 50_000) recently.delete(recently.keys().next().value);
  recently.set(ref, now);
};

/** The owned points held for `refs`, with the name each one's source holds. */
async function ownedFor(refs) {
  const { rows } = await query(
    `select o.venue_ref, o.source, coalesce(o.source_ref, '') as source_ref, ${OWNED_POINT_NAME('o')} as owned_name
       from owned_points o where o.venue_ref = any($1)`, [refs]);
  return new Map(rows.map((r) => [r.venue_ref, r]));
}

/** Where to look for a place's owned twin: the point that came with the name, else the index's, else its census box. */
async function whereIs(ref, noted) {
  const { rows: [pi] } = await query('select lat, lng, slice from place_index where venue_ref = $1', [ref]);
  const point = noted?.lat != null && noted?.lng != null ? { lat: noted.lat, lng: noted.lng }
    : pi?.lat != null && pi?.lng != null ? { lat: pi.lat, lng: pi.lng } : null;
  return { point, box: boxOf(pi?.slice) };
}

/**
 * Match a place on its live name, in memory; write the owned point if one is
 * clearly it. `awaiting` is the suspicion of a place whose match was set aside
 * and still waits for its re-match, or null for a place that never had one
 * (a first sight). The point, the suspicion's answer and the week's count are
 * one transaction: none of them can land without the others (Codex, 2 Oct 2026).
 */
async function matchOnLiveName(ref, liveName, noted, awaiting = null) {
  const { point, box } = await whereIs(ref, noted);
  const out = await matchPlace({ ref, names: [liveName], point, box, rented: true });
  if (out.none) return { matched: false, why: out.none };
  const kind = awaiting ? 'rematch' : 'first sight';
  const sourceRef = String(out.sourceRef ?? '');
  const c = await pool.connect();
  try {
    await c.query('begin');
    const w = await recordOwnedPoint({ ref, ...out, method: `${kind}: ${out.method}` }, c);
    if (w.written && awaiting) {
      await c.query(
        `update owned_point_suspects set rematched_source = $4, rematched_ref = $5
          where venue_ref = $1 and source = $2 and source_ref = $3`,
        [awaiting.venue_ref, awaiting.source, awaiting.source_ref, out.source, sourceRef]);
      await c.query(`insert into name_checks (venue_ref, outcome, source) values ($1, 'rematched', $2)`, [ref, out.source]);
    } else if (w.written) {
      await c.query(`insert into name_checks (venue_ref, outcome, source) values ($1, 'first-sight', $2)`, [ref, out.source]);
    }
    await c.query('commit');
    return w.written ? { matched: true, source: out.source, sourceRef } : { matched: false, why: w.why };
  } catch (err) {
    await c.query('rollback').catch(() => null);
    throw err;
  } finally { c.release(); }
}

/** An agreement, stamped on the row that was judged and counted, together. */
async function agree(row) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const { rowCount } = await c.query(
      `update owned_points set checked_at = now() where venue_ref = $1 and source = $2 and coalesce(source_ref, '') = $3`,
      [row.venue_ref, row.source, row.source_ref]);
    if (rowCount) await c.query(`insert into name_checks (venue_ref, outcome, source) values ($1, 'agreed', $2)`, [row.venue_ref, row.source]);
    await c.query('commit');
    return rowCount > 0;
  } catch (err) {
    await c.query('rollback').catch(() => null);
    throw err;
  } finally { c.release(); }
}

/**
 * Set a doubtful match aside: it leaves owned_points (so every reader stops
 * trusting its point), the index forgets the point it gave, and every copy of
 * the place goes back through the trigger — a saved or visited copy to its
 * census box, a stored one to no point. One transaction.
 */
export async function setAside(row, score) {
  const reason = `a live name scored ${score.toFixed(2)} against ${row.source} ${row.source_ref || '(no id)'}'s own name`;
  const c = await pool.connect();
  try {
    await c.query('begin');
    // The same lock recordOwnedPoint takes: nothing can write this match back
    // between the suspicion and the deletion (Codex, 2 Oct 2026).
    await lockPlace(c, row.venue_ref);
    // The point as it stands now, under the lock. A match that has changed
    // since it was judged is not this one: leave it for the next check.
    const { rows: [held] } = await c.query(
      `select lat, lng from owned_points where venue_ref = $1 and source = $2 and coalesce(source_ref, '') = $3`,
      [row.venue_ref, row.source, row.source_ref]);
    if (!held) { await c.query('rollback'); return { setAside: false, why: 'the match changed before it could be set aside' }; }
    await c.query(
      `insert into owned_point_suspects (venue_ref, source, source_ref, score, reason) values ($1, $2, $3, $4, $5)
       on conflict (venue_ref, source, source_ref) do update set checked_at = now(), score = excluded.score, reason = excluded.reason`,
      [row.venue_ref, row.source, row.source_ref, score, reason]);
    await c.query(`delete from owned_points where venue_ref = $1 and source = $2 and coalesce(source_ref, '') = $3`,
      [row.venue_ref, row.source, row.source_ref]);
    // Counted with the change it describes, so the one cannot happen without the other.
    await c.query(`insert into name_checks (venue_ref, outcome, source) values ($1, 'doubted', $2)`, [row.venue_ref, row.source]);
    await c.query(
      `update place_index set lat = null, lng = null, coords_from = null, coords_at = null, cell = null, placed_at = null
        where venue_ref = $1 and coords_from = $2`, [row.venue_ref, row.source]);
    // Every copy still holding the doubted point loses it, coordinates and
    // all: clearing only `point_from` let a copy whose own source the trigger
    // derives independently (a researched record's open-map provenance, an
    // atlas row) keep the very point being doubted under another name (Codex,
    // 2 Oct 2026). A saved or visited copy then falls back to its census box;
    // a stored one holds no point until a better match lands.
    for (const table of ['household_places', 'trip_shortlist', 'trip_stops', 'visits', 'scout_places', 'place_records']) {
      await c.query(`update ${table} set lat = null, lng = null, point_from = null where venue_ref = $1 and lat = $2 and lng = $3`,
        [row.venue_ref, held.lat, held.lng]);
    }
    await c.query(
      `update attractions set lat = null, lng = null, point_from = null
        where (venue_ref = $1 or external_ref = $1
               or id = (case when $1 like 'atlas:%' then epic_try_uuid(substr($1, 7)) end))
          and lat = $2 and lng = $3`, [row.venue_ref, held.lat, held.lng]);
    await c.query('commit');
    return { setAside: true };
  } catch (err) {
    await c.query('rollback').catch(() => null);
    throw err;
  } finally { c.release(); }
}

let draining = false;

/**
 * One pass: take a batch of noted names, judge each, act on the verdict.
 * Returns the counts; never throws for one place (a failed place is counted
 * and the pass goes on).
 */
export async function drain({ n = 100, now = Date.now() } = {}) {
  if (draining) return { busy: true };
  draining = true;
  const out = { looked: 0, agreed: 0, doubted: 0, rematched: 0, cantSpeak: 0, firstSight: 0, failed: 0 };
  try {
    const batch = takeLiveNames(n).filter((x) => !seenRecently(x.ref, now));
    if (!batch.length) return out;
    let owned;
    try {
      owned = await ownedFor(batch.map((x) => x.ref));
    } catch (err) {
      // The batch goes back on the queue for the next minute rather than
      // being lost to one failed read (Codex, 2 Oct 2026).
      for (const x of batch) if ((x.tries ?? 0) < 2) noteLiveName(x.ref, x.name, x, { tries: (x.tries ?? 0) + 1 });
      throw err;
    }
    // Ninety days of outcomes is plenty for a weekly figure.
    await query(`delete from name_checks where at < now() - interval '90 days'`).catch(() => null);
    for (const x of batch) {
      out.looked += 1;
      // Marked as seen before the work, so a second sighting in this same
      // batch is not judged twice, and un-marked if the work fails, so a
      // transient fault does not hide the place for a day (Codex, 2 Oct 2026).
      remember(x.ref, now);
      try {
        const row = owned.get(x.ref);
        if (!row) {
          // A place whose match was set aside and still waits for its re-match
          // — the re-match failed, or found nothing then — is a re-match, not
          // a first sight (Codex, 2 Oct 2026).
          const { rows: [awaiting] } = await query(
            `select venue_ref, source, source_ref from owned_point_suspects
              where venue_ref = $1 and rematched_source is null order by created_at desc limit 1`, [x.ref]);
          const m = await matchOnLiveName(x.ref, x.name, x, awaiting ?? null);
          if (m.matched && awaiting) out.rematched += 1;
          else if (m.matched) out.firstSight += 1;
          continue;
        }
        if (!NAMED_SOURCES.includes(row.source)) { out.cantSpeak += 1; continue; }
        const v = judge(x.name, row.owned_name);
        if (v.verdict === 'agrees') {
          // Only the row that was judged: one the matcher put in its place since
          // was not compared with anything (Codex, 2 Oct 2026).
          if (!(await agree(row))) { out.cantSpeak += 1; continue; }
          out.agreed += 1;
        } else if (v.verdict === 'doubtful') {
          const a = await setAside(row, v.score);
          if (!a.setAside) { out.cantSpeak += 1; continue; }
          out.doubted += 1;
          const m = await matchOnLiveName(x.ref, x.name, x, row);
          if (m.matched) out.rematched += 1;
        } else {
          out.cantSpeak += 1;
        }
      } catch (err) {
        out.failed += 1;
        recently.delete(x.ref);
        // Back on the queue for the next minute, three tries in all: a
        // transient fault is retried, a lasting one is not retried for ever
        // (Codex, 2 Oct 2026).
        if ((x.tries ?? 0) < 2) noteLiveName(x.ref, x.name, x, { tries: (x.tries ?? 0) + 1 });
        // The reference and the fault only — never the name.
        console.error(`epic-api: name-check — ${x.ref}: ${String(err?.message ?? err).slice(0, 160)}`);
      }
    }
    return out;
  } finally {
    draining = false;
  }
}

/**
 * The week's figures for the Monday summary (ukCensus.weeklySummary): how many
 * saved places, stops, shortlist rows and visits still have no owned name,
 * and what the name-check did in the last seven days.
 */
export async function weekly(now = new Date()) {
  const since = new Date(now.getTime() - 7 * DAY_MS);
  const gaps = await ownedNameGaps();
  // Places, not sightings: a place that agreed every day this week is one
  // place that agreed. Counted from what happened (name_checks), so a match
  // later replaced or set aside still counts for the week it was checked.
  const { rows: [r] } = await query(
    `select count(distinct venue_ref) filter (where outcome = 'agreed')::int as agreed,
            count(distinct venue_ref) filter (where outcome = 'doubted')::int as doubted,
            count(distinct venue_ref) filter (where outcome = 'rematched')::int as rematched,
            count(distinct venue_ref) filter (where outcome = 'first-sight')::int as first_sight
       from name_checks where at >= $1`, [since]);
  return { gaps, ...r };
}

/** For tests: forget which places were checked today. */
export function forgetChecks() { recently.clear(); }
