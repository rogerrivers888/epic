/**
 * Stage two's contract (domain/voiceIntent.js): the schema keeps to OpenAI's
 * strict-mode rules — which fail at the provider, not here, if broken — and
 * what comes back is tidied to Epic's own "not said is null".
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { VOICE_INTENT_SCHEMA, VOICE_INTENT_SYSTEM, normaliseVoiceIntent, schemaIsStrict, voiceIntentInput } from '../src/domain/voiceIntent.js';
import { UTTERANCES, meetsExpectation } from '../src/domain/voiceUtterances.js';

test('the intent schema is strict: every property required, nothing extra, null unions for "not said"', () => {
  const { ok, problems } = schemaIsStrict(VOICE_INTENT_SCHEMA);
  assert.deepEqual(problems, []);
  assert.equal(ok, true);
});

test('the checker catches the two mistakes strict mode rejects', () => {
  assert.equal(schemaIsStrict({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }).ok, false, 'additionalProperties missing');
  assert.equal(schemaIsStrict({ type: 'object', additionalProperties: false, properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a'] }).ok, false, 'b not required');
  assert.equal(schemaIsStrict({ type: 'object', additionalProperties: false, properties: { a: { type: ['string', 'null'] } }, required: ['a'] }).ok, true);
});

test('the rules say what the brief says', () => {
  for (const phrase of ['only what was actually said', 'null', 'final stated value', 'ambiguities', 'language of the transcript']) {
    assert.ok(VOICE_INTENT_SYSTEM.includes(phrase), `system prompt should say: ${phrase}`);
  }
  assert.ok(!/tidy the transcript|clean up|summari[sz]e the transcript/i.test(VOICE_INTENT_SYSTEM), 'stage two never asks for a tidier transcript; it reads the faithful one');
});

test('normalising: blanks become null, bad dates are dropped, lists lose blanks', () => {
  const out = normaliseVoiceIntent({
    language: 'EN', trip_type: 'multi_day', destination: ' Lisbon ', origin: '',
    dates: { start: '2026-10-15', end: 'sometime', duration_days: 4, as_said: 'the 14th — no, the 15th' },
    party: { adults: 2, children: 2, ages: [7, 10, 'x'], as_said: '' },
    budget: { amount: null, currency: 'gbp', per: '', level: null },
    interests: ['Sintra', '', ' Alfama '], exclusions: [], accessibility: null,
    ambiguities: [{ about: 'dates', question: 'This October?', options: ['Yes', 'Next year'] }, { about: 'x', question: '' }],
    corrections: [{ field: 'dates.start', from: '14th', to: '15th' }],
    summary: 'Four nights in Lisbon.',
  });
  assert.equal(out.language, 'en');
  assert.equal(out.destination, 'Lisbon');
  assert.equal(out.origin, null);
  assert.equal(out.dates.end, null);
  assert.deepEqual(out.party.ages, [7, 10]);
  assert.equal(out.party.as_said, null);
  assert.equal(out.budget.currency, 'GBP');
  assert.equal(out.budget.per, null);
  assert.deepEqual(out.interests, ['Sintra', 'Alfama']);
  assert.deepEqual(out.accessibility, []);
  assert.equal(out.ambiguities.length, 1, 'a question with no words is not a question');
  assert.equal(out.corrections[0].to, '15th');
});

test('the input carries the date, the home and the people, and the transcript last and untouched', () => {
  const t = 'Um, Lisbon — no, sorry, Porto.  Four nights.';
  const input = voiceIntentInput({ transcript: t, language: 'en', today: '2026-09-08', timezone: 'Europe/London', home: 'Reading', members: ['Roger', 'Gina'] });
  assert.ok(input.startsWith('Today is 2026-09-08 (Europe/London).'));
  assert.ok(input.includes('Reading'));
  assert.ok(input.includes('Roger, Gina'));
  assert.ok(input.endsWith(`Transcript:\n${t}`), 'the transcript is passed exactly as heard');
});

test('the lab sentences: unique ids, a language each, and the expectation check works both ways', () => {
  const ids = new Set(UTTERANCES.map((u) => u.id));
  assert.equal(ids.size, UTTERANCES.length);
  assert.ok(UTTERANCES.some((u) => u.language !== 'en'), 'not only English');
  assert.ok(UTTERANCES.some((u) => /no, sorry/.test(u.text)), 'at least one self-correction');
  const lisbon = UTTERANCES.find((u) => u.id === 'lisbon-correction');
  assert.equal(meetsExpectation({ destination: 'Lisbon, Portugal', dates: { start: '2026-10-15' }, party: { adults: 2, children: 2 } }, lisbon.expect).ok, true);
  const wrong = meetsExpectation({ destination: 'Lisbon', dates: { start: '2026-10-14' }, party: { adults: 2, children: 2 } }, lisbon.expect);
  assert.equal(wrong.ok, false);
  assert.deepEqual(wrong.misses.map((m) => m.path), ['dates.start']);
});
