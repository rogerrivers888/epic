/**
 * Log in with Google (Website & Registration L1; Decisions J11).
 *
 * The server-side OpenID Connect Authorization Code flow, with state, nonce and
 * PKCE. Three steps:
 *
 *  1. `GET /api/auth/google` — start. Mint PKCE verifier, state and nonce, stash
 *     them (and where to go afterwards) in a short-lived, HMAC-signed, httpOnly
 *     cookie on the API's own host, and redirect to Google.
 *  2. `GET /api/auth/google/callback` — finish. Verify the ID token (iss, aud,
 *     exp, nonce via openid-client; `email_verified` here), match an existing
 *     account, and — staff only until launch — hand the browser back to the web
 *     app with a single-use handoff code. No account, or not staff, is bounced
 *     to `/login?e=no-account`, the same for either so neither can be told apart.
 *  3. `POST /api/auth/google/exchange` — the SPA swaps the one-time code for a
 *     session, exactly as the magic link does. A session is a Bearer token the
 *     app holds, never a cross-domain cookie (auth.js explains why that cookie
 *     is blocked by Safari between epic.day and the API host).
 *
 * Why the handoff code rather than a cookie: the session the app uses for every
 * write is a Bearer token in the SPA's own store. The callback is a top-level
 * redirect and cannot write that store, so it mints a single-use, short-lived
 * code (a `sign_in_links` row — the single-use-token machinery we already have)
 * and the SPA trades it for the token. The session token itself never touches a
 * URL.
 *
 * The plain door never creates an account (J11): a Google identity only ever
 * signs in to an account that already exists and already opens the admin door.
 * The one exception is the guest door (G21, 3 Oct 2026) — `?intent=guest`,
 * started from booking, ask to book or a waiting list — which signs any
 * existing account in and makes a free guest account for a verified address
 * that has none (`resolveGuestGoogleAccount`).
 */

import express from 'express';
import crypto from 'node:crypto';
import { withTransaction } from '../db.js';
import {
  authorizationCodeGrant, buildAuthorizationUrl, calculatePKCECodeChallenge,
  discovery, randomNonce, randomPKCECodeVerifier, randomState,
} from 'openid-client';
import { openSession, sessionCookie, sessionKindFor, deployed } from '../auth.js';
import { signInLimit } from '../limits.js';
import {
  accountByEmail, accountByGoogleSub, accountById, setGoogleSub, createGuestSignupAccount,
  createSignInLink, consumeSignInLink, inspectSignInLink, linkContactFor, recordSignIn,
} from '../repositories/accounts.js';
import { roleForAccount } from '../repositories/roles.js';
import { accessFor } from '../access.js';
import { signInLockedOut, noteSignInFailure } from '../signInGuard.js';
import { summariseAccess } from './session.js';
import { webUrl } from '../sources/mail.js';

const router = express.Router();

const ISSUER = new URL('https://accounts.google.com');
const SCOPE = 'openid email profile';
const OAUTH_COOKIE = 'epic_oauth';
// The handoff code lives for five minutes: long enough to cross the redirect,
// short enough that a leaked one is worth little. `ttlHours` is fractional.
const HANDOFF_TTL_HOURS = 5 / 60;

const clientId = () => process.env.GOOGLE_OAUTH_CLIENT_ID || '';
const clientSecret = () => process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
const apiBase = () => String(process.env.EPIC_API_BASE_URL || '').replace(/\/$/, '');
const configured = () => Boolean(clientId() && clientSecret() && apiBase());
const redirectUri = () => `${apiBase()}/api/auth/google/callback`;

/** Discovery is one network round-trip; do it once and keep the configuration. */
let configPromise;
function oidcConfig() {
  if (!configPromise) {
    configPromise = discovery(ISSUER, clientId(), clientSecret()).catch((err) => {
      configPromise = undefined; // a failed discovery must not be cached for ever
      throw err;
    });
  }
  return configPromise;
}

// --- the signed handshake cookie -------------------------------------------
// It carries the PKCE verifier, the state and nonce we expect back, and where to
// go afterwards, between the two requests. Signed with the client secret (a
// server-only value) so a tampered cookie is rejected; httpOnly and Secure;
// scoped to the auth path and ten minutes.

const macKey = () => clientSecret() || 'epic-oauth';
function sign(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', macKey()).update(data).digest('base64url');
  return `${data}.${mac}`;
}
function unsign(value) {
  if (!value || typeof value !== 'string') return null;
  const dot = value.indexOf('.');
  if (dot < 0) return null;
  const data = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  const expected = crypto.createHmac('sha256', macKey()).update(data).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(Buffer.from(data, 'base64url').toString('utf8')); } catch { return null; }
}

function cookieOf(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(eq + 1).trim()); } catch { return null; }
  }
  return null;
}

const handshakeCookie = (res, value) => res.cookie(OAUTH_COOKIE, value, {
  httpOnly: true, secure: deployed(), sameSite: 'lax', maxAge: 10 * 60 * 1000, path: '/api/auth/google',
});
const clearHandshake = (res) => res.clearCookie(OAUTH_COOKIE, { httpOnly: true, secure: deployed(), sameSite: 'lax', path: '/api/auth/google' });

/**
 * Only an in-app path is a safe place to send somebody after sign-in: a leading
 * slash, not protocol-relative (`//host`), and no backslash — a browser reads
 * `\` as `/`, so `/\host` would escape the origin (Codex, 1 Oct 2026).
 */
export function safeNext(value) {
  const s = String(value || '');
  // No whitespace, control character or backslash anywhere: a browser drops a
  // newline and reads "\\" as "/", so either could turn "/x" into "//host".
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0020\u007f\\#]/.test(s)) return null; // `#`: a fragment is never a page, and would hide a sign-in door
  if (!/^\/[^/]/.test(s)) return null;
  // Never back into a sign-in door, and never carrying a credential: a crafted
  // `next=/login?code=…` would spend somebody else's handoff right after this
  // person signed in and swap their session (login CSRF).
  const [path, query = ''] = s.split('?');
  // Every segment decoded, and no dot segment at all: a browser resolves
  // `/x/../login` and `/x/%2e%2e/login` to `/login` before it navigates, so the
  // first segment is only the page once nothing can climb (Codex, 1 Oct 2026).
  let segs;
  try { segs = path.split('/').filter(Boolean).map((x) => decodeURIComponent(x).toLowerCase()); } catch { return null; }
  if (segs.some((x) => x === '.' || x === '..')) return null;
  if (segs[0] === 'login' || segs[0] === 'in') return null;
  const q = new URLSearchParams(query);
  if (q.has('code') || q.has('signin')) return null;
  return s;
}

/**
 * Where a free guest account (G21) may be sent back to: the pages a guest makes
 * one from, and the ones a guest uses — an event (in the app or on the public
 * site), booking it, an invitation, a booking, Plans, Messages, Settings. A
 * safe in-app path first (`safeNext`), then one of those; anything else is
 * dropped and they land on their account page, never a guess.
 */
const GUEST_THEN = new Set(['ask', 'waitlist']);
const GUEST_PAGES = new Set(['experiences', 'invited', 'i', 'e', 'bookings', 'plans', 'messages', 'settings', 'account', 'hosts']);
export function guestNext(value) {
  const s = safeNext(value);
  if (!s) return null;
  const segs = s.split('?')[0].split('/').filter(Boolean).map((x) => decodeURIComponent(x).toLowerCase());
  // `then` names the sheet to reopen on an event page once signed in (ask, or
  // the waiting list) — only those two, only there. It opens a sheet to
  // confirm; it never acts by itself.
  const then = new URLSearchParams(s.split('?')[1] ?? '').getAll('then');
  if (then.length && !(then.length === 1 && GUEST_THEN.has(then[0]) && segs[0] === 'experiences' && segs.length === 2)) return null;
  if (GUEST_PAGES.has(segs[0])) return s;
  // The public event and host pages: /en-gb/event/<slug>-<code>, /en-gb/host/…
  if (/^[a-z]{2}(-[a-z]{2})?$/.test(segs[0] ?? '') && (segs[1] === 'event' || segs[1] === 'host')) return s;
  return null;
}

/** Where the web app lives, so the callback can hand control back to it. */
/**
 * Google for a free guest account is off until Roger has set it up (3 Oct 2026: "Blocked on Roger … Google sign-in
 * for guests: build everything around it, leave it switched off"). `EPIC_GUEST_GOOGLE=on` turns it on; anything
 * else leaves guests with "Use my email" only, and the guest door here makes nothing.
 */
export const guestGoogleOn = () => String(process.env.EPIC_GUEST_GOOGLE ?? '').trim().toLowerCase() === 'on';

const loginUrl = (req, query) => `${webUrl(req)}/login${query ? `?${query}` : ''}`;

// --- matching and the staff gate -------------------------------------------

/** A back-office account is the owner, or one whose role opens the admin door (034). */
async function isStaff(account) {
  if (account.role === 'owner') return true;
  if (!account.role_id) return false;
  const role = await roleForAccount(account.id);
  return Array.isArray(role?.doors) && role.doors.includes('admin');
}

/**
 * Turn a verified Google identity into the account it may sign in to, or a
 * reason it may not. `google_sub` first, then a verified email equal to
 * `accounts.email`; on that first email match the `sub` is stored. Never creates
 * an account. 'no-account' and 'not-staff' are both bounced the same way so the
 * screen cannot be used to tell a customer's address from a stranger's.
 */
export async function resolveGoogleAccount({ sub, email, emailVerified }) {
  if (!sub) return { ok: false, reason: 'no-account' };
  let account = await accountByGoogleSub(sub);
  if (!account) {
    if (emailVerified !== true || !email) return { ok: false, reason: 'no-account' };
    const byEmail = await accountByEmail(email);
    if (!byEmail) return { ok: false, reason: 'no-account' };
    // The email matches, but the subject did not (accountByGoogleSub found
    // nothing). An account already bound to a Google identity must not be signed
    // into by a *different* one — a reassigned Workspace address would otherwise
    // take over the account. Only an unbound account links here, and the write
    // is the check: a null return means someone bound it in between (Codex, 1 Oct).
    if (byEmail.google_sub) return { ok: false, reason: 'no-account' };
    account = await setGoogleSub(byEmail.id, sub);
    if (!account) return { ok: false, reason: 'no-account' };
  }
  if (!(await isStaff(account))) return { ok: false, reason: 'not-staff' };
  return { ok: true, account };
}

/**
 * The guest door (G21, owner 3 Oct 2026): "ask to book and joining a waiting
 * list create the same free account as booking". Started only from a guest
 * page (`?intent=guest`), carried in the signed handshake cookie, so the plain
 * Log in with Google stays staff-only.
 *
 * Matching is exactly `resolveGoogleAccount`'s — `google_sub` first, then a
 * verified email on an account not yet bound to another Google identity — but
 * an existing account of any kind signs in here (a customer booking is who
 * this door is for), and no account at all, with a verified address, makes
 * the free guest account. An existing account is never duplicated and its
 * plan is never changed. A suspended one opens nothing.
 */
export async function resolveGuestGoogleAccount({ sub, email, emailVerified, name = null }) {
  if (!sub) return { ok: false, reason: 'no-account' };
  const live = (a) => (a && a.status !== 'suspended' ? { ok: true, account: a } : { ok: false, reason: 'no-account' });
  const bySub = await accountByGoogleSub(sub);
  if (bySub) return live(bySub);
  if (emailVerified !== true || !email) return { ok: false, reason: 'no-account' };
  const byEmail = await accountByEmail(email);
  if (byEmail) {
    // Never a takeover: an account bound to a different Google identity is refused.
    if (byEmail.google_sub) return { ok: false, reason: 'no-account' };
    if (byEmail.status === 'suspended') return { ok: false, reason: 'no-account' };
    return live(await setGoogleSub(byEmail.id, sub));
  }
  const cleanName = typeof name === 'string' ? name.trim().slice(0, 80) || null : null;
  const { account, created } = await createGuestSignupAccount({ email, name: cleanName, googleSub: sub });
  if (created) return { ok: true, account, created: true };
  // Lost a race to another sign-up for the same address or identity: match again, by the same rules.
  if (!account) return { ok: false, reason: 'no-account' };
  if (account.google_sub && account.google_sub !== String(sub)) return { ok: false, reason: 'no-account' };
  return live(account.google_sub ? account : await setGoogleSub(account.id, sub));
}

/** An invite token as createSignInLink mints it (32 random bytes, base64url), or null. */
const inviteToken = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{20,100}$/.test(v) ? v : null);

/** Back to L4 for this invitation, with what went wrong in the query. */
const inviteUrl = (req, token, query) => `${webUrl(req)}/in/${encodeURIComponent(token)}${query ? `?${query}` : ''}`;

/**
 * "Use Google instead" on an invitation (Website & Registration › L4): Google
 * must return the address that was invited. A different one is sent back to
 * L4 with that address to show ("That Google account is {x}. Use {invited
 * email}, or set a password instead."), and the invitation is left unspent.
 * The right one spends the invitation, binds the Google subject to the account
 * and then signs in exactly as any Google sign-in does — a single-use handoff
 * code the SPA trades for a session, where `recordSignIn` turns invited into
 * active. An account already bound to a different Google identity is refused
 * the same way, so an invitation cannot rebind one.
 */
export async function finishInvite(req, res, token, claims) {
  const link = await inspectSignInLink(token);
  if (!link || link.purpose !== 'invite') return res.redirect(inviteUrl(req, token));
  const account = await accountById(link.account_id);
  if (!account) return res.redirect(inviteUrl(req, token));
  const email = typeof claims?.email === 'string' ? claims.email.trim().toLowerCase() : '';
  const sub = claims?.sub ? String(claims.sub) : '';
  const verified = claims?.email_verified === true;
  const invited = String(account.email || '').trim().toLowerCase();
  if (!sub || !verified || !email || email !== invited || (account.google_sub && account.google_sub !== sub)) {
    const q = new URLSearchParams({ e: 'google-mismatch' });
    if (email && verified) q.set('as', email);
    return res.redirect(inviteUrl(req, token, q.toString()));
  }
  // The same Google identity must not already be another account's.
  const holder = await accountByGoogleSub(sub);
  if (holder && holder.id !== account.id) return res.redirect(inviteUrl(req, token, 'e=failed'));
  // Staff before anything is spent: an invitation that cannot sign in stays as it was.
  if (!(await isStaff(account))) return res.redirect(loginUrl(req, 'e=no-account'));
  // The invitation, the binding and the handoff code stand or fall together, so a
  // failure part-way leaves the invitation usable for another try (Codex).
  const code = await withTransaction(async (db) => {
    const spent = await consumeSignInLink(token, { purpose: 'invite', db });
    if (!spent || spent.account_id !== account.id) throw Object.assign(new Error('invite gone'), { code: 'invite_gone' });
    if (!account.google_sub && !(await setGoogleSub(account.id, sub, { db }))) throw Object.assign(new Error('bound meanwhile'), { code: 'invite_gone' });
    const { token: handoff } = await createSignInLink(account.id, { requestedBy: 'google', ttlHours: HANDOFF_TTL_HOURS, db });
    return handoff;
  }).catch((err) => { if (err?.code === 'invite_gone') return null; throw err; });
  if (!code) return res.redirect(inviteUrl(req, token));
  return res.redirect(loginUrl(req, new URLSearchParams({ code }).toString()));
}

// --- the routes ------------------------------------------------------------

/**
 * The configured API host, when this request arrived on another one. The
 * handshake cookie is host-only and Google returns to `EPIC_API_BASE_URL`, so a
 * start begun on a second name for the same service (the web app calls the
 * railway.app hostname) would set its cookie where the callback never sees it
 * and every sign-in would fail. Such a start is moved to the configured host
 * first, query and all.
 */
export function canonicalStart(req) {
  let base;
  try { base = new URL(apiBase()); } catch { return null; }
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
  if (!host || host === base.host.toLowerCase()) return null;
  return `${base.origin}${req.originalUrl}`;
}

// The move comes before the sign-in limit, so a start that is only passing
// through to the right host does not spend one of the caller's attempts (Codex).
const toCanonicalHost = (req, res, next) => {
  const moved = configured() ? canonicalStart(req) : null;
  return moved ? res.redirect(moved) : next();
};

router.get('/auth/google', toCanonicalHost, signInLimit, async (req, res) => {
  if (!configured()) return res.redirect(loginUrl(req, 'e=failed'));
  try {
    const cfg = await oidcConfig();
    const verifier = randomPKCECodeVerifier();
    const challenge = await calculatePKCECodeChallenge(verifier);
    const state = randomState();
    const nonce = randomNonce();
    // "Use Google instead" on an invitation (L4) carries the invite's token, so
    // the callback can insist Google returns the address that was invited. The
    // token travels in the signed handshake cookie, never to Google.
    const invite = inviteToken(req.query.invite);
    // A free guest account (G21): only from a guest page, and only ever back to one.
    const guest = !invite && req.query.intent === 'guest';
    // Switched off: straight back to the page they came from, where "Use my email" is the way in.
    if (guest && !guestGoogleOn()) return res.redirect(`${webUrl(req)}${guestNext(req.query.next) ?? '/'}`);
    const next = guest ? guestNext(req.query.next) : safeNext(req.query.next);

    handshakeCookie(res, sign({ v: verifier, s: state, n: nonce, next, ...(invite ? { i: invite } : {}), ...(guest ? { g: 1 } : {}) }));

    const url = buildAuthorizationUrl(cfg, {
      redirect_uri: redirectUri(),
      scope: SCOPE,
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      // We only ever read an existing account, so ask Google to let the person
      // pick which of theirs to use rather than silently reusing the last one.
      prompt: 'select_account',
    });
    res.redirect(url.href);
  } catch {
    res.redirect(loginUrl(req, 'e=failed'));
  }
});

router.get('/auth/google/callback', async (req, res) => {
  const stash = unsign(cookieOf(req, OAUTH_COOKIE));
  clearHandshake(res);
  if (!configured() || !stash) return res.redirect(loginUrl(req, 'e=failed'));

  let claims;
  try {
    const cfg = await oidcConfig();
    const current = new URL(req.originalUrl, apiBase());
    const tokens = await authorizationCodeGrant(cfg, current, {
      pkceCodeVerifier: stash.v,
      expectedState: stash.s,
      expectedNonce: stash.n,
    });
    claims = tokens.claims();
  } catch {
    // A bad state, a replayed code, a nonce that does not match: never says why.
    return res.redirect(loginUrl(req, 'e=failed'));
  }

  if (stash.i) return finishInvite(req, res, stash.i, claims).catch(() => res.redirect(loginUrl(req, 'e=failed')));

  // email_verified is part of trusting the address at all (J11 / brief step 2).
  const identity = {
    sub: claims?.sub,
    email: typeof claims?.email === 'string' ? claims.email : null,
    emailVerified: claims?.email_verified === true,
  };
  // The guest door (G21) may make a free account; the plain door never does.
  let resolved;
  try {
    // A handshake begun before the switch went off makes nothing either.
    if (stash.g === 1 && !guestGoogleOn()) throw new Error('guest Google is off');
    resolved = stash.g === 1
      ? await resolveGuestGoogleAccount({ ...identity, name: typeof claims?.name === 'string' ? claims.name : null })
      : await resolveGoogleAccount(identity);
  } catch {
    return res.redirect(loginUrl(req, 'e=failed'));
  }
  if (!resolved.ok) {
    // A guest is sent back to the page they were on, with the plain words there.
    const back = stash.g === 1 ? guestNext(stash.next) : null;
    return res.redirect(loginUrl(req, new URLSearchParams({ e: stash.g === 1 ? 'failed' : 'no-account', ...(back ? { next: back } : {}) }).toString()));
  }

  // Hand the SPA a single-use code it trades for a session.
  const { token } = await createSignInLink(resolved.account.id, { requestedBy: 'google', ttlHours: HANDOFF_TTL_HOURS });
  // `next` only when the start asked for one: with none, the screen lands the
  // person where their role can open (firstAdminScreen), not on a fixed /admin.
  const params = new URLSearchParams({ code: token });
  const next = stash.g === 1 ? guestNext(stash.next) : safeNext(stash.next);
  if (next) params.set('next', next);
  res.redirect(loginUrl(req, params.toString()));
});

router.post('/auth/google/exchange', signInLimit, async (req, res, next) => {
  try {
    const code = String(req.body?.code || '').trim();
    // The account the code is for, so a run of bad codes against one account is
    // locked out wherever it comes from — not only by IP (signInGuard.js), the
    // same shape as the magic-link door.
    const who = await linkContactFor(code);
    if (await signInLockedOut(req, who)) {
      return res.status(429).json({ error: 'locked_out', message: 'Too many attempts just now. Try again shortly.' });
    }
    // Only a Google-minted handoff code (requested_by 'google') is redeemable
    // here — never an ordinary magic link, which would otherwise be recorded as
    // a Google sign-in and skip its own door.
    const spent = code ? await consumeSignInLink(code, { requestedBy: 'google' }) : null;
    if (!spent) {
      await noteSignInFailure(req, { kind: 'google', contact: who, reason: 'code_spent' });
      return res.status(401).json({ error: 'code_spent', message: 'That sign-in could not be completed. Try again.' });
    }
    const label = String(req.body?.label || '').slice(0, 80) || null;
    const account = await recordSignIn(spent.account_id, { method: 'google', label });
    // A real browser signing in on their own account is a device session, like
    // the magic link — not the default 'agent', which paidGate denies and which
    // shows in the agent-session controls (Codex, 1 Oct 2026). The session also
    // records that it signed in with Google (`auth_method`, migration 313), so
    // the privileged-action gate treats it as the personal sign-in it is — the
    // same standing a magic link earns (G11; access.js counts 'google' personal).
    const { token, session } = await openSession(label, spent.account_id, sessionKindFor(req, label, { onAccount: true }), 'google');
    sessionCookie(res, token);
    // The doors and capabilities behind the new session, answered inline exactly
    // as the link door answers them, so a Google sign-in lands fully formed.
    const access = await accessFor({ account, session });
    res.status(201).json({
      token,
      session: { id: session.id, label: session.label, since: session.created_at, until: session.expires_at },
      account: { id: account.id, email: account.email, name: account.name, role: account.role, plan: account.plan, trialEndsOn: account.trial_ends_on ?? null },
      isOwner: access.isOwner,
      access: summariseAccess(access),
    });
  } catch (err) { next(err); }
});

export default router;
