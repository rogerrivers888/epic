/**
 * The read-only measurement behind the church / landmark / monument narrowing
 * (Option 2, owner, 1 Oct 2026). This module MEASURES ONLY — it writes nothing
 * and hides nothing (applying is repositories/placeSurfacing.js). Per drawer it
 * reports countNow, surfaced (positive notability evidence) and notSurfaced
 * (everything else — there is no can't-tell for surfacing; can't-speak governs
 * FACTS, not this), with examples, plus a cultureTotal (now vs after) over the
 * whole Culture category so the lead can read "Culture 270–330" straight off it.
 *
 * The ring is resolved and counted by the Inspire board's own tooling —
 * `reach.ringFor` then `censusInRing({ shownOnly: true })` — the numbers the
 * owner read his 78 → 1,005 from. Each drawer's countNow is the DISTINCT
 * physical-place count: filed as the Categories screen files (desk/categories.js
 * FILED_SQL — primary shelf + secondary words, fence-filtered, so churches
 * reconcile to the screen's 11,127, not place_subcategories' 29,265), deduped
 * atlas↔census so a place held both ways counts once.
 *
 * Signals come only from what we own or may freely read: an owned name, Google's
 * and OSM's type words, the open map's tags from our own copy (osm_features),
 * an encyclopedia link, and the Historic England list on our own disk. No rented
 * content is read and no live call is made.
 */

import { query } from '../db.js';
import * as reach from '../repositories/reach.js';
import { censusInRing } from './censusRing.js';
import { travelMode } from '../domain/travel.js';
import { notable, NOT_SURFACED_REASON } from '../domain/narrowing.js';
import { FILED_SQL } from '../desk/categories.js';

/**
 * The three low-attraction Culture drawers the rule narrows, by the owner's
 * decided bar (Option 2). A filing elsewhere — any drawer not in this set — is
 * what keeps a place that legitimately surfaces as something else.
 */
export const NARROWED = ['churches', 'landmarks-you-can-see', 'monuments-memorials'];

/**
 * The full Culture category, so the lead can sum "Culture after": the three
 * narrowed drawers and the six comparators that are left exactly as they are
 * (museums, galleries, castles, historic houses, ancient sites, theatre). The
 * comparators are never run through the predicate — they are a count and a
 * sample only.
 */
export const SUBCATEGORIES = [
  { key: 'churches', label: 'Cathedrals, churches & abbeys', narrow: true },
  { key: 'landmarks-you-can-see', label: 'Landmarks', narrow: true },
  { key: 'monuments-memorials', label: 'Monuments & memorials', narrow: true },
  { key: 'museums', label: 'Museums', narrow: false },
  { key: 'galleries', label: 'Art galleries', narrow: false },
  { key: 'castles', label: 'Castles & forts', narrow: false },
  { key: 'historic-houses', label: 'Historic houses & palaces', narrow: false },
  { key: 'ancient-sites', label: 'Ancient & archaeological sites', narrow: false },
  { key: 'theatre', label: 'Theatre & concert halls', narrow: false },
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

const EXAMPLES = 10;
const emptySignals = (ref) => ({ ref, heritageAvailable: false, heritage: null });

/**
 * Every (venue_ref, drawer) filing the **Categories screen** counts — primary
 * (`place_index.subcategory`) and secondary (a Google word pointing at another
 * drawer) — fence-filtered (`not_in_epic_at is null`), reusing its own `FILED_SQL`
 * (desk/categories.js). This is the base-reconciliation fix (owner, item 3): the
 * estate base read 29,265 for churches against the screen's 11,127, because it
 * was counting `place_subcategories` — a surfacing row per census box, including
 * drawers the fence has since dropped. FILED_SQL is one row per in-Epic place per
 * drawer, so the drawer counts match the screen. `refs` narrows to a set (the
 * ring); null is the whole estate.
 */
async function filingRowsFor({ refs = null, keys }) {
  const args = [keys];
  let where = 'f.sub = any($1)';
  if (refs) {
    if (!refs.length) return [];
    args.push(refs);
    where = 'f.sub = any($1) and f.venue_ref = any($2::text[])';
  }
  const { rows } = await query(
    `select f.venue_ref as ref, f.sub, bool_or(f.is_primary) as is_primary
       from (${FILED_SQL}) f
      where ${where}
      group by f.venue_ref, f.sub`, args);
  return rows;
}

/** The refs (within a set) filed — primary or secondary — in any drawer that is
 * NOT one of the three narrowed ones. These surface as something else and are
 * never held back (Part B: "don't hide a place that legitimately surfaces
 * elsewhere"); here they keep their cluster counted in Culture-after. */
export async function filedElsewhere(refs) {
  if (!refs.length) return new Set();
  const { rows } = await query(
    `select distinct f.venue_ref as ref from (${FILED_SQL}) f
      where f.venue_ref = any($1::text[]) and f.sub <> all($2::text[])`,
    [refs, NARROWED]);
  return new Set(rows.map((r) => r.ref));
}

/**
 * The same-physical-place links we hold (owner, item 3: "de-duplicated against
 * census IDs where both exist"), as (a, b) pairs touching `list`. These are the
 * SAME link tables HIDDEN_REFS expands over, so the determination and the hide
 * agree on what is one place: `provider_matches` (a Google id and the venue it
 * matched, both directions), and every name an atlas row goes by — its venue ref,
 * external ref, explicit `atlas:<id>`, `wikidata:`, `osm:` (both spellings) and
 * the open-map match (`atlas_osm_matches`). One hop; `aliasClosure` iterates this
 * to a full transitive closure.
 */
async function linkEdges(list) {
  if (!list.length) return [];
  const { rows } = await query(
    `select m.venue_ref as a, 'google:' || m.source_ref as b
       from provider_matches m
      where m.source = 'google' and not m.missing and m.source_ref is not null
        and (m.venue_ref = any($1::text[]) or 'google:' || m.source_ref = any($1::text[]))
     union all
     select coalesce(a.venue_ref, 'atlas:' || a.id::text) as a, x.b
       from attractions a
       left join atlas_osm_matches mo on mo.attraction_id = a.id
       cross join lateral (values
         (a.venue_ref),
         (a.external_ref),
         ('atlas:' || a.id::text),
         ('wikidata:' || a.wikidata_id),
         ('osm:' || a.osm_ref),
         (case when a.osm_ref ~ '^[0-9]+$' then 'osm:relation/' || a.osm_ref end),
         (case when a.osm_ref like 'relation/%' then 'osm:' || substr(a.osm_ref, 10) end),
         ('osm:' || mo.osm_ref),
         (case when mo.osm_ref ~ '^[0-9]+$' then 'osm:relation/' || mo.osm_ref end),
         (case when mo.osm_ref like 'relation/%' then 'osm:' || substr(mo.osm_ref, 10) end)
       ) x(b)
      where x.b is not null
        and (coalesce(a.venue_ref, 'atlas:' || a.id::text) = any($1::text[])
             or a.external_ref = any($1::text[]) or 'atlas:' || a.id::text = any($1::text[])
             or x.b = any($1::text[]))`,
    [list]);
  return rows;
}

/** A fresh union-find with path compression and node creation on union. */
function unionFind() {
  const parent = new Map();
  const add = (x) => { if (x != null && x !== '' && !parent.has(x)) parent.set(x, x); };
  const find = (x) => {
    let r = x; while (parent.get(r) !== r) r = parent.get(r);
    while (parent.get(x) !== r) { const n = parent.get(x); parent.set(x, r); x = n; }
    return r;
  };
  const union = (a, b) => {
    if (a == null || b == null || a === '' || b === '') return;
    add(a); add(b);
    const ra = find(a); const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  return { parent, add, find, union };
}

/**
 * THE alias closure (owner, item 3; Codex root fix). The one transitive
 * same-physical-place grouping, used by BOTH the preview's dedup and the apply's
 * determination, so measured surfaced/notSurfaced and what apply hides can never
 * diverge. Seeded with any refs (including a single one), it follows `linkEdges`
 * repeatedly — a NEWLY discovered attraction ref has its own filings and links
 * expanded too — until nothing new is found. Returns `{ rootOf, membersOf }` over
 * every node reached. It is a SUPERSET of HIDDEN_REFS's bounded expansion, so two
 * refs HIDDEN_REFS would hide together are always judged together: a notable twin
 * can never be hidden.
 */
export async function aliasClosure(seedRefs) {
  const uf = unionFind();
  const seen = new Set();
  let frontier = [...new Set((seedRefs ?? []).filter(Boolean).map(String))];
  frontier.forEach((r) => { uf.add(r); seen.add(r); });
  while (frontier.length) {
    const edges = await linkEdges(frontier);
    const next = [];
    for (const { a, b } of edges) {
      uf.union(a, b);
      for (const x of [a, b]) {
        const s = x == null ? null : String(x);
        if (s && !seen.has(s)) { seen.add(s); next.push(s); }
      }
    }
    frontier = next;
  }
  const membersOf = new Map();
  const rootOf = new Map();
  for (const node of uf.parent.keys()) {
    const root = uf.find(node);
    rootOf.set(node, root);
    if (!membersOf.has(root)) membersOf.set(root, []);
    membersOf.get(root).push(node);
  }
  return { rootOf, membersOf };
}

/** A cluster's name/where for an example: prefer a member that carries an owned name. */
function clusterExample(members, signalsByRef) {
  const named = members.find((m) => signalsByRef.get(m)?.name);
  const ref = named ?? members[0];
  const s = signalsByRef.get(ref) ?? {};
  return { ref, name: s.name ?? null, where: s.where ?? null };
}

/** Group a drawer's refs into clusters. */
function clustersIn(refs, clusterOf) {
  const byCluster = new Map();
  for (const ref of refs) {
    const c = clusterOf.get(ref) ?? ref;
    if (!byCluster.has(c)) byCluster.set(c, []);
    byCluster.get(c).push(ref);
  }
  return byCluster;
}

/** Whether a cluster (one physical place, several refs) surfaces: notable on any
 * copy — so a place that resolves through the atlas/owned record where both an
 * atlas entry and a census id exist is kept if either shows evidence. */
const clusterNotable = (members, signalsByRef) =>
  members.some((m) => notable(signalsByRef.get(m) ?? emptySignals(m)).status === 'kept');

/**
 * One drawer's result. For a narrowed drawer: surfaced = has positive evidence;
 * notSurfaced = everything else. **Can't-speak governs FACTS, not this** (CLAUDE.md):
 * there is no can't-tell for surfacing, so the old dropped and can't-speak fold
 * together as notSurfaced, with the true reason (NOT_SURFACED_REASON). A
 * comparator drawer (museums, galleries, …) is a count and a sample only — the
 * predicate is never run on it.
 */
function drawerResult(sub, refs, signalsByRef, clusterOf, membersOf) {
  const byCluster = clustersIn(refs, clusterOf);
  // Notability is read across the FULL cluster (every alias of the place, via the
  // closure), not just the refs filed in this drawer — so evidence on a linked
  // twin (a Wikidata attraction with a Wikipedia url, provider-matched to the
  // filed church) surfaces the place, exactly as the apply check does (Codex,
  // preview == check).
  const full = (root, drawerRefs) => membersOf?.get(root) ?? drawerRefs;
  if (!sub.narrow) {
    const examples = [...byCluster.values()].slice(0, EXAMPLES).map((m) => clusterExample(m, signalsByRef));
    return { key: sub.key, label: sub.label, narrow: false, comparator: true, countNow: byCluster.size, examples };
  }
  const surfaced = [];
  const notSurfaced = [];
  for (const [root, drawerRefs] of byCluster) {
    const members = full(root, drawerRefs);
    const ex = clusterExample(drawerRefs, signalsByRef);
    const nm = members.find((m) => notable(signalsByRef.get(m) ?? emptySignals(m)).status === 'kept');
    if (nm) surfaced.push({ ...ex, why: notable(signalsByRef.get(nm)).signals.join('; ') });
    else notSurfaced.push({ ...ex, why: NOT_SURFACED_REASON });
  }
  return {
    key: sub.key, label: sub.label, narrow: true,
    // now = surfaced + notSurfaced, always (clusters, deduped).
    countNow: byCluster.size,
    surfaced: surfaced.length,
    notSurfaced: notSurfaced.length,
    examplesSurfaced: surfaced.slice(0, EXAMPLES),
    examplesNotSurfaced: notSurfaced.slice(0, EXAMPLES),
  };
}

/**
 * Culture now vs after, deduped across every Culture drawer. `now` is the
 * distinct Culture places; `after` leaves out only the places the rule holds
 * back — primary-filed in a narrowed drawer, not notable on any copy of the whole
 * place, and not filed in a non-low-attraction drawer (the exact Part B
 * determination, over the same closure), so the lead can read "Culture 270–330"
 * straight off it and it equals what applying hides.
 */
function cultureTotals(refsBySub, filingRows, signalsByRef, clusterOf, membersOf, elsewhereSet) {
  const allRefs = [...new Set([...refsBySub.values()].flat())];
  const primaryNarrowed = new Set(filingRows.filter((r) => r.is_primary && NARROWED.includes(r.sub)).map((r) => r.ref));
  const roots = new Set(allRefs.map((ref) => clusterOf.get(ref) ?? ref));
  let held = 0;
  for (const root of roots) {
    const members = membersOf?.get(root) ?? [root];
    const primaryHere = members.some((m) => primaryNarrowed.has(m));
    const elsewhere = members.some((m) => elsewhereSet.has(m));
    if (primaryHere && !elsewhere && !clusterNotable(members, signalsByRef)) held += 1;
  }
  return { now: roots.size, after: roots.size - held };
}

/**
 * The preview. `scope` is 'ring' (a drive-time ring from `where`) or 'estate'
 * (every place filed under each drawer). Read-only; returns numbers + examples.
 */
export async function narrowingPreview({
  scope = 'ring', where = null, lat = null, lng = null, minutes = 30, mode = 'driving',
} = {}) {
  const he = await heritageLoad();
  const keys = SUBCATEGORIES.map((s) => s.key);

  const assemble = async (filingRows, extra = {}) => {
    const refsBySub = new Map(keys.map((k) => [k, []]));
    for (const r of filingRows) if (refsBySub.has(r.sub)) refsBySub.get(r.sub).push(r.ref);
    const allRefs = [...new Set(filingRows.map((r) => r.ref))];
    // Expand the alias closure FIRST, then read signals and "filed elsewhere" over
    // EVERY cluster member — the same set runSurfacingCheck judges — so the report
    // the owner approves equals exactly what applying will do (Codex, preview == check).
    const { rootOf, membersOf } = await aliasClosure(allRefs);
    const allNodes = [...rootOf.keys()];
    const [signalsByRef, elsewhereSet] = await Promise.all([
      gatherSignals(allNodes, { heritageLoad: he.load }),
      filedElsewhere(allNodes),
    ]);
    const clusterOf = rootOf;
    return {
      scope,
      heritage: he,
      ...extra,
      subcategories: SUBCATEGORIES.map((s) => drawerResult(s, refsBySub.get(s.key) ?? [], signalsByRef, clusterOf, membersOf)),
      cultureTotal: cultureTotals(refsBySub, filingRows, signalsByRef, clusterOf, membersOf, elsewhereSet),
    };
  };

  if (scope === 'estate') {
    return assemble(await filingRowsFor({ keys }));
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
  const filingRows = await filingRowsFor({ refs: cultureRefs, keys });

  return assemble(filingRows, {
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
  });
}

/**
 * The proposed rule, in plain words, carried on the response so the owner reads
 * the measurement and the rule it measures together. It is a PROPOSAL; applying
 * it is a separate, approved step (Part B).
 */
export const PROPOSED_RULE = {
  applies_to: NARROWED,
  notable_when_any: [
    'It is a cathedral, abbey or minster — by an OSM building type, or by its own owned name (the word as what the place is, so "Westminster Abbey" and "York Minster" stay and "Abbey Road Studios" does not).',
    'It has an encyclopedia article — an atlas row or owned record with a Wikidata id or Wikipedia url, or a wikidata: reference.',
    'It has visitor facilities or opening hours — opening_hours, a website, or an OSM tourism / fee / wheelchair tag, from the venue\'s own page or our own copy of the open map.',
    'It is Grade I or II* listed, a scheduled monument, or a World Heritage Site — matched to the Historic England list on our own disk (migration 308).',
  ],
  not_surfaced: 'Ordinary parish churches, statues, memorials and plaques with no encyclopedia article, no listing, and no visitor facilities we hold.',
  not_surfaced_reason: NOT_SURFACED_REASON,
  not_surfaced_means: 'Kept in the data and in the back office exactly as now; left out of what families are shown and out of the Culture ring and area counts. Nothing is deleted or hidden, and it comes back on its own if evidence arrives through normal use (reversible).',
  cant_speak_note: 'Can\'t-speak governs FACTS, not surfacing (CLAUDE.md). A place with no notability evidence is simply "not surfaced" — there is no can\'t-tell here. The Historic England list shipped (migration 308); where a listing cannot be checked (outside England, or not loaded in an environment) the place is still not surfaced on the facts it has, never on a false "listing not loaded".',
  application_is_separate: true,
};
