// Things to do: near and wide, merged (owner, 26 Sep 2026, E13).
import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTravelMinutes, reachRadiusKm, searchRadiusKm } from '../src/domain/travel.js';
import { searchPlan, mergeWide, alternate, NEAR_KM } from '../src/domain/wideSearch.js';
import * as wideSearch from '../src/domain/wideSearch.js';
import { bump, noteFault, healthOf } from '../src/sources/meter.js';

const at = { lat: 51.4, lng: -0.6 };
const north = (km) => ({ lat: at.lat + km / 111.32, lng: at.lng });

test('the search reaches as far as the fence, and no further than Google answers', () => {
  for (const [mode, minutes] of [['driving', 15], ['driving', 30], ['driving', 45], ['walking', 20], ['transit', 40]]) {
    const km = searchRadiusKm(mode, minutes);
    // Just inside the radius is inside the fence: nothing the fence keeps is out of reach of the search.
    assert.ok(estimateTravelMinutes(at, north(km - 0.2), mode) <= minutes, `${mode} ${minutes}: the edge of the search is past the fence`);
    // And the radius is not wildly wider than the fence either.
    assert.ok(estimateTravelMinutes(at, north(km + 1), mode) > minutes, `${mode} ${minutes}: the search reaches a kilometre past the fence`);
  }
  assert.equal(searchRadiusKm('driving', 90), 50, 'capped where Google stops answering');
  // The gap this closes: at an hour the old radius asked for 22km while the fence kept places at 50.
  assert.ok(searchRadiusKm('driving', 60) > reachRadiusKm('driving', 60) * 2);
});

test('a short trip runs one search, exactly as before', () => {
  for (const minutes of [15, 30]) {
    const plan = searchPlan({ searchKm: searchRadiusKm('driving', minutes), todayKm: reachRadiusKm('driving', minutes) });
    assert.equal(plan.wideKm, null, `${minutes} min asked for a second search`);
  }
});

test('an hour runs a near search and a wide one for things to do', () => {
  const plan = searchPlan({ searchKm: searchRadiusKm('driving', 60), todayKm: reachRadiusKm('driving', 60) });
  assert.ok(plan.nearKm >= NEAR_KM - 0.5 && plan.nearKm <= NEAR_KM + 0.5);
  assert.equal(plan.wideKm, 50);
});

test('the near search is never narrower than the one it replaces', () => {
  for (const minutes of [15, 30, 45, 60, 90]) {
    const todayKm = reachRadiusKm('driving', minutes);
    const plan = searchPlan({ searchKm: searchRadiusKm('driving', minutes), todayKm });
    assert.ok(plan.nearKm >= todayKm - 1e-9, `${minutes} min: near ${plan.nearKm} is narrower than today's ${todayKm}`);
  }
});

test('food, and anything typed, never get the second search', () => {
  const searchKm = 50;
  assert.equal(searchPlan({ searchKm, categories: ['restaurant'] }).wideKm, null);
  assert.equal(searchPlan({ searchKm, categories: ['cafe', 'pub'] }).wideKm, null);
  assert.equal(searchPlan({ searchKm, categories: [], query: 'climbing wall' }).wideKm, null);
  assert.equal(searchPlan({ searchKm, categories: ['attraction'] }).wideKm, 50);
  assert.equal(searchPlan({ searchKm, categories: [] }).wideKm, 50, 'no category chosen still means things to do too');
});

test('the merge keeps the near list first, and adds only what it did not have', () => {
  const near = [
    { name: 'Chertsey Museum', lat: 51.39, lng: -0.51, sourceIds: { google: 'g1' } },
    { name: 'Laleham Park', lat: 51.41, lng: -0.49, sourceIds: { osm: 'way/1' } },
  ];
  const wide = [
    { name: 'Chertsey Museum', lat: 51.39, lng: -0.51, sourceIds: { google: 'g1' } },     // same Google id
    { name: 'Laleham Park', lat: 51.4105, lng: -0.4905, sourceIds: { google: 'g2' } },    // same place, reached near only via OSM
    { name: 'Winchester Cathedral', lat: 51.06, lng: -1.31, sourceIds: { google: 'g3' } }, // new, further out
    { name: 'Laleham Park', lat: 51.2, lng: -0.3, sourceIds: { google: 'g4' } },           // same name, 30km away: another place
  ];
  const out = mergeWide(near, wide);
  assert.deepEqual(out.map((v) => v.sourceIds.google ?? v.sourceIds.osm), ['g1', 'way/1', 'g3', 'g4']);
  assert.equal(out[0], near[0], 'the near list keeps its order and comes first');
  assert.deepEqual(mergeWide(near, []), near);
});

test('both searches share one meter, so its health survives', () => {
  // The combining helper is gone on purpose: adding two meters' numbers drops
  // the Symbol-keyed health, and every call read as unobserved.
  assert.equal(wideSearch.addUnits, undefined);
  const meter = {};
  bump(meter, 'google');            // the near search
  bump(meter, 'google');            // the wide search, same meter
  noteFault(meter, 'wide search timed out');
  assert.equal(meter.google, 2);
  const health = healthOf(meter);
  assert.equal(health.failed, 1, 'a fault in either search is still visible on the one meter');
  assert.equal(health.ok, false);
  // And the thing that broke it: a meter rebuilt from its numbers has no health.
  assert.equal(healthOf({ ...meter }).ok, null);
});

test("Inspire's categories: everything but food is a thing to do", () => {
  for (const c of ['fun', 'culture', 'outdoors', 'sport', 'activity', 'adrenaline', 'relaxing']) {
    assert.equal(searchPlan({ searchKm: 50, categories: [c] }).wideKm, 50, `${c} did not get the near search beside it`);
  }
  assert.equal(searchPlan({ searchKm: 50, categories: ['food'] }).wideKm, null, 'food asks once');
});

test('a display search result is matched on its own Google id', () => {
  // Straight from a display search there is no `sourceIds`, only source and id.
  const near = [{ name: 'Marwell Zoo', lat: 50.99, lng: -1.28, source: 'google', sourcePlaceId: 'gM' }];
  const wide = [
    { name: 'Marwell Wildlife', lat: 50.99, lng: -1.28, source: 'google', sourcePlaceId: 'gM' }, // same id, different name
    { name: 'Paultons Park', lat: 50.94, lng: -1.55, source: 'google', sourcePlaceId: 'gP' },
  ];
  assert.deepEqual(mergeWide(near, wide).map((v) => v.sourcePlaceId), ['gM', 'gP']);
});

test('the shown list alternates near and far, each in its own order', () => {
  const at = (id, near) => ({ id, near });
  const items = [at('f1', false), at('f2', false), at('f3', false), at('n1', true), at('f4', false), at('n2', true)];
  const out = alternate(items, (v) => v.near).map((v) => v.id);
  assert.deepEqual(out, ['n1', 'f1', 'n2', 'f2', 'f3', 'f4'], 'near first, then far, and the longer side fills the rest');
  // Cut to four, the near ones are no longer crowded out by a score sort.
  assert.equal(out.slice(0, 4).filter((id) => id.startsWith('n')).length, 2);
  assert.deepEqual(alternate([], () => true), []);
  assert.deepEqual(alternate(items, () => false).map((v) => v.id), ['f1', 'f2', 'f3', 'n1', 'f4', 'n2'], 'one side only keeps its order');
});
