/**
 * Word error rate and the plan diff — the two measures the voice experiment is
 * judged on (domain/wer.js). A wrong WER would make one capture mode look
 * better than it is and ship the wrong default.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { planDiff, wer, words } from '../src/domain/wer.js';

test('punctuation and case are not errors', () => {
  assert.deepEqual(words('Sintra, and Alfama!'), ['sintra', 'and', 'alfama']);
  assert.equal(wer('We want to see Sintra.', 'we want to see sintra').wer, 0);
});

test('the three kinds of wrong are counted apart', () => {
  const r = wer('four nights in Lisbon from the fifteenth', 'for nights in Lisbon the fifteenth please');
  assert.equal(r.substitutions, 1, 'four → for');
  assert.equal(r.deletions, 1, 'from dropped');
  assert.equal(r.insertions, 1, 'please added');
  assert.equal(r.errors, 3);
  assert.equal(r.words, 7);
  assert.equal(r.wer, Math.round((3 / 7) * 1000) / 1000);
});

test('a place name misheard is one substitution, which is the whole point', () => {
  const r = wer('a day out to Machynlleth by train', 'a day out to mac and cleth by train');
  assert.ok(r.wer > 0, 'not the same');
  assert.equal(wer('a day out to Machynlleth by train', 'a day out to Machynlleth by train').wer, 0);
});

test('empty references', () => {
  assert.equal(wer('', '').wer, 0);
  assert.equal(wer('', 'anything at all').wer, 1);
  assert.equal(wer('something', '').wer, 1);
});

test('the plan diff names the fields that moved and ignores the sentence about them', () => {
  const a = { destination: 'Lisbon', dates: { start: '2026-10-15', end: null }, party: { adults: 2 }, summary: 'Lisbon in October.' };
  const b = { destination: 'Lisbon', dates: { start: '2026-10-14', end: null }, party: { adults: 2 }, summary: 'A trip to Lisbon.' };
  const d = planDiff(a, b);
  assert.equal(d.changed, true);
  assert.deepEqual(d.fields.map((f) => f.field), ['dates.start']);
  assert.equal(planDiff(a, { ...a, summary: 'Different words.' }).changed, false);
});
