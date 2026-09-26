/**
 * Every statement about `api_sessions`, and the only file that holds one.
 *
 * The estate's engineering standard is that all SQL lives in `repositories/`
 * and none anywhere else. Epic does not meet that yet — there are 360 query
 * sites across the routes — but the door is new code, so it starts in the right
 * place rather than adding to the pile the extraction will have to move.
 */

import crypto from 'node:crypto';
import { query } from '../db.js';

/** Only ever the hash. A stolen backup must not be a stolen session. */
const digest = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/** How stale `last_seen_at` may get before a read is worth a write. */
const SEEN_EVERY = '5 minutes';

export async function insertSession(token, label, accountId = null, kind = 'agent') {
  const { rows } = await query(
    `insert into api_sessions (token_hash, label, account_id, kind) values ($1, $2, $3, $4)
     returning id, label, account_id, kind, created_at, expires_at`,
    [digest(token), label || null, accountId, kind],
  );
  return rows[0];
}

/** The live session this token opens, or null. Never says which of the two it failed. */
export async function findLiveSession(token) {
  const { rows } = await query(
    `select id, label, account_id, kind, created_at, last_seen_at, expires_at
       from api_sessions
      where token_hash = $1 and revoked_at is null and expires_at > now()`,
    [digest(token)],
  );
  return rows[0] ?? null;
}

/**
 * The live agent sessions, newest first, with what each has spent today and
 * whether the owner has granted it hours (migration 264). For the back office.
 *
 * By default only the ones seen in the last 24 hours — hundreds of old
 * passcode sign-ins stay live for ninety days, and the owner asked for the
 * panel to hold the ones that matter now (26 Sep 2026) — plus any still
 * holding a grant, so a budget can always be taken away. `all` is everything,
 * and `total` says how many that is, so the link can say it.
 */
export async function liveAgentSessions({ all = false } = {}) {
  const LIVE = `s.kind = 'agent' and s.revoked_at is null and s.expires_at > now()`;
  const RECENT = `(coalesce(s.last_seen_at, s.created_at) >= now() - interval '24 hours' or s.paid_grant_until > now())`;
  const [{ rows }, { rows: [{ total }] }] = await Promise.all([
    query(
      `select s.id, s.label, s.created_at, s.last_seen_at, s.paid_grant_until,
              coalesce(sum(pc.estimated_cost_usd) filter (where pc.created_at >= now() - interval '24 hours'), 0)::float as spent_24h_usd
         from api_sessions s
         left join provider_calls pc on pc.session_id = s.id
        where ${LIVE} ${all ? '' : `and ${RECENT}`}
        group by s.id
        order by coalesce(s.last_seen_at, s.created_at) desc`,
    ),
    query(`select count(*)::int as total from api_sessions s where ${LIVE}`),
  ]);
  return { sessions: rows, total };
}

/** Give an agent session hours of paid budget, or take them away (hours = 0). */
export async function grantPaid(sessionId, hours) {
  const { rows } = await query(
    `update api_sessions
        set paid_grant_until = case when $2::int > 0 then now() + make_interval(hours => $2::int) else null end
      where id = $1 and kind = 'agent'
      returning id, label, paid_grant_until`,
    [sessionId, hours],
  );
  return rows[0] ?? null;
}

/**
 * Mark a session as used. Fire-and-forget and deliberately lazy: "when were you
 * last here" is a line on a settings card, not something worth a write on every
 * request the family makes.
 */
export function touchSession(id) {
  return query(
    `update api_sessions set last_seen_at = now()
      where id = $1 and last_seen_at < now() - interval '${SEEN_EVERY}'`,
    [id],
  ).catch(() => null);
}

export function revokeSession(token) {
  return query('update api_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null', [digest(token)]);
}

/**
 * Sign every device out — the answer to a passcode that has been shared too
 * widely. Given an account, only that account's devices: one customer signing
 * out everywhere must not sign the whole estate out.
 */
export function revokeAllSessions(accountId = null) {
  return query(
    `update api_sessions set revoked_at = now()
      where revoked_at is null and ($1::uuid is null or account_id = $1)`,
    [accountId],
  );
}

/**
 * The devices signed in, newest first, for Settings. Never the tokens.
 *
 * Scoped to one account once accounts exist: a customer's Settings screen shows
 * their own devices and has no way to learn that anybody else's exist. Passing
 * nothing keeps the old behaviour — every device — which is what the shared
 * passcode (the owner, no account row) still wants.
 */
export async function liveSessions(accountId = null) {
  const { rows } = await query(
    `select id, label, account_id, created_at, last_seen_at, expires_at
       from api_sessions
      where revoked_at is null and expires_at > now()
        and ($1::uuid is null or account_id = $1)
      order by last_seen_at desc`,
    [accountId],
  );
  return rows;
}

/**
 * Throw away what has already lapsed. A revoked or expired row is a hash and a
 * date and holds nothing about anybody, but it is not needed either.
 */
export function sweepDeadSessions() {
  // A session the ledger names is kept: it is the answer to "which session
  // spent this", the ledger's foreign key refuses the delete anyway, and one
  // refused row would have stopped the whole sweep (migration 256, 26 Sep
  // 2026). The service sessions are all born expired and would otherwise be
  // swept a month later with a month of attribution hanging off them.
  return query(
    `delete from api_sessions s
      where ((expires_at < now() - interval '30 days') or (revoked_at < now() - interval '30 days'))
        and token_hash not like 'service:%'
        and not exists (select 1 from provider_calls p where p.session_id = s.id)`);
}
