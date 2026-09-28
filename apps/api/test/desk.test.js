import { test } from 'node:test';
import assert from 'node:assert/strict';

// The rebuilt filing desk (back-office handover, 28 Sep 2026): settings with
// history, the Changes log, word decisions with undo, proposals checked
// against the register, defaults, facts, collections, accuracy's can't-speak
// state. A database of this file's own, built from the committed migrations.
import { testDatabase } from './helpers/db.js';
const { query, pool } = await testDatabase();
const settings = await import('../src/desk/settings.js');
const changes = await import('../src/desk/changes.js');
const mapping = await import('../src/desk/mapping.js');
const proposals = await import('../src/desk/proposals.js');
const categories = await import('../src/desk/categories.js');
const facts = await import('../src/desk/facts.js');
const collections = await import('../src/desk/collections.js');
const accuracy = await import('../src/desk/accuracy.js');
const verification = await import('../src/desk/verification.js');
const { overview } = await import('../src/desk/overview.js');

test.after(() => pool.end());

const WHO = 'test@epic';

async function seedTaxonomy() {
  await query(`insert into shelf_categories (key, label, position) values ('fun', 'Fun', 1), ('culture', 'Culture', 2), ('educational', 'Educational', 3)
               on conflict (key) do update set active = true`);
  await query(`insert into shelf_subcategories (category_key, key, label, position) values
               ('fun', 'desk-water', 'Water parks', 1), ('fun', 'desk-play', 'Play & soft play', 2),
               ('culture', 'desk-museums', 'Museums', 3), ('culture', 'desk-landmarks', 'Landmarks', 4)
               on conflict (key) do update set active = true`);
  await query(`insert into taxonomy_labels (namespace, key, label, points_at, active) values
               ('google', 'desk_water_park', 'water park', 'desk-water', true),
               ('google', 'desk_church', 'church', 'desk-museums', true),
               ('google', 'desk_new_word', 'new word', null, true)
               on conflict (namespace, key) do update set points_at = excluded.points_at, decision = null, active = true`);
  await query(`delete from word_targets where word like 'desk_%'`);
  await query(`insert into word_targets (namespace, word, subcategory_key, is_primary) values ('google', 'desk_water_park', 'desk-water', true), ('google', 'desk_church', 'desk-museums', true)`);
}

// ---------------------------------------------------------------------------
// Settings

test('a setting is read from the table, validated, versioned and logged in Changes', async () => {
  await query(`delete from bo_settings_log where key = 'addPlaces'`);
  settings.forget();
  const before = await settings.setting('addPlaces');
  assert.equal(before, 2, 'the handover default');
  await assert.rejects(settings.setSetting('addPlaces', 0, { who: WHO }), /between/);
  await assert.rejects(settings.setSetting('nope', 1, { who: WHO }), /not a setting/);
  const out = await settings.setSetting('addPlaces', 3, { who: WHO });
  assert.equal(out.changed, true);
  assert.equal(await settings.setting('addPlaces'), 3);
  const { rows: log } = await query(`select before, after, who from bo_settings_log where key = 'addPlaces'`);
  assert.equal(log.length, 1);
  assert.deepEqual([log[0].before, log[0].after, log[0].who], [2, 3, WHO]);
  const same = await settings.setSetting('addPlaces', 3, { who: WHO });
  assert.equal(same.changed, false, 'a change that changes nothing is not written down');
  const { rows: ch } = await query(`select * from bo_changes where area = 'Fact automations' and subject_id = 'addPlaces'`);
  assert.equal(ch.length, 1);
  assert.equal(ch[0].before, '2');
  assert.equal(ch[0].after, '3');
  await settings.setSetting('addPlaces', 2, { who: WHO });
});

test('the owner\'s decisions of 28 Sep are the seeded values', async () => {
  settings.forget();
  const { values } = await settings.settings();
  assert.equal(values.recheckAccess, 6);
  assert.equal(values.verifySources, 1);
  assert.equal(values.shareMax, 90);
  assert.equal(values.budgetGoogle, 50);
  assert.equal(values.budgetClaude, 30);
  assert.deepEqual(values.ageBands.map((b) => b.label), ['Babies under 2', 'Toddlers 2–4', 'Young children 5–8', 'Older children 9–12', 'Teens 13–17', 'Adults 18+']);
  assert.deepEqual(values.durationBands.map((b) => b.label), ['Under 1 hour', '1–2 hours', '2–3 hours', 'Half a day', 'A full day']);
  assert.deepEqual(values.costBands.GB.bands.map((b) => b.key), ['Free', 'Cheap', 'Mid', 'Dear']);
  assert.equal(values.costBands.IE.currency, 'EUR');
});

// ---------------------------------------------------------------------------
// Mapping

test('a word points at several subcategories with exactly one primary, and the classifier sees the primary', async () => {
  await seedTaxonomy();
  const out = await mapping.setTargets({ word: 'desk_water_park', subs: ['desk-play', 'desk-water'], primary: 'desk-water', why: 'both', who: WHO });
  assert.equal(out.decision.kind, 'Repointed');
  const { rows: t } = await query(`select subcategory_key, is_primary from word_targets where word = 'desk_water_park' order by is_primary desc`);
  assert.deepEqual(t.map((r) => [r.subcategory_key, r.is_primary]), [['desk-water', true], ['desk-play', false]]);
  const { rows: [w] } = await query(`select points_at from taxonomy_labels where key = 'desk_water_park'`);
  assert.equal(w.points_at, 'desk-water');
  const { rows: [rule] } = await query(`select subcategory from shelf_rules where scope = 'labels' and subject = 'google:desk_water_park'`);
  assert.equal(rule.subcategory, 'desk-water');
  await assert.rejects(mapping.setTargets({ word: 'desk_water_park', subs: [], who: WHO }), /exclude/i, 'the primary cannot be unticked');
});

test('excluding a word takes it out of all three tables, and undo puts every one back', async () => {
  await seedTaxonomy();
  const out = await mapping.exclude({ word: 'desk_church', why: 'Not a place people visit', who: WHO });
  let { rows: [w] } = await query(`select decision, points_at, active from taxonomy_labels where key = 'desk_church'`);
  assert.deepEqual(w, { decision: 'aside', points_at: null, active: false });
  let { rows: t } = await query(`select * from word_targets where word = 'desk_church'`);
  assert.equal(t.length, 0);
  const { rows: [ch] } = await query(`select * from bo_changes where area = 'Mapping' and subject_id = 'desk_church' order by at desc limit 1`);
  assert.equal(ch.why, 'Not a place people visit');
  assert.equal(ch.after, 'Not in Epic');
  await mapping.undo({ id: out.decision.id, who: WHO });
  ({ rows: [w] } = await query(`select decision, points_at, active from taxonomy_labels where key = 'desk_church'`));
  assert.deepEqual(w, { decision: null, points_at: 'desk-museums', active: true });
  ({ rows: t } = await query(`select subcategory_key, is_primary from word_targets where word = 'desk_church'`));
  assert.deepEqual(t.map((r) => [r.subcategory_key, r.is_primary]), [['desk-museums', true]]);
  const { rows: [ch2] } = await query(`select undone_at from bo_changes where id = $1`, [ch.id]);
  assert.ok(ch2.undone_at, 'the change is marked undone, not deleted');
});

test('only the latest decision on a word can be undone', async () => {
  await seedTaxonomy();
  const a = await mapping.setTargets({ word: 'desk_church', subs: ['desk-landmarks'], who: WHO });
  const b = await mapping.setTargets({ word: 'desk_church', subs: ['desk-museums'], who: WHO });
  await assert.rejects(mapping.undo({ id: a.decision.id, who: WHO }), /later decision/);
  await mapping.undo({ id: b.decision.id, who: WHO });
  await mapping.undo({ id: a.decision.id, who: WHO });
});

test('a word appears in exactly one view, and an undecided word needs a decision with no suggestion', async () => {
  await seedTaxonomy();
  const state = await mapping.mappingState();
  const where = (word) => ['inEpic', 'needs', 'notInEpic'].filter((v) => state[v].some((r) => r.word === word));
  assert.deepEqual(where('desk_water_park'), ['inEpic']);
  assert.deepEqual(where('desk_new_word'), ['needs']);
  assert.equal(state.needs.find((r) => r.word === 'desk_new_word').proposal.group, 'no_suggestion');
  assert.equal(state.everOpenedSpeaks, false, 'with no second household, ever-opened cannot speak');
});

test('a proposal that changes nothing is not raised; a kept one is never raised again', async () => {
  const bridge = proposals.SEEDS.find((s) => s.word === 'bridge');
  assert.equal(proposals.changesSomething(bridge, { decision: 'aside' }), false, 'already excluded');
  assert.equal(proposals.changesSomething(bridge, { decision: null, points_at: 'x' }), true);
  const church = proposals.SEEDS.find((s) => s.word === 'church');
  assert.equal(proposals.changesSomething(church, { decision: 'aside' }), false, 'a person settled it out; the register wins');
  assert.equal(proposals.changesSomething(proposals.SEEDS.find((s) => s.word === 'tourist_attraction'), { decision: 'generic' }), false);

  await query(`insert into taxonomy_labels (namespace, key, label, points_at, active) values ('google', 'planetarium', 'planetarium', null, true)
               on conflict (namespace, key) do update set decision = null, active = true`);
  await query(`delete from word_proposals where word = 'planetarium'`);
  const r1 = await proposals.refreshProposals();
  assert.ok(r1.raised >= 1);
  const { rows: [p] } = await query(`select * from word_proposals where word = 'planetarium' and state = 'open'`);
  assert.equal(p.change_to.newSub.label, 'Science & learning centres');
  await mapping.decideProposal({ id: p.id, action: 'keep', why: 'not now', who: WHO });
  await proposals.refreshProposals();
  const { rows: open } = await query(`select * from word_proposals where word = 'planetarium' and state = 'open'`);
  assert.equal(open.length, 0, 'kept is never raised again');
});

test('accepting a proposal that names a new subcategory and fact makes both, with a bar, and logs them', async () => {
  await seedTaxonomy();
  await query(`insert into taxonomy_labels (namespace, key, label, points_at, active) values ('google', 'desk_planet', 'planetarium', 'desk-museums', true)
               on conflict (namespace, key) do update set points_at = 'desk-museums', decision = null, active = true`);
  const { rows: [p] } = await query(
    `insert into word_proposals (word, grp, action, change_to) values ('desk_planet', 'fold', 'repoint', $1::jsonb) returning id`,
    [JSON.stringify({ text: 'x', subcategory: 'desk-science', newSub: { key: 'desk-science', label: 'Science desk', category: 'educational' }, fact: 'desk-has-planetarium', newFact: { key: 'desk-has-planetarium', label: 'Has a planetarium' } })]);
  await mapping.decideProposal({ id: p.id, action: 'apply', who: WHO });
  const { rows: [s] } = await query(`select active, category_key from shelf_subcategories where key = 'desk-science'`);
  assert.deepEqual(s, { active: true, category_key: 'educational' });
  const { rows: bar } = await query(`select 1 from ready_bars where subcategory_key = 'desk-science'`);
  assert.ok(bar.length > 0, 'a new drawer has a bar the moment it exists');
  const { rows: [c] } = await query(`select * from taxonomy_label_carries where key = 'desk_planet' and attribute_key = 'desk-has-planetarium'`);
  assert.ok(c);
  const { rows: logged } = await query(`select area from bo_changes where subject_id in ('desk-science', 'desk-has-planetarium') order by area`);
  assert.deepEqual(logged.map((r) => r.area), ['Categories', 'Facts']);
});

// ---------------------------------------------------------------------------
// Categories and defaults

test('a person-set default is logged with its Why, and undo puts back what was there', async () => {
  await seedTaxonomy();
  await query(`delete from shelf_subcategory_attributes where subcategory_key = 'desk-water'`);
  const out = await categories.setDefaults({ subs: ['desk-water'], fact: 'indoor', option: 'yes', who: WHO });
  const { rows: [d] } = await query(`select yesno, origin, set_by, settled from shelf_subcategory_attributes where subcategory_key = 'desk-water' and attribute_key = 'indoor'`);
  assert.deepEqual(d, { yesno: true, origin: 'person', set_by: WHO, settled: true });
  const change = (await query('select * from bo_changes where id = $1', [out.changes[0].id])).rows[0];
  assert.equal(change.area, 'Defaults');
  assert.equal(change.after, 'Yes');
  await categories.undoDefault({ change, who: WHO });
  const { rows: gone } = await query(`select 1 from shelf_subcategory_attributes where subcategory_key = 'desk-water' and attribute_key = 'indoor'`);
  assert.equal(gone.length, 0);
  await assert.rejects(categories.setDefaults({ subs: ['desk-water'], fact: 'desk-has-planetarium', option: 'yes', who: WHO }), /not a standard fact|not one of our facts/);
});

test('the subcategory list counts a place once, secondaries included, and its page flags a contradicted default', async () => {
  await seedTaxonomy();
  for (const r of ['desk:1', 'desk:2', 'desk:3', 'desk:4']) {
    await query(`insert into place_index (venue_ref, subcategory) values ($1, 'desk-water') on conflict (venue_ref) do update set subcategory = 'desk-water', not_in_epic_at = null`, [r]);
    await query(`insert into place_attribute_values (venue_ref, attribute_key, yesno, set_by) values ($1, 'indoor', false, 'checker')
                 on conflict (venue_ref, attribute_key) do update set yesno = false, set_by = 'checker'`, [r]);
  }
  await categories.setDefaults({ subs: ['desk-water'], fact: 'indoor', option: 'yes', who: WHO });
  const page = await categories.subcategoryPage('desk-water');
  const indoor = page.defaults.find((d) => d.fact === 'indoor');
  assert.equal(indoor.origin, 'person');
  assert.equal(indoor.contradicted, true, '4 confirmed, all disagree');
  assert.equal(indoor.contradiction, '4 of 4 confirmed places say otherwise');
  const list = await categories.subcategoryList({});
  const row = list.rows.find((r) => r.key === 'desk-water');
  assert.equal(row.places, 4);
  const impact = await categories.bulkImpact({ subs: ['desk-water'], fact: 'indoor' });
  assert.deepEqual(impact, { applies: 0, keep: 4 });
});

test('a removed fact is ignored with its reason and can be put back; Include anyway is only for on-every-place', async () => {
  await seedTaxonomy();
  await query(`insert into subcategory_facts (subcategory_key, attribute_key, status, active_since) values ('desk-water', 'toilets', 'active', now())
               on conflict (subcategory_key, attribute_key) do update set status = 'active', reason = null`);
  await categories.removeFact({ sub: 'desk-water', fact: 'toilets', who: WHO });
  const ex = await facts.excludedFacts();
  const row = ex.find((r) => r.sub === 'desk-water' && r.fact === 'toilets');
  assert.equal(row.why, 'Removed by a person');
  assert.equal(row.action, 'put_back');
  await assert.rejects(categories.restoreFact({ sub: 'desk-water', fact: 'toilets', who: WHO, mode: 'include_anyway' }), /nearly every place/);
  await categories.restoreFact({ sub: 'desk-water', fact: 'toilets', who: WHO, mode: 'put_back' });
  const { rows: [f] } = await query(`select status from subcategory_facts where subcategory_key = 'desk-water' and attribute_key = 'toilets'`);
  assert.equal(f.status, 'active');
});

test('All facts lists standard facts as All and one row per fact', async () => {
  const out = await facts.allFacts({});
  const indoor = out.rows.find((r) => r.fact === 'indoor');
  assert.equal(indoor.subcategories, 'All');
  assert.equal(indoor.statusText, '');
  assert.equal(new Set(out.rows.map((r) => r.fact)).size, out.rows.length, 'one row per fact');
});

// ---------------------------------------------------------------------------
// Collections

test('a collection rule: any within a group, all across groups, not excludes', () => {
  const p = { cats: ['fun'], primaryCat: 'fun', subs: ['desk-water'], facts: new Set(['indoor']), ages: [2, 12], hours: 2, cost: 'Cheap' };
  const r = (x) => collections.cleanRule(x);
  assert.ok(collections.matches(r({ cats: ['fun', 'culture'] }), p));
  assert.ok(!collections.matches(r({ cats: ['culture'] }), p));
  assert.ok(!collections.matches(r({ cats: ['fun'], facts: [{ id: 'indoor', not: true }] }), p));
  assert.ok(collections.matches(r({ ages: [0, 3] }), p), 'ages overlap');
  assert.ok(!collections.matches(r({ ages: [12, 60], ageSpan: true }), p), 'Big kids needs from ≤12 to ≥60');
  assert.ok(collections.matches(r({ primaryCat: 'fun' }), p));
  assert.ok(collections.matches(r({ cost: ['Cheap', 'Free'] }), p));
});

test('who sees a collection is derived from its rule, never set', () => {
  assert.equal(collections.audienceOf(collections.cleanRule({})).label, 'Everyone');
  assert.equal(collections.audienceOf(collections.cleanRule({ ages: [16, 99] })).label, 'Households with an adult');
  assert.equal(collections.audienceOf(collections.cleanRule({ ages: [0, 3] })).label, 'Households with someone aged 0–3');
});

test('the old row rules read in the new model', () => {
  const r = collections.fromPredicate({ all: [{ not: { subcategory: ['coast'] } }, { yes: true, attribute: 'indoor' }] });
  assert.deepEqual(r.subs, [{ id: 'coast', not: true }]);
  assert.deepEqual(r.facts, [{ id: 'indoor', not: false }]);
  const a = collections.fromPredicate({ all: [{ overlaps: [0, 3], attribute: 'suits-ages' }] });
  assert.deepEqual(a.ages, [0, 3]);
});

test('saving a collection needs a title, a rule and a place, and logs each field that changed', async () => {
  await seedTaxonomy();
  await query(`insert into place_index (venue_ref, subcategory) values ('desk:c1', 'desk-play') on conflict (venue_ref) do update set subcategory = 'desk-play', not_in_epic_at = null`);
  collections.forget();
  await assert.rejects(collections.saveCollection({ title: '', rule: { subs: ['desk-play'] }, who: WHO }), /title/);
  await assert.rejects(collections.saveCollection({ title: 'x', rule: {}, who: WHO }), /rule/);
  const made = await collections.saveCollection({ title: 'Desk play', copy: 'Let off steam.', rule: { subs: ['desk-play'] }, who: WHO });
  assert.equal(made.created, true);
  const again = await collections.saveCollection({ key: made.key, title: 'Desk play days', copy: 'Let off steam.', rule: { subs: ['desk-play'] }, who: WHO });
  assert.equal(again.changed, 1);
  const { rows } = await query(`select what from bo_changes where area = 'Collections' and subject_id = $1 order by at`, [made.key]);
  assert.deepEqual(rows.map((r) => r.what.split(' · ')[0]), ['Collection added', 'Collection title']);
});

// ---------------------------------------------------------------------------
// Can't-speak states

test('accuracy under ten answers is Building, never a percentage', () => {
  const few = Array.from({ length: 9 }, (_, i) => ({ venue_ref: `r${i}`, at: new Date(), agreed: true }));
  assert.equal(accuracy.figure(few).accuracy, null);
  assert.equal(accuracy.figure(few).building, true);
  const ten = [...few, { venue_ref: 'r9', at: new Date(), agreed: false }];
  assert.equal(accuracy.figure(ten).accuracy, 90);
  const twice = [{ venue_ref: 'a', at: new Date(), agreed: false }, { venue_ref: 'a', at: new Date(), agreed: false }];
  assert.equal(accuracy.figure(twice).disagreements, 1, 'one disagreement per place per day');
});

test('verification that has never run says so rather than drawing an empty page', async () => {
  await query('delete from fact_checks');
  const out = await verification.verification({});
  assert.equal(out.status.state, 'never');
  assert.equal(out.backlog, undefined, 'nothing below the status when it has never run');
});

test('the overview answers with no inputs and says what needs a person', async () => {
  await seedTaxonomy();
  const o = await overview();
  assert.ok(Array.isArray(o.needs));
  assert.ok(o.needs.some((n) => n.key === 'mapping'), 'an undecided word needs a decision');
  assert.ok(['green', 'amber', 'red'].includes(o.health.spend.tone));
  assert.equal(o.collections.speaks, false, 'engagement cannot speak without real households');
});

test('the Changes log filters by area, person and search', async () => {
  const out = await changes.changes({ area: 'Mapping' });
  assert.ok(out.rows.length > 0);
  assert.ok(out.rows.every((r) => r.area === 'Mapping'));
  const s = await changes.changes({ q: 'desk_church' });
  assert.ok(s.rows.every((r) => /desk_church/.test(`${r.what} ${r.before} ${r.after} ${r.why}`)));
  await assert.rejects(changes.logChange({ who: WHO, area: 'Nowhere', what: 'x' }), /not an area/);
});
