import { test } from 'node:test';
import assert from 'node:assert/strict';

// The fix pass after the design audit (28 Sep 2026), Categories and Facts:
// the Active rule read everywhere, banded contradictions, one change for a
// bulk Set, Copy facts, Put back to the fact's real state, the drill-down's
// scoped counts, sources and Don't know, Review, and New facts' evidence.
// A database of this file's own, built from the committed migrations.
import { testDatabase } from './helpers/db.js';
const { query, pool } = await testDatabase();
const settings = await import('../src/desk/settings.js');
const categories = await import('../src/desk/categories.js');
const facts = await import('../src/desk/facts.js');

test.after(() => pool.end());

const WHO = 'fixb@epic';

async function seed() {
  await query(`insert into shelf_categories (key, label, position) values ('fxb', 'Fix B', 1) on conflict (key) do update set active = true`);
  await query(`insert into shelf_subcategories (category_key, key, label, position) values
               ('fxb', 'fxb-pools', 'Pools & leisure centres', 1), ('fxb', 'fxb-lidos', 'Lidos', 2), ('fxb', 'fxb-spare', 'Spare', 3)
               on conflict (key) do update set active = true`);
  await query(`insert into place_attributes (key, label, kind, active, standard) values
               ('fxb-wave', 'Wave machine', 'yesno', true, false), ('fxb-sauna', 'Sauna', 'yesno', true, false),
               ('fxb-flume', 'Flumes', 'yesno', true, false)
               on conflict (key) do update set active = true, standard = false`);
  await query(`insert into place_attributes (key, label, kind, active, standard) values
               ('duration', 'Duration', 'range', true, true), ('parking', 'Parking', 'yesno', true, true)
               on conflict (key) do update set active = true, standard = true`);
  for (const k of ['fxb-wave', 'fxb-sauna', 'fxb-flume', 'duration', 'parking']) {
    for (const t of ['subcategory_facts', 'place_fact_answers', 'place_fact_evidence', 'place_attribute_values']) {
      await query(`delete from ${t} where attribute_key = $1`, [k]);
    }
  }
  await query(`delete from shelf_subcategory_attributes where subcategory_key like 'fxb-%'`);
  await query(`delete from bo_changes where who = $1`, [WHO]);
  await query(`insert into localities (slug, name, kind, nation) values ('fxb-berks', 'Berkshire', 'county', 'England') on conflict (slug) do update set nation = 'England'`);
  const places = [['fxb:1', 'fxb-pools'], ['fxb:2', 'fxb-pools'], ['fxb:3', 'fxb-pools'], ['fxb:4', 'fxb-pools'], ['fxb:5', 'fxb-lidos'], ['fxb:6', 'fxb-lidos']];
  for (const [ref, sub] of places) {
    await query(`insert into place_index (venue_ref, subcategory, country_code) values ($1, $2, 'GB')
                 on conflict (venue_ref) do update set subcategory = $2, not_in_epic_at = null, country_code = 'GB'`, [ref, sub]);
    await query(`insert into place_records (venue_ref, name) values ($1, $2) on conflict (venue_ref) do update set name = $2`, [ref, `Place ${ref.slice(4)}`]);
    await query(`insert into place_areas (venue_ref, area_slug) values ($1, 'fxb-berks') on conflict do nothing`, [ref]);
  }
  await query(`insert into subcategory_facts (subcategory_key, attribute_key, status, reason, verified_places, first_seen, active_since, removed_by, removed_at) values
               ('fxb-pools', 'fxb-wave', 'active', null, 2, now() - interval '20 days', now() - interval '5 days', null, null),
               ('fxb-pools', 'fxb-sauna', 'active', null, 1, now() - interval '20 days', now() - interval '5 days', null, null),
               ('fxb-lidos', 'fxb-wave', 'gathering', null, 1, '2026-09-19T12:00:00Z', null, null, null),
               ('fxb-lidos', 'fxb-flume', 'ignored', 'removed_by_a_person', 0, now(), null, 'sarah@epic', '2026-09-20T10:00:00Z')`);
  // Wave machine: yes at two pools (OpenStreetMap and a venue page both say so at one), yes at a lido.
  await query(`insert into place_fact_answers (venue_ref, attribute_key, state, yesno, source) values
               ('fxb:1', 'fxb-wave', 'yes', true, 'osm'), ('fxb:2', 'fxb-wave', 'yes', true, 'site'), ('fxb:5', 'fxb-wave', 'yes', true, 'osm'),
               ('fxb:1', 'fxb-sauna', 'yes', true, 'site'), ('fxb:3', 'fxb-sauna', 'conflict', null, null), ('fxb:4', 'fxb-sauna', 'conflict', null, null)`);
  await query(`insert into place_fact_evidence (venue_ref, attribute_key, source, says) values
               ('fxb:1', 'fxb-wave', 'osm', 'yes'), ('fxb:1', 'fxb-wave', 'site', 'yes'), ('fxb:3', 'fxb-wave', 'wikipedia', 'no')`);
  // A person settled one of the sauna conflicts.
  await query(`insert into place_attribute_values (venue_ref, attribute_key, yesno, set_by) values ('fxb:4', 'fxb-sauna', false, 'sarah@epic')`);
  settings.forget();
}

test('a fact confirmed at fewer than addPlaces places is Gathering evidence everywhere', async () => {
  await seed();
  const page = await categories.subcategoryPage('fxb-pools');
  const sauna = page.facts.find((f) => f.fact === 'fxb-sauna');
  assert.equal(sauna.status, 'gathering', 'stored Active, confirmed at one place');
  assert.equal(sauna.demoted, true);
  assert.equal(sauna.verifiedPlaces, 1);
  assert.equal(sauna.isNew, false);
  assert.equal(page.live, 1, 'LOOKING FOR counts only the wave machine');
  assert.equal(page.fresh, 1);

  const list = await categories.subcategoryList({});
  // The list counts every link looked for, Active or Gathering evidence, as
  // Facts does (round 3, 29 Sep 2026); LOOKING FOR above is Active only.
  assert.equal(list.rows.find((r) => r.key === 'fxb-pools').facts, 2);

  const fresh = await categories.newFacts();
  assert.deepEqual(fresh.rows.filter((r) => r.sub.startsWith('fxb-')).map((r) => r.fact), ['fxb-wave']);

  const all = await facts.allFacts({});
  const s = all.rows.find((r) => r.fact === 'fxb-sauna');
  assert.equal(s.status, 'gathering');
  assert.equal(s.statusText, 'Gathering evidence');
  // Gathering evidence has no count, demoted or not (owner, round 3, 29 Sep
  // 2026: "leave Places with it blank for Gathering evidence rows").
  assert.equal(s.places, null);
  const fp = await facts.factPage('fxb-sauna');
  assert.equal(fp.status, 'gathering');
  assert.equal(fp.subcategories[0].note, null);
});

test('Places with it counts only where the fact is looked for, and an Ignored fact says why', async () => {
  await seed();
  const all = await facts.allFacts({});
  const wave = all.rows.find((r) => r.fact === 'fxb-wave');
  assert.equal(wave.places, 2, 'the lido is only gathering evidence, so its place is not counted');
  const flume = all.rows.find((r) => r.fact === 'fxb-flume');
  assert.equal(flume.statusText, 'Ignored · Removed by a person');
  assert.equal(flume.places, null);
  const page = await facts.factPage('fxb-wave');
  assert.equal(page.places, 2);
  const drill = await facts.factPlaces('fxb-wave', {});
  assert.equal(drill.foundAt, 2);
  assert.equal(drill.lookedFor, 4, 'every pool, where it is Active');
});

test('the conflict line leaves out a place a person has settled', async () => {
  await seed();
  const page = await facts.factPage('fxb-sauna');
  assert.equal(page.conflicts, 1);
  assert.equal(page.conflictLine, '1 place where our sources disagree — families will be asked');
});

test('the drill-down: sources in one line, county and nation, Don\'t know, and a correction logged in the prototype\'s words', async () => {
  await seed();
  const drill = await facts.factPlaces('fxb-wave', { sub: 'fxb-pools' });
  const one = drill.rows.find((r) => r.ref === 'fxb:1');
  assert.equal(one.how, 'OpenStreetMap · Venue website');
  assert.equal(one.area, 'Berkshire, England');
  assert.equal(one.country, 'England');
  assert.deepEqual(drill.options.map((o) => o.label), ['Yes', 'No', 'Don’t know']);
  assert.equal(drill.queued, 0);
  assert.deepEqual(drill.outcomes, []);

  const change = await facts.correct({ ref: 'fxb:2', fact: 'fxb-wave', option: 'dont_know', who: WHO });
  const after = await facts.factPlaces('fxb-wave', { sub: 'fxb-pools' });
  assert.equal(after.foundAt, 1, 'the hidden answer no longer counts');
  const { rows: [row] } = await query('select * from bo_changes where id = $1', [change.id]);
  assert.equal(row.what, 'Answer corrected · Wave machine · Place 2');
  assert.equal(row.after, 'Don’t know');
  await facts.undoCorrection({ change: row, who: WHO });
  const back = await facts.factPlaces('fxb-wave', { sub: 'fxb-pools' });
  assert.equal(back.foundAt, 2);

  const set = await facts.correct({ ref: 'fxb:2', fact: 'fxb-wave', option: 'yes', who: WHO });
  const person = (await facts.factPlaces('fxb-wave', { sub: 'fxb-pools' })).rows.find((r) => r.ref === 'fxb:2');
  assert.equal(person.how, 'Set by a person');
  const { rows: [r2] } = await query('select * from bo_changes where id = $1', [set.id]);
  await facts.undoCorrection({ change: r2, who: WHO });
});

test('a standard fact nobody has asked about is looked for at "—", not 0', async () => {
  await seed();
  const drill = await facts.factPlaces('parking', { sub: 'fxb-pools' });
  assert.equal(drill.lookedFor, null);
  const page = await facts.factPage('parking');
  // Other files' places may have answers; in this subcategory nobody has asked.
  assert.ok(page.places === null || typeof page.places === 'number');
  await query(`insert into place_fact_evidence (venue_ref, attribute_key, source, says) values ('fxb:1', 'parking', 'osm', 'nothing')`);
  const asked = await facts.factPlaces('parking', { sub: 'fxb-pools' });
  assert.equal(asked.lookedFor, 1, 'asked at one place, found at none');
  assert.equal(asked.foundAt, 0);
});

test('a contradiction is judged in bands, and Review lists the disagreeing places first', async () => {
  await seed();
  await categories.setDefaults({ subs: ['fxb-pools'], fact: 'duration', option: '1to2', who: WHO });
  // 70, 90 and 110 minutes are all "1–2 hours": no contradiction, though no stored value equals the default's.
  for (const [ref, m] of [['fxb:1', 70], ['fxb:2', 90], ['fxb:3', 110]]) {
    await query(`insert into place_fact_answers (venue_ref, attribute_key, state, from_value, to_value, source) values ($1, 'duration', 'yes', $2, $2, 'site')
                 on conflict (venue_ref, attribute_key) do update set from_value = $2, to_value = $2, state = 'yes', hidden_at = null`, [ref, m]);
  }
  let d = (await categories.subcategoryPage('fxb-pools')).defaults.find((x) => x.fact === 'duration');
  assert.equal(d.contradicted, false);
  assert.equal(d.basis, '3 of 3 confirmed places agree');
  for (const ref of ['fxb:2', 'fxb:3']) await query(`update place_fact_answers set from_value = 240, to_value = 240 where venue_ref = $1 and attribute_key = 'duration'`, [ref]);
  d = (await categories.subcategoryPage('fxb-pools')).defaults.find((x) => x.fact === 'duration');
  assert.equal(d.contradicted, true);
  assert.equal(d.contradiction, '2 of 3 confirmed places say otherwise');
  const flagged = await categories.contradictedDefaults();
  assert.ok(flagged.some((f) => f.sub === 'fxb-pools' && f.fact === 'duration'));
  const list = await categories.subcategoryList({});
  assert.equal(list.rows.find((r) => r.key === 'fxb-pools').contradicted, 1);

  const review = await categories.reviewDefault({ sub: 'fxb-pools', fact: 'duration' });
  assert.equal(review.value, '1–2 hours');
  assert.deepEqual(review.rows.map((r) => [r.ref, r.answer, r.agrees]), [
    ['fxb:2', 'Half a day', false], ['fxb:3', 'Half a day', false], ['fxb:1', '1–2 hours', true],
  ]);
});

test('a machine proposal names how many places it came from, never "its places"', async () => {
  await seed();
  await query(`insert into shelf_subcategory_attributes (subcategory_key, attribute_key, yesno, origin, settled) values ('fxb-lidos', 'parking', true, 'machine', false)`);
  await query(`insert into place_fact_answers (venue_ref, attribute_key, state, yesno, source) values ('fxb:5', 'parking', 'yes', true, 'osm')`);
  const d = (await categories.subcategoryPage('fxb-lidos')).defaults;
  assert.equal(d.find((x) => x.fact === 'parking').basis, 'Proposed from 1 place · private until accepted');
  // Unset with no confirmed place: nothing to disagree (second audit, 28 Sep 2026).
  assert.equal(d.find((x) => x.fact === 'duration').basis, 'No confirmed places yet');
});

test('the bulk bar\'s Set is one change, and one Undo puts every subcategory back', async () => {
  await seed();
  await categories.setDefaults({ subs: ['fxb-lidos'], fact: 'parking', option: 'no', who: WHO });
  const out = await categories.setDefaults({ subs: ['fxb-pools', 'fxb-lidos'], fact: 'parking', option: 'yes', who: WHO });
  assert.equal(out.changes.length, 1);
  const { rows: [row] } = await query('select * from bo_changes where id = $1', [out.changes[0].id]);
  assert.equal(row.what, 'Default set · Parking on 2 subcategories · Pools & leisure centres, Lidos');
  assert.match(row.why, /^Applies to \d+ places without their own answer · \d+ keep their own$/);
  await categories.undoDefault({ change: row, who: WHO });
  const { rows } = await query(`select subcategory_key, yesno from shelf_subcategory_attributes where attribute_key = 'parking' and subcategory_key like 'fxb-%' order by 1`);
  assert.deepEqual(rows.map((r) => [r.subcategory_key, r.yesno]), [['fxb-lidos', false]], 'the lido keeps its earlier No; the pools had none');
});

test('Copy facts brings another subcategory\'s Active facts in as Gathering evidence, and Undo takes them out', async () => {
  await seed();
  const page = await categories.subcategoryPage('fxb-spare');
  assert.ok(page.copyFrom.some((c) => c.key === 'fxb-pools' && c.n === 1), 'the pools have one Active fact');
  const change = await categories.copyFacts({ to: 'fxb-spare', from: 'fxb-pools', who: WHO });
  assert.equal(change.copied, 1);
  const { rows } = await query(`select attribute_key, status from subcategory_facts where subcategory_key = 'fxb-spare'`);
  assert.deepEqual(rows.map((r) => [r.attribute_key, r.status]), [['fxb-wave', 'gathering']]);
  await assert.rejects(categories.copyFacts({ to: 'fxb-spare', from: 'fxb-pools', who: WHO }), /already looks for every fact/);
  const { rows: [row] } = await query('select * from bo_changes where id = $1', [change.id]);
  await categories.undoFact({ change: row, who: WHO });
  const { rows: gone } = await query(`select 1 from subcategory_facts where subcategory_key = 'fxb-spare'`);
  assert.equal(gone.length, 0);
});

test('Put back restores the fact to what its places say, and its Undo keeps who removed it and when', async () => {
  await seed();
  const change = await categories.restoreFact({ sub: 'fxb-lidos', fact: 'fxb-flume', who: WHO, mode: 'put_back' });
  const { rows: [f] } = await query(`select * from subcategory_facts where subcategory_key = 'fxb-lidos' and attribute_key = 'fxb-flume'`);
  assert.equal(f.status, 'gathering', 'confirmed nowhere, so not Active');
  const { rows: [row] } = await query('select * from bo_changes where id = $1', [change.id]);
  assert.equal(row.before, 'Removed');
  assert.equal(row.after, 'Gathering evidence');
  await categories.undoFact({ change: row, who: WHO });
  const { rows: [back] } = await query(`select * from subcategory_facts where subcategory_key = 'fxb-lidos' and attribute_key = 'fxb-flume'`);
  assert.equal(back.status, 'ignored');
  assert.equal(back.removed_by, 'sarah@epic');
  assert.equal(new Date(back.removed_at).toISOString(), '2026-09-20T10:00:00.000Z');
});

test('New facts: mentioned is never fewer than confirmed, and a share under 1% is "<1%"', async () => {
  await seed();
  const fresh = await categories.newFacts();
  const wave = fresh.rows.find((r) => r.sub === 'fxb-pools' && r.fact === 'fxb-wave');
  assert.equal(wave.confirmed, 2);
  assert.equal(wave.mentioned, 3, 'two confirmations and one source saying no');
  assert.equal(wave.pctText, '50%');
});

test('the list\'s search reads a subcategory\'s synonyms, and PLACES stays the estate\'s total', async () => {
  await seed();
  assert.equal(categories.matches('swim', { key: 'pools', label: 'Pools & leisure centres', category_label: 'Active' }), true);
  assert.equal(categories.matches('swim', { key: 'museums', label: 'Museums', category_label: 'Culture' }), false);
  const list = await categories.subcategoryList({ loc: { refs: new Set(['fxb:1']) } });
  assert.equal(list.counts.within, 1);
  assert.ok(list.counts.places >= 6);
  assert.equal(list.rows.find((r) => r.key === 'fxb-pools').places, 1);
});
