/**
 * Open status, stored (decision C57, migration 298).
 *
 * One shared predicate for every family read: `SHOWN_REF(refExpr)` for a read
 * keyed by a venue ref, `SHOWN_ATTRACTION(alias)` for the atlas, and
 * `hiddenAmong(refs)` for results that arrive from a provider and are filtered
 * in JavaScript. All three read the same rows through the same condition,
 * `HIDING`, so "hidden" means one thing everywhere.
 *
 * Nothing hides until a person has applied the check (item 4): the condition
 * reads `applied` first. Shipping this changes nothing a family sees.
 */

import { query, withTransaction } from '../db.js';
import { hides } from '../domain/openStatus.js';

const on = (client) => (client ? (text, params) => client.query(text, params) : query);

/** A stored row that keeps its place away from families. Alias `s`. */
export const HIDING = `s.applied and (s.status in ('temporarily_closed', 'permanently_closed') or not s.confirmed)`;

/**
 * Every ref a hidden place goes by (Codex, 29 Sep 2026: a closed atlas row
 * stored as `atlas:<id>` came back from a live search as `google:<id>` and
 * showed). One uncorrelated statement, so Postgres works it out once per
 * query and hashes it; the hidden rows are few, and every join below is an
 * equality, never an OR across the atlas.
 *
 *   1. seed: each hidden row's own ref and `wikidata:<Q>`, plus — the other
 *      way through `provider_matches` — whatever a hidden `google:` ref is
 *      matched to;
 *   2. atlas: every attraction any seed ref names, by `atlas:<id>`, venue ref,
 *      `wikidata:<Q>` or OpenStreetMap ref — so a Google closure matched only
 *      to `wikidata:Q…` still reaches the row's `atlas:<id>` and `osm:` refs
 *      (Codex, second pass);
 *   3. names: the seed and every name those attractions go by;
 *   4. matched: the Google id `provider_matches` holds for any of the names.
 */
export const HIDDEN_REFS = `(
  with hid as (select s.venue_ref, s.wikidata_id from place_status s where ${HIDING}),
  seed as (
    select venue_ref as ref from hid
    union select 'wikidata:' || wikidata_id from hid where wikidata_id is not null
    union select m.venue_ref from provider_matches m join hid on hid.venue_ref = 'google:' || m.source_ref
     where m.source = 'google' and not m.missing),
  atlas as (
    select a.id, a.venue_ref, a.wikidata_id, a.osm_ref from seed join attractions a on seed.ref like 'atlas:%' and a.id::text = substr(seed.ref, 7)
    union select a.id, a.venue_ref, a.wikidata_id, a.osm_ref from seed join attractions a on a.venue_ref = seed.ref
    union select a.id, a.venue_ref, a.wikidata_id, a.osm_ref from seed join attractions a on seed.ref like 'wikidata:%' and a.wikidata_id = substr(seed.ref, 10)
    union select a.id, a.venue_ref, a.wikidata_id, a.osm_ref from seed join attractions a on seed.ref like 'osm:%' and a.osm_ref = substr(seed.ref, 5)
    union select a.id, a.venue_ref, a.wikidata_id, a.osm_ref from seed join attractions a on seed.ref like 'osm:relation/%' and a.osm_ref = substr(seed.ref, 14)),
  names as (
    select ref from seed where ref is not null
    union select x.ref from atlas cross join lateral (values
      (atlas.venue_ref), ('atlas:' || atlas.id::text), ('wikidata:' || atlas.wikidata_id),
      ('osm:' || atlas.osm_ref), (case when atlas.osm_ref ~ '^[0-9]+$' then 'osm:relation/' || atlas.osm_ref end)) x(ref)
     where x.ref is not null),
  matched as (
    select 'google:' || m.source_ref as ref from provider_matches m join names n on n.ref = m.venue_ref
     where m.source = 'google' and not m.missing and m.source_ref is not null)
  select ref from names union select ref from matched
)`;

/** The place under `refExpr` is not hidden, under any name it goes by. */
export const SHOWN_REF = (refExpr) => `coalesce(${refExpr}, '') not in (select ref from ${HIDDEN_REFS} h where ref is not null)`;

/**
 * The atlas row under `alias` is not hidden — matched by every name it goes
 * by: its canonical ref, its own `atlas:<id>`, and its Wikidata id, so a
 * closed place a re-harvest brings back as a new row is still closed. Three
 * uncorrelated `not in`s, each hashed once per statement, rather than a
 * correlated lookup that would work the alias set out again for every row.
 */
export const SHOWN_ATTRACTION = (alias = 'a') => `(${SHOWN_REF(`coalesce(${alias}.venue_ref, 'atlas:' || ${alias}.id::text)`)}
  and ${SHOWN_REF(`'atlas:' || ${alias}.id::text`)}
  and ${SHOWN_REF(`'wikidata:' || ${alias}.wikidata_id`)})`;

/** Which of these refs are hidden, under any name they go by. */
export async function hiddenAmong(refs, client = null) {
  const list = [...new Set((refs ?? []).filter(Boolean).map(String))];
  if (!list.length) return new Set();
  const { rows } = await on(client)(
    `select h.ref from ${HIDDEN_REFS} h where h.ref = any($1::text[])`, [list]);
  return new Set(rows.map((r) => r.ref));
}

/** Drop hidden places from a list, reading each item's ref with `refOf`. */
export async function withoutHidden(items, refOf = (x) => x?.ref ?? x?.venueRef) {
  const hidden = await hiddenAmong((items ?? []).map(refOf));
  return hidden.size ? items.filter((x) => !hidden.has(String(refOf(x)))) : items;
}

const shape = (r) => (r ? {
  ref: r.venue_ref, status: r.status, confirmed: r.confirmed, confirmedBy: r.confirmed_by,
  reason: r.reason, source: r.source, evidence: r.evidence, review: r.review,
  successor: r.successor_ref || r.successor_name ? { ref: r.successor_open_ref ?? r.successor_ref, name: r.successor_label ?? r.successor_name } : null,
  decidedAt: r.decided_at, checkedAt: r.checked_at, applied: r.applied, appliedAt: r.applied_at,
  hidden: hides(r),
} : null);

// The successor's name, and the ref a family screen opens it by: an atlas
// place is drawn on Inspire as `osm:` or `wikidata:` (routes/inspire.js), not
// by our own `atlas:<id>`.
const SUCCESSOR_LABEL = `coalesce(
  (select pr.name from place_records pr where pr.venue_ref = s.successor_ref),
  (select a.name from attractions a where coalesce(a.venue_ref, 'atlas:' || a.id::text) = s.successor_ref limit 1),
  s.successor_name) as successor_label,
  coalesce(
  (select case when a.venue_ref is not null then a.venue_ref when a.osm_ref is not null then 'osm:' || a.osm_ref
               when a.wikidata_id is not null then 'wikidata:' || a.wikidata_id end
     from attractions a where coalesce(a.venue_ref, 'atlas:' || a.id::text) = s.successor_ref limit 1),
  s.successor_ref) as successor_open_ref`;

/** One place's status, for a record page or a drawer. Null when nobody has looked. */
export async function statusFor(ref, { wikidataId = null, atlasId = null } = {}) {
  if (!ref && !wikidataId && !atlasId) return null;
  const { rows } = await query(
    `select s.*, ${SUCCESSOR_LABEL} from place_status s
      where s.venue_ref = $1 or ($2::text is not null and s.wikidata_id = $2) or ($3::text is not null and s.venue_ref = 'atlas:' || $3)
      order by (s.venue_ref = $1) desc, s.applied desc, s.decided_at desc limit 1`,
    [ref ?? null, wikidataId ?? null, atlasId ?? null]);
  const own = shape(rows[0]);
  if (own?.hidden || !ref) return own;
  // A link under another name the hidden place goes by — its `osm:` ref, or
  // the atlas row a Google closure reached through Wikidata — opens on the
  // hidden place's status, exactly as the lists hide it (Codex, third pass).
  const via = await hiddenOriginOf(ref);
  return via ?? own;
}

/**
 * The hidden place a ref is another name for, or null: the same expansion as
 * HIDDEN_REFS, carrying which hidden row each name came from. Asked for one
 * ref, when a direct link is opened — never inside a list.
 */
async function hiddenOriginOf(ref) {
  return (await hiddenStatusesOf([ref])).get(ref) ?? null;
}

/**
 * For each of these refs that is a name of a hidden place, that place's
 * status — for the household's own saved list and history, which keep a
 * closed place and mark it "Closed", with "Now: …" (C57, owner, 29 Sep 2026).
 */
export async function hiddenStatusesOf(refs) {
  const list = [...new Set((refs ?? []).filter(Boolean).map(String))];
  if (!list.length) return new Map();
  const { rows } = await query(
    `with hid as (select s.venue_ref, s.wikidata_id from place_status s where ${HIDING}),
     seed as (
       select venue_ref as ref, venue_ref as origin from hid
       union select 'wikidata:' || wikidata_id, venue_ref from hid where wikidata_id is not null
       union select m.venue_ref, hid.venue_ref from provider_matches m join hid on hid.venue_ref = 'google:' || m.source_ref
        where m.source = 'google' and not m.missing),
     atlas as (
       select a.id, a.venue_ref, a.wikidata_id, a.osm_ref, seed.origin from seed join attractions a on seed.ref like 'atlas:%' and a.id::text = substr(seed.ref, 7)
       union select a.id, a.venue_ref, a.wikidata_id, a.osm_ref, seed.origin from seed join attractions a on a.venue_ref = seed.ref
       union select a.id, a.venue_ref, a.wikidata_id, a.osm_ref, seed.origin from seed join attractions a on seed.ref like 'wikidata:%' and a.wikidata_id = substr(seed.ref, 10)
       union select a.id, a.venue_ref, a.wikidata_id, a.osm_ref, seed.origin from seed join attractions a on seed.ref like 'osm:%' and a.osm_ref = substr(seed.ref, 5)
       union select a.id, a.venue_ref, a.wikidata_id, a.osm_ref, seed.origin from seed join attractions a on seed.ref like 'osm:relation/%' and a.osm_ref = substr(seed.ref, 14)),
     names as (
       select ref, origin from seed where ref is not null
       union select x.ref, atlas.origin from atlas cross join lateral (values
         (atlas.venue_ref), ('atlas:' || atlas.id::text), ('wikidata:' || atlas.wikidata_id),
         ('osm:' || atlas.osm_ref), (case when atlas.osm_ref ~ '^[0-9]+$' then 'osm:relation/' || atlas.osm_ref end)) x(ref)
        where x.ref is not null),
     matched as (
       select 'google:' || m.source_ref as ref, n.origin from provider_matches m join names n on n.ref = m.venue_ref
        where m.source = 'google' and not m.missing and m.source_ref is not null),
     every as (select ref, origin from names union select ref, origin from matched)
     select distinct on (e.ref) e.ref as asked_ref, s.*, ${SUCCESSOR_LABEL} from every e join place_status s on s.venue_ref = e.origin
      where e.ref = any($1::text[]) order by e.ref, s.decided_at desc`, [list]);
  return new Map(rows.map((r) => [r.asked_ref, shape(r)]));
}

/** The two words a family screen shows for a closed place: the status and the successor. */
export const closedBrief = (s) => (s?.hidden ? { status: s.status, confirmed: s.confirmed, successor: s.successor } : null);

/** Statuses for many refs at once, for a back-office list. */
export async function statusesFor(refs) {
  const list = [...new Set((refs ?? []).filter(Boolean).map(String))];
  if (!list.length) return new Map();
  const { rows } = await query(`select s.*, ${SUCCESSOR_LABEL} from place_status s where s.venue_ref = any($1::text[])`, [list]);
  return new Map(rows.map((r) => [r.venue_ref, shape(r)]));
}

/**
 * Write what a check found.
 *
 * `applied` survives only when the new row hides no more than the old one
 * did: a place that comes to be hidden (newly closed, newly unconfirmed) waits
 * for a person again; a place that comes back needs nobody's OK. A person's
 * own row is never overwritten by a check.
 */
export async function propose(row, { client = null, checkId = null } = {}) {
  const hideNew = `(excluded.status in ('temporarily_closed', 'permanently_closed') or not excluded.confirmed)`;
  const hideOld = `(place_status.status in ('temporarily_closed', 'permanently_closed') or not place_status.confirmed)`;
  const same = `place_status.status = excluded.status and place_status.confirmed = excluded.confirmed`;
  await on(client)(
    `insert into place_status (venue_ref, wikidata_id, status, confirmed, confirmed_by, reason, source, evidence,
                               successor_ref, successor_name, review, check_id, applied, applied_at, applied_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,case when $13 then now() end,$14)
     on conflict (venue_ref) do update set
       wikidata_id = coalesce(excluded.wikidata_id, place_status.wikidata_id),
       status = excluded.status, confirmed = excluded.confirmed, confirmed_by = excluded.confirmed_by,
       reason = excluded.reason, source = excluded.source, evidence = excluded.evidence,
       successor_ref = coalesce(excluded.successor_ref, place_status.successor_ref),
       successor_name = coalesce(excluded.successor_name, place_status.successor_name),
       review = excluded.review, check_id = excluded.check_id, checked_at = now(),
       decided_at = case when ${same} then place_status.decided_at else now() end,
       applied = case when excluded.applied then true
                      when ${hideNew} and not (${hideOld} and place_status.applied) then false
                      else place_status.applied end,
       applied_at = case when excluded.applied then now() else place_status.applied_at end,
       applied_by = case when excluded.applied then excluded.applied_by else place_status.applied_by end
     where place_status.source is distinct from 'person' or excluded.source = 'person'`,
    [row.ref, row.wikidataId ?? null, row.status ?? 'unknown', row.confirmed !== false, row.confirmedBy ?? null,
      row.reason ?? null, row.source ?? null, row.evidence ?? null, row.successorRef ?? null, row.successorName ?? null,
      !!row.review, checkId, !!row.applied, row.appliedBy ?? null]);
}

/**
 * Google's business status, read in memory when details were fetched anyway.
 * Only the derived flag and `source = 'google'` are written; Google's own
 * value is never passed in here. Confirmed: a Google id is a current source.
 */
export async function noteGoogleStatus(ref, verdict) {
  if (!ref || !verdict) return;
  await propose({ ref, status: verdict.status, confirmed: true, confirmedBy: 'google', reason: verdict.reason, source: 'google', evidence: verdict.evidence });
}

/** A person's word, from the back office. Applied at once: it is the owner's own act. */
export async function setByPerson(ref, { status, reason = null, successorRef = null, by }) {
  await propose({ ref, status, confirmed: true, confirmedBy: 'person', reason: reason ?? 'set by a person', source: 'person', evidence: by ? `set by ${by}` : null, successorRef, applied: true, appliedBy: by ?? null });
}

/**
 * The owner's OK: every proposed row that would hide becomes applied. A row
 * flagged for review is `unknown` — never closed on a hunch — so it is applied
 * only for being unconfirmed, if it is.
 */
export async function applyProposed({ by, checkId = null } = {}) {
  return withTransaction(async (c) => {
    const { rows } = await c.query(
      `update place_status s set applied = true, applied_at = now(), applied_by = $1
        where not s.applied
          and (s.status in ('temporarily_closed', 'permanently_closed') or not s.confirmed)
          and ($2::uuid is null or s.check_id = $2)
        returning s.status, s.confirmed`, [by ?? null, checkId]);
    return {
      applied: rows.length,
      closed: rows.filter((r) => r.status !== 'unknown' && r.status !== 'open').length,
      unconfirmed: rows.filter((r) => !r.confirmed && (r.status === 'unknown' || r.status === 'open')).length,
    };
  });
}

// ---------------------------------------------------------------------------
// the check's own record
// ---------------------------------------------------------------------------

export async function startCheck({ by, dryRun = true }) {
  const { rows } = await query(`insert into closed_checks (started_by, dry_run) values ($1, $2) returning id`, [by ?? null, dryRun]);
  return rows[0].id;
}
export async function finishCheck(id, { counts, error = null }) {
  await query(`update closed_checks set state = $2, finished_at = now(), counts = $3, error = $4 where id = $1`,
    [id, error ? 'failed' : 'done', JSON.stringify(counts ?? {}), error]);
}
export async function runningCheck() {
  const { rows } = await query(`select * from closed_checks where state = 'running' and started_at > now() - interval '6 hours' order by started_at desc limit 1`);
  return rows[0] ?? null;
}
export async function latestCheck() {
  const { rows } = await query(`select * from closed_checks order by started_at desc limit 1`);
  return rows[0] ?? null;
}

/**
 * The report (item 4): how many would be hidden, by reason and by status,
 * confirmed against unconfirmed, and twenty examples — Windsor Safari Park
 * first when it is among them, since it is the case that started this.
 */
export async function report({ examples = 20 } = {}) {
  // A row flagged for review is `unknown`, so it would hide only if nothing
  // current confirms it — the review is about closure, not existence.
  const WOULD = `(s.status in ('temporarily_closed', 'permanently_closed') or not s.confirmed)`;
  const CLOSED_NOW = `s.status in ('temporarily_closed', 'permanently_closed')`;
  // What an unconfirmed place is filed as: our drawer where it has one, else the atlas's own word.
  const FILED = `coalesce(sub.label, a.category, 'unfiled')`;
  const PLACE_JOIN = `
             left join place_records pr on pr.venue_ref = s.venue_ref
             left join lateral (select a.name, a.region_slug, a.category from attractions a
                                 where coalesce(a.venue_ref, 'atlas:' || a.id::text) = s.venue_ref
                                    or (s.wikidata_id is not null and a.wikidata_id = s.wikidata_id) limit 1) a on true
             left join place_index pi on pi.venue_ref = s.venue_ref
             left join shelf_subcategories sub on sub.key = pi.subcategory
             left join regions reg on reg.slug = a.region_slug`;
  const [byStatus, byReason, bySource, totals, sample, reviewSample, unconfirmedByCategory, unconfirmedSample, reviewByReason, matchCount] = await Promise.all([
    query(`select s.status, s.confirmed, s.applied, count(*)::int as n from place_status s group by 1, 2, 3 order by 1, 2, 3`),
    query(`select case when s.status in ('temporarily_closed','permanently_closed') then s.status else 'unconfirmed' end as hidden_as,
                  coalesce(s.source, 'none') as source,
                  coalesce(regexp_replace(s.reason, '\\d{4}', 'YYYY', 'g'), 'no current source') as reason,
                  count(*)::int as n
             from place_status s where ${WOULD}
            group by 1, 2, 3 order by n desc limit 60`),
    query(`select coalesce(s.source, 'none') as source, s.status, count(*)::int as n from place_status s group by 1, 2 order by 1, 2`),
    query(`select count(*) filter (where ${WOULD})::int as would_hide,
                  count(*) filter (where ${WOULD} and s.status in ('temporarily_closed','permanently_closed'))::int as would_hide_closed,
                  count(*) filter (where ${WOULD} and s.status not in ('temporarily_closed','permanently_closed'))::int as would_hide_unconfirmed,
                  count(*) filter (where ${HIDING})::int as hidden_now,
                  count(*) filter (where s.review)::int as review,
                  count(*) filter (where s.successor_ref is not null)::int as with_successor,
                  count(*) filter (where s.reason like 'history:%')::int as history,
                  count(*)::int as rows
             from place_status s`),
    // Closed: twenty, the case that started it first.
    query(`select s.*, ${SUCCESSOR_LABEL},
                  coalesce(pr.name, a.name) as name, coalesce(reg.name, pr.postcode) as place_where, ${FILED} as filed
             from place_status s ${PLACE_JOIN}
            where ${CLOSED_NOW}
            order by (coalesce(pr.name, a.name) = 'Windsor Safari Park') is true desc, md5(s.venue_ref)
            limit $1`, [examples]),
    query(`select s.*, coalesce(pr.name, a.name) as name
             from place_status s
             left join place_records pr on pr.venue_ref = s.venue_ref
             left join lateral (select a.name from attractions a where coalesce(a.venue_ref, 'atlas:' || a.id::text) = s.venue_ref limit 1) a on true
            where s.review order by md5(s.venue_ref) limit 10`),
    // Unconfirmed, by what it is filed as, and twenty spread across the kinds.
    query(`select ${FILED} as filed, count(*)::int as n
             from place_status s ${PLACE_JOIN}
            where not s.confirmed and not (${CLOSED_NOW})
            group by 1 order by n desc`),
    query(`select * from (
             select s.*, coalesce(pr.name, a.name) as name, coalesce(reg.name, pr.postcode) as place_where, ${FILED} as filed,
                    row_number() over (partition by ${FILED} order by md5(s.venue_ref)) as nth
               from place_status s ${PLACE_JOIN}
              where not s.confirmed and not (${CLOSED_NOW})) x
            order by nth, filed limit $1`, [examples]),
    query(`select coalesce(regexp_replace(s.reason, '\\d{4}', 'YYYY', 'g'), 'none') as reason, coalesce(s.source, 'none') as source, count(*)::int as n
             from place_status s where s.review group by 1, 2 order by n desc`),
    query(`select count(*)::int as n from atlas_osm_matches`),
  ]);
  const ex = (r) => ({
    ref: r.venue_ref, name: r.name ?? null, where: r.place_where ?? null, status: r.status, confirmed: r.confirmed,
    reason: r.reason, source: r.source, evidence: r.evidence, review: r.review,
    successor: r.successor_ref || r.successor_name ? { ref: r.successor_open_ref ?? r.successor_ref, name: r.successor_label ?? r.successor_name } : null,
    applied: r.applied, filed: r.filed ?? null,
  });
  return {
    check: await latestCheck(),
    totals: totals.rows[0],
    byStatus: byStatus.rows,
    byReason: byReason.rows,
    bySource: bySource.rows,
    examples: sample.rows.map(ex),
    review: reviewSample.rows.map(ex),
    reviewByReason: reviewByReason.rows,
    unconfirmedByCategory: unconfirmedByCategory.rows,
    unconfirmedExamples: unconfirmedSample.rows.map(ex),
    openMapMatches: matchCount.rows[0]?.n ?? 0,
  };
}
