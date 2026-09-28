import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Round 3 (29 Sep 2026), fact data: a fact is attached to a subcategory only
// where our sources confirmed it; Categories and Facts read one tally; no
// Active link below two confirmed places; the evidence behind each place.
import { testDatabase } from './helpers/db.js';
const { query, pool } = await testDatabase();
const settings = await import('../src/desk/settings.js');
const categories = await import('../src/desk/categories.js');
const facts = await import('../src/desk/facts.js');
const pipeline = await import('../src/desk/pipeline.js');

test.after(() => pool.end());

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.resolve(here, '../migrations/282_a_fact_is_attached_where_it_was_found.sql');

async function place(ref, sub) {
  await query(`insert into place_index (venue_ref, subcategory) values ($1, $2)
               on conflict (venue_ref) do update set subcategory = $2, not_in_epic_at = null`, [ref, sub]);
}
async function yes(ref, fact, source = 'site', quote = null) {
  await query(`insert into place_fact_answers (venue_ref, attribute_key, state, yesno, source) values ($1, $2, 'yes', true, $3)
               on conflict (venue_ref, attribute_key) do update set state = 'yes', yesno = true, hidden_at = null`, [ref, fact, source]);
  await query(`insert into place_fact_evidence (venue_ref, attribute_key, source, says, quote) values ($1, $2, $3, 'yes', $4)
               on conflict (venue_ref, attribute_key, source) do update set says = 'yes', quote = excluded.quote`, [ref, fact, source, quote]);
}

async function seed() {
  await query(`insert into shelf_categories (key, label, position) values ('fun', 'Fun', 1) on conflict (key) do update set active = true`);
  await query(`insert into shelf_subcategories (category_key, key, label, position) values
               ('fun', 'r3f-water', 'Water parks', 1), ('fun', 'r3f-beach', 'Beaches', 2), ('fun', 'r3f-woods', 'Woods', 3)
               on conflict (key) do update set active = true`);
  await query(`insert into place_attributes (key, label, kind, active, standard) values
               ('r3f-wave', 'Wave machine', 'yesno', true, false), ('r3f-flume', 'Flumes', 'yesno', true, false),
               ('r3f-oak', 'Ancient woodland', 'yesno', true, false), ('r3f-sauna', 'Sauna', 'yesno', true, false)
               on conflict (key) do update set active = true, standard = false`);
  await query(`delete from subcategory_facts where attribute_key like 'r3f-%'`);
  await query(`delete from subcategory_facts_detached where attribute_key like 'r3f-%'`);
  await query(`delete from place_fact_answers where attribute_key like 'r3f-%'`);
  await query(`delete from place_fact_evidence where attribute_key like 'r3f-%'`);
  for (let i = 1; i <= 5; i += 1) await place(`r3f:w${i}`, 'r3f-water');
  for (let i = 1; i <= 3; i += 1) await place(`r3f:b${i}`, 'r3f-beach');
  await place('r3f:o1', 'r3f-woods');
  // Wave machine: confirmed at two water parks. Flumes: at one.
  await yes('r3f:w1', 'r3f-wave', 'site', 'Our wave machine runs every half hour.');
  await yes('r3f:w2', 'r3f-wave', 'osm', 'attraction=wave_machine');
  await yes('r3f:w3', 'r3f-flume');
  await query(`insert into place_records (venue_ref, name, website, osm_ref) values
               ('r3f:w1', 'Splash Town', 'https://splash.example/', null),
               ('r3f:w2', 'Wave World', null, 'osm:way/42')
               on conflict (venue_ref) do update set name = excluded.name, website = excluded.website, osm_ref = excluded.osm_ref`);
  settings.forget();
}

test('the migration: a link with no confirmed place is detached and kept on record; one with two confirmed stays Active', async () => {
  await seed();
  // As 266 left them: every link Active, found or not.
  await query(`insert into subcategory_facts (subcategory_key, attribute_key, status, active_since) values
               ('r3f-water', 'r3f-wave', 'active', now()),
               ('r3f-water', 'r3f-flume', 'active', now()),
               ('r3f-beach', 'r3f-oak', 'active', now()),
               ('r3f-woods', 'r3f-oak', 'active', now())`);
  // A person's decisions stand: a removal, and an Include anyway.
  await query(`insert into subcategory_facts (subcategory_key, attribute_key, status, reason, removed_by) values
               ('r3f-beach', 'r3f-wave', 'ignored', 'removed_by_a_person', 'test@epic')`);
  await query(`insert into subcategory_facts (subcategory_key, attribute_key, status, include_anyway) values
               ('r3f-woods', 'r3f-sauna', 'active', true)`);

  const sql = await fs.readFile(MIGRATION, 'utf8');
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(sql);
    await c.query('commit');
  } finally { c.release(); }

  const { rows } = await query(`select subcategory_key, attribute_key, status, verified_places from subcategory_facts
                                 where attribute_key like 'r3f-%' order by 1, 2`);
  const at = (s, f) => rows.find((r) => r.subcategory_key === s && r.attribute_key === f);
  assert.equal(at('r3f-water', 'r3f-wave').status, 'active', 'two confirmed: Active');
  assert.equal(at('r3f-water', 'r3f-wave').verified_places, 2);
  assert.equal(at('r3f-water', 'r3f-flume').status, 'gathering', 'one confirmed: Gathering evidence, never Active');
  assert.equal(at('r3f-beach', 'r3f-oak'), undefined, 'Ancient woodland on a beach, never found there: detached');
  assert.equal(at('r3f-woods', 'r3f-oak'), undefined);
  assert.equal(at('r3f-beach', 'r3f-wave').status, 'ignored', 'a person’s removal stands');
  assert.equal(at('r3f-woods', 'r3f-sauna').status, 'active', 'Include anyway stands');
  const { rows: gone } = await query(`select subcategory_key, attribute_key, status, why from subcategory_facts_detached where attribute_key like 'r3f-%' order by 1`);
  assert.deepEqual(gone.map((g) => `${g.subcategory_key}|${g.attribute_key}|${g.status}`), ['r3f-beach|r3f-oak|active', 'r3f-woods|r3f-oak|active']);
  assert.match(gone[0].why, /No confirmed place/);
  // The fact itself stays: vocabulary, still looked for.
  const { rows: [oak] } = await query(`select active from place_attributes where key = 'r3f-oak'`);
  assert.equal(oak.active, true);
});

test('the committed migrations leave no looked-for link without a confirmed place', async () => {
  const { rows: [{ n }] } = await query(
    `with c as (${categories.CONFIRMED_SQL})
     select count(*)::int n from subcategory_facts sf
      where sf.status in ('active', 'gathering') and not sf.include_anyway and sf.added_by is null
        and sf.attribute_key not like 'r3f-%'
        and not exists (select 1 from c where c.sub = sf.subcategory_key and c.attribute_key = sf.attribute_key)`, [null, null]);
  assert.equal(n, 0);
});

test('add(): Active only at two confirmed places, Gathering at one, a machine link with none detached, a person’s kept', async () => {
  await seed();
  await query(`insert into subcategory_facts (subcategory_key, attribute_key, status, active_since) values
               ('r3f-beach', 'r3f-oak', 'active', now()),
               ('r3f-water', 'r3f-flume', 'active', now())`);
  await query(`insert into subcategory_facts (subcategory_key, attribute_key, status, added_by) values
               ('r3f-woods', 'r3f-wave', 'gathering', 'test@epic')`);
  const out = await pipeline.add();
  assert.ok(out.detached >= 1);
  const { rows } = await query(`select subcategory_key, attribute_key, status, verified_places from subcategory_facts where attribute_key like 'r3f-%'`);
  const at = (s, f) => rows.find((r) => r.subcategory_key === s && r.attribute_key === f);
  assert.equal(at('r3f-water', 'r3f-wave').status, 'active', 'joins at two confirmed places');
  assert.equal(at('r3f-water', 'r3f-wave').verified_places, 2);
  assert.equal(at('r3f-water', 'r3f-flume').status, 'gathering', 'an Active link at one place goes back to Gathering evidence');
  assert.equal(at('r3f-beach', 'r3f-oak'), undefined, 'never found there: detached');
  assert.equal(at('r3f-woods', 'r3f-wave').status, 'gathering', 'Copy facts is a person’s: never detached by the machine');

  // No Active link below two confirmed, judged on the count the screens show.
  const links = await categories.factsWithCounts();
  const { rows: stored } = await query(`select subcategory_key, attribute_key from subcategory_facts where status = 'active' and not include_anyway`);
  for (const s of stored) {
    const l = links.find((x) => x.subcategory_key === s.subcategory_key && x.attribute_key === s.attribute_key);
    if (l) assert.ok(l.places_with >= 2, `${s.subcategory_key}|${s.attribute_key} is Active at ${l.places_with}`);
  }

  // A second water park confirming Flumes brings it in.
  await yes('r3f:w4', 'r3f-flume');
  await pipeline.add();
  const { rows: [f] } = await query(`select status from subcategory_facts where subcategory_key = 'r3f-water' and attribute_key = 'r3f-flume'`);
  assert.equal(f.status, 'active');
});

test('Categories and Facts read one tally: the same links, the same totals', async () => {
  await seed();
  await query(`insert into subcategory_facts (subcategory_key, attribute_key, status, verified_places, active_since) values
               ('r3f-water', 'r3f-wave', 'active', 2, now()), ('r3f-water', 'r3f-flume', 'gathering', 1, null)`);
  const list = await categories.subcategoryList({});
  const all = await facts.allFacts({});
  const water = list.rows.find((r) => r.key === 'r3f-water');
  assert.equal(water.facts, 2, 'Active and Gathering evidence, as Facts counts them');
  const perSub = list.rows.reduce((n, r) => n + r.facts, 0);
  const perFact = all.rows.filter((r) => !r.standard).reduce((n, r) => n + (r.subcategoryCount ?? 0), 0);
  assert.equal(perSub, perFact, 'every link counted once on each screen');
  assert.equal(list.counts.facts, all.rows.filter((r) => !r.standard && r.subcategoryCount > 0).length, 'the header counts each fact once');

  const wave = all.rows.find((r) => r.fact === 'r3f-wave');
  assert.equal(wave.status, 'active');
  assert.equal(wave.places, 2, 'places read from the same evidence the status is judged on');
  const flume = all.rows.find((r) => r.fact === 'r3f-flume');
  assert.equal(flume.status, 'gathering');
  assert.equal(flume.places, null, 'Gathering evidence has no count');
});

test('an unattached fact stays in the list as vocabulary, with nothing to count', async () => {
  await seed();
  await query(`insert into subcategory_facts_detached (subcategory_key, attribute_key, status, why) values ('r3f-beach', 'r3f-oak', 'active', 'test')`);
  const all = await facts.allFacts({});
  const oak = all.rows.find((r) => r.fact === 'r3f-oak');
  assert.ok(oak, 'still listed');
  assert.equal(oak.status, 'unattached');
  assert.equal(oak.statusText, 'Not found yet');
  assert.equal(oak.places, null);
  assert.equal(oak.subcategoryCount, 0);
  assert.ok(all.counts.unattached >= 1);
  const page = await facts.factPage('r3f-oak');
  assert.equal(page.status, 'unattached');
  assert.equal(page.places, null);
  assert.deepEqual(page.subcategories, []);
  // The vocabulary spot reads still has it.
  pipeline.forgetVocabulary();
  assert.ok((await pipeline.vocabulary()).some((a) => a.key === 'r3f-oak'));
});

test('a fact page leaves Places with it blank for a Gathering evidence row', async () => {
  await seed();
  await query(`insert into subcategory_facts (subcategory_key, attribute_key, status, verified_places, active_since) values
               ('r3f-water', 'r3f-wave', 'active', 2, now()), ('r3f-beach', 'r3f-wave', 'gathering', 0, null)`);
  await yes('r3f:b1', 'r3f-wave');
  const page = await facts.factPage('r3f-wave');
  const beach = page.subcategories.find((s) => s.key === 'r3f-beach');
  assert.equal(beach.status, 'gathering');
  assert.equal(beach.places, null);
  assert.equal(beach.note, null, 'no "Confirmed at 0 of 2"');
  const water = page.subcategories.find((s) => s.key === 'r3f-water');
  assert.equal(water.places, 2);
  assert.equal(page.places, 2, 'the beach place is not counted: its link is not Active');
});

test('the places with a fact carry the evidence: the source, its words, and a link where we hold one', async () => {
  await seed();
  await query(`insert into subcategory_facts (subcategory_key, attribute_key, status, verified_places, active_since) values
               ('r3f-water', 'r3f-wave', 'active', 2, now())`);
  const out = await facts.factPlaces('r3f-wave', {});
  assert.equal(out.foundAt, 2);
  const splash = out.rows.find((r) => r.ref === 'r3f:w1');
  assert.deepEqual(splash.evidence.map((e) => [e.source, e.word, e.quote, e.url]),
    [['site', 'Venue website', 'Our wave machine runs every half hour.', 'https://splash.example/']]);
  const world = out.rows.find((r) => r.ref === 'r3f:w2');
  assert.deepEqual(world.evidence.map((e) => [e.source, e.quote, e.url]),
    [['osm', 'attraction=wave_machine', 'https://www.openstreetmap.org/way/42']]);
  // A url kept with the evidence wins over the page we hold for the source.
  await query(`update place_fact_evidence set url = 'https://splash.example/rides' where venue_ref = 'r3f:w1' and attribute_key = 'r3f-wave'`);
  const again = await facts.factPlaces('r3f-wave', {});
  assert.equal(again.rows.find((r) => r.ref === 'r3f:w1').evidence[0].url, 'https://splash.example/rides');
  // Never a link that is not a web address.
  await query(`update place_fact_evidence set url = 'javascript:alert(1)' where venue_ref = 'r3f:w1' and attribute_key = 'r3f-wave'`);
  const bad = await facts.factPlaces('r3f-wave', {});
  assert.equal(bad.rows.find((r) => r.ref === 'r3f:w1').evidence[0].url, 'https://splash.example/');
});

test('osmUrl reads the refs we hold and nothing else', () => {
  assert.equal(facts.osmUrl('osm:node/123'), 'https://www.openstreetmap.org/node/123');
  assert.equal(facts.osmUrl('relation/9'), 'https://www.openstreetmap.org/relation/9');
  assert.equal(facts.osmUrl('google:abc'), null);
  assert.equal(facts.osmUrl(null), null);
});

test('a detached candidate is still asked of our own sources, and joins its subcategory at two confirmed places', async () => {
  await seed();
  await query(`insert into place_attributes (key, label, kind, active, standard) values ('r3f-slide', 'Lazy river', 'yesno', true, false)
               on conflict (key) do update set active = true, standard = false`);
  await query(`delete from subcategory_facts where attribute_key = 'r3f-slide'`);
  await query(`delete from subcategory_facts_detached where attribute_key = 'r3f-slide'`);
  await query(`delete from place_fact_answers where attribute_key = 'r3f-slide'`);
  await query(`delete from place_fact_evidence where attribute_key = 'r3f-slide'`);
  await query(`insert into subcategory_facts_detached (subcategory_key, attribute_key, status, why)
               values ('r3f-water', 'r3f-slide', 'active', 'no confirmed place (282)')`);
  for (const ref of ['r3f:w4', 'r3f:w5']) {
    await query(`insert into place_facts (venue_ref, field, source, value, licence, retention) values ($1, 'body', 'site', $2, 'owned', 'keep')
                 on conflict (venue_ref, field, source) do update set value = excluded.value`,
    [ref, JSON.stringify('Float round our lazy river, then dry off in the café.')]);
  }
  settings.forget();
  assert.equal((await settings.settings()).values.verifySources, 1, 'one of our own sources verifies, by default');
  for (const ref of ['r3f:w4', 'r3f:w5']) await pipeline.answerPlace(ref);
  const { rows: said } = await query(`select venue_ref, state from place_fact_answers where attribute_key = 'r3f-slide' order by 1`);
  assert.deepEqual(said.map((r) => r.state), ['yes', 'yes'], 'asked although no link was attached');
  await pipeline.add();
  const { rows: [link] } = await query(`select status from subcategory_facts where subcategory_key = 'r3f-water' and attribute_key = 'r3f-slide'`);
  assert.equal(link?.status, 'active');
});
