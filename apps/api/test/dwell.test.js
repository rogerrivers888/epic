import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dwellAllowance, DEFAULT_PACE } from '../src/domain/pace.js';
import { shelvesForAtlas, NO_RULES } from '../src/domain/moods.js';

/**
 * How long a place is worth.
 *
 * Every attraction on the home screen read "allow 2h 30m" — a theme park and a
 * parish church alike — because the atlas branch passed a stub venue and the
 * household's typical activity time was the only number in play. These are the
 * two halves of the fix: the allowance has to *listen* to the kind of place,
 * and the taxonomy has to have something to say about every kind.
 */

const pace = DEFAULT_PACE;

test('a hint from the taxonomy replaces the household default, up and down', () => {
  const base = dwellAllowance(pace, { category: 'attraction' }).minutes;
  assert.equal(base, 150, 'unchanged: a place nobody has an opinion about keeps the household pace');

  // The thing that was impossible before: a day out is longer than typical.
  assert.equal(dwellAllowance(pace, { category: 'attraction', dwellHint: 300 }).minutes, 300);
  assert.equal(dwellAllowance(pace, { category: 'attraction', dwellHint: 30 }).minutes, 30);
});

test('the household ceiling still wins over the hint', () => {
  const strict = { ...pace, activity: { ...pace.activity, maxMinutes: 120 } };
  assert.equal(dwellAllowance(strict, { category: 'attraction', dwellHint: 300 }).minutes, 120);
});

test('a member cap still shortens a hinted stop', () => {
  const walks = dwellAllowance(pace, { category: 'attraction', dwellHint: 300, quickLook: true }).minutes;
  assert.equal(walks, 45, 'a quick look is a quick look however long the kind usually takes');
});

test('the seed covers every drawer the taxonomy ships with', () => {
  // Read the migrations as text rather than a database, so this fails on a
  // laptop and in CI the day somebody adds a subcategory and forgets that a new
  // kind of place with no time on it silently becomes two and a half hours.
  const dir = new URL('../migrations/', import.meta.url);
  const shipped = new Set();
  for (const f of readdirSync(dir).sort()) {
    if (f === '067_dwell_by_subcategory.sql' || !f.endsWith('.sql')) continue;
    const sql = readFileSync(new URL(f, dir), 'utf8');
    if (!sql.includes('insert into shelf_subcategories')) continue;
    for (const m of sql.matchAll(/\(\s*'[a-z-]+'\s*,\s*'([a-z-]+)'\s*,\s*'/g)) shipped.add(m[1]);
  }
  assert.ok(shipped.size >= 51, `expected to find the shipped drawers, found ${shipped.size}`);

  const seeded = new Set();
  const seed = readFileSync(new URL('067_dwell_by_subcategory.sql', dir), 'utf8');
  for (const m of seed.matchAll(/\('([a-z-]+)',\s*\d+\)/g)) seeded.add(m[1]);

  const missing = [...shipped].filter((k) => !seeded.has(k));
  assert.deepEqual(missing, [], `subcategories with no dwell time: ${missing.join(', ')}`);
  const unknown = [...seeded].filter((k) => !shipped.has(k));
  assert.deepEqual(unknown, [], `dwell times for drawers that do not exist: ${unknown.join(', ')}`);
});

test('the atlas branch reads the taxonomy rather than passing a stub', () => {
  const src = readFileSync(new URL('../src/routes/inspire.js', import.meta.url), 'utf8');
  assert.ok(!/dwellFor\(\{ category: 'attraction', experiences: \[\] \}/.test(src),
    'the stub venue is back: every attraction will read the same allowance again');
  assert.ok(/dwellHint: tax\.subByKey\.get\(/.test(src),
    'the atlas dwell must come from the shelf the place is already on');
});

test('an untaught atlas place still lands in a drawer', () => {
  // The other half of the same bug: with no drawer there is no dwell time, so
  // Big Ben and the National Gallery both read the household default — and both
  // were invisible to the home screen's drawer filters as well.
  const vocab = {
    rank: { culture: 1, outdoors: 1, fun: 1, sport: 1 },
    parentOf: new Map([['museums', 'culture'], ['galleries', 'culture'], ['landmarks', 'culture'],
      ['parks', 'outdoors'], ['zoos-wildlife', 'fun'], ['days-out', 'fun'], ['arenas', 'sport']]),
  };
  const at = (category) => shelvesForAtlas({ ref: 'wikidata:Q1', category, kinds: [] }, NO_RULES, vocab).subcategory;

  assert.equal(at('museum'), 'museums');
  assert.equal(at('landmark'), 'landmarks');
  assert.equal(at('outdoors'), 'parks');
  assert.equal(at('animals'), 'zoos-wildlife');
  assert.equal(at('active'), 'arenas');
  // Twenty minutes at an arch or half a day at an estate — no honest default.
  assert.equal(at('heritage'), null);
});

test('a taught drawer still beats the starting one', () => {
  const vocab = { rank: { culture: 1 }, parentOf: new Map([['museums', 'culture'], ['galleries', 'culture']]) };
  const rules = { ...NO_RULES, place: new Map([['wikidata:Q1', { subcategory: 'galleries', weights: { culture: 1 } }]]) };
  const got = shelvesForAtlas({ ref: 'wikidata:Q1', category: 'museum', kinds: [] }, rules, vocab);
  assert.equal(got.subcategory, 'galleries');
});

test('the proximity search collapses a place filed under two counties', () => {
  // Windsor Great Park and Cumberland Lodge straddle Surrey and Berkshire, so
  // the atlas holds each twice on purpose — `attractions` is unique on
  // (region_slug, wikidata_id). A search by distance has to collapse them, and
  // it has to do it in the query rather than by deleting anybody's rows.
  const sql = readFileSync(new URL('../src/repositories/library.js', import.meta.url), 'utf8');
  assert.match(sql, /distinct on \(coalesce\(wikidata_id, id::text\)\)/,
    'two Windsor Great Parks in one carousel');
  assert.match(sql, /partition by lower\(name\)/,
    'the demolished Wembley Stadium is a second Wikidata entity with the same name');
});

test('the nearest places keep their seats when the pool is capped', () => {
  const sql = readFileSync(new URL('../src/repositories/library.js', import.meta.url), 'utf8');
  assert.match(sql, /row_number\(\) over \(order by km\) as by_nearness/,
    'nothing is holding a seat for what is simply nearest');
  assert.match(sql, /case when by_nearness <= \$9::int then 0 else 1 end/,
    'the reservation must be seated before the cap, or merit takes every seat');
  assert.match(sql, /select \* from picked order by by_merit/,
    'a reserved seat says the local park belongs on the screen, not that it leads');
});

test('the SQL carries no backtick, which would end the template literal', () => {
  // Twice now a prose comment inside the query has closed the string it lives
  // in and broken the module at import. Cheap to check, invisible otherwise.
  const src = readFileSync(new URL('../src/repositories/library.js', import.meta.url), 'utf8');
  const start = src.indexOf('`with candidates as (');
  assert.ok(start > 0, 'the proximity query moved; update this test');
  const body = src.slice(start + 1, src.indexOf('`', start + 1));
  assert.ok(!body.includes('`'), 'a backtick inside the SQL would truncate the query');
  assert.match(body, /limit \$8/, 'the query body should reach its limit clause');
});
