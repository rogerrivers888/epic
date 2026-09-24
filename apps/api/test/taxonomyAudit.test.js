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
