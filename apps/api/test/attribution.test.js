import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creditFor } from '../src/routes/inspire.js';

/**
 * Who a swept place is credited to.
 *
 * The home screen credited every swept restaurant to "OpenStreetMap
 * contributors, ODbL" from a constant, and on production all 150 rows around
 * Henley are keyed on a Google identifier — so the open map was being thanked
 * for names it had never held (Codex, 8 Sep 2026). A constant cannot be wrong
 * in an interesting way, which is why it survived; these say what the rule is.
 */

const LINES = { osm: 'OpenStreetMap contributors, ODbL', google: 'Google' };

test('a place is credited to the sources that actually contributed to it', () => {
  assert.deepEqual(creditFor(['osm'], 'osm:node/1', LINES), ['OpenStreetMap contributors, ODbL']);
  assert.deepEqual(creditFor(['google'], 'google:abc', LINES), ['Google']);
  assert.deepEqual(creditFor(['osm', 'google'], 'google:abc', LINES),
    ['OpenStreetMap contributors, ODbL', 'Google']);
});

test('the open map is never thanked for a name it never held', () => {
  // The exact fault: a Google-only row must not carry the OSM line.
  const credit = creditFor(['google'], 'google:abc', LINES);
  assert.ok(!credit.some((c) => /OpenStreetMap/.test(c)));
});

test('a row swept before provenance was recorded is read from its identifier', () => {
  // Migration 072 backfills these, but a row written by an older API in the
  // window between deploys has an empty array and must still credit honestly.
  assert.deepEqual(creditFor([], 'google:abc', LINES), ['Google']);
  assert.deepEqual(creditFor(null, 'osm:way/2', LINES), ['OpenStreetMap contributors, ODbL']);
});

test('a source we cannot name is still somebody, never an empty credit', () => {
  assert.deepEqual(creditFor([], 'mystery:1', LINES), ['Sources listed in Settings']);
  assert.deepEqual(creditFor([], '', LINES), ['Sources listed in Settings']);
});

test('one source is credited once, however many ways it contributed', () => {
  assert.deepEqual(creditFor(['google', 'google'], 'google:abc', LINES), ['Google']);
});
