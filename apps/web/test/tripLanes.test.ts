import test from 'node:test';
import assert from 'node:assert/strict';
import { lanesFor, leadLane, OTHER_LANE } from '../src/screens/tripLanes.ts';

/**
 * The lanes on a trip's Activities tab (owner, 9 Sep 2026): every shelf with
 * something in it, in the shelves' order, and the one that was asked for
 * first.
 */

type P = { name: string; moods?: string[] | null; kind: string | null };
const p = (name: string, moods: string[] | null, kind: string | null = null): P => ({ name, moods, kind });
const kindOf = (x: P) => x.kind;
const VOCAB = {
  order: ['fun', 'food', 'culture', 'sport', 'activity', 'adrenaline', 'relaxing', 'outdoors'],
  label: { fun: 'Fun', food: 'Food', culture: 'Culture', sport: 'Sport', activity: 'Active', adrenaline: 'Adrenaline', relaxing: 'Relaxing', outdoors: 'Outdoors' },
  vibeMood: { fun: 'fun', cultural: 'culture', active: 'activity', relaxed: 'relaxing' },
};

test('lanes follow the shelves’ order and only the shelves with something in them', () => {
  const lanes = lanesFor([p('Museum', ['culture']), p('Heath', ['outdoors']), p('Lido', ['fun'])], null, kindOf, VOCAB);
  assert.deepEqual(lanes.map((l) => l.key), ['fun', 'culture', 'outdoors']);
  assert.deepEqual(lanes.map((l) => l.label), ['Fun', 'Culture', 'Outdoors']);
  assert.ok(lanes.every((l) => !l.led));
});

test('"something fun" puts Fun first and keeps every other lane', () => {
  const lanes = lanesFor([p('Museum', ['culture']), p('Heath', ['outdoors']), p('Lido', ['fun'])], { vibe: 'fun', kinds: [] }, kindOf, VOCAB);
  assert.deepEqual(lanes.map((l) => l.key), ['fun', 'culture', 'outdoors']);
  const cultural = lanesFor([p('Museum', ['culture']), p('Heath', ['outdoors']), p('Lido', ['fun'])], { vibe: 'cultural', kinds: [] }, kindOf, VOCAB);
  assert.deepEqual(cultural.map((l) => l.key), ['culture', 'fun', 'outdoors']);
  assert.deepEqual(cultural.map((l) => l.led), [true, false, false]);
});

test('a mood with nothing along the route does not lead an empty lane', () => {
  const lanes = lanesFor([p('Museum', ['culture']), p('Heath', ['outdoors'])], { vibe: 'fun', kinds: [] }, kindOf, VOCAB);
  assert.deepEqual(lanes.map((l) => l.key), ['culture', 'outdoors']);
  assert.ok(lanes.every((l) => !l.led));
});

test('a kind that was named leads with the lane that holds most of it', () => {
  const items = [p('Museum', ['culture']), p('Heath', ['outdoors'], 'park'), p('Common', ['outdoors'], 'park'), p('Soft play', ['fun'], 'playground')];
  assert.equal(leadLane(lanesFor(items, null, kindOf, VOCAB), { vibe: null, kinds: ['park'] }, kindOf, VOCAB), 'outdoors');
  const lanes = lanesFor(items, { vibe: null, kinds: ['park'] }, kindOf, VOCAB);
  assert.deepEqual(lanes.map((l) => l.key), ['outdoors', 'fun', 'culture']);
  assert.equal(lanes[0].led, true);
});

test('the spoken mood wins over a named kind', () => {
  const items = [p('Heath', ['outdoors'], 'park'), p('Soft play', ['fun'], 'playground')];
  const lanes = lanesFor(items, { vibe: 'fun', kinds: ['park'] }, kindOf, VOCAB);
  assert.deepEqual(lanes.map((l) => l.key), ['fun', 'outdoors']);
});

test('somewhere with no shelf goes in the last lane, and order inside a lane is kept', () => {
  const lanes = lanesFor([p('B', ['fun']), p('Unknown', null), p('A', ['fun']), p('Old answer', undefined as any)], null, kindOf, VOCAB);
  assert.deepEqual(lanes.map((l) => l.key), ['fun', OTHER_LANE]);
  assert.deepEqual(lanes[0].items.map((x) => x.name), ['B', 'A']);
  assert.equal(lanes[1].label, 'More to do');
  assert.equal(lanes[1].items.length, 2);
});

test('food is never a lane on the Activities tab', () => {
  const lanes = lanesFor([p('Pub', ['food']), p('Lido', ['fun'])], null, kindOf, VOCAB);
  assert.deepEqual(lanes.map((l) => l.key), ['fun', OTHER_LANE]);
});
