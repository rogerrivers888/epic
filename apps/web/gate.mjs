/**
 * The launch gate, web side (server.mjs).
 *
 * The web app is served as a single-page bundle and decides for itself what an
 * un-signed-in visitor sees (the lock / coming-soon screen); the real wall is the
 * API, which refuses the world every data route until launch (apps/api/src/siteGate.js).
 * So the web service's only job while the gate is up is to keep the unopened site
 * out of search indexes — `X-Robots-Tag: noindex` on every response — and to leave
 * `/health` open so Railway's deploy check passes. No dependency: it is one
 * function and a string, in keeping with server.mjs.
 *
 * `SITE_GATE` unset means ON, so the noindex cannot fall off because a variable
 * was forgotten. Only an explicit off word lifts it.
 */

import { timingSafeEqual } from 'node:crypto';

const GATE_OFF = new Set(['off', 'false', '0', 'no']);

export function siteGateOn() {
  const v = String(process.env.SITE_GATE ?? '').trim().toLowerCase();
  if (v === '') return true;
  return !GATE_OFF.has(v);
}

/**
 * The public website while the gate is up (owner, 2 Oct 2026: "Keep the
 * Basic-Auth site gate on. The site doesn't go public until I've replaced the
 * placeholder privacy wording.").
 *
 * The marketing pages draw without a single API call, so the API's gate
 * (apps/api/src/siteGate.js) never sees them. Here they ask for the same Basic
 * credentials the API's gate takes — `GATE_USER` / `GATE_PASSWORD` — and with
 * those not configured on this service the site is simply not there (404):
 * a gate with no password admits nobody, never everybody. With the gate off
 * this answers "open" whatever is set.
 *
 * Returns null to let the page through, or the status to answer with.
 */
export function siteLock(req) {
  if (!siteGateOn()) return null;
  const user = process.env.GATE_USER;
  const pass = process.env.GATE_PASSWORD;
  if (!user || !pass) return { status: 404 };
  const [scheme, encoded] = String(req.headers.authorization || '').split(' ');
  let decoded = '';
  if (scheme?.toLowerCase() === 'basic' && encoded) {
    try { decoded = Buffer.from(encoded, 'base64').toString('utf8'); } catch { decoded = ''; }
  }
  const i = decoded.indexOf(':');
  const okUser = sameSecret(i < 0 ? '' : decoded.slice(0, i), user);
  const okPass = sameSecret(i < 0 ? '' : decoded.slice(i + 1), pass);
  return okUser && okPass && i >= 0 ? null : { status: 401 };
}

/** A constant-time compare that is not quicker for a wrong length. */
function sameSecret(given, expected) {
  const a = Buffer.from(String(given ?? ''), 'utf8');
  const b = Buffer.from(String(expected ?? ''), 'utf8');
  if (a.length !== b.length) { timingSafeEqual(b, b); return false; }
  return timingSafeEqual(a, b);
}
