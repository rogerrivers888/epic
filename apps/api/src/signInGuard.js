/**
 * The sign-in door's own guard (owner, 1 Oct 2026).
 *
 * The launch gate leaves the sign-in door open so native clients and the magic
 * link work without the gate password (siteGate.js). That door is therefore the
 * one place the public can knock, so it is hardened here rather than hidden:
 *
 *   · every failed attempt is written down (repositories/signInFailures.js);
 *   · a handful of failures from one IP — or against one account — inside a short
 *     window locks that IP/account out, on top of the coarse per-caller limit the
 *     door already carries (limits.js `signInLimit`);
 *   · the owner is alerted when a lockout trips.
 *
 * The counts are read from the table, not held in memory, so a deploy mid-attack
 * does not reset them. The thresholds move without a deploy:
 *   EPIC_SIGNIN_MAX_FAILURES     how many failures trip a lockout (default 5)
 *   EPIC_SIGNIN_LOCKOUT_MINUTES  the window, and how long the lockout lasts (default 15)
 */

import { recordFailure, failureCounts } from './repositories/signInFailures.js';
import { sendMail, mailConfigured } from './sources/mail.js';
import { contact as contactEmail } from './origins.js';

// A finite positive number, or the default — a non-numeric env value must not
// become NaN, which would 500 every sign-in (an invalid window) or silently
// disable the lockout (an invalid max) (Codex, 1 Oct 2026).
const posNum = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const MAX = posNum(process.env.EPIC_SIGNIN_MAX_FAILURES, 5);
const WINDOW_MIN = posNum(process.env.EPIC_SIGNIN_LOCKOUT_MINUTES, 15);
const windowStart = () => new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();

/**
 * The caller, by Express's configured trust-proxy chain (`req.ip`) — not a raw,
 * client-settable header like `CF-Connecting-IP`, which can be rotated to give
 * each attempt a fresh key and so evade the lockout and flood the table (Codex,
 * 1 Oct 2026). Behind Cloudflare this is the real client; the direct Railway
 * host must be fronted by Cloudflare only for it to stay trustworthy (deploy note).
 */
const keyFor = (req) => req.ip || req.socket?.remoteAddress || 'unknown';

// Once the threshold is crossed, the door is held shut for the full window even as
// the oldest failures age out of the count — the alert promises WINDOW_MIN, so it
// is WINDOW_MIN, not "until the burst decays" (Codex, 1 Oct 2026). In memory, so a
// deploy clears it; the count-based check re-locks an attacker who is still trying.
const lockedUntil = new Map();
const lockFor = (prefix, key) => { if (key) lockedUntil.set(`${prefix}:${key}`, Date.now() + WINDOW_MIN * 60_000); };
const stillLocked = (prefix, key) => {
  if (!key) return false;
  const until = lockedUntil.get(`${prefix}:${key}`);
  if (!until) return false;
  if (until <= Date.now()) { lockedUntil.delete(`${prefix}:${key}`); return false; }
  return true;
};
const pruneLocks = () => { const now = Date.now(); for (const [k, t] of lockedUntil) if (t <= now) lockedUntil.delete(k); };

/** Is this caller, or the account being named, currently locked out? */
export async function signInLockedOut(req, contact = null) {
  // Fail closed under a flood: once the global cap is hit, the door is shut for
  // everyone until the minute rolls, so an attacker cannot exhaust the cap with
  // throwaway keys and then guess freely (Codex, 1 Oct 2026).
  if (globalFloodActive()) return true;
  const ip = keyFor(req);
  // A held lockout first (full-duration); then the live count, which both triggers
  // and re-establishes the held lock — so a restart that cleared the in-memory set
  // does not let a still-over-threshold caller back in early.
  if (stillLocked('ip', ip) || stillLocked('account', contact)) return true;
  const { byIp, byContact } = await failureCounts({ ip, contact, since: windowStart() });
  if (byIp >= MAX) lockFor('ip', ip);
  if (byContact >= MAX) lockFor('account', contact);
  return byIp >= MAX || byContact >= MAX;
}

// Alert the owner at most once per window per IP/account, so a sustained attack
// is one message, not one a second. In memory on purpose: a reset on deploy can
// only cause an extra alert, never a missed one.
const lastAlert = new Map();

// `subject` is 'ip' or 'account' — the one that actually crossed the threshold,
// so the message names the right thing and the dedupe for an IP lockout never
// silences a later, separate account lockout (Codex, 1 Oct 2026).
async function alertLockout({ subject, key, n }) {
  const now = Date.now();
  // Drop entries whose dedupe window has passed, so a distributed or rotating-IP
  // flood cannot grow this map without bound until a restart (Codex, 1 Oct 2026).
  for (const [k, t] of lastAlert) if (now - t >= WINDOW_MIN * 60_000) lastAlert.delete(k);
  const dedupe = `${subject}:${key}`;
  const prev = lastAlert.get(dedupe);
  if (prev && now - prev < WINDOW_MIN * 60_000) return;
  lastAlert.set(dedupe, now);
  const who = subject === 'account' ? `account ${key}` : `IP ${key}`;
  console.error(`epic-api: sign-in lockout — ${n} failed attempt(s) against ${who} in ${WINDOW_MIN}m; locked out for ${WINDOW_MIN}m`);
  if (!mailConfigured()) return;
  await sendMail({
    to: contactEmail(),
    subject: 'Epic — sign-in lockout',
    text: `${n} failed sign-in attempt(s) against ${who} in the last ${WINDOW_MIN} minutes.\n`
      + `That ${subject} is now locked out of the sign-in door for ${WINDOW_MIN} minutes.\n\n`
      + `If this was not you, the passcode and accounts are unchanged — the attempts never got in.`,
    purpose: 'security-alert',
  }).catch((err) => console.error('epic-api: lockout alert mail failed —', err.message));
}

// A global backstop that does not depend on the proxy-derived IP: count every
// failure the process sees in a rolling minute, and once it passes the cap, close
// the door for everyone (globalFloodActive, checked in signInLockedOut) until the
// minute rolls. This both bounds the failure table's growth and — because the door
// then rejects attempts before they are counted — keeps a rotating-IP flood from
// exhausting the cap to disable the per-key lockout. The honest path, where
// failures are rare, never approaches the cap. The full closure for the forged-IP
// path is to keep the API reachable only through Cloudflare — see the deploy note.
const GLOBAL_FAILURES_PER_MIN = Math.max(MAX * 20, 100);
let failWindowAt = 0;
let failWindowCount = 0;
function recordGlobalFailure() {
  const now = Date.now();
  if (now - failWindowAt >= 60_000) { failWindowAt = now; failWindowCount = 0; }
  failWindowCount += 1;
}
function globalFloodActive() {
  return Date.now() - failWindowAt < 60_000 && failWindowCount >= GLOBAL_FAILURES_PER_MIN;
}

/**
 * Record a failed attempt and, if it trips the threshold, alert the owner.
 * Returns how many failures are now in the window.
 */
export async function noteSignInFailure(req, { kind, contact = null, reason }) {
  const ip = keyFor(req);
  // Writes are bounded not by dropping rows (which would blind the lockout) but by
  // the door closing at the cap, so a failure that reaches here is always recorded.
  recordGlobalFailure();
  await recordFailure({ ip, contact, kind, reason });
  const { byIp, byContact } = await failureCounts({ ip, contact, since: windowStart() });
  // Alert for each key that crossed on its own — an account lockout and an IP
  // lockout are different facts with different fixes — and hold each shut for the
  // full window.
  if (byContact >= MAX) { lockFor('account', contact); await alertLockout({ subject: 'account', key: contact, n: byContact }); }
  if (byIp >= MAX) { lockFor('ip', ip); await alertLockout({ subject: 'ip', key: ip, n: byIp }); }
  pruneLocks();
  return Math.max(byIp, byContact);
}

export const signInGuardConfig = () => ({ max: MAX, windowMinutes: WINDOW_MIN });
