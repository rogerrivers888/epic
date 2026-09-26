/**
 * The one door every paid Google request passes: Places, photos and Routes.
 *
 * Owner, 26 Sep 2026 (G7): "call() in google.js and routing.js refuses any
 * paid tier with no household AND no real session. Only exemption: the IDs-only
 * census." The month's investigation found $166.78 of paid calls on no
 * household at all and $591.49 on no session anybody could name — the own.js
 * catch-up loop, benches and scripts run inside the production container, all
 * of it spent by nobody. A cap cannot refuse a caller it cannot see, so this
 * door refuses the caller who cannot be seen.
 *
 * A paid request goes out only when both are true:
 *
 *   · it is on a household's behalf — the request's account, or the household
 *     a background job entered the context with (context.js `runAsSpender`);
 *   · it belongs to a real session — a sign-in, not the server's own service
 *     session (providerCalls.js `serviceSessionId`), which is what every boot
 *     loop and every script run with `node` inside the container is written
 *     against.
 *
 * And then the household's monthly Google bound, which used to live in
 * google.js alone and never saw Routes.
 *
 * The IDs Only census is the one thing that passes without either: it is free,
 * and callers never reach this door for it (google.js asks only for a priced
 * tier).
 *
 * The dependencies load on first use, as google.js's always did: this file is
 * imported by adapters that tests load without a database.
 */

import { currentSpender } from '../context.js';
import { noteFault } from './meter.js';

export class UnattributedCallError extends Error {
  constructor(why) {
    super(`A paid provider call was refused: ${why}. Every paid call needs a household and a signed-in session.`);
    this.code = 'unattributed_paid_call';
    this.status = 403;
    this.why = why;
  }
}

let deps = null;
const load = () => (deps ??= Promise.all([import('../claude.js'), import('../repositories/providerCalls.js'), import('../db.js')])
  .then(([claude, ledger, db]) => ({
    monthlyBoundFor: claude.monthlyBoundFor, SpendBoundError: claude.SpendBoundError,
    countGoogleThisMonth: ledger.countGoogleThisMonth, query: db.query,
  })));

/**
 * Whether a session is somebody's live sign-in rather than the server's own.
 *
 * Live as well as real: a photo link outlives the request that signed it, and
 * a device signed out or a session expired must stop spending when it stops
 * signing in (Codex, 26 Sep 2026). Remembered for a minute, not for the
 * process, so a revocation takes effect within one. Fails closed — a lookup
 * that cannot be answered is not a real session.
 */
const LIVE_FOR_MS = 60_000;
const kinds = new Map();
export async function isRealSession(sessionId) {
  if (!sessionId) return false;
  const hit = kinds.get(sessionId);
  if (hit && Date.now() - hit.at < LIVE_FOR_MS) return hit.real;
  const { query } = await load();
  const { rows: [row] } = await query(
    `select token_hash not like 'service:%' and revoked_at is null and expires_at > now() as real
       from api_sessions where id = $1`,
    [sessionId],
  );
  const real = Boolean(row?.real);
  if (kinds.size > 5000) kinds.clear();
  kinds.set(sessionId, { real, at: Date.now() });
  return real;
}

/**
 * Requests this process has admitted this month that the ledger may not show
 * yet — the ledger row is written by the caller once the whole operation is
 * done, so a burst would otherwise read the same count and all be admitted
 * past the bound (Codex, 25 Sep 2026). The larger of the two is what the bound
 * is checked against.
 */
const admitted = new Map();
let admittedMonth = null;
const admittedFor = (householdId) => {
  const month = new Date().toISOString().slice(0, 7);
  if (admittedMonth !== month) { admitted.clear(); admittedMonth = month; }
  return admitted.get(householdId) ?? 0;
};

/**
 * Admit `requests` paid Google requests (a Routes matrix is one per element),
 * or throw. The refusal goes on the meter as well, so the ledger shows the
 * request that was not made.
 */
export async function admitPaid({ meter = null, requests = 1 } = {}) {
  const { householdId, sessionId } = currentSpender();
  if (!householdId) { noteFault(meter, 'unattributed'); throw new UnattributedCallError('no household'); }
  if (!(await isRealSession(sessionId).catch(() => false))) {
    noteFault(meter, 'unattributed');
    throw new UnattributedCallError(sessionId ? 'the server’s own session, not a sign-in' : 'no session');
  }
  // One admission at a time per household. Two requests arriving together —
  // the corridor's two matrices under one Promise.all — each read the same
  // count and were both admitted past the bound, and the second write took
  // the first's place rather than adding to it (Codex, 26 Sep 2026).
  await inTurn(householdId, async () => {
    const { countGoogleThisMonth, monthlyBoundFor, SpendBoundError } = await load();
    const [onLedger, bound] = await Promise.all([countGoogleThisMonth(householdId), monthlyBoundFor(householdId)]);
    const made = Math.max(onLedger, admittedFor(householdId));
    if (made + requests > bound) { noteFault(meter, 'household_cap'); throw new SpendBoundError('household', bound); }
    admitted.set(householdId, made + requests);
  });
}

const turns = new Map();
async function inTurn(key, fn) {
  const before = turns.get(key) ?? Promise.resolve();
  let done;
  const mine = new Promise((resolve) => { done = resolve; });
  const tail = before.then(() => mine);
  turns.set(key, tail);
  await before;
  try { return await fn(); } finally {
    done();
    if (turns.get(key) === tail) turns.delete(key);
  }
}
