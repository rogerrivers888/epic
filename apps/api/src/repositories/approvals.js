/**
 * The Approvals queue: an agent asks, the owner approves, and the recorded
 * action runs (G11, owner 1 Oct 2026).
 *
 * An agent session cannot perform a privileged action, so it files a request —
 * the exact call, its fixed payload, a line of description, the numbers
 * affected. The owner, personally signed in, approves or declines
 * (routes/admin.js). On approval the server replays exactly that call under the
 * owner's elevated identity — the payload is fixed at filing, so what the owner
 * approved is what runs — and keeps the result. A failed run is left
 * re-approvable.
 */

import { query } from '../db.js';

/** States a request can still be acted on from. */
export const OPEN_STATES = ['pending', 'failed'];

/**
 * Which calls an approval may name: a back-office write, never the approvals
 * endpoints themselves (so approving cannot drive approving). Returns the
 * parsed `{ method, path }`, or null when it is not an allowed shape.
 */
export function parseApprovalRequest(request) {
  const m = /^(POST|PUT|PATCH|DELETE)\s+(\/[^\s?]+)$/.exec(String(request || '').trim());
  if (!m) return null;
  const method = m[1];
  const path = m[2];
  if (!(path.startsWith('/api/admin/') || path.startsWith('/api/accounts/'))) return null;
  if (/\/approvals(\/|$)/.test(path)) return null; // no approving an approval
  return { method, path };
}

/** An agent files a request, with the fixed payload to replay. Returns the row. */
export async function fileApproval({ sessionId = null, label = null, request, description, numbers = null, payload = null }) {
  const { rows: [row] } = await query(
    `insert into approvals (session_id, requested_label, request, description, numbers, payload)
     values ($1, $2, $3, $4, $5, $6) returning *`,
    [sessionId, label, String(request).slice(0, 200), String(description).slice(0, 500),
      numbers ? JSON.stringify(numbers) : null, payload == null ? null : JSON.stringify(payload)],
  );
  return row;
}

/** The queue, newest first. `state` may be a single state, 'open' (pending+failed) or 'all'. */
export async function listApprovals({ state = 'open', limit = 100 } = {}) {
  const where = state === 'all' ? 'true'
    : state === 'open' ? `a.state = any($1)`
    : `a.state = $1`;
  const param = state === 'open' ? OPEN_STATES : state;
  const { rows } = await query(
    `select a.*, s.label as session_label
       from approvals a left join api_sessions s on s.id = a.session_id
      where ${where}
      order by a.created_at desc limit ${state === 'all' ? '$1' : '$2'}`,
    state === 'all' ? [limit] : [param, limit],
  );
  return rows;
}

/** Decline an open request. Returns the row, or null if it was not open. */
export async function declineApproval(id, { by }) {
  const { rows: [row] } = await query(
    `update approvals set state = 'declined', decided_by = $2, decided_at = now()
      where id = $1 and state = any($3) returning *`,
    [id, by ?? null, OPEN_STATES],
  );
  return row ?? null;
}

/**
 * Claim an open request to run it, atomically — `state = any(OPEN)` in the
 * WHERE means two approvals of the same request cannot both start. Records who
 * approved it. Returns the row to run, or null if it was not open.
 */
export async function startRun(id, { by }) {
  const { rows: [row] } = await query(
    `update approvals set state = 'running', decided_by = $2, decided_at = now(), result = null
      where id = $1 and state = any($3) returning *`,
    [id, by ?? null, OPEN_STATES],
  );
  return row ?? null;
}

/** Record the outcome of a run: `ok` to 'done', otherwise 'failed' (re-approvable). */
export async function finishRun(id, { ok, result }) {
  const { rows: [row] } = await query(
    `update approvals set state = $2, result = $3, ran_at = now()
      where id = $1 and state = 'running' returning *`,
    [id, ok ? 'done' : 'failed', result ? JSON.stringify(result) : null],
  );
  return row ?? null;
}
