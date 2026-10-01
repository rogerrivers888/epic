/**
 * Failed sign-ins: written down, and counted over a short window so a handful
 * from one IP or against one account locks it out (signInGuard.js; owner, 1 Oct
 * 2026). The sign-in door is the one public door the launch gate leaves open, so
 * this is what keeps it from being a free guessing ground.
 */

import { query } from '../db.js';

/**
 * Drop failures older than the retention window, so the ledger cannot grow without
 * bound under sustained failed sign-ins (Codex, 1 Oct 2026). The lockout only ever
 * reads the last few minutes; the rest is a short audit tail. Swept on the hourly
 * pass (server.js). `EPIC_SIGNIN_FAILURE_RETENTION_DAYS` moves the window (default 30).
 */
export function sweepOldFailures(days = Number(process.env.EPIC_SIGNIN_FAILURE_RETENTION_DAYS) || 30) {
  const keep = Number.isFinite(days) && days > 0 ? days : 30;
  return query(`delete from sign_in_failures where at < now() - ($1 || ' days')::interval`, [String(keep)]);
}

/** One failure. Nothing here is a secret — never the passcode or the link. */
export async function recordFailure({ ip, contact, kind, reason }) {
  await query(
    'insert into sign_in_failures (ip, contact, kind, reason) values ($1, $2, $3, $4)',
    [ip ?? null, contact ?? null, kind, reason],
  );
}

/**
 * Failures in the window, counted **separately** for this IP and this account, so
 * a lockout trips only when one key on its own reaches the threshold — never by
 * adding unrelated counts together (Codex, 1 Oct 2026). Either key may be absent
 * (a wrong passcode has no contact); a null key counts zero, not every null row.
 */
export async function failureCounts({ ip = null, contact = null, since }) {
  const [byIp, byContact] = await Promise.all([countBy('ip', ip, since), countBy('contact', contact, since)]);
  return { byIp, byContact };
}

/**
 * One key's failures in the window, as a single indexed range. `column` is a
 * fixed literal ('ip' | 'contact'), never caller input, and each matches the
 * `(column, at)` index so the count stays cheap as the table grows — rather than
 * a full scan on `at` alone with the key hidden in a FILTER (Codex, 1 Oct 2026).
 */
async function countBy(column, value, since) {
  if (value == null) return 0;
  const { rows } = await query(
    `select count(*)::int as n from sign_in_failures where ${column === 'contact' ? 'contact' : 'ip'} = $1 and at >= $2`,
    [value, since],
  );
  return rows[0]?.n ?? 0;
}
