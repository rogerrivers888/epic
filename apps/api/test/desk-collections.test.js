import { test } from 'node:test';
import assert from 'node:assert/strict';

// Collections on the rebuilt desk (back-office handover, 28 Sep 2026): a save
// returns the change its toast undoes; "See as a household" names the
// members, the hearts (fading ones marked) and a shelf for each shown row;
// the side drawer lists a place's facts with Don't know as its own answer.
import { testDatabase } from './helpers/db.js';
const { query, pool } = await testDatabase();
const collections = await import('../src/desk/collections.js');

test.after(() => pool.end());

const WHO = 'test@epic';

async function seed() {
  await query(`insert into shelf_categories (key, label, position) values ('fun', 'Fun', 1) on conflict (key) do update set active = true`);
  await query(`insert into shelf_subcategories (category_key, key, label, position) values ('fun', 'dc-water', 'Water parks', 1)
               on conflict (key) do update set active = true`);
  for (const [ref, name] of [['dc:1', 'Splash One'], ['dc:2', 'Splash Two'], ['dc:3', 'Splash Three'], ['dc:4', 'Splash Four'], ['dc:5', 'Splash Five']]) {
    await query(`insert into place_index (venue_ref, subcategory) values ($1, 'dc-water')
                 on conflict (venue_ref) do update set subcategory = 'dc-water', not_in_epic_at = null`, [ref]);
    await query(`insert into place_records (venue_ref, name) values ($1, $2) on conflict (venue_ref) do update set name = excluded.name`, [ref, name]);
  }
  await query(`insert into place_attribute_values (venue_ref, attribute_key, yesno, set_by) values ('dc:1', 'indoor', true, 'a person')
               on conflict (venue_ref, attribute_key) do update set yesno = true, set_by = 'a person'`);
  collections.forget();
}

test('saving a collection returns the change its Undo sends, and undo takes a new one away', async () => {
  await seed();
  await query(`delete from browse_rows where key like 'dc-splash%'`);
  const made = await collections.saveCollection({ title: 'DC splash', copy: 'Wet', rule: { subs: ['dc-water'] }, who: WHO });
  assert.equal(made.created, true);
  assert.ok(made.change?.id);
  const edited = await collections.saveCollection({ key: made.key, title: 'DC splash', copy: 'Very wet', rule: { subs: ['dc-water'] }, who: WHO });
  assert.ok(edited.change?.id, 'an edit that changed something returns its change');
  const same = await collections.saveCollection({ key: made.key, title: 'DC splash', copy: 'Very wet', rule: { subs: ['dc-water'] }, who: WHO });
  assert.equal(same.change, null, 'a save that changed nothing has nothing to undo');
  const { rows: [ch] } = await query('select * from bo_changes where id = $1', [made.change.id]);
  await collections.undoCollection({ change: { ...ch, undo: ch.undo }, who: WHO });
  const { rows } = await query('select 1 from browse_rows where key = $1', [made.key]);
  assert.equal(rows.length, 0);
});

test('the side drawer lists standard facts with Don\'t know as null, and the collections a place is in', async () => {
  await seed();
  await query(`delete from browse_rows where key like 'dc-splash%'`);
  const made = await collections.saveCollection({ title: 'DC splash', rule: { subs: ['dc-water'] }, who: WHO });
  const card = await collections.placeCard('dc:1');
  assert.equal(card.name, 'Splash One');
  const indoor = card.facts.find((f) => f.name.toLowerCase().includes('indoor'));
  assert.equal(indoor?.value, 'Yes');
  assert.ok(card.facts.some((f) => f.value === null), 'an unknown standard fact is null, drawn as Don\'t know');
  assert.ok(card.collections.some((c) => c.key === made.key));
  await query('delete from browse_rows where key = $1', [made.key]);
});

test('see as a household: members, hearts with their age, a shelf for each shown row, and no crash on an audience test', async () => {
  await seed();
  await query(`delete from browse_rows where key like 'dc-%'`);
  await query(`insert into browse_rows (key, grouping, title, copy, predicate, rule, position, active, seeded)
               values ('dc-all', 'custom', 'DC all', '', '{}'::jsonb, '{"subs":[{"id":"dc-water","not":false}]}'::jsonb, 1, true, false),
                      ('dc-tots', 'custom', 'DC tots', '', '{}'::jsonb, '{"subs":[{"id":"dc-water","not":false}],"ages":[0,3]}'::jsonb, 2, true, false)`);
  const { rows: [h] } = await query(`insert into households (name) values ('DC house') returning id`);
  const { rows: [m] } = await query(`insert into members (household_id, name, birth_year) values ($1, 'Ann', 1980) returning id`, [h.id]);
  await query(`insert into browse_row_hearts (row_key, household_id, member_id, hearted_at) values ('dc-all', $1, $2, now() - interval '200 days')`, [h.id, m.id]);
  collections.forget();
  const out = await collections.asHousehold({ householdId: h.id });
  assert.deepEqual(out.members.map((x) => [x.name, x.adult]), [['Ann', true]]);
  const all = out.shown.find((c) => c.key === 'dc-all');
  assert.ok(all, 'five places clears the minimum of four');
  assert.equal(all.hearted, false, 'a heart older than the fade no longer lifts it');
  assert.ok(all.shelf.length > 0 && all.shelf.length <= 3);
  assert.equal(all.shelf[0].kind, 'Water parks');
  const tots = out.hidden.find((c) => c.key === 'dc-tots');
  assert.match(tots.why, /Nobody here is aged 0–3/);
  assert.equal(out.hearts[0].fading, true);
  assert.equal(out.hearts[0].member, 'Ann');
  await query(`delete from browse_rows where key like 'dc-%'`);
  await query('delete from households where id = $1', [h.id]);
});
