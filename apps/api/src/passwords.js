/**
 * Hashing a password, and checking one (Website & Registration L1–L4).
 *
 * argon2id where the runtime has it, scrypt where it does not, and nothing from
 * npm: Node grew a native `crypto.argon2` in 24.7, but production's Node is not
 * pinned (`engines >=20`), so the same deploy may land on a runtime with only
 * scrypt. Either is a memory-hard KDF fit for passwords.
 *
 * The stored string names its own algorithm and parameters
 * (`argon2id$m=19456,t=2,p=1$<salt>$<hash>`, `scrypt$N=32768,r=8,p=1$<salt>$<hash>`),
 * so a hash made on one runtime verifies on any other that has that algorithm,
 * and the parameters can be raised later without invalidating what is stored.
 * The one thing it cannot do is verify an argon2id hash on a runtime without
 * argon2 — that answers false (a wrong password, never a 500), and the person
 * resets. Do not move production to an older Node once argon2 hashes exist.
 *
 * Rules: at least ten characters and nothing else (handoff). The handoff also
 * asks for a breached-password check "if one is available"; none is — there is
 * no offline list in the repo and a call to a third party with (a prefix of) the
 * hash is a provider integration nobody has approved — so none is made.
 */

import crypto from 'node:crypto';
import { promisify } from 'node:util';

export const MIN_PASSWORD = 10;

// OWASP's argon2id floor (19 MiB, two passes, one lane) and scrypt's N=2^15.
const ARGON = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 };
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64 };
const SALT_BYTES = 16;
// scrypt needs 128·N·r bytes; Node's default ceiling (32 MiB) is exactly that and
// refuses it, so the ceiling is set with room to spare.
const scryptMaxmem = ({ N, r }) => 256 * N * r;

const scryptAsync = promisify(crypto.scrypt);
const argon2Async = typeof crypto.argon2 === 'function' ? promisify(crypto.argon2) : null;
export const hasArgon2 = () => Boolean(argon2Async);

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const unb64 = (s) => Buffer.from(String(s), 'base64url');

const parseParams = (text) => Object.fromEntries(
  String(text).split(',').map((kv) => kv.split('=')).filter(([k, v]) => k && v && /^\d+$/.test(v)).map(([k, v]) => [k, Number(v)]),
);

async function argon2id(password, salt, { memory, passes, parallelism, tagLength }) {
  return argon2Async('argon2id', { message: Buffer.from(password, 'utf8'), nonce: salt, memory, passes, parallelism, tagLength });
}

async function scrypt(password, salt, { N, r, p, keylen }) {
  return scryptAsync(Buffer.from(password, 'utf8'), salt, keylen, { N, r, p, maxmem: scryptMaxmem({ N, r }) });
}

/** argon2id when the runtime has it. Exported apart so a test can pin the fallback. */
export async function hashWithScrypt(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await scrypt(String(password), salt, SCRYPT);
  return `scrypt$N=${SCRYPT.N},r=${SCRYPT.r},p=${SCRYPT.p}$${b64(salt)}$${b64(key)}`;
}

export async function hashWithArgon2(password) {
  if (!argon2Async) throw new Error('this Node has no crypto.argon2');
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = await argon2id(String(password), salt, ARGON);
  return `argon2id$m=${ARGON.memory},t=${ARGON.passes},p=${ARGON.parallelism}$${b64(salt)}$${b64(key)}`;
}

/**
 * New hashes are scrypt, on every runtime. Argon2id is only in Node 24.7+, and
 * the API's engines allow 20: a hash written on a newer Node would not verify
 * after a deploy onto an older one, and every password set in between would read
 * as wrong (Codex, 1 Oct 2026). scrypt is in every Node this runs on. An argon2
 * hash is still verified where the runtime can, since the stored string names
 * its own algorithm.
 */
export function hashPassword(password) {
  return hashWithScrypt(password);
}

/**
 * Does this password match what is stored? Never throws for a bad or foreign
 * stored string — that is a "no", like a wrong password. The comparison is
 * constant-time over equal-length buffers.
 */
export async function verifyPassword(password, stored) {
  try {
    const [algo, paramText, saltText, hashText] = String(stored ?? '').split('$');
    if (!algo || !paramText || !saltText || !hashText) return false;
    const params = parseParams(paramText);
    const salt = unb64(saltText);
    const expected = unb64(hashText);
    if (!salt.length || !expected.length) return false;
    let got;
    if (algo === 'argon2id') {
      if (!argon2Async || !params.m || !params.t || !params.p) return false;
      got = await argon2id(String(password ?? ''), salt, { memory: params.m, passes: params.t, parallelism: params.p, tagLength: expected.length });
    } else if (algo === 'scrypt') {
      if (!params.N || !params.r || !params.p) return false;
      got = await scrypt(String(password ?? ''), salt, { N: params.N, r: params.r, p: params.p, keylen: expected.length });
    } else {
      return false;
    }
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  } catch {
    return false;
  }
}

/**
 * A hash of nothing in particular, made once, for the login door to verify
 * against when there is no account or no password — so "no such account" takes
 * as long as "wrong password" and the timing cannot tell them apart.
 */
let dummy;
export function dummyHash() {
  if (!dummy) dummy = hashPassword(crypto.randomBytes(18).toString('base64url'));
  return dummy;
}
