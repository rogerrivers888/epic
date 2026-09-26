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

// ---------------------------------------------------------------------------
// one judgement, three callers (Codex, 26 Sep 2026)
// ---------------------------------------------------------------------------

const { dryRun, judge, dayOutCatchUp, proseOf } = await import('../src/sources/dayOutTest.js');
const el = (id, tags, lat, lon, type = 'node') => ({ type, id, lat, lon, tags });
const fake = (elements) => async () => ({ elements });

test('the prose the test may read is the page and the encyclopedia, never a title, an address or a URL', () => {
  const facts = [
    { field: 'name', source: 'wikipedia', value: 'Bristol South Baths' },
    { field: 'website', source: 'site', value: 'https://swimmingpool.example' },
    { field: 'address', source: 'nominatim', value: 'Pool Lane, Bristol' },
    { field: 'summary', source: 'wikipedia', value: 'A Victorian leisure centre with a gym.' },
    { field: 'body', source: 'site', value: 'The 25 m swimming pool reopened in 2024.' },
  ];
  const text = proseOf(facts);
  assert.match(text, /25 m swimming pool/);
  assert.doesNotMatch(text, /Baths|swimmingpool\.example|Pool Lane/, 'a title, a URL and an address are not evidence');
});

test('judge reads the matched tags first, then the objects around the point, then prose; and is inert when off', async () => {
  const was = process.env.EPIC_DAY_OUT_TEST;
  try {
    delete process.env.EPIC_DAY_OUT_TEST;
    assert.equal(await judge('osm:node/1', { drawer: 'pools', name: 'Elm Park Leisure Centre', tags: { swimming_pool: 'yes' }, write: false }), null, 'off means nothing is judged');
    process.env.EPIC_DAY_OUT_TEST = 'on';
    // Own tags decide without a call.
    const byTag = await judge('osm:node/1', { drawer: 'pools', name: 'x', tags: { leisure: 'sports_centre', sport: 'swimming' }, write: false, fetch: async () => { throw new Error('must not be asked'); } });
    assert.deepEqual(pick(byTag), ['kept', 'tag']);
    // A pool object within eighty metres decides at enrichment as it does in the dry run.
    const byObject = await judge('osm:node/2', { drawer: 'pools', name: 'Easton Leisure Centre', lat: 51.46, lng: -2.56, tags: { leisure: 'sports_centre' }, write: false,
      fetch: fake([el(9, { leisure: 'swimming_pool' }, 51.4601, -2.5601)]) });
    assert.deepEqual(pick(byObject), ['kept', 'object']);
    // Prose decides when the map is silent.
    const byText = await judge('osm:node/3', { drawer: 'pools', name: 'x', lat: 51.46, lng: -2.56, tags: { leisure: 'sports_centre' }, text: 'a heated indoor swimming pool', write: false, fetch: fake([]) });
    assert.deepEqual(pick(byText), ['kept', 'text']);
    // And nothing at all is out.
    const out = await judge('osm:node/4', { drawer: 'pools', name: 'Bristol Zen Dojo', lat: 51.46, lng: -2.56, tags: { leisure: 'sports_centre' }, write: false, fetch: fake([]) });
    assert.deepEqual(pick(out), ['out', null]);
    // A drawer the test does not know is not judged.
    assert.equal(await judge('osm:node/5', { drawer: 'museums', name: 'x', tags: {}, write: false }), null);
  } finally {
    if (was == null) delete process.env.EPIC_DAY_OUT_TEST; else process.env.EPIC_DAY_OUT_TEST = was;
  }
});

test('the dry run tells candidates from objects, measures adjacency, and reads owned text', async () => {
  const elements = [
    el(1, { leisure: 'sports_centre', name: 'Charters Leisure Centre' }, 51.40, -0.65),
    el(2, { leisure: 'sports_centre', name: 'Bristol Yoga Centre' }, 51.41, -0.66),
    el(3, { leisure: 'sports_centre', name: 'Generic Sports Centre' }, 51.42, -0.67),
    el(4, { leisure: 'swimming_pool', name: 'Main Pool' }, 51.4203, -0.6702),
    el(5, { leisure: 'swimming_pool', access: 'private' }, 51.4101, -0.6601),
    el(6, { leisure: 'sports_centre', name: 'Quiet Sports Centre' }, 51.43, -0.68),
  ];
  const d = await dryRun({ drawer: 'pools', box: boxOf('51.39,-0.70,51.44,-0.60'), fetch: fake(elements),
    textFor: async (c) => (c.id === 6 ? 'the centre has a 20 m pool and a sauna' : '') });
  const by = Object.fromEntries(d.rows.map((r) => [r.name, [r.verdict, r.by]]));
  assert.deepEqual(by['Charters Leisure Centre'], ['provisional', 'name']);
  assert.deepEqual(by['Bristol Yoga Centre'], ['out', null], 'a private pool next door is not the centre\'s');
  assert.deepEqual(by['Generic Sports Centre'], ['kept', 'object']);
  assert.deepEqual(by['Quiet Sports Centre'], ['kept', 'text'], 'owned text is read by default');
  assert.equal(d.counts.candidates, 4, 'pool objects are evidence, not candidates');
  assert.equal(d.counts.objects, 1, 'the private pool is not an object of the named-for kind');
  assert.equal(d.on, false);
});

test('the catch-up does nothing while the switch is off', async () => {
  const was = process.env.EPIC_DAY_OUT_TEST;
  try {
    delete process.env.EPIC_DAY_OUT_TEST;
    assert.deepEqual(await dayOutCatchUp({ limit: 5, fetch: async () => { throw new Error('must not be asked'); } }), { judged: 0, skipped: 'switch off' });
  } finally {
    if (was == null) delete process.env.EPIC_DAY_OUT_TEST; else process.env.EPIC_DAY_OUT_TEST = was;
  }
});
