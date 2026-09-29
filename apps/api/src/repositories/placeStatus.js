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

/** The place under `refExpr` is not hidden. */
export const SHOWN_REF = (refExpr) =>
  `not exists (select 1 from place_status s where s.venue_ref = ${refExpr} and ${HIDING})`;

/**
 * The atlas row under `alias` is not hidden — matched by every name it goes
 * by: its canonical ref, its own `atlas:<id>`, and its Wikidata id, so a
 * closed place a re-harvest brings back as a new row is still closed.
 */
export const SHOWN_ATTRACTION = (alias = 'a') => `not exists (
  select 1 from place_status s
   where (s.venue_ref = coalesce(${alias}.venue_ref, 'atlas:' || ${alias}.id::text)
          or s.venue_ref = 'atlas:' || ${alias}.id::text
          or (${alias}.wikidata_id is not null and s.wikidata_id = ${alias}.wikidata_id))
     and ${HIDING})`;

/** Which of these refs are hidden. `wikidata:Q…` refs are matched on the id too. */
export async function hiddenAmong(refs, client = null) {
  const list = [...new Set((refs ?? []).filter(Boolean).map(String))];
  if (!list.length) return new Set();
  const qids = list.map((r) => /^wikidata:(Q\d+)$/.exec(r)?.[1]).filter(Boolean);
  const { rows } = await on(client)(
    `select s.venue_ref, s.wikidata_id from place_status s
      where (s.venue_ref = any($1::text[]) or s.wikidata_id = any($2::text[])) and ${HIDING}`,
    [list, qids]);
  const out = new Set();
  for (const r of rows) {
    if (list.includes(r.venue_ref)) out.add(r.venue_ref);
    if (r.wikidata_id && list.includes(`wikidata:${r.wikidata_id}`)) out.add(`wikidata:${r.wikidata_id}`);
  }
  return out;
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
  return shape(rows[0]);
}

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
  const [byStatus, byReason, bySource, totals, sample, reviewSample] = await Promise.all([
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
                  count(*)::int as rows
             from place_status s`),
    query(`select s.*, ${SUCCESSOR_LABEL},
                  coalesce(pr.name, a.name) as name, coalesce(reg.name, pr.postcode) as place_where
             from place_status s
             left join place_records pr on pr.venue_ref = s.venue_ref
             left join lateral (select a.name, a.region_slug from attractions a
                                 where coalesce(a.venue_ref, 'atlas:' || a.id::text) = s.venue_ref
                                    or (s.wikidata_id is not null and a.wikidata_id = s.wikidata_id) limit 1) a on true
             left join regions reg on reg.slug = a.region_slug
            where ${WOULD}
            order by (coalesce(pr.name, a.name) = 'Windsor Safari Park') desc,
                     (s.status in ('temporarily_closed','permanently_closed')) desc, s.source, md5(s.venue_ref)
            limit $1`, [examples]),
    query(`select s.*, coalesce(pr.name, a.name) as name
             from place_status s
             left join place_records pr on pr.venue_ref = s.venue_ref
             left join lateral (select a.name from attractions a where coalesce(a.venue_ref, 'atlas:' || a.id::text) = s.venue_ref limit 1) a on true
            where s.review order by md5(s.venue_ref) limit 10`),
  ]);
  const ex = (r) => ({
    ref: r.venue_ref, name: r.name ?? null, where: r.place_where ?? null, status: r.status, confirmed: r.confirmed,
    reason: r.reason, source: r.source, evidence: r.evidence, review: r.review,
    successor: r.successor_ref || r.successor_name ? { ref: r.successor_ref, name: r.successor_label ?? r.successor_name } : null,
    applied: r.applied,
  });
  return {
    check: await latestCheck(),
    totals: totals.rows[0],
    byStatus: byStatus.rows,
    byReason: byReason.rows,
    bySource: bySource.rows,
    examples: sample.rows.map(ex),
    review: reviewSample.rows.map(ex),
  };
}
