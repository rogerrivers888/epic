/**
 * Signing in, and knowing whether you are.
 *
 * Deliberately small: three verbs on one path, and the only route file in the
 * API that answers without a session (auth.js `PUBLIC`).
 */

import express from 'express';
import {
  authConfigured, clearSessionCookie, closeSession, openSession, passcodeMatches, sessionKindFor, sessionCookie,
} from '../auth.js';
import { findLiveSession, liveSessions, revokeAllSessions, revokeSessionById, revokeOtherSessions } from '../repositories/sessions.js';
import {
  accountByContact, accountById, consumeSignInLink, linkContactFor, markLinkSent,
  ownerAccount, recordSignIn, replaceSignInLink,
} from '../repositories/accounts.js';
import { loginLinkEmail, mailStatus, sendMail, webUrl } from '../sources/mail.js';
import { sendSms, smsStatus } from '../sources/sms.js';
import { accessFor } from '../access.js';
import { signInLockedOut, noteSignInFailure } from '../signInGuard.js';
import { sessionBlockedByGate, siteGateOn } from '../siteGate.js';

const router = express.Router();

/**
 * The doors and capabilities behind a session.
 *
 * `requireSession` attaches these to every other request, but this route
 * answers *before* the door — it is how the app finds out whether it is inside
 * — so it resolves them itself from the account it just looked up. Exported
 * because the Google exchange (routes/authGoogle.js) answers the same shape:
 * one spelling of the summary, so `elevated` cannot drift between the doors.
 */
export function summariseAccess(access) {
  return { doors: access.doors, capabilities: [...access.capabilities], role: access.role ? { key: access.role.key, label: access.role.label } : null, elevated: Boolean(access.elevated) };
}

const bearerOf = (req) => {
  const [scheme, value] = String(req.headers.authorization || '').split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value.trim() : null;
};

/**
 * GET /api/session — am I signed in?
 *
 * The app asks this before it draws anything, so it can show the passcode
 * screen rather than five screens' worth of failed requests. Answers 200 either
 * way: "no" is an answer, not an error.
 */
router.get('/session', async (req, res, next) => {
  try {
    if (!authConfigured()) {
      return res.json({ signedIn: false, configured: false, message: 'This Epic API has no passcode set yet.' });
    }
    // Whether the launch gate is up: the website draws only for somebody signed
    // in until it comes down (web › SiteScreen), so the app needs to know.
    res.set('cache-control', 'no-store');
    const gate = siteGateOn();
    const token = bearerOf(req);
    let session = token ? await findLiveSession(token) : null;
    // While the launch gate is up, a session minted before its cutoff is not a
    // session (siteGate.js): report it as signed out rather than send the client
    // into the signed-in UI with a token every protected request will refuse.
    if (session && sessionBlockedByGate(session)) session = null;
    const account = session?.account_id ? await accountById(session.account_id) : null;
    // A suspended account is signed out here as well as at the door, so the app
    // shows the sign-in screen rather than five screens' worth of 403s.
    if (account && account.status === 'suspended') {
      return res.json({ signedIn: false, configured: true, gate, session: null, account: null, suspended: true });
    }
    const access = await accessFor({ account, session });
    res.json({
      signedIn: Boolean(session),
      configured: true,
      gate,
      session: session ? { id: session.id, label: session.label, since: session.created_at, until: session.expires_at } : null,
      // Who they are, and whether the admin module is theirs to see. The shared
      // passcode carries no account and is the owner (auth.js `requireOwner`),
      // which is why `isOwner` is answered here rather than inferred from
      // `account` being absent.
      account: account ? { id: account.id, email: account.email, name: account.name, role: account.role, plan: account.plan, trialEndsOn: account.trial_ends_on ?? null } : null,
      // Derived from the resolved access, not computed apart from it: an agent
      // session on the owner's account is not the owner, and the app must be
      // told so or it draws owner-only controls the API will then refuse
      // (Codex, 1 Oct 2026).
      isOwner: Boolean(session) && access.isOwner,
      // Which applications this session may enter and what it may do in them
      // (access.js). The app draws only the doors it is told it holds — and the
      // API refuses the rest whatever the app draws.
      // …and whose session it is, so the back office can say "Roger · Owner" rather than a role alone (Roger, 3 Oct 2026).
      access: session ? { ...summariseAccess(access), name: account?.name ?? null } : null,
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/session — the passcode, once, for a token that lasts ninety days.
 *
 * The token comes back in the body (the app sends it as a bearer header from
 * then on) and as a cookie, which exists only so an `<img>` tag can load a
 * photograph: auth.js will not accept that cookie for anything else.
 */
router.post('/session', async (req, res, next) => {
  try {
    if (!authConfigured()) {
      return res.status(503).json({ error: 'auth_not_configured', message: 'This Epic API has no passcode set. The owner adds EPIC_PASSCODE in Doppler.' });
    }
    // The launch gate leaves this door open, so it guards itself: a handful of
    // failed attempts from one IP locks it out for a while (signInGuard.js).
    if (await signInLockedOut(req)) {
      return res.status(429).json({ error: 'locked_out', message: 'Too many attempts just now. Try again shortly.' });
    }
    if (!passcodeMatches(req.body?.passcode)) {
      // One message for a missing passcode and a wrong one: which it was is
      // information, and the caller is not necessarily the family.
      await noteSignInFailure(req, { kind: 'passcode', reason: 'wrong_passcode' });
      return res.status(401).json({ error: 'wrong_passcode', message: "That passcode doesn't open this Epic." });
    }
    const label = String(req.body?.label || '').slice(0, 80) || null;
    // Once the owner has claimed an account (admin › Accounts), the passcode
    // opens a session on it, so his own sign-ins and usage are counted the same
    // way everybody else's are. Until then it opens a session with no account,
    // which resolves to the founding household exactly as it always has.
    const owner = await ownerAccount();
    const { token, session } = await openSession(label, owner?.id ?? null, sessionKindFor(req, label), 'passcode');
    if (owner) await recordSignIn(owner.id, { method: 'passcode', label });
    sessionCookie(res, token);
    const access = await accessFor({ account: owner ?? null, session });
    res.status(201).json({
      token,
      session: { id: session.id, label: session.label, since: session.created_at, until: session.expires_at },
      account: owner ? { id: owner.id, email: owner.email, name: owner.name, role: owner.role, plan: owner.plan, trialEndsOn: owner.trial_ends_on ?? null } : null,
      // An agent on the passcode is not the owner, whoever claimed the account.
      isOwner: access.isOwner,
      access: summariseAccess(access),
    });
  } catch (err) { next(err); }
});

/** DELETE /api/session — sign this device out. `?all=1` signs every device out. */
router.delete('/session', async (req, res, next) => {
  try {
    const token = bearerOf(req);
    if (String(req.query.all) === '1' || req.body?.all === true) {
      // Only somebody already inside may do this, so it is checked here rather
      // than trusted from the query: a live session, or nothing happens.
      const live = token ? await findLiveSession(token) : null;
      if (!live) return res.status(401).json({ error: 'signed_out', message: 'Sign in first.' });
      // Their own devices, not the estate's, and never on an agent's say-so:
      // one customer signing out everywhere must not sign every other household
      // out too, and an agent — which since the owner account was claimed
      // carries the owner's account_id — must not sign the owner out of his own
      // personal sessions. The passcode, a service and an agent each sign out
      // only themselves (G2, 28 Sep 2026; G11, 1 Oct 2026).
      if (live.account_id && !(live.kind === 'agent' && live.auth_method === 'passcode')) await revokeAllSessions(live.account_id);
      else await closeSession(token);
    } else if (token) {
      await closeSession(token);
    }
    clearSessionCookie(res);
    res.status(204).end();
  } catch (err) { next(err); }
});

/**
 * POST /api/session/link — a magic link, exchanged for a session.
 *
 * This is how everybody except the owner gets in. The link is single-use and
 * expiring, and `consumeSignInLink` spends it in the same statement that checks
 * it, so a link that was forwarded to somebody else is simply already spent by
 * the time they open it.
 *
 * One message for every way of failing. "That link has expired", "that link was
 * already used" and "that account was suspended" are three facts about somebody
 * else's account, and the caller is not necessarily them.
 */
router.post('/session/link', async (req, res, next) => {
  try {
    const token = String(req.body?.token || '').trim();
    // The account the token is for, so a run of bad links against one account is
    // locked out wherever it comes from — not only by IP (signInGuard.js).
    const who = await linkContactFor(token);
    if (await signInLockedOut(req, who)) {
      return res.status(429).json({ error: 'locked_out', message: 'Too many attempts just now. Try again shortly.' });
    }
    const spent = token ? await consumeSignInLink(token) : null;
    if (!spent) {
      await noteSignInFailure(req, { kind: 'link', contact: who, reason: 'link_spent' });
      return res.status(401).json({
        error: 'link_spent',
        // Not "it will arrive by e-mail": since migration 056 somebody may have
        // been invited by text and have no address at all, and telling them to
        // watch an inbox they do not have is telling them to wait for ever.
        message: 'That link does not work any more. Ask for a new one and it will be sent to you.',
      });
    }
    const label = String(req.body?.label || '').slice(0, 80) || null;
    const account = await recordSignIn(spent.account_id, { method: 'link', label });
    // A magic link is a personal sign-in: this is who a privileged action needs (G11).
    const { token: sessionToken, session } = await openSession(label, spent.account_id, sessionKindFor(req, label, { onAccount: true }), 'link');
    sessionCookie(res, sessionToken);
    const access = await accessFor({ account, session });
    res.status(201).json({
      token: sessionToken,
      session: { id: session.id, label: session.label, since: session.created_at, until: session.expires_at },
      account: { id: account.id, email: account.email, name: account.name, role: account.role, plan: account.plan, trialEndsOn: account.trial_ends_on ?? null },
      isOwner: access.isOwner,
      access: summariseAccess(access),
    });
  } catch (err) { next(err); }
});

/**
 * Mint a self-serve login link and send it, for both customers and staff (L2).
 *
 * Fifteen minutes, not a week: a link somebody asked for a moment ago at
 * epic.day/login does not need to outlive the afternoon, and the shorter it
 * lives the less a forwarded or intercepted one is worth (handover). The
 * generic "Your login link" — it is answered the same whether or not the
 * address has an account, so it cannot describe an account it may not be about.
 *
 * By e-mail where there is one, by text where there is not: since migration 056
 * an account may have a mobile and no address at all, and that account most
 * needs a way back in once its first link is spent. Dropping the SMS path would
 * lock it out for good.
 */
async function sendLoginLink(req, account) {
  // The new link is the only one that works: replaceSignInLink voids any older
  // unused link — including a seven-day staff invite — and mints the new one in
  // one atomic step, so a leaked or forwarded one cannot still open a ninety-day
  // session, even if two requests race (Codex, 1 Oct 2026).
  const { token, link } = await replaceSignInLink(account.id, { requestedBy: 'self', ttlHours: 0.25 });
  const url = `${webUrl(req)}/?signin=${token}`;
  let delivery; let error = null; let channel = null;
  if (account.email) {
    channel = 'email';
    const mail = mailStatus();
    if (!mail.configured) { delivery = mail.reason || 'no_sender'; error = mail.message; }
    else {
      const sent = await sendMail({ to: account.email, ...loginLinkEmail({ url }), purpose: 'sign_in' });
      delivery = sent.sent ? 'email' : (sent.reason ?? 'send_failed');
      error = sent.sent ? null : (sent.message ?? null);
    }
  } else if (account.mobile) {
    channel = 'sms';
    const sms = smsStatus();
    if (!sms.configured) { delivery = sms.reason || 'no_sender'; error = sms.message; }
    else {
      const sent = await sendSms({ to: account.mobile, text: `Log in to Epic — this link works once, for 15 minutes: ${url}` });
      delivery = sent.sent ? 'sms' : (sent.reason ?? 'send_failed');
      error = sent.sent ? null : (sent.message ?? null);
    }
  } else {
    return; // no e-mail and no mobile: nothing to send to.
  }
  await markLinkSent(link.id, { delivery, error, channel });
}

/**
 * POST /api/session/request-link — "send me a link" (L1).
 *
 * The front door at epic.day/login, for everybody. A link is single-use and a
 * device is signed in for ninety days, so somebody who changes phone in month
 * four needs a way back in that is not "text Roger"; this is it, and it is the
 * only way a staff member gets in once their invite link is spent.
 *
 * It answers exactly the same whether or not the address has an account, and
 * takes the same time to do it, so it cannot be used to find out who Epic's
 * customers are. It is held to the sign-in limit (limits.js) like the passcode.
 */
router.post('/session/request-link', async (req, res, next) => {
  try {
    const account = await accountByContact({ email: req.body?.email, mobile: req.body?.mobile });
    // Only an account that has been invited and is not suspended gets a link.
    // Everything else falls through to the same answer as an unknown address.
    if (account && account.status !== 'suspended') {
      await sendLoginLink(req, account);
    }
    res.json({
      sent: true,
      message: req.body?.mobile && !req.body?.email
        ? 'If that number has an Epic account, a login link is on its way by text. It works once, for 15 minutes.'
        : 'If that email has an Epic account, a login link is on its way. It works once, for 15 minutes.',
    });
  } catch (err) { next(err); }
});

export default router;

/**
 * The devices signed in, for Settings.
 *
 * Its own router because it is the one thing here that is *not* public: the
 * door above answers without a session by design, and this must not. server.js
 * mounts it on the far side of `requireSession`.
 */
export const devices = express.Router();

devices.get('/sessions', async (req, res, next) => {
  try {
    // Only this account's real devices (SX6). Test and agent sessions are
    // filtered out on the server, and another household member's phones never
    // appear — the account scope already sees to that.
    const rows = await liveSessions(req.session?.account_id ?? null, { kinds: ['device'], ownOnly: true });
    res.json({
      sessions: rows.map((s) => ({ id: s.id, label: s.label, since: s.created_at, lastSeen: s.last_seen_at, until: s.expires_at, current: s.id === req.session?.id })),
    });
  } catch (err) { next(err); }
});

/** DELETE /api/sessions/:id — sign one other device out (SX6). Confirmed first in the UI; no Undo. */
devices.delete('/sessions/:id', async (req, res, next) => {
  try {
    const removed = await revokeSessionById(req.params.id, req.session?.account_id ?? null);
    if (!removed) return res.status(404).json({ error: 'device_not_found', message: 'That device is not signed in, or is not yours.' });
    res.status(204).end();
  } catch (err) { next(err); }
});

/**
 * DELETE /api/sessions — sign out every OTHER device of this account (SX6).
 * The shared passcode (no account) gets the same button over its own
 * no-account devices; without a session row to keep, there is nothing to
 * scope by and the ask is refused rather than guessed at (Codex, 1 Oct 2026).
 */
devices.delete('/sessions', async (req, res, next) => {
  try {
    if (!req.session?.id) return res.status(400).json({ error: 'no_session', message: 'This device signs out on its own.' });
    await revokeOtherSessions(req.session?.account_id ?? null, req.session.id);
    res.status(204).end();
  } catch (err) { next(err); }
});
