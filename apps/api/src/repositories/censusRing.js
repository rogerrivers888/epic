/**
 * How many places the census knows inside a ring — by slice, not by coordinate.
 *
 * The question the owner asked (20 Sep 2026): "Tell me how a census row can be
 * attributed to a location when 42% of place_index has no coordinates. Does the
 * recorded slice give us a box we can test against the ring? If yes, count by
 * slice."
 *
 * **It does.** The census asks Google inside a rectangle and writes that
 * rectangle on every place it finds — `place_index.slice` is literally
 * `minLat,minLng,maxLat,maxLng`. So a place with no coordinate of its own is
 * still known to be *in that box*, and the box can be tested against the ring.
 * Nothing here reads `place_cells`, which would have thrown away the whole
 * census-only population — the very places the census exists to find.
 *
 * Three rules, and the third is the honest one:
 *
 *   · A place with its own coordinate is placed by it. That is exact.
 *   · A place without one is placed at the centre of its slice. Most slices are
 *     about four hundred metres across, which is well inside a postcode sector.
 *   · A place whose slice is wider than a kilometre is **not counted either
 *     way**. It is reported as uncertain, because a box that big can straddle
 *     the edge of the ring and there is nothing in the row to say which side it
 *     fell. Splitting the saturated slices is what shrinks this number.
 *
 * Counting is `count(distinct venue_ref)` *per category*: one place found by
 * three of a category's drawers is one place (135 rows for 65 places was the
 * bug). Across categories it stays multiple — a place filed under Sport and
 * again under Fun is in both lists, and correctly counts in both.
 */

import { query } from '../db.js';

/** Wider than this and a box can sit on both sides of the ring's edge. */
const TOO_WIDE_M = 1000;

/**
 * @param cells    the ring's own sectors, from the reachability matrix
 * @param outcodes the districts those sectors sit in — the candidate universe
 */
export async function censusInRing({ cells = [], outcodes = [] } = {}) {
  if (!cells.length || !outcodes.length) return { counts: {}, uncertain: {}, placed: { own: 0, slice: 0 }, unplaceable: 0 };
  const slugs = outcodes.map((o) => String(o).toLowerCase());
  const { rows } = await query(`
    with candidates as (
      select ps.category, ps.venue_ref, pi.lat, pi.lng, pi.slice
        from place_subcategories ps
        join place_index pi on pi.venue_ref = ps.venue_ref
       where ps.area_slug = any($1)
    ),
    placed as (
      select c.category, c.venue_ref,
             (c.lat is not null and c.lng is not null) as own,
             coalesce(c.lat, (split_part(c.slice, ',', 1)::float + split_part(c.slice, ',', 3)::float) / 2) as lat,
             coalesce(c.lng, (split_part(c.slice, ',', 2)::float + split_part(c.slice, ',', 4)::float) / 2) as lng,
             case when c.lat is not null then 0
                  when c.slice is null then null
                  else greatest(
                    (split_part(c.slice, ',', 3)::float - split_part(c.slice, ',', 1)::float) * 111320,
                    (split_part(c.slice, ',', 4)::float - split_part(c.slice, ',', 2)::float) * 70000)
             end as box_m
        from candidates c
    ),
    -- The nearest sector we hold, out of the ones these districts are made of.
    -- Bounded on purpose: the universe is the districts the ring touches, so a
    -- place at the rim is compared against the sectors it could plausibly be
    -- in, and never against every cell in the country.
    universe as (
      select g.code, g.lat, g.lng from geo_cells g where lower(g.outcode) = any($1)
    ),
    sited as (
      select p.*, n.code
        from placed p
        left join lateral (
          select u.code from universe u
           order by (u.lat - p.lat) * (u.lat - p.lat) + (u.lng - p.lng) * (u.lng - p.lng)
           limit 1) n on p.lat is not null
    )
    select category,
           count(distinct venue_ref) filter (
             where code = any($2) and (box_m is not null and box_m <= $3)) as inside,
           count(distinct venue_ref) filter (
             where code = any($2) and box_m > $3) as uncertain,
           count(distinct venue_ref) filter (where own) as own,
           count(distinct venue_ref) filter (where not own and box_m is not null) as by_slice,
           count(distinct venue_ref) filter (where lat is null) as nowhere
      from sited
     group by category`, [slugs, cells, TOO_WIDE_M]);

  const counts = {};
  const uncertain = {};
  let own = 0; let bySlice = 0; let unplaceable = 0;
  for (const r of rows) {
    counts[r.category] = Number(r.inside) || 0;
    uncertain[r.category] = Number(r.uncertain) || 0;
    own += Number(r.own) || 0;
    bySlice += Number(r.by_slice) || 0;
    unplaceable += Number(r.nowhere) || 0;
  }
  return { counts, uncertain, placed: { own, slice: bySlice }, unplaceable, tooWideM: TOO_WIDE_M };
}

/**
 * The old arithmetic, kept so a before-and-after can be shown rather than
 * asserted: whole districts, summed over drawers, double counts and all.
 */
export async function censusByOutcodeSum(outcodes = []) {
  if (!outcodes.length) return {};
  const slugs = outcodes.map((o) => String(o).toLowerCase());
  const { rows } = await query(
    `select category, sum(census_count)::int as places
       from area_counts where area_slug = any($1) and category <> ''
      group by category`, [slugs]);
  return Object.fromEntries(rows.map((r) => [r.category, r.places]));
}
