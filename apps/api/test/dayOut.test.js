/**
 * The day-out test (C26, owner 26 Sep 2026): a place is in a drawer named
 * for a thing only if it has the thing. The evidence is read in order — its
 * own tags, an adjacent object, owned text, then the name provisionally — and
 * a name that says nothing fails.
 *
 * The cases are the ones the owner named: Charters, Lightwater and Horfield
 * kept; the Pilates, yoga, dojo and padel places out.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { ADJACENT_M, DRAWERS, dayOutTestOn, dayOutVerdict, namedForThing } from '../src/domain/dayOut.js';
import { boxOf, metres, selectorParts } from '../src/sources/dayOutTest.js';

const centre = (name, tags = {}) => ({ tags: { leisure: 'sports_centre', name, ...tags }, name });

test('a sports centre is in Pools only with evidence of a pool, read in order', () => {
  // Own tags first.
  assert.deepEqual(
    pick(dayOutVerdict('pools', { tags: { leisure: 'sports_centre', swimming_pool: 'yes' }, name: 'Elm Park Leisure Centre' })),
    ['kept', 'tag'],
  );
  assert.deepEqual(pick(dayOutVerdict('pools', { tags: { leisure: 'sports_centre', sport: 'swimming;fitness' }, name: 'x' })), ['kept', 'tag']);
  // Then a public pool object within reach.
  assert.deepEqual(
    pick(dayOutVerdict('pools', { tags: { leisure: 'sports_centre' }, nearby: [{ tags: { leisure: 'swimming_pool' }, name: 'the pool' }], name: 'Henbury Leisure Centre' })),
    ['kept', 'object'],
  );
  // A private pool next door is somebody's garden, not the centre's.
  assert.deepEqual(
    pick(dayOutVerdict('pools', { tags: { leisure: 'sports_centre' }, nearby: [{ tags: { leisure: 'swimming_pool', access: 'private' } }], name: 'Bristol Zen Dojo' })),
    ['out', null],
  );
  // Then owned text.
  assert.deepEqual(pick(dayOutVerdict('pools', { tags: { leisure: 'sports_centre' }, text: 'a 25m swimming pool and a gym', name: 'x' })), ['kept', 'text']);
});

test('the name keeps a place provisionally, and a name that says nothing fails', () => {
  // Charters, Lightwater and Horfield: nothing on the map says pool, the name does.
  for (const name of ['Charters Leisure Centre', 'Lightwater Leisure Centre', 'Horfield Leisure Centre', 'Clevedon Lido', 'Bristol South Baths']) {
    assert.deepEqual(pick(dayOutVerdict('pools', { tags: { leisure: 'sports_centre' }, name })), ['provisional', 'name'], name);
  }
  // The Pilates, yoga, dojo and padel places: out.
  for (const name of ['Pilates Moves', 'Bristol Yoga Centre', 'Bristol Zen Dojo', 'We Are Padel', 'Chris Dean Fitness', 'Flashpoint Bristol']) {
    assert.deepEqual(pick(dayOutVerdict('pools', { tags: { leisure: 'sports_centre' }, name })), ['out', null], name);
  }
});

test('the same test, in each drawer named for a thing', () => {
  assert.deepEqual(pick(dayOutVerdict('lidos', { tags: { leisure: 'swimming_pool', location: 'outdoor' }, name: 'x' })), ['kept', 'tag']);
  assert.deepEqual(pick(dayOutVerdict('lidos', { tags: { leisure: 'sports_centre' }, name: 'Sandford Parks Lido' })), ['provisional', 'name']);
  assert.deepEqual(pick(dayOutVerdict('athletics', { tags: { leisure: 'sports_centre' }, nearby: [{ tags: { leisure: 'track', sport: 'athletics' } }], name: 'x' })), ['kept', 'object']);
  assert.deepEqual(pick(dayOutVerdict('athletics', { tags: { leisure: 'sports_centre' }, name: 'Whitchurch Sports Centre' })), ['out', null]);
  assert.deepEqual(pick(dayOutVerdict('climbing', { tags: { leisure: 'sports_centre', sport: 'climbing' }, name: 'x' })), ['kept', 'tag']);
  assert.deepEqual(pick(dayOutVerdict('climbing', { tags: { leisure: 'sports_centre' }, text: 'a 12 m climbing wall', name: 'x' })), ['kept', 'text']);
  assert.deepEqual(pick(dayOutVerdict('racquet-clubs', { tags: { leisure: 'sports_centre', sport: 'tennis' }, name: 'x' })), ['kept', 'tag']);
  assert.deepEqual(pick(dayOutVerdict('racquet-clubs', { tags: { leisure: 'sports_centre' }, name: 'Royal Ascot Tennis Club' })), ['provisional', 'name']);
  // Padel is a court, so a padel place is in racquet-clubs even though it is out of Pools.
  assert.deepEqual(pick(dayOutVerdict('racquet-clubs', { tags: { leisure: 'sports_centre', sport: 'padel' }, name: 'We Are Padel' })), ['kept', 'tag']);
});

test('a drawer the test does not know is a can\'t-speak, not an out', () => {
  assert.equal(dayOutVerdict('museums', { tags: {}, name: 'The Ashmolean' }), null);
  assert.equal(namedForThing('museums'), null);
  assert.deepEqual(DRAWERS, ['pools', 'lidos', 'athletics', 'climbing', 'racquet-clubs']);
});

test('the switch is off until the owner says otherwise', () => {
  assert.equal(dayOutTestOn({}), false);
  assert.equal(dayOutTestOn({ EPIC_DAY_OUT_TEST: 'on' }), true);
});

test('adjacency is eighty metres, a box is four sane numbers, a selector names its values', () => {
  assert.equal(ADJACENT_M, 80);
  assert.ok(Math.abs(metres({ lat: 51.4, lng: -0.6 }, { lat: 51.4, lng: -0.601 }) - 69.5) < 2, 'a thousandth of a degree of longitude at 51°N is about 70 m');
  assert.deepEqual(boxOf('51.35,-0.72,51.44,-0.60'), { s: 51.35, w: -0.72, n: 51.44, e: -0.60 });
  assert.equal(boxOf('51.44,-0.72,51.35,-0.60'), null, 'south above north is no box');
  assert.equal(boxOf('50,-3,51.5,-1'), null, 'a county is too wide for one Overpass call');
  assert.deepEqual(selectorParts('["leisure"="sports_centre"]'), { key: 'leisure', values: ['sports_centre'] });
  assert.deepEqual(selectorParts('["leisure"~"^(sports_centre|track|stadium)$"]'), { key: 'leisure', values: ['sports_centre', 'track', 'stadium'] });
});

const pick = (v) => [v?.verdict ?? null, v?.by ?? null];
