import { test } from 'node:test';
import assert from 'node:assert/strict';

// The fix pass after the design audit (28 Sep 2026), Mapping and Collections:
// proposals name drawers that exist (or that they will make), Keep leaves an
// unanswered word alone, Places affected is counted on read, the two homes of
// a word's primary stay in step (migration 269), the handover's collection
// rules are written (migration 270), a legacy rule is shown exactly or not at
// all, and See as a household sends every row for the preview to draw.
import { testDatabase } from './helpers/db.js';
const { query, pool } = await testDatabase();
const mapping = await import('../src/desk/mapping.js');
const proposals = await import('../src/desk/proposals.js');
const collections = await import('../src/desk/collections.js');

test.after(() => pool.end());

const WHO = 'test@epic';

async function seedWords() {
  await query(`insert into shelf_categories (key, label, position) values ('fun', 'Fun', 1), ('culture', 'Culture', 2)
               on conflict (key) do update set active = true`);
  await query(`insert into shelf_subcategories (category_key, key, label, position) values
               ('fun', 'fc-water', 'Water parks', 1), ('culture', 'fc-museums', 'Museums', 2)
               on conflict (key) do update set active = true`);
  await query(`insert into taxonomy_labels (namespace, key, label, points_at, active) values
               ('google', 'fc_splash', 'splash', 'fc-water', true),
               ('google', 'fc_lonely', 'lonely', null, true)
               on conflict (namespace, key) do update set points_at = excluded.points_at, decision = null, active = true`);
  await query(`delete from word_proposals where word like 'fc_%'`);
  await query(`delete from word_decisions where word like 'fc_%'`);
}

// ---------------------------------------------------------------------------
// Proposals

test('heritage_railway proposes a new Fun drawer, and church names a Landmarks drawer that exists or is not raised', async () => {
  const heritage = proposals.SEEDS.find((s) => s.word === 'heritage_railway');
  assert.deepEqual(heritage.newSub, { key: 'heritage-railways', label: 'Heritage railways', category: 'fun' });
  assert.equal(heritage.text, 'Fun › Heritage railways (new subcategory)');

  const church = proposals.SEEDS.find((s) => s.word === 'church');
  const none = new Map();
  assert.equal(proposals.resolveTarget(church, none), null, 'no Landmarks drawer: nothing to raise');
  const subs = new Map([['landmarks', { key: 'landmarks', label: 'Landmarks & monuments', active: true, cat: 'Culture' }]]);
  assert.deepEqual(proposals.resolveTarget(church, subs), { key: 'landmarks', label: 'Culture › Landmarks & monuments' });
  assert.equal(proposals.resolveTarget(heritage, none).key, 'heritage-railways', 'a drawer the seed makes on accept needs no drawer yet');
});

test('refreshProposals raises heritage_railway with its new drawer, and never a church proposal at a drawer that is not there', async () => {
  await query(`insert into shelf_categories (key, label, position) values ('fun', 'Fun', 1) on conflict (key) do update set active = true`);
  await query(`insert into taxonomy_labels (namespace, key, label, points_at, active) values
               ('google', 'heritage_railway', 'heritage railway', null, true), ('google', 'church', 'church', null, true)
               on conflict (namespace, key) do update set points_at = null, decision = null, active = true`);
  await query(`delete from word_proposals where word in ('heritage_railway', 'church')`);
  await query(`update shelf_subcategories set active = false where key in ('landmarks', 'landmarks-you-can-see')`);
  await proposals.refreshProposals();
  const { rows } = await query(`select word, change_to from word_proposals where word in ('heritage_railway', 'church') and state = 'open'`);
  const heritage = rows.find((r) => r.word === 'heritage_railway');
  assert.equal(heritage.change_to.newSub.key, 'heritage-railways');
  assert.equal(heritage.change_to.text, 'Fun › Heritage railways (new subcategory)');
  assert.ok(!rows.some((r) => r.word === 'church'), 'no drawer to narrow into, so no proposal');
  await query(`update shelf_subcategories set active = true where key = 'landmarks'`);
});

// ---------------------------------------------------------------------------
// Needs a decision

test('Keep on an unanswered word takes it out of Needs a decision, the count drops, and it is not listed under No suggestion', async () => {
  await seedWords();
  const { rows: [p] } = await query(
    `insert into word_proposals (word, grp, action, change_to) values ('fc_lonely', 'not_places', 'exclude', '{"text":"Exclude"}'::jsonb) returning id`);
  let state = await mapping.mappingState();
  assert.ok(state.needs.some((w) => w.word === 'fc_lonely'));
  const before = state.counts.needs;
  const everything = state.counts.everything;

  const out = await mapping.decideProposal({ id: p.id, action: 'keep', who: WHO });
  state = await mapping.mappingState();
  assert.ok(!state.needs.some((w) => w.word === 'fc_lonely'), 'kept as it is: not back as No suggestion');
  assert.equal(state.counts.needs, before - 1);
  assert.ok(state.keptAsIs.some((w) => w.word === 'fc_lonely'), 'still openable from Decided');
  assert.equal(state.counts.everything, everything, 'Everything counts every word not excluded, kept ones too');

  // Keep changes nothing, and Changes says so the way every Mapping entry does.
  const { rows: [ch] } = await query('select what, before, after, why from bo_changes where id = $1', [out.change.id]);
  assert.equal(ch.what, 'Google word · fc_lonely · Kept');
  assert.equal(ch.before, ch.after);
  assert.equal(ch.before, 'Not answered');
  assert.equal(ch.why, 'Kept — proposal declined');

  // A later decision reopens the question.
  await mapping.undo({ id: out.decision.id, who: WHO });
  state = await mapping.mappingState();
  assert.ok(state.needs.some((w) => w.word === 'fc_lonely'));
});

test('Places affected is counted on read: a repoint counts the places that would move, not every place it brings', async () => {
  await seedWords();
  await query(`insert into place_index (venue_ref, subcategory) values ('fc:1', 'fc-museums'), ('fc:2', 'fc-water'), ('fc:3', 'fc-water')
               on conflict (venue_ref) do update set subcategory = excluded.subcategory, not_in_epic_at = null`);
  await query(`delete from place_index_labels where venue_ref like 'fc:%'`);
  await query(`insert into place_index_labels (venue_ref, label) values ('fc:1', 'google:fc_splash'), ('fc:2', 'google:fc_splash'), ('fc:3', 'google:fc_splash')`);
  await query(`insert into word_proposals (word, grp, action, change_to, places_affected)
               values ('fc_splash', 'fold', 'repoint', '{"text":"Culture › Museums","subcategory":"fc-museums"}'::jsonb, 999)`);
  assert.equal(await mapping.movingCount('fc_splash', 'fc-museums'), 2, 'fc:1 is already in Museums');
  const state = await mapping.mappingState();
  const row = state.needs.find((w) => w.word === 'fc_splash');
  assert.equal(row.proposal.affected, 2, 'recounted, never the 999 stored when it was raised');
  await query(`delete from word_proposals where word = 'fc_splash'`);
});

// ---------------------------------------------------------------------------
// Migration 269: the primary lives in two places and they stay in step

test('points_at written by an older route moves the primary target, and a target written by the desk moves points_at', async () => {
  await seedWords();
  await query(`delete from word_targets where word = 'fc_splash'`);
  await query(`insert into word_targets (namespace, word, subcategory_key, is_primary, position) values ('google', 'fc_splash', 'fc-water', true, 0)`);
  let { rows: [l] } = await query(`select points_at from taxonomy_labels where key = 'fc_splash'`);
  assert.equal(l.points_at, 'fc-water');

  // An older route repoints by `points_at` alone.
  await query(`update taxonomy_labels set points_at = 'fc-museums' where namespace = 'google' and key = 'fc_splash'`);
  let { rows } = await query(`select subcategory_key, is_primary from word_targets where word = 'fc_splash' order by position`);
  assert.deepEqual(rows.map((r) => [r.subcategory_key, r.is_primary]), [['fc-museums', true], ['fc-water', false]]);

  // The desk writes targets: the pointer follows.
  await query(`update word_targets set is_primary = false where word = 'fc_splash' and subcategory_key = 'fc-museums'`);
  await query(`update word_targets set is_primary = true where word = 'fc_splash' and subcategory_key = 'fc-water'`);
  ({ rows: [l] } = await query(`select points_at from taxonomy_labels where key = 'fc_splash'`));
  assert.equal(l.points_at, 'fc-water');

  // Cleared by an older route: its unconditional targets go too.
  await query(`update taxonomy_labels set points_at = null where namespace = 'google' and key = 'fc_splash'`);
  ({ rows } = await query(`select 1 from word_targets where word = 'fc_splash'`));
  assert.equal(rows.length, 0);

  // The desk's own path still ends where it says.
  await mapping.setTargets({ word: 'fc_splash', subs: ['fc-museums', 'fc-water'], who: WHO });
  ({ rows: [l] } = await query(`select points_at from taxonomy_labels where key = 'fc_splash'`));
  assert.equal(l.points_at, 'fc-museums');
  ({ rows } = await query(`select subcategory_key from word_targets where word = 'fc_splash' and is_primary`));
  assert.deepEqual(rows.map((r) => r.subcategory_key), ['fc-museums']);
});

// ---------------------------------------------------------------------------
// Collections

test('a legacy predicate converts exactly only where its shape allows, and says itself in words otherwise', () => {
  assert.equal(collections.legacyExact({ all: [{ attribute: 'suits-ages', overlaps: [0, 3] }] }), true);
  assert.equal(collections.legacyExact({ all: [{ not: { subcategory: ['coast'] } }, { attribute: 'indoor', yes: true }] }), true);
  assert.equal(collections.legacyExact({ any: [{ attribute: 'indoor', yes: true }, { subcategory: ['water'] }] }), false, 'an or across kinds has no pills');
  assert.equal(collections.legacyExact({ all: [{ attribute: 'step-free', yes: true }, { attribute: 'parking', yes: true }] }), false, 'two yeses would become either');
  assert.equal(collections.legacyExact({ all: [{ attribute: 'booking-required', yes: false }] }), false, 'a recorded no is not the absence of a yes');
  const words = collections.legacyWords(
    { any: [{ attribute: 'indoor', yes: true }, { subcategory: ['water'] }] },
    { facts: new Map([['indoor', 'Indoors']]), subs: new Map([['water', 'Lakes & rivers']]) });
  assert.equal(words, '(Indoors or Lakes & rivers)');
});

test('who sees it follows the README for every rule, and a top of 60 or more reads 60+', () => {
  const r = (ages, extra = {}) => collections.cleanRule({ ages, ...extra });
  assert.equal(collections.audienceOf(r(null)).label, 'Everyone');
  assert.equal(collections.audienceOf(r([12, 60], { ageSpan: true })).label, 'Households with someone aged 12–60+');
  assert.equal(collections.audienceOf(r([16, 99])).label, 'Households with an adult');
  assert.equal(collections.audienceOf(r([0, 3])).label, 'Households with someone aged 0–3');
});

async function seedPlaces() {
  await query(`insert into shelf_categories (key, label, position) values ('fun', 'Fun', 1) on conflict (key) do update set active = true`);
  await query(`insert into shelf_subcategories (category_key, key, label, position) values ('fun', 'fc-pools', 'Pools', 1)
               on conflict (key) do update set active = true`);
  for (let i = 1; i <= 6; i++) {
    await query(`insert into place_index (venue_ref, subcategory) values ($1, 'fc-pools')
                 on conflict (venue_ref) do update set subcategory = 'fc-pools', not_in_epic_at = null`, [`fcp:${i}`]);
  }
  // Only the last one has a name we hold.
  await query(`insert into place_records (venue_ref, name) values ('fcp:6', 'The Named Pool') on conflict (venue_ref) do update set name = excluded.name`);
  await query(`insert into place_attribute_values (venue_ref, attribute_key, from_value, to_value, set_by) values ('fcp:6', 'duration', 120, 180, 'a person')
               on conflict (venue_ref, attribute_key) do update set from_value = 120, to_value = 180, set_by = 'a person'`);
  collections.forget();
}

test('examples look past the nameless places, and the preview counts the whole estate for Save', async () => {
  await seedPlaces();
  const out = await collections.preview({ rule: { subs: ['fc-pools'] }, loc: { refs: new Set(['fcp:1']) } });
  assert.equal(out.count, 1, 'within reach');
  assert.equal(out.anywhere, 6, 'the whole estate, which is what Save needs');
  const all = await collections.preview({ rule: { subs: ['fc-pools'] } });
  assert.deepEqual(all.examples.map((e) => e.name), ['The Named Pool']);
});

test('the drawer lists the standard facts in the prototype order and names, duration as a band', async () => {
  await seedPlaces();
  const card = await collections.placeCard('fcp:6');
  assert.deepEqual(card.facts.slice(0, 9).map((f) => f.name),
    ['Indoors', 'Step free', 'Parking', 'Toilets', 'Booking required', 'Food on site', 'Who is it for', 'Duration', 'Cost band']);
  assert.equal(card.facts.find((f) => f.name === 'Duration').value, '2–3 hours');
});

test('an edit is "Collection edited · <title>" with the rule in names; an addition says the rule in names too', async () => {
  await seedPlaces();
  await query(`delete from browse_rows where key like 'fc-%'`);
  const made = await collections.saveCollection({ title: 'FC swim', rule: { subs: ['fc-pools'] }, who: WHO });
  let { rows: [ch] } = await query('select what, before, after from bo_changes where id = $1', [made.change.id]);
  assert.equal(ch.what, 'Collection added · FC swim');
  assert.equal(ch.after, 'Pools');
  const edited = await collections.saveCollection({ key: made.key, title: 'FC swim', rule: { subs: [{ id: 'fc-pools', not: false }], facts: [{ id: 'indoor', not: true }] }, who: WHO });
  ({ rows: [ch] } = await query('select what, before, after from bo_changes where id = $1', [edited.change.id]));
  assert.equal(ch.what, 'Collection edited · FC swim');
  assert.equal(ch.before, 'Pools');
  assert.equal(ch.after, 'Pools · and not Indoors');
  await query('delete from browse_rows where key = $1', [made.key]);
});

test('See as a household sends every row in library order with what the preview needs, and the minimum', async () => {
  await seedPlaces();
  await query(`delete from browse_rows where key like 'fc-%'`);
  await query(`insert into browse_rows (key, grouping, title, copy, predicate, rule, position, active, seeded) values
               ('fc-a', 'custom', 'FC a', 'Copy a', '{}'::jsonb, '{"subs":[{"id":"fc-pools","not":false}]}'::jsonb, -2, true, false),
               ('fc-b', 'custom', 'FC b', '', '{}'::jsonb, '{"subs":[{"id":"fc-pools","not":false}]}'::jsonb, -1, false, false)`);
  const { rows: [h] } = await query(`insert into households (name) values ('FC house') returning id`);
  collections.forget();
  const out = await collections.asHousehold({ householdId: h.id });
  assert.equal(typeof out.minPlaces, 'number');
  const [a, b] = out.rows.filter((r) => r.key.startsWith('fc-'));
  assert.equal(a.key, 'fc-a');
  assert.equal(a.live, true);
  assert.equal(a.places, 6);
  assert.deepEqual(a.shelf.map((p) => p.name), ['The Named Pool']);
  assert.equal(b.live, false, 'a row that is not live is sent, and drawn as not ready');
  assert.equal(b.places, null, 'and its count is not a nought');
  await query(`delete from browse_rows where key like 'fc-%'`);
  await query('delete from households where id = $1', [h.id]);
});

test('migration 270 gave the retired-axis rows the handover rule and left the build-only rows alone', async () => {
  const { rows } = await query(`select key, rule, copy, active, predicate from browse_rows where key in ('bigkids', 'sneaky', 'fun', 'norush', 'byhand', 'toddler', 'neverdone', 'costsnothing', 'teen')`);
  const by = new Map(rows.map((r) => [r.key, r]));
  assert.ok(by.has('bigkids') && by.has('toddler'), 'the seeded rows are in the test database');
  if (by.has('bigkids')) {
    assert.equal(by.get('bigkids').rule?.ageSpan, true);
    assert.deepEqual(by.get('bigkids').rule?.ages, [12, 60]);
    assert.equal(by.get('bigkids').copy, 'Go-karts, axe throwing and other things you’re too old for.');
  }
  if (by.has('sneaky')) assert.equal(by.get('sneaky').rule?.primaryCat ?? 'fun', 'fun');
  for (const k of ['fun', 'norush', 'byhand', 'neverdone']) if (by.has(k)) assert.equal(by.get(k).rule, null, `${k} is left as it was`);
  if (by.has('toddler')) assert.equal(by.get('toddler').rule, null, 'a row whose old predicate still runs keeps it');
  if (by.has('teen')) assert.equal(by.get('teen').copy, 'Things they won’t sneer at.');
});
