/**
 * A collection run, written down so it survives the process that started it.
 *
 * Collect answers the request at once and then works through a list of places,
 * asking each source in turn. That used to happen in a detached promise, which
 * meant a deploy in the middle lost the rest of the list without anybody being
 * told — and because nothing recorded that a run had been going, the Runs board
 * could not say so either (Codex, 17 Sep 2026).
 *
 * The list lives in the row. A place leaves its list once it has been asked, so
 * a resumed run never pays twice for the same place, and what is left is always
 * readable by anything that wants to report on it.
 */

import { query, withTransaction } from '../db.js';

/** How long a run may go untouched before it is treated as stranded. */
export const STRANDED_AFTER_MS = 10 * 60_000;

/** How many places one chunk asks about before the row is written again. */
export const CHUNK = 10;

export async function start({ whereLabel, scope, sources, todo, householdId = null, startedBy = null }) {
  const { rows } = await query(
    `insert into collect_runs (where_label, scope, sources, todo, done, household_id, started_by)
     values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [whereLabel ?? null, JSON.stringify(scope ?? {}), JSON.stringify(sources ?? []),
      JSON.stringify(todo ?? {}), JSON.stringify({ free: 0, google: 0, tripadvisor: 0 }), householdId, startedBy]);
  return rows[0];
}

/**
 * Is another run already going to ask about any of these?
 *
 * Two people pressing Collect at once — or one person twice — built the same
 * plan and started two runs with the same list, and each paid for the same
 * calls (Codex, 17 Sep 2026). The per-chunk claim bounds the *total* spend; it
 * cannot tell that the money is being spent twice on one place.
 *
 * Read across `todo` and `asking`, because a place in flight is as much
 * somebody else's work as one still queued.
 */
export async function alreadyGoing(refs = []) {
  if (!refs.length) return [];
  const { rows } = await query(
    `select r.id, r.where_label, r.started_by, r.started_at,
            array_agg(distinct v) as refs
       from collect_runs r
       cross join lateral (
         -- Both objects, expanded separately. Merged with the concatenation
         -- operator the right-hand side wins on a shared key, so asking.google
         -- replaced the whole of todo.google and a second run overlapping a
         -- *queued* ref outside the current chunk saw no clash (Codex, 17 Sep
         -- 2026).
         select value as v
           from jsonb_each(r.todo) as lists(key, list),
                jsonb_array_elements_text(lists.list) as items(value)
         union all
         select value
           from jsonb_each(r.asking) as lists(key, list),
                jsonb_array_elements_text(lists.list) as items(value)
       ) as theirs
      where r.state = 'running' and theirs.v = any($1::text[])
      group by r.id, r.where_label, r.started_by, r.started_at`, [refs]);
  return rows;
}

/**
 * Start a run, unless another is already asking about any of these.
 *
 * The check and the insert in one transaction, under one advisory lock. Done
 * separately, two requests arriving together both checked, both found nothing,
 * and both inserted — which is the exact double-spend the check exists to stop
 * (Codex, 17 Sep 2026). The lock is transaction-scoped, so it is released by
 * the commit whatever happens.
 */
export async function startIfClear({ refs, ...run }) {
  return withTransaction(async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtext($1))', ['epic.collect.start']);
    const { rows: clash } = await client.query(
      `select r.id, r.where_label, r.started_by, r.started_at
         from collect_runs r
         cross join lateral (
           select value as v
             from jsonb_each(r.todo) as lists(key, list),
                  jsonb_array_elements_text(lists.list) as items(value)
           union all
           select value
             from jsonb_each(r.asking) as lists(key, list),
                  jsonb_array_elements_text(lists.list) as items(value)
         ) as theirs
        where r.state = 'running' and theirs.v = any($1::text[])
        group by r.id, r.where_label, r.started_by, r.started_at
        limit 1`, [refs ?? []]);
    if (clash.length) return { clash: clash[0], run: null };
    const { rows } = await client.query(
      `insert into collect_runs (where_label, scope, sources, todo, done, household_id, started_by)
       values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [run.whereLabel ?? null, JSON.stringify(run.scope ?? {}), JSON.stringify(run.sources ?? []),
        JSON.stringify(run.todo ?? {}), JSON.stringify({ free: 0, google: 0, tripadvisor: 0 }),
        run.householdId ?? null, run.startedBy ?? null]);
    return { clash: null, run: rows[0] };
  });
}

export async function one(id) {
  const { rows } = await query('select * from collect_runs where id = $1', [id]);
  return rows[0] ?? null;
}

/**
 * A chunk is finished: take those places off the list and say what it cost.
 *
 * Written as one statement so a run that dies between the asking and the
 * recording loses at most one chunk, and never records work it did not do.
 */
export async function advance(id, source, refs, { done = 0, spentPence = 0, refused = [] } = {}) {
  const { rows } = await query(
    `update collect_runs
        set todo = jsonb_set(todo, array[$2::text],
                    coalesce((select jsonb_agg(v) from jsonb_array_elements_text(todo->$2::text) as t(v)
                               where v <> all($3::text[])), '[]'::jsonb)),
            done = jsonb_set(done, array[$2::text],
                    to_jsonb(coalesce((done->>$2::text)::int, 0) + $4::int)),
            refused = refused || $5::jsonb,
            spent_pence = spent_pence + $6::int,
            touched_at = now()
      where id = $1 returning *`,
    [id, source, refs, done, JSON.stringify(refused), spentPence]);
  return rows[0] ?? null;
}

/**
 * Take a chunk off the list *before* the calls go out.
 *
 * The worker used to take it off afterwards, so a deploy between the calls and
 * the write left every one of those places on `todo` and the resumed run paid
 * for them all again (Codex, 17 Sep 2026). They move to `asking` first: still
 * on the row, so nothing is lost, and no longer on the list, so nothing is
 * asked twice.
 */
export async function claim(id, source, refs) {
  const { rows } = await query(
    `update collect_runs
        set todo = jsonb_set(todo, array[$2::text],
                    coalesce((select jsonb_agg(v) from jsonb_array_elements_text(todo->$2::text) as t(v)
                               where v <> all($3::text[])), '[]'::jsonb)),
            asking = jsonb_set(asking, array[$2::text], to_jsonb($3::text[])),
            touched_at = now()
      where id = $1 returning *`, [id, source, refs]);
  return rows[0] ?? null;
}

/** The chunk came back. What is in hand is recorded and the claim let go. */
export async function done(id, source, { done: n = 0, spentPence = 0, refused = [] } = {}) {
  const { rows } = await query(
    `update collect_runs
        set asking = jsonb_set(asking, array[$2::text], '[]'::jsonb),
            done = jsonb_set(done, array[$2::text],
                    to_jsonb(coalesce((done->>$2::text)::int, 0) + $3::int)),
            refused = refused || $4::jsonb,
            spent_pence = spent_pence + $5::int,
            touched_at = now()
      where id = $1 returning *`,
    [id, source, n, JSON.stringify(refused), spentPence]);
  return rows[0] ?? null;
}

/**
 * A chunk that was in flight when something stopped.
 *
 * We cannot know whether those calls were billed, and the safe direction is not
 * to pay twice: a place we did not ask about is a gap somebody can see on the
 * board, and a place we paid for twice is invisible. So they are recorded as
 * refused, with the reason, and the run carries on.
 */
export async function abandonInFlight(id) {
  const run = await one(id);
  if (!run) return null;
  const stuck = Object.entries(run.asking ?? {}).flatMap(([source, refs]) =>
    (Array.isArray(refs) ? refs : []).map((ref) => ({ ref, why: `interrupted while asking ${source}; not asked again, to avoid paying twice` })));
  if (!stuck.length) return run;
  const { rows } = await query(
    `update collect_runs
        set asking = '{}'::jsonb, refused = refused || $2::jsonb, touched_at = now()
      where id = $1 returning *`, [id, JSON.stringify(stuck)]);
  return rows[0] ?? null;
}

export async function finish(id) {
  const { rows } = await query(
    `update collect_runs set state = 'done', finished_at = now(), touched_at = now()
      where id = $1 and state = 'running' returning *`, [id]);
  return rows[0] ?? null;
}

export async function fail(id, problem) {
  const { rows } = await query(
    `update collect_runs set state = 'failed', problem = $2, finished_at = now(), touched_at = now()
      where id = $1 and state = 'running' returning *`, [id, String(problem ?? '').slice(0, 500)]);
  return rows[0] ?? null;
}

/**
 * Runs that were going and have not been touched since — a deploy, usually.
 *
 * Read-only, for a board that wants to say so.
 */
export async function stranded() {
  const { rows } = await query(
    `select * from collect_runs
      where state = 'running' and touched_at < now() - ($1 || ' milliseconds')::interval
      order by started_at`, [String(STRANDED_AFTER_MS)]);
  return rows;
}

/**
 * The same, claimed — one statement, so only one process gets them.
 *
 * Two API instances booting together both read the same stranded run and both
 * started a worker on it, and each would have made the same paid calls before
 * either wrote `todo` back (Codex, 17 Sep 2026). Moving `touched_at` inside the
 * statement that selects them is the claim: the second instance's predicate no
 * longer matches, so it finds nothing and starts nothing.
 */
export async function claimStranded() {
  const { rows } = await query(
    `update collect_runs set touched_at = now()
      where id in (
        select id from collect_runs
         where state = 'running' and touched_at < now() - ($1 || ' milliseconds')::interval
         order by started_at
         for update skip locked)
      returning *`, [String(STRANDED_AFTER_MS)]);
  return rows;
}

/**
 * What the Runs board prints: whatever is going, and the last one that finished.
 *
 * The row is the newest run, whatever state it is in: a failed one has to stay
 * on the board until somebody looks at it, which is the whole point of the
 * failed state.
 *
 * But two collections over disjoint sets of places are allowed at once
 * (`startIfClear`), and reading that one row alone hid the other — a worker
 * still going, and still spending, was not on the board and "needs looking at"
 * did not count it (Codex, 18 Sep 2026). So the others are counted beside it,
 * and the headline figures are the truth even where the row draws one.
 */
export async function latest() {
  const { rows } = await query('select * from collect_runs order by started_at desc limit 1');
  const r = rows[0];
  if (!r) return null;
  // How many others are going beside this one, so the board's count is the
  // truth even where it draws one.
  const { rows: [more] } = await query(
    `select count(*)::int as n,
            count(*) filter (where touched_at < now() - ($1 || ' milliseconds')::interval)::int as stranded
       from collect_runs where state = 'running' and id <> $2`, [String(STRANDED_AFTER_MS), r.id]);
  const count = (o) => Object.values(o ?? {}).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
  // What is still to do, and what it is asking about right now.
  const left = count(r.todo) + count(r.asking);
  const asked = Object.values(r.done ?? {}).reduce((n, v) => n + (Number(v) || 0), 0);
  return {
    id: r.id, state: r.state, where: r.where_label, sources: r.sources ?? [],
    left, asking: count(r.asking), asked, spentPence: r.spent_pence, problem: r.problem,
    startedAt: r.started_at, touchedAt: r.touched_at, finishedAt: r.finished_at,
    stranded: r.state === 'running' && Date.now() - new Date(r.touched_at).getTime() > STRANDED_AFTER_MS,
    // The others, if a second collection is going over a different set of
    // places. Nought nearly always, and never a surprise when it is not.
    alsoRunning: more?.n ?? 0,
    alsoStranded: more?.stranded ?? 0,
  };
}
