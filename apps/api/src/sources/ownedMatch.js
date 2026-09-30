/**
 * Matching a place to an owned point (owner, C59 steps 4 and 6, 30 Sep 2026):
 * "match every place we hold to an owned source in the order Wikidata → FSA →
 * Historic England → OS → OSM, and store that point permanently", once as a
 * backfill and again every week for the places still unmatched.
 *
 * A match needs something to match on. A place is matched by its name near a
 * point: the name and the point may be rented (a Google name the sweep kept, a
 * Google point the index holds for thirty days) — they are read in memory to
 * find the owned twin and never written — and the point written is always the
 * owned source's own. A place with no name and no identifier of its own —
 * most of the census, which is identifiers only — cannot be matched, and says
 * so ("no key") rather than being guessed from a box and a category.
 *
 * The can't-speak rule (CLAUDE.md): a name that is not clearly the same place,
 * or two candidates that both are, is no match. A wrong owned point is worse
 * than none, because it is kept for good.
 */

import { query, pool } from '../db.js';
import { nameScore, metresBetween, significantStems } from './openMatch.js';
import { recordOwnedPoint, RENTED_SOURCES } from './ownedPoints.js';

/** How far from the point each source's twin may be, and how alike the names must be. */
export const RULES = {
  fsa: { radiusM: 150, score: 0.85 },
  'historic-england': { radiusM: 250, score: 0.85 },
  'os-open-names': { radiusM: 600, score: 0.9 },
  osm: { radiusM: 150, score: 0.85 },
};
// Where all a place has is its census box, the whole box is searched, and only
// a name that is the same word for word, and alone in the box, is taken.
const BOX_SCORE = 0.99;
// Accented letters folded to their plain ones, for the stem prefilter.
const FOLD_FROM = 'áàâäãåāéèêëēíìîïīóòôöõøōúùûüūçñýÿœæ';
const FOLD_TO = 'aaaaaaaeeeeeiiiiiooooooouuuuucnyyoa';

const box = (lat, lng, radiusM) => {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return [lat - dLat, lat + dLat, lng - dLng, lng + dLng];
};

// The live load of each, the last that arrived whole — never one being written.
const LIVE = (source) => `load_id = (select live_load from owned_source_loads where source = '${source}') and`;
const TABLES = {
  fsa: { sql: `select fhrsid::text as id, name, lat, lng from fsa_establishments where ${LIVE('fsa')}` },
  'historic-england': { sql: `select layer || ':' || list_entry as id, name, lat, lng from heritage_entries where ${LIVE('historic-england')}` },
  'os-open-names': { sql: `select id, name, lat, lng from os_names where ${LIVE('os-open-names')}` },
  // The open map, from our own copy of it (sources/osmExtract.js).
  osm: { sql: 'select ref as id, name, lat, lng from osm_features where' },
};

/**
 * The one candidate in a source that is clearly this place, or null.
 * `near` is { lat, lng, radiusM } — a point, or a census box's centre with the
 * box's half-diagonal, which asks for a stricter name.
 */
export async function candidateIn(source, name, near, { strict = false } = {}) {
  const t = TABLES[source];
  const radiusM = near.radiusM ?? RULES[source].radiusM;
  // A census box is searched as the rectangle it is, never a circle round its
  // centre that reaches over its edges (Codex, 30 Sep 2026).
  const [a, b, c, d] = near.bounds
    ? [near.bounds.minLat, near.bounds.maxLat, near.bounds.minLng, near.bounds.maxLng]
    : box(near.lat, near.lng, radiusM);
  // Narrowed by the name's own stems in the database, so a city's census box
  // is not cut short at an arbitrary row: every candidate that could be this
  // place, or a rival to it, is read. A list that still reaches the cap cannot
  // show a match is alone, and is no match (Codex, 30 Sep 2026).
  const CAP = 5000;
  const stems = significantStems(name).map((x) => x.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  const params = [a, b, c, d];
  if (stems.length) params.push(`(${stems.join('|')})`);
  const { rows } = await query(
    // Accents folded as the stems were, so a Café is found by "cafe" (Codex).
    `${t.sql} lat between $1 and $2 and lng between $3 and $4
       ${stems.length ? `and translate(lower(name), '${FOLD_FROM}', '${FOLD_TO}') ~ $5` : ''} limit ${CAP + 1}`, params);
  if (rows.length > CAP) return { ambiguous: `more than ${CAP} candidates` };
  const need = strict ? BOX_SCORE : RULES[source].score;
  const good = rows
    .map((r) => ({ ...r, score: nameScore(name, r.name), distanceM: metresBetween({ lat: near.lat, lng: near.lng }, { lat: r.lat, lng: r.lng }) }))
    .filter((r) => r.score >= need && (near.bounds ? true : r.distanceM <= radiusM));
  if (!good.length) return null;
  good.sort((x, y) => y.score - x.score || x.distanceM - y.distanceM);
  // Two that are both clearly it — a chain's branches in one box — is no match.
  const best = good[0];
  // Judged by where the two are, not by how far each is from here: two the
  // same distance away in opposite directions are two places (Codex, 30 Sep 2026).
  const rival = good.find((r) => r !== best && r.score >= best.score - 0.05
    && metresBetween({ lat: r.lat, lng: r.lng }, { lat: best.lat, lng: best.lng }) > 50);
  if (rival) return { ambiguous: 'two candidates are both it' };
  return best;
}

/** Wikidata's own coordinate (P625) for each of a list of items, read from Wikidata. */
export async function wikidataPoints(ids, fetcher = fetch) {
  const out = new Map();
  const list = [...new Set(ids.filter((q) => /^Q\d+$/.test(q)))];
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${chunk.join('|')}&props=claims&format=json`;
    const res = await fetcher(url, { headers: { 'user-agent': 'Epic (epic.day) owned points; roger@epic.day' }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`Wikidata answered ${res.status}`);
    const body = await res.json();
    for (const [q, e] of Object.entries(body.entities ?? {})) {
      const v = e?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
      if (v && Number.isFinite(v.latitude) && Number.isFinite(v.longitude)) out.set(q, { lat: v.latitude, lng: v.longitude });
    }
  }
  return out;
}

/**
 * One place: the owned point it should have, or null with the reason.
 * `place` is { ref, names: [...], point: {lat,lng} | null, box: {lat,lng,radiusM} | null, wikidataId, wikidataPoint }.
 */
export async function matchPlace(place) {
  const prefix = String(place.ref).split(':')[0];
  // Wikidata first, in the owner's order, even for a place the open map names.
  if (place.wikidataPoint) {
    return { source: 'wikidata', ...place.wikidataPoint, sourceRef: place.wikidataId, method: 'reference' };
  }
  // The reference is itself owned: its own point, by reference.
  if (prefix === 'osm') {
    const { rows: [r] } = await query('select lat, lng from osm_features where ref = $1', [place.ref.slice(4)]);
    if (r) return { source: 'osm', lat: r.lat, lng: r.lng, sourceRef: place.ref.slice(4), method: 'reference' };
  }
  // A name is matched only for a place whose point is rented. One whose point
  // is already ours — a household's own pin, an atlas or open-map place — is
  // never moved onto somebody else's feature by a name (Codex, 30 Sep 2026).
  if (!(place.rented ?? RENTED_SOURCES.includes(prefix))) return { none: 'its point is already ours' };
  const names = [...new Set((place.names ?? []).filter((n) => n && !/^\(.*\)$/.test(n) && n !== place.ref))];
  if (!names.length) return { none: 'no name to match on' };
  const near = place.point ?? place.box;
  if (!near) return { none: 'no point or box to match near' };
  const strict = !place.point;
  for (const source of ['fsa', 'historic-england', 'os-open-names', 'osm']) {
    // Every name the place is held under asked of this source: two names that
    // point at two different places is no match, not the first one's (Codex).
    const hits = [];
    for (const name of names) {
      const hit = await candidateIn(source, name, strict ? near : { ...near, radiusM: RULES[source].radiusM }, { strict });
      // A source that cannot tell which of its places this is has spoken: a
      // lower one is not asked to break the tie (Codex, 30 Sep 2026).
      if (hit?.ambiguous) return { none: `${source} holds more than one place it could be (${hit.ambiguous})` };
      if (hit) hits.push(hit);
    }
    if (!hits.length) continue;
    const first = hits[0];
    const disagree = hits.some((h) => h.id !== first.id && metresBetween({ lat: h.lat, lng: h.lng }, { lat: first.lat, lng: first.lng }) > 50);
    if (disagree) return { none: `its names point at different places in ${source}` };
    const hit = hits.reduce((x, y) => (y.score > x.score ? y : x));
    return {
      source, lat: hit.lat, lng: hit.lng, sourceRef: hit.id,
      method: strict ? 'name, alone in its census box' : 'name+distance',
      distanceM: place.point ? Math.round(hit.distanceM) : null,
    };
  }
  return { none: 'no owned source knows it' };
}

/**
 * The places to match, a page at a time in reference order, with every name
 * and point we hold on each — read here, used once, never written.
 */
// An atlas reference's own row, by its primary key rather than by casting
// every id in the table to text.
const ATLAS_ID = `(case when pi.venue_ref like 'atlas:%' then epic_try_uuid(substr(pi.venue_ref, 7)) end)`;

const TRUSTED_WD = (a) => `(${a}.source is distinct from 'google' or (${a}.osm_ref is not null and ${a}.display_source is null))`;

async function pageOfPlaces(after, limit, { weekly }) {
  const { rows } = await query(
    `select pi.venue_ref as ref, pi.slice,
            -- The point to match near: the index's (owned, or Google's for
            -- thirty days), or, where that has gone, the copy a sweep row, a
            -- saved place or a record still holds until the purge — read once
            -- here to find the owned twin, never written anywhere.
            pt.lat, pt.lng,
            array_remove(array[
              (select r.name from place_records r where r.venue_ref = pi.venue_ref),
              coalesce((select a.name from attractions a where a.venue_ref = pi.venue_ref limit 1),
                       (select a.name from attractions a where a.id = ${ATLAS_ID})),
              (select s.name from scout_places s where s.venue_ref = pi.venue_ref and s.name is not null limit 1),
              (select h.label from household_places h where h.venue_ref = pi.venue_ref and h.label <> h.venue_ref limit 1),
              (select t.venue_label from trip_shortlist t where t.venue_ref = pi.venue_ref and t.venue_label <> t.venue_ref limit 1),
              (select t.venue_name from trip_stops t where t.venue_ref = pi.venue_ref and t.venue_name <> t.venue_ref limit 1),
              (select v.venue_label from visits v where v.venue_ref = pi.venue_ref and v.venue_label <> v.venue_ref limit 1)
            ], null) as names,
            epic_ref_true_source(pi.venue_ref) = any(epic_rented_sources()) as rented,
            coalesce((select r.wikidata_id from place_records r where r.venue_ref = pi.venue_ref),
                     -- Only an identifier the atlas vouches for: a harvested row,
                     -- or an activity-sweep match it accepted — never one it
                     -- saw on a candidate it turned down (Codex, 30 Sep 2026).
                     (select a.wikidata_id from attractions a where a.venue_ref = pi.venue_ref and a.wikidata_id is not null and ${TRUSTED_WD('a')} limit 1),
                     (select a.wikidata_id from attractions a where a.id = ${ATLAS_ID} and ${TRUSTED_WD('a')}),
                     case when pi.venue_ref like 'wikidata:%' then substr(pi.venue_ref, 10) end) as wikidata_id
       from place_index pi
       left join lateral (
         select x.lat, x.lng from (
           select pi.lat, pi.lng, 0 as k where pi.lat is not null and pi.lng is not null
           union all select s.lat, s.lng, 1 from scout_places s where s.venue_ref = pi.venue_ref and s.lat is not null and s.lng is not null
           union all select h.lat, h.lng, 2 from household_places h
                      where h.venue_ref = pi.venue_ref and h.lat is not null and h.lng is not null and h.point_from is distinct from 'census-box'
           union all select r.lat, r.lng, 3 from place_records r where r.venue_ref = pi.venue_ref and r.lat is not null and r.lng is not null
         ) x order by x.k limit 1) pt on true
      where ($1::text is null or pi.venue_ref > $1)
        ${weekly ? 'and not exists (select 1 from owned_points o where o.venue_ref = pi.venue_ref)' : ''}
      order by pi.venue_ref
      limit $2`, [after, limit]);
  return rows;
}

const boxOf = (slice) => {
  const b = String(slice ?? '').split(',').map(Number);
  if (b.length !== 4 || b.some((x) => !Number.isFinite(x))) return null;
  const lat = (b[0] + b[2]) / 2, lng = (b[1] + b[3]) / 2;
  return {
    lat, lng, radiusM: Math.round(metresBetween({ lat: b[0], lng: b[1] }, { lat: b[2], lng: b[3] }) / 2),
    bounds: { minLat: Math.min(b[0], b[2]), maxLat: Math.max(b[0], b[2]), minLng: Math.min(b[1], b[3]), maxLng: Math.max(b[1], b[3]) },
  };
};

/**
 * A run over every place we hold: the backfill (kind 'backfill') or the weekly
 * re-match of the unmatched (kind 'weekly'). Resumes from its own checkpoint.
 */
let active = null;
export async function run({ kind = 'backfill', who = 'Epic', pageSize = 500, fetcher = fetch, resume = true } = {}) {
  if (active) return active;
  active = (async () => {
    // One run at a time across every instance: a lock held on one connection
    // for the whole run, not only this process's promise (Codex, 30 Sep 2026).
    const holder = await pool.connect();
    try {
      const { rows: [{ got }] } = await holder.query(`select pg_try_advisory_lock(hashtext('owned-points-run')) as got`);
      if (!got) return { busy: 'another instance is running the match' };
      try { return await runLocked({ kind, who, pageSize, fetcher, resume }); } finally {
        await holder.query(`select pg_advisory_unlock(hashtext('owned-points-run'))`).catch(() => null);
      }
    } finally { holder.release(); }
  })().finally(() => { active = null; });
  return active;
}

async function runLocked({ kind, who, pageSize, fetcher, resume }) {
  // Not before every owned source has a live load and the open map's copy is
  // in: a backfill run against empty tables would finish, and let the purge
  // throw away the names and points it should have matched (Codex, 30 Sep 2026).
  // The open map's copy only where a region is switched on (a fresh
  // installation has none, and must not wait for ever — Codex, 30 Sep 2026).
  const { regionsOn } = await import('./osmExtract.js');
  const regions = await regionsOn().catch(() => []);
  const { rows: missing } = await query(
    `select source from owned_source_loads where live_load is null
      union all
     select 'osm (' || r || ')' from unnest($1::text[]) r
      where not exists (select 1 from osm_extracts x where x.region = r and x.state = 'done')`, [regions]);
  if (missing.length) return { waiting: `not yet loaded: ${missing.map((m) => m.source).join(', ')}` };
  // A run a deploy cut off, or one that failed part-way, carries on from its
  // checkpoint rather than starting again (Codex, 30 Sep 2026).
  let r = null;
  if (resume) {
    ({ rows: [r] } = await query(
      `update owned_point_runs set state = 'running', problem = null, finished_at = null
        where id = (select id from owned_point_runs where kind = $1 and state in ('running', 'failed') order by started_at desc limit 1)
        returning *`, [kind]));
  }
  if (!r) {
    ({ rows: [r] } = await query(`insert into owned_point_runs (kind, started_by) values ($1, $2) returning *`, [kind, who]));
  }
  const bySource = { ...(r.by_source ?? {}) };
  let { after, looked, matched, no_key: noKey } = r;
  try {
    for (;;) {
      const page = await pageOfPlaces(after, pageSize, { weekly: kind === 'weekly' });
      if (!page.length) break;
      // Wikidata comes first; a failed lookup stops the run where it stands
      // (it resumes from here next time) rather than letting a lower source
      // take the place for good (Codex, 30 Sep 2026).
      const wd = await wikidataPoints(page.map((p) => p.wikidata_id).filter(Boolean), fetcher);
      for (const p of page) {
        const out = await matchPlace({
          ref: p.ref, names: p.names,
          point: p.lat != null && p.lng != null ? { lat: p.lat, lng: p.lng } : null,
          box: boxOf(p.slice), wikidataId: p.wikidata_id, wikidataPoint: wd.get(p.wikidata_id) ?? null,
          rented: p.rented,
        });
        // The point and the checkpoint in one transaction: a resume neither
        // looks at a place again nor counts it twice (Codex, 30 Sep 2026).
        const client = await pool.connect();
        try {
          await client.query('begin');
          let nLooked = looked + 1, nMatched = matched, nNoKey = noKey;
          const nBy = { ...bySource };
          if (out.none) { if (/no name|no point/.test(out.none)) nNoKey += 1; } else {
            const w = await recordOwnedPoint({ ref: p.ref, ...out }, client);
            if (w.written) { nMatched += 1; nBy[out.source] = (nBy[out.source] ?? 0) + 1; }
          }
          await client.query(
            `update owned_point_runs set after = $2, looked = $3, matched = $4, by_source = $5, no_key = $6 where id = $1`,
            [r.id, p.ref, nLooked, nMatched, JSON.stringify(nBy), nNoKey]);
          await client.query('commit');
          after = p.ref; looked = nLooked; matched = nMatched; noKey = nNoKey; Object.assign(bySource, nBy);
        } catch (err) {
          await client.query('rollback').catch(() => null);
          throw err;
        } finally { client.release(); }
      }
    }
    await query(`update owned_point_runs set state = 'done', finished_at = now() where id = $1`, [r.id]);
    return { id: r.id, kind, looked, matched, bySource, noKey };
  } catch (err) {
    await query(`update owned_point_runs set state = 'failed', problem = $2, finished_at = now() where id = $1`, [r.id, String(err.message).slice(0, 500)]);
    throw err;
  }
}

/**
 * The weekly re-match, when a week has passed since the last one finished and
 * the one-off backfill has run. A run that is part-way (a deploy took it) is
 * carried on rather than waiting a week.
 */
export async function weeklyDue({ now = Date.now() } = {}) {
  // The one-off backfill first: started by the schedule once every source is
  // in (run() waits until then), and carried on after a deploy took it part-way
  // — nothing else would ever start it again (Codex, 30 Sep 2026).
  const { rows: [back] } = await query(`select 1 from owned_point_runs where kind = 'backfill' and state = 'done' limit 1`);
  if (!back) return run({ kind: 'backfill', who: 'Epic (the one-off backfill)' });
  // A weekly run left running or failed carries on, whatever the calendar says.
  const { rows: [open] } = await query(`select 1 from owned_point_runs where kind = 'weekly' and state in ('running', 'failed') limit 1`);
  const { rows: [last] } = await query(`select max(finished_at) as at from owned_point_runs where kind = 'weekly' and state = 'done'`);
  if (!open && last?.at && now - new Date(last.at).getTime() < 7 * 86_400_000) return null;
  return run({ kind: 'weekly', who: 'Epic (weekly)' });
}

/** Where the owned points stand, for the report after the backfill. */
export async function standing() {
  const { rows: [t] } = await query(
    `select (select count(*)::int from place_index) as places,
            (select count(*)::int from owned_points) as owned,
            (select count(*)::int from place_index pi where not exists (select 1 from owned_points o where o.venue_ref = pi.venue_ref)
                and pi.slice is not null) as box_only,
            (select count(*)::int from place_index pi where not exists (select 1 from owned_points o where o.venue_ref = pi.venue_ref)
                and pi.slice is null) as neither`);
  const { rows: by } = await query('select source, count(*)::int as n from owned_points group by 1 order by 2 desc');
  const { rows: runs } = await query('select * from owned_point_runs order by started_at desc limit 5');
  return { ...t, bySource: Object.fromEntries(by.map((x) => [x.source, x.n])), runs };
}
