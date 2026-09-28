import { test } from 'node:test';
import assert from 'node:assert/strict';

// Categories on the rebuilt desk (back-office handover, 28 Sep 2026): what the
// subcategory page's header counts and the New facts drill read. A database
// of this file's own, built from the committed migrations.
import { testDatabase } from './helpers/db.js';
const { query, pool } = await testDatabase();
const categories = await import('../src/desk/categories.js');

test.after(() => pool.end());

async function seed() {
  await query(`insert into shelf_categories (key, label, position) values ('fun', 'Fun', 1) on conflict (key) do update set active = true`);
  await query(`insert into shelf_subcategories (category_key, key, label, position) values
               ('fun', 'dc-water', 'Water parks', 1), ('fun', 'dc-empty', 'Empty drawer', 2)
               on conflict (key) do update set active = true`);
  await query(`insert into place_attributes (key, label, kind) values ('dc-wave', 'Wave machine', 'yesno'), ('dc-flume', 'Flumes', 'yesno')
               on conflict (key) do nothing`);
  for (const r of ['dc:1', 'dc:2', 'dc:3', 'dc:4']) {
    await query(`insert into place_index (venue_ref, subcategory) values ($1, 'dc-water')
                 on conflict (venue_ref) do update set subcategory = 'dc-water', not_in_epic_at = null`, [r]);
  }
  await query(`delete from subcategory_facts where subcategory_key in ('dc-water', 'dc-empty')`);
  await query(`insert into subcategory_facts (subcategory_key, attribute_key, status, active_since, first_seen) values
               ('dc-water', 'dc-wave', 'active', now() - interval '3 days', now() - interval '10 days'),
               ('dc-water', 'dc-flume', 'gathering', null, now() - interval '2 days'),
               ('dc-empty', 'dc-wave', 'active', now() - interval '60 days', now() - interval '90 days')`);
  await query(`insert into place_fact_answers (venue_ref, attribute_key, state, yesno, source) values
               ('dc:1', 'dc-wave', 'yes', true, 'site'), ('dc:2', 'dc-wave', 'yes', true, 'osm')
               on conflict (venue_ref, attribute_key) do update set state = 'yes', yesno = true, hidden_at = null`);
  await query(`insert into place_fact_evidence (venue_ref, attribute_key, source, says) values
               ('dc:1', 'dc-wave', 'site', 'yes'), ('dc:2', 'dc-wave', 'osm', 'yes'), ('dc:3', 'dc-wave', 'wikipedia', 'no'),
               ('dc:4', 'dc-wave', 'wikidata', 'nothing')
               on conflict do nothing`);
}

test('a subcategory page carries its place count, what it looks for, what is new, and the confirmations needed', async () => {
  await seed();
  const page = await categories.subcategoryPage('dc-water');
  assert.equal(page.places, 4);
  assert.equal(page.secondaryPlaces, 0);
  assert.equal(page.live, 1, 'one Active fact');
  assert.equal(page.fresh, 1, 'Active three days ago is new');
  assert.equal(page.needed, 2, 'the addPlaces default');
  const wave = page.facts.find((f) => f.fact === 'dc-wave');
  assert.equal(wave.placesWith, 2);
});

test('New facts lists the last 30 days only, with its evidence, and never a share over no places', async () => {
  await seed();
  const out = await categories.newFacts();
  const mine = out.rows.filter((r) => r.sub.startsWith('dc-'));
  assert.equal(mine.length, 1, 'the 60-day-old fact and the gathering one are not new');
  const [r] = mine;
  assert.equal(r.subLabel, 'Water parks');
  assert.equal(r.label, 'Wave machine');
  assert.equal(r.places, 4);
  assert.equal(r.mentioned, 3, 'a source that said nothing did not mention it');
  assert.equal(r.confirmed, 2);
  assert.equal(r.pct, 50);
  assert.equal(out.total, out.rows.length);

  // A drawer with no places confirms nothing, so its fact is Gathering
  // evidence (README "Statuses", fix pass 28 Sep) and is not new at all.
  await query(`update subcategory_facts set active_since = now() - interval '1 day' where subcategory_key = 'dc-empty'`);
  const again = await categories.newFacts();
  assert.equal(again.rows.find((x) => x.sub === 'dc-empty'), undefined);
});

test('the list carries the bulk bar\'s ten facts with their value pills', async () => {
  await seed();
  const list = await categories.subcategoryList({});
  const keys = list.defaultFacts.map((f) => f.key);
  assert.deepEqual(keys, categories.STANDARD.filter((k) => keys.includes(k)), 'in the standard order');
  const cost = list.defaultFacts.find((f) => f.key === 'cost-band');
  if (cost) assert.deepEqual(cost.options.map((o) => o.label), ['Free', 'Cheap', 'Mid', 'Dear']);
  const water = list.rows.find((r) => r.key === 'dc-water');
  assert.equal(water.places, 4);
  // Looked for here, Active or Gathering evidence — the same links Facts
  // counts (round 3, 29 Sep 2026: one tally for both screens).
  assert.equal(water.facts, 2);
});
