/**
 * Email + password (Website & Registration L1, L2, L4; 1 Oct 2026).
 *
 * The second of the two ways in the handoff gives customers and staff alike —
 * beside Log in with Google (authGoogle.js) — and the four verbs it needs:
 *
 *   POST /api/auth/login         L1: email + password → a session
 *   POST /api/auth/forgot        L2: "send me a reset link" — always 200
 *   GET  /api/auth/link/:token   L4: what an invite or reset link is for, unspent
 *   POST /api/auth/credentials   L4: set the password, spend the link, sign in
 *
 * All four answer without a session (auth.js PUBLIC) and through the launch gate
 * (siteGate.js SIGN_IN), because they are how a session is obtained. They are not
 * unguarded: each is held to the sign-in limit per caller (limits.js), and every
 * failure is written down and counted against the IP and the address it named,
 * so a run of guesses locks itself out and alerts the owner (signInGuard.js).
 *
 * A session opened here answers exactly as the magic-link and Google doors do —
 * one shape, `summariseAccess` from session.js — and is recorded as
 * `auth_method = 'password'`, which access.js counts as a personal sign-in: a
 * password is something only that person knows. Where they land (back office or
 * L3) is the client's to decide from `access`, by role, never by e-mail domain.
 */

import express from 'express';
import { withTransaction } from '../db.js';
import { closeSession, deployed, openSession, sessionCookie, sessionKindFor } from '../auth.js';
import { passwordEdgeLimit, passwordLimit, signInLimit } from '../limits.js';
import {
  accountByEmail, accountById, consumeSignInLink, createSignInLink, inspectSignInLink, linkContactFor,
  markLinkSent, normaliseEmail, passwordFor, recentLinkCount, recordSignIn, setPassword,
} from '../repositories/accounts.js';
import { revokeAllSessions } from '../repositories/sessions.js';
import { accessFor } from '../access.js';
import { signInLockedOut, noteSignInFailure } from '../signInGuard.js';
import { summariseAccess } from './session.js';
import { mailStatus, resetPasswordEmail, sendMail, webUrl } from '../sources/mail.js';
import { dummyHash, hashPassword, passwordProblem, verifyPassword } from '../passwords.js';

const router = express.Router();

// Far beyond any password a person types, and short enough that a megabyte body
// cannot be fed to the KDF. Not a rule the screen shows.
const MAX_PASSWORD = 1024;
// Thirty minutes (handoff L2). `ttlHours` is fractional.
const RESET_TTL_HOURS = 0.5;
// How many reset e-mails one account may be sent in an hour. The per-caller limit
// stops one address hammering the door; this stops many addresses taking turns to
// fill one person's inbox. "Send it again" is well inside it.
const RESETS_PER_HOUR = 5;

// Made now, not on the first failed log-in, so the first unknown address does not
// take a hash's time longer than the rest and give itself away.
dummyHash().catch(() => {});

/** Per-account queue for the reset ceiling: each call waits for the one before it. */
const resetQueues = new Map();
async function oneAtATime(key, work) {
  const before = resetQueues.get(key) ?? Promise.resolve();
  const run = before.catch(() => {}).then(work);
  resetQueues.set(key, run);
  try { return await run; } finally { if (resetQueues.get(key) === run) resetQueues.delete(key); }
}

const WRONG = { error: 'wrong_credentials', message: 'Wrong email or password.' };
const LOCKED = { error: 'locked_out', message: 'Too many attempts just now. Try again shortly.' };
const SPENT = { error: 'link_spent', message: 'That link does not work any more. Ask for a new one.' };

const labelOf = (req) => String(req.body?.label || '').slice(0, 80) || null;
const passwordOf = (value) => (typeof value === 'string' ? value : '');

/**
 * Where an e-mailed link points. `webUrl` falls back to the request's Origin when
 * nothing is configured, which is right for a developer and wrong for a door the
 * public can knock on: anybody could ask for a reset for somebody else with
 * `Origin: https://evil.example` and the victim would be mailed a link that hands
 * the token to that site. So deployed, the Origin is never read here — webUrl
 * then answers the configured site or the canonical one.
 */
const linkBase = (req) => webUrl(deployed() ? { headers: {} } : req);

/**
 * Record the sign-in, open a 'password' session, and answer as the link door does.
 *
 * `verified` is the stored hash a log-in was checked against. A reset can land
 * between that check and the session opening — the old password verified, then
 * every session revoked, then this one opened after — so once the session
 * exists the hash is read again, and if the password has changed under it the
 * session is closed and the log-in refused as any wrong password is (Codex,
 * 1 Oct 2026). With the reset revoking again *after* it sets the password, a
 * log-in on the old password cannot leave a session either side of it.
 */
export async function signIn(req, res, accountId, { verified = null, email = null } = {}) {
  const label = labelOf(req);
  const { token, session } = await openSession(label, accountId, sessionKindFor(req, label, { onAccount: true }), 'password');
  if (verified) {
    const now = await passwordFor(email);
    if (!now || now.hash !== verified || now.account.id !== accountId || now.account.status === 'suspended') {
      await closeSession(token);
      await noteSignInFailure(req, { kind: 'password', contact: email, reason: 'password_changed' });
      return res.status(401).json(WRONG);
    }
  }
  const account = await recordSignIn(accountId, { method: 'password', label });
  sessionCookie(res, token);
  const access = await accessFor({ account, session });
  return res.status(201).json({
    token,
    session: { id: session.id, label: session.label, since: session.created_at, until: session.expires_at },
    account: { id: account.id, email: account.email, name: account.name, role: account.role, plan: account.plan, trialEndsOn: account.trial_ends_on ?? null },
    isOwner: access.isOwner,
    access: summariseAccess(access),
  });
}

/**
 * POST /api/auth/login — L1.
 *
 * One answer for every way of failing: no such address, an account with no
 * password (Google only, or never set up), the wrong password, a suspended
 * account. "Email and password are wrong together, never separately" (handoff).
 * And one *time*: when there is no hash to check against, a throwaway hash is
 * checked instead, so an unknown address costs the same KDF run as a known one
 * and the response time cannot be used to find out who has an account.
 */
router.post('/auth/login', passwordEdgeLimit, passwordLimit, signInLimit, async (req, res, next) => {
  try {
    const email = normaliseEmail(req.body?.email);
    const password = passwordOf(req.body?.password);
    if (await signInLockedOut(req, email)) return res.status(429).json(LOCKED);

    const found = email ? await passwordFor(email) : null;
    const usable = found?.hash && found.account.status !== 'suspended' && password.length <= MAX_PASSWORD;
    // Always exactly one verify, real or dummy, whatever else is true.
    const matches = await verifyPassword(usable ? password : '', usable ? found.hash : await dummyHash());
    if (!usable || !matches) {
      const reason = !found ? 'no_account' : !found.hash ? 'no_password' : found.account.status === 'suspended' ? 'suspended' : 'wrong_password';
      await noteSignInFailure(req, { kind: 'password', contact: email, reason });
      return res.status(401).json(WRONG);
    }
    return signIn(req, res, found.account.id, { verified: found.hash, email });
  } catch (err) { next(err); }
});

/**
 * Mint a reset link and send it — or, with no sender configured, write it to the
 * log for the owner to pass on (handoff: "while no mail sender is set up, log the
 * link server-side"). The link row records which happened, as an invite's does.
 */
async function sendReset(req, account) {
  const { token, link } = await createSignInLink(account.id, { requestedBy: 'self', ttlHours: RESET_TTL_HOURS, purpose: 'reset' });
  const url = `${linkBase(req)}/in/${token}`;
  const mail = mailStatus();
  let delivery; let error = null;
  if (!mail.configured) {
    delivery = mail.reason || 'no_sender';
    error = mail.message;
    console.log(`epic-api: password reset for account ${account.id} — no mail sender, pass this on by hand: ${url}`);
  } else {
    const sent = await sendMail({ to: account.email, ...resetPasswordEmail({ url }), purpose: 'password_reset' });
    delivery = sent.sent ? 'email' : (sent.reason ?? 'send_failed');
    error = sent.sent ? null : (sent.message ?? null);
  }
  await markLinkSent(link.id, { delivery, error, channel: 'email' });
}

/**
 * POST /api/auth/forgot — L2. Always `200 { ok: true }`.
 *
 * It never says whether the address has an account, and an unknown address gets
 * no e-mail ("If … has an Epic account, a link … is on its way"). The lookup and
 * the send happen after the answer has gone, so the time it takes to answer is
 * the same for a stranger's address as for a customer's — a send to Postmark is
 * hundreds of milliseconds and would otherwise be the tell. Held to the sign-in
 * limit as a sending door (limits.js SENDING_DOORS), and to a handful of resets
 * per account an hour, so it cannot be used to fill somebody's inbox. A lockout
 * on the address is honoured silently: still 200, nothing sent.
 */
router.post('/auth/forgot', passwordEdgeLimit, passwordLimit, async (req, res) => {
  const email = normaliseEmail(req.body?.email);
  res.json({ ok: true });
  if (!email) return;
  try {
    if (await signInLockedOut(req, email)) return;
    const account = await accountByEmail(email);
    if (!account || account.status === 'suspended' || !account.email) return;
    // Counted and sent one at a time per account, so a burst of requests cannot
    // all read "under five" before any of them has written its link (Codex,
    // 1 Oct 2026). In-process: the API runs as one instance.
    await oneAtATime(account.id, async () => {
      if (await recentLinkCount(account.id, { purpose: 'reset', minutes: 60 }) >= RESETS_PER_HOUR) return;
      await sendReset(req, account);
    });
  } catch (err) {
    // The answer has gone; a failure here is the owner's to read, never the caller's.
    console.error('epic-api: password reset failed —', err.message);
  }
});

/**
 * GET /api/auth/link/:token — L4 draws itself from this.
 *
 * `{ mode: 'invite' | 'reset', email, firstName, expiresAt }` for a link that
 * would still be taken; 404 `link_spent` for anything else (used, expired,
 * cancelled by a newer one, a suspended account, or not an invite/reset link at
 * all). Looks only: the link is spent by the POST below, once a password has
 * been typed.
 */
router.get('/auth/link/:token', passwordEdgeLimit, passwordLimit, signInLimit, async (req, res, next) => {
  try {
    const link = await inspectSignInLink(String(req.params.token || '').trim());
    const account = link ? await accountById(link.account_id) : null;
    if (!link || !account) return res.status(404).json({ error: 'link_spent' });
    const firstName = String(account.name || '').trim().split(/\s+/)[0] || null;
    res.json({ mode: link.purpose, email: account.email, firstName, expiresAt: link.expires_at });
  } catch (err) { next(err); }
});

/**
 * POST /api/auth/credentials — L4: `{ token, password, label? }`.
 *
 * Too short is refused before anything is spent, so a typo costs nothing and the
 * link still works. Then the link is spent — only an invite or reset link is
 * taken here, never a magic link or a Google code (consumeSignInLink) — and:
 *
 *  - reset: every other session on the account is revoked *before* the password
 *    is changed and the new session opened ("revokes all other sessions"). In
 *    that order so a failure part-way leaves the account signed out and the old
 *    password in place, never a new password with the old sessions still live —
 *    the one outcome a reset after a compromise must not have.
 *  - invite: the password is set and `recordSignIn` turns invited into active.
 *
 * The password is hashed before the link is spent, so a hashing failure leaves
 * the link usable.
 */
router.post('/auth/credentials', passwordEdgeLimit, passwordLimit, signInLimit, async (req, res, next) => {
  try {
    const token = String(req.body?.token || '').trim();
    const password = passwordOf(req.body?.password);
    const problem = passwordProblem(password);
    if (problem) return res.status(400).json({ error: 'needs_letters_and_numbers', message: problem });
    if (password.length > MAX_PASSWORD) {
      return res.status(400).json({ error: 'too_long', message: 'That password is too long.' });
    }
    const who = await linkContactFor(token);
    if (await signInLockedOut(req, who)) return res.status(429).json(LOCKED);

    const hash = await hashPassword(password);
    // Spending the link, signing the other devices out and setting the password
    // stand or fall together: a failure part-way leaves the link usable, the
    // devices signed in and the old password in place, never a spent link with
    // nothing to show for it (Codex, 1 Oct 2026).
    const spent = token ? await withTransaction(async (db) => {
      const link = await consumeSignInLink(token, { purpose: 'credentials', db });
      if (!link) return null;
      if (link.purpose === 'reset') await revokeAllSessions(link.account_id, { db });
      await setPassword(link.account_id, hash, { db });
      return link;
    }) : null;
    if (!spent) {
      await noteSignInFailure(req, { kind: 'link', contact: who, reason: 'link_spent' });
      return res.status(401).json(SPENT);
    }
    // And again once it is committed: a log-in that verified the old password and
    // opened its session while the transaction was open is closed here, and one
    // opening later re-reads the hash and closes itself (signIn). Nothing on the
    // old password outlives the reset.
    if (spent.purpose === 'reset') await revokeAllSessions(spent.account_id);
    return signIn(req, res, spent.account_id);
  } catch (err) { next(err); }
});

export default router;
