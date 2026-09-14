/**
 * Places the labels could not settle.
 *
 * The owner, 14 Sep 2026: "where there are exceptions, they should be named,
 * and I should have lookups for 'not sure'… we'll be able to bulk say,
 * 'Anthropic, go look and find this, and get the answers.'"
 *
 * Of twelve real water parks, eight were settled by the words and four were
 * not: one was inside Thorpe Park, one was a lake, one was inflatables on a
 * reservoir. Those four go on this list with the reason, never quietly filed
 * wrong. A run reads a batch, comes back with a suggested primary label and the
 * sentence it relied on, and nothing is applied until he approves it.
 */

import { query } from '../db.js';

const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'bad_request' });

/** Put a place on the list, or update why it is there. */
export async function notSettled({ ref, name, address = null, words = [], wouldBe = null, reason }) {
  if (!ref) throw bad('Which place?');
  if (!reason) throw bad('Say why the labels did not settle it.');
  const { rows } = await query(
    `insert into not_sure (venue_ref, name, address, words, would_be, reason)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (venue_ref) do update
        set name = coalesce(excluded.name, not_sure.name),
            address = coalesce(excluded.address, not_sure.address),
            words = excluded.words, would_be = excluded.would_be,
            -- A place he has already settled stays settled: putting it back on
            -- the list would undo his decision (Codex, 14 Sep 2026).
            reason = case when not_sure.state in ('settled', 'dropped') then not_sure.reason else excluded.reason end,
            updated_at = case when not_sure.state in ('settled', 'dropped') then not_sure.updated_at else now() end
     returning *`,
    [String(ref), name ?? null, address, words.map(String), wouldBe, reason]);
  return rows[0];
}

/** The list, newest first, one state at a time. */
export async function list({ state = null, limit = 200 } = {}) {
  const { rows } = await query(
    `select * from not_sure
      ${state ? 'where state = $2' : ''}
      order by updated_at desc limit $1`,
    state ? [Math.min(500, limit), state] : [Math.min(500, limit)]);
  return rows;
}

export async function counts() {
  const { rows } = await query('select state, count(*)::int as n from not_sure group by state');
  return Object.fromEntries(rows.map((r) => [r.state, r.n]));
}

/** What a run came back with. Nothing is applied by this: he still decides. */
export async function answered(ref, { said, because, source, partOfName = null }) {
  const { rows } = await query(
    `update not_sure
        set state = 'answered', said = $2, because = $3, source = $4, part_of_name = $5,
            looked_at = now(), updated_at = now()
      -- Only something still waiting. A place already settled or dropped must
      -- not be dragged back onto the list (Codex, 14 Sep 2026).
      where venue_ref = $1 and state = 'waiting' returning *`,
    [String(ref), said ?? null, because ?? null, source ?? null, partOfName]);
  return rows[0] ?? null;
}

/** His decision. `as` of null drops it from the list without filing anything. */
export async function settle(ref, as, by) {
  const { rows } = await query(
    `update not_sure
        set state = $2, settled_as = $3, settled_by = $4, updated_at = now()
      where venue_ref = $1 returning *`,
    [String(ref), as ? 'settled' : 'dropped', as ?? null, by ?? null]);
  return rows[0] ?? null;
}

export async function startRun({ askedFor, by }) {
  const { rows } = await query(
    'insert into not_sure_runs (asked_for, by) values ($1, $2) returning *', [askedFor, by ?? null]);
  return rows[0];
}

export async function finishRun(id, { lookedAt, answered: n, costPence, note }) {
  const { rows } = await query(
    `update not_sure_runs
        set looked_at = $2, answered = $3, cost_pence = $4, note = $5, finished_at = now()
      where id = $1 returning *`,
    [id, lookedAt, n, costPence ?? null, note ?? null]);
  return rows[0] ?? null;
}

export async function runs(limit = 10) {
  const { rows } = await query(
    'select * from not_sure_runs order by started_at desc limit $1', [Math.min(50, limit)]);
  return rows;
}
