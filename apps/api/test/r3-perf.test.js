import { test } from 'node:test';
import assert from 'node:assert/strict';

// Round 3 PERF (29 Sep 2026): the desk's tabs made fast without changing a
// single answer. Each speed-up is held here against the slow form it replaced:
// place_words against the four-way union it keeps (migration 281), compiled
// collection rules against the walk they replace, the memo against a fresh
// filter, FILED_SQL's `union all` against a plain `union`, and Overview's one
// pass against its seven.
import { testDatabase } from './helpers/db.js';
const { query, pool } = await testDatabase();
const { PLACE_WORDS, PLACE_WORDS_WORKED_OUT } = await import('../src/desk/words.js');
const collections = await import('../src/desk/collections.js');
const { FILED_SQL } = await import('../src/desk/categories.js');

test.after(() => pool.end());

/** The kept table and the union it stands for, each as sorted "ref|label" lines, for these refs. */
async function bothWays(refs) {
  const read = async (sql) => (await query(
    `select venue_ref || '|' || label as k from ${sql} w where venue_ref = any($1) order by 1`, [refs])).rows.map((r) => r.k);
  return { kept: await read(PLACE_WORDS), worked: await read(PLACE_WORDS_WORKED_OUT) };
}

const REFS = ['pw:1', 'pw:2', 'pw:3'];

test('place_words holds exactly what the union works out, through every kind of write', async () => {
  await query('delete from place_index where venue_ref = any($1)', [REFS]);
  const same = async (step) => {
    const { kept, worked } = await bothWays(REFS);
    assert.deepEqual(kept, worked, `after ${step}`);
    return kept;
  };

  // A new place found by a census word, and one with Google types.
  await query(`insert into place_index (venue_ref, subcategory, found_by) values ('pw:1', 'pw-sub', 'park')`);
  await query(`insert into place_index (venue_ref, subcategory, google_types) values ('pw:2', 'pw-sub', array['zoo','park'])`);
  assert.deepEqual(await same('the inserts'), ['pw:1|google:park', 'pw:2|google:park', 'pw:2|google:zoo']);

  // An upsert that changes types; one that touches only last_seen.
  await query(`insert into place_index (venue_ref, google_types) values ('pw:2', array['aquarium'])
               on conflict (venue_ref) do update set google_types = excluded.google_types`);
  await query(`update place_index set last_seen = now() where venue_ref = any($1)`, [REFS]);
  assert.deepEqual(await same('the type change'), ['pw:1|google:park', 'pw:2|google:aquarium']);

  // A census word on place_subcategories, then changed, then gone.
  await query(`insert into place_index (venue_ref) values ('pw:3')`);
  await query(`insert into place_subcategories (venue_ref, category, subcategory, found_by) values ('pw:3', 'fun', 'pw-sub', 'bowling_alley')`);
  await same('a place_subcategories word');
  await query(`update place_subcategories set found_by = 'amusement_park' where venue_ref = 'pw:3'`);
  assert.ok((await same('the word changed')).includes('pw:3|google:amusement_park'));
  await query(`delete from place_subcategories where venue_ref = 'pw:3'`);
  assert.ok(!(await same('the word gone')).some((k) => k.startsWith('pw:3|')));

  // Two sources giving the same word; one leaves and the word stays.
  await query(`insert into place_index_labels (venue_ref, label) values ('pw:1', 'google:park'), ('pw:1', 'osm:leisure=park')`);
  await same('a label that repeats the census word, and one that is not Google');
  await query(`update place_index set found_by = null where venue_ref = 'pw:1'`);
  assert.deepEqual((await same('the census word cleared')).filter((k) => k.startsWith('pw:1|')), ['pw:1|google:park']);
  await query(`delete from place_index_labels where venue_ref = 'pw:1'`);
  assert.deepEqual((await same('the label gone')).filter((k) => k.startsWith('pw:1|')), []);

  // A place leaving the index takes its words with it.
  await query(`delete from place_index where venue_ref = 'pw:2'`);
  assert.deepEqual((await same('the place deleted')).filter((k) => k.startsWith('pw:2|')), []);

  await query('delete from place_index where venue_ref = any($1)', [REFS]);
  assert.deepEqual(await same('the clean-up'), []);
});

test('the whole table agrees with the union, not only the rows this file wrote', async () => {
  const { rows: [r] } = await query(`
    select (select count(*) from (select * from ${PLACE_WORDS} a except select * from ${PLACE_WORDS_WORKED_OUT} b) x)::int extra,
           (select count(*) from (select * from ${PLACE_WORDS_WORKED_OUT} b except select * from ${PLACE_WORDS} a) y)::int missing`);
  assert.deepEqual(r, { extra: 0, missing: 0 });
});

// ---------------------------------------------------------------------------
// Collections: the compiled rules answer as the walk did.

const place = (o) => ({ ref: 'x', primarySub: null, primaryCat: null, subs: [], cats: [], facts: new Set(), no: new Set(), ages: null, hours: null, durRange: null, cost: null, ...o });
const PLACES = [
  place({ ref: 'a', primarySub: 'water', primaryCat: 'outdoors', subs: ['water'], cats: ['outdoors'], facts: new Set(['indoor']), ages: [0, 99], hours: 2, cost: 'Free' }),
  place({ ref: 'b', primarySub: 'coast', primaryCat: 'outdoors', subs: ['coast', 'water'], cats: ['outdoors', 'fun'], no: new Set(['indoor', 'booking-required']), ages: [4, 12], hours: 4, cost: 'Cheap' }),
  place({ ref: 'c', primarySub: 'museums', primaryCat: 'educational', subs: ['museums'], cats: ['educational'], facts: new Set(['step-free', 'parking', 'toilets']), ages: [12, 60] }),
  place({ ref: 'd', primarySub: 'play', primaryCat: 'fun', subs: ['play'], cats: ['fun'], facts: new Set(['dog-friendly']), no: new Set(['indoor']), hours: 1, cost: 'Mid' }),
  place({ ref: 'e' }),
];

/** The rule test as it was before it was compiled (collections.js, round 2). */
function walked(rule, p) {
  const group = (items, has) => {
    if (!items.length) return true;
    const pos = items.filter((i) => !i.not);
    const neg = items.filter((i) => i.not);
    if (neg.some((i) => has(i.id))) return false;
    return !pos.length || pos.some((i) => has(i.id));
  };
  if (!group(rule.cats, (id) => p.cats.includes(id))) return false;
  if (!group(rule.subs, (id) => p.subs.includes(id))) return false;
  if (!group(rule.facts, (id) => p.facts.has(id))) return false;
  if (rule.primaryCat && p.primaryCat !== rule.primaryCat) return false;
  if (rule.ages) {
    if (!p.ages) return false;
    const [lo, hi] = rule.ages;
    if (rule.ageSpan ? !(p.ages[0] <= lo && p.ages[1] >= hi) : !(p.ages[0] <= hi && p.ages[1] >= lo)) return false;
  }
  if (rule.dur) { if (p.hours == null) return false; if (p.hours < rule.dur[0] || p.hours > rule.dur[1]) return false; }
  if (rule.cost.length) { if (!p.cost || !rule.cost.includes(p.cost)) return false; }
  return true;
}

const RULES = [
  {}, { cats: ['outdoors'] }, { cats: [{ id: 'fun', not: true }] }, { subs: ['water', { id: 'coast', not: true }] },
  { facts: ['indoor'] }, { facts: [{ id: 'indoor', not: true }] }, { ages: [4, 7] }, { ages: [12, 60], ageSpan: true },
  { dur: [0, 2] }, { cost: ['Free', 'Mid'] }, { primaryCat: 'fun' }, { cats: ['educational'], primaryCat: 'fun' },
  { subs: ['play', 'museums'], facts: ['step-free'], ages: [4, 12] },
];

test('a compiled rule answers as the walk did, place for place', () => {
  for (const raw of RULES) {
    const rule = collections.cleanRule(raw);
    for (const p of PLACES) assert.equal(collections.matches(rule, p), walked(rule, p), `${JSON.stringify(raw)} on ${p.ref}`);
  }
  // Two rules asked in turn, each place alternately: the one-rule memo must not answer for the other.
  const [r1, r2] = [collections.cleanRule({ cats: ['outdoors'] }), collections.cleanRule({ cats: ['fun'] })];
  for (const p of PLACES) {
    assert.equal(collections.matches(r1, p), walked(r1, p));
    assert.equal(collections.matches(r2, p), walked(r2, p));
  }
});

const PREDICATES = [
  { all: [{ yes: false, attribute: 'indoor' }] },
  { all: [{ overlaps: [0, 3], attribute: 'suits-ages' }] },
  { any: [{ yes: true, attribute: 'indoor' }, { subcategory: ['water', 'woodland'] }] },
  { all: [{ not: { subcategory: ['coast'] } }, { yes: true, attribute: 'indoor' }] },
  { all: [{ category: ['relaxing', 'outdoors'] }, { yes: false, attribute: 'booking-required' }] },
  { all: [{ yes: true, attribute: 'step-free' }, { yes: true, attribute: 'parking' }, { yes: true, attribute: 'toilets' }] },
  { all: [{ choice: 'cheap', attribute: 'cost-band' }] },
  { all: [{ attribute: 'how-thrilling', atLeast: 3 }] },
  {},
];

test('a compiled legacy predicate answers as matchesPredicate does', () => {
  for (const pred of PREDICATES) {
    const c = { legacy: pred, rule: collections.cleanRule({}) };
    for (const p of PLACES) assert.equal(collections.fits(c, p), collections.matchesPredicate(pred, p), `${JSON.stringify(pred)} on ${p.ref}`);
  }
});

test('placesFitting is the filter, worked out once per index', () => {
  const idx = { places: PLACES, fitting: new Map() };
  const c = { legacy: null, rule: collections.cleanRule({ cats: ['outdoors'] }) };
  const first = collections.placesFitting(c, idx);
  assert.deepEqual(first.map((p) => p.ref), PLACES.filter((p) => collections.fits(c, p)).map((p) => p.ref));
  // The same rule, as a new object from a new read of the row: the same answer, not worked again.
  assert.equal(collections.placesFitting({ legacy: null, rule: collections.cleanRule({ cats: ['outdoors'] }) }, idx), first);
  // A new index works it out afresh.
  const next = { places: PLACES.slice(0, 1), fitting: new Map() };
  assert.deepEqual(collections.placesFitting(c, next).map((p) => p.ref), ['a']);
  // A legacy predicate and a rule are never confused for each other.
  const legacy = { legacy: { all: [{ subcategory: ['play'] }] }, rule: collections.cleanRule({}) };
  assert.deepEqual(collections.placesFitting(legacy, idx).map((p) => p.ref), ['d']);
});

// ---------------------------------------------------------------------------
// FILED_SQL's union all, and Overview's one pass.

test('FILED_SQL is the same set as a plain union, with a secondary filing and a word that repeats it', async () => {
  await query(`insert into shelf_categories (key, label, position) values ('pf-cat', 'PF', 99) on conflict (key) do nothing`);
  for (const k of ['pf-a', 'pf-b']) {
    await query(`insert into shelf_subcategories (category_key, key, label, position) values ('pf-cat', $1, $1, 99) on conflict (key) do update set active = true`, [k]);
  }
  await query(`insert into taxonomy_labels (namespace, key, label) values ('google', 'pf_word', 'pf word'), ('google', 'pf_word2', 'pf word 2') on conflict do nothing`);
  await query(`delete from word_targets where word in ('pf_word', 'pf_word2')`);
  await query(`insert into word_targets (namespace, word, subcategory_key, is_primary) values ('google', 'pf_word', 'pf-b', false), ('google', 'pf_word2', 'pf-b', false)`);
  await query(`insert into place_index (venue_ref, subcategory, found_by, google_types) values ('pf:1', 'pf-a', 'pf_word', array['pf_word2'])
               on conflict (venue_ref) do update set subcategory = 'pf-a', found_by = 'pf_word', google_types = array['pf_word2'], not_in_epic_at = null`);
  const union = FILED_SQL.replace(/union all\s+select distinct/, 'union\n  select');
  assert.notEqual(union, FILED_SQL);
  const read = async (sql) => (await query(`select venue_ref, sub, is_primary from (${sql}) f where venue_ref = 'pf:1' order by 2`)).rows;
  const rows = await read(FILED_SQL);
  assert.deepEqual(rows, await read(union));
  assert.deepEqual(rows.map((r) => [r.sub, r.is_primary]), [['pf-a', true], ['pf-b', false]], 'two words filing one place in one drawer count once');
  const all = async (sql) => (await query(`select count(*)::int n from (${sql}) f`)).rows[0].n;
  assert.equal(await all(FILED_SQL), await all(union));
  await query(`delete from word_targets where word in ('pf_word', 'pf_word2')`);
  await query(`delete from place_index where venue_ref = 'pf:1'`);
});

test("Overview's places series in one pass is the seven counts it replaced", async () => {
  await query(`insert into place_index (venue_ref, subcategory, first_seen) values
                 ('ov:1', 'pf-a', now() - interval '20 days'), ('ov:2', 'pf-a', now() - interval '3 days'),
                 ('ov:3', 'pf-a', date_trunc('week', now()) - interval '1 second'), ('ov:4', 'pf-a', date_trunc('week', now()))
               on conflict (venue_ref) do nothing`);
  const weeks = `generate_series(date_trunc('week', now()) - interval '6 weeks', date_trunc('week', now()), interval '1 week') g`;
  const { rows: old } = await query(`select to_char(date_trunc('week', g), 'YYYY-MM-DD') as week,
      (select count(*) from place_index where subcategory is not null and not_in_epic_at is null and first_seen < g + interval '7 days')::int as n
      from ${weeks}`);
  const { rows: now } = await query(`with arrived as materialized (
      select date_trunc('week', first_seen) as wk, count(*) as c from place_index
       where subcategory is not null and not_in_epic_at is null group by 1)
    select to_char(date_trunc('week', g), 'YYYY-MM-DD') as week, (select coalesce(sum(c), 0) from arrived where wk <= g)::int as n
      from ${weeks} order by g`);
  assert.deepEqual(now, old);
  await query(`delete from place_index where venue_ref like 'ov:%'`);
});

test('related drawers found among places with a secondary filing are the pairs the whole self-join found', async () => {
  await query(`insert into shelf_categories (key, label, position) values ('pf-cat', 'PF', 99) on conflict (key) do nothing`);
  for (const k of ['pf-a', 'pf-b', 'pf-c']) {
    await query(`insert into shelf_subcategories (category_key, key, label, position) values ('pf-cat', $1, $1, 99) on conflict (key) do update set active = true`, [k]);
  }
  await query(`insert into taxonomy_labels (namespace, key, label) values ('google', 'pr_b', 'pr b'), ('google', 'pr_c', 'pr c') on conflict do nothing`);
  await query(`delete from word_targets where word in ('pr_b', 'pr_c')`);
  await query(`insert into word_targets (namespace, word, subcategory_key, is_primary) values ('google', 'pr_b', 'pf-b', false), ('google', 'pr_c', 'pf-c', false)`);
  // Three places in pf-a also in pf-b, two of them in pf-c too; one lone place.
  for (const [ref, types] of [['pr:1', ['pr_b', 'pr_c']], ['pr:2', ['pr_b', 'pr_c']], ['pr:3', ['pr_b']], ['pr:4', []]]) {
    await query(`insert into place_index (venue_ref, subcategory, google_types) values ($1, 'pf-a', $2)
                 on conflict (venue_ref) do update set subcategory = 'pf-a', google_types = $2, not_in_epic_at = null`, [ref, types]);
  }
  const pairs = async (sql) => (await query(`with f as (${FILED_SQL}) ${sql}`)).rows.filter((r) => r.a.startsWith('pf-'));
  const old = await pairs(`select a.sub as a, b.sub as b, count(*)::int n from f a join f b on a.venue_ref = b.venue_ref and a.sub < b.sub
                            group by 1, 2 having count(*) >= 2 order by 1, 2`);
  const now = await pairs(`, two as (select * from f where venue_ref in (select venue_ref from f where not is_primary))
                           select a.sub as a, b.sub as b, count(*)::int n from two a join two b on a.venue_ref = b.venue_ref and a.sub < b.sub
                            group by 1, 2 having count(*) >= 2 order by 1, 2`);
  assert.deepEqual(now, old);
  assert.deepEqual(now, [{ a: 'pf-a', b: 'pf-b', n: 3 }, { a: 'pf-a', b: 'pf-c', n: 2 }, { a: 'pf-b', b: 'pf-c', n: 2 }]);
  await query(`delete from word_targets where word in ('pr_b', 'pr_c')`);
  await query(`delete from place_index where venue_ref like 'pr:%'`);
});
