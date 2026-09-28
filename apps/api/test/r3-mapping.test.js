import { test } from 'node:test';
import assert from 'node:assert/strict';

// Round 3 (29 Sep 2026), agent MAPPING: a word's value is shown and set
// (Cuisine: Indian), a person can add a value, two empty Food & drink drawers
// get a proposal, the Food & drink · Things to do toggle filters by category,
// and the gap report flags unfed and thin subcategories.
import { testDatabase } from './helpers/db.js';
const { query, pool } = await testDatabase();
const mapping = await import('../src/desk/mapping.js');
const proposals = await import('../src/desk/proposals.js');
const categories = await import('../src/desk/categories.js');
const collections = await import('../src/desk/collections.js');

test.after(() => pool.end());

const WHO = 'test@epic';

async function seed() {
  await query(`insert into shelf_categories (key, label, position) values ('food', 'Food & drink', 2), ('fun', 'Fun', 1)
               on conflict (key) do update set active = true`);
  await query(`insert into shelf_subcategories (category_key, key, label, position) values
               ('food', 'restaurants', 'Restaurants', 1), ('food', 'pubs-bars', 'Pubs & bars', 2), ('food', 'cafes', 'Cafés', 3),
               ('food', 'afternoon-tea', 'Afternoon tea', 4), ('food', 'breweries-distilleries', 'Breweries, wineries & distilleries', 5),
               ('fun', 'r3-play', 'Play & soft play', 1)
               on conflict (key) do update set active = true, category_key = excluded.category_key, label = excluded.label`);
  await query(`insert into place_attributes (key, label, kind, options, position, active) values
               ('cuisine', 'Cuisine', 'oneof', array['Indian','Italian'], 20, true)
               on conflict (key) do update set active = true`);
  await query(`update place_attributes set options = array(select distinct unnest(options || array['Indian','Italian'])) where key = 'cuisine'`);
  await query(`delete from taxonomy_label_carries where key in ('r3_indian_restaurant')`);
  await query(`insert into taxonomy_labels (namespace, key, label, points_at, decision, active) values
               ('google', 'r3_indian_restaurant', 'indian restaurant', 'restaurants', null, true),
               ('google', 'brewery', 'brewery', 'pubs-bars', null, true),
               ('google', 'brewpub', 'brewpub', 'pubs-bars', null, true),
               ('google', 'tea_house', 'tea house', 'cafes', null, true),
               ('google', 'r3_unfed_brewery', 'unfed brewery', null, null, true)
               on conflict (namespace, key) do update set points_at = excluded.points_at, decision = null, active = true`);
  await query(`delete from word_targets where word in ('r3_indian_restaurant', 'brewery', 'brewpub', 'tea_house', 'r3_unfed_brewery')`);
  await query(`insert into word_targets (namespace, word, subcategory_key, is_primary) values
               ('google', 'r3_indian_restaurant', 'restaurants', true), ('google', 'brewery', 'pubs-bars', true),
               ('google', 'brewpub', 'pubs-bars', true), ('google', 'tea_house', 'cafes', true)`);
  await query(`insert into taxonomy_label_carries (namespace, key, attribute_key, choice) values ('google', 'r3_indian_restaurant', 'cuisine', 'Indian')`);
  await query(`delete from word_proposals where word in ('brewery', 'brewpub', 'tea_house')`);
}

// ---------------------------------------------------------------------------
// 2. Cuisine and dining style: the value is shown and set

test('a word carrying a cuisine is shown with its value, and can be repointed without losing it', async () => {
  await seed();
  const state = await mapping.mappingState();
  const w = state.inEpic.find((x) => x.word === 'r3_indian_restaurant');
  assert.deepEqual(w.facts.map((f) => f.label), ['Cuisine: Indian']);
  assert.equal(w.facts[0].value, 'Indian');
  // The shape trigger fires before ON CONFLICT is found: restoring a bare
  // "cuisine" as a yes was refused, so repointing any cuisine word failed.
  const out = await mapping.setTargets({ word: 'r3_indian_restaurant', subs: ['restaurants', 'cafes'], who: WHO });
  const { rows: [c] } = await query(`select choice from taxonomy_label_carries where key = 'r3_indian_restaurant' and attribute_key = 'cuisine'`);
  assert.equal(c.choice, 'Indian');
  const { rows: [ch] } = await query('select after from bo_changes where id = $1', [out.change.id]);
  assert.match(ch.after, /fact: Cuisine: Indian/);
  await mapping.undo({ id: out.decision.id, who: WHO });
});

test('a word takes a value in the picker, another replaces it, and undo puts the first back', async () => {
  await seed();
  const out = await mapping.setFact({ word: 'r3_indian_restaurant', fact: 'cuisine', value: 'Italian', who: WHO });
  let { rows: [c] } = await query(`select choice from taxonomy_label_carries where key = 'r3_indian_restaurant' and attribute_key = 'cuisine'`);
  assert.equal(c.choice, 'Italian');
  await mapping.undo({ id: out.decision.id, who: WHO });
  ({ rows: [c] } = await query(`select choice from taxonomy_label_carries where key = 'r3_indian_restaurant' and attribute_key = 'cuisine'`));
  assert.equal(c.choice, 'Indian');
  await assert.rejects(mapping.setFact({ word: 'r3_indian_restaurant', fact: 'cuisine', who: WHO }), /needs a value/);
  await assert.rejects(mapping.setFact({ word: 'r3_indian_restaurant', fact: 'cuisine', value: 'Martian', who: WHO }), /add it first/);
  const off = await mapping.setFact({ word: 'r3_indian_restaurant', fact: 'cuisine', on: false, who: WHO });
  ({ rows: [c] } = await query(`select choice from taxonomy_label_carries where key = 'r3_indian_restaurant'`));
  assert.equal(c, undefined, 'unticking takes the value off');
  await mapping.undo({ id: off.decision.id, who: WHO });
});

test('"+ Add a value" adds to the list once, is logged, and its undo refuses while the value is in use', async () => {
  await seed();
  await query(`update place_attributes set options = array_remove(options, 'Nepalese') where key = 'cuisine'`);
  const out = await mapping.addFactValue({ fact: 'cuisine', value: '  Nepalese ', who: WHO });
  assert.equal(out.added, true);
  assert.equal(out.value, 'Nepalese');
  const again = await mapping.addFactValue({ fact: 'cuisine', value: 'nepalese', who: WHO });
  assert.equal(again.added, false, 'the same value in other letters is not added twice');
  const { rows: [ch] } = await query('select * from bo_changes where id = $1', [out.change.id]);
  assert.equal(ch.area, 'Facts');
  assert.equal(ch.undo.kind, 'fact_value');
  const use = await mapping.setFact({ word: 'r3_indian_restaurant', fact: 'cuisine', value: 'Nepalese', who: WHO });
  await assert.rejects(mapping.undoFactValue({ change: ch, who: WHO }), /in use/);
  await mapping.undo({ id: use.decision.id, who: WHO });
  await mapping.undoFactValue({ change: ch, who: WHO });
  const { rows: [a] } = await query(`select options from place_attributes where key = 'cuisine'`);
  assert.ok(!a.options.includes('Nepalese'));
  await assert.rejects(mapping.addFactValue({ fact: 'cuisine', value: '', who: WHO }), /Name the value/);
});

// ---------------------------------------------------------------------------
// 1. Afternoon tea and Breweries: proposals

test('brewery, brewpub and tea_house are proposed into the empty drawers, keeping where they file as secondaries', async () => {
  await seed();
  await proposals.refreshProposals();
  const { rows } = await query(`select word, grp, action, change_to from word_proposals where word in ('brewery', 'brewpub', 'tea_house') and state = 'open' order by word`);
  assert.deepEqual(rows.map((r) => [r.word, r.grp, r.change_to.subcategory, r.change_to.also]), [
    ['brewery', 'fill', 'breweries-distilleries', ['pubs-bars']],
    ['brewpub', 'fill', 'pubs-bars', ['breweries-distilleries']],
    ['tea_house', 'fill', 'afternoon-tea', ['cafes']],
  ]);
  const brewery = (await query(`select id from word_proposals where word = 'brewery' and state = 'open'`)).rows[0];
  const out = await mapping.decideProposal({ id: brewery.id, action: 'apply', who: WHO });
  const { rows: t } = await query(`select subcategory_key, is_primary from word_targets where word = 'brewery' order by position`);
  assert.deepEqual(t.map((x) => [x.subcategory_key, x.is_primary]), [['breweries-distilleries', true], ['pubs-bars', false]]);
  const { rows: [pub] } = await query(`select id from word_proposals where word = 'brewpub' and state = 'open'`);
  await mapping.decideProposal({ id: pub.id, action: 'apply', who: WHO });
  // Decided and applied: running again raises neither.
  await proposals.refreshProposals();
  const { rows: still } = await query(`select word from word_proposals where word in ('brewery', 'brewpub') and state = 'open'`);
  assert.equal(still.length, 0);
  await mapping.undo({ id: out.decision.id, who: WHO });
});

test('a fill proposal is not raised where its drawer is gone', () => {
  const subs = new Map([['cafes', { active: true }]]);
  const seed = proposals.SEEDS.find((s) => s.word === 'tea_house');
  assert.equal(proposals.resolveTarget(seed, subs), null);
  assert.deepEqual(proposals.proposedTargets(seed, new Map([['afternoon-tea', { active: true }], ['cafes', { active: false }]])), ['afternoon-tea']);
  assert.equal(proposals.changesSomething(seed, { points_at: 'afternoon-tea', targets: ['afternoon-tea', 'cafes'] }), false);
  assert.equal(proposals.changesSomething(seed, { points_at: 'afternoon-tea', targets: ['afternoon-tea'] }), true);
});

// ---------------------------------------------------------------------------
// 3. Food & drink · Things to do

test('the toggle puts Food & drink on one side and every other category on the other', () => {
  assert.equal(categories.sideOf('food'), 'food');
  assert.equal(categories.sideOf('fun'), 'todo');
  assert.equal(categories.onSide('food', ['food']), true);
  assert.equal(categories.onSide('todo', ['food']), false);
  assert.equal(categories.onSide('todo', ['food', 'fun']), true);
  assert.equal(categories.onSide('food', []), true, 'naming no category is on both sides');
  assert.equal(categories.onSide('', ['fun']), true, 'All is everything');
  const catOfSub = new Map([['cafes', 'food'], ['r3-play', 'fun']]);
  assert.deepEqual(collections.ruleCategories({ cats: [], subs: [{ id: 'cafes', not: false }, { id: 'r3-play', not: true }] }, catOfSub), ['food']);
  assert.equal(collections.collectionOnSide('todo', ['food']), false);
  assert.equal(collections.collectionOnSide('food', ['food']), true);
  assert.equal(collections.collectionOnSide('todo', []), true);
});

// ---------------------------------------------------------------------------
// 4. The gap report

test('words fit a subcategory by its own words, not by generic ones', () => {
  const brew = categories.subTokens({ key: 'breweries-distilleries', label: 'Breweries, wineries & distilleries' });
  assert.ok(categories.wordFits('brewery', brew));
  assert.ok(categories.wordFits('winery', brew));
  assert.ok(!categories.wordFits('tea_house', brew));
  assert.ok(categories.wordFits('tea_house', categories.subTokens({ key: 'afternoon-tea', label: 'Afternoon tea' })));
  assert.ok(!categories.wordFits('steak_house', categories.subTokens({ key: 'historic-houses', label: 'Historic houses' })), '"house" is too common to fit by');
});

test('thin is a quarter of the category median, and cannot speak with too few drawers or a median of nought', () => {
  const rows = categories.flagThin([
    { key: 'a', category: 'x', categoryLabel: 'X', places: 100 },
    { key: 'b', category: 'x', categoryLabel: 'X', places: 80 },
    { key: 'c', category: 'x', categoryLabel: 'X', places: 10 },
    { key: 'd', category: 'y', categoryLabel: 'Y', places: 0 },
    { key: 'e', category: 'y', categoryLabel: 'Y', places: 50 },
    { key: 'f', category: 'z', categoryLabel: 'Z', places: 0 },
    { key: 'g', category: 'z', categoryLabel: 'Z', places: 0 },
    { key: 'h', category: 'z', categoryLabel: 'Z', places: 5 },
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.c.thin, true);
  assert.equal(by.b.thin, false);
  assert.equal(by.a.median, 80);
  assert.equal(by.d.thin, null);
  assert.match(by.d.thinWhy, /too few/);
  assert.equal(by.f.thin, null);
  assert.match(by.f.thinWhy, /median is nought/);
});

test('the gap report names the words feeding each drawer and suggests unanswered words that fit an unfed one', async () => {
  await seed();
  const out = await categories.gapReport();
  const brew = out.rows.find((r) => r.key === 'breweries-distilleries');
  assert.equal(brew.noWord, true);
  assert.ok(brew.suggest.some((s) => s.word === 'r3_unfed_brewery' && s.state === 'undecided'));
  const pubs = out.rows.find((r) => r.key === 'pubs-bars');
  assert.ok(pubs.words.some((w) => w.word === 'brewery' && w.primary));
  assert.ok(Number.isInteger(out.counts.noWord));
});

test('a fill proposal is not raised again over a word a person has since decided', async () => {
  await seed();
  await query(`delete from word_decisions where word = 'tea_house'`);
  const edit = await mapping.setTargets({ word: 'tea_house', subs: ['cafes'], who: WHO });
  await proposals.refreshProposals();
  const { rows } = await query(`select 1 from word_proposals where word = 'tea_house' and state = 'open'`);
  assert.equal(rows.length, 0, 'the person\'s picker edit stands');
  await mapping.undo({ id: edit.decision.id, who: WHO });
  await proposals.refreshProposals();
  const { rows: again } = await query(`select 1 from word_proposals where word = 'tea_house' and state = 'open'`);
  assert.equal(again.length, 1, 'with the edit undone, it is proposed again');
});
