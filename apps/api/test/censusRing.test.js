/**
 * Counting the census inside a ring, without coordinates.
 *
 * The owner, 20 Sep 2026: "Tell me how a census row can be attributed to a
 * location when 42% of place_index has no coordinates… If yes, count by slice.
 * If no, say so and we'll decide — don't count by place_cells and silently lose
 * the census-only population."
 *
 * It can, and this is the proof: the census writes the rectangle it was asking
 * inside on every place it finds, so a place with no coordinate of its own is
 * still known to be in that box. Everything below is a rule that is silent when
 * it is wrong — a double count looks like a bigger area, a place outside the
 * ring looks like one inside it, and a box too wide to place looks like either.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase } from './helpers/db.js';

const { query, pool } = await testDatabase();
const { censusInRing } = await import('../src/repositories/censusRing.js');

test.after(() => pool.end());

const IN = 'sector:ZR1 1';
const OUT = 'sector:ZR2 2';
const OUTCODES = ['ZR1', 'ZR2'];
const REFS = ['google:RING-OWN', 'google:RING-SLICE', 'google:RING-WIDE', 'google:RING-OUTSIDE', 'google:RING-BOTH', 'google:RING-ACROSS'];

const seed = async () => {
  await query('delete from place_subcategories where venue_ref = any($1)', [REFS]);
  await query('delete from place_index where venue_ref = any($1)', [REFS]);
  await query('delete from geo_cells where code = any($1)', [[IN, OUT]]);
  await query(
    `insert into geo_cells (code, scheme, label, country_code, outcode, lat, lng, source)
     values ($1,'sector','ZR1 1','GB','ZR1', 51.400, -0.630, 'test'),
            ($2,'sector','ZR2 2','GB','ZR2', 51.600, -0.300, 'test')`, [IN, OUT]);
  // Four places: one with its own point, one placed only by a small slice, one
  // whose slice is six kilometres across, and one plainly outside the ring.
  await query(
    `insert into place_index (venue_ref, category, subcategory, lat, lng, slice, country_code)
     values ('google:RING-OWN','fun','theme-parks', 51.401, -0.631, null, 'GB'),
            ('google:RING-SLICE','fun','zoos-wildlife', null, null, '51.3990,-0.6320,51.4030,-0.6280', 'GB'),
            ('google:RING-WIDE','fun','days-out', null, null, '51.3800,-0.7000,51.4400,-0.6200', 'GB'),
            ('google:RING-OUTSIDE','fun','theme-parks', null, null, '51.5980,-0.3020,51.6020,-0.2980', 'GB'),
            ('google:RING-BOTH','sport','swimming', 51.401, -0.631, null, 'GB'),
            -- A box with one corner by each sector: in the ring or not, and the
            -- row cannot say which.
            ('google:RING-ACROSS','fun','days-out', null, null, '51.3900,-0.7000,51.6100,-0.2900', 'GB')`);
  // The census files a place under every drawer whose question found it.
  await query(
    `insert into place_subcategories (venue_ref, category, subcategory, area_slug, found_by, found_rank)
     values ('google:RING-OWN','fun','theme-parks','zr1','amusement_park',1),
            -- the same place, found again by another of Fun's drawers
            ('google:RING-OWN','fun','days-out','zr1','tourist_attraction',4),
            ('google:RING-SLICE','fun','zoos-wildlife','zr1','zoo',1),
            ('google:RING-WIDE','fun','days-out','zr1','tourist_attraction',7),
            ('google:RING-OUTSIDE','fun','theme-parks','zr2','amusement_park',1),
            -- and a place filed under two categories, which is not a double count
            ('google:RING-BOTH','sport','swimming','zr1','swimming_pool',1),
            ('google:RING-BOTH','fun','days-out','zr1','tourist_attraction',9),
            ('google:RING-ACROSS','fun','days-out','zr1','tourist_attraction',11)`);
};

test('a place with no coordinate is placed by the box the census found it in', async () => {
  await seed();
  const out = await censusInRing({ cells: [IN], outcodes: OUTCODES });
  // RING-SLICE has no lat/lng at all and is still counted, because its slice is
  // four hundred metres across and sits inside the ring. This is the whole
  // census-only population that counting by `place_cells` would have lost.
  assert.ok(out.placed.slice >= 1, 'places are being sited by their slice');
  assert.ok(out.counts.fun >= 2);
});

test('one place found by three drawers is one place in that category', async () => {
  await seed();
  const out = await censusInRing({ cells: [IN], outcodes: OUTCODES });
  // Fun holds four places: RING-OWN (found twice over, one place), RING-SLICE,
  // RING-WIDE and RING-BOTH. RING-OUTSIDE is outside and RING-ACROSS is
  // unresolved.
  assert.equal(out.counts.fun, 4, '135 rows for 65 places was the bug');
});

test('a place filed under two categories counts in both', async () => {
  await seed();
  const out = await censusInRing({ cells: [IN], outcodes: OUTCODES });
  assert.equal(out.counts.sport, 1, 'Sport is its own list');
  // And the same place is in Fun's four above: fixing the first double count
  // must not break the second.
  assert.equal(out.counts.fun, 4);
});

test('the ring is sectors, not whole districts', async () => {
  await seed();
  const out = await censusInRing({ cells: [IN], outcodes: OUTCODES });
  // ZR2 is in the candidate districts and not in the ring, so the place there
  // is not counted — the whole point of using the matrix.
  const both = await censusInRing({ cells: [IN, OUT], outcodes: OUTCODES });
  assert.equal(out.counts.fun, 4);
  // Widening to both sectors brings in the one outside *and* resolves the box
  // that used to cross the edge, because now both its ends are in the ring.
  assert.equal(both.counts.fun, 6, 'widening the ring brings them in');
  assert.equal(both.unresolved.fun ?? 0, 0);
});

test('a wide box wholly inside the ring is counted, width and all', async () => {
  await seed();
  const out = await censusInRing({ cells: [IN], outcodes: OUTCODES });
  // RING-WIDE sits in a six-kilometre box, and every corner of it is nearest
  // the ring's own sector. Width was never the question (owner, 20 Sep 2026).
  assert.ok(out.boxes.inside >= 1);
  assert.equal(out.counts.fun, 4);
});

test('a box across the edge is unresolved, and never dropped', async () => {
  await seed();
  const out = await censusInRing({ cells: [IN], outcodes: OUTCODES });
  // RING-ACROSS has a corner by each sector: it is in the ring or it is not,
  // and only a finer census can say. It is carried as unresolved so the count
  // can be shown as a floor rather than silently undercounting.
  assert.equal(out.unresolved.fun, 1);
  assert.equal(out.boxes.across, 1);
});


test('a box under a kilometre is placed by its centre, and a wide one is not', async () => {
  const { whereBoxSits } = await import('../src/repositories/censusRing.js');
  const universe = [{ code: 'A', lat: 51.52, lng: -0.13 }, { code: 'B', lat: 51.52, lng: -0.12 }];
  // A four-hundred-metre box straddling the midline, centre nearer A.
  assert.equal(whereBoxSits({ minLat: 51.518, minLng: -0.129, maxLat: 51.522, maxLng: -0.125 }, { cells: ['A'], universe }), 'inside');
  assert.equal(whereBoxSits({ minLat: 51.518, minLng: -0.129, maxLat: 51.522, maxLng: -0.125 }, { cells: ['B'], universe }), 'outside');
  // The same box with its centre nearer B.
  assert.equal(whereBoxSits({ minLat: 51.518, minLng: -0.124, maxLat: 51.522, maxLng: -0.120 }, { cells: ['A'], universe }), 'outside');
  // A three-kilometre box across both is still on neither side (owner, 25 Sep
  // 2026: "counted in the wrong one of two neighbours is small, counted
  // nowhere is a missing place" — but a box that wide really can be either).
  assert.equal(whereBoxSits({ minLat: 51.505, minLng: -0.15, maxLat: 51.535, maxLng: -0.10 }, { cells: ['A'], universe }), 'across');
});
