import test from 'node:test';
import assert from 'node:assert/strict';
import { PLACES, belongs } from '../src/sources/postcodeAreas.js';

/**
 * Which postcode districts a sweep covers when somebody asks for a place by
 * name. The answers below are what ONS actually returns for these outcodes,
 * read from postcodes.io on 13 September 2026.
 */

const ons = {
  BS1: { code: 'BS1', districts: ['Bristol, City of'], counties: [] },
  BS16: { code: 'BS16', districts: ['Bristol, City of', 'South Gloucestershire'], counties: [] },
  BS22: { code: 'BS22', districts: ['North Somerset'], counties: [] },
  BS31: { code: 'BS31', districts: ['Bath and North East Somerset', 'Bristol, City of', 'South Gloucestershire'], counties: [] },
  BS40: { code: 'BS40', districts: ['Bath and North East Somerset', 'North Somerset', 'Somerset'], counties: [] },
  BA1: { code: 'BA1', districts: ['Bath and North East Somerset'], counties: [] },
  GU1: { code: 'GU1', districts: ['Guildford'], counties: ['Surrey'] },
};

test('Bristol is the city and the three unitaries around it', () => {
  const bristol = PLACES.bristol;
  assert.equal(bristol.label, 'Bristol');
  for (const code of ['BS1', 'BS16', 'BS22', 'BS31', 'BS40']) {
    assert.equal(belongs(ons[code], bristol), true, `${code} should be swept for Bristol`);
  }
});

test('Bath is kept out of Bristol by the area list, not by its district', () => {
  // BA1 is in Bath and North East Somerset, which Bristol names — so the
  // district test alone would take it. The area list is what stops it: the
  // enumeration only ever walks BS, so BA1 is never a candidate.
  assert.equal(belongs(ons.BA1, PLACES.bristol), true);
  assert.deepEqual(PLACES.bristol.areas, ['BS']);
  assert.equal(PLACES.bristol.areas.includes('BA'), false);
});

test('a place is not taken by another place’s districts', () => {
  assert.equal(belongs(ons.BS1, PLACES.surrey), false);
  assert.equal(belongs(ons.GU1, PLACES.bristol), false);
  assert.equal(belongs(ons.GU1, PLACES.surrey), true);
});

test('every place names either counties or districts, and some postcode areas', () => {
  for (const [key, place] of Object.entries(PLACES)) {
    assert.ok(place.areas.length, `${key} has no postcode areas`);
    assert.ok(place.counties.length || place.districts.length, `${key} has nothing to belong to`);
  }
});
