/**
 * The closed check (decision C57, item 4): run the four readers over
 * everything Epic holds and write what each place's status would be.
 *
 * Free sources only, and as much as possible from what is already stored:
 *
 *   - Wikidata claims, fetched keyless through wbgetentities, fifty ids a
 *     call, paced by `sources/wikimedia.js`;
 *   - OpenStreetMap tags from our own extract (`osm_features`) — no Overpass;
 *   - the Wikipedia text and categories already held on the atlas row and in
 *     `place_records.summary`;
 *   - a Google status already derived and stored by the drawer — never a new
 *     Google call.
 *
 * Every row is written with `applied = false`. Nothing is hidden from a family
 * until the owner has read the report and applied it (`applyProposed`).
 *
 * Can't speak: a Wikidata batch that fails is counted as unread and its places
 * get no Wikidata finding — never "no closure found".
 */

import { query } from '../db.js';
import {
  combine, confirmation, familyVerdict, googleVerdict, heritageOf, osmVerdict, successorFromText, wikidataOsmRef, wikidataVerdict, wikidataWebsite, wikipediaVerdict,
} from '../domain/openStatus.js';
import { metresBetween, normaliseName } from '../domain/matchFence.js';
import { nearByName } from './osmExtract.js';
import * as statusRepo from '../repositories/placeStatus.js';
import { entityClaims, entityLabels, sparql } from './wikimedia.js';
import { HERITAGE_KINDS, HERITAGE_ROOTS } from '../domain/openStatus.js';

const BATCH = 50;

const km = (a, b) => {
  if (a?.lat == null || b?.lat == null) return Infinity;
  const r = Math.PI / 180;
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r);
  const y = (b.lat - a.lat) * r;
  return Math.sqrt(x * x + y * y) * 6371;
};
const plain = (s) => String(s ?? '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** The atlas, each row with what confirms it (item 3) — read in one statement. */
async function atlasRows(only = null) {
  const { rows } = await query(
    `select a.id, a.name, a.wikidata_id, a.venue_ref, coalesce(a.venue_ref, 'atlas:' || a.id::text) as ref,
            a.summary, a.summary_source, a.osm_ref, a.website, a.source, a.external_ref, a.lat, a.lng, a.region_slug,
            a.visiting_evidence -> 'categories' as categories, a.kinds, a.category,
            (select pi.subcategory from place_index pi where pi.venue_ref = coalesce(a.venue_ref, 'atlas:' || a.id::text)) as subcategory,
            (select m.osm_ref from atlas_osm_matches m where m.attraction_id = a.id) as matched_osm,
            -- A match that was asked for and found nothing is not a Google id
            -- (\`missing\`): the first dry run read those as confirmation.
            ( a.venue_ref like 'google:%' or a.external_ref like 'google:%' or a.source = 'google'
              or exists (select 1 from provider_matches m where m.venue_ref = 'wikidata:' || a.wikidata_id and m.source = 'google' and not m.missing)
              or exists (select 1 from place_index_sources x where x.venue_ref = coalesce(a.venue_ref, 'atlas:' || a.id::text) and x.source = 'google')
            ) as google_id,
            coalesce(case when a.osm_ref is not null then a.osm_ref end,
                     case when a.venue_ref like 'osm:%' then substr(a.venue_ref, 5) end,
                     (select pr.osm_ref from place_records pr where pr.venue_ref = a.venue_ref)) as any_osm,
            coalesce(a.website, (select pr.website from place_records pr where pr.venue_ref = a.venue_ref)) as any_website,
            exists (select 1 from place_index pi where pi.venue_ref = coalesce(a.venue_ref, 'atlas:' || a.id::text)
                       and (pi.censused_at is not null or pi.found_by is not null)) as censused
       from attractions a
      ${only ? 'where a.id = any($1::uuid[])' : ''}`, only ? [only] : []);
  return rows;
}

/** Owned records with something to read that the atlas has not already covered. */
async function recordRows(only = null) {
  const { rows } = await query(
    `select pr.venue_ref as ref, pr.name, pr.wikidata_id, pr.osm_ref, pr.website, pr.summary, pr.summary_source, pr.lat, pr.lng,
            (select pi.subcategory from place_index pi where pi.venue_ref = pr.venue_ref) as subcategory
       from place_records pr
      where (pr.wikidata_id is not null or pr.osm_ref is not null or pr.summary is not null)
        and not exists (select 1 from attractions a where a.venue_ref = pr.venue_ref)
        ${only ? 'and pr.venue_ref = any($1::text[])' : ''}`, only ? [only] : []);
  return rows;
}

/**
 * Places we hold by an OpenStreetMap ref whose own tags carry a lifecycle
 * mark — the only way a map feature can say it has ended. Filtered in SQL so
 * the whole index is never read into memory.
 */
async function osmMarked() {
  const { rows } = await query(
    `select pi.venue_ref as ref, f.name, f.tags, f.lat, f.lng
       from place_index pi join osm_features f on f.ref = substr(pi.venue_ref, 5)
      where pi.venue_ref like 'osm:%'
        and (f.tags ?| array['disused','abandoned','demolished','razed','destroyed','removed','replaced_by']
             or lower(f.tags ->> 'opening_hours') in ('closed', 'off')
             or exists (select 1 from jsonb_object_keys(f.tags) k where k ~ '^(disused|was|demolished|abandoned|razed|removed|destroyed|dismantled):'))`);
  return rows;
}

/** OSM tags for the refs a row names: 'node/1', 'way/2', or a bare relation id from Wikidata's P402. */
async function tagsFor(osmRefs) {
  const want = new Map();
  for (const raw of osmRefs) {
    const r = String(raw ?? '').replace(/^osm:/, '');
    if (!r) continue;
    want.set(raw, /^\d+$/.test(r) ? `relation/${r}` : r);
  }
  if (!want.size) return new Map();
  const { rows } = await query(`select ref, tags from osm_features where ref = any($1::text[])`, [[...new Set(want.values())]]);
  const byRef = new Map(rows.map((r) => [r.ref, r.tags]));
  return new Map([...want].filter(([, v]) => byRef.has(v)).map(([k, v]) => [k, byRef.get(v)]));
}

/** Google's derived status, by the ref of the place its id was matched to. */
async function googleByMatch() {
  const { rows } = await query(
    `select m.venue_ref, s.status, s.reason, s.evidence
       from provider_matches m join place_status s on s.venue_ref = 'google:' || m.source_ref and s.source = 'google'
      where m.source = 'google' and not m.missing`);
  return new Map(rows.map((r) => [r.venue_ref, r]));
}

/** The latest visit any household recorded at each ref. */
async function lastVisits() {
  const { rows } = await query(`select venue_ref, max(visited_on)::text as on from visits where visited_on is not null group by venue_ref`);
  return new Map(rows.map((r) => [r.venue_ref, String(r.on).slice(0, 10)]));
}

/** Every kind's root in the atlas's own subclass walk (P279*), so heritage can be read off a P31. */
async function kindRoots() {
  const { rows } = await query(`select qid, root_qid from place_kinds where root_qid is not null`);
  return new Map(rows.map((r) => [r.qid, [r.root_qid]]));
}

/**
 * The P279 chain for kinds our own walk never filed: which heritage class,
 * if any, each descends from. Asked only for items that carry a closure, so
 * the question is small. Every heritage class a kind descends from is kept.
 * A failed walk leaves those kinds unfiled — which reads as "not heritage"
 * and so can close — and the run's counts say how many (`kindsUnwalked`).
 */
export async function heritageSuperclasses(kinds) {
  const out = new Map();
  const targets = [...new Set([...HERITAGE_ROOTS, ...HERITAGE_KINDS])].map((q) => `wd:${q}`).join(' ');
  for (let i = 0; i < kinds.length; i += 150) {
    const slice = kinds.slice(i, i + 150);
    const rows = await sparql(`SELECT ?k ?root WHERE { VALUES ?k { ${slice.map((q) => `wd:${q}`).join(' ')} } VALUES ?root { ${targets} } ?k wdt:P279* ?root . }`);
    for (const r of rows) {
      const k = String(r.k?.value ?? r.k).split('/').pop();
      const root = String(r.root?.value ?? r.root).split('/').pop();
      out.set(k, [...(out.get(k) ?? []), root]);
    }
  }
  return out;
}

/** Refs matched to a listed building, where the heritage list is loaded (migration 293, another session's). */
async function listedRefs() {
  const { rows: [t] } = await query(`select to_regclass('heritage_links') is not null as there`);
  if (!t?.there) return new Set();
  const { rows } = await query(`select distinct venue_ref from heritage_links`);
  return new Set(rows.map((r) => r.venue_ref));
}

/**
 * The same name, strictly enough to fail closed. Equal after normalising, or
 * one containing the other where the shorter is most of the longer — "Selby
 * Abbey" and "Selby Abbey Church", never "Windsor" and "Windsor Castle".
 */
export function namesMatch(a, b) {
  const x = normaliseName(a); const y = normaliseName(b);
  if (!x || !y) return null;
  if (x === y) return 'same_name';
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 6 && long.includes(short) && short.length / long.length >= 0.6 ? 'name_agrees' : null;
}

/**
 * The fence for a match: a node is a point and must be close; a way or a
 * relation is drawn at its centre, which can sit well inside a big site.
 */
export const matchFenceM = (osmRef) => (String(osmRef).startsWith('node/') ? 150 : 400);

/**
 * One atlas place against the open map (owner, 29 Sep 2026, item 3). The
 * named features near it whose name matches; exactly one, or none — two
 * candidates that both match is a place we cannot tell apart, and a wrong
 * match would confirm the wrong thing.
 */
export function pickMatch(place, candidates) {
  const hits = [];
  for (const c of candidates ?? []) {
    const how = namesMatch(place.name, c.tags?.name ?? c.name);
    if (!how) continue;
    const metres = metresBetween(place, c);
    if (metres > matchFenceM(c.ref)) continue;
    hits.push({ ref: c.ref, name: c.tags?.name ?? c.name, metres, how, tags: c.tags ?? null });
  }
  const same = hits.filter((h) => h.how === 'same_name');
  const pool = same.length ? same : hits;
  if (pool.length !== 1) return null;
  return pool[0];
}

/** Stems a name can be looked up by: its two longest words. */
const stemsOf = (name) => String(name ?? '').split(/[^\p{L}\p{N}']+/u).filter((w) => w.length >= 4)
  .sort((a, b) => b.length - a.length).slice(0, 2);

/**
 * Run it. `fetchClaims` is injectable so the tests never reach Wikidata.
 * Returns the counts the run wrote to `closed_checks`.
 */
/**
 * The matching pass (owner, 29 Sep 2026, item 3): every atlas place with no
 * open-map ref, no venue ref and no website is looked for on our own copy of
 * the extract, by name within the fence. Free. Written at once — a match can
 * only confirm a place, never hide one (migration 299 says why it is its own
 * table). `near` is injectable for the tests.
 */
export async function matchAtlasToOpenMap(rows, { checkId = null, near = featuresNear } = {}) {
  const out = new Map();
  for (const a of rows) {
    if (a.lat == null || a.lng == null || !a.name) continue;
    const stems = stemsOf(a.name);
    if (!stems.length) continue;
    let candidates;
    try { candidates = await near(Number(a.lat), Number(a.lng), 400, stems); } catch { continue; }
    const hit = pickMatch({ name: a.name, lat: Number(a.lat), lng: Number(a.lng) }, candidates);
    if (!hit) continue;
    await query(
      `insert into atlas_osm_matches (attraction_id, osm_ref, osm_name, metres, how, check_id)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (attraction_id) do update set osm_ref = excluded.osm_ref, osm_name = excluded.osm_name,
         metres = excluded.metres, how = excluded.how, check_id = excluded.check_id, matched_at = now()`,
      [a.id, hit.ref, hit.name, Math.round(hit.metres), hit.how, checkId]);
    out.set(a.id, hit);
  }
  return out;
}

/** Named features near a point whose name holds any of these stems, from our own extract. */
async function featuresNear(lat, lng, radiusM, stems) {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const re = stems.map((x) => String(x).replace(/[^\p{L}\p{N} '-]/gu, '')).filter(Boolean).join('|');
  if (!re) return [];
  const { rows } = await query(
    `select ref, name, lat, lng, tags from osm_features
      where lat between $1 and $2 and lng between $3 and $4 and name ~* $5 limit 60`,
    [lat - dLat, lat + dLat, lng - dLng, lng + dLng, `(${re})`]);
  return rows;
}

/**
 * Run it. `fetchClaims` and `near` are injectable so the tests never reach
 * Wikidata or need an extract. Returns the counts the run wrote to
 * `closed_checks`.
 */
export async function runClosedCheck({
  by = null, dryRun = true, fetchClaims = entityClaims, today, pause = 0, near = featuresNear, superclasses = heritageSuperclasses,
  fetchLabels = entityLabels,
  // One place's rows, for `checkPlace`: no run is recorded, and nothing else is read.
  only = null,
} = {}) {
  const checkId = only ? null : await statusRepo.startCheck({ by, dryRun });
  const counts = {
    atlas: 0, records: 0, osmMarked: 0, wikidataAsked: 0, wikidataRead: 0, wikidataUnread: 0,
    written: 0, cleared: 0, byStatus: {}, unconfirmed: 0, review: 0, successors: 0,
    osmLooked: 0, osmMatched: 0, heritage: 0, history: 0, churchReview: 0, confirmedBy: {},
  };
  try {
    const [atlas, records, marked, existing, roots, listed, visited, googleSaid] = await Promise.all([
      atlasRows(only?.atlasIds ?? null), recordRows(only?.recordRefs ?? null), only ? [] : osmMarked(),
      query(`select venue_ref, status, source, reason, evidence, review, review_since from place_status`).then((r) => r.rows),
      kindRoots(), listedRefs(), lastVisits(), googleByMatch(),
    ]);
    counts.atlas = atlas.length; counts.records = records.length; counts.osmMarked = marked.length;
    const held = new Map(existing.map((r) => [r.venue_ref, r]));
    // Every name a place goes by, for reading its visits.
    const latestVisit = (place) => {
      const names = [place.ref, place.id ? `atlas:${place.id}` : null, place.wikidata_id ? `wikidata:${place.wikidata_id}` : null,
        place.any_osm ? `osm:${String(place.any_osm).replace(/^osm:/, '')}` : null, place.matched_osm ? `osm:${place.matched_osm}` : null].filter(Boolean);
      return names.map((n) => visited.get(n)).filter(Boolean).sort().at(-1) ?? null;
    };


    // Wikidata, fifty at a time. A failed batch is unread, not "nothing found".
    const qids = [...new Set([...atlas, ...records].map((r) => r.wikidata_id).filter((q) => /^Q\d+$/.test(String(q ?? ''))))];
    counts.wikidataAsked = qids.length;
    const claims = new Map();
    for (let i = 0; i < qids.length; i += BATCH) {
      const slice = qids.slice(i, i + BATCH);
      try {
        const got = await fetchClaims(slice);
        if (!(got instanceof Map)) throw new Error('not a map');
        for (const [k, v] of got) claims.set(k, v);
        counts.wikidataRead += got.size;
        counts.wikidataUnread += slice.filter((q) => !got.has(q)).length;
      } catch (err) {
        counts.wikidataUnread += slice.length;
        counts.lastWikidataError = String(err?.message ?? err).slice(0, 160);
      }
      if (pause) await new Promise((r) => setTimeout(r, pause));
    }

    // What Wikidata itself says links the item to something current (owner,
    // 29 Sep 2026): its OpenStreetMap relation, node or way id (P402, P11693,
    // P10689 — ids checked against the live API that day) and its official
    // website (P856). A Wikidata OSM id is written as the atlas row's
    // open-map match, `how` naming the property, so which one confirmed the
    // place is on record; a website is `confirmed_by = 'website'`.
    for (const a of atlas) {
      const e = a.wikidata_id ? claims.get(a.wikidata_id) : null;
      if (!e) continue;
      a.wikidata_website = wikidataWebsite(e);
      const link = wikidataOsmRef(e);
      if (link && !a.any_osm && !a.matched_osm) {
        await query(
          `insert into atlas_osm_matches (attraction_id, osm_ref, osm_name, metres, how, check_id)
           values ($1, $2, null, 0, $3, $4)
           on conflict (attraction_id) do update set osm_ref = excluded.osm_ref, metres = 0, how = excluded.how, check_id = excluded.check_id, matched_at = now()`,
          [a.id, link.ref, link.how, checkId]);
        a.matched_osm = link.ref;
        counts.wikidataOsm = (counts.wikidataOsm ?? 0) + 1;
      }
    }

    // Then the matching pass, for what neither the row nor Wikidata links:
    // what it finds confirms and is read.
    const unlinked = atlas.filter((a) => a.source === 'wikidata' && !a.any_osm && !a.matched_osm && !a.venue_ref && !a.any_website && !a.wikidata_website);
    counts.osmLooked = unlinked.length;
    const matched = await matchAtlasToOpenMap(unlinked, { checkId, near });
    counts.osmMatched = matched.size;
    for (const a of atlas) if (matched.has(a.id)) a.matched_osm = matched.get(a.id).ref;

    // Heritage by the P279 chain, for kinds on items that carry a closure and
    // that our own walk never filed (a place record's kinds, mostly).
    const closing = (e) => ['P576', 'P3999', 'P5817'].some((p) => e?.claims?.[p]?.length);
    const unfiled = [...new Set([...claims.values()].filter(closing)
      .flatMap((e) => (e.claims.P31 ?? []).map((c) => c.mainsnak?.datavalue?.value?.id))
      .filter((k) => k && !roots.has(k) && !HERITAGE_KINDS.has(k)))];
    counts.kindsWalked = unfiled.length;
    try {
      for (const [k, found] of await superclasses(unfiled)) roots.set(k, found);
    } catch (err) {
      counts.kindsUnwalked = unfiled.length;
      counts.lastWalkError = String(err?.message ?? err).slice(0, 160);
    }

    // Successor names for a "replaced by" we do not hold (owner, 29 Sep 2026:
    // "Dalí Universe's successor shows a name, not an ID"): the English label,
    // read keyless in batches. A failed batch leaves the Q-id, as before.
    const heldQids = new Set([...atlas, ...records].map((r) => r.wikidata_id).filter(Boolean));
    const wanted = [...new Set([...claims.values()].flatMap((e) => (e.claims?.P1366 ?? []).map((c) => c.mainsnak?.datavalue?.value?.id))
      .filter((q) => /^Q\d+$/.test(String(q ?? '')) && !heldQids.has(q)))];
    const labels = new Map();
    for (let i = 0; i < wanted.length; i += BATCH) {
      try { for (const [k, v] of await fetchLabels(wanted.slice(i, i + BATCH))) labels.set(k, v); } catch (err) { counts.labelsUnread = (counts.labelsUnread ?? 0) + Math.min(BATCH, wanted.length - i); }
    }

    const tags = await tagsFor([
      ...atlas.map((a) => a.any_osm), ...atlas.map((a) => a.matched_osm), ...records.map((r) => r.osm_ref),
    ].filter(Boolean));

    // Where a successor can be found: every place we hold with a Wikidata id
    // or a name, so "now Legoland Windsor" becomes a link.
    const byQid = new Map();
    const named = [];
    for (const a of atlas) {
      if (a.wikidata_id && !byQid.has(a.wikidata_id)) byQid.set(a.wikidata_id, a.ref);
      if (a.name) named.push({ ref: a.ref, name: plain(a.name), lat: a.lat, lng: a.lng });
    }
    for (const r of records) {
      if (r.wikidata_id && !byQid.has(r.wikidata_id)) byQid.set(r.wikidata_id, r.ref);
      if (r.name) named.push({ ref: r.ref, name: plain(r.name), lat: r.lat, lng: r.lng });
    }
    const successorRef = (qidOf, nameOf, self) => {
      if (qidOf && byQid.has(qidOf)) return byQid.get(qidOf);
      if (nameOf) {
        const want = plain(nameOf);
        const hit = named.filter((n) => n.name === want && n.ref !== self.ref).sort((x, y) => km(self, x) - km(self, y))[0];
        if (hit && km(self, hit) <= 10) return hit.ref;
      }
      return null;
    };

    const siteOf = (kinds, category, subcategory, ref) => heritageOf({
      kinds, roots: (kinds ?? []).flatMap((k) => roots.get(k) ?? []), category, subcategory, listed: listed.has(ref),
    });
    const p31 = (e) => (e?.claims?.P31 ?? []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean);

    const seen = new Set();
    const settle = async (place, findings, confirm, { wikidataId = null, text = null, site = null } = {}) => {
      if (seen.has(place.ref)) return;
      seen.add(place.ref);
      const prior = held.get(place.ref);
      if (prior?.source === 'person') return;
      // A Google status already stored outranks every encyclopedia, so it goes
      // into the settling as a finding.
      if (prior?.source === 'google') {
        findings.push({ source: prior.source, status: prior.status, reason: prior.reason, evidence: prior.evidence, review: false });
      }
      let v = combine(findings);
      // A place in review settles on Google's status for the id it was
      // matched to (provider_matches), when details were fetched for it. Only
      // for a question: a match is not trusted to overturn a firm reading.
      if (v.review) {
        const g = (place.wikidata_id && googleSaid.get(`wikidata:${place.wikidata_id}`)) || googleSaid.get(place.ref);
        if (g) { v = combine([...findings, { source: 'google', status: g.status, reason: g.reason, evidence: g.evidence, review: false }]); counts.googleSettled = (counts.googleSettled ?? 0) + 1; }
      }
      // A family went, after the evidence that made it a question: that is
      // current evidence it is open (owner, 29 Sep 2026: review settles
      // itself). Only for a place in review; never over a closure.
      if (v.review) {
        const went = familyVerdict({ visitedOn: latestVisit(place), evidence: `${v.reason ?? ''} ${v.evidence ?? ''}`, flaggedAt: prior?.review ? prior.review_since : null, today });
        if (went) { v = { ...v, ...went, successorQid: v.successorQid, successorName: v.successorName }; counts.familySettled = (counts.familySettled ?? 0) + 1; }
      }
      // Always look for a successor, whichever source spoke (owner, item 4):
      // Wikidata's "replaced by", or "now X" / "converted into X" / "became X".
      const successorName = v.successorName ?? successorFromText(text) ?? (v.successorQid ? labels.get(v.successorQid) ?? null : null);
      const succ = successorRef(v.successorQid, successorName, place);
      const row = {
        ref: place.ref, wikidataId, status: v.status, confirmed: confirm.confirmed, confirmedBy: confirm.by,
        reason: v.reason, source: v.source, evidence: v.evidence, review: v.review,
        successorRef: succ, successorName: successorName ?? (v.successorQid && !succ ? v.successorQid : null),
      };
      if (site?.heritage) counts.heritage += 1;
      if (v.history) counts.history += 1;
      if (site?.church && v.review && /church/.test(String(v.reason))) counts.churchReview += 1;
      const worth = row.status !== 'unknown' || row.review || !row.confirmed || v.history || prior;
      if (!worth) return;
      await statusRepo.propose(row, { checkId });
      counts.written += 1;
      if (prior && row.status === 'unknown' && !row.review && row.confirmed) counts.cleared += 1;
      counts.byStatus[row.status] = (counts.byStatus[row.status] ?? 0) + 1;
      if (!row.confirmed) counts.unconfirmed += 1;
      if (row.review) counts.review += 1;
      if (succ) counts.successors += 1;
    };

    for (const a of atlas) {
      const entity = a.wikidata_id ? claims.get(a.wikidata_id) : null;
      const site = siteOf([...new Set([...(a.kinds ?? []), ...p31(entity)])], a.category, a.subcategory, a.ref);
      const osm = a.any_osm ?? a.matched_osm;
      const findings = [
        entity ? wikidataVerdict(entity, { today, site }) : null,
        osm && tags.has(osm) ? osmVerdict(tags.get(osm)) : null,
        wikipediaVerdict({ text: a.summary, name: a.name, categories: Array.isArray(a.categories) ? a.categories : [], source: /wikipedia/i.test(a.summary_source ?? 'wikipedia') ? 'wikipedia' : 'listing', site }),
      ];
      // Only an atlas place from Wikidata/Wikipedia can be unconfirmed; a place
      // a sweep found through Google, the map or a household is current by birth.
      const confirm = a.source === 'wikidata'
        ? confirmation({ ref: a.venue_ref, googleId: a.google_id, osmRef: osm, website: a.any_website ?? a.wikidata_website, censused: a.censused })
        : { confirmed: true, by: a.source === 'google' ? 'google' : a.source === 'osm' ? 'osm' : null };
      if (confirm.by) counts.confirmedBy[confirm.by] = (counts.confirmedBy[confirm.by] ?? 0) + 1;
      await settle(a, findings, confirm, { wikidataId: a.wikidata_id ?? null, text: a.summary, site });
    }
    for (const r of records) {
      const entity = r.wikidata_id ? claims.get(r.wikidata_id) : null;
      const site = siteOf(p31(entity), null, r.subcategory, r.ref);
      const isWiki = /wikipedia/i.test(r.summary_source ?? '');
      const findings = [
        entity ? wikidataVerdict(entity, { today, site }) : null,
        r.osm_ref && tags.has(r.osm_ref) ? osmVerdict(tags.get(r.osm_ref)) : null,
        isWiki ? wikipediaVerdict({ text: r.summary, name: r.name, source: 'wikipedia', site }) : null,
      ];
      await settle(r, findings, { confirmed: true, by: null }, { wikidataId: r.wikidata_id ?? null, text: isWiki ? r.summary : null, site });
    }
    for (const m of marked) {
      await settle(m, [osmVerdict(m.tags)], { confirmed: true, by: 'osm' });
    }
    // A row an earlier check wrote that this one did not read — the first run
    // closed map places on `end_date`, which is no longer read at all — is
    // read again by today's rules rather than left standing on yesterday's.
    // A person's word and Google's status are not a check's to revisit.
    const stale = only ? [] : existing.filter((r) => !seen.has(r.venue_ref) && ['osm', 'wikidata', 'wikipedia', 'listing'].includes(r.source));
    const staleTags = await tagsFor(stale.map((r) => r.venue_ref).filter((r) => r.startsWith('osm:')));
    for (const r of stale) {
      const t = staleTags.get(r.venue_ref);
      await settle({ ref: r.venue_ref }, t ? [osmVerdict(t)] : [], { confirmed: true, by: null });
      counts.reread = (counts.reread ?? 0) + 1;
    }
    if (checkId) await statusRepo.finishCheck(checkId, { counts });
    return { checkId, ...counts };
  } catch (err) {
    if (checkId) await statusRepo.finishCheck(checkId, { counts, error: String(err?.message ?? err).slice(0, 300) }).catch(() => null);
    throw err;
  }
}

/**
 * The drawer's hook for Google's business status (see /tmp/c57-google.patch):
 * `google.js` hands over the status of a place whose details it has just
 * fetched; only our derived flag is stored.
 */
export async function onGoogleStatus(ref, businessStatus) {
  const v = googleVerdict(businessStatus);
  if (!v) return;
  await statusRepo.noteGoogleStatus(ref, v).catch((err) => console.warn(`place_status ${ref}: ${String(err?.message ?? err).slice(0, 120)}`));
  // The atlas place Google's id was matched to, if it was in review, is
  // judged again with Google's word in it: operational settles it open, a
  // closure closes it (owner, 29 Sep 2026). Behind the fetch.
  if (!String(ref).startsWith('google:')) return;
  const { rows } = await query(
    `select venue_ref from provider_matches where source = 'google' and not missing and source_ref = $1`, [String(ref).slice(7)]).catch(() => ({ rows: [] }));
  for (const r of rows) void onResearched(r.venue_ref);
}

/**
 * One place, re-judged from what we hold — for a place in review, when
 * something new arrives about it (owner, 29 Sep 2026: review items "settle
 * automatically when the place is researched … or when families answer").
 * Nothing queues for a person. A place not in review is left alone: this is
 * how a question settles, not a second check.
 *
 * Returns what it did, or null when there was nothing to re-judge.
 */
/** Both spellings of an open-map ref, without the prefix: 'relation/123' ↔ '123'. */
export function osmSpellings(ref) {
  const bare = String(ref ?? '').replace(/^osm:/, '');
  if (!bare) return [];
  const rel = /^relation\/(\d+)$/.exec(bare);
  if (rel) return [bare, rel[1]];
  if (/^\d+$/.test(bare)) return [bare, `relation/${bare}`];
  return [bare];
}

export async function checkPlace(ref, opts = {}) {
  if (!ref) return null;
  const r = String(ref);
  const { rows: atlasHits } = await query(
    `select a.id, coalesce(a.venue_ref, 'atlas:' || a.id::text) as ref from attractions a
      where a.venue_ref = $1 or 'atlas:' || a.id::text = $1
         or ($1 like 'wikidata:%' and a.wikidata_id = substr($1, 10))
         -- An open-map ref in either spelling: 'osm:relation/123' is the
         -- atlas's bare '123' (Wikidata's P402), and the reverse — the same
         -- two forms placeStatus.js expands, on the row and on its match.
         or ($1 like 'osm:%' and (
              a.osm_ref = any($2::text[])
              or exists (select 1 from atlas_osm_matches m where m.attraction_id = a.id and m.osm_ref = any($2::text[]))))`,
    [r, osmSpellings(r)]);
  const refs = [r, ...atlasHits.map((a) => a.ref)];
  const { rows: [inReview] } = await query(`select 1 from place_status where venue_ref = any($1::text[]) and review limit 1`, [refs]);
  if (!inReview) return null;
  return runClosedCheck({ ...opts, by: 'checkPlace', only: { atlasIds: atlasHits.map((a) => a.id), recordRefs: [r] } });
}

/** A family's visit, recorded: the place it was at settles if it was in review. */
export async function onVisitRecorded(ref) {
  try { return await checkPlace(ref, { near: async () => [] }); } catch (err) { console.warn(`checkPlace ${ref}: ${String(err?.message ?? err).slice(0, 120)}`); return null; }
}

/** Research landed for a place: if it was in review, judge it again (sources/own.js onResearched). */
export async function onResearched(ref) {
  try { return await checkPlace(ref); } catch (err) { console.warn(`checkPlace ${ref}: ${String(err?.message ?? err).slice(0, 120)}`); return null; }
}
