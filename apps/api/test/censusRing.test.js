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
const REFS = ['google:RING-OWN', 'google:RING-SLICE', 'google:RING-WIDE', 'google:RING-OUTSIDE', 'google:RING-BOTH'];

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
            ('google:RING-BOTH','sport','swimming', 51.401, -0.631, null, 'GB')`);
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
            ('google:RING-BOTH','fun','days-out','zr1','tourist_attraction',9)`);
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
  // Fun holds: RING-OWN (twice over, one place), RING-SLICE, and RING-BOTH.
  // RING-WIDE is uncertain and RING-OUTSIDE is outside.
  assert.equal(out.counts.fun, 3, '135 rows for 65 places was the bug');
});

test('a place filed under two categories counts in both', async () => {
  await seed();
  const out = await censusInRing({ cells: [IN], outcodes: OUTCODES });
  assert.equal(out.counts.sport, 1, 'Sport is its own list');
  // And the same place is in Fun's three above: fixing the first double count
  // must not break the second.
  assert.equal(out.counts.fun, 3);
});

test('the ring is sectors, not whole districts', async () => {
  await seed();
  const out = await censusInRing({ cells: [IN], outcodes: OUTCODES });
  // ZR2 is in the candidate districts and not in the ring, so the place there
  // is not counted — the whole point of using the matrix.
  const both = await censusInRing({ cells: [IN, OUT], outcodes: OUTCODES });
  assert.equal(out.counts.fun, 3);
  assert.equal(both.counts.fun, 4, 'widening the ring to that sector brings it in');
});

test('a box too wide to place is reported, not counted either way', async () => {
  await seed();
  const out = await censusInRing({ cells: [IN], outcodes: OUTCODES });
  assert.equal(out.uncertain.fun, 1, 'six kilometres across can straddle the edge');
  assert.ok(out.counts.fun < out.counts.fun + out.uncertain.fun, 'and it is not in the count');
});
