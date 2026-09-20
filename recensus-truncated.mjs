/**
 * Re-census only what Google cut off.
 *
 * Ten slices across the thirty-nine-outcode ring were still truncated at the
 * old three-level limit, so ten drawers were reporting a floor as a total. The
 * depth adapts now, so those are the only ones worth asking again — everything
 * else already came back whole and re-asking it would be requests spent to
 * learn nothing.
 */
import { censusArea } from './src/sources/census.js';
import { outcode } from './src/sources/postcodeAreas.js';
import { query } from './src/db.js';
import { CENSUS_MAX_DEPTH } from './src/sources/census.js';

const KM = Number(process.argv[2] || 4);
// Where a slice was still saturated at the *old* limit of three. Read from the
// record rather than a list typed out here, so this finds whatever is actually
// stuck rather than whatever was stuck when it was written.
// Only an area's *latest* run counts. SE1 was cut off at the old limit and has
// since been asked again and answered whole; reading every run ever would send
// us back to re-census what is already settled.
const { rows: stuck } = await query(
  `with latest as (
     select distinct on (area_slug, subcategory) area_slug, subcategory, run_id
       from census_slices where problem is null
      order by area_slug, subcategory, ran_at desc)
   select cs.area_slug, cs.outcode, cs.subcategory,
          count(*)::int slices, max(cs.depth)::int deepest
     from census_slices cs
     join latest l on l.area_slug = cs.area_slug and l.subcategory = cs.subcategory and l.run_id = cs.run_id
    -- **Stuck means saturated at the ceiling**, not saturated anywhere. A slice
    -- Google cut off at depth four that was then split into four tiles which
    -- all answered is resolved, not stuck — its children hold the places. The
    -- first version of this took any saturated slice at depth three or more and
    -- so sent SE1 back for two drawers it had already settled, at a wider box
    -- than the rest of its census (20 Sep 2026).
    where cs.saturated and cs.depth >= $1
    group by 1, 2, 3 order by 1, 3`, [CENSUS_MAX_DEPTH]);

if (!stuck.length) { console.log('\nNothing in the ring is still cut off.'); process.exit(0); }
console.log(`\n${stuck.length} drawer(s) across ${new Set(stuck.map((s) => s.area_slug)).size} outcode(s) were reporting a floor.\n`);
for (const s of stuck) console.log(`  ${(s.outcode ?? s.area_slug).padEnd(6)} ${s.subcategory.padEnd(22)} ${s.slices} slice(s) cut off at depth ${s.deepest}`);

// One run per outcode, asking only the subcategories that were stuck there.
const byArea = new Map();
for (const s of stuck) {
  const hit = byArea.get(s.area_slug) ?? { outcode: s.outcode, subs: [] };
  hit.subs.push(s.subcategory);
  byArea.set(s.area_slug, hit);
}

console.log('\nAsking again, splitting until it answers:\n');
const before = (await query(`select coalesce(sum(estimated_cost_usd),0)::float u from provider_calls where purpose='census.slice'`)).rows[0].u;
let requests = 0; let stillStuck = 0;
for (const [slug, { outcode: code, subs }] of byArea) {
  const o = await outcode(code ?? slug.toUpperCase());
  if (!o) { console.log(`  ${slug}\tno such outcode`); continue; }
  const dLat = KM / 111.32, dLng = KM / (111.32 * Math.cos(o.lat * Math.PI / 180));
  const box = { minLat: o.lat - dLat, minLng: o.lng - dLng, maxLat: o.lat + dLat, maxLng: o.lng + dLng };
  const out = await censusArea({ areaSlug: slug, outcode: code, box, subcategories: [...new Set(subs)] });
  requests += out.requests;
  stillStuck += out.saturated;
  console.log(`  ${(code ?? slug).padEnd(6)} ${String(out.noted).padStart(5)} places  ${String(out.requests).padStart(5)} requests  ${out.saturated ? `${out.saturated} STILL a floor` : 'all answered whole'}`);
}
const after = (await query(`select coalesce(sum(estimated_cost_usd),0)::float u from provider_calls where purpose='census.slice'`)).rows[0].u;

console.log(`\nrequests ${requests} · cost $${(after - before).toFixed(4)}`);
const { rows: [left] } = await query(
  `select count(*)::int n from census_slices cs
     where cs.saturated and cs.depth >= 6
       and cs.ran_at > now() - interval '30 minutes'`);
console.log(`slices still cut off at the six-level ceiling: ${left.n}`);
console.log(left.n ? 'Those drawers keep reading "at least N" on the board, which is the truth.' : 'Every drawer in the ring now reports a total rather than a floor.');
process.exit(0);
