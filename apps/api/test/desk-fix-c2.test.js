import { test } from 'node:test';
import assert from 'node:assert/strict';

// The second audit of the back office (28 Sep 2026), Mapping and Collections:
// an undone proposal takes back the drawer it made, an old labels rule is read
// as a pointer, a word always has one primary, the handover rows are live and
// a recorded No is said in the older form (migration 272), an older rule keeps
// its thresholds in words, the preview's examples are found by index, the
// drawer lists at most eight collections, and See as a household judges "near
// you" against the household's own reach.
import { testDatabase } from './helpers/db.js';
const { query, pool } = await testDatabase();
const mapping = await import('../src/desk/mapping.js');
const proposals = await import('../src/desk/proposals.js');
const collections = await import('../src/desk/collections.js');

test.after(() => pool.end());

const WHO = 'test@epic';

// ---------------------------------------------------------------------------
// Mapping

test('undoing an accepted heritage_railway retires the drawer it made, its rule and bar, and the reopened proposal still says new subcategory', async () => {
  await query(`insert into shelf_categories (key, label, position) values ('fun', 'Fun', 1) on conflict (key) do update set active = true`);
  await query(`delete from ready_bars where subcategory_key = 'heritage-railways'`);
  await query(`delete from shelf_rules where subcategory = 'heritage-railways' or subject = 'heritage-railways'`);
  await query(`delete from word_targets where subcategory_key = 'heritage-railways'`);
  await query(`delete from shelf_subcategories where key = 'heritage-railways'`);
  await query(`insert into taxonomy_labels (namespace, key, label, points_at, active) values ('google', 'heritage_railway', 'heritage railway', null, true)
               on conflict (namespace, key) do update set points_at = null, decision = null, active = true`);
  await query(`delete from word_targets where word = 'heritage_railway'`);
  await query(`delete from word_proposals where word = 'heritage_railway'`);
  await query(`delete from word_decisions where word = 'heritage_railway'`);
  await proposals.refreshProposals();
  const { rows: [p] } = await query(`select id from word_proposals where word = 'heritage_railway' and state = 'open'`);
  assert.ok(p, 'raised');

  const out = await mapping.decideProposal({ id: p.id, action: 'apply', who: WHO });
  let { rows: [sub] } = await query(`select active from shelf_subcategories where key = 'heritage-railways'`);
  assert.equal(sub.active, true, 'made on accept');
  assert.deepEqual(out.decision.after.created, { sub: 'heritage-railways' });
  let state = await mapping.mappingState();
  assert.ok(state.inEpic.some((w) => w.word === 'heritage_railway'));

  await mapping.undo({ id: out.decision.id, who: WHO });
  ({ rows: [sub] } = await query(`select active from shelf_subcategories where key = 'heritage-railways'`));
  assert.equal(sub.active, false, 'retired again: nothing else uses it');
  const { rows: ours } = await query(`select 1 from shelf_rules where scope = 'ours' and subject = 'heritage-railways'`);
  assert.equal(ours.length, 0, 'its ours rule goes with it');
  const { rows: bars } = await query(`select 1 from ready_bars where subcategory_key = 'heritage-railways'`);
  assert.equal(bars.length, 0, 'and its inherited bar');
  const { rows: added } = await query(`select undone_at from bo_changes where subject_type = 'subcategory' and subject_id = 'heritage-railways' and what like 'Subcategory added%' order by at desc limit 1`);
  assert.ok(added[0]?.undone_at, 'its "Subcategory added" change is marked undone');

  state = await mapping.mappingState();
  const back = state.needs.find((w) => w.word === 'heritage_railway');
  assert.ok(back, 'the proposal reopens');
  assert.equal(back.proposal.changeTo, 'Fun › Heritage railways (new subcategory)');

  // Accept it again: the retired drawer is switched back on.
  const again = await mapping.decideProposal({ id: p.id, action: 'apply', who: WHO });
  ({ rows: [sub] } = await query(`select active from shelf_subcategories where key = 'heritage-railways'`));
  assert.equal(sub.active, true);
  await mapping.undo({ id: again.decision.id, who: WHO });
});

test('a drawer made by a proposal stays when something else has come to use it, and then the proposal no longer says new', async () => {
  await query(`insert into shelf_categories (key, label, position) values ('fun', 'Fun', 1) on conflict (key) do update set active = true`);
  await query(`insert into taxonomy_labels (namespace, key, label, points_at, active) values
               ('google', 'heritage_railway', 'heritage railway', null, true), ('google', 'c2_steam', 'steam', null, true)
               on conflict (namespace, key) do update set points_at = null, decision = null, active = true`);
  await query(`delete from word_targets where word in ('heritage_railway', 'c2_steam')`);
  await query(`delete from word_proposals where word = 'heritage_railway'`);
  await query(`delete from word_decisions where word in ('heritage_railway', 'c2_steam')`);
  await proposals.refreshProposals();
  const { rows: [p] } = await query(`select id from word_proposals where word = 'heritage_railway' and state = 'open'`);
  const out = await mapping.decideProposal({ id: p.id, action: 'apply', who: WHO });
  // Another word now points there too.
  await mapping.setTargets({ word: 'c2_steam', subs: ['heritage-railways'], who: WHO });
  await mapping.undo({ id: out.decision.id, who: WHO });
  const { rows: [sub] } = await query(`select active from shelf_subcategories where key = 'heritage-railways'`);
  assert.equal(sub.active, true, 'in use, so kept');
  const state = await mapping.mappingState();
  const back = state.needs.find((w) => w.word === 'heritage_railway');
  assert.equal(back.proposal.changeTo, 'Fun › Heritage railways', 'accepting would make nothing, so it does not say new');
  await query(`delete from word_targets where word = 'c2_steam'`);
});

test('a word with no targets that an old labels rule still files is In Epic, pointing at that drawer', async () => {
  await query(`insert into shelf_categories (key, label, position) values ('culture', 'Culture', 2) on conflict (key) do update set active = true`);
  await query(`insert into shelf_subcategories (category_key, key, label, position) values ('culture', 'c2-towers', 'Towers', 1)
               on conflict (key) do update set active = true`);
  await query(`insert into taxonomy_labels (namespace, key, label, points_at, active) values ('google', 'c2_tower', 'tower', null, true)
               on conflict (namespace, key) do update set points_at = null, decision = null, active = true`);
  await query(`delete from word_targets where word = 'c2_tower'`);
  await query(`delete from word_proposals where word = 'c2_tower'`);
  await query(`delete from shelf_rules where scope = 'labels' and subject = 'google:c2_tower'`);
  let state = await mapping.mappingState();
  assert.ok(state.needs.some((w) => w.word === 'c2_tower'), 'unanswered, with nothing filing it');

  await query(`insert into shelf_rules (scope, subject, subject_label, weights, subcategory, reason, taught_by, seeded, labels)
               values ('labels', 'google:c2_tower', 'tower', '{}'::jsonb, 'c2-towers', 'old', 'someone', false, '{google:c2_tower}')`);
  state = await mapping.mappingState();
  assert.ok(!state.needs.some((w) => w.word === 'c2_tower'), 'no longer shown as unanswered');
  const w = state.inEpic.find((x) => x.word === 'c2_tower');
  assert.ok(w, 'In Epic');
  assert.equal(w.answer, 'mapped');
  assert.deepEqual(w.targets.map((t) => [t.key, t.primary]), [['c2-towers', true]]);

  // A word taken out of Epic is not brought back by a leftover rule.
  await query(`update taxonomy_labels set decision = 'aside' where namespace = 'google' and key = 'c2_tower'`);
  state = await mapping.mappingState();
  assert.ok(state.notInEpic.some((x) => x.word === 'c2_tower'));
  await query(`delete from shelf_rules where scope = 'labels' and subject = 'google:c2_tower'`);
  await query(`update taxonomy_labels set decision = null where namespace = 'google' and key = 'c2_tower'`);
});

test('a word never reads as answered without a primary, and saving targets always writes exactly one', async () => {
  await query(`insert into shelf_categories (key, label, position) values ('culture', 'Culture', 2) on conflict (key) do update set active = true`);
  await query(`insert into shelf_subcategories (category_key, key, label, position) values
               ('culture', 'c2-towers', 'Towers', 1), ('culture', 'c2-walls', 'Walls', 2) on conflict (key) do update set active = true`);
  await query(`insert into taxonomy_labels (namespace, key, label, points_at, active) values ('google', 'c2_keep', 'keep', null, true)
               on conflict (namespace, key) do update set points_at = null, decision = null, active = true`);
  await query(`delete from word_targets where word = 'c2_keep'`);
  await query(`insert into word_targets (namespace, word, subcategory_key, is_primary, position) values
               ('google', 'c2_keep', 'c2-walls', false, 0), ('google', 'c2_keep', 'c2-towers', false, 1)`);
  const state = await mapping.mappingState();
  const w = state.inEpic.find((x) => x.word === 'c2_keep');
  assert.equal(w.targets.filter((t) => t.primary).length, 1);
  assert.equal(w.targets[0].key, 'c2-walls', 'the first target is read as the primary');

  await mapping.setTargets({ word: 'c2_keep', subs: ['c2-towers', 'c2-walls'], primary: 'nonsense', who: WHO });
  const { rows } = await query(`select subcategory_key, is_primary from word_targets where word = 'c2_keep' order by position`);
  assert.deepEqual(rows.map((r) => [r.subcategory_key, r.is_primary]), [['c2-towers', true], ['c2-walls', false]]);
  await query(`delete from word_targets where word = 'c2_keep'`);
});

// ---------------------------------------------------------------------------
// Collections: migration 272

test('migration 272: every handover row with a rule is live, and a recorded No is the exact older form', async () => {
  const { rows } = await query(`select key, active, rule, predicate from browse_rows
                                 where key in ('twoofyou', 'bigkids', 'sneaky', 'halfday', 'history', 'stilllight', 'quiet', 'cheapcheerful')`);
  const by = new Map(rows.map((r) => [r.key, r]));
  assert.ok(by.has('bigkids'), 'the seeded rows are in the test database');
  // Live unless the household rule still names a retired axis (migration 273,
  // the owner's rule from 246): then off until it is rewritten.
  const axis = /"how-(thrilling|much-walking|much-planning|new|busy-and-loud|much-you-learn|smart|long-a-day)"/;
  for (const k of ['twoofyou', 'bigkids', 'sneaky', 'halfday', 'history']) {
    if (!by.has(k)) continue;
    const r = by.get(k);
    assert.equal(r.active, !axis.test(JSON.stringify(r.predicate)), `${k}: live exactly when its household rule can run`);
  }
  const still = by.get('stilllight');
  if (still) {
    assert.equal(still.rule, null);
    assert.deepEqual(still.predicate, { all: [{ attribute: 'indoor', yes: false }] });
    assert.equal(still.active, true);
  }
  const quiet = by.get('quiet');
  if (quiet) {
    assert.equal(quiet.rule, null);
    assert.deepEqual(quiet.predicate.all.at(-1), { attribute: 'booking-required', yes: false });
    assert.ok(!JSON.stringify(quiet.predicate).includes('how-'), 'no retired axis left');
  }
  const cheap = by.get('cheapcheerful');
  if (cheap) {
    assert.equal(cheap.rule, null);
    assert.deepEqual(cheap.predicate, { all: [{ attribute: 'cost-band', choice: 'cheap' }, { attribute: 'booking-required', yes: false }] });
  }
});

test('the older form: a cost band is matched and said, a No is a recorded No, and a retired axis keeps its threshold in words', () => {
  const cheap = { all: [{ attribute: 'cost-band', choice: 'cheap' }, { attribute: 'booking-required', yes: false }] };
  const place = (cost, no) => ({ cats: [], subs: [], facts: new Set(), no: new Set(no), cost });
  assert.equal(collections.matchesPredicate(cheap, place('Cheap', ['booking-required'])), true);
  assert.equal(collections.matchesPredicate(cheap, place('Cheap', [])), false, 'never asked is not a No');
  assert.equal(collections.matchesPredicate(cheap, place('Free', ['booking-required'])), false);
  assert.equal(collections.legacyExact(cheap), false, 'shown read-only');
  const names = { facts: new Map([['cost-band', 'Cost band'], ['booking-required', 'Booking required'], ['how-much-you-learn', 'How much you learn']]) };
  assert.equal(collections.legacyWords(cheap, names), 'Cost band: cheap and Booking required: no');
  assert.equal(collections.legacyWords({ all: [{ attribute: 'how-much-you-learn', atLeast: 3 }] }, names), 'How much you learn at least 3');
  assert.equal(collections.legacyWords({ all: [{ attribute: 'how-much-you-learn', atMost: 1 }] }, names), 'How much you learn at most 1');
  assert.equal(collections.legacyWords({ all: [{ attribute: 'suits-ages', from: 12 }] }, names), 'suits ages from 12');
});

// ---------------------------------------------------------------------------
// Collections: preview, drawer, household

async function seedMany() {
  await query(`insert into shelf_categories (key, label, position) values ('fun', 'Fun', 1) on conflict (key) do update set active = true`);
  await query(`insert into shelf_subcategories (category_key, key, label, position) values ('fun', 'c2-lanes', 'Lanes', 1)
               on conflict (key) do update set active = true`);
  await query(`insert into place_index (venue_ref, subcategory)
               select 'c2l:' || g, 'c2-lanes' from generate_series(1, 450) g
               on conflict (venue_ref) do update set subcategory = 'c2-lanes', not_in_epic_at = null`);
  // Only the 430th has a name we hold: past every old batch of two hundred.
  await query(`delete from place_records where venue_ref like 'c2l:%'`);
  await query(`insert into place_records (venue_ref, name) values ('c2l:430', 'The Far Lane') on conflict (venue_ref) do update set name = excluded.name`);
  collections.forget();
}

test('the preview finds a name far down a nameless drawer by index, and a count-only preview names nothing', async () => {
  await seedMany();
  const out = await collections.preview({ rule: { subs: ['c2-lanes'] } });
  assert.equal(out.count, 450);
  assert.deepEqual(out.examples.map((e) => e.name), ['The Far Lane']);
  const bare = await collections.preview({ rule: { subs: ['c2-lanes'] }, examples: false });
  assert.equal(bare.count, 450);
  assert.deepEqual(bare.examples, []);
});

test('the drawer lists a place in at most eight collections', async () => {
  await seedMany();
  await query(`delete from browse_rows where key like 'c2-%'`);
  for (let i = 0; i < 11; i++) {
    await query(`insert into browse_rows (key, grouping, title, copy, predicate, rule, position, active, seeded)
                 values ($1, 'custom', $2, '', '{}'::jsonb, '{"subs":[{"id":"c2-lanes","not":false}]}'::jsonb, $3, true, false)`,
    [`c2-${i}`, `C2 ${i}`, 500 + i]);
  }
  collections.forget();
  const card = await collections.placeCard('c2l:430');
  assert.ok(card.collections.length <= 8);
  await query(`delete from browse_rows where key like 'c2-%'`);
});

test('See as a household judges near you by the household’s own home: with none, nothing is near and nothing is waiting', async () => {
  await seedMany();
  await query(`delete from browse_rows where key like 'c2-%'`);
  await query(`insert into browse_rows (key, grouping, title, copy, predicate, rule, position, active, seeded)
               values ('c2-h', 'custom', 'C2 h', '', '{}'::jsonb, '{"subs":[{"id":"c2-lanes","not":false}]}'::jsonb, -3, true, false)`);
  const { rows: [h] } = await query(`insert into households (name) values ('C2 house') returning id`);
  const { rows: [m] } = await query(`insert into members (household_id, name, birth_year) values ($1, 'Bo', 1980) returning id`, [h.id]);
  await query(`insert into browse_row_hearts (row_key, household_id, member_id, hearted_at) values ('c2-h', $1, $2, now())`, [h.id, m.id]);
  collections.forget();
  // The desk's own filter is not what a household sees.
  const out = await collections.asHousehold({ householdId: h.id, loc: { refs: new Set(), speaks: true } });
  assert.equal(out.reach, null, 'no home set');
  const row = out.rows.find((r) => r.key === 'c2-h');
  assert.equal(row.places, null, 'cannot say what is near: null, never a nought');
  assert.ok(out.shown.some((c) => c.key === 'c2-h'), 'and so never hidden as too thin');
  assert.deepEqual(row.shelf.map((p) => p.name), ['The Far Lane'], 'the shelf looks past the first twelve for a name');
  assert.equal(out.hearts[0].memberId, m.id, 'a heart says whose it is, by id');
  assert.equal(await collections.householdReach({ home_label: null, home_lat: null, home_lng: null }), null);
  await query(`delete from browse_rows where key like 'c2-%'`);
  await query('delete from households where id = $1', [h.id]);
});

test('a fact a proposal made comes back on when the proposal is accepted again, and neither it nor its drawer is retired once something else uses it', async () => {
  await query(`insert into shelf_categories (key, label, position) values ('educational', 'Educational', 9) on conflict (key) do update set active = true`);
  await query(`delete from ready_bars where subcategory_key = 'science-learning-centres'`);
  await query(`delete from shelf_rules where subcategory = 'science-learning-centres' or subject = 'science-learning-centres'`);
  await query(`delete from word_targets where subcategory_key = 'science-learning-centres'`);
  await query(`delete from shelf_subcategory_attributes where subcategory_key = 'science-learning-centres'`);
  await query(`delete from subcategory_facts where subcategory_key = 'science-learning-centres' or attribute_key = 'has-planetarium'`);
  await query(`delete from shelf_subcategories where key = 'science-learning-centres'`);
  await query(`insert into taxonomy_labels (namespace, key, label, points_at, active) values ('google', 'planetarium', 'planetarium', null, true)
               on conflict (namespace, key) do update set points_at = null, decision = null, active = true`);
  await query(`delete from word_targets where word = 'planetarium'`);
  await query(`delete from word_proposals where word = 'planetarium'`);
  await query(`delete from word_decisions where word = 'planetarium'`);
  await proposals.refreshProposals();
  const { rows: [p] } = await query(`select id from word_proposals where word = 'planetarium' and state = 'open'`);
  assert.ok(p, 'raised');
  const fact = async () => (await query(`select active from place_attributes where key = 'has-planetarium'`)).rows[0]?.active;
  const drawer = async () => (await query(`select active from shelf_subcategories where key = 'science-learning-centres'`)).rows[0]?.active;

  let out = await mapping.decideProposal({ id: p.id, action: 'apply', who: WHO });
  assert.equal(await fact(), true);
  await mapping.undo({ id: out.decision.id, who: WHO });
  assert.equal(await fact(), false, 'retired: nothing holds it');
  out = await mapping.decideProposal({ id: p.id, action: 'apply', who: WHO });
  assert.equal(await fact(), true, 'accepting again switches it back on');

  // Something else comes to use both: a person sets a default on the drawer,
  // and a collection names the fact. Undo then leaves both on.
  await query(`insert into shelf_subcategory_attributes (subcategory_key, attribute_key, yesno, origin) values ('science-learning-centres', 'toilets', true, 'person')`);
  await query(`insert into browse_rows (key, grouping, title, predicate, active, rule) values ('c2-planets', 'Test', 'Stars', '{"all":[]}'::jsonb, false, '{"facts":[{"id":"has-planetarium"}]}'::jsonb)
               on conflict (key) do update set rule = excluded.rule`);
  await mapping.undo({ id: out.decision.id, who: WHO });
  assert.equal(await drawer(), true, 'a drawer a person has configured is kept');
  assert.equal(await fact(), true, 'a fact a collection names is kept');
  await query(`delete from browse_rows where key = 'c2-planets'`);
  await query(`delete from shelf_subcategory_attributes where subcategory_key = 'science-learning-centres'`);
});
