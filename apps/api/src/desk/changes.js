/**
 * Changes: every change a person makes in the back office (handover 6.7).
 *
 * One row a change, written inside the same transaction as the change itself
 * wherever the caller has one, so a change that did not happen is never
 * logged and one that did never goes unlogged. Mapping and Defaults carry
 * their Why.
 */

import { query } from '../db.js';

// Messages and Automations: template edits and restores, and automation switches, locks and rules (K16, migration 374).
export const AREAS = ['Categories', 'Subcategories', 'Facts', 'Mapping', 'Defaults', 'Collections', 'Fact automations', 'Markets', 'Messages', 'Automations'];

const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'bad_request' });
const text = (v) => (v == null ? null : String(v));

/**
 * Write one change. `client` is the caller's transaction where there is one.
 * Returns the row's id, so a toast's Undo can name the change it undoes.
 */
export async function logChange({ client = null, who, area, what, before = null, after = null, why = null, subjectType = null, subjectId = null, undo = null }) {
  if (!who) throw bad('a change says who made it');
  if (!AREAS.includes(area)) throw bad(`${area} is not an area of the back office`);
  if (!what) throw bad('a change says what changed');
  const run = client ? (sql, args) => client.query(sql, args) : query;
  const { rows: [row] } = await run(
    `insert into bo_changes (who, area, what, before, after, why, subject_type, subject_id, undo)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) returning id, at`,
    [who, area, what, text(before), text(after), text(why)?.trim() || null, subjectType, text(subjectId),
      undo ? JSON.stringify(undo) : null]);
  return row;
}

/** Mark a change undone; the caller has already put the thing back. */
export async function markUndone({ client = null, id, who }) {
  const run = client ? (sql, args) => client.query(sql, args) : query;
  await run('update bo_changes set undone_at = now(), undone_by = $2 where id = $1 and undone_at is null', [id, who]);
}

/**
 * The log, newest first, filtered by area, person and a search over what,
 * before, after, why, who and area. The person list is alphabetical. Undone changes are kept and marked, never hidden: the
 * trail is of what people did, including taking something back.
 */
export async function changes({ area = null, who = null, q = null, limit = 200, offset = 0 } = {}) {
  const where = [];
  const args = [];
  if (area) { args.push(area); where.push(`area = $${args.length}`); }
  if (who) { args.push(who); where.push(`who = $${args.length}`); }
  if (q) {
    // A typed % or _ is a letter, not a wildcard (second audit CH.5); the
    // backslash is ilike's default escape, so it is escaped first.
    args.push(`%${String(q).trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    where.push(`(what ilike $${args.length} or before ilike $${args.length} or after ilike $${args.length} or why ilike $${args.length}
                 or who ilike $${args.length} or area ilike $${args.length})`);
  }
  const clause = where.length ? `where ${where.join(' and ')}` : '';
  args.push(Math.min(1000, Math.max(1, Number(limit) || 200)));
  args.push(Math.max(0, Number(offset) || 0));
  const [{ rows }, { rows: [{ n }] }, { rows: people }] = await Promise.all([
    query(`select id, at, who, area, what, before, after, why, subject_type, subject_id, undone_at, undone_by
             from bo_changes ${clause} order by at desc limit $${args.length - 1} offset $${args.length}`, args),
    query(`select count(*)::int n from bo_changes ${clause}`, args.slice(0, -2)),
    query('select who from bo_changes group by who order by lower(who), who'),
  ]);
  return { rows, total: n, people: people.map((p) => p.who), areas: AREAS };
}
