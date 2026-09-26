// Things to do: near and wide, merged (owner, 26 Sep 2026, E13).
import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTravelMinutes, reachRadiusKm, searchRadiusKm } from '../src/domain/travel.js';
import { searchPlan, mergeWide, addUnits, NEAR_KM } from '../src/domain/wideSearch.js';

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

test('both searches are billed as one call', () => {
  assert.deepEqual(addUnits({ google: 2, osm: 1 }, { google: 1 }), { google: 3, osm: 1 });
  assert.deepEqual(addUnits({ google: 1 }, undefined), { google: 1 });
});
