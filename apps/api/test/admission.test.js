/**
 * Admission as the owned cost-band answer (sources/admission.js; owner, 1 Oct 2026,
 * parks admission). The venue's own page is a source we may read and keep, so "free
 * entry" read from it is written as the owned `cost-band` answer the drawer's cost row
 * prefers over Google (B11). Only the free case is stored — it is market-agnostic and
 * never stale, and it is exactly what Google has no price level for; a priced entry is
 * left to Google's level.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const index = await import('../src/repositories/placeIndex.js');
const admission = await import('../src/sources/admission.js');
const { ownedCostBand, saveAnswer } = await import('../src/repositories/questionSets.js');
test.after(() => pool.end());

test('admissionToAnswer stores only free; everything else is asked_nothing_found', () => {
  assert.deepEqual(admission.admissionToAnswer({ free: true }), { state: 'answered', choice: 'free' });
  assert.deepEqual(admission.admissionToAnswer(null), { state: 'asked_nothing_found' }, 'a page with no admission');
  assert.deepEqual(admission.admissionToAnswer({ adult: '£20.00', free: false }), { state: 'asked_nothing_found' }, 'a charge is left to Google, not banded here');
  assert.deepEqual(admission.admissionToAnswer({ note: 'varies' }), { state: 'asked_nothing_found' });
});

const seedPlace = (ref, countryCode = 'GB') => index.noteMany([{ ref, lat: 51.5, lng: -0.6, countryCode }], { source: 'osm' });
const costBandQuestionId = async () => (await query(`select id from questions where attribute_key = 'cost-band' and scope = 'global' order by id limit 1`)).rows[0]?.id;

test('recordAdmissionAnswer writes a free entry as the owned cost-band answer', async () => {
  const ref = 'osm:node/adm-free';
  await seedPlace(ref);
  const out = await admission.recordAdmissionAnswer(ref, { free: true }, { sourceUrl: 'https://park.example/visit' });
  assert.deepEqual(out, { state: 'answered', choice: 'free' });
  assert.equal(await ownedCostBand(ref), 'free', 'the drawer cost row reads it owned-first');
  const { rows: [a] } = await query(`select source, state, choice, source_url from place_answers where venue_ref = $1`, [ref]);
  assert.equal(a.source, 'site', 'from the venue page');
  assert.equal(a.choice, 'free');
  assert.equal(a.source_url, 'https://park.example/visit', 'with the page it was read from');
});

test('a priced or silent page records asked_nothing_found, and the cost row falls back', async () => {
  for (const [ref, adm] of [['osm:node/adm-priced', { adult: '£20.00', free: false }], ['osm:node/adm-silent', null]]) {
    await seedPlace(ref);
    const out = await admission.recordAdmissionAnswer(ref, adm, { sourceUrl: 'https://x.example' });
    assert.deepEqual(out, { state: 'asked_nothing_found' });
    assert.equal(await ownedCostBand(ref), null, 'no owned choice → fall back to Google');
    const { rows: [a] } = await query(`select state, choice from place_answers where venue_ref = $1`, [ref]);
    assert.equal(a.state, 'asked_nothing_found', 'a real answer: we looked and nothing established free entry');
    assert.equal(a.choice, null);
  }
});

test('a non-GB venue is skipped — the extractor only validates £', async () => {
  const ref = 'osm:node/adm-ie';
  await seedPlace(ref, 'IE');
  // Even a free claim is not trusted outside GB: a €/$ charge would go undetected.
  const out = await admission.recordAdmissionAnswer(ref, { free: true }, { sourceUrl: 'https://x.ie' });
  assert.equal(out, null, 'nothing written for a settled non-GB country');
  assert.equal(await ownedCostBand(ref), null);
  const { rows } = await query(`select 1 from place_answers where venue_ref = $1`, [ref]);
  assert.equal(rows.length, 0, 'no owned cost-band answer for a non-GB place');
});

test('a venue that later settles outside GB has its stale free answer cleared', async () => {
  const ref = 'osm:node/adm-resettle';
  await seedPlace(ref, 'GB');
  await admission.recordAdmissionAnswer(ref, { free: true }, { sourceUrl: 'https://x.example' });
  assert.equal(await ownedCostBand(ref), 'free', 'written while GB');
  // Its country is corrected to non-GB; the next research must clear the stale answer.
  await query(`update place_index set country_code = 'IE' where venue_ref = $1`, [ref]);
  const out = await admission.recordAdmissionAnswer(ref, { free: true }, { sourceUrl: 'https://x.example' });
  assert.equal(out, null, 'skipped now it is non-GB');
  assert.equal(await ownedCostBand(ref), null, 'and the stale free answer is gone');
  const { rows } = await query(`select 1 from place_answers where venue_ref = $1 and source = 'site'`, [ref]);
  assert.equal(rows.length, 0);
});

test('ownedCostBand ignores a disagreement between two owned sources', async () => {
  const ref = 'osm:node/adm-clash';
  await seedPlace(ref);
  const qid = await costBandQuestionId();
  // Two owned sources answer the cost-band differently — saveAnswer marks both
  // unresolved, and the cost row must not pick one silently (brief: "Do not pick").
  await saveAnswer({ venueRef: ref, questionId: qid, source: 'site', state: 'answered', value: { choice: 'free' } });
  await saveAnswer({ venueRef: ref, questionId: qid, source: 'wikipedia', state: 'answered', value: { choice: 'moderate' } });
  const { rows } = await query(`select unresolved from place_answers where venue_ref = $1`, [ref]);
  assert.ok(rows.every((r) => r.unresolved === true), 'both rows are marked unresolved');
  assert.equal(await ownedCostBand(ref), null, 'a disagreement shows nothing, not one side');
});
