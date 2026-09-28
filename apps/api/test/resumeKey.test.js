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
const { resumeGuard, resumeKeyAccepted } = await import('../src/routes/placeIndex.js');
test.after(() => pool.end());

// Cheap parameters for the test only; the command uses the real cost.
const quick = { n: 2 ** 10 };
const PHRASE = 'harbour lantern oatmeal quiet bicycle';

test('the hash opens with its passphrase and nothing else', () => {
  const stored = hashResumeKey(PHRASE, quick);
  assert.ok(looksLikeHash(stored));
  assert.ok(!stored.includes(PHRASE), 'the passphrase is not in what is stored');
  assert.equal(verifyResumeKey(PHRASE, stored), true);
  assert.equal(verifyResumeKey(`${PHRASE} `, stored), false);
  assert.equal(verifyResumeKey('', stored), false);
  assert.notEqual(hashResumeKey(PHRASE, quick), stored, 'salted: the same passphrase never makes the same hash');
});

test('a hash nobody can read refuses every resume rather than opening them all', () => {
  for (const bad of ['', 'scrypt', 'scrypt$1024$8$1$$', 'md5$x$y$z$a$b', 'scrypt$99999999$8$1$c2FsdA$aGFzaA', PHRASE]) {
    assert.equal(verifyResumeKey(PHRASE, bad), false, bad);
  }
  const g = resumeGuard({ EPIC_CENSUS_RESUME_KEY_HASH: 'not a hash' });
  assert.equal(g.kind, 'hash');
  assert.equal(g.malformed, true);
  assert.equal(resumeKeyAccepted(g, PHRASE), false);
});

test('the hash wins over the plain key, and the plain key works only while no hash is set', () => {
  const hash = hashResumeKey(PHRASE, quick);
  const both = resumeGuard({ EPIC_CENSUS_RESUME_KEY_HASH: hash, EPIC_CENSUS_RESUME_KEY: 'old-plain-key' });
  assert.equal(both.kind, 'hash');
  assert.equal(resumeKeyAccepted(both, 'old-plain-key'), false, 'the old key stops working the moment the hash is set');
  assert.equal(resumeKeyAccepted(both, PHRASE), true);

  const plain = resumeGuard({ EPIC_CENSUS_RESUME_KEY: 'old-plain-key' });
  assert.equal(plain.kind, 'plain');
  assert.equal(resumeKeyAccepted(plain, 'old-plain-key'), true);
  assert.equal(resumeKeyAccepted(plain, 'wrong'), false);

  const none = resumeGuard({});
  assert.equal(none.kind, 'none');
  assert.equal(resumeKeyAccepted(none, undefined), true, 'unset is confirmation only, as the route says');
});

test('the real cost fits the default memory ceiling', () => {
  const stored = hashResumeKey(PHRASE);
  assert.match(stored, /^scrypt\$32768\$8\$1\$/);
  assert.equal(verifyResumeKey(PHRASE, stored), true);
});
