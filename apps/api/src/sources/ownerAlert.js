/**
 * Telling the owner by e-mail (Stripe brief, 3 Oct 2026: "report it to
 * Roger"; "Alert Roger by email"). The address is the owner account's own, not
 * a constant, so it follows the account. Each alert has a key and goes once:
 * the key is written to the hosting change log, and an alert already there is
 * not sent again. With no mail configured, or no owner account, it says so in
 * the server log and returns `{ sent: false, reason }` — never silently.
 */

import { query, withTransaction } from '../db.js';
import { mailConfigured, sendMail } from './mail.js';
import { logChange } from '../repositories/hostingSettings.js';

export async function ownerEmail() {
  const { rows: [a] } = await query(
    `select a.email from accounts a left join roles r on r.id = a.role_id
      where a.status = 'active' and a.email is not null and (a.role = 'owner' or r.is_owner)
      order by a.created_at limit 1`,
  );
  // A failed lookup throws rather than reading as "no owner": the caller's event is retried, not dropped.
  return a?.email ?? null;
}

/**
 * Send one alert, once per `key`. Checked and written down under a lock on the
 * key, in one transaction with the send: two deliveries of the same event at
 * once send one e-mail, and a send that fails leaves nothing recorded, so the
 * next delivery tries again (Codex, 3 Oct 2026). `subjectKind`/`subjectId` say
 * what it is about, for the change log.
 */
export async function alertOwner({ key, subject, text, subjectKind = 'host', subjectId }, { send = sendMail, configured = mailConfigured } = {}) {
  const to = await ownerEmail();
  if (!to || !configured()) {
    console.error(`epic-api: owner alert not sent (${!to ? 'no owner account' : 'mail not configured'}) — ${subject}`);
    return { sent: false, reason: !to ? 'no_owner' : 'no_mail' };
  }
  return withTransaction(async (c) => {
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [`owner-alert:${key}`]);
    const { rows: [seen] } = await c.query(`select 1 from hosting_changes where field = 'owner_alert' and after->>'key' = $1 limit 1`, [key]);
    if (seen) return { sent: false, reason: 'already_sent' };
    await logChange({ subjectKind, subjectId: String(subjectId), field: 'owner_alert', after: { key, subject }, byLabel: 'epic' }, c);
    await send({ to, subject, text, purpose: 'owner_alert' });
    return { sent: true };
  });
}
