/**
 * The hosting settings and the change log (hosting v4 handover §6, §7).
 *
 * The settings are read from the table when a rule needs them — `current()` —
 * with a short in-memory copy so a page of bookings does not ask the database
 * once a booking; a change refreshes it at once, and every process re-reads it
 * within `TTL_MS` of a change made by another one. The lanes' config is laid
 * over from the same read (domain/lanes.js `useSettingsOverlay`).
 *
 * A change is one transaction: the row, and a `hosting_changes` row with who,
 * when, before → after and why. The route in front of it is the owner's
 * personal sign-in (G7/G11), so an agent can only file it for approval.
 */

import { query, withTransaction } from '../db.js';
import { settingsMap } from '../domain/money.js';
import { checkSetting, configOverlay } from '../domain/hostingSettings.js';
import { useSettingsOverlay } from '../domain/lanes.js';

export const TTL_MS = 60_000;
let cache = null; // { at, rows, map }

function remember(rows) {
  const map = settingsMap(rows);
  cache = { at: Date.now(), rows, map };
  useSettingsOverlay(configOverlay(map));
  return cache;
}

/** Every setting row, in the order the back office shows them. */
export async function list() {
  const { rows } = await query(
    `select s.*, a.email as changed_by_email
       from hosting_settings s left join accounts a on a.id = s.changed_by
      order by s.position, s.key`,
  );
  remember(rows);
  return rows;
}

/**
 * The settings map in force (`settingsMap`): fresh from the table when the
 * copy is older than `TTL_MS`. If the table cannot be read, the last copy is
 * used; with no copy at all the error is the caller's — a fee is never worked
 * out from nothing.
 */
export async function current({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.map;
  try {
    await list();
  } catch (err) {
    if (!cache) throw err;
  }
  return cache.map;
}

/** Forget the copy (tests). */
export function forget() { cache = null; useSettingsOverlay(null); }

/**
 * Change one setting: its value, its switch, or both. `by` is the account,
 * `why` is required, `approvalId` names the approval it came from when it did.
 * Returns `{ row }` or `{ error, status }`.
 */
export async function change(key, { value, isOn }, { by = null, why, approvalId = null, ifLatest = null } = {}) {
  const reason = typeof why === 'string' ? why.trim().slice(0, 500) : '';
  if (!reason) return { status: 400, error: 'Say why this is changing.' };
  const out = await withTransaction(async (c) => {
    const { rows: [row] } = await c.query('select * from hosting_settings where key = $1 for update', [key]);
    if (!row) return { status: 404, error: 'There is no such setting.' };
    // An undo names the change it undoes, and is refused under the setting's own lock if anything came after it:
    // the check and the write are one step, so nothing can land between them (Codex, 3 Oct 2026).
    // Still the latest word means the setting holds exactly what that change set — read under the lock, so it holds
    // whatever order transactions' timestamps say (Codex, 3 Oct 2026).
    if (ifLatest) {
      const { rows: [ch] } = await c.query('select after from hosting_changes where id = $1', [ifLatest]);
      const after = ch?.after ?? null;
      const same = after && JSON.stringify(after.value) === JSON.stringify(row.value) && (after.is_on === undefined || after.is_on === row.is_on);
      if (!same) return { status: 409, error: 'It has been changed since. Undo the latest change first.' };
    }
    const ok = checkSetting(row, { value, isOn });
    if (!ok.ok) return { status: 400, error: ok.message };
    const next = {
      value: value === undefined ? row.value : value,
      is_on: isOn === undefined ? row.is_on : isOn,
    };
    if (JSON.stringify(next.value) === JSON.stringify(row.value) && next.is_on === row.is_on) return { status: 409, error: 'That is what it is already.' };
    const { rows: [updated] } = await c.query(
      `update hosting_settings
          set value = $2::jsonb, is_on = $3, changed_at = now(), changed_by = $4, approval_id = $5
        where key = $1 returning *`,
      [key, JSON.stringify(next.value), next.is_on, by, approvalId],
    );
    await logChange({
      subjectKind: 'setting', subjectId: key, field: 'value',
      before: { value: row.value, is_on: row.is_on }, after: next,
      why: reason, by, byLabel: 'staff', approvalId,
    }, c);
    return { row: updated };
  });
  if (out.row) await list();
  return out;
}

/**
 * One row of the change log. `client` joins the caller's transaction, so a
 * change and its record land together or not at all.
 */
export async function logChange({ subjectKind, subjectId, field = null, before = null, after = null, why = null, by = null, byLabel, approvalId = null }, client = null) {
  const q = client ? (t, p) => client.query(t, p) : query;
  const { rows: [row] } = await q(
    `insert into hosting_changes (subject_kind, subject_id, field, before, after, why, by_account, by_label, approval_id)
     values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9) returning *`,
    [subjectKind, String(subjectId), field, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after),
      why, by, byLabel, approvalId],
  );
  return row;
}

/** The change log, newest first; narrowed to one subject when asked. Capped: it says what it found, not what is absent. */
export async function changes({ subjectKind = null, subjectId = null, limit = 200 } = {}) {
  const lim = Math.min(Math.max(1, Number(limit) || 200), 1000);
  const { rows } = await query(
    `select h.*, a.email as by_email
       from hosting_changes h left join accounts a on a.id = h.by_account
      where ($1::text is null or h.subject_kind = $1) and ($2::text is null or h.subject_id = $2)
      order by h.at desc limit $3`,
    [subjectKind, subjectId == null ? null : String(subjectId), lim],
  );
  return { rows, limit: lim, capped: rows.length === lim };
}
