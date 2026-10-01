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
export const OPEN_STATES = ['pending', 'failed'];        // can be approved (run/re-run)
export const DECLINABLE = ['pending', 'failed', 'unknown']; // can be closed by declining
export const REVIEW_STATES = ['pending', 'failed', 'unknown']; // what the owner still needs to see

/**
 * Which calls an approval may name: a back-office write, never the approvals
 * endpoints themselves (so approving cannot drive approving). Returns the
 * parsed `{ method, path }`, or null when it is not an allowed shape.
 */
export function parseApprovalRequest(request) {
  // Strict by construction. The *path* is a canonical back-office path of a
  // safe charset only — no dots, no percent-encoding, no empty segments — so it
  // cannot be URL-normalised out of the allowlist at `fetch` time. A GET is
  // allowed too (Compare, Ranked and named demand are owner-gated paid reads),
  // and a bounded query string is preserved for replay — a query cannot change
  // the path (Codex, 1 Oct 2026).
  const m = /^(GET|POST|PUT|PATCH|DELETE) (\/api\/(?:admin|accounts)\/[A-Za-z0-9/_-]{1,200})(\?[A-Za-z0-9=&,.%:+_-]{0,500})?$/.exec(String(request || '').trim());
  if (!m) return null;
  const method = m[1];
  const path = m[2];
  const query = m[3] || '';
  if (path.includes('..') || path.includes('//')) return null;
  if (/\/approvals(\/|$)/i.test(path)) return null; // no approving an approval, any case
  return { method, path, query };
}

/**
 * The plain-English brief every request must carry (owner, 1 Oct 2026: "show,
 * in plain English, which chat asked, why, what will change, how many
 * places/records are affected, and the expected cost (£0 if free), above the
 * technical call. Reject filings that don't include these.").
 *
 *   chat        which chat is asking, as the owner would recognise it
 *   why         the reason, in a sentence
 *   change      what will be different once it has run
 *   affected    { count, unit } — a whole number ≥ 0 and what it counts
 *               ("places", "records", "owned points")
 *   costPence   the expected cost in whole pence, 0 when it is free
 *
 * Returns `{ brief }`, or `{ missing }` naming every part that is absent or
 * malformed, so one refusal tells the filer everything to fix. A count or a
 * cost is a number the filer has to state: an absent one is missing, never
 * read as nought. Kept in `numbers`, the column migration 314 set aside for
 * "what it would affect (places, cost, rows)" — no schema change.
 */
export function parseApprovalBrief(body) {
  const text = (v, max) => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s ? s.slice(0, max) : null;
  };
  const whole = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : null);
  const chat = text(body?.chat, 120);
  const why = text(body?.why, 600);
  const change = text(body?.change, 600);
  const count = whole(body?.affected?.count);
  const unit = text(body?.affected?.unit, 40);
  const costPence = whole(body?.costPence);
  const missing = [];
  if (!chat) missing.push('chat — which chat is asking');
  if (!why) missing.push('why — the reason, in a sentence');
  if (!change) missing.push('change — what will be different once it has run');
  if (count == null || !unit) missing.push('affected — { count: a whole number, unit: "places" | "records" | … }');
  if (costPence == null) missing.push('costPence — the expected cost in whole pence, 0 if free');
  if (missing.length) return { missing };
  return { brief: { chat, why, change, affected: { count, unit }, costPence } };
}

/**
 * The brief a stored request carries, checked the same way it was at filing, or
 * null. The decide route asks this before it runs anything, so a request filed
 * without one — before the rule, or by any other door — can be declined but
 * never approved (Codex, 1 Oct 2026).
 */
export const storedBrief = (numbers) => parseApprovalBrief(numbers?.brief).brief ?? null;

/** An agent files a request, with the fixed payload to replay. Returns the row. */
export async function fileApproval({ sessionId = null, label = null, request, description, numbers = null, brief = null, payload = null }) {
  const stored = brief ? { ...(numbers ?? {}), brief } : numbers;
  const { rows: [row] } = await query(
    `insert into approvals (session_id, requested_label, request, description, numbers, payload)
     values ($1, $2, $3, $4, $5, $6) returning *`,
    [sessionId, label, String(request).slice(0, 800), String(description).slice(0, 500),
      stored ? JSON.stringify(stored) : null, payload == null ? null : JSON.stringify(payload)],
  );
  return row;
}

/** The queue, newest first. `state` may be a single state, 'open' (pending+failed) or 'all'. */
export async function listApprovals({ state = 'open', limit = 100 } = {}) {
  const listStates = state === 'open' ? OPEN_STATES : state === 'review' ? REVIEW_STATES : null;
  const where = state === 'all' ? 'true'
    : listStates ? `a.state = any($1)`
    : `a.state = $1`;
  const param = listStates ?? state;
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
  // Pending/failed, and also an unknown run the owner has checked and wants to
  // close (G11). A re-run (startRun) is still open-states only.
  const { rows: [row] } = await query(
    `update approvals set state = 'declined', decided_by = $2, decided_at = now()
      where id = $1 and state = any($3) returning *`,
    [id, by ?? null, DECLINABLE],
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

/**
 * Record the outcome of a run. `done` (succeeded), `failed` (the server
 * answered with an error — re-approvable, since nothing happened) or `unknown`
 * (the call may have happened but the result was lost — NOT re-approvable, for
 * the owner to check by hand, so a non-idempotent purge/grant is not run twice;
 * Codex, 1 Oct 2026).
 */
/**
 * A run claimed but never finished — the process died between the claim and the
 * outcome — is left 'running', which is neither open nor done. After a grace
 * period it becomes 'unknown' (NOT re-approvable; the owner checks it by hand),
 * so a request can never vanish from the queue with no resolution (Codex, 1 Oct
 * 2026). Run at boot and periodically (server.js).
 */
export async function reconcileStaleRuns({ olderThanMinutes = 10 } = {}) {
  const { rowCount } = await query(
    `update approvals
        set state = 'unknown',
            result = coalesce(result, jsonb_build_object('ok', false, 'status', 0,
              'message', 'The run did not finish (the server restarted mid-run). Check before retrying.'))
      where state = 'running' and decided_at < now() - make_interval(mins => $1)`,
    [olderThanMinutes],
  );
  return rowCount;
}

export async function finishRun(id, { state, result }) {
  const { rows: [row] } = await query(
    `update approvals set state = $2, result = $3, ran_at = now()
      where id = $1 and state = 'running' returning *`,
    [id, state, result ? JSON.stringify(result) : null],
  );
  return row ?? null;
}
