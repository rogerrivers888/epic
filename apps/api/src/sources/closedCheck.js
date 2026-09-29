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
  combine, confirmation, googleVerdict, osmVerdict, wikidataVerdict, wikipediaVerdict,
} from '../domain/openStatus.js';
import * as statusRepo from '../repositories/placeStatus.js';
import { entityClaims } from './wikimedia.js';

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
async function atlasRows() {
  const { rows } = await query(
    `select a.id, a.name, a.wikidata_id, a.venue_ref, coalesce(a.venue_ref, 'atlas:' || a.id::text) as ref,
            a.summary, a.summary_source, a.osm_ref, a.website, a.source, a.external_ref, a.lat, a.lng, a.region_slug,
            a.visiting_evidence -> 'categories' as categories,
            ( a.venue_ref like 'google:%' or a.external_ref like 'google:%' or a.source = 'google'
              or exists (select 1 from provider_matches m where m.venue_ref = 'wikidata:' || a.wikidata_id and m.source = 'google')
              or exists (select 1 from place_index_sources x where x.venue_ref = coalesce(a.venue_ref, 'atlas:' || a.id::text) and x.source = 'google')
            ) as google_id,
            coalesce(case when a.osm_ref is not null then a.osm_ref end,
                     case when a.venue_ref like 'osm:%' then substr(a.venue_ref, 5) end,
                     (select pr.osm_ref from place_records pr where pr.venue_ref = a.venue_ref)) as any_osm,
            coalesce(a.website, (select pr.website from place_records pr where pr.venue_ref = a.venue_ref)) as any_website,
            exists (select 1 from place_index pi where pi.venue_ref = coalesce(a.venue_ref, 'atlas:' || a.id::text)
                       and (pi.censused_at is not null or pi.found_by is not null)) as censused
       from attractions a`);
  return rows;
}

/** Owned records with something to read that the atlas has not already covered. */
async function recordRows() {
  const { rows } = await query(
    `select pr.venue_ref as ref, pr.name, pr.wikidata_id, pr.osm_ref, pr.website, pr.summary, pr.summary_source, pr.lat, pr.lng
       from place_records pr
      where (pr.wikidata_id is not null or pr.osm_ref is not null or pr.summary is not null)
        and not exists (select 1 from attractions a where a.venue_ref = pr.venue_ref)`);
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
        and (f.tags ?| array['disused','abandoned','demolished','razed','destroyed','removed','end_date','replaced_by']
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

/**
 * Run it. `fetchClaims` is injectable so the tests never reach Wikidata.
 * Returns the counts the run wrote to `closed_checks`.
 */
export async function runClosedCheck({ by = null, dryRun = true, fetchClaims = entityClaims, today, pause = 0 } = {}) {
  const checkId = await statusRepo.startCheck({ by, dryRun });
  const counts = {
    atlas: 0, records: 0, osmMarked: 0, wikidataAsked: 0, wikidataRead: 0, wikidataUnread: 0,
    written: 0, cleared: 0, byStatus: {}, unconfirmed: 0, review: 0, successors: 0,
  };
  try {
    const [atlas, records, marked, existing] = await Promise.all([
      atlasRows(), recordRows(), osmMarked(),
      query(`select venue_ref, status, source, reason, evidence from place_status`).then((r) => r.rows),
    ]);
    counts.atlas = atlas.length; counts.records = records.length; counts.osmMarked = marked.length;
    const held = new Map(existing.map((r) => [r.venue_ref, r]));

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

    const tags = await tagsFor([...atlas.map((a) => a.any_osm), ...records.map((r) => r.osm_ref)].filter(Boolean));

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
    const successorRef = (v, self) => {
      if (v.successorQid && byQid.has(v.successorQid)) return byQid.get(v.successorQid);
      if (v.successorName) {
        const want = plain(v.successorName);
        const hit = named.filter((n) => n.name === want && n.ref !== self.ref).sort((x, y) => km(self, x) - km(self, y))[0];
        if (hit && km(self, hit) <= 10) return hit.ref;
      }
      return null;
    };

    const seen = new Set();
    const settle = async (place, findings, confirm, wikidataId = null) => {
      if (seen.has(place.ref)) return;
      seen.add(place.ref);
      const prior = held.get(place.ref);
      // A Google status or a person's word already stored outranks every
      // encyclopedia, so it goes into the settling as a finding.
      if (prior && (prior.source === 'google' || prior.source === 'person')) {
        findings.push({ source: prior.source, status: prior.status, reason: prior.reason, evidence: prior.evidence, review: false });
      }
      const v = combine(findings);
      const succ = successorRef(v, place);
      const row = {
        ref: place.ref, wikidataId, status: v.status, confirmed: confirm.confirmed, confirmedBy: confirm.by,
        reason: v.reason, source: v.source, evidence: v.evidence, review: v.review,
        successorRef: succ, successorName: v.successorName ?? (v.successorQid && !succ ? v.successorQid : null),
      };
      const worth = row.status !== 'unknown' || row.review || !row.confirmed || prior;
      if (!worth) return;
      if (prior && (prior.source === 'person')) return;
      await statusRepo.propose(row, { checkId });
      counts.written += 1;
      if (prior && row.status === 'unknown' && !row.review && row.confirmed) counts.cleared += 1;
      counts.byStatus[row.status] = (counts.byStatus[row.status] ?? 0) + 1;
      if (!row.confirmed) counts.unconfirmed += 1;
      if (row.review) counts.review += 1;
      if (succ) counts.successors += 1;
    };

    for (const a of atlas) {
      const findings = [
        a.wikidata_id && claims.has(a.wikidata_id) ? wikidataVerdict(claims.get(a.wikidata_id), { today }) : null,
        a.any_osm && tags.has(a.any_osm) ? osmVerdict(tags.get(a.any_osm), { today }) : null,
        wikipediaVerdict({ text: a.summary, name: a.name, categories: Array.isArray(a.categories) ? a.categories : [], source: /wikipedia/i.test(a.summary_source ?? 'wikipedia') ? 'wikipedia' : 'listing' }),
      ];
      // Only an atlas place from Wikidata/Wikipedia can be unconfirmed; a place
      // a sweep found through Google, the map or a household is current by birth.
      const confirm = a.source === 'wikidata'
        ? confirmation({ ref: a.venue_ref, googleId: a.google_id, osmRef: a.any_osm, website: a.any_website, censused: a.censused })
        : { confirmed: true, by: a.source === 'google' ? 'google' : a.source === 'osm' ? 'osm' : null };
      await settle(a, findings, confirm, a.wikidata_id ?? null);
    }
    for (const r of records) {
      const findings = [
        r.wikidata_id && claims.has(r.wikidata_id) ? wikidataVerdict(claims.get(r.wikidata_id), { today }) : null,
        r.osm_ref && tags.has(r.osm_ref) ? osmVerdict(tags.get(r.osm_ref), { today }) : null,
        /wikipedia/i.test(r.summary_source ?? '') ? wikipediaVerdict({ text: r.summary, name: r.name, source: 'wikipedia' }) : null,
      ];
      await settle(r, findings, { confirmed: true, by: null }, r.wikidata_id ?? null);
    }
    for (const m of marked) {
      await settle(m, [osmVerdict(m.tags, { today })], { confirmed: true, by: 'osm' });
    }
    // Rows a previous check wrote for places this one no longer holds are left
    // as they were: absence from today's read is not evidence of anything.
    await statusRepo.finishCheck(checkId, { counts });
    return { checkId, ...counts };
  } catch (err) {
    await statusRepo.finishCheck(checkId, { counts, error: String(err?.message ?? err).slice(0, 300) }).catch(() => null);
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
}
