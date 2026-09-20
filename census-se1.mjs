/**
 * SE1 — the density test.
 *
 * Owner, 20 Sep 2026: "SE1 as the density test: splits per slice, depth, and
 * any slice that can't get under 60 after two splits."
 *
 * Ascot answered almost everything in one ask. Central London is the other end
 * of the range: a single query for "restaurant" inside SE1 will hit Google's
 * sixty-place ceiling and keep hitting it in each quarter it is cut into. That
 * is the case the whole splitting design exists for, and the number worth
 * knowing is how deep it has to go before a slice comes back under the ceiling
 * — because a slice still saturated at the bottom is a count that is a floor
 * rather than a total, and the board has to say so.
 *
 * A tighter box than the ring's four kilometres: SE1 is about two and a half
 * across, and a four-kilometre box around its centre is most of central London
 * rather than the outcode.
 */
import { censusArea } from './src/sources/census.js';
import { outcode } from './src/sources/postcodeAreas.js';
import { query } from './src/db.js';

const CODE = (process.argv[2] || 'SE1').toUpperCase();
const KM = Number(process.argv[3] || 2.5);
const slug = CODE.toLowerCase();

const o = await outcode(CODE);
if (!o) { console.log(`no such outcode: ${CODE}`); process.exit(1); }
const dLat = KM / 111.32, dLng = KM / (111.32 * Math.cos(o.lat * Math.PI / 180));
const box = { minLat: o.lat - dLat, minLng: o.lng - dLng, maxLat: o.lat + dLat, maxLng: o.lng + dLng };

console.log(`\n${CODE} — ${o.lat.toFixed(4)}, ${o.lng.toFixed(4)}, ${KM} km box\n${o.districts}\n`);
const before = (await query(`select coalesce(sum(estimated_cost_usd),0)::float u from provider_calls`)).rows[0].u;
const t0 = Date.now();

const out = await censusArea({
  areaSlug: slug, outcode: CODE, box,
  onProgress: ({ subcategory, found, requests }) =>
    process.stdout.write(`\r  ${subcategory.padEnd(22)} ${String(found).padStart(5)} places  ${String(requests).padStart(5)} requests   `),
});

const after = (await query(`select coalesce(sum(estimated_cost_usd),0)::float u from provider_calls`)).rows[0].u;
console.log(`\n\nplanned ${out.plan} · completed ${out.completed} · slices ${out.slices} · requests ${out.requests} · ${Math.round((Date.now() - t0) / 60000)}m`);
console.log(`unique places ${out.noted} · surfacings ${out.surfacings} · cost $${(after - before).toFixed(4)}`);
if (out.refused) console.log(`REFUSED: ${out.refused}`);

// --- The splitting, which is the point of this run.
const { rows: byDepth } = await query(
  `select depth, count(*)::int slices, count(*) filter (where saturated)::int saturated,
          round(avg(returned)::numeric, 1) avg_returned, sum(requests)::int requests
     from census_slices where area_slug = $1 and run_id = $2 group by 1 order by 1`,
  [slug, out.runId]);
console.log(`\nSPLITS BY DEPTH  (depth 0 is the whole box; each level is a quarter of the one above)`);
console.log('  depth  slices  saturated  avg returned  requests');
for (const r of byDepth) {
  console.log(`  ${String(r.depth).padStart(5)}  ${String(r.slices).padStart(6)}  ${String(r.saturated).padStart(9)}  ${String(r.avg_returned).padStart(12)}  ${String(r.requests).padStart(8)}`);
}

// Which questions had to be split at all, and how far.
const { rows: worst } = await query(
  `select subcategory, google_type,
          max(depth)::int deepest,
          count(*)::int slices,
          count(*) filter (where saturated and depth >= 2)::int stuck
     from census_slices where area_slug = $1 and run_id = $2
     group by 1, 2 having max(depth) > 0
     order by stuck desc, deepest desc, slices desc limit 20`,
  [slug, out.runId]);
console.log(`\nQUESTIONS THAT HAD TO BE CUT UP  (${worst.length} of them)`);
console.log('  subcategory / type'.padEnd(46), 'deepest  slices  still cut off at depth 2+');
for (const r of worst) {
  console.log(`  ${(r.subcategory + ' / ' + r.google_type).slice(0, 42).padEnd(44)} ${String(r.deepest).padStart(7)} ${String(r.slices).padStart(7)} ${String(r.stuck).padStart(9)}`);
}

// The answer to his actual question.
// The ceiling is read from the code rather than typed here: it was three when
// this was written and is six now, and a threshold left behind reports
// saturation at depth three as "at the limit", which is simply false.
const { MAX_DEPTH_FOR_REPORT } = await import('./src/sources/census.js')
  .then((m) => ({ MAX_DEPTH_FOR_REPORT: m.CENSUS_MAX_DEPTH }));
const { rows: [stuck] } = await query(
  `select count(*)::int n from census_slices
    where area_slug = $1 and run_id = $2 and saturated and depth >= 2`, [slug, out.runId]);
const { rows: [floor] } = await query(
  `select count(*)::int n from census_slices
    where area_slug = $1 and run_id = $2 and saturated and depth >= $3`, [slug, out.runId, MAX_DEPTH_FOR_REPORT]);
const { rows: [deep] } = await query(
  `select coalesce(max(depth), 0)::int n from census_slices where area_slug = $1 and run_id = $2`, [slug, out.runId]);
console.log(`\nSLICES STILL CUT OFF AFTER TWO SPLITS: ${stuck.n}`);
console.log(`DEEPEST SPLIT REACHED: ${deep.n} of a ceiling of ${MAX_DEPTH_FOR_REPORT}`);
console.log(`STILL CUT OFF AT THE CEILING: ${floor.n}  ${floor.n ? "— these counts are a floor, not a total" : '— every count here is a total'}`);

const { rows: counts } = await query(
  `select category, subcategory, census_count filed, coalesce(surfaced_count,0) surfaced, saturated
     from area_counts where area_slug = $1 and coalesce(surfaced_count,0) > 0
     order by coalesce(surfaced_count,0) desc limit 20`, [slug]);
console.log(`\nTOP DRAWERS IN ${CODE}`);
console.log('  category/subcategory'.padEnd(36), 'found  filed  cut off');
for (const r of counts) {
  console.log(`  ${(r.category + '/' + r.subcategory).padEnd(34)} ${String(r.surfaced).padStart(5)} ${String(r.filed).padStart(6)} ${String(r.saturated).padStart(8)}`);
}
process.exit(0);
