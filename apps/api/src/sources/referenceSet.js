/**
 * The deep reference set: twenty places a category, chosen on purpose.
 *
 * The owner, 25 Sep 2026: "180 places, 20 per category. These get researched
 * exhaustively rather than sampled — every fact the owned sources hold, stored
 * permanently with provenance, from the venue's own page, Wikipedia, Wikidata,
 * OSM and FSA. Nothing rented is stored, as ever." Threefold: the corpus the
 * extractor needs, the fixture every demo and screen is built against, and
 * the first end-to-end test of the chain.
 *
 * "Pick the 180 to cover the range deliberately rather than at random — dense
 * and thin areas, big commercial venues and small ones, and at least two
 * places where sources are likely to disagree so the unresolved state gets
 * exercised." So each category's twenty are taken in named buckets, and the
 * reason a place is in the set is written beside it (`picked_for`).
 *
 * It runs as a research sweep in `reference` mode (`researchSweep.js`): the
 * same row-and-list shape that survives a deploy, the same ceiling, the same
 * confirm-with-the-number gate. What differs is the research — everything,
 * again, and kept — and that the places were chosen rather than sampled.
 */

import { query } from '../db.js';
import { pencePerRequest, needsGoogle, REQUESTS_PER_PLACE } from './researchSweep.js';
import * as sweep from './researchSweep.js';

export const PER_CATEGORY = 20;

/**
 * The buckets, how many each takes, and the order they are filled in.
 *
 * Scarcest first. A place where two sources already disagree is rare and is
 * also, often, near the top of a busy drawer — filled last it had already
 * been taken as "dense", and the bucket the set exists to exercise came back
 * empty (found in the test, 25 Sep 2026).
 */
export const BUCKETS = [
  ['disagree', 2, 'two owned sources already say different things about it'],
  ['chain', 4, 'a big commercial venue — a website shared by three or more places'],
  ['thin', 4, 'a thin area, the best it has'],
  ['small', 4, 'a small venue — identified, low in the ranking'],
  ['dense', 6, 'a busy area, near the top of its drawer'],
];

/**
 * Everything the picker can choose from, in one read.
 *
 * `area_places` is how busy the place's area is; `chain` is whether its
 * website's host is shared by three or more places; `disagrees` is whether two
 * owned sources already hold different values for its name or website.
 */
async function candidates() {
  const { rows } = await query(`
    with cand as (
      select p.venue_ref, s.category_key as category, p.subcategory,
             r.name, r.lat, r.epic_score, r.website, r.summary, r.matched,
             a.area_slug,
             count(*) over (partition by a.area_slug) as area_places
        from place_index p
        join shelf_subcategories s on s.key = p.subcategory and s.active
        left join place_records r on r.venue_ref = p.venue_ref
        left join place_areas a on a.venue_ref = p.venue_ref
    ), hosts as (
      select venue_ref, regexp_replace(lower(website), '^https?://(www\\.)?([^/]+).*$', '\\2') as host
        from place_records where website is not null
    ), chains as (
      select host from hosts group by host having count(*) >= 3
    ), disagree as (
      select venue_ref from place_facts
       where field in ('name', 'website') and expires_at is null
       group by venue_ref, field
      having count(distinct source) > 1 and count(distinct value::text) > 1
    )
    select c.venue_ref, c.category, c.subcategory, c.name, c.lat, c.epic_score, c.website, c.area_slug,
           c.area_places::int as area_places,
           (ch.host is not null) as chain,
           (d.venue_ref is not null) as disagrees,
           (c.matched ? 'osm' and c.matched ? 'wikipedia') as matched_twice
      from cand c
      left join hosts h on h.venue_ref = c.venue_ref
      left join chains ch on ch.host = h.host
      left join (select distinct venue_ref from disagree) d on d.venue_ref = c.venue_ref
     order by c.category, c.epic_score desc nulls last, c.venue_ref`);
  return rows;
}

const byScore = (a, b) => (b.epic_score ?? -1) - (a.epic_score ?? -1) || a.venue_ref.localeCompare(b.venue_ref);

/** Quartile edges of the distinct areas' sizes, so dense and thin mean something in this category. */
function areaEdges(rows) {
  const sizes = [...new Map(rows.filter((r) => r.area_slug).map((r) => [r.area_slug, r.area_places])).values()].sort((a, b) => a - b);
  if (!sizes.length) return { dense: Infinity, thin: -Infinity };
  return { dense: sizes[Math.floor(sizes.length * 0.75)], thin: sizes[Math.floor(sizes.length * 0.25)] };
}

/** One category's twenty, bucket by bucket, each place once. */
export function chooseFor(rows, { perCategory = PER_CATEGORY } = {}) {
  const taken = new Set();
  const picks = [];
  const take = (list, n, why) => {
    for (const r of list) {
      if (picks.length >= perCategory || n <= 0) break;
      if (taken.has(r.venue_ref)) continue;
      taken.add(r.venue_ref);
      picks.push({ venue_ref: r.venue_ref, subcategory: r.subcategory, name: r.name, picked_for: why });
      n -= 1;
    }
  };
  const { dense, thin } = areaEdges(rows);
  const identified = rows.filter((r) => r.name && r.lat != null);
  for (const [bucket, n] of BUCKETS) {
    if (bucket === 'dense') take(rows.filter((r) => r.area_places >= dense).sort(byScore), n, bucket);
    if (bucket === 'thin') take(rows.filter((r) => r.area_slug && r.area_places <= thin).sort(byScore), n, bucket);
    if (bucket === 'chain') take(rows.filter((r) => r.chain).sort(byScore), n, bucket);
    if (bucket === 'small') take(identified.filter((r) => r.epic_score != null).sort((a, b) => a.epic_score - b.epic_score || a.venue_ref.localeCompare(b.venue_ref)), n, bucket);
    if (bucket === 'disagree') {
      // Where two sources already differ; failing that, where two sources
      // both matched, which is where a disagreement is likeliest to turn up.
      take(rows.filter((r) => r.disagrees).sort(byScore), n, bucket);
      const still = n - picks.filter((p) => p.picked_for === bucket).length;
      if (still > 0) take(rows.filter((r) => r.matched_twice).sort(byScore), still, 'disagree?');
    }
  }
  take([...rows].sort(byScore), perCategory - picks.length, 'top');
  return picks;
}

/** The whole set, category by category, with the reasons. */
export async function propose({ perCategory = PER_CATEGORY } = {}) {
  const rows = await candidates();
  const { rows: cats } = await query('select key, label from shelf_categories where active order by position, key');
  const out = [];
  for (const c of cats) {
    const mine = rows.filter((r) => r.category === c.key);
    const picks = chooseFor(mine, { perCategory });
    out.push({ category: c.key, label: c.label, candidates: mine.length, picks });
  }
  return out;
}

/**
 * What it would cost. Free for a place we already hold a name and a point
 * for — the seed goes in and Google is never asked — and up to two Place
 * Details requests for a Google place we know only as an id.
 */
export async function estimate({ perCategory = PER_CATEGORY } = {}) {
  const categories = await propose({ perCategory });
  const all = categories.flatMap((c) => c.picks.map((p) => ({ ...p, category: c.category })));
  const refs = all.map((p) => p.venue_ref);
  const { rows } = refs.length
    ? await query('select venue_ref from place_records where venue_ref = any($1) and name is not null and lat is not null', [refs])
    : { rows: [] };
  const seeded = new Set(rows.map((r) => r.venue_ref));
  const toIdentify = all.filter((p) => !seeded.has(p.venue_ref) && needsGoogle(p.venue_ref));
  const pence = pencePerRequest();
  const requests = toIdentify.length * REQUESTS_PER_PLACE;
  return {
    categories,
    places: all.length,
    seeded: seeded.size,
    toIdentify: toIdentify.length,
    requests,
    pencePerRequest: pence,
    costGbpLow: Math.round(toIdentify.length * pence) / 100,
    costGbpHigh: Math.round(requests * pence) / 100,
    basis: `${categories.length} categories × ${perCategory} · ${seeded.size} already identified and free · `
      + `${toIdentify.length} Google places to identify at up to ${REQUESTS_PER_PLACE} requests (${pence}p) · everything else — the venue's page, OSM, Wikipedia, Wikidata, FSA — is free`,
    byBucket: Object.fromEntries(BUCKETS.map(([b]) => [b, all.filter((p) => p.picked_for === b).length])),
  };
}

/** Start it: a research sweep in reference mode, with the chosen places written down and why. */
export async function start({ perCategory = PER_CATEGORY, confirm = null, householdId = null, startedBy = null } = {}) {
  const plan = await estimate({ perCategory });
  if (Number(confirm) !== plan.requests) {
    const err = new Error(`This set is ${plan.places} places, up to ${plan.requests} Google requests at £${plan.costGbpLow.toFixed(2)}–£${plan.costGbpHigh.toFixed(2)}. Confirm with ${plan.requests} to run it.`);
    err.code = 'confirm_required'; err.status = 409; err.plan = plan;
    throw err;
  }
  if (!householdId) throw Object.assign(new Error('A reference set is run by a signed-in household.'), { code: 'no_household', status: 409 });
  const all = plan.categories.flatMap((c) => c.picks.map((p) => ({ ...p, category: c.category })));
  const { rows: [row] } = await query(
    `insert into research_sweeps (subcategories, params, household_id, started_by, places)
     values ($1, $2, $3, $4, $5) returning *`,
    [JSON.stringify([...new Set(all.map((p) => p.subcategory))]),
      JSON.stringify({ mode: 'reference', perCategory, requests: plan.requests, estimateGbp: plan.costGbpHigh, byBucket: plan.byBucket }),
      householdId, startedBy, all.length]);
  for (const p of all) {
    await query(
      `insert into research_sweep_places (sweep_id, venue_ref, subcategory, tier, picked_for)
       values ($1, $2, $3, 'top', $4) on conflict do nothing`,
      [row.id, p.venue_ref, p.subcategory, p.picked_for]);
  }
  return row;
}

/** Everything a place in the set now holds, with where each fact came from — for reading the set, not the screen. */
export async function held(id) {
  const { rows } = await query(
    `select p.venue_ref, p.subcategory, p.picked_for, p.state, p.outcome,
            r.name, r.website, r.fsa_rating, r.provenance,
            (select count(*) from place_facts f where f.venue_ref = p.venue_ref and f.expires_at is null)::int as facts,
            (select count(distinct source) from place_facts f where f.venue_ref = p.venue_ref and f.expires_at is null)::int as sources,
            (select count(*) from (
               select field from place_facts f where f.venue_ref = p.venue_ref and f.expires_at is null and f.field in ('name','website','phone','postcode','opening_hours')
               group by field having count(distinct value::text) > 1) x)::int as disagreements
       from research_sweep_places p
       left join place_records r on r.venue_ref = p.venue_ref
      where p.sweep_id = $1
      order by p.subcategory, p.picked_for, p.venue_ref`,
    [id]);
  return rows;
}

export { sweep };
