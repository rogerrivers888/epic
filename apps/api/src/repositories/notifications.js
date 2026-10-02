/**
 * Notifications (hosting v4 handover §8): one row per thing a guest or a host
 * should hear about, each linking to the screen it is about.
 *
 *   · `dedupe_key` makes a notification once-only, however many times a job
 *     runs over the same booking or session — the second insert is a no-op.
 *   · An e-mail is queued with the row and sent by `drainEmail()`, which
 *     claims each row before it sends, so two processes never send it twice.
 *     A send that cannot go (mail not set up, no address) is marked `skipped`
 *     with the in-app row still there; it is never retried in a loop.
 *   · A notification the host turned off in their preferences is still
 *     written (it is the record of what happened) but not e-mailed.
 */

import { query } from '../db.js';
import { mailConfigured, sendMail } from '../sources/mail.js';

/** The kinds, who they are for, and whether they e-mail by default. Add, never rename. */
export const KINDS = Object.freeze({
  // guests
  booking_confirmed: { audience: 'guest', email: true },
  ask_to_book_accepted: { audience: 'guest', email: true },
  ask_to_book_declined: { audience: 'guest', email: true },
  decides_by_result: { audience: 'guest', email: true },
  reminder_24h: { audience: 'guest', email: true },
  date_changed: { audience: 'guest', email: true },
  cancelled: { audience: 'guest', email: true },
  called_off: { audience: 'guest', email: true },
  refund_issued: { audience: 'guest', email: true },
  guest_message: { audience: 'guest', email: false },
  waitlist_offered: { audience: 'guest', email: true },
  after_event: { audience: 'guest', email: true },
  event_changed: { audience: 'guest', email: false },
  // hosts
  new_booking: { audience: 'host', email: true },
  ask_to_book_request: { audience: 'host', email: true },
  host_question: { audience: 'host', email: false },
  under_minimum: { audience: 'host', email: true },
  review_changes_requested: { audience: 'host', email: true },
  check_expiring: { audience: 'host', email: true },
  payout_sent: { audience: 'host', email: true },
  payout_held: { audience: 'host', email: true },
  new_review: { audience: 'host', email: false },
  new_tip: { audience: 'host', email: false },
  event_called_off: { audience: 'host', email: true },
});

/**
 * Write one. `householdId` or `accountId` (or both) names who it is for.
 * Returns the row, or null when the dedupe key says it was already written.
 */
export async function notify({ householdId = null, accountId = null, kind, title, body = null, link = null, dedupeKey = null, email = null, prefs = null }) {
  const k = KINDS[kind];
  if (!k) throw new Error(`unknown notification kind: ${kind}`);
  if (!householdId && !accountId) throw new Error('a notification needs a household or an account');
  if (link != null && !/^\/[A-Za-z0-9/_?=&.%:-]*$/.test(link)) throw new Error('a notification link is an app path');
  const wantsEmail = (email ?? k.email) && prefs?.[kind] !== false;
  const { rows: [row] } = await query(
    `insert into notifications (household_id, account_id, audience, kind, title, body, link, dedupe_key, email_state)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (dedupe_key) where dedupe_key is not null do nothing
     returning *`,
    [householdId, accountId, k.audience, kind, String(title).slice(0, 200), body == null ? null : String(body).slice(0, 2000), link, dedupeKey, wantsEmail ? 'queued' : 'none'],
  );
  return row ?? null;
}

/** A household's notifications, newest first, with the unread count. */
export async function forHousehold(householdId, { limit = 50, audience = null } = {}) {
  const lim = Math.min(Math.max(1, Number(limit) || 50), 200);
  const { rows } = await query(
    `select id, audience, kind, title, body, link, read_at, created_at
       from notifications
      where household_id = $1 and ($2::text is null or audience = $2)
      order by created_at desc limit $3`,
    [householdId, audience, lim],
  );
  const { rows: [{ n }] } = await query(
    `select count(*)::int as n from notifications where household_id = $1 and read_at is null and ($2::text is null or audience = $2)`,
    [householdId, audience],
  );
  return { rows, unread: n, capped: rows.length === lim };
}

/** Mark read: one, or every one of the household's. Only the household's own. */
export async function markRead(householdId, id = null) {
  const { rowCount } = await query(
    `update notifications set read_at = now()
      where household_id = $1 and read_at is null and ($2::uuid is null or id = $2)`,
    [householdId, id],
  );
  return rowCount;
}

/** Where an e-mail for this row goes: its account, else the household's first account. */
async function addressOf(row) {
  const { rows: [a] } = await query(
    `select email from accounts
      where ($1::uuid is not null and id = $1) or ($1::uuid is null and household_id = $2)
      order by created_at limit 1`,
    [row.account_id, row.household_id],
  );
  return a?.email ?? null;
}

const appUrl = () => (process.env.EPIC_APP_URL || process.env.APP_URL || 'https://epic.day').replace(/\/$/, '');

/**
 * Send what is queued, oldest first, a batch at a time. Each row is claimed
 * (`queued` → `sent` in one update) before the send, so a second drain never
 * picks it up; a failed send is marked `failed` and not retried here.
 */
export async function drainEmail({ batch = 20, send = sendMail, configured = mailConfigured } = {}) {
  if (!configured()) {
    const { rowCount } = await query(`update notifications set email_state = 'skipped' where email_state = 'queued' and created_at < now() - interval '1 day'`);
    return { sent: 0, failed: 0, skipped: rowCount };
  }
  const { rows } = await query(
    `update notifications set email_state = 'sent'
      where id in (select id from notifications where email_state = 'queued' order by created_at limit $1 for update skip locked)
      returning *`,
    [batch],
  );
  let sent = 0; let failed = 0; let skipped = 0;
  for (const row of rows) {
    const to = await addressOf(row).catch(() => null);
    if (!to) { skipped += 1; await query(`update notifications set email_state = 'skipped' where id = $1`, [row.id]); continue; }
    const text = [row.body, row.link ? `${appUrl()}${row.link}` : null].filter(Boolean).join('\n\n');
    const r = await send({ to, subject: row.title, text: text || row.title, purpose: `notify_${row.kind}` }).catch((e) => ({ sent: false, message: e.message }));
    if (r?.sent) sent += 1;
    else { failed += 1; await query(`update notifications set email_state = 'failed' where id = $1`, [row.id]); }
  }
  return { sent, failed, skipped };
}
