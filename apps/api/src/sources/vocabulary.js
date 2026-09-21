/**
 * The vocabulary harvest: where the questions come from.
 *
 * Brief: "Epic — Question sets and the vocabulary harvest", 20 September 2026.
 *
 * Epic reads what is written about places of a kind, counts which words recur,
 * and offers them to a human to promote. Nothing here decides anything — it
 * raises words with a count beside them, and "lockers 19 of 20" against "wave
 * machine 2 of 20" is what makes materiality obvious at a glance.
 *
 * **The rule this module is built around, and the reason it is two passes:**
 *
 *   Google may raise a candidate word. Google may never answer a question
 *   about a place.
 *
 * So the Google pass reads review summaries **in memory**, extracts normalised
 * phrases, counts them, and throws the text away — no raw field, no debug
 * dump, no log line that contains a summary. Nothing it sees is written
 * against a place. Answering a question, later and elsewhere, is the owned
 * sources' job: the venue's own page, the open map, the encyclopedias.
 *
 * And the two passes are deliberately unequal:
 *
 *   · **The free sweep** — what we already hold, plus the open map, the
 *     venue's page and the encyclopedias. It costs nothing, it can be
 *     scheduled, it can be repeated, and it runs first, because it may make
 *     the paid pass smaller.
 *   · **The Google pass** — one Text Search per subcategory per region,
 *     twenty places' worth of writing for one request. It is the one that
 *     costs money, so it will not run without being told to in as many words.
 */

import { z } from 'zod/v4';
import { query } from '../db.js';
import { MODEL, parseStructured } from '../claude.js';
import { googleSource } from './google.js';
import { placeTags } from './inside.js';
import * as providerCalls from '../repositories/providerCalls.js';
import * as sets from '../repositories/questionSets.js';
import { PRICE_PER_UNIT_USD, USD_TO_GBP } from '../domain/providerPrices.js';
import {
  ENRICH_AFTER, REGIONS, SAMPLE, candidatesFor, enrichmentOn, normalise, pickSample, regionOfArea,
  saturation, spreadByRegion,
} from '../domain/questions.js';

/**
 * The ceiling on one Google run, so a mistake costs a known amount.
 *
 * Not a budget — a budget is discovered afterwards. This is the number of
 * requests the run refuses to go past, and it is deliberately close to the
 * plan: fifty-two subcategories in five regions is 260.
 */
export const MAX_GOOGLE_REQUESTS = Number(process.env.EPIC_HARVEST_MAX_REQUESTS || 300);

/** What one Text Search with a review summary costs at list price, in pounds. */
export const COST_PER_REQUEST_GBP = PRICE_PER_UNIT_USD['google-search'] * USD_TO_GBP;

// ---------------------------------------------------------------------------
// the sample
// ---------------------------------------------------------------------------

/**
 * Twenty places of one kind, twelve top and eight mid-tail, spread across the
 * regions Epic holds anything in.
 *
 * Ordered by the Epic score, which is ours: we hold no review count of our
 * own and are not allowed to, and the score is derived from Google's rating
 * and review count along with our own signals. Where a place has no score yet,
 * the rank the census saw it at stands in — Google's own ordering, which is
 * the same signal one step cruder.
 */
export async function sampleFor(subcategory, { size = SAMPLE.top + SAMPLE.mid } = {}) {
  const { rows } = await query(
    `select p.venue_ref, p.subcategory, p.lat, p.lng,
            coalesce(e.score, 0) as score,
            p.found_rank,
            (select array_agg(a.area_slug) from place_areas a where a.venue_ref = p.venue_ref) as areas
       from place_index p
       left join epic_scores e on e.venue_ref = p.venue_ref
      where p.subcategory = $1
      order by coalesce(e.score, 0) desc, p.found_rank nulls last, p.venue_ref`,
    [subcategory],
  );
  const ranked = rows.map((r) => ({
    ...r,
    region: (r.areas ?? []).map(regionOfArea).find(Boolean) ?? 'elsewhere',
  }));
  // Rank first, then spread: the ordering is what makes top and mid-tail mean
  // something, and the spread is what stops one county owning the sample.
  const chosen = pickSample(ranked, { top: SAMPLE.top, mid: SAMPLE.mid });
  const spread = spreadByRegion(chosen, Math.min(size, chosen.length));
  return {
    places: spread,
    held: ranked.length,
    regions: [...new Set(spread.map((p) => p.region))],
  };
}

/** Every subcategory that has any places at all, which is every one worth harvesting. */
export async function harvestable({ subcategories = null } = {}) {
  const { rows } = await query(
    `select s.key, s.label, s.category_key as category, count(p.venue_ref) as places
       from shelf_subcategories s
       left join place_index p on p.subcategory = s.key
      where s.active ${subcategories?.length ? 'and s.key = any($1)' : ''}
      group by 1, 2, 3
      having count(p.venue_ref) > 0
      order by count(p.venue_ref) desc`,
    subcategories?.length ? [subcategories] : [],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// the free sweep
// ---------------------------------------------------------------------------

/** Facts that say *which* place it is rather than *what* it is like. */
const NOT_VOCABULARY = new Set([
  'name', 'address', 'postcode', 'phone', 'email', 'website', 'menu_url', 'booking_url',
  'lat', 'lng', 'image_url', 'wikidata_id', 'wikipedia_url', 'osm_ref', 'socials',
]);

/**
 * Everything free we already hold about one place, as text and tags.
 *
 * No call is made for any of this: `place_facts` is what `sources/own.js`
 * researched when a household claimed the place, `place_records` is what it
 * composed from those facts, and `attractions` is the atlas. All three are
 * licensed for us to keep, which is exactly why they are the material a
 * harvest may sweep in bulk.
 */
export async function heldTextFor(venueRef) {
  const texts = [];
  let tags = null;
  const [facts, record, atlas] = await Promise.all([
    query('select field, source, value from place_facts where venue_ref = $1', [venueRef]),
    query('select summary, cuisines, experiences, dietary_options, accessibility, category from place_records where venue_ref = $1', [venueRef]),
    // An atlas place is in the index under its own id (`atlas:<uuid>`) and in
    // `attractions` under that id, while `attractions.venue_ref` is where it
    // was *matched* to a provider. Both ways in, or half the atlas — which is
    // the encyclopedia text, the richest free material there is — would have
    // been invisible to the sweep.
    query(
      `select summary, kinds, category from attractions
        where venue_ref = $1 or ('atlas:' || id::text) = $1`, [venueRef],
    ),
  ]);
  for (const f of facts.rows) {
    if (f.field === 'tags' && f.source === 'osm') { tags = f.value ?? null; continue; }
    // A fact that identifies the place rather than describing it teaches no
    // vocabulary: an address is a postcode and a street name, a phone number is
    // a number, and neither is a thing a question could be asked about.
    if (NOT_VOCABULARY.has(f.field)) continue;
    const words = wordsIn(f.value);
    if (words) texts.push({ source: f.source === 'nominatim' ? 'osm' : f.source, text: words });
  }
  const r = record.rows[0];
  if (r) {
    const bits = [r.summary, ...listOf(r.cuisines), ...listOf(r.experiences), ...listOf(r.dietary_options),
      ...Object.keys(r.accessibility ?? {}).map(keyWords)];
    texts.push({ source: 'site', text: bits.filter(Boolean).join('. ') });
  }
  const a = atlas.rows[0];
  if (a) texts.push({ source: 'wikipedia', text: [a.summary, ...(a.kinds ?? [])].filter(Boolean).join('. ') });
  return { texts: texts.filter((t) => t.text), tags };
}

/**
 * A key as the words it is made of.
 *
 * Our own facts are written in three conventions at once — `step_free` in a
 * tag, `wheelchair:toilet` in another, `stepFree` in the JSON `own.js`
 * composes — and only the first two were being split. So the first sweep
 * raised `stepfree` and `wheelchairtoilet` as *new* words, when `step-free` is
 * already one of our labels and already a global question. The alias table
 * exists to stop exactly that duplicate, and it could not do its job on a word
 * whose spaces had been eaten (found in the live queue, 20 Sep 2026).
 */
const keyWords = (k) => String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_:.-]+/g, ' ');

/** A fact's value as words, whatever shape it was stored in. Numbers and URLs say nothing. */
function wordsIn(value) {
  if (value == null) return '';
  if (typeof value === 'string') return /^https?:\/\//.test(value) ? '' : value;
  if (typeof value === 'number' || typeof value === 'boolean') return '';
  if (Array.isArray(value)) return value.map(wordsIn).filter(Boolean).join('. ');
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([k, v]) => (v === true ? keyWords(k) : wordsIn(v)))
      .filter(Boolean).join('. ');
  }
  return '';
}

const listOf = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : x?.label ?? '')) : []);

/**
 * The free sweep.
 *
 * "Separately, and with no licensing question at all: run the same extraction
 * over OSM tags, venue pages, Wikipedia and Wikidata for the same
 * subcategories. This one can be scheduled, run in bulk and repeated. It costs
 * nothing and it is the source that can legitimately be swept."
 *
 * `live` asks the open map about the places we hold no tags for. It is off by
 * default because Overpass is somebody else's machine run for free, and a
 * sweep that hammers it is a sweep that gets Epic blocked; on, it paces itself
 * and takes the answer it gets.
 */
export async function freeSweep({ subcategories = null, size = SAMPLE.top + SAMPLE.mid, live = false, onProgress = null } = {}) {
  const kinds = await harvestable({ subcategories });
  const run = await sets.startRun({
    kind: 'free',
    subcategories: kinds.map((k) => k.key),
    params: { size, live, sample: SAMPLE, sources: ['place_facts', 'place_records', 'attractions', ...(live ? ['osm'] : [])] },
  });
  const report = [];
  let places = 0;
  let found = 0;
  let settled = [];
  const curves = {};
  // Where the volume goes, counted as it goes (migration 232). `raw` is
  // mentions and not words: the same word on ten places is ten, which is the
  // only way the collapse rate afterwards means anything.
  const funnel = { read: 0, raw: 0, collapsed: 0, stored: 0, held: 0, ignored: 0 };
  try {
    for (const kind of kinds) {
      const { places: sample, regions, held } = await sampleFor(kind.key, { size });
      const counts = new Map();
      const perPlace = [];
      for (const place of sample) {
        const { texts, tags } = await heldTextFor(place.venue_ref);
        let osmTags = tags;
        if (!osmTags && live) osmTags = await liveTags(place);
        const raised = candidatesFor({ tags: osmTags, texts });
        perPlace.push([...raised.keys()]);
        funnel.raw += raised.size;
        for (const [norm, entry] of raised) {
          const seen = counts.get(norm) ?? { norm, raw: entry.raw, rawForms: new Set(), sources: new Set(), examples: [], placesSeen: 0, asserts: 0, denies: 0, asks: 0 };
          seen.placesSeen += 1;
          seen.rawForms.add(entry.raw);
          for (const s of entry.sources) seen.sources.add(s);
          // Counted in places rather than mentions: this place asserted it,
          // denied it, or wondered about it.
          if (entry.asserts) seen.asserts += 1;
          if (entry.denies) seen.denies += 1;
          if (entry.asks) seen.asks += 1;
          if (seen.examples.length < 5) seen.examples.push(place.venue_ref);
          counts.set(norm, seen);
        }
        places += 1;
      }
      const entries = [...counts.values()].map((c) => ({ ...c, rawForms: [...c.rawForms] }));
      const written = await sets.recordCandidates(kind.key, entries, { placesTotal: sample.length });
      found += written.written;
      funnel.collapsed += counts.size;
      funnel.stored += written.written;
      funnel.held += written.held ?? 0;
      funnel.ignored += written.skipped ?? 0;
      curves[kind.key] = { ...saturation(perPlace), sampled: sample.length, held, regions };
      report.push({
        subcategory: kind.key, sampled: sample.length, candidates: written.written,
        inHoldingPen: written.held, ignoredAgain: written.skipped, regions,
      });
      onProgress?.({ subcategory: kind.key, done: report.length, of: kinds.length });
    }
    // A set whose subcategories have all stopped teaching new words leaves the
    // Google pass for good (brief §5.4).
    settled = await settleFromSaturation(curves, { runId: run.id });
    funnel.read = places;
    await sets.finishRun(run.id, { places, calls: 0, candidates: found, costUsd: 0, saturation: curves, funnel });
  } catch (err) {
    funnel.read = places;
    await sets.finishRun(run.id, { status: 'failed', places, candidates: found, saturation: curves, funnel, note: String(err.message).slice(0, 200) });
    throw err;
  }
  return { run: run.id, places, candidates: found, subcategories: report, saturation: curves, settled };
}

/** The open map, asked about one place. Free, paced, and allowed to come back with nothing. */
async function liveTags(place) {
  try {
    const tags = await placeTags({
      osmRef: place.venue_ref?.startsWith('osm:') ? place.venue_ref.slice(4) : null,
      lat: place.lat, lng: place.lng,
    });
    return tags ?? null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// the Google pass
// ---------------------------------------------------------------------------

/**
 * What the Google pass would ask, and what it would cost, before it runs.
 *
 * The brief: "Then report the estimated cost and wait." This is the function
 * behind that sentence, and it is separate from the run on purpose — a cost
 * estimate that can only be had by starting is not an estimate.
 */
export async function estimate({ subcategories = null, regionsPer = REGIONS.length } = {}) {
  const kinds = await harvestable({ subcategories });
  const requests = kinds.length * Math.min(regionsPer, REGIONS.length);
  const usd = requests * PRICE_PER_UNIT_USD['google-search'];
  const spent = await spentThisMonth();
  const freeLeft = Math.max(0, 1000 - spent.requests);
  return {
    subcategories: kinds.length,
    regionsPer: Math.min(regionsPer, REGIONS.length),
    requests,
    placesReached: requests * 20,
    sku: 'google-search (Enterprise + Atmosphere Text Search)',
    listPriceUsd: Number(usd.toFixed(2)),
    listPriceGbp: Number((usd * USD_TO_GBP).toFixed(2)),
    // The allowance is what decides whether any of it is actually billed.
    allowance: { monthly: 1000, usedThisMonth: spent.requests, remaining: freeLeft },
    billable: Math.max(0, requests - freeLeft),
    billableGbp: Number((Math.max(0, requests - freeLeft) * COST_PER_REQUEST_GBP).toFixed(2)),
    ceiling: MAX_GOOGLE_REQUESTS,
  };
}

/** How much of this month's Enterprise search allowance has gone, read from the ledger. */
export async function spentThisMonth() {
  const { rows } = await query(
    `select coalesce(sum((units->>'google-search')::int), 0) as requests,
            coalesce(sum(estimated_cost_usd), 0) as usd
       from provider_calls
      where provider = 'google' and created_at >= date_trunc('month', now())`,
  );
  return { requests: Number(rows[0]?.requests ?? 0), usd: Number(rows[0]?.usd ?? 0) };
}

/**
 * One call, to prove the two things the brief says to check before spending.
 *
 * 1. Does `reviewSummary` come back on **Text Search** rather than Place
 *    Details only? That is the factor of twenty between £2 and £25.
 * 2. Does it come back for the **UK**?
 *
 * Both are answered in the documentation and neither is believed until a call
 * has been made. The summaries are counted and discarded; what is returned is
 * how many of twenty places had one, and nothing they said.
 */
export async function probe({ textQuery = 'water park in Surrey', householdId = null, sessionId = null } = {}) {
  const run = await sets.startRun({ kind: 'probe', params: { textQuery } });
  const meter = {};
  const res = await googleSource.reviewSummaries({ textQuery, count: 20, meter });
  await providerCalls.record(householdId, 'google', 'harvest.probe', meter, sessionId).catch(() => null);
  const lengths = res.places.map((p) => p.summary?.length ?? 0);
  const words = res.places.reduce((n, p) => n + (p.summary ? new Set([...normalise(p.summary).split(' ')]).size : 0), 0);
  await sets.finishRun(run.id, {
    status: res.problem ? 'failed' : 'done',
    places: res.places.length,
    calls: res.requests,
    costUsd: res.requests * PRICE_PER_UNIT_USD['google-search'],
    note: res.problem ?? `${res.withSummary} of ${res.places.length} places carried a review summary`,
  });
  return {
    run: run.id,
    textQuery,
    onTextSearch: !res.problem,
    places: res.places.length,
    withSummary: res.withSummary ?? 0,
    // The shape of the material, never the material.
    medianLength: lengths.sort((a, b) => a - b)[Math.floor(lengths.length / 2)] ?? 0,
    distinctWords: words,
    requests: res.requests,
    costUsd: Number((res.requests * PRICE_PER_UNIT_USD['google-search']).toFixed(3)),
    problem: res.problem,
  };
}

/**
 * The Google pass.
 *
 * One Text Search per subcategory per region — "water parks in Cornwall" —
 * which returns twenty places with their review summaries for one request.
 * That is the whole reason it is affordable: "Never buy detail for a place a
 * search could have covered."
 *
 * `confirm` is not a formality. The brief says to report the cost and wait, so
 * this refuses to run unless it is handed the number of requests the estimate
 * said, which means somebody has read the estimate.
 */
export async function googleHarvest({
  subcategories = null, regionsPer = REGIONS.length, confirm = null,
  householdId = null, sessionId = null, onProgress = null,
} = {}) {
  const plan = await estimate({ subcategories, regionsPer });
  if (confirm !== plan.requests) {
    throw Object.assign(
      new Error(`This run is ${plan.requests} requests at about £${plan.billableGbp} (${plan.allowance.remaining} of this month's free allowance left). Confirm with that number to run it.`),
      { status: 409, code: 'confirm_required', plan },
    );
  }
  if (plan.requests > MAX_GOOGLE_REQUESTS) {
    throw Object.assign(new Error(`${plan.requests} requests is past the ${MAX_GOOGLE_REQUESTS} ceiling for one run. Narrow it, or raise the ceiling for this run deliberately.`), { status: 400 });
  }
  const all = await harvestable({ subcategories });
  // A settled set has stopped needing Google. Skipping it here is what makes
  // the brief's "expect Google spend on this to trend to zero" true rather
  // than aspirational, and the run says which were skipped and why.
  const bySub = await sets.settledSubcategories();
  const kinds = all.filter((k) => !bySub.get(k.key)?.vocabulary_settled);
  const skipped = all.filter((k) => bySub.get(k.key)?.vocabulary_settled).map((k) => k.key);
  const regions = REGIONS.slice(0, Math.min(regionsPer, REGIONS.length));
  const run = await sets.startRun({
    kind: 'google',
    subcategories: kinds.map((k) => k.key),
    params: { regions: regions.map((r) => r.key), perRequest: 20, plan },
  });
  const meter = {};
  const report = [];
  const curves = {};
  const funnel = { read: 0, raw: 0, collapsed: 0, stored: 0, held: 0, ignored: 0 };
  let places = 0;
  let requests = 0;
  let found = 0;
  // Which anchor county each region offers this time round. Rotated per
  // subcategory rather than per region, so water parks and lidos are not both
  // asked about the same corner of Cornwall.
  let turn = 0;
  try {
    for (const kind of kinds) {
      const counts = new Map();
      const perPlace = [];
      let seenHere = 0;
      turn += 1;
      for (const region of regions) {
        if (requests >= MAX_GOOGLE_REQUESTS) break;
        const anchor = region.anchors[turn % region.anchors.length];
        const res = await googleSource.reviewSummaries({
          textQuery: `${kind.label ?? kind.key} in ${anchor}`, count: 20, meter,
        });
        requests += res.requests;
        for (const p of res.places) {
          seenHere += 1;
          places += 1;
          if (!p.summary) { perPlace.push([]); continue; }
          // In memory, counted, discarded. `p.summary` is not written anywhere
          // and does not leave this loop.
          const raised = candidatesFor({ texts: [{ source: 'google', text: p.summary }] });
          perPlace.push([...raised.keys()]);
          funnel.raw += raised.size;
          for (const [norm, entry] of raised) {
            const seen = counts.get(norm) ?? { norm, raw: entry.raw, rawForms: new Set(), sources: new Set(), examples: [], placesSeen: 0, asserts: 0, denies: 0, asks: 0 };
            seen.placesSeen += 1;
            seen.rawForms.add(entry.raw);
            seen.sources.add('google');
            // The polarity, read from the clause before the text goes. A
            // review asking whether a place has a wave machine is not evidence
            // that it has one, and this is the only moment it can be caught.
            if (entry.asserts) seen.asserts += 1;
            if (entry.denies) seen.denies += 1;
            if (entry.asks) seen.asks += 1;
            // The id is storable — it is an identifier — and it is scaffolding
            // that goes the moment the candidate is decided.
            if (seen.examples.length < 5) seen.examples.push(`google:${p.id}`);
            counts.set(norm, seen);
          }
        }
        onProgress?.({ subcategory: kind.key, region: region.key, requests });
      }
      const entries = [...counts.values()].map((c) => ({ ...c, rawForms: [...c.rawForms] }));
      const written = await sets.recordCandidates(kind.key, entries, { placesTotal: seenHere });
      found += written.written;
      funnel.collapsed += counts.size;
      funnel.stored += written.written;
      funnel.held += written.held ?? 0;
      funnel.ignored += written.skipped ?? 0;
      curves[kind.key] = { ...saturation(perPlace), sampled: seenHere };
      report.push({ subcategory: kind.key, places: seenHere, candidates: written.written, inHoldingPen: written.held });
    }
    await providerCalls.record(householdId, 'google', 'harvest.vocabulary', meter, sessionId).catch(() => null);
    const { usd } = await costOfRun(run.started_at);
    const settled = await settleFromSaturation(curves, { runId: run.id });
    funnel.read = places;
    await sets.finishRun(run.id, { places, calls: requests, candidates: found, costUsd: usd, saturation: curves, funnel });
    return { run: run.id, requests, places, candidates: found, costUsd: usd, subcategories: report, saturation: curves, settled, skippedAsSettled: skipped };
  } catch (err) {
    await providerCalls.record(householdId, 'google', 'harvest.vocabulary', meter, sessionId).catch(() => null);
    funnel.read = places;
    await sets.finishRun(run.id, { status: 'failed', places, calls: requests, candidates: found, saturation: curves, funnel, note: String(err.message).slice(0, 200) });
    throw err;
  }
}

/** What a run cost, from the ledger rather than from a multiplication. */
export async function costOfRun(since) {
  const { rows } = await query(
    `select coalesce(sum(estimated_cost_usd), 0) as usd, count(*) as calls
       from provider_calls where purpose like 'harvest.%' and created_at >= $1`, [since],
  );
  return { usd: Number(rows[0]?.usd ?? 0), calls: Number(rows[0]?.calls ?? 0) };
}

// ---------------------------------------------------------------------------
// enrichment, which is built and switched off
// ---------------------------------------------------------------------------

/**
 * Which places have earned having their questions answered.
 *
 * Brief §5: "Once questions are approved, answering them per place is
 * demand-driven: a place is enriched when it crosses a threshold of
 * appearances in search or drawer opens. That keeps it proportionate —
 * roughly the top few per cent of places carry most searches — and it keeps
 * per-place calls tied to real usage rather than a sweep."
 *
 * The demand is read from the search log, which already records every place
 * shown and every drawer opened (`repositories/searches.js`). A place is on
 * this list when it crosses either threshold and has a question it has never
 * been asked.
 */
export async function enrichmentQueue({ limit = 50, since = 90 } = {}) {
  const { rows } = await query(
    `with demand as (
        select venue_ref,
               count(*) filter (where kind = 'shown') as shown,
               count(*) filter (where kind = 'open')  as opened
          from search_events
         where venue_ref is not null and at > now() - ($1 || ' days')::interval
         group by venue_ref
     )
     select d.venue_ref, d.shown, d.opened, p.subcategory, ss.set_key,
            (select count(*) from questions q
              where q.active and (q.scope = 'global' or q.set_key = ss.set_key)
                and not exists (select 1 from place_answers a where a.venue_ref = d.venue_ref and a.question_id = q.id)
            ) as unanswered
       from demand d
       join place_index p on p.venue_ref = d.venue_ref
       left join question_set_subcategories ss on ss.subcategory_key = p.subcategory
      where d.shown >= $2 or d.opened >= $3
      order by d.opened desc, d.shown desc
      limit $4`,
    [String(since), ENRICH_AFTER.shown, ENRICH_AFTER.opened, limit],
  );
  return rows.filter((r) => Number(r.unanswered) > 0);
}

/**
 * The search that just happened, offered to enrichment.
 *
 * Brief §5.5: "**Trigger enrichment on the search, not on the open.** A search
 * returning ten water parks queues all ten. It reads only owned sources, so it
 * is free; by the time a household taps one it is usually already answered."
 *
 * The call site is the search path, and it is a no-op while the switch is off
 * — which is how it ships, per §6. It is here rather than inside the search so
 * that turning enrichment on is one environment variable and not a change to
 * the path a household waits on.
 */
export async function offerToEnrichment(refs = [], { reason = 'search' } = {}) {
  if (!enrichmentOn() || !refs.length) return { queued: 0, on: false };
  const queue = await enrichmentQueue({ limit: refs.length });
  const wanted = new Set(refs);
  const due = queue.filter((r) => wanted.has(r.venue_ref));
  // Nothing runs yet: the answerer is the next piece of work, and the brief is
  // explicit that nothing may batch-enrich in the meantime.
  return { queued: due.length, on: true, reason, refs: due.map((r) => r.venue_ref) };
}

/**
 * Answer one place's questions from the sources Epic owns.
 *
 * **Off, and the brief says to leave it off**: "Build the hook now, leave it
 * switched off. Do not batch-enrich anything." `EPIC_ENRICHMENT=on` is the
 * switch, and until it is thrown this refuses rather than quietly doing
 * nothing — a hook that silently no-ops is a hook somebody wires up twice.
 *
 * When it is thrown, the work is `sources/own.js`'s: the venue's own page, the
 * open map, the encyclopedias, and `asked_nothing_found` where they are all
 * silent. Google is not in that list and never will be.
 */
export async function enrichPlace(venueRef, { force = false } = {}) {
  if (!enrichmentOn() && !force) {
    throw Object.assign(
      new Error('Enrichment is switched off (EPIC_ENRICHMENT). The harvest raises the questions; answering them per place waits for the owner.'),
      { status: 409, code: 'enrichment_off' },
    );
  }
  throw Object.assign(
    new Error('Enrichment has no answerer yet. The hook and the queue are built; the per-place research pass is the next piece of work.'),
    { status: 501, code: 'not_built' },
  );
}

// ---------------------------------------------------------------------------
// the classifier: is this word a feature, a condition, or an opinion?
// ---------------------------------------------------------------------------

/**
 * What kind of word this is, decided once per word rather than once per place.
 *
 * Brief §5.1 asks for the kind at extraction and prices it at "a fraction of a
 * penny per place". Classifying the *vocabulary* instead of the text is the
 * same verdict an order of magnitude cheaper: "wave machine is a feature" is
 * true of every water park at once, and a subcategory's five hundred distinct
 * words are five calls rather than twenty.
 *
 * The code's own pass has already called the obvious half for nothing
 * (`plainKindOf`). What arrives here is what it could not call.
 *
 * **A word the model cannot call stays in the holding pen.** So does every
 * word, if the budget is spent or the key is missing: the run reports it and
 * nothing is guessed at. That is the brief's rule — "never force a verdict,
 * never promote on thin evidence" — and it is also what makes this safe to run
 * unattended.
 */
const Verdicts = z.object({
  words: z.array(z.object({
    word: z.string(),
    kind: z.enum(['feature', 'condition', 'opinion', 'unclear']),
  })),
});

const CLASSIFY_SYSTEM = `You are sorting words that were noticed in what people write about places to visit in the UK — reviews, venue pages, the open map, encyclopedia articles. Epic asks closed questions about places ("does it have a wave machine?"), and needs to know which of these words could be such a question.

Sort each word into exactly one kind:

- feature — something a place either has or has not got, and which a family might choose on. A wave machine, a toddler pool, step free access, a gift shop, a guided tour, parking, a paddling pool, a miniature railway, a licensed bar.
- condition — true of a place sometimes rather than always, or about circumstances rather than the place. Busy at weekends, long queues, seasonal opening, sunny.
- opinion — a judgement rather than a fact. Rude staff, overpriced, charming, the best day out.
- unclear — you genuinely cannot tell, or the word is a fragment, a place name, a person, a date or otherwise not about the place at all.

Prefer unclear to a guess. A wrong "feature" becomes a question asked of thousands of places; an unclear word simply waits and is looked at again.`;

/**
 * Classify what is in the holding pen.
 *
 * `ask` is injectable so the tests can exercise the queue, the writes and the
 * batching without a model call.
 */
export async function classifyCandidates({
  subcategory = null, limit = 400, batch = 80, householdId = null, sessionId = null, ask = null,
} = {}) {
  const waiting = await sets.unclassified({ subcategory, limit });
  if (!waiting.length) return { looked: 0, called: [], held: 0, problem: null };
  const counts = { feature: 0, condition: 0, opinion: 0, unclear: 0 };
  let problem = null;
  for (let i = 0; i < waiting.length; i += batch) {
    const slice = waiting.slice(i, i + batch);
    let verdicts;
    try {
      verdicts = ask
        ? await ask(slice)
        : (await parseStructured({
          system: CLASSIFY_SYSTEM,
          messages: [{
            role: 'user',
            content: `These words were noticed in what is written about ${subcategory ? `places filed under "${subcategory}"` : 'places to visit'}. Sort every one of them.\n\n${slice.map((w) => `- ${w.raw_forms?.[0] ?? w.norm}`).join('\n')}`,
          }],
          schema: Verdicts,
          householdId,
          sessionId,
          purpose: 'harvest.classify',
          effort: 'low',
          thinking: 'off',
          maxTokens: 4096,
        })).words;
    } catch (err) {
      // A spent budget or a missing key leaves the pen exactly as it was,
      // which is the right outcome: nothing is promoted on a guess and the run
      // says what stopped it.
      problem = String(err.message).slice(0, 160);
      break;
    }
    const byWord = new Map((verdicts ?? []).map((v) => [normalise(v.word), v.kind]));
    for (const row of slice) {
      const kind = byWord.get(row.norm) ?? byWord.get(normalise(row.raw_forms?.[0] ?? '')) ?? 'unclear';
      if (kind === 'unclear') { counts.unclear += 1; continue; }
      await sets.setKind(row.id, { kind, by: ask ? 'test' : MODEL });
      counts[kind] += 1;
    }
  }
  return {
    looked: waiting.length,
    features: counts.feature,
    conditions: counts.condition,
    opinions: counts.opinion,
    held: counts.unclear,
    problem,
  };
}

// ---------------------------------------------------------------------------
// when a set stops reading reviews
// ---------------------------------------------------------------------------

/**
 * Settle every set whose subcategories have stopped teaching Epic new words.
 *
 * Brief §5.4, and it is the moment a category stops costing money: a settled
 * set is skipped by the Google pass for ever after, and enrichment for it
 * reads owned sources only. A set is settled when *every* subcategory attached
 * to it came back saturated in the run being considered — one unsaturated
 * subcategory means the set has vocabulary left to learn.
 */
export async function settleFromSaturation(saturation = {}, { runId = null } = {}) {
  const { rows } = await query(
    `select s.key, s.vocabulary_settled, array_agg(ss.subcategory_key) as subcategories
       from question_sets s join question_set_subcategories ss on ss.set_key = s.key
      group by s.key, s.vocabulary_settled`,
  );
  const settled = [];
  for (const set of rows) {
    if (set.vocabulary_settled) continue;
    const seen = set.subcategories.map((k) => saturation[k]).filter(Boolean);
    if (seen.length !== set.subcategories.length) continue;
    if (!seen.every((c) => c.saturated)) continue;
    await sets.settleSet(set.key, {
      on: {
        run: runId,
        places: seen.reduce((n, c) => n + (c.places ?? 0), 0),
        regions: [...new Set(seen.flatMap((c) => c.regions ?? []))],
        subcategories: set.subcategories,
        at: new Date().toISOString(),
      },
    });
    settled.push(set.key);
  }
  return settled;
}
