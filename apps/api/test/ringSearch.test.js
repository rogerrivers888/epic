/**
 * The ring the app searches, and what it costs.
 *
 * The owner set the shape on 20 Sep 2026: the census count for the reach is
 * free and comes from `area_counts`; the list is one display search per
 * category fenced to the ring's box; a page is bought once for the ring and
 * held for twelve hours; and everything bought is scored on the spot.
 *
 * Every one of those is silent when it is wrong — a second search that bills
 * again looks exactly like one that did not, and a place outside the ring looks
 * exactly like one inside it — so they are pinned here.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const ring = await import('../src/domain/ring.js');
const search = await import('../src/sources/ringSearch.js');

test.after(() => pool.end());

test('a cell says which outward code it belongs to', () => {
  assert.equal(ring.outcodeOfCell('sector:SL5 0'), 'SL5');
  assert.equal(ring.outcodeOfCell('sector:TW18 1'), 'TW18');
  assert.equal(ring.outcodeOfCell(''), null);
});

test('the box holds every cell, with room at the edges', () => {
  const box = ring.boxAround([{ lat: 51.40, lng: -0.63 }, { lat: 51.50, lng: -0.40 }]);
  assert.ok(box.minLat < 51.40 && box.maxLat > 51.50, 'the box reaches past the cells it holds');
  assert.ok(box.minLng < -0.63 && box.maxLng > -0.40);
  // A rectangle round an irregular ring is always wider than the ring, which is
  // why the outcode test exists downstream.
  assert.ok(ring.boxKm(box).across > 0 && ring.boxKm(box).down > 0);
});

test('the census count for a reach is summed from area_counts, and says what it has not seen', async () => {
  await query(`delete from area_counts where area_slug in ('zz1','zz2')`);
  await query(
    `insert into area_counts (area_slug, category, subcategory, census_count, censused_at)
     values ('zz1','fun','theme-parks',40, now()), ('zz1','food','pubs-bars',100, now()), ('zz2','fun','zoos-wildlife',2, now())`);

  const out = await search.censusCounts(['ZZ1', 'ZZ2', 'ZZ3']);
  assert.equal(out.counts.fun, 42, 'the ring is the sum of its outcodes');
  assert.equal(out.counts.food, 100);
  // An outcode nobody has censused contributes nothing and is named: "we have
  // not looked here" is not "there is nothing here".
  assert.deepEqual(out.missing, ['zz3']);
});

test('a page is bought once for the ring, held for the next household, and paged on its token', async () => {
  search.forgetPool();
  let calls = 0;
  const cellAt = async () => ({ code: 'sector:ZZ1 1' });
  const fake = async ({ pageToken }) => {
    calls += 1;
    return {
      venues: [
        { source: 'google', sourcePlaceId: `p${calls}`, name: `Place ${calls}`, lat: 51.4, lng: -0.6, rating: null },
        // Outside the ring: the box is wider than the ring, and this is where
        // the difference is enforced.
        { source: 'google', sourcePlaceId: `far${calls}`, name: 'Far away', lat: 55, lng: -3, rating: null },
      ],
      nextPageToken: pageToken ? null : 'page-two',
      requests: 1,
      problem: null,
    };
  };
  const at = async ({ lat }) => (lat > 54 ? { code: 'sector:ZZ9 9' } : { code: 'sector:ZZ1 1' });
  const args = {
    ringKey: 'ring-a', box: { minLat: 0, maxLat: 60, minLng: -5, maxLng: 5 },
    cells: ['sector:ZZ1 1'], category: 'fun', cellAt: at, search: fake,
  };

  const first = await search.categoryPage({ ...args, page: 1 });
  assert.equal(first.cached, false);
  assert.equal(first.requests, 1);
  // Inside the ring only: the one at lat 55 is in the box and not in the ring.
  assert.deepEqual(first.venues.map((v) => v.name), ['Place 1']);

  // The second household in Sunningdale that afternoon pays nothing.
  const again = await search.categoryPage({ ...args, page: 1 });
  assert.equal(again.cached, true);
  assert.equal(again.requests, 0);
  assert.equal(calls, 1, 'the pool answered without asking Google again');

  // Page two is bought, and only on page one's token.
  const second = await search.categoryPage({ ...args, page: 2 });
  assert.equal(second.requests, 1);
  assert.equal(calls, 2);
  assert.equal(second.askedAt, 0, 'still the category\u2019s first question');

  // Google has no more of that question. The category is a cabinet of drawers,
  // so the next page asks the next drawer rather than stopping (owner, 20 Sep
  // 2026: "it says 3 of 23 within reach, but it only shows me 3").
  const third = await search.categoryPage({ ...args, page: 3 });
  assert.equal(third.requests, 1);
  assert.equal(third.askedAt, 1);
  assert.equal(third.asked, search.THEN.fun[0]);
});

test('a shop is not a day out', async () => {
  search.forgetPool();
  const fake = async () => ({
    venues: [
      { source: 'google', sourcePlaceId: 'shop', name: 'Halfords', primaryType: 'bicycle_store', lat: 51.4, lng: -0.6 },
      { source: 'google', sourcePlaceId: 'park', name: 'Go Ape', primaryType: 'tourist_attraction', lat: 51.4, lng: -0.6 },
    ],
    nextPageToken: null, requests: 1, problem: null,
  });
  const at = async () => ({ code: 'sector:ZZ1 1' });
  const out = await search.categoryPage({
    ringKey: 'ring-shops', box: { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 },
    cells: ['sector:ZZ1 1'], category: 'adrenaline', page: 1, cellAt: at, search: fake,
  });
  assert.deepEqual(out.venues.map((v) => v.name), ['Go Ape'],
    'a bike shop matched "quad biking" and is not an afternoon out');
});

test('the questions run out, and then it really does end', async () => {
  search.forgetPool();
  const fake = async () => ({ venues: [], nextPageToken: null, requests: 1, problem: null });
  const at = async () => ({ code: 'sector:ZZ1 1' });
  const args = { ringKey: 'ring-end', box: { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 }, cells: ['sector:ZZ1 1'], category: 'fun', cellAt: at, search: fake };
  // Every page answers a question and offers no token, so each one moves on.
  const pages = search.THEN.fun.length + 1;
  for (let n = 1; n <= pages; n += 1) await search.categoryPage({ ...args, page: n });
  const past = await search.categoryPage({ ...args, page: pages + 1 });
  assert.equal(past.end, true, 'a cabinet with no drawers left is the end of it');
  assert.equal(past.requests, 0, 'and nobody is billed for asking again');
});

test('a stale page is drawn at once and replaced behind it', async () => {
  search.forgetPool();
  let calls = 0;
  const fake = async () => { calls += 1; return { venues: [], nextPageToken: null, requests: 1, problem: null }; };
  const at = async () => ({ code: 'sector:ZZ1 1' });
  const args = { ringKey: 'ring-stale', box: { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 }, cells: ['sector:ZZ1 1'], category: 'fun', cellAt: at, search: fake };
  await search.categoryPage({ ...args, page: 1 });
  assert.equal(calls, 1);

  // Twelve hours on. The page is no longer current and is still worth drawing:
  // the household sees it now and the fresh one lands behind them.
  search.age('ring-stale|fun|1', 13 * 3600_000);
  const stale = await search.categoryPage({ ...args, page: 1 });
  assert.equal(stale.cached, true);
  assert.equal(stale.stale, true);
  assert.equal(stale.requests, 0, 'nobody waited for it');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls, 2, 'and it was fetched behind them, once');
});

test('the keys are the ring, the category and the page', () => {
  assert.equal(search.pageKey('ring-a', 'fun', 1), 'ring-a|fun|1');
  assert.notEqual(search.pageKey('ring-a', 'fun', 1), search.pageKey('ring-b', 'fun', 1));
  assert.notEqual(search.pageKey('ring-a', 'fun', 1), search.pageKey('ring-a', 'food', 1));
  assert.notEqual(search.pageKey('ring-a', 'fun', 1), search.pageKey('ring-a', 'fun', 2));
});
