import { test } from 'node:test';
import assert from 'node:assert/strict';

// The Facts tab's own reads (back-office handover, 28 Sep 2026): All facts,
// a fact's page and its places, Verification's drill-downs, Accuracy's
// health view. A database of this file's own, built from the committed
// migrations.
import { testDatabase } from './helpers/db.js';
const { query, pool } = await testDatabase();
const settings = await import('../src/desk/settings.js');
const facts = await import('../src/desk/facts.js');
const accuracy = await import('../src/desk/accuracy.js');
const verification = await import('../src/desk/verification.js');

test.after(() => pool.end());

const WHO = 'test@epic';

async function seed() {
  await query(`insert into shelf_categories (key, label, position) values ('fun', 'Fun', 1) on conflict (key) do update set active = true`);
  await query(`insert into shelf_subcategories (category_key, key, label, position) values
               ('fun', 'dfx-water', 'Water parks', 1), ('fun', 'dfx-play', 'Soft play', 2)
               on conflict (key) do update set active = true`);
  await query(`insert into place_attributes (key, label, kind, active, standard) values
               ('dfx-sauna', 'Sauna', 'yesno', true, false), ('dfx-wave', 'Wave machine', 'yesno', true, false)
               on conflict (key) do update set active = true, standard = false`);
  await query(`delete from subcategory_facts where attribute_key like 'dfx-%'`);
  await query(`insert into subcategory_facts (subcategory_key, attribute_key, status, reason, verified_places, first_seen) values
               ('dfx-water', 'dfx-sauna', 'active', null, 2, now() - interval '40 days'),
               ('dfx-play', 'dfx-sauna', 'gathering', null, 1, '2026-09-19T12:00:00Z'),
               ('dfx-water', 'dfx-wave', 'ignored', 'an_opinion', 0, now()),
               ('dfx-play', 'dfx-wave', 'ignored', 'removed_by_a_person', 0, now())`);
  for (const [ref, sub] of [['dfx:a', 'dfx-water'], ['dfx:b', 'dfx-water'], ['dfx:c', 'dfx-play']]) {
    await query(`insert into place_index (venue_ref, subcategory) values ($1, $2)
                 on conflict (venue_ref) do update set subcategory = $2, not_in_epic_at = null`, [ref, sub]);
    await query(`insert into place_fact_answers (venue_ref, attribute_key, state, yesno, source) values ($1, 'dfx-sauna', 'yes', true, 'osm')
                 on conflict (venue_ref, attribute_key) do update set state = 'yes', yesno = true, source = 'osm', hidden_at = null`, [ref]);
  }
  settings.forget();
}

test('All facts: an ignored fact names where it is ignored and has no count; one row per fact', async () => {
  await seed();
  const out = await facts.allFacts({});
  const sauna = out.rows.find((r) => r.fact === 'dfx-sauna');
  assert.equal(sauna.subcategories, '2', 'active and gathering both look for it');
  assert.equal(sauna.places, 3);
  assert.equal(sauna.statusText, '', 'Active is blank');
  const wave = out.rows.find((r) => r.fact === 'dfx-wave');
  assert.equal(wave.status, 'ignored');
  assert.equal(wave.subcategories, 'Soft play, Water parks');
  assert.equal(wave.places, null, 'no count, never a 0 that means unknown');
});

test('a fact page says how far a gathering subcategory has got', async () => {
  await seed();
  const page = await facts.factPage('dfx-sauna');
  assert.equal(page.status, 'active');
  assert.equal(page.needed, 2);
  const play = page.subcategories.find((s) => s.key === 'dfx-play');
  assert.equal(play.note, 'Confirmed at 1 of 2 places needed · first seen 19 Sep');
  const water = page.subcategories.find((s) => s.key === 'dfx-water');
  assert.equal(water.note, null);
  assert.equal(water.places, 2);
});

test('a standard fact shows its definition bands', async () => {
  const ages = facts.definitionOf({ key: 'suits-ages', kind: 'range' }, settings.DEFAULTS);
  assert.deepEqual(ages.bands[0], { name: 'Babies', means: 'under 2' });
  assert.deepEqual(ages.bands[5], { name: 'Adults', means: '18 and over' });
  const dur = facts.definitionOf({ key: 'duration', kind: 'range' }, settings.DEFAULTS);
  assert.deepEqual(dur.bands.map((b) => b.means), ['less than 1 hour', '', '', '3–5 hours', '5 hours or more']);
  const cost = facts.definitionOf({ key: 'cost-band', kind: 'oneof' }, settings.DEFAULTS);
  assert.deepEqual(cost.cost[0], { country: 'UK', currency: '£ GBP', free: 'Free', cheap: 'under £10', mid: '£10–25', dear: 'over £25' });
  assert.equal(cost.cost[1].dear, 'over €30');
});

test('the places drill-down: found at counts every place, the filters narrow the rows, and Edit knows the answer', async () => {
  await seed();
  const all = await facts.factPlaces('dfx-sauna', {});
  assert.equal(all.foundAt, 3);
  assert.equal(all.total, 3);
  assert.deepEqual(all.options.map((o) => o.key), ['yes', 'no']);
  assert.ok(all.rows.every((r) => r.current === 'yes'));
  const one = await facts.factPlaces('dfx-sauna', { sub: 'dfx-water' });
  assert.equal(one.foundAt, 2);
  assert.equal(one.subLabel, 'Water parks');
  assert.equal(one.categoryLabel, 'Fun');
  assert.equal(one.lookedFor, 2, 'looked for at the places filed where it is active');
  const none = await facts.factPlaces('dfx-sauna', { q: 'no such place' });
  assert.equal(none.total, 0);
  assert.equal(none.foundAt, 3, 'a search narrows the rows, not what was found');
});

test('verification drill-downs: a source narrows them, and the words are the screen’s', async () => {
  await query('delete from fact_checks');
  await query(`insert into fact_checks (venue_ref, feature, outcome, source, at) values
               ('dfx:a', 'Sauna', 'verified', 'osm', now() - interval '1 hour'),
               ('dfx:b', 'Sauna', 'no', 'site', now() - interval '2 hours'),
               ('dfx:c', 'Sauna', 'dont_know', 'osm', now() - interval '3 hours'),
               ('dfx:c', 'Sauna', 'dropped', null, now())`);
  const osm = await verification.items({ kind: 'checked', source: 'osm' });
  assert.equal(osm.total, 2);
  const answered = await verification.items({ kind: 'answered', source: 'osm' });
  assert.deepEqual(answered.rows.map((r) => r.outcome), ['Confirmed']);
  const dropped = await verification.items({ kind: 'dropped' });
  assert.equal(dropped.rows[0].outcome, 'Dropped at 30 days');
  const out = await verification.verification({ period: '24h' });
  assert.equal(out.status.state, 'running');
  assert.equal(out.numbers.notThere, 1);
});

test('the accuracy health view names its row and lists every source, compared or not', async () => {
  await seed();
  await query(`delete from fact_corrections where attribute_key = 'dfx-sauna'`);
  await query(`insert into fact_corrections (venue_ref, attribute_key, answer, machine_state, machine_source, subcategory_key, who)
               values ('dfx:a', 'dfx-sauna', 'no', 'yes', 'osm', 'dfx-water', $1)`, [WHO]);
  const h = await accuracy.health({ kind: 'fact', key: 'dfx-sauna' });
  assert.equal(h.label, 'Sauna');
  assert.deepEqual(h.bySource.slice(0, 4).map((s) => s.key), ['site', 'osm', 'wikipedia', 'wikidata']);
  const osm = h.bySource.find((s) => s.key === 'osm');
  assert.equal(osm.answered, 1);
  assert.equal(osm.accuracy, null, 'under ten is Building');
  const site = h.bySource.find((s) => s.key === 'site');
  assert.equal(site.answered, 0);
  const dis = await accuracy.disagreements({ kind: 'fact', key: 'dfx-sauna', source: 'osm' });
  assert.equal(dis.rows.length, 1);
  assert.equal(dis.rows[0].fact, 'Sauna');
  assert.equal(dis.rows[0].subcategory, 'Water parks');
});
