/**
 * The catch-up loop researches on somebody's account, or not at all.
 *
 * Owner, 26 Sep 2026: "It spends with no household attached, against a
 * ceiling nobody can attribute and a cap that cannot refuse it — which is
 * exactly the hole the cap was built to close. Then attribute it properly and
 * turn it back on. Do not leave it running unattributed."
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { attributeCatchUp } from '../src/sources/own.js';

test('a claimed place is researched on its claimant\'s account, an unclaimed one on the founding household\'s', () => {
  const { queue, skipped } = attributeCatchUp(
    ['google:a', 'google:b', 'google:c'],
    { 'google:a': 'hh-1', 'google:b': 'hh-2' },
    'hh-founding');
  assert.deepEqual(queue, [['google:a', 'hh-1'], ['google:b', 'hh-2'], ['google:c', 'hh-founding']]);
  assert.deepEqual(skipped, []);
});

test('with nobody to attribute it to, a place is left unresearched rather than researched on no account', () => {
  const { queue, skipped } = attributeCatchUp(['google:a', 'google:b'], { 'google:a': 'hh-1' }, null);
  assert.deepEqual(queue, [['google:a', 'hh-1']], 'the claimed one still goes');
  assert.deepEqual(skipped, ['google:b'], 'the unclaimed one waits for a household to exist');
});

test('a version bump that only adds free facts is caught up for free, and a first research is not (26 Sep 2026)', async () => {
  const { freeBackfill, RESEARCH_VERSION, PAID_RESEARCH_VERSION, alreadyResearched } = await import('../src/sources/own.js');
  const free = freeBackfill([
    { venue_ref: 'google:old-done', enrich_state: 'done', research_version: RESEARCH_VERSION - 1, provenance: { name: 'osm' } },
    { venue_ref: 'google:old-partial', enrich_state: 'partial', research_version: 1, next_attempt_at: new Date(Date.now() + 86_400_000) },
    // Due for its own paid retry, or done without ever identifying the place:
    // those keep the retry they would have had (Codex, 26 Sep 2026).
    { venue_ref: 'google:retry-due', enrich_state: 'failed', research_version: 2, next_attempt_at: new Date(Date.now() - 1000) },
    { venue_ref: 'google:unidentified', enrich_state: 'done', research_version: 3, provenance: {}, enrich_attempts: 1 },
    { venue_ref: 'google:new', enrich_state: 'pending', research_version: 0 },
    { venue_ref: 'google:never', enrich_state: 'failed', research_version: 0 },
    { venue_ref: 'google:current', enrich_state: 'done', research_version: RESEARCH_VERSION },
    { venue_ref: 'google:scored', enrich_state: 'scored', research_version: 2 },
  ]);
  assert.deepEqual([...free].sort(), ['google:old-done', 'google:old-partial']);
  // And the paid sweep still counts a place researched at the paid version as held.
  assert.ok(PAID_RESEARCH_VERSION < RESEARCH_VERSION);
  assert.equal(alreadyResearched({ enrich_state: 'done', enriched_at: new Date(), research_version: PAID_RESEARCH_VERSION, provenance: { name: 'osm' } }), true);
});

test('a free top-up that finds nothing leaves a record that still knows the place done, so no paid retry follows (Codex, 26 Sep 2026)', async () => {
  const { outcomeState } = await import('../src/sources/own.js');
  assert.equal(outcomeState({ identified: 0, refused: true, topUp: true, provenance: { name: 'osm' } }), 'done');
  assert.equal(outcomeState({ identified: 0, refused: true, topUp: true, provenance: {} }), 'failed', 'a top-up of a record that knows nothing is not done');
  assert.equal(outcomeState({ identified: 0, refused: true, topUp: false, provenance: { name: 'osm' } }), 'failed', 'a paid pass keeps its old rule');
  assert.equal(outcomeState({ identified: 0, refused: false }), 'partial');
  assert.equal(outcomeState({ identified: 1, refused: true }), 'done');
});
