/**
 * The census resume key is held as a hash (G10, 28 Sep 2026).
 *
 * The plain key could be read by any session on the owner's machine through
 * the Railway CLI, so it separated nobody from the agents it was meant to
 * keep out. These pin the hash, the route's guard, and the order it is
 * read in: the hash wins, the plain key only while no hash is set.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { pool } = await testDatabase();
const { hashResumeKey, verifyResumeKey, looksLikeHash } = await import('../src/domain/resumeKey.js');
const { resumeGuard, resumeKeyAccepted, reserveResumeAttempt, releaseResumeAttempt } = await import('../src/routes/placeIndex.js');
test.after(() => pool.end());

// The cheapest cost the parser accepts; the command uses the real one.
const quick = { n: 2 ** 14 };
const PHRASE = 'harbour lantern oatmeal quiet bicycle';

test('the hash opens with its passphrase and nothing else', async () => {
  const stored = hashResumeKey(PHRASE, quick);
  assert.ok(looksLikeHash(stored));
  assert.ok(!stored.includes(PHRASE), 'the passphrase is not in what is stored');
  assert.equal(await verifyResumeKey(PHRASE, stored), true);
  assert.equal(await verifyResumeKey(`${PHRASE} `, stored), false);
  assert.equal(await verifyResumeKey('', stored), false);
  assert.notEqual(hashResumeKey(PHRASE, quick), stored, 'salted: the same passphrase never makes the same hash');
});

test('a hash nobody can read refuses every resume rather than opening them all', async () => {
  for (const bad of ['', 'scrypt', 'scrypt$1024$8$1$$', 'md5$x$y$z$a$b', 'scrypt$99999999$8$1$c2FsdA$aGFzaA', PHRASE]) {
    assert.equal(await verifyResumeKey(PHRASE, bad), false, bad);
  }
  const g = resumeGuard({ EPIC_CENSUS_RESUME_KEY_HASH: 'not a hash' });
  assert.equal(g.kind, 'hash');
  assert.equal(g.malformed, true);
  assert.equal(await resumeKeyAccepted(g, PHRASE), false);
});

test('the hash wins over the plain key, and the plain key works only while no hash is set', async () => {
  const hash = hashResumeKey(PHRASE, quick);
  const both = resumeGuard({ EPIC_CENSUS_RESUME_KEY_HASH: hash, EPIC_CENSUS_RESUME_KEY: 'old-plain-key' });
  assert.equal(both.kind, 'hash');
  assert.equal(await resumeKeyAccepted(both, 'old-plain-key'), false, 'the old key stops working the moment the hash is set');
  assert.equal(await resumeKeyAccepted(both, PHRASE), true);

  const plain = resumeGuard({ EPIC_CENSUS_RESUME_KEY: 'old-plain-key' });
  assert.equal(plain.kind, 'plain');
  assert.equal(await resumeKeyAccepted(plain, 'old-plain-key'), true);
  assert.equal(await resumeKeyAccepted(plain, 'wrong'), false);

  const none = resumeGuard({});
  assert.equal(none.kind, 'none');
  assert.equal(await resumeKeyAccepted(none, undefined), true, 'unset is confirmation only, as the route says');
});

test('the real cost fits the default memory ceiling', async () => {
  const stored = hashResumeKey(PHRASE);
  assert.match(stored, /^scrypt\$32768\$8\$1\$/);
  assert.equal(await verifyResumeKey(PHRASE, stored), true);
});

test('the report and the check read a hash the same way, and an impractical cost is refused outright', async () => {
  // Codex, 28 Sep 2026: the right shape with a short hash was reported healthy
  // while every check refused it; and a cost of N 2^20, r 32 would ask the
  // request thread for 4 GB before answering.
  const { parseHash } = await import('../src/domain/resumeKey.js');
  const good = hashResumeKey(PHRASE, quick);
  assert.ok(parseHash(good));
  const [, , , , salt, hash] = good.split('$');
  const cases = {
    shortHash: `scrypt$32768$8$1$${salt}$aGFzaA`,
    shortSalt: `scrypt$32768$8$1$c2FsdA$${hash}`,
    notPowerOfTwo: `scrypt$30000$8$1$${salt}$${hash}`,
    hugeMemory: `scrypt$1048576$32$1$${salt}$${hash}`,
    tooManyP: `scrypt$32768$8$16$${salt}$${hash}`,
    tooCheap: `scrypt$1024$8$1$${salt}$${hash}`,
  };
  for (const [why, value] of Object.entries(cases)) {
    assert.equal(looksLikeHash(value), false, why);
    assert.equal(resumeGuard({ EPIC_CENSUS_RESUME_KEY_HASH: value }).malformed, true, why);
    assert.equal(await verifyResumeKey(PHRASE, value), false, why);
  }
});

test('the key has its own attempt limit, and a check never holds the request thread', async () => {
  // Codex, 28 Sep 2026: scryptSync on the request thread let a burst of wrong
  // keys stall the whole API.
  const who = 'test-session-attempts';
  const t0 = Date.now();
  // Five taken at once — as five requests arriving together would — and the sixth refused.
  const taken = [0, 1, 2, 3, 4].map((i) => reserveResumeAttempt(who, t0 + i));
  assert.ok(taken.every((x) => x != null));
  assert.equal(reserveResumeAttempt(who, t0 + 5), null, 'the sixth in fifteen minutes is refused before hashing, however they arrive');
  // A right key hands its attempt back.
  releaseResumeAttempt(who, taken[4]);
  assert.notEqual(reserveResumeAttempt(who, t0 + 6), null);
  assert.notEqual(reserveResumeAttempt('another-session', t0 + 7), null, 'one session\u2019s misses are not another\u2019s');
  assert.notEqual(reserveResumeAttempt(who, t0 + 16 * 60_000), null, 'and allowed again once the window has passed');

  const stored = hashResumeKey(PHRASE);
  let ticks = 0;
  const timer = setInterval(() => { ticks += 1; }, 5);
  await verifyResumeKey('wrong guess', stored);
  clearInterval(timer);
  assert.ok(ticks > 0, 'the event loop kept turning while the hash ran');
});
