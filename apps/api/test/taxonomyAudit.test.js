import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mixed, nobodyGoes, notVisitable, orphans, primaryMismatch, singletons } from '../src/domain/taxonomyAudit.js';
import { agreed, DELIVERY_OUT, STRUCTURAL } from '../src/domain/taxonomyCleanup.js';
import { effectOf } from '../src/repositories/taxonomyAudit.js';

const subs = [
  { key: 'one', label: 'One rule', category_key: 'fun', active: true },
  { key: 'empty', label: 'Climbing & bouldering', category_key: 'activity', active: true },
  { key: 'drawer', label: 'A drawer', category_key: 'culture', active: true },
];

test('a subcategory with one rule is offered somewhere to fold into', () => {
  const out = singletons({
    subs,
    rulesBySub: new Map([['one', [{ id: 1 }]]]),
    placesBySub: new Map([['one', 4]]),
    near: new Map([['one', [{ key: 'drawer', label: 'A drawer', shared: 3 }]]]),
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].proposed, 'A drawer');
  assert.match(out[0].because, /One rule and 4 places/);
  assert.equal(out[0].moves, 4);
});

test('an empty subcategory is a mapping gap and names the words that would fill it', () => {
  const out = orphans({
    subs,
    rulesBySub: new Map(),
    placesBySub: new Map(),
    unmapped: [{ key: 'climbing_gym', label: 'Climbing gym' }, { key: 'winery', label: 'Winery' }],
  });
  const one = out.find((p) => p.subject === 'empty');
  assert.ok(one);
  assert.match(one.proposed, /Climbing gym/);
  assert.ok(!one.proposed.includes('Winery'));
});

test('nobody goes stays silent until enough of its places have been shown', () => {
  const refs = Array.from({ length: 30 }, (_, i) => `r${i}`);
  const words = [{ key: 'road_bridge', label: 'Road bridge' }];
  const placesByWord = new Map([['road_bridge', refs]]);
  const thin = nobodyGoes({
    words, placesByWord, shownByRef: new Map([['r0', 3]]), openedByRef: new Map(),
  });
  assert.equal(thin.proposals.length, 0, 'three impressions is not evidence');
  assert.equal(thin.thin.length, 1, 'and it says so');

  const loud = nobodyGoes({
    words, placesByWord,
    shownByRef: new Map(refs.map((r) => [r, 5])), openedByRef: new Map(),
  });
  assert.equal(loud.proposals.length, 1);
  assert.equal(loud.proposals[0].proposed, 'Not in Epic');
  assert.equal(loud.proposals[0].moves, 30);
});

test('a word whose places we have never researched is not called unvisitable', () => {
  const refs = Array.from({ length: 30 }, (_, i) => `r${i}`);
  const out = notVisitable({
    words: [{ key: 'bridge', label: 'Bridge' }],
    placesByWord: new Map([['bridge', refs]]),
    ownedByRef: new Map(),
  });
  assert.equal(out.length, 0);
});

test('mixed will not speak about a drawer whose words it has never seen on a place', () => {
  const rulesBySub = new Map([['drawer', [{ labels: ['google:a'] }, { labels: ['google:b'] },
    { labels: ['google:c'] }, { labels: ['google:d'] }]]]);
  const blind = mixed({ subs, rulesBySub, wordsOfRule: (r) => r.labels.map((l) => l.split(':').pop()), together: new Map() });
  assert.equal(blind.proposals.length, 0, 'no co-occurrence is not evidence of separateness');
  assert.equal(blind.thin.length, 1);

  // Two pairs that each sit together and never cross.
  const together = new Map([['a', ['b']], ['b', ['a']], ['c', ['d']], ['d', ['c']]]);
  const seen = mixed({ subs, rulesBySub, wordsOfRule: (r) => r.labels.map((l) => l.split(':').pop()), together });
  assert.equal(seen.proposals.length, 1);
  assert.match(seen.proposals[0].because, /fall into 2 groups/);
});

test('primary mismatch needs to know enough primaries to judge', () => {
  const refs = Array.from({ length: 20 }, (_, i) => `r${i}`);
  const quiet = primaryMismatch({
    words: [{ key: 'cemetery', label: 'Cemetery' }],
    placesByWord: new Map([['cemetery', refs]]),
    primaryByRef: new Map([['r0', 'church']]),
  });
  assert.equal(quiet.length, 0);

  const loud = primaryMismatch({
    words: [{ key: 'cemetery', label: 'Cemetery' }],
    placesByWord: new Map([['cemetery', refs]]),
    primaryByRef: new Map(refs.map((r) => [r, 'church'])),
  });
  assert.equal(loud.length, 1);
  assert.match(loud[0].because, /catching the rest incidentally/);
});

test('the agreed cleanup only proposes what this database can carry', () => {
  const none = agreed({ have: new Set(), words: new Set() });
  assert.ok(none.every((p) => p.action === 'create'), 'nothing to change, only drawers to make');

  const all = agreed({ have: new Set(['fast-food', 'landmarks']), words: new Set([...STRUCTURAL, ...DELIVERY_OUT]) });
  const rename = all.find((p) => p.subject === 'fast-food');
  assert.equal(rename.proposed, 'Quick bites');
  assert.equal(all.filter((p) => p.action === 'exclude').length, STRUCTURAL.length + DELIVERY_OUT.length);
  assert.ok(all.every((p) => p.flag === 'agreed'));
});

test('the effect of a set is counted before it is applied', () => {
  const e = effectOf([
    { action: 'exclude', moves: 41 }, { action: 'exclude', moves: 9 },
    { action: 'create', moves: 0 }, { action: 'rename', moves: 0 }, { action: 'fold', moves: 4 },
  ]);
  assert.equal(e.proposals, 5);
  assert.equal(e.placesMoving, 54);
  assert.equal(e.excluding, 2);
  assert.equal(e.creating, 1);
  assert.equal(e.retiring, 1);
});
