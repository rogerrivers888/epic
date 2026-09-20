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

// A corpus that is actually used: opened four hundred times out of two
// thousand, so one open in five, and the signal has something to measure
// against.
const BUSY_SHOWN = ['elsewhere', 2000];
const BUSY_OPENED = ['elsewhere', 400];

test('nobody goes stays silent until enough of its places have been shown', () => {
  const refs = Array.from({ length: 30 }, (_, i) => `r${i}`);
  const words = [{ key: 'road_bridge', label: 'Road bridge' }];
  const placesByWord = new Map([['road_bridge', refs]]);
  const thin = nobodyGoes({
    words, placesByWord,
    shownByRef: new Map([['r0', 3], BUSY_SHOWN]),
    openedByRef: new Map([BUSY_OPENED]),
  });
  assert.equal(thin.proposals.length, 0, 'three impressions is not evidence');
  assert.equal(thin.thin.length, 1, 'and it says so');

  const loud = nobodyGoes({
    words, placesByWord,
    shownByRef: new Map([...refs.map((r) => [r, 5]), BUSY_SHOWN]),
    openedByRef: new Map([BUSY_OPENED]),
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

// --- what Codex found in the apply path, 20 Sep 2026 -----------------------

import { query } from '../src/db.js';
import { apply, consequence, run, undo } from '../src/repositories/taxonomyAudit.js';

const tidy = async () => {
  await query("delete from taxonomy_labels where key in ('tmp_word','tmp_two')");
  await query("delete from shelf_subcategories where key like 'tmp-%'");
  await query("delete from taxonomy_audits where ran_by like 'test:%'");
};

test('a fold puts back the words it repointed', async (t) => {
  t.after(tidy);
  await tidy();
  await query(`insert into shelf_subcategories (key,label,category_key,active)
    values ('tmp-src','Temp source','fun',true),('tmp-dst','Temp target','fun',true)
    on conflict (key) do update set active = true`);
  await query(`insert into taxonomy_labels (namespace,key,label,points_at)
    values ('google','tmp_word','Tmp word','tmp-src')
    on conflict (namespace,key) do update set points_at = 'tmp-src', decision = null, active = true`);
  const { rows: [a] } = await query("insert into taxonomy_audits (ran_by) values ('test:fold') returning *");
  await query(`insert into taxonomy_proposals (audit_id,flag,subject_kind,subject,action,proposed,because,state)
    values ($1,'agreed','subcategory','tmp-src','fold','Temp target','test','accepted')`, [a.id]);

  const points = async () => (await query("select points_at from taxonomy_labels where key = 'tmp_word'")).rows[0].points_at;
  assert.equal(await points(), 'tmp-src');
  await apply({ auditId: a.id, by: 'test' });
  assert.equal(await points(), 'tmp-dst', 'the fold moved it');
  await undo({ auditId: a.id, by: 'test' });
  assert.equal(await points(), 'tmp-src', 'and undo put it back');
  const { rows: [sub] } = await query("select active from shelf_subcategories where key = 'tmp-src'");
  assert.equal(sub.active, true);
});

test('an audit cannot be applied twice over its own snapshot', async (t) => {
  t.after(tidy);
  await tidy();
  await query(`insert into shelf_subcategories (key,label,category_key,active)
    values ('tmp-src','Temp source','fun',true) on conflict (key) do update set active = true, label = 'Temp source'`);
  const { rows: [a] } = await query("insert into taxonomy_audits (ran_by) values ('test:twice') returning *");
  await query(`insert into taxonomy_proposals (audit_id,flag,subject_kind,subject,action,proposed,because,state)
    values ($1,'agreed','subcategory','tmp-src','rename','Renamed','test','accepted'),
           ($1,'mixed','subcategory','tmp-src','split','a  ·  b','advisory, stays open','accepted')`, [a.id]);
  await apply({ auditId: a.id, by: 'test' });
  await assert.rejects(() => apply({ auditId: a.id, by: 'test' }), /already been applied/);
  await undo({ auditId: a.id, by: 'test' });
  const { rows: [sub] } = await query("select label from shelf_subcategories where key = 'tmp-src'");
  assert.equal(sub.label, 'Temp source', 'the first apply is still undoable');
});

test('a word named by two accepted proposals is snapshotted once, before either', async (t) => {
  t.after(tidy);
  await tidy();
  await query(`insert into shelf_subcategories (key,label,category_key,active)
    values ('tmp-dst','Temp target','fun',true) on conflict (key) do update set active = true`);
  await query(`insert into taxonomy_labels (namespace,key,label,points_at,decision,active)
    values ('google','tmp_two','Tmp two','tmp-dst',null,true)
    on conflict (namespace,key) do update set points_at = 'tmp-dst', decision = null, active = true`);
  const { rows: [a] } = await query("insert into taxonomy_audits (ran_by) values ('test:twoflags') returning *");
  // The same word under two flags, which the unique index allows.
  await query(`insert into taxonomy_proposals (audit_id,flag,subject_kind,subject,action,proposed,because,state)
    values ($1,'nobody_goes','word','tmp_two','exclude','Not in Epic','test','accepted'),
           ($1,'not_visitable','word','tmp_two','exclude','Not in Epic','test','accepted')`, [a.id]);
  await apply({ auditId: a.id, by: 'test' });
  const gone = (await query("select decision, active from taxonomy_labels where key = 'tmp_two'")).rows[0];
  assert.equal(gone.decision, 'aside');
  await undo({ auditId: a.id, by: 'test' });
  const back = (await query("select decision, points_at, active from taxonomy_labels where key = 'tmp_two'")).rows[0];
  assert.equal(back.decision, null, 'restored to what it was, not to the state after the first proposal');
  assert.equal(back.points_at, 'tmp-dst');
  assert.equal(back.active, true);
});

test('nobody goes stays blind until the corpus shows that opening happens', () => {
  const refs = Array.from({ length: 40 }, (_, i) => `r${i}`);
  const words = [{ key: 'restaurant', label: 'Restaurant' }];
  const placesByWord = new Map([['restaurant', refs]]);
  const shownByRef = new Map(refs.map((r) => [r, 10]));

  // Production, 20 Sep 2026: four opens in the whole system.
  const young = nobodyGoes({ words, placesByWord, shownByRef, openedByRef: new Map([['x', 4]]) });
  assert.equal(young.proposals.length, 0, 'four opens is not evidence that nobody goes');
  assert.ok(young.blind, 'and the run says it was blind');
  assert.equal(young.blind.opens, 4);

  // The corpus opens one in five. This word's 400 impressions yield 80 opens,
  // which is one in five, so there is nothing to report.
  const seenAll = new Map([...refs.map((r) => [r, 10]), BUSY_SHOWN]);
  const normal = nobodyGoes({
    words, placesByWord, shownByRef: seenAll,
    openedByRef: new Map([...refs.map((r) => [r, 2]), BUSY_OPENED]),
  });
  assert.equal(normal.proposals.length, 0, 'opened at the corpus rate is not a finding');

  // Same corpus, and this word is never opened at all.
  const dead = nobodyGoes({
    words, placesByWord, shownByRef: seenAll, openedByRef: new Map([BUSY_OPENED]),
  });
  assert.equal(dead.proposals.length, 1);
  assert.match(dead.proposals[0].because, /against .*% across everything else/);
});

test('the consequence line counts places, and withholds the opened figure until it means something', async (t) => {
  t.after(tidy);
  const out = await consequence(['google:restaurant', 'museum']);
  assert.ok('restaurant' in out.words, 'the namespace is stripped');
  assert.ok('museum' in out.words);
  assert.equal(typeof out.words.restaurant.places, 'number');
  // Nine opens in production, twenty-nine locally: either way the figure is
  // not worth printing, and the flag says so rather than the screen guessing.
  assert.equal(out.openable, out.corpusOpens >= 200);
  assert.ok(out.corpusOpens >= 0);
});

test('the consequence line refuses an empty ask rather than answering for everything', async () => {
  const none = await consequence([]);
  assert.equal(none.openable, false);
  assert.deepEqual(none.words, {});
});
