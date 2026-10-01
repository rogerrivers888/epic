/**
 * The Approvals queue: an agent asks, the owner decides (G11, 1 Oct 2026).
 *
 * An agent session cannot perform a privileged action, so it files a request
 * for one — the exact call, a line of description, the numbers affected. The
 * owner, personally signed in, approves or declines (routes/admin.js), and an
 * approved request lets that one call through once for the session that filed
 * it (access.js `requireOwnerSignedIn`).
 */

import { query } from '../db.js';

/** The call an approval unlocks, as the gate sees it: method and path, no query. */
export const requestKey = (req) => `${req.method} ${String(req.originalUrl || req.url || '').split('?')[0]}`;

/** An agent files a request. Returns the row. */
export async function fileApproval({ sessionId = null, label = null, request, description, numbers = null }) {
  const { rows: [row] } = await query(
    `insert into approvals (session_id, requested_label, request, description, numbers)
     values ($1, $2, $3, $4, $5) returning *`,
    [sessionId, label, String(request).slice(0, 200), String(description).slice(0, 500), numbers ? JSON.stringify(numbers) : null],
  );
  return row;
}

/** The queue, newest first — pending by default, or a given state. */
export async function listApprovals({ state = 'pending', limit = 100 } = {}) {
  const { rows } = await query(
    `select a.*, s.label as session_label
       from approvals a left join api_sessions s on s.id = a.session_id
      where ($1::text is null or a.state = $1)
      order by a.created_at desc limit $2`,
    [state === 'all' ? null : state, limit],
  );
  return rows;
}

/** The owner's decision. Only a pending request can be decided. Returns the row, or null. */
export async function decideApproval(id, { state, by }) {
  if (!['approved', 'declined'].includes(state)) throw Object.assign(new Error('decision must be approved or declined'), { status: 400 });
  const { rows: [row] } = await query(
    `update approvals set state = $2, decided_by = $3, decided_at = now()
      where id = $1 and state = 'pending' returning *`,
    [id, state, by ?? null],
  );
  return row ?? null;
}

/**
 * Spend an approved request, once, for the session that filed it.
 *
 * The update is the check: `state = 'approved'` in the WHERE means two requests
 * racing on one approval cannot both consume it. Returns true when one was
 * spent, so the gate lets exactly one matching call through.
 */
export async function consumeApproval(sessionId, request) {
  if (!sessionId) return false;
  const { rows } = await query(
    `update approvals set state = 'consumed', consumed_at = now()
      where id = (
        select id from approvals
         where session_id = $1 and request = $2 and state = 'approved'
         order by decided_at limit 1
      ) returning id`,
    [sessionId, request],
  );
  return rows.length > 0;
}
