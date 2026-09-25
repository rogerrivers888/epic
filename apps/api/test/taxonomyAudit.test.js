import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mixed, nobodyGoes, notVisitable, orphans, primaryMismatch, singletons } from '../src/domain/taxonomyAudit.js';
import { agreed, DELIVERY_OUT, STRUCTURAL } from '../src/domain/taxonomyCleanup.js';

// A database of this file's own, built from the committed migrations, like the
// other database-backed files. These tests used to run against whatever the
// local dev database held, and on 24 Sep 2026 that database was recreated
// empty mid-session -- thirteen tests failed with "relation does not exist",
// none of which was a fault in the code under test. A test that depends on
// what somebody's dev database happens to contain is not a test.
//
// The repositories are imported *after* the database is built, not hoisted:
// each one opens the shared pool the moment it is imported, and a static
// import would bind that pool to whatever DATABASE_URL said before
// `testDatabase()` repointed it. The domain modules above are pure and safe.
import { testDatabase } from './helpers/db.js';
const { query, pool } = await testDatabase();
const { effectOf, apply, consequence, run, undo } = await import('../src/repositories/taxonomyAudit.js');
const { drawersUnjudged, drawersWithoutABar, inheritBar, rescore, seedBars, checkBars } = await import('../src/repositories/placeIndex.js');
const { invariantRuns, noteInvariantRun } = await import('../src/repositories/settings.js');

test.after(() => pool.end());

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

// --- the invariant, against data rather than the schema --------------------


test('a drawer made outside a migration still gets a bar, and it says it was inherited', async (t) => {
  t.after(async () => {
    await query("delete from ready_bars where subcategory_key = 'tmp-made'");
    await query("delete from shelf_subcategories where key = 'tmp-made'");
  });
  // A sibling with a bar somebody wrote down, so there is something to inherit.
  // Bars are seeded at runtime, not by a migration, so a fresh database has
  // none until `seedBars` runs -- which is also what the deploy does first.
  await seedBars();
  const { rows: [sibling] } = await query(
    `select category_key from shelf_subcategories s
      where s.active and exists (select 1 from ready_bars b where b.subcategory_key = s.key)
      limit 1`);
  assert.ok(sibling, 'seeding gave at least one drawer a bar to inherit from');
  await query(
    `insert into shelf_subcategories (key, label, category_key, active)
     values ('tmp-made', 'Made by an API', $1, true)
     on conflict (key) do update set active = true, category_key = excluded.category_key`,
    [sibling.category_key]);

  const bare = await drawersWithoutABar();
  assert.ok(bare.some((d) => d.key === 'tmp-made'), 'the invariant sees a drawer a migration never made');

  const got = await inheritBar('tmp-made');
  assert.ok(got, 'it inherits one');
  assert.ok(got.facts.length, 'with facts');
  // Whole or not at all: every fact has a row, so a bar can never be read as
  // present while half-written.
  const { rows: [n] } = await query(
    "select count(*)::int n from ready_bars where subcategory_key = 'tmp-made'");
  const { FACT_KEYS } = await import('../src/domain/placeIndex.js');
  assert.equal(n.n, FACT_KEYS.length, 'one row per fact, all of them');
  const { rows } = await query(
    "select distinct set_by from ready_bars where subcategory_key = 'tmp-made'");
  assert.deepEqual(rows.map((r) => r.set_by), ['inherited'],
    'marked inherited, so it does not pretend somebody considered it');

  const after = await drawersWithoutABar();
  assert.ok(!after.some((d) => d.key === 'tmp-made'), 'and the invariant is satisfied');
});

test('inheriting twice does not overwrite a bar somebody set', async (t) => {
  t.after(async () => {
    await query("delete from ready_bars where subcategory_key = 'tmp-made'");
    await query("delete from shelf_subcategories where key = 'tmp-made'");
  });
  const { rows: [sibling] } = await query(
    `select category_key from shelf_subcategories where active limit 1`);
  await query(
    `insert into shelf_subcategories (key, label, category_key, active)
     values ('tmp-made', 'Made by an API', $1, true)
     on conflict (key) do update set active = true`, [sibling.category_key]);
  await query(
    `insert into ready_bars (subcategory_key, fact, weight, required, set_by)
     values ('tmp-made', 'picture', 30, true, 'somebody')
     on conflict do nothing`);

  assert.equal(await inheritBar('tmp-made'), null, 'it stands aside where a bar exists');
  const { rows } = await query(
    "select set_by from ready_bars where subcategory_key = 'tmp-made'");
  assert.deepEqual(rows.map((r) => r.set_by), ['somebody'], 'and leaves theirs alone');
});

test('a drawer that gains a bar has its places scored against it', async (t) => {
  t.after(async () => {
    await query("delete from place_index where venue_ref = 'test:bar-me'");
    await query("delete from ready_bars where subcategory_key = 'tmp-made'");
    await query("delete from shelf_subcategories where key = 'tmp-made'");
  });
  const { rows: [sib] } = await query('select category_key from shelf_subcategories where active limit 1');
  await query(
    `insert into shelf_subcategories (key, label, category_key, active)
     values ('tmp-made', 'Made by an API', $1, true)
     on conflict (key) do update set active = true`, [sib.category_key]);
  await query(
    `insert into place_index (venue_ref, subcategory, country_code, data_score, ready)
     values ('test:bar-me', 'tmp-made', 'GB', null, false)
     on conflict (venue_ref) do update set subcategory = 'tmp-made', data_score = null, ready = false`);

  const before = await query("select data_score from place_index where venue_ref = 'test:bar-me'");
  assert.equal(before.rows[0].data_score, null, 'it starts unscored, as a place in a barless drawer is');

  const out = await seedBars();
  assert.ok(out.gained.includes('tmp-made'), 'the drawer gained a bar');
  // The point of the finding: the bar alone is not the repair.
  const after = await query("select data_score, score_parts from place_index where venue_ref = 'test:bar-me'");
  assert.notEqual(after.rows[0].score_parts, null, 'and its places were scored against it, not left "not set"');
});

test('a bar with nothing judged against it is a fault the first invariant cannot see', async (t) => {
  t.after(async () => {
    await query("delete from place_index where venue_ref = 'test:unjudged'");
    await query("delete from ready_bars where subcategory_key = 'tmp-made'");
    await query("delete from shelf_subcategories where key = 'tmp-made'");
  });
  const { rows: [sib] } = await query('select category_key from shelf_subcategories where active limit 1');
  await query(
    `insert into shelf_subcategories (key, label, category_key, active)
     values ('tmp-made', 'Made by an API', $1, true)
     on conflict (key) do update set active = true`, [sib.category_key]);
  await inheritBar('tmp-made');
  // A place indexed before the bar arrived: scored as "not set" and never since.
  // `{ set: false }` is what `scorePlace` writes for a place whose drawer had
  // no bar: asked, and found unanswerable. The column is NOT NULL, so this is
  // the shape of "never judged" rather than an absent row.
  const unset = JSON.stringify({ set: false, held: [], judged: [], missing: [], notCounted: [] });
  await query(
    `insert into place_index (venue_ref, subcategory, country_code, data_score, ready, score_parts)
     values ('test:unjudged', 'tmp-made', 'GB', null, false, $1::jsonb)
     on conflict (venue_ref) do update set subcategory = 'tmp-made', score_parts = $1::jsonb, data_score = null`,
    [unset]);

  assert.deepEqual(await drawersWithoutABar(), [],
    'the first invariant is clean, because the bar exists');
  const unjudged = await drawersUnjudged();
  assert.ok(unjudged.some((d) => d.key === 'tmp-made'),
    'and the second one catches what it cannot see');
  assert.equal(unjudged.find((d) => d.key === 'tmp-made').judged, 0);

  await rescore({ subcategory: 'tmp-made' });
  const after = await drawersUnjudged();
  assert.ok(!after.some((d) => d.key === 'tmp-made'), 'rescoring settles it');
});

test('an empty drawer is not unjudged, it is empty', async (t) => {
  t.after(async () => {
    await query("delete from ready_bars where subcategory_key = 'tmp-made'");
    await query("delete from shelf_subcategories where key = 'tmp-made'");
  });
  const { rows: [sib] } = await query('select category_key from shelf_subcategories where active limit 1');
  await query(
    `insert into shelf_subcategories (key, label, category_key, active)
     values ('tmp-made', 'Made by an API', $1, true)
     on conflict (key) do update set active = true`, [sib.category_key]);
  await inheritBar('tmp-made');
  const unjudged = await drawersUnjudged();
  assert.ok(!unjudged.some((d) => d.key === 'tmp-made'),
    'no places is not a fault, and flagging it would cry wolf on every new drawer');
});

test('the unjudged count is places, not places times facts', async (t) => {
  t.after(async () => {
    await query("delete from place_index where venue_ref like 'test:count-%'");
    await query("delete from ready_bars where subcategory_key = 'tmp-made'");
    await query("delete from shelf_subcategories where key = 'tmp-made'");
  });
  const { rows: [sib] } = await query('select category_key from shelf_subcategories where active limit 1');
  await query(
    `insert into shelf_subcategories (key, label, category_key, active)
     values ('tmp-made', 'Made by an API', $1, true)
     on conflict (key) do update set active = true`, [sib.category_key]);
  await inheritBar('tmp-made');
  const { rows: [bar] } = await query(
    "select count(*)::int as facts from ready_bars where subcategory_key = 'tmp-made'");
  assert.ok(bar.facts > 1, 'a drawer has several bar rows, which is the trap');

  const unset = JSON.stringify({ set: false, held: [], judged: [], missing: [], notCounted: [] });
  for (const n of [1, 2, 3]) {
    await query(
      `insert into place_index (venue_ref, subcategory, country_code, score_parts)
       values ($1, 'tmp-made', 'GB', $2::jsonb)
       on conflict (venue_ref) do update set subcategory = 'tmp-made', score_parts = $2::jsonb`,
      [`test:count-${n}`, unset]);
  }
  const found = (await drawersUnjudged()).find((d) => d.key === 'tmp-made');
  assert.ok(found, 'it is caught');
  assert.equal(found.places, 3, `three places, not three times ${bar.facts}`);
});

// --- the checks, as a record ---------------------------------------------------


test('a check that has never run is null, and a run that found nothing is not', async (t) => {
  t.after(() => query("delete from app_settings where key = 'invariants.bars'"));
  await query("delete from app_settings where key = 'invariants.bars'");
  assert.equal(await invariantRuns(), null, 'never ran');

  const run = await checkBars({ repair: false, trigger: 'manual' });
  assert.equal(run.error, null);
  assert.ok(run.ranAt);
  await noteInvariantRun(run);

  const got = await invariantRuns();
  assert.ok(got, 'a record now exists');
  assert.equal(got.last.ranAt, run.ranAt);
  assert.equal(got.history.length, 1);
  assert.deepEqual({ bare: got.last.bare, left: got.last.left }, { bare: [], left: [] },
    'and what it found is written down, even when that is nothing');
});

test('the check sees an unjudged drawer, repairs it, and says so in its record', async (t) => {
  t.after(async () => {
    await query("delete from place_index where venue_ref = 'test:checked'");
    await query("delete from ready_bars where subcategory_key = 'tmp-made'");
    await query("delete from shelf_subcategories where key = 'tmp-made'");
    await query("delete from app_settings where key = 'invariants.bars'");
  });
  const { rows: [sib] } = await query('select category_key from shelf_subcategories where active limit 1');
  await query(
    `insert into shelf_subcategories (key, label, category_key, active)
     values ('tmp-made', 'Made by an API', $1, true)
     on conflict (key) do update set active = true`, [sib.category_key]);
  await inheritBar('tmp-made');
  const unset = JSON.stringify({ set: false, held: [], judged: [], missing: [], notCounted: [] });
  await query(
    `insert into place_index (venue_ref, subcategory, country_code, score_parts)
     values ('test:checked', 'tmp-made', 'GB', $1::jsonb)
     on conflict (venue_ref) do update set subcategory = 'tmp-made', score_parts = $1::jsonb`, [unset]);

  const seen = await checkBars({ repair: false });
  assert.ok(Array.isArray(seen.stillBare), 'a record says what is still bare, even when repairing nothing');
  assert.ok(seen.unjudged.some((d) => d.key === 'tmp-made'), 'reported without repair');
  assert.ok(seen.left.includes('tmp-made'), 'and still wrong, because nothing was repaired');

  const fixed = await checkBars({ repair: true, trigger: 'daily' });
  assert.ok(fixed.unjudged.some((d) => d.key === 'tmp-made'), 'the record keeps what it found');
  assert.ok(!fixed.left.includes('tmp-made'), 'and it is not left wrong');
  assert.equal(fixed.trigger, 'daily');
});

test('the history keeps the last fourteen runs, newest first', async (t) => {
  t.after(() => query("delete from app_settings where key = 'invariants.bars'"));
  await query("delete from app_settings where key = 'invariants.bars'");
  for (let i = 0; i < 16; i += 1) {
    await noteInvariantRun({ ranAt: `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`, trigger: 'daily', bare: [], unjudged: [], rescored: 0, left: [], error: null });
  }
  const got = await invariantRuns();
  assert.equal(got.history.length, 14);
  assert.equal(got.last.ranAt, '2026-09-16T00:00:00.000Z');
  assert.equal(got.history[0].ranAt, got.last.ranAt, 'newest first');
});

test('the daily check gives a bare drawer a bar and judges its places in the same pass', async (t) => {
  t.after(async () => {
    await query("delete from place_index where venue_ref = 'test:bare-daily'");
    await query("delete from ready_bars where subcategory_key = 'tmp-made'");
    await query("delete from shelf_subcategories where key = 'tmp-made'");
    await query("delete from app_settings where key = 'invariants.bars'");
  });
  await seedBars();
  const { rows: [sib] } = await query('select category_key from shelf_subcategories where active limit 1');
  // Made between deploys, through an API: no bar, and a place already in it.
  await query(
    `insert into shelf_subcategories (key, label, category_key, active)
     values ('tmp-made', 'Made by an API', $1, true)
     on conflict (key) do update set active = true`, [sib.category_key]);
  const unset = JSON.stringify({ set: false, held: [], judged: [], missing: [], notCounted: [] });
  await query(
    `insert into place_index (venue_ref, subcategory, country_code, score_parts)
     values ('test:bare-daily', 'tmp-made', 'GB', $1::jsonb)
     on conflict (venue_ref) do update set subcategory = 'tmp-made', score_parts = $1::jsonb`, [unset]);

  const run = await checkBars({ repair: true, trigger: 'daily' });
  assert.ok(run.bare.includes('tmp-made'), 'seen bare');
  assert.ok(run.inherited.includes('tmp-made'), 'and given a bar, not only named');
  assert.ok(!run.left.includes('tmp-made'), 'and its place judged in the same pass');
  assert.deepEqual(run.stillBare, [], 'nothing left bare');
  const { rows } = await query("select distinct set_by from ready_bars where subcategory_key = 'tmp-made'");
  assert.deepEqual(rows.map((r) => r.set_by), ['inherited']);
});

// --- the signed-off set (24 Sep 2026) ------------------------------------------

const { signedOff, SIGNED_OFF } = await import('../src/domain/taxonomyCleanup.js');
const { alreadyTrue } = await import('../src/repositories/taxonomyAudit.js');

test('the signed-off set only proposes what this database can carry, and addresses rules as the rules do', () => {
  const out = signedOff({
    have: new Set(['landmarks', 'ski-resort', 'museums']),
    words: new Set(['ski_resort', 'library']),
    kinds: new Map([['distillery', 'Q1']]),
    rules: new Set(['osm:sport=archery']),
  });
  assert.ok(out.every((p) => p.flag === SIGNED_OFF));
  const by = (kind, subject) => out.find((p) => p.subject_kind === kind && p.subject === subject);
  assert.equal(by('subcategory', 'landmarks').action, 'fold');
  assert.equal(by('subcategory', 'landmarks').proposed, 'landmarks-you-can-see');
  assert.equal(by('word', 'osm:sport=archery').proposed, 'have-a-go', 'an OSM tag is addressed as its rule subject');
  assert.equal(by('word', 'osm:sport=bowls'), undefined, 'a tag nobody taught is not proposed');
  assert.equal(by('kind', 'Q1').proposed, 'breweries-distilleries');
  assert.equal(by('word', 'library').action, 'exclude');
  assert.equal(by('word', 'ours:rainy-day').action, 'retire', 'one of our labels is addressed as ours:');
  // Section 6's default change and the axes brief's second cabinet ride in
  // one settle: a subject takes one proposal per run, and two would collide.
  assert.deepEqual(by('subcategory', 'museums').numbers, { also_in: ['educational'], defaults: { 'kid-friendly': null } });
  assert.equal(by('subcategory', 'indoor-snow'), undefined, 'settling a drawer this database lacks is not proposed');
  assert.equal(by('subcategory', 'nature'), undefined, 'a second cabinet on a drawer this database lacks is not proposed');
  const created = out.filter((p) => p.action === 'create').map((p) => p.subject);
  assert.deepEqual(created.sort(), ['factory-tours', 'have-a-go', 'planetariums', 'science-centres']);
  assert.deepEqual(by('subcategory', 'have-a-go').numbers.also_in, ['adrenaline', 'outdoors']);
  // The Educational drawers arrive with the cabinet, a second cabinet, and the
  // defaults the brief lets them state — and no cost band, which is the
  // sweep's to read off the venue's page.
  const science = by('subcategory', 'science-centres');
  assert.equal(science.numbers.category, 'educational');
  assert.deepEqual(science.numbers.also_in, ['fun']);
  assert.deepEqual(science.numbers.defaults, { indoor: { yesno: true }, duration: { from: 120, to: 180 } });
  assert.equal(by('word', 'science_museum'), undefined, 'a word this database has not seen is not repointed');
});

test('the Educational second cabinet is proposed for the drawers that carry the learning', () => {
  const out = signedOff({ have: new Set(['museums', 'zoos-wildlife', 'nature', 'castles']) });
  const by = (subject) => out.find((p) => p.subject_kind === 'subcategory' && p.subject === subject);
  for (const key of ['museums', 'zoos-wildlife', 'nature']) {
    assert.equal(by(key).action, 'settle');
    assert.deepEqual(by(key).numbers.also_in, ['educational'], `${key} lists Educational second`);
  }
  // A castle is Culture, and stays Culture (the axes brief, section 2).
  assert.equal(by('castles').numbers.also_in, undefined);
  // And once the cabinet is listed, the settle is already true and not offered again.
  assert.equal(alreadyTrue(by('zoos-wildlife'), {
    subs: [{ key: 'zoos-wildlife', active: true }], rules: [], allWords: [],
    alsoBySub: new Map([['zoos-wildlife', ['educational']]]), defaultsBySub: new Map(),
  }), true);
});

test('a signed-off change that is already true is not proposed again', () => {
  const input = {
    subs: [{ key: 'days-out', label: 'Days out', active: false }, { key: 'water-park', label: 'Water parks', active: true },
      { key: 'landmarks', label: 'Landmarks & monuments', active: true }],
    allWords: [{ key: 'library', decision: 'aside', active: false, points_at: null },
      { key: 'winery', decision: null, active: true, points_at: 'breweries-distilleries' },
      { key: 'ski_resort', decision: null, active: true, points_at: 'ski-resort' }],
    labels: [{ key: 'rainy-day', active: false }, { key: 'kid-friendly', active: true }],
    alsoBySub: new Map([['water-park', ['sport']]]),
    defaultsBySub: new Map([['water-park', new Map([['indoor', { yesno: true, from: null, to: null, choice: null, level: null }]])]]),
    rules: [{ scope: 'labels', subject: 'google:winery', subcategory: 'breweries-distilleries' },
      { scope: 'labels', subject: 'osm:sport=archery', subcategory: 'have-a-go' },
      { scope: 'kind', subject: 'Q1', subcategory: 'breweries-distilleries' },
      { scope: 'ours', subject: 'landmarks', subcategory: 'landmarks' }],
  };
  const p = (subject_kind, subject, action, proposed = null) => ({ subject_kind, subject, action, proposed });
  assert.equal(alreadyTrue(p('subcategory', 'days-out', 'retire'), input), true);
  assert.equal(alreadyTrue(p('subcategory', 'water-park', 'rename', 'Water parks'), input), true);
  assert.equal(alreadyTrue(p('subcategory', 'water-park', 'rename', 'Water park'), input), false);
  assert.equal(alreadyTrue(p('subcategory', 'landmarks', 'split', 'x'), input), true, 'only its own rule is left');
  assert.equal(alreadyTrue(p('subcategory', 'landmarks', 'fold', 'landmarks-you-can-see'), input), false);
  assert.equal(alreadyTrue(p('word', 'library', 'exclude'), input), true);
  assert.equal(alreadyTrue(p('word', 'winery', 'repoint', 'breweries-distilleries'), input), true);
  assert.equal(alreadyTrue(p('word', 'ski_resort', 'repoint', 'indoor-snow'), input), false);
  assert.equal(alreadyTrue(p('word', 'osm:sport=archery', 'repoint', 'have-a-go'), input), true);
  assert.equal(alreadyTrue(p('word', 'osm:sport=bowls', 'repoint', 'have-a-go'), input), false);
  assert.equal(alreadyTrue(p('kind', 'Q1', 'repoint', 'breweries-distilleries'), input), true);
  assert.equal(alreadyTrue(p('kind', 'Q9', 'repoint', 'anywhere'), input), true, 'a kind rule that is gone has nothing to move');
  assert.equal(alreadyTrue(p('word', 'ours:rainy-day', 'retire'), input), true, 'a label already off is not retired again');
  assert.equal(alreadyTrue(p('word', 'ours:kid-friendly', 'retire'), input), false);
  const settle = (subject, numbers) => ({ subject_kind: 'subcategory', subject, action: 'settle', numbers });
  assert.equal(alreadyTrue(settle('water-park', { also_in: ['sport'], defaults: { indoor: { yesno: true } } }), input), true);
  assert.equal(alreadyTrue(settle('water-park', { also_in: ['fun'] }), input), false, 'a cabinet not yet listed');
  assert.equal(alreadyTrue(settle('water-park', { defaults: { indoor: { yesno: false } } }), input), false, 'a default that reads differently');
  assert.equal(alreadyTrue(settle('water-park', { defaults: { 'kid-friendly': null } }), input), true, 'null means no row, and there is none');
  assert.equal(alreadyTrue(settle('water-park', { defaults: { indoor: null } }), input), false, 'null against a row that exists');
  const unsettled = { ...input, defaultsBySub: new Map([['water-park', new Map([['indoor', { yesno: true, settled: false }]])]]) };
  assert.equal(alreadyTrue(settle('water-park', { defaults: { indoor: { yesno: true } } }), unsettled), false,
    'a default the machine proposed and nobody agreed to is still worth settling');
});

test('a repointed word is switched back on, and a created drawer with places filed in it is kept on undo', async (t) => {
  await query(`insert into shelf_categories (key, label) values ('sport', 'Sport') on conflict (key) do nothing`);
  await query(`insert into shelf_subcategories (category_key, key, label) values ('sport', 'kept-home', 'Kept home') on conflict (key) do nothing`);
  await query(`insert into taxonomy_labels (namespace, key, label, decision, active) values ('google', 'test_revived', 'Revived', 'aside', false)
               on conflict (namespace, key) do update set decision = 'aside', active = false, points_at = null`);
  t.after(async () => {
    await query(`delete from taxonomy_proposals where subject in ('kept-new', 'test_revived')`);
    await query(`delete from place_index where venue_ref = 'test:kept-new-place'`);
    await query(`delete from taxonomy_labels where key = 'test_revived'`);
    await query(`delete from ready_bars where subcategory_key = 'kept-new'`);
    await query(`delete from shelf_subcategories where key in ('kept-new', 'kept-home')`);
  });
  const audit = await run({
    by: 'test',
    extra: [
      { flag: 'test-kept', subject_kind: 'subcategory', subject: 'kept-new', action: 'create', proposed: 'Kept new', because: 'test', moves: 0, numbers: { category: 'sport' } },
      { flag: 'test-kept', subject_kind: 'word', subject: 'test_revived', action: 'repoint', proposed: 'kept-new', because: 'test', moves: 0, numbers: {} },
    ],
  });
  await query(`update taxonomy_proposals set state = 'accepted' where audit_id = $1`, [audit.id]);
  await apply({ auditId: audit.id, by: 'test' });
  const { rows: [w] } = await query(`select active, decision, points_at from taxonomy_labels where key = 'test_revived'`);
  assert.deepEqual(w, { active: true, decision: null, points_at: 'kept-new' });
  // The index files a place there before anybody undoes it.
  await query(`insert into place_index (venue_ref, subcategory) values ('test:kept-new-place', 'kept-new')
               on conflict (venue_ref) do update set subcategory = 'kept-new'`);
  await undo({ auditId: audit.id, by: 'test' });
  const { rows: [sub] } = await query(`select active from shelf_subcategories where key = 'kept-new'`);
  assert.equal(sub?.active, false, 'switched off, not deleted, because a place points at it');
  const { rows: [w2] } = await query(`select active, decision from taxonomy_labels where key = 'test_revived'`);
  assert.deepEqual(w2, { active: false, decision: 'aside' });
});

test('undoing a create that was filled in the same audit deletes the drawer, its bar and its second cabinet', async (t) => {
  await query(`insert into shelf_categories (key, label) values ('sport', 'Sport'), ('adrenaline', 'Adrenaline') on conflict (key) do nothing`);
  await query(`insert into shelf_subcategories (category_key, key, label) values ('sport', 'old-home', 'Old home') on conflict (key) do nothing`);
  await query(`insert into shelf_rules (scope, subject, subject_label, subcategory, labels) values ('labels', 'osm:sport=born', 'Born', 'old-home', array['osm:sport=born'])
               on conflict (scope, subject) do update set subcategory = 'old-home'`);
  await seedBars();
  t.after(async () => {
    await query(`delete from taxonomy_proposals where subject in ('new-born', 'osm:sport=born')`);
    await query(`delete from shelf_rules where subject = 'osm:sport=born'`);
    await query(`delete from ready_bars where subcategory_key = 'new-born'`);
    await query(`delete from shelf_subcategories where key in ('new-born', 'old-home')`);
  });
  const audit = await run({
    by: 'test',
    extra: [
      { flag: 'test-born', subject_kind: 'subcategory', subject: 'new-born', action: 'create', proposed: 'New born', because: 'test', moves: 0,
        numbers: { category: 'sport', also_in: ['adrenaline'] } },
      { flag: 'test-born', subject_kind: 'word', subject: 'osm:sport=born', action: 'repoint', proposed: 'new-born', because: 'test', moves: 0, numbers: {} },
    ],
  });
  await query(`update taxonomy_proposals set state = 'accepted' where audit_id = $1`, [audit.id]);
  await apply({ auditId: audit.id, by: 'test' });
  const { rows: [moved] } = await query(`select subcategory from shelf_rules where subject = 'osm:sport=born'`);
  assert.equal(moved.subcategory, 'new-born');
  const { rows: bars } = await query(`select count(*)::int n from ready_bars where subcategory_key = 'new-born'`);
  assert.ok(bars[0].n > 0, 'the new drawer inherited a bar');
  const { rows: also } = await query(`select category_key from shelf_subcategory_categories where subcategory_key = 'new-born'`);
  assert.deepEqual(also.map((r) => r.category_key), ['adrenaline']);

  await undo({ auditId: audit.id, by: 'test' });
  const { rows: [back] } = await query(`select subcategory from shelf_rules where subject = 'osm:sport=born'`);
  assert.equal(back.subcategory, 'old-home');
  const { rows: gone } = await query(`select count(*)::int n from shelf_subcategories where key = 'new-born'`);
  assert.equal(gone[0].n, 0, 'the drawer is deleted, not merely switched off');
  const { rows: bars2 } = await query(`select count(*)::int n from ready_bars where subcategory_key = 'new-born'`);
  assert.equal(bars2[0].n, 0, 'and its bar went with it');
});

test('the agreed sets see decided words, so an excluded word is not proposed again and a generic one can be', async (t) => {
  await query(`insert into taxonomy_labels (namespace, key, label, decision, active) values
               ('google', 'test_generic', 'Test generic', 'generic', true),
               ('google', 'test_aside', 'Test aside', 'aside', false)
               on conflict (namespace, key) do update set decision = excluded.decision, active = excluded.active`);
  t.after(() => query(`delete from taxonomy_labels where key in ('test_generic', 'test_aside')`));
  const { evidence } = await import('../src/repositories/taxonomyAudit.js');
  const input = await evidence();
  assert.ok(input.allWords.some((w) => w.key === 'test_generic' && w.decision === 'generic'));
  assert.ok(!input.words.some((w) => w.key === 'test_generic'), 'the signals still see only the undecided');
  const p = (subject, action) => ({ subject_kind: 'word', subject, action, proposed: 'Not in Epic' });
  assert.equal(alreadyTrue(p('test_aside', 'exclude'), input), true);
  assert.equal(alreadyTrue(p('test_generic', 'exclude'), input), false);
});

test('a settle sets a second cabinet and a default, mirrors the old column, and undo puts all three back', async (t) => {
  await query(`insert into shelf_categories (key, label) values ('sport', 'Sport'), ('adrenaline', 'Adrenaline')
               on conflict (key) do nothing`);
  await query(`insert into shelf_subcategories (category_key, key, label, for_kids) values ('adrenaline', 'settle-me', 'Settle me', true)
               on conflict (key) do update set for_kids = true`);
  await query(`insert into place_attributes (key, label, kind) values ('indoor', 'Indoors', 'yesno'), ('kid-friendly', 'Kid friendly', 'yesno')
               on conflict (key) do nothing`);
  await query(`insert into shelf_subcategory_attributes (subcategory_key, attribute_key, yesno) values ('settle-me', 'kid-friendly', true)
               on conflict (subcategory_key, attribute_key) do update set yesno = true`);
  t.after(async () => {
    await query(`delete from taxonomy_proposals where subject = 'settle-me'`);
    await query(`delete from shelf_subcategories where key = 'settle-me'`);
  });
  const audit = await run({
    by: 'test',
    extra: [{ flag: 'test-settle', subject_kind: 'subcategory', subject: 'settle-me', action: 'settle', proposed: null,
      because: 'test', moves: 0, numbers: { also_in: ['sport'], defaults: { indoor: { yesno: true }, 'kid-friendly': null } } }],
  });
  await query(`update taxonomy_proposals set state = 'accepted' where audit_id = $1 and subject = 'settle-me'`, [audit.id]);
  const done = await apply({ auditId: audit.id, by: 'test' });
  assert.equal(done.applied, 1);
  const also = await query(`select category_key from shelf_subcategory_categories where subcategory_key = 'settle-me'`);
  assert.deepEqual(also.rows.map((r) => r.category_key), ['sport']);
  const defs = await query(`select attribute_key, yesno, settled from shelf_subcategory_attributes where subcategory_key = 'settle-me' order by 1`);
  assert.deepEqual(defs.rows, [{ attribute_key: 'indoor', yesno: true, settled: true }]);
  const { rows: [cols] } = await query(`select indoor, for_kids from shelf_subcategories where key = 'settle-me'`);
  assert.deepEqual(cols, { indoor: true, for_kids: null }, 'the old columns follow the defaults');

  const back = await undo({ auditId: audit.id, by: 'test' });
  assert.equal(back.settled, 1);
  const also2 = await query(`select category_key from shelf_subcategory_categories where subcategory_key = 'settle-me'`);
  assert.equal(also2.rows.length, 0);
  const defs2 = await query(`select attribute_key, yesno from shelf_subcategory_attributes where subcategory_key = 'settle-me'`);
  assert.deepEqual(defs2.rows, [{ attribute_key: 'kid-friendly', yesno: true }]);
  const { rows: [cols2] } = await query(`select indoor, for_kids from shelf_subcategories where key = 'settle-me'`);
  assert.deepEqual(cols2, { indoor: null, for_kids: true });
});

test('a rule on an open-map tag is repointed by its own subject, and one of our labels is retired and put back', async (t) => {
  await query(`insert into shelf_categories (key, label) values ('sport', 'Sport') on conflict (key) do nothing`);
  await query(`insert into shelf_subcategories (category_key, key, label) values ('sport', 'from-here', 'From here'), ('sport', 'to-there', 'To there')
               on conflict (key) do nothing`);
  await query(`insert into shelf_rules (scope, subject, subject_label, subcategory, labels) values ('labels', 'osm:sport=testing', 'Testing', 'from-here', array['osm:sport=testing'])
               on conflict (scope, subject) do update set subcategory = 'from-here'`);
  await query(`insert into place_attributes (key, label, kind, active) values ('test-label', 'Test label', 'yesno', true)
               on conflict (key) do update set active = true`);
  t.after(async () => {
    await query(`delete from taxonomy_proposals where subject in ('osm:sport=testing', 'ours:test-label')`);
    await query(`delete from shelf_rules where subject = 'osm:sport=testing'`);
    await query(`delete from place_attributes where key = 'test-label'`);
    await query(`delete from shelf_subcategories where key in ('from-here', 'to-there')`);
  });
  const audit = await run({
    by: 'test',
    extra: [
      { flag: 'test-tag', subject_kind: 'word', subject: 'osm:sport=testing', action: 'repoint', proposed: 'to-there', because: 'test', moves: 0, numbers: {} },
      { flag: 'test-tag', subject_kind: 'word', subject: 'ours:test-label', action: 'retire', proposed: null, because: 'test', moves: 0, numbers: {} },
    ],
  });
  await query(`update taxonomy_proposals set state = 'accepted' where audit_id = $1`, [audit.id]);
  const done = await apply({ auditId: audit.id, by: 'test' });
  assert.equal(done.applied, 2);
  const { rows: [rule] } = await query(`select subcategory from shelf_rules where subject = 'osm:sport=testing'`);
  assert.equal(rule.subcategory, 'to-there');
  const { rows: [label] } = await query(`select active from place_attributes where key = 'test-label'`);
  assert.equal(label.active, false);

  const back = await undo({ auditId: audit.id, by: 'test' });
  assert.equal(back.labels, 1);
  const { rows: [rule2] } = await query(`select subcategory from shelf_rules where subject = 'osm:sport=testing'`);
  assert.equal(rule2.subcategory, 'from-here');
  const { rows: [label2] } = await query(`select active from place_attributes where key = 'test-label'`);
  assert.equal(label2.active, true);
});

test('a rule touched by a fold and then a repoint is kept once, so undo puts it where it started', async (t) => {
  await query(`insert into shelf_categories (key, label) values ('sport', 'Sport') on conflict (key) do nothing`);
  await query(`insert into shelf_subcategories (category_key, key, label) values ('sport', 'husk', 'Husk'), ('sport', 'heap', 'Heap'), ('sport', 'home', 'Home')
               on conflict (key) do nothing`);
  await query(`insert into shelf_rules (scope, subject, subject_label, subcategory, labels) values ('labels', 'osm:sport=twice', 'Twice', 'husk', array['osm:sport=twice'])
               on conflict (scope, subject) do update set subcategory = 'husk'`);
  t.after(async () => {
    await query(`delete from taxonomy_proposals where subject in ('husk', 'osm:sport=twice')`);
    await query(`delete from shelf_rules where subject = 'osm:sport=twice'`);
    await query(`delete from shelf_subcategories where key in ('husk', 'heap', 'home')`);
  });
  const audit = await run({
    by: 'test',
    extra: [
      { flag: 'test-twice', subject_kind: 'subcategory', subject: 'husk', action: 'fold', proposed: 'heap', because: 'test', moves: 0, numbers: {} },
      { flag: 'test-twice', subject_kind: 'word', subject: 'osm:sport=twice', action: 'repoint', proposed: 'home', because: 'test', moves: 0, numbers: {} },
    ],
  });
  await query(`update taxonomy_proposals set state = 'accepted' where audit_id = $1`, [audit.id]);
  await apply({ auditId: audit.id, by: 'test' });
  const { rows: [after] } = await query(`select subcategory from shelf_rules where subject = 'osm:sport=twice'`);
  assert.equal(after.subcategory, 'home', 'the fold ran first (by action), then the repoint');
  await undo({ auditId: audit.id, by: 'test' });
  const { rows: [back] } = await query(`select subcategory from shelf_rules where subject = 'osm:sport=twice'`);
  assert.equal(back.subcategory, 'husk');
  const { rows: [husk] } = await query(`select active from shelf_subcategories where key = 'husk'`);
  assert.equal(husk.active, true);
});
