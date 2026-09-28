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

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

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
 * Whether `given` is the passphrase behind `stored`. False, never a throw, for
 * a stored value that is not in the form above: a mistyped Doppler value must
 * refuse every resume, not open them all.
 */
export function verifyResumeKey(given, stored) {
  const parts = String(stored ?? '').trim().split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  if (![n, r, p].every((x) => Number.isInteger(x) && x > 0) || n > 2 ** 20 || r > 32 || p > 16) return false;
  const salt = Buffer.from(parts[4], 'base64url');
  const want = Buffer.from(parts[5], 'base64url');
  if (!salt.length || want.length !== KEYLEN) return false;
  let got;
  try {
    got = scryptSync(String(given ?? '').normalize('NFC'), salt, KEYLEN, { N: n, r, p, maxmem: maxmem(n, r) });
  } catch { return false; }
  return timingSafeEqual(got, want);
}

/** Whether a stored value is a hash this module can check — for the guard's own report. */
export const looksLikeHash = (stored) => /^scrypt\$\d+\$\d+\$\d+\$[\w-]+\$[\w-]+$/.test(String(stored ?? '').trim());
