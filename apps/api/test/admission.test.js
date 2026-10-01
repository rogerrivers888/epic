/**
 * Admission as the owned cost-band answer (sources/admission.js; owner, 1 Oct 2026,
 * parks admission). The venue's own page is a source we may read and keep, so a free
 * or priced entry read from it is written as the owned `cost-band` answer the drawer's
 * cost row prefers over Google (B11). "Free entry" is the high-value case — it is
 * exactly what Google has no price level for.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const index = await import('../src/repositories/placeIndex.js');
const admission = await import('../src/sources/admission.js');
const { ownedCostBand } = await import('../src/repositories/questionSets.js');
test.after(() => pool.end());

const GB_BANDS = [
  { symbol: 'Free', min: 0, max: 0 },
  { symbol: '£', min: 1, max: 1000 },
  { symbol: '££', min: 1000, max: 2500 },
  { symbol: '£££', min: 2500, max: null },
];

test('admissionMinor reads the number out of a written price', () => {
  assert.equal(admission.admissionMinor('£32.00'), 3200);
  assert.equal(admission.admissionMinor('£14.50'), 1450);
  assert.equal(admission.admissionMinor('14.50'), 1450);
  assert.equal(admission.admissionMinor('£8'), 800);
  assert.equal(admission.admissionMinor('£14.50 online, £16.50 on the day'), 1450, 'the first (lower) price, as shown');
  assert.equal(admission.admissionMinor(null), null);
  assert.equal(admission.admissionMinor('free'), null, 'no number to read');
});

test('admissionToAnswer maps free, priced, and nothing-bandable', () => {
  assert.deepEqual(admission.admissionToAnswer(null, GB_BANDS), { state: 'asked_nothing_found' });
  assert.deepEqual(admission.admissionToAnswer({ free: true }, GB_BANDS), { state: 'answered', choice: 'free' });
  assert.deepEqual(admission.admissionToAnswer({ adult: '£8.50' }, GB_BANDS), { state: 'answered', choice: 'cheap' }, '850p is £ = cheap');
  assert.deepEqual(admission.admissionToAnswer({ adult: '£20.00' }, GB_BANDS), { state: 'answered', choice: 'moderate' }, '2000p is ££ = moderate');
  assert.deepEqual(admission.admissionToAnswer({ adult: '£40.00' }, GB_BANDS), { state: 'answered', choice: 'expensive' }, '4000p is £££ = expensive');
  assert.deepEqual(admission.admissionToAnswer({ note: 'varies by season' }, GB_BANDS), { state: 'asked_nothing_found' }, 'a charge we cannot band is not an answer');
  assert.deepEqual(admission.admissionToAnswer({ adult: '£8.50' }, null), { state: 'asked_nothing_found' }, 'no market bands to band it against');
});

async function seedPlace(ref, countryCode = 'GB') {
  await index.noteMany([{ ref, lat: 51.5, lng: -0.6, countryCode }], { source: 'osm' });
}

test('recordAdmissionAnswer writes a free entry as the owned cost-band answer', async (t) => {
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

test('recordAdmissionAnswer bands a priced entry against the place market', async () => {
  const ref = 'osm:node/adm-priced';
  await seedPlace(ref, 'GB');
  const out = await admission.recordAdmissionAnswer(ref, { adult: '£20.00', free: false }, { sourceUrl: 'https://zoo.example' });
  assert.deepEqual(out, { state: 'answered', choice: 'moderate' });
  assert.equal(await ownedCostBand(ref), 'moderate');
});

test('recordAdmissionAnswer records a page that said nothing as asked_nothing_found', async () => {
  const ref = 'osm:node/adm-silent';
  await seedPlace(ref);
  const out = await admission.recordAdmissionAnswer(ref, null, { sourceUrl: 'https://quiet.example' });
  assert.deepEqual(out, { state: 'asked_nothing_found' });
  assert.equal(await ownedCostBand(ref), null, 'no answered choice, so the cost row falls back to Google');
  const { rows: [a] } = await query(`select state, choice from place_answers where venue_ref = $1`, [ref]);
  assert.equal(a.state, 'asked_nothing_found', 'a real answer: we looked and nothing said so');
  assert.equal(a.choice, null);
});
