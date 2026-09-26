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

import { query, withTransaction } from '../db.js';
import { currentSpender } from '../context.js';
import { pencePerRequest, requestsStillNeeded } from './researchSweep.js';
import { sourceHasKey, sourceOff } from './index.js';
import * as sweep from './researchSweep.js';

export const PER_CATEGORY = 20;

/**
 * Which facts can disagree at all, and what "the same value" means.
 *
 * Twenty of the first set's seventy-three "disagreements" read (owner, 26 Sep
 * 2026): fourteen were Nominatim's formatted street address beside the
 * venue's own postal address — not the same question, since one answers
 * "what is at this point" and the other "where do I say I am"; seven were
 * the two summaries, which differ by design; seven the same website written
 * four ways; three phone formats; and two genuinely wrong pairings. So the
 * fields that are several answers by nature are not counted, a postcode is
 * only compared between sources that state one rather than derive it, and
 * a website, a phone number and a name are compared as what they name.
 */
const NEVER_A_DISAGREEMENT = ['summary', 'summary_source', 'address', 'image_url', 'attribution'];
const DERIVED_SOURCES = ['nominatim'];
const COMPARABLE = `f.field <> all(array[${NEVER_A_DISAGREEMENT.map((x) => `'${x}'`).join(', ')}]) and not (f.field = 'postcode' and f.source = any(array[${DERIVED_SOURCES.map((x) => `'${x}'`).join(', ')}]))`;

/** A fact's value as text: a list sorted; a site, a number or a name reduced to what it names. */
const SAME_VALUE = `case
    when jsonb_typeof(f.value) = 'array'
      then (select coalesce(jsonb_agg(e order by e::text), '[]'::jsonb) from jsonb_array_elements(f.value) e)::text
    when f.field = 'website'
      then regexp_replace(regexp_replace(regexp_replace(lower(f.value #>> '{}'), '^https?://(www\\.)?', ''), '[?#].*$', ''), '/+$', '')
    when f.field = 'phone'
      -- "+44 (0)20…", "+44 20…" and "020…" are one number (Codex, 26 Sep 2026).
      then regexp_replace(regexp_replace(f.value #>> '{}', '[^0-9]', '', 'g'), '^(440?|0)', '')
    when f.field = 'name'
      then btrim(regexp_replace(regexp_replace(lower(f.value #>> '{}'), '^the ', ''), '[^a-z0-9]+', ' ', 'g'))
    when f.field = 'postcode'
      then upper(regexp_replace(f.value #>> '{}', '\\s+', '', 'g'))
    else f.value::text end`;

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
  ['small', 4, 'a small venue — few reviews on its owned band, or an independent deep in Google\u2019s own ranking'],
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
    with sized as (
      select area_slug, count(*) as n from place_areas group by area_slug
    ), finest as (
      -- A place sits in several areas at once — country, county, town,
      -- outcode — and counting it in all of them made every place dense by
      -- its country and thin by its outcode (Codex, 25 Sep 2026). Each place
      -- is put in the smallest area it belongs to, and density is that.
      select distinct on (a.venue_ref) a.venue_ref, a.area_slug, z.n as area_places
        from place_areas a join sized z on z.area_slug = a.area_slug
       order by a.venue_ref, z.n asc, a.area_slug
    ), cand as (
      select p.venue_ref, s.category_key as category, p.subcategory, p.found_rank,
             r.name, r.lat, r.epic_score, r.website, r.summary, r.matched, r.count_band,
             f.area_slug, f.area_places
        from place_index p
        join shelf_subcategories s on s.key = p.subcategory and s.active
        left join place_records r on r.venue_ref = p.venue_ref
        left join finest f on f.venue_ref = p.venue_ref
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
           c.found_rank, c.count_band,
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
    if (bucket === 'small') {
      // Small means small — a modest venue — never the lowest score, which
      // selects for the badly described (owner, 25 Sep 2026). The owned
      // band of the review count says it directly where we hold one ('few');
      // failing that, an independent — no shared website host — deep in
      // Google's own ranking of its drawer.
      const few = identified.filter((r) => r.count_band === 'few').sort(byScore);
      take(few, n, bucket);
      const still = n - picks.filter((p) => p.picked_for === bucket).length;
      if (still > 0) {
        const independentDeep = identified
          .filter((r) => !r.chain && r.found_rank != null)
          .sort((a, b) => b.found_rank - a.found_rank || a.venue_ref.localeCompare(b.venue_ref));
        take(independentDeep, still, bucket);
      }
    }
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
export async function propose({ perCategory = PER_CATEGORY, categories = null } = {}) {
  const rows = await candidates();
  const { rows: cats } = await query(
    `select key, label from shelf_categories where active ${categories?.length ? 'and key = any($1)' : ''} order by position, key`,
    categories?.length ? [categories] : []);
  // A key that is not a live category is refused, not skipped: a typo beside
  // a real key would otherwise start a set short of the category asked for
  // (Codex, 25 Sep 2026).
  const missing = (categories ?? []).filter((k) => !cats.some((c) => c.key === k));
  if (missing.length) {
    throw Object.assign(new Error(`Not a category, or not active: ${missing.join(', ')}.`), { code: 'unknown_category', status: 409 });
  }
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
export async function estimate({ perCategory = PER_CATEGORY, categories: only = null } = {}) {
  const categories = await propose({ perCategory, categories: only });
  const all = categories.flatMap((c) => c.picks.map((p) => ({ ...p, category: c.category })));
  const refs = all.map((p) => p.venue_ref);
  // What each may still cost from what we hold: two to identify an id, one
  // for the website lead where we have a name and point but no site, nought
  // otherwise (Codex, 25 Sep 2026).
  const still = await requestsStillNeeded(refs);
  const counts = [...still.values()];
  const requests = counts.reduce((n, c) => n + c, 0);
  const toIdentify = counts.filter((c) => c === 2).length;
  const toFindPage = counts.filter((c) => c === 1).length;
  const free = counts.filter((c) => c === 0).length;
  const pence = pencePerRequest();
  return {
    categories,
    places: all.length,
    free,
    toIdentify,
    toFindPage,
    requests,
    pencePerRequest: pence,
    costGbpLow: Math.round((toIdentify + toFindPage) * pence) / 100,
    costGbpHigh: Math.round(requests * pence) / 100,
    basis: `${categories.length} categories × ${perCategory} · ${free} cost nothing · `
      + `${toIdentify} Google places to identify (two requests) · ${toFindPage} known but without a website (one, the page lead) · `
      + `${pence}p a request · everything else — the venue's page, OSM, Wikipedia, Wikidata, FSA — is free`,
    byBucket: Object.fromEntries(BUCKETS.map(([b]) => [b, all.filter((p) => p.picked_for === b).length])),
  };
}

/** Start it: a research sweep in reference mode, with the chosen places written down and why. */
export async function start({ perCategory = PER_CATEGORY, categories = null, confirm = null, householdId = null, startedBy = null, startedSessionId = null } = {}) {
  const plan = await estimate({ perCategory, categories });
  if (Number(confirm) !== plan.requests) {
    const err = new Error(`This set is ${plan.places} places, up to ${plan.requests} Google requests at £${plan.costGbpLow.toFixed(2)}–£${plan.costGbpHigh.toFixed(2)}. Confirm with ${plan.requests} to run it.`);
    err.code = 'confirm_required'; err.status = 409; err.plan = plan;
    throw err;
  }
  if (!householdId) throw Object.assign(new Error('A reference set is run by a signed-in household.'), { code: 'no_household', status: 409 });
  // Twenty a category is the set's shape, not a ceiling. A category the
  // census has not reached yet would have started a smaller set that still
  // called itself the reference set (Codex, 25 Sep 2026).
  const short = plan.categories.filter((c) => c.picks.length < perCategory);
  if (short.length) {
    throw Object.assign(
      new Error(`Not every category has ${perCategory} places to choose from yet: ${short.map((c) => `${c.category} (${c.picks.length})`).join(', ')}.`),
      { code: 'short_category', status: 409, plan });
  }
  if (plan.requests > 0 && (!sourceHasKey('google') || sourceOff('google'))) {
    // Refused at the door rather than accepted and failed by the worker, the
    // same as the sample sweep (Codex, 25 Sep 2026).
    throw Object.assign(new Error(`${plan.toIdentify + plan.toFindPage} of these places need Google, which is ${sourceOff('google') ? 'switched off in Settings' : 'not configured'}.`),
      { code: 'google_unavailable', status: 409, plan });
  }
  const all = plan.categories.flatMap((c) => c.picks.map((p) => ({ ...p, category: c.category })));
  return withTransaction(async (client) => {
    // One sweep at a time, of either kind — the same lock and the same check
    // as the sample sweep, because they share Overpass's patience and the
    // ceiling (Codex, 25 Sep 2026).
    await client.query('select pg_advisory_xact_lock(hashtext($1))', ['epic.research_sweep.start']);
    const { rows: going } = await client.query(`select id from research_sweeps where state = 'running' limit 1`);
    if (going.length) {
      throw Object.assign(new Error('A sweep is already running. Wait for it, or it will be picked up if it has stalled.'),
        { code: 'already_running', status: 409, sweep: going[0].id });
    }
    const { rows: [row] } = await client.query(
      `insert into research_sweeps (subcategories, params, household_id, started_by, places, started_session_id)
       values ($1, $2, $3, $4, $5, $6) returning *`,
      [JSON.stringify([...new Set(all.map((p) => p.subcategory))]),
        JSON.stringify({ mode: 'reference', perCategory, requests: plan.requests, estimateGbp: plan.costGbpHigh, byBucket: plan.byBucket }),
        householdId, startedBy, all.length,
        // Whose decision the spend is: the caller's word, else the request
        // starting it, so a resume after a deploy still names the person
        // rather than the server (Codex, 26 Sep 2026).
        startedSessionId ?? currentSpender().sessionId ?? null]);
    for (const p of all) {
      await client.query(
        `insert into research_sweep_places (sweep_id, venue_ref, subcategory, tier, picked_for)
         values ($1, $2, $3, 'top', $4) on conflict do nothing`,
        [row.id, p.venue_ref, p.subcategory, p.picked_for]);
    }
    return row;
  });
}

/** Everything a place in the set now holds, with where each fact came from — for reading the set, not the screen. */
export async function held(id) {
  const { rows } = await query(
    `select p.venue_ref, p.subcategory, p.picked_for, p.state, p.outcome,
            r.name, r.website, r.fsa_rating, r.provenance,
            (select count(*) from place_facts f where f.venue_ref = p.venue_ref and f.expires_at is null)::int as facts,
            (select count(distinct source) from place_facts f where f.venue_ref = p.venue_ref and f.expires_at is null)::int as sources,
            (select count(*) from (
               select field from place_facts f where f.venue_ref = p.venue_ref and f.expires_at is null and ${COMPARABLE}
               group by field having count(distinct source) > 1 and count(distinct ${SAME_VALUE}) > 1) x)::int as disagreements
       from research_sweep_places p
       left join place_records r on r.venue_ref = p.venue_ref
      where p.sweep_id = $1
      order by p.subcategory, p.picked_for, p.venue_ref`,
    [id]);
  return rows;
}

/**
 * The facts behind the disagreements, for reading twenty of them.
 *
 * Owner, 26 Sep 2026: "73 of 160 is 46%, which is far too high to be real
 * conflict between a venue's own page and OSM. Sample twenty and tell me
 * whether the matcher is pairing the wrong records or two sources are being
 * compared on fields that are not the same question." Every field two owned
 * sources hold different values for, with both values and the record's
 * matched refs beside them.
 */
export async function disagreements(id, { limit = 20 } = {}) {
  const { rows } = await query(
    `with mine as (
       select p.venue_ref, p.subcategory, p.picked_for, r.name, r.matched
         from research_sweep_places p left join place_records r on r.venue_ref = p.venue_ref
        where p.sweep_id = $1
     ), differing as (
       select f.venue_ref, f.field, jsonb_object_agg(f.source, f.value) as values
         from place_facts f join mine m on m.venue_ref = f.venue_ref
        where f.expires_at is null and ${COMPARABLE}
        group by f.venue_ref, f.field
       -- A list is the same list in any order: two sources agreeing on
       -- "italian, pizza" and "pizza, italian" are not disagreeing
       -- (Codex, 26 Sep 2026).
       having count(distinct f.source) > 1 and count(distinct ${SAME_VALUE}) > 1
     )
     select m.venue_ref, m.subcategory, m.picked_for, m.name, m.matched,
            jsonb_object_agg(d.field, d.values) as fields
       from differing d join mine m on m.venue_ref = d.venue_ref
      group by 1, 2, 3, 4, 5
      order by m.venue_ref
      limit $2`,
    [id, limit]);
  return rows;
}

export { sweep };
