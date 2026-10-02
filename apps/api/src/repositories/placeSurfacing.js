/**
 * The surfacing determination (Option 2, owner, 1 Oct 2026; migration 321).
 *
 * The apply path behind the narrowing measurement. It writes a per-place
 * "not surfaced" determination for the three low-attraction Culture drawers, so
 * family-facing reads and the Culture counts leave those places out — WITHOUT
 * deleting anything, and reversibly. It mirrors the closed check (C57): a dry-run
 * check writes `applied = false`, the report shows what would change, and apply
 * is the owner's own device-only act.
 *
 * It reuses C57's machinery rather than inventing a second filter: the
 * determination is folded into `HIDDEN_REFS` (repositories/placeStatus.js), so
 * the one shared predicate every family read already honours (Inspire, Find /
 * cache, collections, discover, plan, the ring and area counts) drops a
 * not-surfaced place exactly as it drops a closed one. The back office still
 * shows everything.
 *
 * **Can't-speak governs FACTS, not this** (CLAUDE.md). The predicate's facts
 * verdict may be "can't-speak"; for *surfacing* there is no can't-tell — a place
 * with no notability evidence is simply not surfaced.
 *
 * A place is held back only when it is filed PRIMARY in one of the three
 * narrowed drawers AND has no positive evidence on any copy AND is not also
 * filed in a non-low-attraction drawer (so a place that legitimately surfaces as
 * something else is never hidden). It is re-evaluated when evidence arrives
 * through normal use (`reconsider`, wired to research landing), never by a sweep
 * (C38).
 */

import { query, withTransaction } from '../db.js';
import { notable, NOT_SURFACED_REASON } from '../domain/narrowing.js';
import { gatherSignals, heritageLoad, NARROWED, aliasClosure, filedElsewhere } from './narrowing.js';
import { narrowingPreview } from './narrowing.js';
import { FILED_SQL } from '../desk/categories.js';
import { refreshRegionCounts } from './library.js';
import { refreshAllBefore } from './ringTables.js';
import { forget as forgetCollections } from '../desk/collections.js';

/**
 * Invalidate what a change to the hidden set affects — exactly what /apply does
 * (Codex): the collections cache, each county's published count, and the ring
 * counts. Called by `applySurfacing`'s route and by `onResearched` when research
 * re-surfaces an applied hidden place, so the counts stop excluding it at once
 * rather than waiting for an unrelated refresh. Free — our own tables only.
 */
export async function invalidateCounts() {
  forgetCollections();
  const at = new Date().toISOString();
  const { rows: regions } = await query('select slug from regions');
  for (const r of regions) await refreshRegionCounts(r.slug).catch(() => null);
  void refreshAllBefore({ before: at }).catch((err) => console.warn(`surfacing invalidate: rings: ${String(err?.message ?? err).slice(0, 120)}`));
}

const BATCH = 500;
const empty = (ref) => ({ ref, heritageAvailable: false, heritage: null });

/** Signals for many refs, in batches (so the determination can read a whole place). */
async function signalsFor(refs, heLoad) {
  const out = new Map();
  const list = [...new Set((refs ?? []).filter(Boolean))];
  for (let i = 0; i < list.length; i += BATCH) {
    const got = await gatherSignals(list.slice(i, i + BATCH), { heritageLoad: heLoad });
    for (const [k, v] of got) out.set(k, v);
  }
  return out;
}

/**
 * Refs filed PRIMARY (place_index.subcategory, fence-filtered) in a narrowed
 * drawer, among `refs` (or the whole estate when `refs` is null). The "also filed
 * elsewhere" exclusion is NOT done here — it is cluster-wide (below), because the
 * twin of this place may be the one filed as a museum.
 */
async function primaryNarrowedRefs(refs = null) {
  const args = [NARROWED];
  let filedWhere = '';
  if (refs) { if (!refs.length) return []; args.push(refs); filedWhere = 'where f.venue_ref = any($2::text[])'; }
  const { rows } = await query(
    `with filed as (
       select f.venue_ref as ref, f.sub, bool_or(f.is_primary) as is_primary
         from (${FILED_SQL}) f ${filedWhere}
        group by f.venue_ref, f.sub)
     select ref, sub as subcategory from filed where is_primary and sub = any($1::text[])`, args);
  return rows;
}

/**
 * The candidate PLACES and their clusters, keyed by cluster root — the single
 * source of truth both the check and reconsider use (Codex root fix). Seeds the
 * one `aliasClosure` with the primary-narrowed refs (or one ref), then over the
 * WHOLE closure (discovered twins included) re-derives the primary-narrowed refs
 * and the "filed elsewhere" set. A cluster is a candidate only when it has a
 * primary-narrowed ref AND no ref in its full closure is filed in a
 * non-low-attraction drawer (#1 / C). `byRoot` maps root -> the primary refs in
 * that cluster, so each physical place is judged and written ONCE (B).
 */
async function clusterCandidates(seedRefs) {
  const { rootOf, membersOf } = await aliasClosure(seedRefs);
  const allNodes = [...rootOf.keys()];
  if (!allNodes.length) return { rootOf, membersOf, byRoot: new Map(), allNodes };
  const [prim, elsewhere] = await Promise.all([
    primaryNarrowedRefs(allNodes),
    filedElsewhere(allNodes),
  ]);
  const byRoot = new Map();
  for (const c of prim) {
    const root = rootOf.get(c.ref) ?? c.ref;
    if (!byRoot.has(root)) byRoot.set(root, []);
    byRoot.get(root).push(c);
  }
  // Drop a cluster if ANY ref in its full closure surfaces as something else.
  for (const [root] of [...byRoot]) {
    const members = membersOf.get(root) ?? [];
    if (members.some((m) => elsewhere.has(m))) byRoot.delete(root);
  }
  return { rootOf, membersOf, byRoot, allNodes };
}

/** The representative ref a cluster's one determination is written on: the
 * lowest-sorted primary-narrowed ref, so it is stable and a real filed venue. */
function representative(group) {
  return [...group].sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))[0];
}

/**
 * Write (or update) one place's determination. `applied` on the way in survives
 * only when the row hides no more than before: a place coming to be held back
 * (surfaces -> not) waits for the owner again; one staying not-surfaced keeps its
 * OK; one coming back (not -> surfaces) no longer hides, so its flag is left as
 * it was. Mirrors placeStatus.propose.
 */
async function writeDetermination({ ref, surfaced, subcategory = null, reason = null, detail = null, checkId = null, apply = false, by = null }, q = query) {
  await q(
    `insert into place_surfacing (venue_ref, surfaced, reason, detail, subcategory, check_id, applied, applied_at, applied_by)
     values ($1, $2, $3, $4, $5, $6, $7, case when $7 then now() end, $8)
     on conflict (venue_ref) do update set
       surfaced = excluded.surfaced,
       reason = excluded.reason, detail = excluded.detail,
       subcategory = coalesce(excluded.subcategory, place_surfacing.subcategory),
       check_id = excluded.check_id, checked_at = now(),
       decided_at = case when place_surfacing.surfaced = excluded.surfaced then place_surfacing.decided_at else now() end,
       applied = case when excluded.applied then true
                      when excluded.surfaced then place_surfacing.applied
                      when not place_surfacing.surfaced and place_surfacing.applied then true
                      else false end,
       applied_at = case when excluded.applied then now()
                         when excluded.surfaced or (not place_surfacing.surfaced and place_surfacing.applied) then place_surfacing.applied_at
                         else null end,
       applied_by = case when excluded.applied then excluded.applied_by
                         when excluded.surfaced or (not place_surfacing.surfaced and place_surfacing.applied) then place_surfacing.applied_by
                         else null end`,
    [ref, surfaced, reason, detail, subcategory, checkId, !!apply, by]);
}

/**
 * Judge a whole physical place (a cluster of refs) from the signals of ALL its
 * members, and write the verdict to ONE row. A cluster with positive evidence on
 * ANY ref surfaces — so an evidence-poor census twin is never written
 * not-surfaced while its notable atlas twin would be hidden through the same
 * links HIDDEN_REFS expands. The `why` is read from the member that carried the
 * evidence.
 *
 * One cluster, one LIVE row (Codex): when a category edit moves the
 * representative, the owner's OK carries over to the new row — the place hides
 * no more than before, the same rule the same-row upsert applies — and every
 * other determination the place goes by is deleted, so research can never mark
 * an obsolete row surfaced while the active one keeps hiding the place.
 *
 * Returns `{ surfaces, unhid }`: `unhid` says an APPLIED hidden place just came
 * back (evidence arrived), which the caller must answer with the same count
 * invalidation /apply uses.
 */
async function judgeCluster(ref, subcategory, members, signalsByRef, checkId) {
  const notableMember = members.find((m) => notable(signalsByRef.get(m) ?? empty(m)).status === 'kept');
  const surfaces = Boolean(notableMember);
  // The determination, the obsolete rows' removal and the snapshot are one write:
  // a reader between them saw a hidden place with no snapshot, i.e. not hidden
  // (Codex, via the gate proof).
  return withTransaction(async (c) => {
  const query = c.query.bind(c);
  const { rows: [prior] } = await query(
    `select applied_by from place_surfacing where venue_ref = any($1::text[]) and applied and not surfaced limit 1`,
    [members]);
  // What families are hidden from right now, for this place: the snapshot of any
  // applied hidden row it goes by. Compared after the write, so a snapshot that
  // GROWS (a new evidence-free alias judged in) counts as a change too (Codex).
  const { rows: before } = await query(
    `select distinct m.member_ref from place_surfacing_members m
       join place_surfacing s on s.venue_ref = m.venue_ref and s.applied and not s.surfaced
      where m.venue_ref = any($1::text[])`, [members]);
  await writeDetermination({
    ref, surfaced: surfaces, subcategory,
    reason: surfaces ? null : 'not_notable',
    detail: surfaces ? notable(signalsByRef.get(notableMember)).signals.join('; ') : NOT_SURFACED_REASON,
    checkId,
    // Carry the OK across a representative change: already applied-hidden and
    // still not-surfaced hides exactly as before, so it keeps the owner's OK.
    apply: Boolean(prior) && !surfaces,
    by: prior?.applied_by ?? null,
  }, query);
  // One live row: every other determination the place goes by goes (its snapshot
  // with it, by cascade).
  await query(`delete from place_surfacing where venue_ref = any($1::text[]) and venue_ref <> $2`, [members, ref]);
  await writeSnapshot(ref, surfaces ? [] : members, checkId, query);
  const unhid = Boolean(prior) && surfaces;
  let hiddenChanged = unhid;
  if (!unhid && prior && !surfaces) {
    const was = new Set(before.map((x) => x.member_ref));
    const now = new Set([ref, ...members].map(String));
    hiddenChanged = was.size !== now.size || [...now].some((m) => !was.has(m));
  }
  return { surfaces, unhid, hiddenChanged };
  });
}

/**
 * Record exactly the refs this determination judged — the snapshot HIDDEN_REFS
 * hides for a not-surfaced place, instead of a live walk of the alias graph
 * (Codex). Replaced on every rewrite; a surfaced row carries none (it hides
 * nothing), so a stale snapshot can never outlive the verdict that made it. A ref
 * linked after this moment is not in it, and stays visible until the next check
 * or a reconsider judges the enlarged cluster.
 */
async function writeSnapshot(ref, members, checkId, q = query) {
  await q(`delete from place_surfacing_members where venue_ref = $1`, [ref]);
  const list = [...new Set([ref, ...(members ?? [])].filter(Boolean).map(String))];
  if (!members?.length) return;
  await q(
    `insert into place_surfacing_members (venue_ref, member_ref, check_id)
     select $1, m, $3 from unnest($2::text[]) m
     on conflict (venue_ref, member_ref) do update set check_id = excluded.check_id`,
    [ref, list, checkId]);
}

// ---------------------------------------------------------------------------
// the check (dry-run), its report, and the owner's OK
// ---------------------------------------------------------------------------

/**
 * Reserve the single run slot. A stale 'running' row (a crashed run, older than
 * the six hours `runningCheck` honours) is marked failed first so the slot frees
 * itself; then the insert — which the `surfacing_checks_single_running` unique
 * index (migration 321) refuses if a fresh run already holds it, raising 23505.
 * That is how two API instances yield one run (Codex E): the loser's insert
 * throws and the route answers 409.
 */
/** The one lock check start and apply share, so neither interleaves with the other (Codex). */
const SURFACING_LOCK = `select pg_advisory_xact_lock(hashtext('epic:place_surfacing'))`;

export async function startCheck({ by = null, dryRun = true }) {
  return withTransaction(async (c) => {
    await c.query(SURFACING_LOCK);
    await c.query(`update surfacing_checks set state = 'failed', finished_at = now(), error = coalesce(error, 'stale')
                    where state = 'running' and started_at < now() - interval '6 hours'`);
    const { rows } = await c.query(`insert into surfacing_checks (started_by, dry_run) values ($1, $2) returning id`, [by, dryRun]);
    return rows[0].id;
  });
}
export async function finishCheck(id, { counts, error = null }) {
  await query(`update surfacing_checks set state = $2, finished_at = now(), counts = $3, error = $4 where id = $1`,
    [id, error ? 'failed' : 'done', JSON.stringify(counts ?? {}), error]);
}
export async function runningCheck() {
  const { rows } = await query(`select * from surfacing_checks where state = 'running' and started_at > now() - interval '6 hours' order by started_at desc limit 1`);
  return rows[0] ?? null;
}
export async function latestCheck() {
  const { rows } = await query(`select * from surfacing_checks order by started_at desc limit 1`);
  return rows[0] ?? null;
}

/**
 * Run the check over the whole estate. Free (owned signals only), written place by
 * place with `applied = false` so a deploy mid-run loses nothing. Each physical
 * place is judged ONCE as a cluster and written ONCE, on a representative ref (B),
 * so a twin with evidence keeps the place surfaced and no place is double-counted.
 * A full run also RESTORES (un-hides) every held-back row not reaffirmed this run —
 * a place refiled, re-primaried, or whose twin became a museum — since category
 * edits do not call `reconsider`. `checkId` may be pre-reserved by the route (the
 * DB reservation); otherwise one is started here. `only` runs one place (reconsider
 * uses `reconsider`, not this) and skips the restore pass.
 */
export async function runSurfacingCheck({ by = null, dryRun = true, only = null, checkId: given = null, invalidate = invalidateCounts } = {}) {
  const checkId = given ?? (only ? null : await startCheck({ by, dryRun }));
  const counts = { candidates: 0, written: 0, surfaced: 0, notSurfaced: 0, restored: 0, unhid: 0, byDrawer: {} };
  try {
    const seeds = await primaryNarrowedRefs(only?.ref ? [String(only.ref)] : null);
    const { rootOf, membersOf, byRoot, allNodes } = await clusterCandidates(seeds.map((c) => c.ref));
    counts.candidates = byRoot.size;
    const he = await heritageLoad();
    const signalsByRef = await signalsFor(allNodes, he.load);

    const reaffirmed = []; // representative refs written not-surfaced this run
    for (const [root, group] of byRoot) {
      const rep = representative(group);
      const members = membersOf.get(root) ?? group.map((g) => g.ref);
      const { surfaces, unhid, hiddenChanged } = await judgeCluster(rep.ref, rep.subcategory, members, signalsByRef, checkId);
      counts.written += 1;
      if (unhid) counts.unhid += 1;
      if (hiddenChanged && !unhid) counts.hiddenGrew = (counts.hiddenGrew ?? 0) + 1;
      if (surfaces) counts.surfaced += 1;
      else {
        counts.notSurfaced += 1;
        reaffirmed.push(rep.ref);
        counts.byDrawer[rep.subcategory] = (counts.byDrawer[rep.subcategory] ?? 0) + 1;
      }
    }

    // Restore every held-back row this full run did not reaffirm — one statement,
    // so a place that stopped being a candidate (and an old representative a new
    // run superseded) comes back on its own. Un-hiding keeps the owner's OK.
    if (!only) {
      const { rows: restoredRows } = await query(
        `update place_surfacing set surfaced = true, reason = null, detail = null, checked_at = now(), decided_at = now()
          where not surfaced and not (venue_ref = any($1::text[]))
          returning venue_ref, applied`, [reaffirmed]);
      counts.restored = restoredRows.length;
      counts.unhid += restoredRows.filter((r) => r.applied).length;
      // A surfaced row hides nothing, so its snapshot goes with the verdict.
      if (restoredRows.length) {
        await query(`delete from place_surfacing_members where venue_ref = any($1::text[])`,
          [restoredRows.map((r) => r.venue_ref)]);
      }
    }

    // A check that un-hid APPLIED places — refiled, or evidence gained — changes
    // what families are counted from, so it invalidates exactly what /apply does
    // (collections cache, region counts, rings); otherwise the cached counts keep
    // excluding the restored places until an unrelated refresh (Codex).
    // ...and so does a check that changed the applied hidden set the other way:
    // a snapshot that grew hides a newly judged alias (Codex).
    if (counts.unhid > 0 || (counts.hiddenGrew ?? 0) > 0) await invalidate();

    if (checkId) await finishCheck(checkId, { counts });
    return { checkId, ...counts };
  } catch (err) {
    if (checkId) await finishCheck(checkId, { counts, error: String(err?.message ?? err).slice(0, 300) }).catch(() => null);
    throw err;
  }
}

/**
 * The owner's OK: the not-surfaced determinations of ONE completed check become
 * applied, so family reads and the Culture counts start leaving those places out.
 * Guarded (Codex, Part B): a specific `checkId` is required, and only a check that
 * finished `done` may apply — a null id must never apply every historical
 * proposal, and a partial or failed run must never become family-visible. A place
 * that already surfaces is never applied (there is nothing to hide).
 */
export async function applySurfacing({ by = null, checkId = null } = {}) {
  if (!checkId) return { applied: 0, error: 'check_required', message: 'A specific completed checkId is required to apply.' };
  const { rows: [chk] } = await query(`select state from surfacing_checks where id = $1`, [checkId]);
  if (!chk) return { applied: 0, error: 'check_not_found', checkId };
  if (chk.state !== 'done') return { applied: 0, error: 'check_not_done', state: chk.state, checkId };
  return withTransaction(async (c) => {
    // Under the lock a new check cannot start, and one already running refuses
    // the apply: otherwise its per-place writes could move some rows to its own
    // check_id mid-apply and leave a partially applied set (Codex).
    await c.query(SURFACING_LOCK);
    const { rows: [running] } = await c.query(
      `select id from surfacing_checks where state = 'running' and started_at > now() - interval '6 hours' limit 1`);
    if (running) return { applied: 0, error: 'check_running', running: running.id, checkId };
    const { rows } = await c.query(
      `update place_surfacing set applied = true, applied_at = now(), applied_by = $1
        where not applied and not surfaced and check_id = $2
        returning venue_ref`, [by, checkId]);
    return { applied: rows.length, checkId };
  });
}

/**
 * One place, re-judged from what we now hold — when evidence arrives through
 * normal use (research landing), under ANY alias it goes by (Codex D). The seed
 * is resolved to its cluster root through the one closure, so landing on the
 * provider-matched Google id or the wikidata twin updates the SAME determination.
 * A place no longer a candidate (refiled, or its twin filed elsewhere) is let back
 * to surfacing; otherwise it is judged across the whole place and the one row —
 * found under whichever alias it was written on — is updated. Reversible; never a
 * sweep.
 */
export async function reconsider(ref) {
  if (!ref) return null;
  const r = String(ref);
  const { rootOf, membersOf, byRoot } = await clusterCandidates([r]);
  const root = rootOf.get(r) ?? r;
  const members = membersOf.get(root) ?? [r];
  const group = byRoot.get(root);
  // Was this place APPLIED and hidden before? Only then does un-hiding it change
  // the family counts (so `unhid` tells the caller to invalidate them).
  const { rows: [wasHidden] } = await query(
    `select 1 from place_surfacing where venue_ref = any($1::text[]) and applied and not surfaced limit 1`, [members]);
  const hidden = Boolean(wasHidden);
  if (!group || !group.length) {
    // Not (or no longer) a candidate: surface any held-back row this place goes by.
    // The verdict and its snapshot's removal are one write (Codex).
    const surfacedRows = await withTransaction(async (c) => {
      const { rows } = await c.query(
        `update place_surfacing set surfaced = true, reason = null, detail = null, checked_at = now(),
           decided_at = now() where venue_ref = any($1::text[]) and not surfaced returning venue_ref`, [members]);
      // A surfaced row hides nothing, so its snapshot goes with the verdict.
      if (rows.length) await c.query(`delete from place_surfacing_members where venue_ref = any($1::text[])`, [rows.map((x) => x.venue_ref)]);
      return rows;
    });
    if (!surfacedRows.length) return null;
    return { ref: r, surfaced: true, reconsidered: true, unhid: hidden };
  }
  const he = await heritageLoad();
  const signalsByRef = await signalsFor(members, he.load);
  // Update the ACTIVE determination row — a not-surfaced one first (that is the
  // row doing the hiding), then any row the place goes by, then the canonical
  // representative. Never an obsolete surfaced row ahead of the live hiding one
  // (Codex): judgeCluster then consolidates, so the cluster is left with exactly
  // one row either way.
  const { rows: existing } = await query(
    `select venue_ref from place_surfacing where venue_ref = any($1::text[])
      order by surfaced asc, venue_ref limit 1`, [members]);
  const rep = representative(group);
  const repRef = existing[0]?.venue_ref ?? rep.ref;
  const sub = group.find((g) => g.ref === repRef)?.subcategory ?? rep.subcategory;
  const { surfaces, hiddenChanged } = await judgeCluster(repRef, sub, members, signalsByRef, null);
  return { ref: repRef, surfaced: surfaces, reconsidered: true, unhid: hidden && surfaces, hiddenChanged };
}

/**
 * Research landed for a place: re-evaluate its surfacing (sources/own.js
 * onResearched). When it un-hides a place that was applied-hidden, invalidate the
 * family counts and collections cache the same way /apply does — otherwise the
 * counts keep excluding the restored place until an unrelated refresh (Codex).
 * `invalidate` is injectable for the tests.
 */
export async function onResearched(ref, { invalidate = invalidateCounts } = {}) {
  try {
    const r = await reconsider(ref);
    if (r?.unhid || r?.hiddenChanged) await invalidate();
    return r;
  } catch (err) { console.warn(`reconsider ${ref}: ${String(err?.message ?? err).slice(0, 120)}`); return null; }
}

/** The stored determination state — what the check wrote and what is applied. */
async function determinationState({ examples = 10 } = {}) {
  const [byDrawer, totals, sample] = await Promise.all([
    query(`select subcategory,
                  count(*) filter (where not surfaced)::int as not_surfaced,
                  count(*) filter (where not surfaced and applied)::int as applied,
                  count(*) filter (where surfaced)::int as surfaced
             from place_surfacing group by subcategory order by subcategory`),
    query(`select count(*) filter (where not surfaced)::int as not_surfaced,
                  count(*) filter (where not surfaced and applied)::int as applied,
                  count(*)::int as rows
             from place_surfacing`),
    query(`select ps.venue_ref as ref, ps.subcategory, ps.detail, ps.applied,
                  coalesce(
                    (select pr.name from place_records pr where pr.venue_ref = ps.venue_ref and (pr.provenance ->> 'name') is not null),
                    (select a.name from attractions a where coalesce(a.venue_ref, 'atlas:' || a.id::text) = ps.venue_ref limit 1)
                  ) as name
             from place_surfacing ps where not ps.surfaced order by md5(ps.venue_ref) limit $1`, [examples]),
  ]);
  return {
    notSurfaced: totals.rows[0].not_surfaced,
    applied: totals.rows[0].applied,
    rows: totals.rows[0].rows,
    byDrawer: byDrawer.rows,
    examples: sample.rows,
  };
}

/**
 * The report (Part B): the live measurement (narrowingPreview over the estate —
 * countNow / surfaced / notSurfaced per drawer and cultureTotal before/after)
 * beside the stored determination (what the check wrote, what is applied).
 */
export async function surfacingReport({ examples = 10 } = {}) {
  const [measurement, determination, latest, running] = await Promise.all([
    narrowingPreview({ scope: 'estate' }),
    determinationState({ examples }),
    latestCheck(),
    runningCheck(),
  ]);
  return { check: latest, running: running ? { id: running.id, startedAt: running.started_at } : null, measurement, determination };
}

/**
 * The owner's gate, proved rather than reasoned (owner, 1 Oct 2026: apply only if
 * "museums/galleries/castles/historic houses/theatres are unchanged, and the 10
 * notable places still surface"; and "unchanged" needs the proving query). Read
 * only. For each named place: every record it goes by (owned name or atlas name,
 * through the one alias closure) and whether any of them sits in a held-back
 * snapshot — `null` with a reason when no record of that name is held, never a
 * false "surfaces". And the leak count: snapshot records also filed in a drawer
 * the rule does not narrow, which must be 0 for the other Culture drawers to be
 * unchanged. Uncapped: absence is claimed from a count, not from a capped list.
 */
export async function gateProof({ names = [], checkId = null } = {}) {
  const he = await heritageLoad();
  // The live side first: each named place, every alias cluster of that name on its
  // own (two places can share a name — Codex), with what we hold and the bar's verdict.
  const places = [];
  for (const raw of names.map((n) => String(n).trim()).filter(Boolean).slice(0, 40)) {
    const { rows } = await query(
      `select venue_ref as ref from place_records where name ilike $1
        union select coalesce(venue_ref, 'atlas:' || id::text) from attractions where name ilike $1`, [raw]);
    const seeds = rows.map((r) => r.ref);
    if (!seeds.length) { places.push({ name: raw, records: 0, held: null, why: 'no record of that name is held' }); continue; }
    const { rootOf, membersOf } = await aliasClosure(seeds);
    for (const root of new Set(seeds.map((r) => rootOf.get(r) ?? r))) {
      const members = [...new Set(membersOf.get(root) ?? [root])];
      const [signals, filings, elsewhere] = await Promise.all([
        gatherSignals(members, { heritageLoad: he.load }),
        query(`select f.venue_ref as ref, array_agg(distinct f.sub) as subs from (${FILED_SQL}) f
                where f.venue_ref = any($1::text[]) group by f.venue_ref`, [members]),
        filedElsewhere(members),
      ]);
      const filedIn = new Map(filings.rows.map((r) => [r.ref, r.subs]));
      const trace = members.map((ref) => {
        const sg = signals.get(ref) ?? { ref, heritageAvailable: false, heritage: null };
        const v = notable(sg);
        return {
          ref, filedIn: filedIn.get(ref) ?? [], ownedName: sg.name ?? null, nation: sg.nation ?? null,
          hasWikipedia: !!sg.hasWikipedia, heritage: sg.heritage, heritageAvailable: !!sg.heritageAvailable,
          verdict: v.status, why: v.reason,
        };
      });
      const narrowedOnly = trace.some((t) => t.filedIn.some((k) => NARROWED.includes(k)))
        && !members.some((m) => elsewhere.has(m));
      places.push({ name: raw, cluster: root, records: members.length, members,
        liveHeld: narrowedOnly && !trace.some((t) => t.verdict === 'kept'), trace });
    }
  }

  // The stored side, read in ONE repeatable-read snapshot so a check or a
  // reconsideration writing meanwhile can never be half-seen (Codex). "Held" is
  // held back under one completed check now — the rows still carrying its id and
  // not surfaced, which is what apply acts on. A check running now rewrites those
  // rows as it goes, so while one runs the stored side cannot speak; a crashed run
  // older than the six hours `runningCheck` honours does not count.
  const stored = await withTransaction(async (c) => {
    await c.query('set transaction isolation level repeatable read, read only');
    const { rows: [running] } = await c.query(
      `select id from surfacing_checks where state = 'running' and started_at > now() - interval '6 hours' limit 1`);
    const { rows: [done] } = await c.query(
      `select id from surfacing_checks where state = 'done' ${checkId ? 'and id = $1' : ''}
        order by finished_at desc nulls last limit 1`, checkId ? [checkId] : []);
    if (running || !done) {
      return { readCheck: null, why: running ? 'a narrowing check is running now' : checkId ? 'that check did not complete' : 'no completed narrowing check to read' };
    }
    const heldBy = new Map();
    for (const [i, p] of places.entries()) {
      if (!p.members) continue;
      const { rows } = await c.query(
        `select distinct s.venue_ref from place_surfacing_members m
           join place_surfacing s on s.venue_ref = m.venue_ref and not s.surfaced
          where m.member_ref = any($1::text[]) and s.check_id = $2`, [p.members, done.id]);
      heldBy.set(i, rows.map((r) => r.venue_ref));
    }
    const { rows: snap } = await c.query(
      `select distinct m.member_ref as ref from place_surfacing_members m
         join place_surfacing s on s.venue_ref = m.venue_ref and not s.surfaced
        where s.check_id = $1`, [done.id]);
    return { readCheck: done.id, heldBy, snap: snap.map((r) => r.ref) };
  });

  const out = places.map(({ members, ...p }, i) => {
    if (!members) return p;
    if (!stored.readCheck) return { ...p, held: null, why: stored.why, heldBy: [] };
    const by = stored.heldBy.get(i) ?? [];
    return { ...p, held: by.length > 0, heldBy: by };
  });
  if (!stored.readCheck) return { checkId: null, why: stored.why, places: out, snapshotRecords: null, filedElsewhere: null, leakedExamples: [] };
  const leaked = await filedElsewhere(stored.snap);
  return { checkId: stored.readCheck, places: out, snapshotRecords: stored.snap.length, filedElsewhere: leaked.size, leakedExamples: [...leaked].slice(0, 10) };
}
