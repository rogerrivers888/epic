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

import { query } from '../db.js';

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

/** What the Runs board prints: the one going, and the last one that finished. */
export async function latest() {
  const { rows } = await query('select * from collect_runs order by started_at desc limit 1');
  const r = rows[0];
  if (!r) return null;
  const left = Object.values(r.todo ?? {}).reduce((n, list) => n + (Array.isArray(list) ? list.length : 0), 0);
  const asked = Object.values(r.done ?? {}).reduce((n, v) => n + (Number(v) || 0), 0);
  return {
    id: r.id, state: r.state, where: r.where_label, sources: r.sources ?? [],
    left, asked, spentPence: r.spent_pence, problem: r.problem,
    startedAt: r.started_at, touchedAt: r.touched_at, finishedAt: r.finished_at,
    stranded: r.state === 'running' && Date.now() - new Date(r.touched_at).getTime() > STRANDED_AFTER_MS,
  };
}
