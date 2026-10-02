/**
 * The launch gate — nothing of the unopened site reaches the public (owner, 1 Oct 2026).
 *
 * epic.day is not open yet. Until it is, the API answers only three kinds of
 * caller, and refuses everyone else with 401 JSON (it has nothing a person reads,
 * so there is no placeholder here — the web service shows that):
 *
 *   · the gate password, HTTP Basic against `GATE_USER`/`GATE_PASSWORD` — the
 *     owner and testers, and the only way to reach the sign-in door before launch;
 *   · a real **Epic session** — a signed-in household on its Bearer token (or the
 *     cookie where it is allowed to stand in, which is how an `<img>` loads a
 *     photo). Someone Epic has already issued a session to is not the public, so
 *     the logged-in app works end to end — its every-reload session check, its
 *     sign-out, its images — rather than being shut out by a flat Basic wall;
 *   · the two things that must answer without either: `/health`, which Railway
 *     restarts the service on, and Postmark's delivery webhook, which carries its
 *     own credential and validates it in its own handler (routes/postmark.js).
 *
 * **Deny by default** is the point: a request is refused unless it matches one of
 * those, so a route that is mounted before the session door (the image library) or
 * a new public route added later cannot leak — there is no "falls through to
 * something that guards it" to get wrong. A request with no token at all never
 * touches the database.
 *
 * It fails closed. `SITE_GATE` unset means ON — the site cannot go live to the
 * world because a variable was forgotten — and with no `GATE_USER`/`GATE_PASSWORD`
 * the password admits nobody, leaving only a real session (and health/Postmark).
 * The credentials live in Doppler and are the owner's to set (CLAUDE.md).
 *
 * `X-Robots-Tag: noindex` goes on every response while the gate is up. This is the
 * interim; the launch model that replaces it is Google sign-in with a LAUNCH_OPEN
 * allowlist, and the gate comes down once that is deployed and verified.
 */

import crypto from 'node:crypto';
import { liveSessionFor, mintedSinceBoot, recordMintsSinceBoot, signedMediaOk } from './auth.js';

const GATE_OFF = new Set(['off', 'false', '0', 'no']);

/**
 * The cutoff: while the gate is up, a session created before this instant is not
 * honoured, whatever its token. It defaults — automatically, with no variable to
 * set — to when the clean-slate migration ran (`cleanSlateAppliedAt`, loaded into
 * `cleanSlateMs` at boot), so a pre-launch session is retired even if its row was
 * somehow not revoked and even across a retried rollout (Codex, 1 Oct 2026).
 * `EPIC_GATE_SINCE` overrides it when the owner wants a precise post-switch cutoff.
 *
 * (The seconds-long window between the migration running and the new process
 * taking traffic is inherent to a rolling deploy and cannot be closed by a single
 * timestamp without signing everyone out on every deploy; a session minted there
 * is a credentialled sign-in, not public access.)
 */
let cleanSlateMs = null;
let cutoffUnknown = false;
export function setCleanSlateEpoch(date) {
  const t = date ? new Date(date).getTime() : NaN;
  cleanSlateMs = Number.isFinite(t) ? t : null;
  cutoffUnknown = false;
  recordMintsSinceBoot(false);
}

/**
 * The cutoff could not be read at boot (server.js). Fail closed on what cannot
 * be dated, but never on a session this process minted itself: those are after
 * the clean slate by construction, so a fresh sign-in is honoured at once and an
 * agent that signs in is never handed a token the gate then refuses (owner, 2 Oct
 * 2026: "any request carrying a valid Epic session … passes the gate"). Every
 * older session waits for the real cutoff, which the retry restores
 * (setCleanSlateEpoch ends this state).
 */
let loadCutoff = null;
let lastTry = 0;
let inFlight = null;
export function failClosedUntilCutoff(load = null) {
  cutoffUnknown = true;
  loadCutoff = load;
  lastTry = 0;           // a newly unknown cutoff is tried on the very next request
  inFlight = null;       // and is not left waiting on an attempt from before
  recordMintsSinceBoot(true);
}

/**
 * While the cutoff is unknown, try again on demand — at most every five seconds,
 * one attempt shared by every request in flight. A request carrying a session is
 * proof the database is answering again, so the real cutoff is restored at once
 * rather than on the next minute's retry, and from then on every replica judges
 * the same session the same way on the database's own clock (Codex, 2 Oct 2026).
 * A failure leaves the fail-closed state as it was.
 */
async function ensureCutoff() {
  if (!cutoffUnknown || !loadCutoff) return;
  // Nobody waits more than three seconds for it: a stalled attempt carries on in
  // the background and the request is judged fail-closed meanwhile.
  const atMost = (p) => Promise.race([p, new Promise((r) => { const t = setTimeout(r, 3_000); t.unref?.(); })]);
  if (inFlight) { await atMost(inFlight); return; }
  if (Date.now() - lastTry < 5_000) return;
  lastTry = Date.now();
  const attempt = (async () => {
    try { setCleanSlateEpoch(await loadCutoff()); }
    catch { /* still unknown; fail closed as before */ }
  })();
  inFlight = attempt;
  attempt.finally(() => { if (inFlight === attempt) inFlight = null; });
  await atMost(attempt);
}
const gateSince = () => {
  const env = process.env.EPIC_GATE_SINCE ? Date.parse(process.env.EPIC_GATE_SINCE) : NaN;
  if (Number.isFinite(env)) return env;
  return cleanSlateMs;
};
const predatesGate = (session) => {
  // The owner's explicit override always wins; otherwise, while the automatic
  // cutoff is unknown, only this process's own sessions are known to be after it.
  // A malformed override is no override: it must not lift the fail-closed state
  // (Codex, 2 Oct 2026).
  const override = process.env.EPIC_GATE_SINCE ? Date.parse(process.env.EPIC_GATE_SINCE) : NaN;
  if (!Number.isFinite(override) && cutoffUnknown) return !mintedSinceBoot(session?.id);
  const since = gateSince();
  if (since == null || !session?.created_at) return false;
  const made = new Date(session.created_at).getTime();
  return Number.isFinite(made) && made < since;
};

/**
 * Whether the gate refuses this session — up, and the session is from before the
 * cutoff. The sign-in-status route asks this too, so `GET /api/session` does not
 * report a token the gate will reject on every other path as signed in (Codex,
 * 1 Oct 2026).
 */
export const sessionBlockedByGate = (session) => siteGateOn() && predatesGate(session);

// The sign-in door, left open by the gate (owner, 1 Oct 2026). Native clients and
// the magic link cannot carry the gate password, and sign-in is how a session is
// obtained in the first place. It is not unguarded: the passcode / magic link is
// the credential, the attempt is rate-limited (limits.js), and a handful of
// failures locks the caller out with an alert to the owner (signInGuard.js).
const SIGN_IN = new Set([
  '/api/session', '/api/session/link', '/api/session/request-link',
  // Log in with Google is a sign-in door too (routes/authGoogle.js): the start
  // and callback are the OIDC handshake and the exchange redeems a single-use
  // code. A signed-out staff member must reach them, so the gate leaves them
  // open exactly as it does the passcode and the magic link.
  '/api/auth/google', '/api/auth/google/callback', '/api/auth/google/exchange',
]);

/** Is the gate up? Unset is ON; only an explicit off word takes it down. */
export function siteGateOn() {
  const v = String(process.env.SITE_GATE ?? '').trim().toLowerCase();
  if (v === '') return true;
  return !GATE_OFF.has(v);
}

const credentialsConfigured = () =>
  Boolean(process.env.GATE_USER) && Boolean(process.env.GATE_PASSWORD);

/** Constant-time, and safe on a length mismatch (timingSafeEqual throws on one). */
function sameSecret(given, expected) {
  const a = Buffer.from(String(given ?? ''), 'utf8');
  const b = Buffer.from(String(expected ?? ''), 'utf8');
  if (a.length !== b.length) {
    // Still compare something, so a wrong length is not faster than a wrong byte.
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

/**
 * Does this `Authorization` header carry the gate's username and password?
 *
 * False whenever the credentials are not both configured — an unconfigured gate
 * admits nobody rather than everybody. The user and password are always both
 * compared before the result is returned, so a right username with a wrong
 * password is not distinguishable by timing from the other way round.
 */
export function basicAuthOk(header) {
  if (!credentialsConfigured()) return false;
  const [scheme, encoded] = String(header || '').split(' ');
  if (scheme?.toLowerCase() !== 'basic' || !encoded) return false;
  let decoded;
  try { decoded = Buffer.from(encoded, 'base64').toString('utf8'); } catch { return false; }
  const i = decoded.indexOf(':');
  if (i < 0) return false;
  const okUser = sameSecret(decoded.slice(0, i), process.env.GATE_USER);
  const okPass = sameSecret(decoded.slice(i + 1), process.env.GATE_PASSWORD);
  return okUser && okPass;
}

/**
 * Whether a refused request should carry the `WWW-Authenticate: Basic` challenge.
 *
 * The challenge is what makes a browser pop its native username/password dialog.
 * That is the intended way in for the owner and testers *typing the API's address
 * into a browser* — a genuine top-level navigation. But the signed-in web app
 * reaches this same 401 on its background XHR/fetch and on every `<img>` it loads
 * before a session is in hand, and a challenge on those makes the browser throw
 * the dialog again and again, every few minutes, with no way to dismiss it (owner
 * blocked on exactly this, 1 Oct 2026). Those callers must get a plain JSON 401
 * the app already handles, and no dialog.
 *
 * A navigation announces itself with `Sec-Fetch-Mode: navigate` wherever the
 * browser sends fetch metadata (every current one). Where it does not, an
 * `Accept` that asks for `text/html` is the fallback signal of a page load;
 * XHR/fetch and `<img>` ask for JSON, `*\/*`, or an image type, never HTML.
 */
function wantsBasicChallenge(req) {
  const mode = String(req.headers['sec-fetch-mode'] || '').toLowerCase();
  if (mode) return mode === 'navigate';
  return String(req.headers.accept || '').toLowerCase().includes('text/html');
}

/** The middleware, mounted first (server.js). See the file header for the model. */
export async function siteGate(req, res, next) {
  if (!siteGateOn()) return next();
  res.set('X-Robots-Tag', 'noindex');
  // Match the exempt paths with any trailing slash stripped, since Express's
  // default non-strict routing treats `/api/session/link/` and `/api/session/link`
  // as the same route — the gate must not reject a form the route would accept
  // (Codex, 1 Oct 2026).
  const path = req.path.length > 1 ? req.path.replace(/\/+$/, '') : req.path;
  // Railway restarts the service on this check; it must answer without a
  // credential or every deploy fails. It says nothing about the household.
  if (path === '/health') return next();
  // Postmark's delivery/open/bounce webhook carries its own Basic credential
  // (POSTMARK_WEBHOOK_TOKEN) and checks it in its handler; it must reach that
  // handler, not be measured against the gate password (routes/postmark.js).
  if (req.method === 'POST' && path === '/api/postmark/events') return next();
  // The sign-in door stays open (guarded by the passcode/link + signInGuard.js) —
  // but only the GET status check and the POST sign-in verbs. DELETE /api/session
  // (sign out, and `?all=1` signs every device out) must pass through the gate's
  // session cutoff, so a pre-cutoff token cannot reach it and revoke newer, valid
  // sessions (Codex, 1 Oct 2026).
  if ((req.method === 'GET' || req.method === 'POST') && SIGN_IN.has(path)) return next();
  // The owned image library is byte content an `<img>` loads with no header, and
  // its approved rows carry no signature (routes/library.js). It is referenced by
  // the public web bundle and spends nothing, so it is left open like a static
  // asset; the route itself keeps an unapproved image behind its own signed link.
  if (req.method === 'GET' && path.startsWith('/api/images/')) return next();
  // A CORS preflight carries no credentials and reveals nothing.
  if (req.method === 'OPTIONS') return next();
  // The gate password: the owner and testers, and the only way to the sign-in door.
  if (basicAuthOk(req.headers.authorization)) return next();
  // A valid Epic-signed media URL is the credential an `<img>` carries when it
  // can send no header and no cookie (Safari). Unguessable and Epic-minted, so
  // not the public (auth.js).
  if (signedMediaOk(req)) return next();
  // A real Epic session is not the public: the signed-in app passes here on its
  // Bearer token (or the photo cookie). The resolved session is left on the
  // request so requireSession does not look it up a second time (auth.js). A
  // request with no token never reaches the database — and a database error is
  // left to throw (→ a retryable 5xx from the error handler), never swallowed into
  // a 401 that would make the client discard a good token (Codex, 1 Oct 2026).
  const session = await liveSessionFor(req);
  // Only here, after a session lookup has just succeeded — proof the database is
  // answering — and never ahead of /health, the sign-in door or any other
  // credential, so a stalled retry cannot hold those up (Codex, 2 Oct 2026).
  if (session && cutoffUnknown) await ensureCutoff();
  // A session from before the gate's cutoff is treated as no session — it is a
  // token the launch is meant to have retired (see gateSince above).
  if (session && !predatesGate(session)) { req.siteGateSession = session; return next(); }
  // Only a genuine page navigation gets the Basic challenge; the app's XHR and
  // images get a plain JSON 401, so the browser does not pop its password dialog
  // on every background request (wantsBasicChallenge above).
  if (wantsBasicChallenge(req)) res.set('WWW-Authenticate', 'Basic realm="Epic", charset="UTF-8"');
  return res.status(401).json({ error: 'coming_soon', message: 'Epic is not open yet.' });
}
