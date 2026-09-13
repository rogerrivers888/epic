/** Every e-mail sent, and what Postmark said became of it (migration 090). */

import { query } from '../db.js';
import { applyEvent } from '../domain/mail.js';

export async function recordSend({ to, subject, purpose, providerId, status, failure }) {
  const { rows } = await query(
    `insert into mail_messages (to_address, subject, purpose, provider_id, status, failure) values ($1, $2, $3, $4, $5, $6) returning *`,
    [to, subject.slice(0, 300), purpose ?? 'message', providerId ?? null, status, failure ?? null],
  );
  return rows[0];
}

/**
 * What the sender answered, written onto the row that was made before the
 * send. Never lowers a status the webhook has already raised: a Delivery can
 * land before Postmark's own reply has been read (Codex, 13 Sep 2026).
 */
export async function finishSend(id, { providerId, status, failure }) {
  const { rows } = await query(
    `update mail_messages set provider_id = coalesce($2, provider_id), failure = coalesce($3, failure),
       status = case when status = 'sent' then $4 else status end
     where id = $1 returning *`,
    [id, providerId ?? null, failure ?? null, status],
  );
  return rows[0] ?? null;
}

/** What has happened to this address lately: the suppression check reads it. */
export async function recentTo(to, days = 90) {
  const { rows } = await query(`select id, status, bounced_at, failure from mail_messages where lower(to_address) = lower($1) and sent_at > now() - make_interval(days => $2) order by sent_at desc limit 20`, [to, days]);
  return rows;
}

/**
 * One webhook event, applied. Answers the message it landed on, or null when
 * the MessageID is not one of ours — a stream shared with another product, or
 * a test event from the Postmark console.
 */
export async function applyProviderEvent(event) {
  const providerId = String(event?.MessageID ?? '');
  // Our own id travels out as Postmark metadata and comes back on every event,
  // so an event that beats the send's reply home still finds its row.
  const own = String(event?.Metadata?.epic_id ?? '');
  const ownId = /^[0-9a-f-]{36}$/i.test(own) ? own : null;
  if (!providerId && !ownId) return null;
  const { rows } = await query(`select * from mail_messages where (provider_id = $1 and $1 <> '') or ($2::uuid is not null and id = $2::uuid) order by (provider_id = $1) desc limit 1`, [providerId, ownId]);
  const row = rows[0];
  if (!row) return null;
  const patch = applyEvent(row, event) ?? {};
  const sets = ['events = events || $2::jsonb'];
  const params = [row.id, JSON.stringify([{ ...event, receivedAt: new Date().toISOString() }])];
  if (!row.provider_id && providerId) { params.push(providerId); sets.push(`provider_id = $${params.length}`); }
  for (const [k, v] of Object.entries(patch)) { params.push(v); sets.push(`${k} = $${params.length}`); }
  const { rows: out } = await query(`update mail_messages set ${sets.join(', ')} where id = $1 returning *`, params);
  return out[0];
}

/** The back office's view: counts by status over a window, and the newest rows, optionally narrowed. */
export async function summary({ days = 30, status = null, limit = 200 } = {}) {
  const { rows: counts } = await query(`select status, count(*)::int as n from mail_messages where sent_at > now() - make_interval(days => $1) group by status`, [days]);
  const where = ['sent_at > now() - make_interval(days => $1)'];
  const params = [days];
  if (status === 'not_delivered') where.push(`status in ('bounced', 'soft_bounced', 'complained', 'failed')`);
  // Delivered is everything their server accepted, so an opened one is delivered too (Codex, 13 Sep 2026).
  else if (status === 'delivered') where.push(`status in ('delivered', 'opened')`);
  else if (status) { params.push(status); where.push(`status = $${params.length}`); }
  params.push(limit);
  const { rows } = await query(`select id, to_address, subject, purpose, provider_id, status, bounce_type, failure, sent_at, delivered_at, opened_at, bounced_at from mail_messages where ${where.join(' and ')} order by sent_at desc limit $${params.length}`, params);
  return { counts: Object.fromEntries(counts.map((c) => [c.status, c.n])), rows };
}
