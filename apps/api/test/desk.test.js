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
  assert.equal(f.status, 'gathering', 'put back where its places put it: confirmed nowhere, so not Active (fix pass, 28 Sep)');
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
  // Named as the prototype names them (audit fix, 28 Sep 2026): "Collection edited · <title>".
  assert.deepEqual(rows.map((r) => r.what.split(' · ')[0]), ['Collection added', 'Collection edited']);
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

// ---------------------------------------------------------------------------
// Codex, 28 Sep 2026, on the first batch

test('a narrowed word files nothing by itself; only its qualifying places are filed, by rules it owns', async () => {
  await seedTaxonomy();
  await query(`insert into place_index (venue_ref, subcategory) values ('desk:ch1', null), ('desk:ch2', null) on conflict (venue_ref) do nothing`);
  await query(`insert into place_index_labels (venue_ref, label) values ('desk:ch1', 'google:desk_church'), ('desk:ch2', 'google:desk_church') on conflict do nothing`);
  await query(`insert into place_records (venue_ref, name, wikidata_id) values ('desk:ch1', 'St Notable', 'Q42') on conflict (venue_ref) do update set wikidata_id = 'Q42'`);
  const { rows: [p] } = await query(
    `insert into word_proposals (word, grp, action, change_to, rule_text) values ('desk_church', 'narrow', 'narrow', $1::jsonb, 'only notable ones') returning id`,
    [JSON.stringify({ text: 'Landmarks — only notable', subcategory: 'desk-landmarks', condition: 'encyclopedia_or_listing' })]);
  const out = await mapping.decideProposal({ id: p.id, action: 'apply', who: WHO });
  assert.equal(out.decision.kind, 'Narrowed');
  const { rows: [w] } = await query(`select points_at from taxonomy_labels where key = 'desk_church'`);
  assert.equal(w.points_at, null, 'the classifier sees no pointer for a narrowed word');
  const { rows: rule } = await query(`select 1 from shelf_rules where scope = 'labels' and subject = 'google:desk_church'`);
  assert.equal(rule.length, 0, 'no unconditional labels rule');
  const { rows: place } = await query(`select subject, subcategory from shelf_rules where scope = 'place' and taught_by = 'narrowing:desk_church'`);
  assert.deepEqual(place.map((r) => [r.subject, r.subcategory]), [['desk:ch1', 'desk-landmarks']], 'only the place with an encyclopedia entry');
  const refreshed = await proposals.changesSomething(proposals.SEEDS.find((s) => s.word === 'church'), { decision: null, points_at: null, narrowedTo: 'landmarks-you-can-see' });
  assert.equal(refreshed, false, 'a decided narrowing is not raised again');
  await mapping.undo({ id: out.decision.id, who: WHO });
  const { rows: gone } = await query(`select 1 from shelf_rules where scope = 'place' and taught_by = 'narrowing:desk_church'`);
  assert.equal(gone.length, 0, 'undo takes the narrowing’s place rules away');
  const { rows: [w2] } = await query(`select points_at from taxonomy_labels where key = 'desk_church'`);
  assert.equal(w2.points_at, 'desk-museums');
});

test('an old row rule keeps its and/or meaning until it is re-saved', () => {
  const p = { cats: ['fun'], subs: ['desk-water'], facts: new Set(), no: new Set(), ages: null };
  const toohot = { any: [{ yes: true, attribute: 'indoor' }, { subcategory: ['desk-water', 'coast'] }] };
  assert.equal(collections.matchesPredicate(toohot, p), true, 'water, not indoors: still too hot to think');
  const grandparents = { all: [{ yes: true, attribute: 'step-free' }, { yes: true, attribute: 'parking' }] };
  assert.equal(collections.matchesPredicate(grandparents, { ...p, facts: new Set(['step-free']) }), false, 'all means all');
  assert.equal(collections.matchesPredicate({ all: [{ yes: false, attribute: 'indoor' }] }, { ...p, no: new Set(['indoor']) }), true);
});

test('a collection save is one change, its undo puts back every field, and a saved collection is live', async () => {
  await seedTaxonomy();
  await query(`insert into place_index (venue_ref, subcategory) values ('desk:c2', 'desk-play') on conflict (venue_ref) do update set subcategory = 'desk-play', not_in_epic_at = null`);
  collections.forget();
  const made = await collections.saveCollection({ title: 'Desk one', copy: 'a', rule: { subs: ['desk-play'] }, who: WHO });
  const { rows: [r1] } = await query('select active from browse_rows where key = $1', [made.key]);
  assert.equal(r1.active, true);
  await collections.saveCollection({ key: made.key, title: 'Desk two', copy: 'b', rule: { subs: ['desk-play'] }, who: WHO });
  const { rows } = await query(`select * from bo_changes where subject_id = $1 and area = 'Collections' order by at desc`, [made.key]);
  assert.equal(rows[0].what, 'Collection edited · Desk two');
  assert.match(rows[0].before, /Title: Desk one · Copy: a/);
  await collections.undoCollection({ change: rows[0], who: WHO });
  const { rows: [r2] } = await query('select title, copy from browse_rows where key = $1', [made.key]);
  assert.deepEqual(r2, { title: 'Desk one', copy: 'a' });
});

test('the old thresholds route gets one threshold back, and the deleted three are gone', async () => {
  const { setThreshold, thresholds, thresholdValues } = await import('../src/repositories/settings.js');
  const t = await setThreshold('minRowFill', 5, WHO);
  assert.equal(t.key, 'minRowFill');
  assert.equal(t.value, 5);
  settings.forget();
  assert.equal(await settings.setting('collectionMinPlaces'), 5, 'one number for each thing');
  const keys = (await thresholds()).map((x) => x.key);
  assert.deepEqual(keys, ['sightingFloor', 'distinctHigh', 'minRowFill']);
  const v = await thresholdValues();
  assert.equal(v.spreadLimit, 0.35);
  assert.equal(v.saturationLimit, 1);
  await setThreshold('minRowFill', 4, WHO);
});

test('a correction freezes the machine’s answer at the time, for accuracy', async () => {
  await seedTaxonomy();
  await query(`insert into place_index (venue_ref, subcategory) values ('desk:acc', 'desk-water') on conflict (venue_ref) do update set subcategory = 'desk-water'`);
  await query(`insert into place_fact_answers (venue_ref, attribute_key, state, yesno, source) values ('desk:acc', 'toilets', 'yes', true, 'osm')
               on conflict (venue_ref, attribute_key) do update set state = 'yes', yesno = true, source = 'osm'`);
  await facts.correct({ ref: 'desk:acc', fact: 'toilets', option: 'no', who: WHO });
  // The machine later changes its mind; the correction's comparison must not.
  await query(`update place_fact_answers set state = 'no', yesno = false, source = 'site' where venue_ref = 'desk:acc' and attribute_key = 'toilets'`);
  const { rows: [fc] } = await query(`select machine_state, machine_source from fact_corrections where venue_ref = 'desk:acc'`);
  assert.deepEqual(fc, { machine_state: 'yes', machine_source: 'osm' });
});

// ---------------------------------------------------------------------------
// Phase 2: the fact pipeline

const pipeline = await import('../src/desk/pipeline.js');

test('polarity: asserts, denies, asks — and a wish is not an assertion', () => {
  assert.equal(pipeline.polarity('Lovely sauna and steam room.', 'sauna'), 'asserts');
  assert.equal(pipeline.polarity('There is no sauna here.', 'sauna'), 'denies');
  assert.equal(pipeline.polarity("They don't have a sauna any more.", 'sauna'), 'denies');
  assert.equal(pipeline.polarity('Does it have a sauna?', 'sauna'), 'asks');
  assert.equal(pipeline.polarity('I wish they had a sauna.', 'sauna'), 'asks');
  assert.equal(pipeline.polarity('The sauna was closed for repairs.', 'sauna'), 'denies');
  assert.equal(pipeline.polarity('Great pool.', 'sauna'), null);
});

test('spot writes a suggestion with no text, and says what a household may be told in session', async () => {
  await query(`delete from fact_suggestions where venue_ref = 'desk:spot'`);
  pipeline.forgetVocabulary();
  const out = await pipeline.spot({ ref: 'desk:spot', reviews: ['Clean toilets and good parking.', 'The toilets were spotless.'], summary: null });
  assert.ok(out.suggested.some((s) => s.fact === 'toilets'));
  const { rows } = await query(`select * from fact_suggestions where venue_ref = 'desk:spot'`);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['feature', 'first_seen', 'status', 'venue_ref'], 'a place, a feature, a status, a date — nothing else');
  assert.ok(out.mention.some((m) => m.fact === 'toilets' && /Reviewers mention/.test(m.text)), 'two asserting reviews, none denying');
  assert.ok(!out.mention.some((m) => m.fact === 'parking'), 'one review is not enough to mention');
  const denied = await pipeline.spot({ ref: 'desk:spot2', reviews: ['No toilets anywhere.'] });
  assert.equal(denied.suggested.find((s) => s.fact === 'toilets')?.status, 'conflict', 'any denial marks it a conflict');
});

test('verify reads our own text, decides by the rules, deletes the suggestion and records the outcome', async () => {
  await query(`insert into place_facts (venue_ref, field, source, value, licence, retention) values ('desk:v1', 'body', 'site', to_jsonb('We have accessible toilets on every floor.'::text), 'own', 'keep')
               on conflict (venue_ref, field, source) do update set value = excluded.value`);
  await query(`insert into fact_suggestions (venue_ref, feature) values ('desk:v1', 'toilets') on conflict do nothing`);
  const out = await pipeline.verify({ ref: 'desk:v1', fact: 'toilets' });
  assert.equal(out.state, 'yes');
  assert.equal(out.source, 'site');
  const { rows: [a] } = await query(`select state, evidence_quote, recheck_due from place_fact_answers where venue_ref = 'desk:v1' and attribute_key = 'toilets'`);
  assert.equal(a.state, 'yes');
  assert.match(a.evidence_quote, /accessible toilets/);
  const months = Math.round((new Date(a.recheck_due) - Date.now()) / (30 * 86400_000));
  assert.equal(months, 6, 'toilets is an access fact: re-checked at 6 months');
  const { rows: s } = await query(`select 1 from fact_suggestions where venue_ref = 'desk:v1'`);
  assert.equal(s.length, 0);
  const { rows: [c] } = await query(`select outcome from fact_checks where venue_ref = 'desk:v1' order by at desc limit 1`);
  assert.equal(c.outcome, 'verified');
  // Our own text read, and it says nothing about toilets: a real answer.
  // (A place with nothing of ours to read at all waits instead — see below.)
  const none = await pipeline.verify({ ref: 'desk:nothing', fact: 'toilets', evidence: { site: 'A lovely park with swings and a pond.' } });
  assert.equal(none.state, 'dont_know', 'nothing found is a real answer');
});

test('families: two agreeing settle a fact, two saying a shown fact is wrong hide it, and a household is asked once', async () => {
  const { rows: [h1] } = await query(`insert into households (name) values ('Desk one') returning id`);
  const { rows: [h2] } = await query(`insert into households (name) values ('Desk two') returning id`);
  await query(`insert into place_fact_answers (venue_ref, attribute_key, state, yesno, source) values ('desk:fam', 'toilets', 'yes', true, 'site')
               on conflict (venue_ref, attribute_key) do update set state = 'yes', yesno = true, hidden_at = null`);
  await assert.rejects(pipeline.familyAnswer({ householdId: h1.id, ref: 'desk:fam', fact: 'toilets', answer: 'no' }),
    (e) => e.status === 409, 'a question nobody asked cannot be answered');
  for (const h of [h1, h2]) await query(`insert into family_asks (household_id, venue_ref, attribute_key) values ($1, 'desk:fam', 'toilets')`, [h.id]);
  await pipeline.familyAnswer({ householdId: h1.id, ref: 'desk:fam', fact: 'toilets', answer: 'no' });
  const two = await pipeline.familyAnswer({ householdId: h2.id, ref: 'desk:fam', fact: 'toilets', answer: 'no' });
  assert.equal(two.settled, 'hidden');
  const { rows: [a] } = await query(`select hidden_at from place_fact_answers where venue_ref = 'desk:fam' and attribute_key = 'toilets'`);
  assert.ok(a.hidden_at, 'hidden until re-checked');
  const { rows: [fa] } = await query(`select machine_state, machine_source from family_answers where household_id = $1 and venue_ref = 'desk:fam'`, [h1.id]);
  assert.deepEqual(fa, { machine_state: 'yes', machine_source: 'site' }, 'the machine’s answer at the time, for accuracy');
  await assert.rejects(pipeline.familyAnswer({ householdId: h1.id, ref: 'desk:fam', fact: 'toilets', answer: 'maybe' }));
  const none = await pipeline.questionFor({ householdId: h1.id, ref: 'desk:fam' });
  assert.deepEqual(none, [], 'someone who has not been cannot be asked');
});

test('a visit carries at most askPerVisit questions, however often it is asked for', async () => {
  const { rows: [h] } = await query(`insert into households (name) values ('Desk three') returning id`);
  const { rows: [{ id: visit }] } = await query(`insert into visits (household_id, venue_ref, venue_label, visited_on) values ($1, 'desk:visit', 'Desk visit', current_date) returning id`, [h.id]);
  await query(`insert into place_index (venue_ref, subcategory) values ('desk:visit', 'desk-water') on conflict (venue_ref) do update set subcategory = 'desk-water'`);
  assert.deepEqual(await pipeline.questionFor({ householdId: h.id, ref: 'desk:visit', visitId: '00000000-0000-4000-8000-00000000d351' }), [],
    'a visit id that is not this household’s visit here buys nothing');
  const first = await pipeline.questionFor({ householdId: h.id, ref: 'desk:visit', visitId: visit });
  const cap = (await settings.settings()).values.askPerVisit;
  assert.ok(first.length > 0 && first.length <= cap);
  const again = await pipeline.questionFor({ householdId: h.id, ref: 'desk:visit', visitId: visit });
  assert.deepEqual(again.map((q) => q.fact), first.map((q) => q.fact), 'the same questions, not a fresh batch');
  await pipeline.familyAnswer({ householdId: h.id, ref: 'desk:visit', fact: first[0].fact, answer: 'didnt_notice' });
  const after = await pipeline.questionFor({ householdId: h.id, ref: 'desk:visit', visitId: visit });
  assert.equal(after.length, first.length - 1, 'an answered question is not asked again, and nothing new is added');
});

test('add makes a fact Active at addPlaces verified places, and never re-adds one a person removed', async () => {
  await seedTaxonomy();
  await query(`insert into place_attributes (key, label, kind) values ('desk-wave', 'Desk wave machine', 'yesno') on conflict (key) do nothing`);
  for (const r of ['desk:w1', 'desk:w2', 'desk:w3', 'desk:w4', 'desk:w5']) {
    await query(`insert into place_index (venue_ref, subcategory) values ($1, 'desk-water') on conflict (venue_ref) do update set subcategory = 'desk-water', not_in_epic_at = null`, [r]);
  }
  for (const r of ['desk:w1', 'desk:w2']) {
    await query(`insert into place_fact_answers (venue_ref, attribute_key, state, yesno) values ($1, 'desk-wave', 'yes', true) on conflict (venue_ref, attribute_key) do update set state = 'yes'`, [r]);
  }
  await query(`delete from subcategory_facts where attribute_key = 'desk-wave'`);
  await pipeline.add();
  let { rows: [f] } = await query(`select status, verified_places from subcategory_facts where subcategory_key = 'desk-water' and attribute_key = 'desk-wave'`);
  assert.deepEqual(f, { status: 'active', verified_places: 2 });
  await categories.removeFact({ sub: 'desk-water', fact: 'desk-wave', who: WHO });
  await pipeline.add();
  ({ rows: [f] } = await query(`select status, reason from subcategory_facts where subcategory_key = 'desk-water' and attribute_key = 'desk-wave'`));
  assert.deepEqual(f, { status: 'ignored', reason: 'removed_by_a_person' }, 'a removed fact stays removed');
});

test('the pre-warm puts the top 20 of every category in the ring in line, free, and nothing more', async () => {
  await query(`delete from ring_rankings where cell = 'DESK1'`);
  for (let i = 1; i <= 25; i += 1) {
    await query(`insert into ring_rankings (cell, mode, minutes, category, venue_ref, epic_score, rank) values ('DESK1', 'driving', 30, 'active', $1, 50, $2)`, [`desk:pw-a${i}`, i]);
  }
  await query(`insert into ring_rankings (cell, mode, minutes, category, venue_ref, epic_score, rank) values ('DESK1', 'driving', 30, 'food', 'desk:pw-f1', 50, 1)`);
  const researched = [];
  const out = await pipeline.prewarm({ cell: 'DESK1', research: (ref) => researched.push(ref) });
  assert.equal(out.places, 21);
  assert.equal(researched.length, 21);
  assert.ok(!researched.includes('desk:pw-a21'), 'rank 21 is not pre-warmed');
  assert.deepEqual(await pipeline.prewarm({ cell: null }), { places: 0 });
  await pipeline.drained();
});

test('the local open map answers a place near a point by name, and says when it does not cover the point', async () => {
  const osm = await import('../src/sources/osmExtract.js');
  await query(`delete from osm_features where ref like 'node/9990%'`);
  await query(`insert into osm_extracts (region, url, load_id, state, features, min_lat, max_lat, min_lng, max_lng)
               values ('desk-test', 'file:', gen_random_uuid(), 'done', 1, 51.4, 51.6, -0.7, -0.5)
               on conflict (region) do update set state = 'done', min_lat = 51.4, max_lat = 51.6, min_lng = -0.7, max_lng = -0.5`);
  osm.forgetCoverage();
  await query(`insert into osm_features (ref, name, lat, lng, tags, region, load_id) select 'node/99901', 'Desk Test Castle', 51.48, -0.6, '{"tourism":"attraction","name":"Desk Test Castle"}', 'desk-test', load_id from osm_extracts where region = 'desk-test'`);
  assert.ok(await osm.covers(51.48, -0.6));
  assert.equal(await osm.covers(55, -3), false);
  const hits = await osm.nearByName(51.4801, -0.6001, 200, ['desk test castle']);
  assert.deepEqual(hits.map((h) => `${h.type}/${h.id}`), ['node/99901']);
  assert.deepEqual(await osm.nearByName(51.4801, -0.6001, 200, ['nowhere at all']), []);
  await query(`delete from osm_features where ref = 'node/99901'`);
  await query(`delete from osm_extracts where region = 'desk-test'`);
  osm.forgetCoverage();
});

test('the location filter knows the first part of a postcode, and says when it knows nothing', async () => {
  const { resolveLocation, chipOf } = await import('../src/desk/location.js');
  await query(`delete from postcodes where outcode = 'ZZ9'`);
  await query(`insert into postcodes (pcds, sector, outcode, lat, lng, source) values
    ('ZZ9 1AA', 'ZZ9 1', 'ZZ9', 60.1, -1.1, 'test'), ('ZZ9 1AB', 'ZZ9 1', 'ZZ9', 60.1002, -1.1002, 'test')`);
  await query(`insert into geo_cells (code, scheme, label, outcode, lat, lng, source) values ('sector:ZZ9 1', 'sector', 'ZZ9 1', 'ZZ9', 60.1001, -1.1001, 'test')
               on conflict (code) do nothing`);
  const known = await resolveLocation({ where: 'zz9', minutes: 30, mode: 'car' });
  assert.equal(known.unknown, undefined);
  assert.equal(chipOf(known), 'within 30 min of ZZ9 by car');
  const sector = await resolveLocation({ where: 'ZZ9 1', minutes: 15, mode: 'transit' });
  assert.equal(chipOf(sector), 'within 15 min of ZZ9 1 by public transport');
  assert.equal(sector.approx, true, 'public transport is an approximation and says so');
  assert.equal((await resolveLocation({ where: 'ZZ8', minutes: 30 })).unknown, true, 'an outcode with no postcodes is not a place we know');
  assert.equal(await resolveLocation({ where: '  ' }), null, 'empty is the whole estate');
  await query(`delete from postcodes where outcode = 'ZZ9'`);
  await query(`delete from geo_cells where code = 'sector:ZZ9 1'`);
});

test('a Sources number opens onto the records it was counted from, and families alone never turn a machine source red', async () => {
  const verification = await import('../src/desk/verification.js');
  await query(`delete from place_fact_evidence where venue_ref like 'desk:src%'`);
  await query(`insert into place_fact_evidence (venue_ref, attribute_key, source, says) values ('desk:src1', 'toilets', 'osm', 'yes'), ('desk:src2', 'toilets', 'osm', 'nothing')`);
  const checked = await verification.items({ kind: 'checked', source: 'osm' });
  assert.deepEqual(checked.rows.filter((r) => String(r.ref).startsWith('desk:src')).map((r) => r.ref).sort(), ['desk:src1', 'desk:src2']);
  const answered = await verification.items({ kind: 'answered', source: 'osm' });
  assert.deepEqual(answered.rows.filter((r) => String(r.ref).startsWith('desk:src')).map((r) => r.ref), ['desk:src1'], 'nothing found is checked, not answered');
  await query(`delete from place_fact_evidence where venue_ref like 'desk:src%'`);
  // With only family answers this week, no machine source is Failing for having checked nothing.
  await query(`delete from place_fact_evidence where checked_at >= now() - interval '7 days'`);
  const { rows: [h] } = await query(`insert into households (name) values ('Desk src') returning id`);
  await query(`insert into family_answers (venue_ref, attribute_key, household_id, answer) values ('desk:src3', 'toilets', $1, 'yes')`, [h.id]);
  const srcs = await verification.sources({ sourceSlow: 5, sourceFailing: 15 });
  assert.ok(srcs.filter((x) => x.source !== 'families').every((x) => x.status !== 'Failing' || x.failingPct != null));
});

test('Include anyway stays Active; a person’s Don’t know is skipped by every reader and undo simply lifts it', async () => {
  const { effective, HAS_SQL } = await import('../src/desk/categories.js');
  assert.equal(effective('active', 0, 2), 'gathering');
  assert.equal(effective('active', 0, 2, true), 'active', 'a person said include it anyway');
  const has = async () => (await query(`select 1 from (${HAS_SQL}) h where venue_ref = 'desk:dk' and attribute_key = 'toilets'`)).rows.length;
  await query(`delete from fact_unknowns where venue_ref = 'desk:dk'`);
  await query(`delete from place_attribute_values where venue_ref = 'desk:dk'`);
  await query(`delete from place_fact_answers where venue_ref = 'desk:dk'`);
  // No machine answer yet: Don't know, then a check confirms yes.
  const out = await facts.correct({ ref: 'desk:dk', fact: 'toilets', option: 'dont_know', who: WHO });
  await pipeline.verify({ ref: 'desk:dk', fact: 'toilets', evidence: { site: 'Clean toilets on site, and the toilets were spotless.' } });
  const { rows: [a] } = await query(`select state, hidden_at from place_fact_answers where venue_ref = 'desk:dk' and attribute_key = 'toilets'`);
  assert.equal(a.state, 'yes');
  assert.equal(a.hidden_at, null, 'the answer itself is left as the check made it');
  assert.equal(await has(), 0, 'but nobody reads it while the Don’t know stands');
  // Undo lifts the Don't know and nothing else.
  const { rows: [change] } = await query('select * from bo_changes where id = $1', [out.change ?? out.changeId ?? out.id]);
  await facts.undoCorrection({ change, who: WHO });
  assert.equal(await has(), 1, 'the check’s yes is read again');
  // A family hide made while it stood is untouched by the undo.
  const again = await facts.correct({ ref: 'desk:dk', fact: 'toilets', option: 'dont_know', who: WHO });
  await query(`update place_fact_answers set hidden_at = now() where venue_ref = 'desk:dk'`);
  const { rows: [c2] } = await query('select * from bo_changes where id = $1', [again.change ?? again.changeId ?? again.id]);
  await facts.undoCorrection({ change: c2, who: WHO });
  const { rows: [b] } = await query(`select hidden_at from place_fact_answers where venue_ref = 'desk:dk'`);
  assert.ok(b.hidden_at, 'the families’ hide stands');
  assert.equal(await has(), 0);
  await query(`delete from place_fact_answers where venue_ref = 'desk:dk'`);
});

test('a Don’t know stops a default standing in for it in collections, leaves the conflict count, and is logged as the before', async () => {
  const col = await import('../src/desk/collections.js');
  await seedTaxonomy();
  await query(`insert into place_index (venue_ref, subcategory) values ('desk:dk5', 'desk-water') on conflict (venue_ref) do update set subcategory = 'desk-water', not_in_epic_at = null`);
  await query(`delete from shelf_subcategory_attributes where subcategory_key = 'desk-water' and attribute_key = 'toilets'`);
  await query(`insert into shelf_subcategory_attributes (subcategory_key, attribute_key, yesno, origin) values ('desk-water', 'toilets', true, 'person')`);
  await query(`delete from fact_unknowns where venue_ref = 'desk:dk5'`);
  await query(`delete from place_attribute_values where venue_ref = 'desk:dk5'`);
  await query(`insert into place_fact_answers (venue_ref, attribute_key, state, source) values ('desk:dk5', 'toilets', 'conflict', 'osm')
               on conflict (venue_ref, attribute_key) do update set state = 'conflict', hidden_at = null`);
  col.forget();
  await facts.correct({ ref: 'desk:dk5', fact: 'toilets', option: 'dont_know', who: WHO });
  col.forget();
  const idx = await col.placeIndex();
  const p = (idx.places ?? idx).get ? (idx.places ?? idx).get('desk:dk5') : (idx.places ?? idx).find((x) => x.ref === 'desk:dk5');
  assert.ok(p, 'the place is indexed');
  assert.equal(p.facts.has('toilets'), false, 'the default does not stand in for a Don’t know');
  const page = await facts.factPage('toilets');
  assert.ok(!String(page.conflictLine ?? '').includes('1 place'), 'the Don’t know place is not a conflict');
  const yes = await facts.correct({ ref: 'desk:dk5', fact: 'toilets', option: 'yes', who: WHO });
  const { rows: [ch] } = await query('select before from bo_changes where id = $1', [yes.change ?? yes.changeId ?? yes.id]);
  assert.equal(ch.before, 'Don’t know');
  await query(`delete from shelf_subcategory_attributes where subcategory_key = 'desk-water' and attribute_key = 'toilets'`);
  await query(`delete from place_attribute_values where venue_ref = 'desk:dk5'`);
  await query(`delete from place_fact_answers where venue_ref = 'desk:dk5'`);
});

test('Codex on the branch: a phrase denied after it is a denial; verify waits when nothing of ours is there yet', async () => {
  assert.equal(pipeline.polarity('The toilets are not available.', 'toilets'), 'denies');
  assert.equal(pipeline.polarity("The sauna isn't working.", 'sauna'), 'denies');
  assert.equal(pipeline.polarity('Great pool, not crowded at all.', 'pool'), 'asserts');
  await query(`delete from fact_suggestions where venue_ref = 'desk:empty'`);
  await query(`insert into fact_suggestions (venue_ref, feature, status) values ('desk:empty', 'toilets', 'backlog') on conflict do nothing`).catch(() => null);
  const out = await pipeline.verify({ ref: 'desk:empty', fact: 'toilets' });
  assert.equal(out.waiting, true);
  const { rows } = await query(`select 1 from place_fact_answers where venue_ref = 'desk:empty'`);
  assert.equal(rows.length, 0, 'no Don’t know recorded for a place with nothing to read');
});

test('a status word at the end of a sentence is a denial, and a source read and found empty is an answer', async () => {
  assert.equal(pipeline.polarity('The pool is unavailable.', 'pool'), 'denies');
  assert.equal(pipeline.polarity('The pool closed.', 'pool'), 'denies');
  assert.equal(pipeline.polarity('Great pool, not crowded at all.', 'pool'), 'asserts');
  const read = await pipeline.verify({ ref: 'desk:readempty', fact: 'toilets', evidence: { site: null, wikipedia: null, osm: null, wikidata: [] } });
  assert.equal(read.waiting, undefined, 'read and found nothing is not waiting');
  assert.equal(read.state, 'dont_know');
});

test('a status word in another clause says nothing about the phrase', () => {
  assert.equal(pipeline.polarity('We enjoyed the pool; the cafe was closed.', 'pool'), 'asserts');
  assert.equal(pipeline.polarity('The pool was closed.', 'pool'), 'denies');
  assert.equal(pipeline.polarity('The pool is permanently closed.', 'pool'), 'denies');
  assert.equal(pipeline.polarity('The pool is unavailable.', 'pool'), 'denies');
});

test('a closure in the phrase’s own clause is a denial, however it is said', () => {
  for (const s of ['The pool is still closed.', 'Pool: closed.', 'The pool remains closed.', 'The pool will be closed until May.', 'The pool was shut'])
    assert.equal(pipeline.polarity(s, 'pool'), 'denies', s);
  for (const s of ['We enjoyed the pool; the cafe was closed.', 'Great pool, the gift shop was closed.', 'The pool was lovely and the cafe was closed.'])
    assert.equal(pipeline.polarity(s, 'pool'), 'asserts', s);
});

test('a closure said of something else in the clause is not said of the phrase', () => {
  assert.equal(pipeline.polarity('The pool is next to the closed cafe.', 'pool'), 'asserts');
  assert.equal(pipeline.polarity('The pool has a cafe that is closed.', 'pool'), 'asserts');
  assert.equal(pipeline.polarity('The pool has been closed for months.', 'pool'), 'denies');
});
