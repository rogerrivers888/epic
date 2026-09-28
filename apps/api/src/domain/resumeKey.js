/**
 * The census resume key, held as a hash (owner, 28 Sep 2026, G10).
 *
 * The key exists to separate the owner from the agents, who share his
 * passcode (routes/placeIndex.js, the resume route). Held in plain text it
 * separated nobody: Doppler syncs it into the Railway service, and any session
 * on the owner's machine could read it with `railway variables` or from the
 * running process. So what the server holds is a salted scrypt hash, and
 * reading it gives nothing that can resume a run.
 *
 * The form is `scrypt$<N>$<r>$<p>$<salt>$<hash>`, salt and hash in base64url,
 * so the cost travels with the hash and can be raised later without breaking
 * the ones already set. A slow hash only protects a key worth guessing slowly:
 * the command that makes it (`scripts/census-resume-hash.mjs`) refuses a short
 * passphrase.
 *
 * Imports nothing but node:crypto, so the route and the local command share it.
 */

import { randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 32;
// scrypt needs 128 · N · r bytes; the default ceiling is 32 MB, exactly that.
const maxmem = (n, r) => 256 * n * r;

export const MIN_PASSPHRASE = 20;

export function hashResumeKey(passphrase, { salt = randomBytes(16), n = N, r = R, p = P } = {}) {
  const hash = scryptSync(String(passphrase).normalize('NFC'), salt, KEYLEN, { N: n, r, p, maxmem: maxmem(n, r) });
  return ['scrypt', n, r, p, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

/**
 * A stored value taken apart and checked, or null.
 *
 * One reading for the check and for the guard's own report, so the report can
 * never call a value healthy that the check would refuse (Codex, 28 Sep 2026).
 * The cost is bounded as a whole, not per factor: verification runs on the
 * request thread, and a mistyped hash naming N 2^20 and r 32 would ask for
 * 4 GB before it answered no. Anything past these is refused outright.
 */
const LIMITS = { minN: 2 ** 14, maxN: 2 ** 17, maxR: 16, maxP: 2, maxMem: 64 * 1024 * 1024, minSalt: 8 };
export function parseHash(stored) {
  const parts = String(stored ?? '').trim().split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  if (![n, r, p].every((x) => Number.isInteger(x) && x > 0)) return null;
  if ((n & (n - 1)) !== 0 || n < LIMITS.minN || n > LIMITS.maxN || r > LIMITS.maxR || p > LIMITS.maxP) return null;
  if (128 * n * r > LIMITS.maxMem) return null;
  // scrypt's own rule, N < 2^(16·r): N 65536 with r 1 is well formed and
  // cannot be computed, so the report must not call it healthy (Codex, 28 Sep 2026).
  if (n >= 2 ** (16 * r)) return null;
  if (!/^[\w-]+$/.test(parts[4]) || !/^[\w-]+$/.test(parts[5])) return null;
  const salt = Buffer.from(parts[4], 'base64url');
  const hash = Buffer.from(parts[5], 'base64url');
  if (salt.length < LIMITS.minSalt || hash.length !== KEYLEN) return null;
  return { n, r, p, salt, hash };
}

/**
 * Whether `given` is the passphrase behind `stored`. False, never a throw, for
 * a stored value that does not parse: a mistyped Doppler value must refuse
 * every resume, not open them all.
 *
 * Asynchronous: the hash is slow on purpose, and on the request thread every
 * wrong guess would stall the whole API while it ran (Codex, 28 Sep 2026).
 * `scrypt` runs on the thread pool; the route also limits the attempts.
 */
export async function verifyResumeKey(given, stored) {
  const h = parseHash(stored);
  if (!h) return false;
  // `scrypt` throws synchronously on parameters it rejects, before any
  // callback: caught here, so a value the parser missed still fails closed
  // rather than becoming a server error.
  const got = await new Promise((resolve) => {
    try {
      scrypt(String(given ?? '').normalize('NFC'), h.salt, KEYLEN, { N: h.n, r: h.r, p: h.p, maxmem: maxmem(h.n, h.r) },
        (err, key) => resolve(err ? null : key));
    } catch { resolve(null); }
  });
  return Boolean(got) && timingSafeEqual(got, h.hash);
}

/** Whether a stored value is a hash this module can check — for the guard's own report. */
export const looksLikeHash = (stored) => parseHash(stored) !== null;
