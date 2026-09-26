/**
 * The stored quote reaches the reviewer — routes/filing.js `candidateRow`.
 *
 * Migration 247 stored the feature pass's evidence quote so the person
 * approving a word could read why it was raised. The mapping that builds a
 * candidate for the screen was still `quotes: []`, so the quote was stored
 * and never shown (Codex, 25 Sep 2026).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { pool } = await testDatabase();
const { candidateRow, provenanceOf } = await import('../src/routes/filing.js');

test.after(() => pool.end());

test('a stored quote is a quote the screen can show, with its place and source', () => {
  const row = candidateRow({
    id: 1, norm: 'trig point', raw_forms: ['Trig point'], subcategory: 'hills', places_seen: 4, places_total: 20,
    sources: { features: 4 }, examples: ['atlas:1'], status: 'new', kind: 'feature', asserts: 4, denies: 0, asks: 0,
    evidence: 'A trig point marks the summit', evidence_ref: 'atlas:1', evidence_at: new Date().toISOString(),
  });
  assert.deepEqual(row.quotes, [{ text: 'A trig point marks the summit', place: 'atlas:1', source: 'features' }]);
});

test('no quote is no quotes, not a blank one', () => {
  const row = candidateRow({
    id: 2, norm: 'wave machine', raw_forms: ['wave machine'], subcategory: 'pools', places_seen: 2, places_total: 20,
    sources: { google: 2 }, examples: [], status: 'unresolved', kind: 'unclear', asserts: 2, denies: 0, asks: 0,
    evidence: null, evidence_ref: null, evidence_at: null,
  });
  assert.deepEqual(row.quotes, []);
});

test('a source is named in plain words and never pluralised by an added s (F4, 26 Sep 2026)', () => {
  // "2 featuress" was the feature harvest's key with an s on the end.
  assert.equal(provenanceOf({ places_seen: 2, places_total: 20, sources: { features: 2 } }),
    'seen in 2 of 20 read · 2 from the feature harvest');
  assert.equal(provenanceOf({ places_seen: 3, places_total: 60, sources: { site: 2, osm: 1, wikipedia: 1 } }),
    'seen in 3 of 60 read · 2 from venue pages · 1 from OSM tags · 1 from Wikipedia');
  // A source nobody has named yet is shown by its key, as it is.
  assert.equal(provenanceOf({ places_seen: 1, places_total: 5, sources: { newsource: 3 } }),
    'seen in 1 of 5 read · 3 from newsource');
  // Reviews are rented and never counted as a confirming source.
  assert.equal(provenanceOf({ places_seen: 1, places_total: 5, sources: { google: 4 } }), 'seen in 1 of 5 read');
});
