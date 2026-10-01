/**
 * The read-only measurement behind the church / landmark / monument narrowing
 * proposal (owner, 1 Oct 2026). PROPOSE ONLY — nothing here writes, hides, or
 * changes filing. It counts what the Culture census holds now, and what the
 * notability predicate (domain/narrowing.js) would keep and drop, with examples
 * of each, so the owner can judge the rule before it is applied (H1).
 *
 * The ring is resolved and counted by exactly the tooling the Inspire board and
 * the /census-ring-breakdown diagnostic use — `reach.ringFor` then
 * `censusInRing({ shownOnly: true })` — so these numbers are the same ones the
 * owner read his 78 → 1,005 from, split by subcategory and run through the
 * predicate. The estate variant counts every place filed under each drawer.
 *
 * Signals come only from what we own or may freely read: an owned name, Google's
 * and OSM's type words, the open map's tags from our own copy (osm_features),
 * an encyclopedia link, and the Historic England list on our own disk. No rented
 * content is read and no live call is made.
 */

import { query } from '../db.js';
import * as reach from '../repositories/reach.js';
import { censusInRing } from './censusRing.js';
import { TEXT_QUESTIONS, textStillAsked } from '../sources/censusQuestions.js';
import { travelMode } from '../domain/travel.js';
import { notable } from '../domain/narrowing.js';

/** The text-sourced drawers still asked — a filing under any other text drawer is obsolete. */
const currentTextDrawers = () => Object.keys(TEXT_QUESTIONS).filter(textStillAsked);

/** The four Culture drawers in question, and the comparator. */
export const SUBCATEGORIES = [
  { key: 'churches', label: 'Cathedrals, churches & abbeys', narrow: true },
  { key: 'landmarks-you-can-see', label: 'Landmarks', narrow: true },
  { key: 'monuments-memorials', label: 'Monuments & memorials', narrow: true },
  { key: 'museums', label: 'Museums', narrow: false },
];
const CULTURE = 'culture';

const outcodeLike = (slug) => /^[a-z]{1,2}\d/i.test(String(slug ?? ''));

/** Whether the Historic England list is loaded, and which load the matcher reads. */
export async function heritageLoad() {
  const { rows: [r] } = await query(
    `select state, live_load from owned_source_loads where source = 'historic-england'`);
  return { available: Boolean(r?.live_load), state: r?.state ?? 'never', load: r?.live_load ?? null };
}

/**
 * Everything the predicate needs for a set of places, in one pass. Returns a
 * Map keyed by venue_ref. A ~60 m box around the best point we hold is tested
 * against the Historic England list; `heritageLoad` is the live load (or null,
 * which makes the Grade I signal unavailable — can't-speak).
 */
export async function gatherSignals(refs, { heritageLoad: heLoad = null } = {}) {
  const out = new Map();
  if (!refs.length) return out;
  const { rows } = await query(
    `select
       r.venue_ref,
       -- An owned name only: a researched record's, or the atlas's. Never a
       -- rented one (CLAUDE.md). A record name counts only where provenance says
       -- we set it ourselves; otherwise the atlas name, else none.
       coalesce(case when (pr.provenance ->> 'name') is not null then pr.name end, at.name) as name,
       -- The census queries that found this place — our own words for what it is
       -- (found_by), used where the rented google_types column used to be, which is
       -- no longer stored (item 6, 1 Oct 2026). worshipKind et al. check these
       -- against the Google worship types; found_by values are Google types too.
       coalesce(array(
         select distinct q.f from (
           select s.found_by as f from place_subcategories s
             where s.venue_ref = r.venue_ref and s.found_by is not null
           union all
           select pi2.found_by from place_index pi2
             where pi2.venue_ref = r.venue_ref and pi2.found_by is not null
         ) q), '{}') as query_types,
       coalesce((select array_agg(l.label) from place_index_labels l where l.venue_ref = r.venue_ref), '{}') as labels,
       -- A real encyclopedia article, not merely a Wikidata id (every atlas row
       -- has one): the url is the evidence of an article (Codex).
       (pr.wikipedia_url is not null or at.wikipedia_url is not null) as has_wikipedia,
       (pr.opening_hours is not null and pr.opening_hours <> '') as pr_hours,
       (pr.website is not null and pr.website <> '') as pr_website,
       osmf.tags as osm_tags,
       coalesce((select array_agg(pa.area_slug) from place_areas pa where pa.venue_ref = r.venue_ref), '{}') as areas,
       -- Which nation the place is in — the same source the Places desk uses
       -- (desk/places.js): the county locality it is filed in, then the region,
       -- then the atlas region. Historic England's list is England-only, so a
       -- place anywhere else (or whose nation we cannot place) can never be said
       -- to have "no qualifying listing" from it (Codex).
       coalesce(
         (select l.nation from place_areas pa join localities l on l.slug = pa.area_slug
           where pa.venue_ref = r.venue_ref and l.kind = 'county' and l.nation is not null limit 1),
         (select rg.nation from place_areas pa join regions rg on rg.slug = pa.area_slug
           where pa.venue_ref = r.venue_ref limit 1),
         (select rg.nation from regions rg where rg.slug = at.region_slug limit 1)
       ) as nation,
       her.grade_i, her.grade_2star, her.scheduled, her.world_heritage
     from unnest($1::text[]) as r(venue_ref)
     left join place_index pi on pi.venue_ref = r.venue_ref
     left join place_records pr on pr.venue_ref = r.venue_ref
     left join lateral (
       select a.name, a.wikidata_id, a.wikipedia_url, a.osm_ref, a.region_slug from attractions a
        where a.venue_ref = r.venue_ref or a.external_ref = r.venue_ref
           or a.id = epic_try_uuid(substr(r.venue_ref, 7))
        limit 1) at on true
     left join owned_points op on op.venue_ref = r.venue_ref
     left join lateral (
       select f.tags from osm_features f
        where f.ref = coalesce(
          case when r.venue_ref like 'osm:%' then substr(r.venue_ref, 5) end,
          pr.osm_ref,
          -- An atlas place's only OSM link is often on the attraction itself
          -- (attractions.osm_ref, via Wikidata P402); without it a church with
          -- opening_hours/tourism tags there was wrongly dropped (Codex).
          at.osm_ref,
          case when op.source = 'osm' then op.source_ref end)
        limit 1) osmf on true
     left join lateral (
       select
         bool_or(h.layer = 'listed-building' and h.grade = 'I') as grade_i,
         bool_or(h.layer = 'listed-building' and h.grade = 'II*') as grade_2star,
         bool_or(h.layer = 'scheduled-monument') as scheduled,
         bool_or(h.layer = 'world-heritage') as world_heritage
       from heritage_entries h
       where $2::uuid is not null and h.load_id = $2::uuid
         and coalesce(op.lat, pi.lat, pr.lat) is not null
         -- ~60-65 m box around the best point we hold AND the listing's name
         -- agreeing with the venue's — a churchyard clusters a plaque, a memorial
         -- and the church within 60 m, so proximity alone attributed the church's
         -- Grade I to its neighbours (Codex). Fail closed: no owned name, no match.
         and h.lat between coalesce(op.lat, pi.lat, pr.lat) - 0.0006 and coalesce(op.lat, pi.lat, pr.lat) + 0.0006
         and h.lng between coalesce(op.lng, pi.lng, pr.lng) - 0.0009 and coalesce(op.lng, pi.lng, pr.lng) + 0.0009
         and exists (
           select 1
             from unnest(string_to_array(regexp_replace(
               lower(coalesce(case when (pr.provenance ->> 'name') is not null then pr.name end, at.name, '')),
               '[^a-z0-9 ]', ' ', 'g'), ' ')) as vt
             join unnest(string_to_array(regexp_replace(lower(h.name), '[^a-z0-9 ]', ' ', 'g'), ' ')) as ht on ht = vt
            -- >= 3 so a saint's short name (Ann, Ive, Bee) still identifies the
            -- place; generic short words stay excluded below (Codex).
            where length(vt) >= 3
              and vt not in ('church','saint','chapel','abbey','priory','friary','minster','cathedral',
                             'house','hall','castle','tower','bridge','viaduct','memorial','monument',
                             'garden','gardens','park','green','the','and','war','old','new','great','little',
                             'grade','listed','building','former','parish'))
     ) her on true`,
    [refs, heLoad]);

  for (const row of rows) {
    const areas = (row.areas ?? []).filter(Boolean);
    // The Historic England list speaks only for England, and only when it is
    // loaded. A place in Scotland, Wales, NI or Ireland — or one whose nation we
    // cannot place — leaves the Grade I signal unavailable, so a place with no
    // other signal is can't-speak, never a false drop (Codex, can't-speak rule).
    // A positive match in the Historic England list proves the place is in
    // England, so it keeps whatever its nation resolved to; only *absence* of a
    // listing depends on coverage — England (and only when loaded) can say "no
    // listing", everywhere else leaves Grade I can't-speak (Codex).
    const hit = {
      gradeI: row.grade_i === true, grade2star: row.grade_2star === true,
      scheduled: row.scheduled === true, worldHeritage: row.world_heritage === true,
    };
    const anyHit = hit.gradeI || hit.grade2star || hit.scheduled || hit.worldHeritage;
    const heritageAvailable = Boolean(heLoad) && (row.nation === 'England' || anyHit);
    out.set(row.venue_ref, {
      ref: row.venue_ref,
      name: row.name ?? null,
      nation: row.nation ?? null,
      googleTypes: row.query_types ?? [],
      labels: row.labels ?? [],
      osmTags: row.osm_tags ?? null,
      hasWikipedia: row.has_wikipedia === true,
      openingHours: row.pr_hours === true,
      website: row.pr_website === true,
      heritageAvailable,
      heritage: heLoad ? hit : null,
      where: (areas.find(outcodeLike) ?? areas[0] ?? null)?.toUpperCase?.() ?? null,
    });
  }
  return out;
}

/**
 * The subcategory(ies) each ref is currently filed under, limited to the drawers
 * given — with the same filter censusInRing applies: a text-sourced surfacing
 * counts only while its drawer is still asked in text. Without this a venue was
 * re-added to an obsolete, re-fenced drawer, and a per-subcategory ring total
 * diverged from the census count it is drawn from (Codex).
 */
async function filedUnder(refs, keys) {
  const byRef = new Map();
  if (!refs.length) return byRef;
  const { rows } = await query(
    `select distinct venue_ref, subcategory from place_subcategories
      where venue_ref = any($1) and subcategory = any($2)
        and (sourced is distinct from 'text' or subcategory = any($3::text[]))`,
    [refs, keys, currentTextDrawers()]);
  for (const r of rows) byRef.set(r.venue_ref, [...(byRef.get(r.venue_ref) ?? []), r.subcategory]);
  return byRef;
}

/** Judge a set of refs, bucket them, and draw the examples. */
function judge(refs, signalsByRef) {
  const kept = [];
  const dropped = [];
  const cantSpeak = [];
  for (const ref of refs) {
    const s = signalsByRef.get(ref) ?? { ref, heritageAvailable: false, heritage: null };
    const v = notable(s);
    const row = {
      ref,
      name: s.name ?? null,
      where: s.where ?? null,
      why: v.signals.length ? v.signals.join('; ') : v.reason,
    };
    if (v.status === 'kept') kept.push(row);
    else if (v.status === 'dropped') dropped.push(row);
    else cantSpeak.push(row);
  }
  return { kept, dropped, cantSpeak };
}

const EXAMPLES = 10;
const subcategoryResult = (sub, refs, signalsByRef) => {
  // Museums is the unchanged comparator: the rule does not narrow it, so the
  // predicate is never run on it and nothing is reported as dropped — it is a
  // count, with a sample, and nothing more (Codex).
  if (!sub.narrow) {
    const examples = refs.slice(0, EXAMPLES).map((ref) => {
      const s = signalsByRef.get(ref) ?? {};
      return { ref, name: s.name ?? null, where: s.where ?? null };
    });
    return {
      key: sub.key,
      label: sub.label,
      narrow: false,
      comparator: true,
      countNow: refs.length,
      examples,
    };
  }
  const { kept, dropped, cantSpeak } = judge(refs, signalsByRef);
  return {
    key: sub.key,
    label: sub.label,
    narrow: true,
    countNow: refs.length,
    kept: kept.length,
    dropped: dropped.length,
    cantSpeak: cantSpeak.length,
    // now = kept + dropped + cantSpeak, always.
    examplesKept: kept.slice(0, EXAMPLES),
    examplesDropped: dropped.slice(0, EXAMPLES),
    examplesCantSpeak: cantSpeak.slice(0, EXAMPLES),
  };
};

/**
 * The preview. `scope` is 'ring' (a drive-time ring from `where`) or 'estate'
 * (every place filed under each drawer). Read-only; returns numbers + examples.
 */
export async function narrowingPreview({
  scope = 'ring', where = null, lat = null, lng = null, minutes = 30, mode = 'driving',
} = {}) {
  const he = await heritageLoad();

  if (scope === 'estate') {
    const keys = SUBCATEGORIES.map((s) => s.key);
    const { rows } = await query(
      `select subcategory, array_agg(distinct venue_ref) as refs
         from place_subcategories
        where subcategory = any($1)
          and (sourced is distinct from 'text' or subcategory = any($2::text[]))
        group by subcategory`, [keys, currentTextDrawers()]);
    const refsBySub = new Map(rows.map((r) => [r.subcategory, r.refs ?? []]));
    const allRefs = [...new Set(rows.flatMap((r) => r.refs ?? []))];
    const signalsByRef = await gatherSignals(allRefs, { heritageLoad: he.load });
    return {
      scope: 'estate',
      heritage: he,
      subcategories: SUBCATEGORIES.map((s) => subcategoryResult(s, refsBySub.get(s.key) ?? [], signalsByRef)),
    };
  }

  const m = travelMode(mode);
  const mins = Math.min(90, Math.max(5, Math.trunc(Number(minutes)) || 30));
  const ring = await reach.ringFor({ where, lat, lng, minutes: mins, mode: m });
  if (!ring) return { error: 'where_required', message: 'Pass ?where= or ?lat=&lng=.' };

  const res = await censusInRing({
    cells: ring.band ?? ring.cells, outcodes: ring.outcodes,
    shownOnly: true, circle: ring.circle ?? null,
  });
  const cultureRefs = res.refs?.[CULTURE] ?? [];
  const keys = SUBCATEGORIES.map((s) => s.key);
  const filed = await filedUnder(cultureRefs, keys);
  const refsBySub = new Map(keys.map((k) => [k, []]));
  for (const [ref, subs] of filed) for (const sub of subs) refsBySub.get(sub).push(ref);
  const allRefs = [...new Set([...refsBySub.values()].flat())];
  const signalsByRef = await gatherSignals(allRefs, { heritageLoad: he.load });

  return {
    scope: 'ring',
    heritage: he,
    ring: {
      where: ring.label ?? where, minutes: mins, mode: m,
      method: ring.method ?? null,
      cells: (ring.band ?? ring.cells ?? []).length,
      outcodes: (ring.outcodes ?? []).length,
      placedBy: res.placedBy ?? null,
      // Culture places in a box across the ring's edge: a floor, not dropped.
      cultureUnresolved: res.unresolved?.[CULTURE] ?? 0,
      cultureCounted: (res.counts?.[CULTURE] ?? 0),
    },
    subcategories: SUBCATEGORIES.map((s) => subcategoryResult(s, refsBySub.get(s.key) ?? [], signalsByRef)),
  };
}

/**
 * The proposed rule, in plain words, carried on the response so the owner reads
 * the measurement and the rule it measures together. It is a PROPOSAL; applying
 * it is a separate, approved step.
 */
export const PROPOSED_RULE = {
  applies_to: ['churches', 'landmarks-you-can-see', 'monuments-memorials'],
  notable_when_any: [
    'It is a cathedral, abbey or minster — by an OSM building type, or by its own owned name (the word as what the place is, so "Westminster Abbey" and "York Minster" stay and "Abbey Road Studios" does not).',
    'It has an encyclopedia article — an atlas row or owned record with a Wikidata id or Wikipedia url, or a wikidata: reference.',
    'It has visitor facilities or opening hours — opening_hours, a website, or an OSM tourism / fee / wheelchair tag, from the venue\'s own page or our own copy of the open map.',
    'It is Grade I listed, a scheduled monument, or a World Heritage Site — matched to the Historic England list on our own disk (migration 308).',
  ],
  dropped: 'Ordinary parish churches, statues, memorials and plaques with no encyclopedia article, no listing, and no visitor facilities we hold.',
  not_surfaced_means: 'Kept in the data and in the back office exactly as now; left out of what families are shown and out of the Culture ring and area counts — the same treatment as a C57 unconfirmed place. Nothing is deleted or hidden.',
  grade_i_note: 'The Historic England loader shipped (migration 308, C59, 30 Sep 2026). This preview reads the live load where there is one; where it has not loaded yet, Grade I cannot be checked, and such places are returned as "cant-speak" rather than dropped — never a false drop (CLAUDE.md can\'t-speak).',
  application_is_separate: true,
};
