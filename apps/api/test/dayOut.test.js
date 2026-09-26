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
  // A tennis club with no pay-and-play on the map is a members' club (owner, 26 Sep 2026), not a provisional keep.
  assert.deepEqual(pick(dayOutVerdict('racquet-clubs', { tags: { leisure: 'sports_centre' }, name: 'Royal Ascot Tennis Club' })), ['out', 'members']);
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

// ---------------------------------------------------------------------------
// the four refinements (owner, 26 Sep 2026)
// ---------------------------------------------------------------------------

const { membersOnly, mayBorrowAdjacent } = await import('../src/domain/dayOut.js');
const { isCandidate, labelsOf, otherDrawerFor } = await import('../src/sources/dayOutTest.js');

test('members-only fails the day-out test whatever the facilities', () => {
  assert.deepEqual(pick(dayOutVerdict('pools', { tags: { leisure: 'sports_centre', swimming_pool: 'yes', access: 'private' }, name: 'x' })), ['out', 'members']);
  // David Lloyd carries no access tag on the map — only its brand.
  assert.deepEqual(pick(dayOutVerdict('pools', { tags: { leisure: 'sports_centre', brand: 'David Lloyd Clubs' }, nearby: [{ tags: { leisure: 'swimming_pool' } }], name: 'David Lloyd Leisure Centre' })), ['out', 'members']);
  assert.deepEqual(pick(dayOutVerdict('racquet-clubs', { tags: { leisure: 'sports_centre', sport: 'tennis', brand: 'David Lloyd Clubs' }, name: 'x' })), ['out', 'members']);
  assert.match(membersOnly({ text: 'Facilities are for members only.' }) ?? '', /members only/);
  // A club tag is not a membership: Absolutely Karting carries club=sport and sells a session to anybody.
  assert.equal(membersOnly({ tags: { leisure: 'sports_centre', club: 'sport', sport: 'karting', fee: 'yes' }, name: 'Absolutely Karting' }), null);
});

test('adjacency proves a pool for the sports centre only', () => {
  const pool = [{ tags: { leisure: 'swimming_pool', name: 'Main Pool' }, name: 'Main Pool', m: 63 }];
  // Hengrove's climbing wall, tagged for climbing, cannot borrow the pool next door.
  assert.deepEqual(pick(dayOutVerdict('pools', { tags: { leisure: 'sports_centre', sport: 'climbing' }, nearby: pool, name: 'Hengrove Park Leisure Centre Climbing Wall' })), ['out', null]);
  // The centre itself can.
  assert.deepEqual(pick(dayOutVerdict('pools', { tags: { leisure: 'sports_centre' }, nearby: pool, name: 'Hengrove Park Leisure Centre' })), ['kept', 'object']);
  assert.equal(mayBorrowAdjacent('pools', { sport: 'swimming;fitness' }), true);
  assert.equal(mayBorrowAdjacent('pools', { sport: 'karting' }), false);
  assert.equal(mayBorrowAdjacent('athletics', {}), true);
});

test('a lido or track candidate needs a name and must not be private; a centre is always a candidate', () => {
  assert.equal(isCandidate('lidos', { tags: { leisure: 'swimming_pool' } }), false, 'an unnamed pool object is a garden pool');
  assert.equal(isCandidate('lidos', { tags: { leisure: 'swimming_pool', name: 'Clevedon Marine Lake', access: 'private' } }), false);
  assert.equal(isCandidate('lidos', { tags: { leisure: 'swimming_pool', name: 'Sandford Parks Lido' } }), true);
  assert.equal(isCandidate('athletics', { tags: { leisure: 'track' } }), false);
  assert.equal(isCandidate('athletics', { tags: { leisure: 'sports_centre' } }), true, 'a centre is judged on its evidence, not filtered on its name');
  assert.equal(isCandidate('pools', { tags: { leisure: 'swimming_pool', name: 'x' } }), false, 'Pools is fed from sports centres, not from pool objects');
});

test('out of Pools is not out of Epic: an out place is asked where else its labels file it', () => {
  // A landing stub in the taxonomy's shape: karting lands in karting, laser tag in paintball-lasertag, climbing in climbing; a bare sports centre in pools.
  const land = (labels) => {
    if (labels.includes('osm:sport=karting')) return { subcategory: 'karting' };
    if (labels.includes('osm:sport=laser_tag')) return { subcategory: 'paintball-lasertag' };
    if (labels.includes('osm:sport=climbing')) return { subcategory: 'climbing' };
    if (labels.includes('osm:leisure=sports_centre')) return { subcategory: 'pools' };
    return { subcategory: null };
  };
  assert.deepEqual(labelsOf({ leisure: 'sports_centre', sport: 'karting;motor', club: 'sport' }), ['osm:leisure=sports_centre', 'osm:sport=karting', 'osm:sport=motor', 'osm:club=sport']);
  assert.equal(otherDrawerFor({ tags: { leisure: 'sports_centre', sport: 'karting' }, failed: 'pools', land }).drawer, 'karting');
  assert.equal(otherDrawerFor({ tags: { leisure: 'sports_centre', sport: 'laser_tag' }, failed: 'pools', land }).drawer, 'paintball-lasertag');
  assert.equal(otherDrawerFor({ tags: { leisure: 'sports_centre', sport: 'climbing' }, failed: 'pools', land }).drawer, 'climbing');
  // A yoga studio tagged only as a sports centre has nowhere else to go.
  assert.equal(otherDrawerFor({ tags: { leisure: 'sports_centre' }, failed: 'pools', land }).drawer, null);
  assert.equal(otherDrawerFor({ tags: { leisure: 'sports_centre', sport: 'yoga' }, failed: 'pools', land }).drawer, null);
});

test('the dry run says where every out place stays, and counts the ones that leave', async () => {
  const elements = [
    el(1, { leisure: 'sports_centre', name: 'Absolutely Karting', sport: 'karting' }, 51.40, -0.65),
    el(2, { leisure: 'sports_centre', name: 'Bristol Yoga Centre' }, 51.41, -0.66),
    el(3, { leisure: 'sports_centre', name: 'David Lloyd Leisure Centre', brand: 'David Lloyd Clubs' }, 51.42, -0.67),
    el(4, { leisure: 'swimming_pool', name: 'Main Pool' }, 51.4203, -0.6702),
    el(5, { leisure: 'sports_centre', name: 'Henbury Leisure Centre', sport: 'swimming' }, 51.43, -0.68),
  ];
  const land = (labels) => ({ subcategory: labels.includes('osm:sport=karting') ? 'karting' : (labels.includes('osm:leisure=sports_centre') ? 'pools' : null) });
  const d = await dryRun({ drawer: 'pools', box: boxOf('51.39,-0.70,51.44,-0.60'), fetch: fake(elements), textFor: async () => '', land });
  const by = Object.fromEntries(d.rows.map((r) => [r.name, [r.verdict, r.staysIn]]));
  assert.deepEqual(by['Absolutely Karting'], ['out', 'karting']);
  assert.deepEqual(by['Bristol Yoga Centre'], ['out', 'none — leaves Epic']);
  assert.deepEqual(by['David Lloyd Leisure Centre'], ['out', 'none — leaves Epic'], 'members only, and no other drawer');
  assert.deepEqual(by['Henbury Leisure Centre'], ['kept', 'pools']);
  assert.equal(d.counts.leavesEpic, 2);
});

// ---------------------------------------------------------------------------
// Codex on the refinements (26 Sep 2026)
// ---------------------------------------------------------------------------

test('a members-only pool next door proves nothing, and a members-only place stays in no tested drawer', async () => {
  // The neighbour's pool is members only: the centre is not kept by it.
  assert.deepEqual(pick(dayOutVerdict('pools', { tags: { leisure: 'sports_centre' }, nearby: [{ tags: { leisure: 'swimming_pool', access: 'members' } }], name: 'Generic Sports Centre' })), ['out', null]);
  assert.deepEqual(pick(dayOutVerdict('pools', { tags: { leisure: 'sports_centre' }, nearby: [{ tags: { leisure: 'swimming_pool', brand: 'David Lloyd Clubs' } }], name: 'x' })), ['out', null]);
  // A members-only centre tagged for climbing fails Pools and is not said to stay in Climbing.
  const elements = [el(1, { leisure: 'sports_centre', sport: 'climbing', brand: 'Nuffield Health', name: 'Nuffield Health Club' }, 51.40, -0.65)];
  const land = (labels) => ({ subcategory: labels.includes('osm:sport=climbing') ? 'climbing' : null });
  const d = await dryRun({ drawer: 'pools', box: boxOf('51.39,-0.70,51.44,-0.60'), fetch: fake(elements), textFor: async () => '', land });
  assert.deepEqual([d.rows[0].verdict, d.rows[0].by, d.rows[0].staysIn], ['out', 'members', 'none — leaves Epic']);
  assert.equal(d.counts.leavesEpic, 1);
});

test('a dry run with nothing out never opens the database', async () => {
  const elements = [el(1, { leisure: 'sports_centre', sport: 'swimming', name: 'Henbury Leisure Centre' }, 51.43, -0.68)];
  // No `land` handed in: if the landing were loaded eagerly this would reach for Postgres.
  const d = await dryRun({ drawer: 'pools', box: boxOf('51.39,-0.70,51.44,-0.60'), fetch: fake(elements), textFor: async () => '' });
  assert.deepEqual([d.rows[0].verdict, d.rows[0].staysIn], ['kept', 'pools']);
});

// ---------------------------------------------------------------------------
// the owner's four, before the switch (26 Sep 2026)
// ---------------------------------------------------------------------------

test('an object just over the box edge still speaks for the centre inside it; a candidate outside the box does not', async () => {
  const box = boxOf('51.40,-0.70,51.45,-0.60');
  const elements = [
    el(1, { leisure: 'sports_centre', name: 'Easton Leisure Centre' }, 51.4002, -0.6003),   // inside, near the south-west corner
    el(2, { leisure: 'swimming_pool', name: 'Easton pool' }, 51.3998, -0.6003),             // 45 m south: in the margin, outside the box
  ];
  const d = await dryRun({ drawer: 'pools', box, fetch: fake(elements), textFor: async () => '' });
  const by = Object.fromEntries(d.rows.map((r) => [r.name, [r.verdict, r.by]]));
  assert.deepEqual(by['Easton Leisure Centre'], ['kept', 'object'], 'Easton comes back kept');
  // A centre is a candidate wherever the box query found it (by any node of
  // its outline). An object-type candidate — a mapped lido — is held to the
  // box, because the margin fetched those a little wider on purpose.
  // The open map answers the box question with what is in the box, and the
  // object question with the box and its margin; the margin's pool is
  // evidence for a candidate, never a candidate itself.
  let asks = 0;
  const lidos = await dryRun({ drawer: 'lidos', box, fetch: async () => {
    asks += 1;
    const inside = el(4, { leisure: 'swimming_pool', name: 'Inside Lido', location: 'outdoor' }, 51.42, -0.65);
    const margin = el(5, { leisure: 'swimming_pool', name: 'Margin Lido', location: 'outdoor' }, 51.3995, -0.65);
    return { elements: asks === 1 ? [inside] : [inside, margin] };
  }, textFor: async () => '' });
  assert.deepEqual(lidos.rows.map((r) => r.name), ['Inside Lido'], 'the margin brings objects, not candidates');
});

test('a tennis club with no pay-and-play on the map is members only; a padel hall that charges is not', () => {
  assert.deepEqual(pick(dayOutVerdict('racquet-clubs', { tags: { leisure: 'sports_centre', sport: 'tennis', start_date: '1905' }, name: 'Royal Ascot Tennis Club' })), ['out', 'members']);
  assert.deepEqual(pick(dayOutVerdict('racquet-clubs', { tags: { leisure: 'sports_centre', sport: 'tennis' }, name: 'Clifton Lawn Tennis Club' })), ['out', 'members']);
  assert.deepEqual(pick(dayOutVerdict('racquet-clubs', { tags: { leisure: 'sports_centre', sport: 'padel', fee: 'yes' }, name: 'Rocket Padel' })), ['kept', 'tag']);
  assert.deepEqual(pick(dayOutVerdict('racquet-clubs', { tags: { leisure: 'sports_centre', sport: 'padel', fee: 'yes' }, name: 'We Are Padel' })), ['kept', 'tag']);
  // A club that says it sells a session is not a members' club for this test.
  assert.deepEqual(pick(dayOutVerdict('racquet-clubs', { tags: { leisure: 'sports_centre', sport: 'tennis', fee: 'yes' }, name: 'Riverside Tennis Club' })), ['kept', 'tag']);
});

test('a taxonomy that does not answer is a can\'t-say on the row, and an open map that fails twice is a plain 503', async () => {
  const elements = [el(1, { leisure: 'sports_centre', name: 'Bristol Yoga Centre', sport: 'yoga' }, 51.41, -0.66)];
  const d = await dryRun({ drawer: 'pools', box: boxOf('51.39,-0.70,51.44,-0.60'), fetch: fake(elements), textFor: async () => '', land: () => { throw new Error('rules table locked'); } });
  assert.match(d.rows[0].staysIn, /can't say/);
  assert.equal(d.counts.leavesEpic, 0, 'a can\'t-say is not counted as leaving');
  let calls = 0;
  await assert.rejects(
    () => dryRun({ drawer: 'pools', box: boxOf('51.39,-0.70,51.44,-0.60'), fetch: async () => { calls += 1; throw new Error('Overpass 504'); }, textFor: async () => '' }),
    (err) => err.status === 503 && /open map did not answer/.test(err.message),
  );
  assert.equal(calls, 1, 'asked once — the mirrors are walked inside the one call — then said so');
});

test('the dry run asks the open map twice — candidates from the box, objects with the margin — and a centre found only by the object question is not a candidate', async () => {
  const box = boxOf('51.40,-0.70,51.45,-0.60');
  const asked = [];
  const fetch = async (q) => {
    asked.push(q);
    if (asked.length === 1) return { elements: [el(1, { leisure: 'sports_centre', name: 'Inside Sports Centre' }, 51.42, -0.65)] };
    // The object question, with its margin, also returns a climbing-tagged sports centre just outside the box.
    return { elements: [
      el(2, { leisure: 'sports_centre', sport: 'climbing', name: 'Margin Climbing Centre' }, 51.3995, -0.65),
      el(3, { sport: 'climbing', name: 'Inside Wall' }, 51.4201, -0.6501),
    ] };
  };
  const d = await dryRun({ drawer: 'climbing', box, fetch, textFor: async () => '' });
  assert.equal(asked.length, 2);
  assert.match(asked[0], /leisure"="sports_centre"\]\(51\.4,-0\.7,51\.45,-0\.6\)/, 'the first question is the box, by the drawer\'s selector');
  assert.match(asked[1], /sport"~"climbing\|bouldering"\]\(51\.399,-0\.7016,51\.451,-0\.5984\)/, 'the second is the objects, with the margin');
  assert.deepEqual(d.rows.map((r) => r.name), ['Inside Sports Centre'], 'the margin centre is evidence, never a candidate');
  assert.deepEqual([d.rows[0].verdict, d.rows[0].by], ['kept', 'object'], 'and the wall inside the box speaks for the centre');
});

test('a feature that is both candidate and object is not its own evidence', async () => {
  const lido = el(7, { leisure: 'swimming_pool', name: 'Sandford Parks Lido' }, 51.42, -0.65);
  // Both questions return their own copy of the same feature.
  const d = await dryRun({ drawer: 'lidos', box: boxOf('51.40,-0.70,51.45,-0.60'), fetch: async () => ({ elements: [{ ...lido, tags: { ...lido.tags } }] }), textFor: async () => '' });
  assert.deepEqual([d.rows[0].verdict, d.rows[0].by, d.rows[0].nearest], ['provisional', 'name', null], 'not kept by a pool 0 m away that is itself');
});
