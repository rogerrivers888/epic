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

const GATE_OFF = new Set(['off', 'false', '0', 'no']);

export function siteGateOn() {
  const v = String(process.env.SITE_GATE ?? '').trim().toLowerCase();
  if (v === '') return true;
  return !GATE_OFF.has(v);
}

