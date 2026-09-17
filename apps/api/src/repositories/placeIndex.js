/**
 * The index every level of Places reads.
 *
 * One row per place Epic has ever seen, holding identifiers and our own
 * derivations and **nothing a provider owns** — no name, no hours, no rating, no
 * photograph, no description. Names on screen come from where they are already
 * legitimately held; a `google:` ref with no owned record has no name here at
 * all, and the nameless row is the finding.
 *
 * Three tables do the work. `place_index` is the place. `place_index_sources`
 * says who has ever returned it, which is the whole source lens. `place_areas`
 * says where it is — country, county, town and outcode at once — which is why a
 * county, a ring and a subcategory can all be answered by the same query with a
 * different slug in it.
 *
 * Everything above the final list of places reads `area_stats` instead, because
 * selecting a country must not become a count over every row at page load.
 */

import { query, withTransaction } from '../db.js';
import { shelvesForAtlas, shelvesForVenue } from '../domain/moods.js';
import { labelsOf, labelsOfAtlas } from '../domain/labels.js';
import { rules as shelfRules } from './shelfRules.js';
import { taxonomy } from './shelfTaxonomy.js';
import { FACT_KEYS, FACT_WEIGHTS, defaultBars, scorePlace, readyShare } from '../domain/placeIndex.js';

/** Sources we can be asked about, in the order the boards print them. */
export const SOURCES = [
  { key: 'google',      label: 'Google',        explain: 'Rented: identifiers and counts only, with nothing stored.', optIn: false, paid: true },
  { key: 'osm',         label: 'OSM',           explain: 'Ours to keep under its licence, which is why most of our names come from here.', optIn: false, paid: false },
  { key: 'atlas',       label: 'Atlas',         explain: 'Wikidata and Wikipedia, ours to keep.', optIn: false, paid: false },
  { key: 'sweep',       label: 'Sweep',         explain: 'Our own food census of an outcode.', optIn: false, paid: false },
  { key: 'tripadvisor', label: 'Tripadvisor',   explain: 'Opt-in and capped at 120 locations a month, so an empty column usually means we did not spend the call.', optIn: true, paid: true },
  { key: 'own',         label: 'Ours',          explain: 'Places here we hold our own research on.', optIn: false, paid: false },
];

const lower = (s) => String(s ?? '').trim().toLowerCase();

// ---------------------------------------------------------------------------
// the bar
// ---------------------------------------------------------------------------

/** Every subcategory's bar, keyed by subcategory. `[]` means nobody has set one. */
export async function bars() {
  const { rows } = await query('select subcategory_key, fact, weight, required from ready_bars order by subcategory_key, fact');
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.subcategory_key)) out.set(r.subcategory_key, []);
    out.get(r.subcategory_key).push({ fact: r.fact, weight: r.weight, required: r.required });
  }
  return out;
}

/**
 * Put the seed bars in, once, for any subcategory nobody has set one for.
 *
 * Seeded rather than coded so the back office can change it (BO2k), and only for
 * subcategories with no rows at all — a bar somebody has composed is never
 * overwritten by a redeploy.
 */
export async function seedBars() {
  const seed = defaultBars();
  const { rows: subs } = await query('select key from shelf_subcategories where active');
  const have = new Set((await query('select distinct subcategory_key from ready_bars')).rows.map((r) => r.subcategory_key));
  let added = 0;
  for (const { key } of subs) {
    if (have.has(key)) continue;
    const facts = seed[key];
    if (!facts) continue;                       // genuinely "not set", and says so
    for (const fact of FACT_KEYS) {
      await query(
        `insert into ready_bars (subcategory_key, fact, weight, required, set_by)
         values ($1,$2,$3,$4,'seed') on conflict do nothing`,
        [key, fact, FACT_WEIGHTS[fact] ?? 0, facts.includes(fact)]);
    }
    added += 1;
  }
  return { added };
}

/** Change one subcategory's bar. Returns what it was, for the audit trail. */
export async function setBar(subcategory, facts, who) {
  const before = (await query('select fact, weight, required from ready_bars where subcategory_key = $1', [subcategory])).rows;
  await withTransaction(async (client) => {
    for (const fact of FACT_KEYS) {
      const want = facts.find((f) => f.fact === fact);
      await client.query(
        `insert into ready_bars (subcategory_key, fact, weight, required, set_by, set_at)
         values ($1,$2,$3,$4,$5, now())
         on conflict (subcategory_key, fact) do update
            set weight = excluded.weight, required = excluded.required,
                set_by = excluded.set_by, set_at = now()`,
        [subcategory, fact, want?.weight ?? FACT_WEIGHTS[fact] ?? 0, Boolean(want?.required), who ?? null]);
    }
  });
  return before;
}

// ---------------------------------------------------------------------------
// filling it
// ---------------------------------------------------------------------------

/**
 * Which facts we hold about every place, in one pass.
 *
 * One query rather than one per place: the index is rebuilt over tens of
 * thousands of rows and a per-place round trip would make it an overnight job
 * rather than a minute.
 */
const HELD_SQL = `
  select x.venue_ref,
         x.picture, x.what_it_is, x.hours, x.menu, x.prices, x.step_free, x.website, x.oldest_fact
    from (
      select pi.venue_ref,
             (exists (select 1 from image_links li join image_assets ia on ia.id = li.image_id
                       where ia.may_store
                         and ((li.subject_type = 'place' and li.subject_id = pi.venue_ref)
                           or (li.subject_type = 'attraction' and li.subject_id = a.id::text)))) as picture,
             (coalesce(r.summary, a.summary, r.curation->>'summary') is not null)                 as what_it_is,
             (coalesce(r.opening_hours, d.visit->>'openingHours') is not null)                    as hours,
             (exists (select 1 from place_menus m where m.venue_ref = pi.venue_ref and m.state = 'read')) as menu,
             (r.price_range is not null)                                                          as prices,
             ((r.accessibility ? 'stepFree') and (r.accessibility->>'stepFree') is not null)       as step_free,
             (coalesce(r.website, a.website, s.website) is not null)                               as website,
             (select min(pf.fetched_at) from place_facts pf where pf.venue_ref = pi.venue_ref)     as oldest_fact
        from place_index pi
        left join place_records r on r.venue_ref = pi.venue_ref
        left join attractions  a on a.venue_ref = pi.venue_ref or 'atlas:' || a.id::text = pi.venue_ref
        left join attraction_details d on d.attraction_id = a.id
        left join lateral (select sp.website from scout_places sp where sp.venue_ref = pi.venue_ref limit 1) s on true
    ) x`;

/**
 * Rebuild the index from everything that has ever resolved a place.
 *
 * Backfilled from the atlas harvest, the postcode sweep, our own records and the
 * places households have claimed. Written to from every path that resolves a
 * venue afterwards (`note()` below) — an index only filled by a nightly job is
 * always behind the screen reading it.
 */
export async function reindex({ onProgress = null } = {}) {
  const t0 = Date.now();

  // 1 — every place, from every harvest. `on conflict` keeps `first_seen`, so a
  //     rebuild never rewrites when we first saw something.
  await query(`
    insert into place_index (venue_ref, lat, lng, country_code, category, subcategory, derived_by, ownership, first_seen, last_seen)
    select coalesce(a.venue_ref, 'atlas:' || a.id::text), a.lat, a.lng, coalesce(reg.country_code, 'GB'),
           null, null, 'harvest',
           -- Owned means we hold our own research on it, so it survives every
           -- provider going dark. A harvested row with nothing but a name and a
           -- position is not that: it is a place we have identified.
           case when coalesce(a.summary, a.website, a.wikipedia_url) is not null then 'owned' else 'identified' end,
           a.first_seen, a.last_seen
      from attractions a left join regions reg on reg.slug = a.region_slug
     where a.state <> 'rejected'
    on conflict (venue_ref) do update
       set lat = coalesce(excluded.lat, place_index.lat),
           lng = coalesce(excluded.lng, place_index.lng),
           last_seen = greatest(place_index.last_seen, excluded.last_seen),
           -- identified < claimed < owned, said out loud rather than left to
           -- the alphabet, which puts claimed below identified.
           ownership = case when place_index.ownership = 'owned' or excluded.ownership = 'owned' then 'owned'
                            when place_index.ownership = 'claimed' or excluded.ownership = 'claimed' then 'claimed'
                            else 'identified' end`);

  await query(`
    insert into place_index (venue_ref, lat, lng, country_code, derived_by, ownership, first_seen, last_seen)
    select sp.venue_ref, sp.lat, sp.lng, coalesce(sa.country_code, 'GB'), 'sweep', 'identified', min(sp.first_seen), max(sp.last_seen)
      from scout_places sp left join scout_areas sa on sa.code = sp.area_code
     group by sp.venue_ref, sp.lat, sp.lng, sa.country_code
    on conflict (venue_ref) do update
       set lat = coalesce(place_index.lat, excluded.lat),
           lng = coalesce(place_index.lng, excluded.lng),
           last_seen = greatest(place_index.last_seen, excluded.last_seen)`);

  await query(`
    insert into place_index (venue_ref, lat, lng, derived_by, ownership, first_seen, last_seen)
    select r.venue_ref, r.lat, r.lng, 'own', 'owned', r.first_owned, r.updated_at
      from place_records r
    on conflict (venue_ref) do update
       set lat = coalesce(place_index.lat, excluded.lat),
           lng = coalesce(place_index.lng, excluded.lng),
           ownership = 'owned',
           last_seen = greatest(place_index.last_seen, excluded.last_seen)`);

  // A household claiming a place is the third kind of ownership: we may hold
  // nothing of our own about it, but somebody has said it matters.
  await query(`
    insert into place_index (venue_ref, derived_by, ownership, first_seen, last_seen)
    select hp.venue_ref, 'claim', 'claimed', min(hp.first_seen), max(hp.last_seen)
      from household_places hp where hp.venue_ref is not null group by hp.venue_ref
    on conflict (venue_ref) do update
       set ownership = case when place_index.ownership = 'identified' then 'claimed' else place_index.ownership end`);

  onProgress?.({ stage: 'places' });

  // 2 — who has ever returned each of them.
  await query(`
    insert into place_index_sources (venue_ref, source, source_place_id, first_seen, last_seen)
    select pi.venue_ref,
           case when pi.venue_ref like 'google:%' then 'google'
                when pi.venue_ref like 'osm:%'    then 'osm'
                when pi.venue_ref like 'atlas:%'  then 'atlas'
                else split_part(pi.venue_ref, ':', 1) end,
           split_part(pi.venue_ref, ':', 2), pi.first_seen, pi.last_seen
      from place_index pi where position(':' in pi.venue_ref) > 0
    on conflict (venue_ref, source) do update set last_seen = greatest(place_index_sources.last_seen, excluded.last_seen)`);
  await query(`
    insert into place_index_sources (venue_ref, source, source_place_id, first_seen, last_seen)
    select coalesce(a.venue_ref, 'atlas:' || a.id::text), 'atlas', a.id::text, a.first_seen, a.last_seen
      from attractions a where a.state <> 'rejected'
    on conflict (venue_ref, source) do update set last_seen = greatest(place_index_sources.last_seen, excluded.last_seen)`);
  await query(`
    insert into place_index_sources (venue_ref, source, source_place_id, first_seen, last_seen)
    select distinct sp.venue_ref, 'sweep', sp.venue_ref, min(sp.first_seen) over (partition by sp.venue_ref), max(sp.last_seen) over (partition by sp.venue_ref)
      from scout_places sp
    on conflict (venue_ref, source) do update set last_seen = greatest(place_index_sources.last_seen, excluded.last_seen)`);
  await query(`
    insert into place_index_sources (venue_ref, source, source_place_id, first_seen, last_seen)
    select r.venue_ref, 'own', r.venue_ref, r.first_owned, r.updated_at from place_records r
    on conflict (venue_ref, source) do update set last_seen = greatest(place_index_sources.last_seen, excluded.last_seen)`);
  // An OSM reference held on a record or an attraction is OSM having seen it,
  // whatever the ref itself is keyed on.
  await query(`
    insert into place_index_sources (venue_ref, source, source_place_id)
    select r.venue_ref, 'osm', r.osm_ref from place_records r where r.osm_ref is not null
    on conflict (venue_ref, source) do update set source_place_id = coalesce(place_index_sources.source_place_id, excluded.source_place_id)`);

  onProgress?.({ stage: 'sources' });

  // 3 — where each of them is. Country, county, town and outcode at once.
  await query('delete from place_areas');
  await query(`
    insert into place_areas (venue_ref, area_slug)
    select pi.venue_ref, lower(pi.country_code) from place_index pi
     where pi.country_code is not null
    on conflict do nothing`);
  await query(`
    insert into place_areas (venue_ref, area_slug)
    select coalesce(a.venue_ref, 'atlas:' || a.id::text), a.region_slug
      from attractions a where a.state <> 'rejected' and a.region_slug is not null
    on conflict do nothing`);
  await query(`
    insert into place_areas (venue_ref, area_slug)
    select coalesce(a.venue_ref, 'atlas:' || a.id::text), a.locality_slug
      from attractions a where a.state <> 'rejected' and a.locality_slug is not null
    on conflict do nothing`);
  await query(`
    insert into place_areas (venue_ref, area_slug)
    select coalesce(a.venue_ref, 'atlas:' || a.id::text), lower(a.outcode)
      from attractions a where a.state <> 'rejected' and a.outcode is not null
    on conflict do nothing`);
  await query(`
    insert into place_areas (venue_ref, area_slug)
    select sp.venue_ref, sp.locality_slug from scout_places sp where sp.locality_slug is not null
    on conflict do nothing`);
  await query(`
    insert into place_areas (venue_ref, area_slug)
    select sp.venue_ref, lower(sp.outcode) from scout_places sp where sp.outcode is not null
    on conflict do nothing`);
  await query(`
    insert into place_areas (venue_ref, area_slug)
    select r.venue_ref, lower(substring(replace(upper(r.postcode), ' ', '') from '^[A-Z]{1,2}[0-9][0-9A-Z]?'))
      from place_records r
     where r.postcode is not null
       and substring(replace(upper(r.postcode), ' ', '') from '^[A-Z]{1,2}[0-9][0-9A-Z]?') is not null
    on conflict do nothing`);
  // A town knows its county, so anything in the town is in the county too.
  await query(`
    insert into place_areas (venue_ref, area_slug)
    select pa.venue_ref, l.parent_slug
      from place_areas pa join localities l on l.slug = pa.area_slug
     where l.kind = 'town' and l.parent_slug is not null
    on conflict do nothing`);
  // An outcode does not nest under a county — SL4 spans five councils — so it is
  // never treated as though it did. What *is* true is the reverse: the county an
  // outcode's own places fall in. That is read at query time, not stored.
  onProgress?.({ stage: 'areas' });

  // 4 — the cell, from what the reach build already stamped (migration 139).
  await query(`
    update place_index pi set cell = pc.cell
      from place_cells pc where pc.venue_ref = pi.venue_ref and pi.cell is distinct from pc.cell`);

  // 5 — our own shelf, asked of the same resolver the app asks.
  //
  //     Not a join on a category column: the atlas calls things `heritage` and
  //     `outdoors`, Google says `amusement_park`, and neither is one of our
  //     fifty-one drawers. `shelvesForAtlas` and `shelvesForVenue` are what the
  //     household app files a place with, so asking them here is the only way the
  //     back office's counts and the drawers on somebody's phone can agree.
  await shelveAll();

  onProgress?.({ stage: 'shelving' });

  // 6 — the score, against each place's own bar.
  const scored = await rescore();
  onProgress?.({ stage: 'scored', ...scored });

  const total = (await query('select count(*)::int as n from place_index')).rows[0].n;
  await refreshStats();
  return { places: total, ...scored, ms: Date.now() - t0 };
}

/**
 * Work every place's score out again from scratch.
 *
 * Free, no network, and the thing to run after any change to the bar. Nothing is
 * adjusted: the score is a pure function of the facts held and the bar in force,
 * so a rebuild cannot drift from what the screen says the weights are.
 */
export async function rescore({ subcategory = null } = {}) {
  const bar = await bars();
  const { rows } = await query(
    `${HELD_SQL} join place_index p on p.venue_ref = x.venue_ref
      ${subcategory ? 'where p.subcategory = $1' : ''}`, subcategory ? [subcategory] : []);
  const subs = new Map((await query('select venue_ref, subcategory from place_index')).rows.map((r) => [r.venue_ref, r.subcategory]));
  let changed = 0;
  const chunk = [];
  for (const r of rows) {
    const held = Object.fromEntries(FACT_KEYS.map((k) => [k, Boolean(r[k])]));
    const out = scorePlace({ bar: bar.get(subs.get(r.venue_ref)) ?? [], held });
    chunk.push([r.venue_ref, out.set ? out.score : null, out.ready,
      JSON.stringify({ ...out.parts, set: out.set, website: Boolean(r.website) }), r.oldest_fact]);
    changed += 1;
    if (chunk.length >= 500) { await flushScores(chunk); chunk.length = 0; }
  }
  if (chunk.length) await flushScores(chunk);
  return { rescored: changed };
}

async function flushScores(chunk) {
  const values = chunk.map((_, i) => `($${i * 5 + 1},$${i * 5 + 2}::real,$${i * 5 + 3}::boolean,$${i * 5 + 4}::jsonb,$${i * 5 + 5}::timestamptz)`).join(',');
  await query(
    `update place_index pi
        set data_score = v.score, ready = v.ready, score_parts = v.parts,
            oldest_fact = v.oldest, indexed_at = now()
       from (values ${values}) as v(ref, score, ready, parts, oldest)
      where pi.venue_ref = v.ref`, chunk.flat());
}

/**
 * Note a place the moment something resolves it, rather than waiting for a job.
 *
 * Called from the sweep, the harvest, our own records and a household claiming a
 * place — the four paths that actually *persist* a place. Cheap, idempotent, and
 * it never writes a name.
 *
 * Not from the sources layer on every search: a browse resolves forty venues and
 * most of them are gone a second later, so writing an index row for each one
 * would put an insert storm behind somebody's spinner to record places nothing
 * ever asked about again. A place that is kept is a place worth indexing.
 */
export async function note({ ref, lat = null, lng = null, source = null, sourceId = null, countryCode = 'GB' }) {
  if (!ref) return;
  await query(
    `insert into place_index (venue_ref, lat, lng, country_code, last_seen)
     values ($1,$2,$3,$4, now())
     on conflict (venue_ref) do update
        set lat = coalesce(place_index.lat, excluded.lat),
            lng = coalesce(place_index.lng, excluded.lng),
            last_seen = now()`, [ref, lat, lng, countryCode]);
  if (source) {
    await query(
      `insert into place_index_sources (venue_ref, source, source_place_id)
       values ($1,$2,$3)
       on conflict (venue_ref, source) do update
          set last_seen = now(), source_place_id = coalesce(place_index_sources.source_place_id, excluded.source_place_id)`,
      [ref, source, sourceId]);
  }
}

/**
 * File every indexed place on one of our shelves.
 *
 * The resolver is the app's own, so what the back office counts under
 * "Playgrounds" is what a household would find in the Playgrounds drawer. A
 * place nothing fires for keeps a null subcategory, which is a finding rather
 * than a gap: it is invisible on Inspire however good it is.
 */
export async function shelveAll() {
  const [taught, tax] = await Promise.all([shelfRules(), taxonomy()]);
  await query('delete from place_index_labels');
  const live = new Set(tax.subcategories?.map?.((s) => s.key) ?? []);
  const { rows } = await query(`
    select pi.venue_ref, pi.derived_by,
           a.category as atlas_category, a.kinds as atlas_kinds, a.id as atlas_id,
           sp.category as sweep_category, sp.cuisine_group,
           r.category as own_category, r.experiences
      from place_index pi
      left join attractions a on (a.venue_ref = pi.venue_ref or 'atlas:' || a.id::text = pi.venue_ref) and a.state <> 'rejected'
      left join lateral (select category, cuisine_group from scout_places s where s.venue_ref = pi.venue_ref order by last_seen desc limit 1) sp on true
      left join place_records r on r.venue_ref = pi.venue_ref
     where pi.derived_by is distinct from 'hand'`);

  const chunk = [];
  // The words each place was filed by, so the labels lens can be driven by the
  // taxonomy the way the subcategory lens is — every label listed whether or not
  // anything carries it, because an empty one is the finding.
  const words = [];
  const flush = async () => {
    if (chunk.length) {
      const values = chunk.map((_, i) => `($${i * 4 + 1},$${i * 4 + 2},$${i * 4 + 3},$${i * 4 + 4})`).join(',');
      await query(
        `update place_index pi set category = v.cat, subcategory = v.sub, derived_by = v.by
           from (values ${values}) as v(ref, cat, sub, by)
          where pi.venue_ref = v.ref`, chunk.flat());
      chunk.length = 0;
    }
    if (words.length) {
      const values = words.map((_, i) => `($${i * 2 + 1},$${i * 2 + 2})`).join(',');
      await query(
        `insert into place_index_labels (venue_ref, label) values ${values} on conflict do nothing`,
        words.flat());
      words.length = 0;
    }
  };

  for (const r of rows) {
    const [source, ...rest] = String(r.venue_ref).split(':');
    let filed = null;
    let said = [];
    let by = r.derived_by ?? null;
    if (r.atlas_category != null || r.atlas_id) {
      filed = shelvesForAtlas({ ref: r.venue_ref, category: r.atlas_category, kinds: r.atlas_kinds ?? [] }, taught, tax.vocab);
      said = labelsOfAtlas({ category: r.atlas_category, kinds: r.atlas_kinds ?? [] });
      by = 'harvest';
    } else if (r.own_category || r.sweep_category) {
      const venue = { source, sourcePlaceId: rest.join(':'), category: r.own_category ?? r.sweep_category, experiences: r.experiences ?? [], styles: [] };
      filed = shelvesForVenue(venue, taught, tax.vocab);
      said = labelsOf(venue);
      by = r.own_category ? 'own' : 'sweep';
    }
    if (!filed) continue;
    for (const w of said) words.push([r.venue_ref, w]);
    const sub = filed.subcategory && (!live.size || live.has(filed.subcategory)) ? filed.subcategory : null;
    const cat = filed.category ?? filed.shelves?.[0] ?? null;
    // Which rule put it there, so "changes every amusement park" can say how far
    // a change would travel before it travels.
    const why = filed.because?.scope && filed.because?.subject
      ? `rule:${filed.because.scope}:${filed.because.subject}` : by;
    chunk.push([r.venue_ref, cat, sub, why]);
    if (chunk.length >= 500) await flush();
  }
  await flush();
  return { shelved: rows.length };
}

/**
 * The same, for a run that has just written a batch of them.
 *
 * One statement rather than one per place: the sweep keeps a hundred at a time
 * and the harvest twenty, and a round trip each would make a write path that is
 * already the slow part slower still. Failures are swallowed on purpose — the
 * index is a derived thing, and a place must never fail to be *kept* because it
 * could not be *counted*.
 */
export async function noteMany(places = [], { source = null, countryCode = 'GB', ownership = null, client = null } = {}) {
  const rows = places.map((p) => (typeof p === 'string' ? { ref: p } : p)).filter((p) => p?.ref);
  if (!rows.length) return { noted: 0 };
  const write = async (exec) => {
    // `now()` is in the tuple, not implied by the column list. Without it the
    // statement had five targets and four expressions and threw every time —
    // which the swallow on the pool path hid completely, so the index was never
    // actually written to (found by the sweep's own tests, 17 Sep 2026).
    const values = rows.map((_, i) => `($${i * 5 + 1},$${i * 5 + 2}::double precision,$${i * 5 + 3}::double precision,$${i * 5 + 4},$${i * 5 + 5}, now())`).join(',');
    await exec(
      `insert into place_index (venue_ref, lat, lng, country_code, ownership, last_seen)
       values ${values}
       on conflict (venue_ref) do update
          set lat = coalesce(place_index.lat, excluded.lat),
              lng = coalesce(place_index.lng, excluded.lng),
              -- A place saved abroad is filed abroad, and a place does not
              -- change country (Codex, 17 Sep 2026). So a country is only ever
              -- written where none was really known: the default stands in for
              -- "nobody said", and once something real is there a later save
              -- carrying different location metadata cannot refile it.
              country_code = case when place_index.country_code = 'GB' then excluded.country_code
                                  else place_index.country_code end,
              -- identified < claimed < owned, and only ever upward: a household
              -- claiming a place we already research does not un-own it.
              ownership = case when place_index.ownership = 'owned' or excluded.ownership = 'owned' then 'owned'
                               when place_index.ownership = 'claimed' or excluded.ownership = 'claimed' then 'claimed'
                               else 'identified' end,
              last_seen = now()`,
      rows.flatMap((p) => [p.ref, p.lat ?? null, p.lng ?? null, p.countryCode ?? countryCode, p.ownership ?? ownership ?? 'identified']));
    if (source) {
      const src = rows.map((_, i) => `($${i * 3 + 1},$${i * 3 + 2},$${i * 3 + 3})`).join(',');
      await exec(
        `insert into place_index_sources (venue_ref, source, source_place_id)
         values ${src}
         on conflict (venue_ref, source) do update set last_seen = now()`,
        rows.flatMap((p) => [p.ref, p.source ?? source, p.sourceId ?? null]));
    }
    return { noted: rows.length };
  };
  // Inside the write that owns it, when one is open.
  //
  // Two things go wrong otherwise, and Codex found both (17 Sep 2026): a read
  // straight after a save can miss the place, and a transaction that rolls back
  // leaves an index row for something that was never kept. So a caller in a
  // transaction hands its **client** over — not a runner function, because a
  // runner might be the pool and the two need telling apart — and the index is
  // part of the same commit.
  //
  // And no catch on that path: an error inside a transaction has already aborted
  // it, so swallowing one would hide the failure while saving nothing. On the
  // pool it *is* swallowed, because a derived count is never a reason for a
  // place not to be kept.
  if (client) return write((text, params) => client.query(text, params));
  try { return await write(query); } catch { return { noted: 0 }; }
}

// ---------------------------------------------------------------------------
// the rollups
// ---------------------------------------------------------------------------

/**
 * Rebuild `area_stats`.
 *
 * Four grains, because those are the four the screen asks for: everything in an
 * area, everything in one category, everything in one subcategory, and
 * everything one source has seen. Anything finer is a question about individual
 * places and is answered from `place_index` directly.
 */
export async function refreshStats() {
  await query('delete from area_stats');
  const shared = `
      count(*)::int                                                        as places,
      count(*) filter (where pi.ownership <> 'identified')::int             as owned,
      count(*) filter (where pi.ownership = 'identified')::int              as identified,
      count(*) filter (where pi.ready)::int                                 as ready,
      avg(pi.data_score)::real                                              as avg_score`;
  await query(`
    insert into area_stats (area_slug, category, subcategory, source, ownership, places, owned, identified, ready, avg_score)
    select pa.area_slug, '', '', '', '', ${shared}
      from place_areas pa join place_index pi on pi.venue_ref = pa.venue_ref
     group by pa.area_slug`);
  await query(`
    insert into area_stats (area_slug, category, subcategory, source, ownership, places, owned, identified, ready, avg_score)
    select pa.area_slug, pi.category, '', '', '', ${shared}
      from place_areas pa join place_index pi on pi.venue_ref = pa.venue_ref
     where pi.category is not null
     group by pa.area_slug, pi.category`);
  await query(`
    insert into area_stats (area_slug, category, subcategory, source, ownership, places, owned, identified, ready, avg_score)
    select pa.area_slug, coalesce(pi.category, ''), pi.subcategory, '', '', ${shared}
      from place_areas pa join place_index pi on pi.venue_ref = pa.venue_ref
     where pi.subcategory is not null
     group by pa.area_slug, pi.category, pi.subcategory`);
  await query(`
    insert into area_stats (area_slug, category, subcategory, source, ownership, places, owned, identified, ready, avg_score)
    select pa.area_slug, '', '', src.source, '', ${shared}
      from place_areas pa
      join place_index pi on pi.venue_ref = pa.venue_ref
      join place_index_sources src on src.venue_ref = pi.venue_ref
     group by pa.area_slug, src.source`);
  const { rows } = await query('select count(*)::int as n, max(refreshed_at) as at from area_stats');
  return rows[0];
}

/** When the counts were last rebuilt, so the screen can say "4 min ago". */
export const statsAge = async () =>
  (await query('select max(refreshed_at) as at from area_stats')).rows[0]?.at ?? null;

// ---------------------------------------------------------------------------
// reading it
// ---------------------------------------------------------------------------

const FIVE = `
  coalesce(st.places, 0)     as known,
  coalesce(st.owned, 0)      as owned,
  coalesce(st.identified, 0) as identified,
  coalesce(st.ready, 0)      as ready_count,
  st.avg_score               as avg_score`;

/** The five numbers every level prints, for one area. */
export async function statsFor(areaSlug, { category = '', subcategory = '' } = {}) {
  const { rows } = await query(
    `select ${FIVE} from area_stats st
      where st.area_slug = $1 and st.category = $2 and st.subcategory = $3 and st.source = '' and st.ownership = ''`,
    [lower(areaSlug), category ?? '', subcategory ?? '']);
  const r = rows[0] ?? { known: 0, owned: 0, identified: 0, ready_count: 0, avg_score: null };
  return {
    known: r.known, owned: r.owned, identified: r.identified,
    readyCount: r.ready_count, ready: readyShare(r.ready_count, r.known),
    avgScore: r.avg_score == null ? null : Math.round(r.avg_score),
  };
}

/** The same five, for a set of refs (a ring, or a selection). */
export async function statsForRefs(refs, { category = '', subcategory = '' } = {}) {
  if (!refs?.length) return { known: 0, owned: 0, identified: 0, readyCount: 0, ready: null, avgScore: null };
  const { rows } = await query(
    `select count(*)::int as known,
            count(*) filter (where ownership <> 'identified')::int as owned,
            count(*) filter (where ownership = 'identified')::int  as identified,
            count(*) filter (where ready)::int as ready_count,
            avg(data_score)::real as avg_score
       from place_index
      where venue_ref = any($1)
        -- A category or a subcategory narrows the same set, so BO2p and BO2q
        -- print their own five numbers rather than the ring's (Codex, 17 Sep).
        and ($2::text = '' or category = $2)
        and ($3::text = '' or subcategory = $3)`, [refs, category ?? '', subcategory ?? '']);
  const r = rows[0];
  return {
    known: r.known, owned: r.owned, identified: r.identified, readyCount: r.ready_count,
    ready: readyShare(r.ready_count, r.known), avgScore: r.avg_score == null ? null : Math.round(r.avg_score),
  };
}

/**
 * BO2m — every country, and whether its travel times are worked out yet.
 *
 * A country whose matrix has not been built cannot answer "within 30 minutes",
 * which is a dependency and is surfaced rather than discovered.
 */
export async function countries() {
  const { rows } = await query(`
    select l.slug, l.name, l.country_code, ${FIVE},
           (select count(*)::int from geo_cells g where g.country_code = l.country_code) as cells,
           -- Per mode, not per cell. A cell built for driving says nothing about
           -- whether a walking ring can answer, and counting distinct origins
           -- across every mode reported a country as ready when only one of the
           -- three was (Codex, 17 Sep 2026).
           (select count(distinct cb.from_cell)::int from cell_builds cb
             join geo_cells g on g.code = cb.from_cell
            where g.country_code = l.country_code and cb.mode = 'driving') as built,
           (select string_agg(distinct cb.mode, ',' order by cb.mode) from cell_builds cb
             join geo_cells g on g.code = cb.from_cell where g.country_code = l.country_code) as modes,
           -- What was asked for here in the last thirty days. A country nobody
           -- searches is a country not to spend the collection budget on.
           (select count(*)::int from searches sq
             join localities sl on sl.slug = sq.area_slug
            where sl.country_code = l.country_code and sq.at > now() - interval '30 days') as searches
      from localities l
      left join area_stats st on st.area_slug = l.slug and st.category = '' and st.subcategory = '' and st.source = '' and st.ownership = ''
     where l.kind = 'country'
     order by coalesce(st.places, 0) desc, l.name`);
  return rows.map((r) => ({
    slug: r.slug, name: r.name, countryCode: r.country_code,
    known: r.known, owned: r.owned, identified: r.identified,
    readyCount: r.ready_count, ready: readyShare(r.ready_count, r.known),
    avgScore: r.avg_score == null ? null : Math.round(r.avg_score),
    cells: r.cells, built: r.built, searches: r.searches,
    // Which ways of getting there this country can actually answer. Walking is
    // computed live and transit is estimated, so driving is the one the matrix
    // has to hold — but the list is said out loud rather than implied.
    modes: (r.modes ?? '').split(',').filter(Boolean),
    // `ready` here is the matrix, not the places: either it can answer a ring or
    // it cannot, and a half-built one says so rather than pretending.
    travel: r.cells === 0 ? 'none' : r.built >= r.cells ? 'ready' : r.built > 0 ? 'part' : 'none',
  }));
}

/**
 * How a level is cut, said in the screen's words.
 *
 * The boards say "City or town" and the table says `town`. The alias is here
 * rather than in the screen because the address is the screen's word and the
 * column is the table's, and letting them drift made `?by=city` fall through to
 * counties under a header that said towns (Codex, 17 Sep 2026).
 */
const KIND_OF = { country: 'country', county: 'county', city: 'town', town: 'town', postcode: 'postcode' };

/** One area, by slug, whatever kind it is. */
export const areaBySlug = async (slug) => (await query(
  `select l.slug, l.name, l.kind, l.country_code, l.nation, l.parent_slug, l.lat, l.lng,
          p.name as parent_name
     from localities l left join localities p on p.slug = l.parent_slug
    where l.slug = $1`, [lower(slug)])).rows[0] ?? null;

/**
 * BO2a / BO2n — the level broken down by county, by town or by postcode district.
 *
 * `by` is how the same level is cut, never a different level: the country's
 * counties and the country's cities are the same places counted two ways.
 */
export async function breakdown(areaSlug, { by = 'county', sort = 'searches', desc = true, limit = 200, since = 30 } = {}) {
  const slug = lower(areaSlug);
  const kind = KIND_OF[by] ?? 'county';
  // A town under this area, a county in this country, an outcode our own places
  // fall in. All three are "areas that overlap the one we are standing in", and
  // `place_areas` answers all three the same way.
  const { rows } = await query(`
    with inside as (
      select pa2.area_slug
        from place_areas pa1
        join place_areas pa2 on pa2.venue_ref = pa1.venue_ref
       where pa1.area_slug = $1
       group by pa2.area_slug
    )
    select l.slug, l.name, l.kind, l.parent_slug, par.name as parent_name, ${FIVE},
           coalesce(d.searches, 0)::int as searches, coalesce(d.empty, 0)::int as empty
      from inside i
      join localities l on l.slug = i.area_slug and l.kind = $2
      left join localities par on par.slug = l.parent_slug
      left join area_stats st on st.area_slug = l.slug and st.category = '' and st.subcategory = '' and st.source = '' and st.ownership = ''
      left join lateral (
        select count(*)::int as searches, count(*) filter (where s.empty)::int as empty
          from searches s where s.area_slug = l.slug and s.at > now() - ($3 || ' days')::interval
      ) d on true
     limit $4`, [slug, kind, String(since), limit]);
  // How many there are at all, so a list that is a slice can say so rather than
  // reading as the whole (the boards print "8 of 1,204").
  const { rows: [all] } = await query(
    `with inside as (
       select pa2.area_slug from place_areas pa1
         join place_areas pa2 on pa2.venue_ref = pa1.venue_ref
        where pa1.area_slug = $1 group by pa2.area_slug)
     select count(*)::int as n from inside i join localities l on l.slug = i.area_slug and l.kind = $2`,
    [slug, kind]);

  const key = {
    known: (r) => r.known, owned: (r) => r.owned, identified: (r) => r.identified,
    ready: (r) => readyShare(r.ready_count, r.known) ?? -1,
    score: (r) => r.avg_score ?? -1, searches: (r) => r.searches, empty: (r) => r.empty,
    name: (r) => r.name,
  }[sort] ?? ((r) => r.searches);
  const out = rows.map((r) => ({
    slug: r.slug, name: r.name, kind: r.kind, parent: r.parent_name ?? null,
    known: r.known, owned: r.owned, identified: r.identified,
    readyCount: r.ready_count, ready: readyShare(r.ready_count, r.known),
    avgScore: r.avg_score == null ? null : Math.round(r.avg_score),
    searches: r.searches, empty: r.empty,
  }));
  out.sort((a, b) => {
    const av = key(a), bv = key(b);
    if (typeof av === 'string') return desc ? String(bv).localeCompare(av) : av.localeCompare(String(bv));
    return desc ? bv - av : av - bv;
  });
  return { rows: out, all: all.n };
}

/**
 * BO2b — the coverage grid: towns and the outcodes our own places fall in,
 * listed together because an outcode does not nest under a county.
 */
export async function coverage(areaSlug, { limit = 60 } = {}) {
  const slug = lower(areaSlug);
  // Half the room each. An outcode does not nest under a county, so the two are
  // listed together — and ordering the lot by size buried every town under sixty
  // outcodes, which is the one thing this board must not do (Codex, 17 Sep).
  const share = Math.max(10, Math.floor(limit / 2));
  const { rows } = await query(`
    with mine as (select venue_ref from place_areas where area_slug = $1),
         rows_ as (
           select pa.area_slug, pi.venue_ref, pi.ready, pi.score_parts
             from mine m
             join place_areas pa on pa.venue_ref = m.venue_ref
             join place_index pi on pi.venue_ref = m.venue_ref
            where pa.area_slug <> $1
         )
    select l.slug, l.name, l.kind,
           -- The towns this outcode's own places actually sit in — the way back
           -- across the two ladders, and the only honest thing to print beside
           -- an outcode. Read through the places, not through a parent an
           -- outcode does not have.
           (select string_agg(distinct t.name, ', ')
              from place_areas pa3
              join localities t on t.slug = pa3.area_slug and t.kind = 'town'
             where pa3.venue_ref in (select venue_ref from place_areas where area_slug = l.slug)) as towns,
           count(*)::int as known,
           count(*) filter (where pi.ownership <> 'identified')::int as owned,
           count(*) filter (where r.ready)::int as ready_count,
           count(*) filter (where (r.score_parts->'held') ? 'picture')::int    as picture,
           count(*) filter (where (r.score_parts->'held') ? 'what_it_is'
                               or (r.score_parts->'notCounted') ? 'what_it_is')::int as description,
           count(*) filter (where (r.score_parts->'held') ? 'hours'
                               or (r.score_parts->'notCounted') ? 'hours')::int      as hours,
           count(*) filter (where (r.score_parts->>'website') = 'true')::int          as website,
           count(*) filter (where (r.score_parts->'held') ? 'menu'
                               or (r.score_parts->'notCounted') ? 'menu')::int       as menu,
           count(*) filter (where pi.subcategory is not null)::int                   as shelf
      from rows_ r
      join localities l on l.slug = r.area_slug
      join place_index pi on pi.venue_ref = r.venue_ref
       where l.kind in ('town', 'postcode')
     group by l.slug, l.name, l.kind
     order by count(*) desc`, [slug]);
  const pct = (n, d) => (d > 0 ? Math.round((n / d) * 100) : null);
  const towns = rows.filter((r) => r.kind === 'town').slice(0, share);
  const codes = rows.filter((r) => r.kind === 'postcode').slice(0, limit - towns.length);
  return [...towns, ...codes].map((r) => ({
    slug: r.slug, name: r.name, kind: r.kind,
    // An outcode says which towns its own places sit in — the way back across
    // the two ladders, and the only honest thing to print beside it.
    within: r.kind === 'postcode' ? r.towns : null,
    known: r.known, owned: r.owned,
    ready: pct(r.ready_count, r.known),
    picture: pct(r.picture, r.known), description: pct(r.description, r.known),
    hours: pct(r.hours, r.known), website: pct(r.website, r.known),
    menu: pct(r.menu, r.known), shelf: pct(r.shelf, r.known),
  }));
}

/**
 * BO2c / BO2o / BO2p — the category ladder, **driven by the taxonomy rather than
 * by the data**.
 *
 * Every category and every subcategory is listed whether or not anything landed
 * in it, because an empty one is the finding. This inverts how every category
 * view in the codebase is fetched, and it is the only view that can show what a
 * county has none of.
 */
export async function categories(areaSlug, { refs = null, category = null, since = 30 } = {}) {
  const slug = lower(areaSlug);
  const scope = refs
    ? { sql: 'pi.venue_ref = any($1)', args: [refs] }
    : { sql: 'exists (select 1 from place_areas pa where pa.venue_ref = pi.venue_ref and pa.area_slug = $1)', args: [slug] };
  const { rows: held } = await query(`
    select pi.category, pi.subcategory,
           count(*)::int as known,
           count(*) filter (where pi.ownership <> 'identified')::int as owned,
           count(*) filter (where pi.ownership = 'identified')::int  as identified,
           count(*) filter (where pi.ready)::int as ready_count,
           avg(pi.data_score)::real as avg_score
      from place_index pi where ${scope.sql}
     group by pi.category, pi.subcategory`, scope.args);
  const bySub = new Map(held.filter((h) => h.subcategory).map((h) => [h.subcategory, h]));
  const byCat = new Map();
  for (const h of held) {
    if (!h.category) continue;
    const c = byCat.get(h.category) ?? { known: 0, owned: 0, identified: 0, ready_count: 0, sum: 0, n: 0 };
    c.known += h.known; c.owned += h.owned; c.identified += h.identified; c.ready_count += h.ready_count;
    if (h.avg_score != null) { c.sum += h.avg_score * h.known; c.n += h.known; }
    byCat.set(h.category, c);
  }

  // What was asked for here in the window. A ring scopes by cell, an area by
  // slug; neither invents a number for a subject nobody searched for.
  const demand = new Map((await query(
    refs
      ? `select subject, count(*)::int as searches, count(*) filter (where empty)::int as empty
           from searches s
          where s.at > now() - ($1 || ' days')::interval
            and exists (select 1 from place_index pi where pi.venue_ref = any($2) and pi.cell = s.cell)
          group by subject`
      : `select subject, count(*)::int as searches, count(*) filter (where empty)::int as empty
           from searches s
          where s.at > now() - ($1 || ' days')::interval and s.area_slug = $2
          group by subject`,
    [String(since), refs ?? slug])).rows.map((r) => [r.subject, r]));

  const { rows: taxonomy } = await query(`
    select c.key as category_key, c.label as category_label, c.position as cat_pos,
           s.key as sub_key, s.label as sub_label, s.position as sub_pos
      from shelf_categories c
      left join shelf_subcategories s on s.category_key = c.key and s.active
     where c.active
     order by c.position, s.position`);
  const bars_ = await bars();

  const out = [];
  let current = null;
  for (const t of taxonomy) {
    if (!current || current.key !== t.category_key) {
      const c = byCat.get(t.category_key);
      const d = demand.get(t.category_key);
      current = {
        key: t.category_key, label: t.category_label, subcategories: [],
        known: c?.known ?? 0, owned: c?.owned ?? 0, identified: c?.identified ?? 0,
        readyCount: c?.ready_count ?? 0, ready: readyShare(c?.ready_count ?? 0, c?.known ?? 0),
        avgScore: c && c.n ? Math.round(c.sum / c.n) : null,
        searches: d?.searches ?? 0, empty: d?.empty ?? 0,
      };
      out.push(current);
    }
    if (!t.sub_key) continue;
    if (category && t.category_key !== category) continue;
    const h = bySub.get(t.sub_key);
    const d = demand.get(t.sub_key);
    const bar = bars_.get(t.sub_key) ?? [];
    current.subcategories.push({
      key: t.sub_key, label: t.sub_label, category: t.category_key,
      known: h?.known ?? 0, owned: h?.owned ?? 0, identified: h?.identified ?? 0,
      readyCount: h?.ready_count ?? 0, ready: h ? readyShare(h.ready_count, h.known) : null,
      avgScore: h?.avg_score == null ? null : Math.round(h.avg_score),
      searches: d?.searches ?? 0, empty: d?.empty ?? 0,
      // What this kind of place is judged on, so the row can say it in words.
      // In the order the facts are defined, so every row reads the same way
      // round — a picture, what it is, opening hours — rather than alphabetically.
      needs: FACT_KEYS.filter((f) => bar.some((b) => b.required && b.fact === f)),
      barSet: bar.some((b) => b.required),
    });
  }
  // A search for something we have never shelved anywhere still has to appear,
  // or the count on the screen does not add up to the count in the log.
  for (const c of out) c.subcategories.sort((a, b) => b.known - a.known || a.label.localeCompare(b.label));
  return out;
}

/**
 * BO2c's other half — the labels lens, driven by the vocabulary rather than by
 * the data.
 *
 * Every word every provider uses, listed whether or not anything here carries
 * it, because a word we have taught a rule for and nothing lands on is exactly
 * as much of a finding as an empty subcategory.
 */
export async function labels(areaSlug, { refs = null, limit = 400 } = {}) {
  const scope = refs
    ? { sql: 'pil.venue_ref = any($1)', args: [refs] }
    : { sql: 'exists (select 1 from place_areas pa where pa.venue_ref = pil.venue_ref and pa.area_slug = $1)', args: [lower(areaSlug)] };
  const { rows: held } = await query(`
    select pil.label,
           count(*)::int as known,
           count(*) filter (where pi.ownership <> 'identified')::int as owned,
           count(*) filter (where pi.ready)::int as ready_count,
           avg(pi.data_score)::real as avg_score
      from place_index_labels pil
      join place_index pi on pi.venue_ref = pil.venue_ref
     where ${scope.sql}
     group by pil.label`, scope.args);
  const by = new Map(held.map((h) => [h.label, h]));
  const { rows: vocab } = await query(
    `select namespace || ':' || key as word, coalesce(label, key) as label, points_at
       from taxonomy_labels order by namespace, key limit $1`, [limit]);
  return vocab.map((v) => {
    const h = by.get(v.word);
    return {
      key: v.word, label: v.label, pointsAt: v.points_at,
      known: h?.known ?? 0, owned: h?.owned ?? 0,
      readyCount: h?.ready_count ?? 0, ready: h ? readyShare(h.ready_count, h.known) : null,
      avgScore: h?.avg_score == null ? null : Math.round(h.avg_score),
    };
  }).sort((a, b) => b.known - a.known || a.key.localeCompare(b.key));
}

/**
 * BO2d — the source lens.
 *
 * `oneSourceOnly` is the column that matters: places a single source has ever
 * returned, which we would lose if that source went dark. `googleOnly` is the
 * subset of those we hold no name for at all.
 */
export async function sources(areaSlug, { refs = null, limit = 60 } = {}) {
  const scope = refs
    ? { sql: 'pi.venue_ref = any($1)', args: [refs] }
    : { sql: 'exists (select 1 from place_areas pa where pa.venue_ref = pi.venue_ref and pa.area_slug = $1)', args: [lower(areaSlug)] };
  const { rows } = await query(`
    with scoped as (select pi.venue_ref, pi.subcategory, pi.ownership from place_index pi where ${scope.sql}),
         n as (select s.venue_ref, count(*)::int as sources from scoped s join place_index_sources src on src.venue_ref = s.venue_ref group by s.venue_ref)
    select s.subcategory,
           count(*)::int as known,
           ${SOURCES.map((x, i) => (x.key === 'own'
             // "Ours" is the same fact the OWNED figure above it is, so it is
             // counted the same way. Counting the `own` *source* instead made
             // one screen say 58 owned over a column of dashes (Codex, 17 Sep).
             ? `count(*) filter (where s.ownership <> 'identified')::int as src_${i}`
             : `count(*) filter (where exists (select 1 from place_index_sources q where q.venue_ref = s.venue_ref and q.source = '${x.key}'))::int as src_${i}`)).join(',\n           ')},
           count(*) filter (where coalesce(n.sources, 0) = 1)::int as one_only,
           count(*) filter (where coalesce(n.sources, 0) = 1 and s.venue_ref like 'google:%')::int as google_only
      from scoped s left join n on n.venue_ref = s.venue_ref
     where s.subcategory is not null
     group by s.subcategory
     order by count(*) desc
     limit $${scope.args.length + 1}`, [...scope.args, limit]);
  const labels = new Map((await query('select key, label from shelf_subcategories')).rows.map((r) => [r.key, r.label]));
  // Which sources we have ever asked anywhere. A source never asked reads
  // "not asked" on every row, never as nothing.
  const asked = new Set((await query('select distinct source from place_index_sources')).rows.map((r) => r.source));
  // How many subcategories there are at all, because "5 of 59" is the finding:
  // the ones that are not listed are the ones nothing landed in.
  const all = (await query('select count(*)::int as n from shelf_subcategories where active')).rows[0].n;
  return {
    sources: SOURCES.map((s) => ({ ...s, asked: asked.has(s.key) })),
    subcategories: all,
    rows: rows.map((r) => ({
      key: r.subcategory, label: labels.get(r.subcategory) ?? r.subcategory, known: r.known,
      counts: Object.fromEntries(SOURCES.map((s, i) => [s.key, asked.has(s.key) ? r[`src_${i}`] : null])),
      oneOnly: r.one_only, googleOnly: r.google_only,
    })),
  };
}

/** BO2e — the score distribution, the staleness lens, and what is worth owning next. */
export async function quality(areaSlug, { refs = null, limit = 12 } = {}) {
  const scope = refs
    ? { sql: 'pi.venue_ref = any($1)', args: [refs] }
    : { sql: 'exists (select 1 from place_areas pa where pa.venue_ref = pi.venue_ref and pa.area_slug = $1)', args: [lower(areaSlug)] };
  const { rows: bands } = await query(`
    select case when pi.data_score is null then 'unscored'
                when pi.data_score > 80 then '81-100' when pi.data_score > 60 then '61-80'
                when pi.data_score > 40 then '41-60'  when pi.data_score > 20 then '21-40'
                else '1-20' end as band, count(*)::int as n
      from place_index pi where ${scope.sql} group by 1`, scope.args);
  const { rows: stale } = await query(`
    select case when pi.oldest_fact is null then 'never'
                when pi.oldest_fact > now() - interval '3 months'  then 'under3'
                when pi.oldest_fact > now() - interval '12 months' then 'under12'
                else 'over12' end as band, count(*)::int as n
      from place_index pi where ${scope.sql} group by 1`, scope.args);
  // Worth owning next: ranked on how many people have been, with the rating as a
  // band and never a figure. The star figure is deliberately absent (BO7a).
  const { rows: worth } = await query(`
    select pi.venue_ref, pi.subcategory, pi.data_score, pi.ownership,
           coalesce(sp.count_band, r.count_band) as count_band,
           coalesce(sp.crowd_band, r.crowd_band) as crowd_band,
           (select string_agg(src.source, ',' order by src.source) from place_index_sources src where src.venue_ref = pi.venue_ref) as srcs,
           (select lower(pa.area_slug) from place_areas pa join localities l on l.slug = pa.area_slug
             where pa.venue_ref = pi.venue_ref and l.kind = 'postcode' limit 1) as outcode
      from place_index pi
      left join lateral (select count_band, crowd_band from scout_places s where s.venue_ref = pi.venue_ref order by last_seen desc limit 1) sp on true
      left join place_records r on r.venue_ref = pi.venue_ref
     where ${scope.sql} and pi.ownership = 'identified'
     order by case coalesce(sp.count_band, r.count_band)
                when 'thousands' then 4 when 'many' then 3 when 'hundreds' then 2 when 'few' then 1 else 0 end desc,
              case coalesce(sp.crowd_band, r.crowd_band)
                when 'top' then 4 when 'high' then 3 when 'good' then 2 when 'mixed' then 1 else 0 end desc,
              pi.data_score asc nulls first
     limit $${scope.args.length + 1}`, [...scope.args, limit]);
  const named = await namesFor(worth.map((w) => w.venue_ref));
  const labels = new Map((await query('select key, label from shelf_subcategories')).rows.map((r) => [r.key, r.label]));
  const at = (list, k) => list.find((b) => b.band === k)?.n ?? 0;
  return {
    bands: [
      { band: '81–100', n: at(bands, '81-100') }, { band: '61–80', n: at(bands, '61-80') },
      { band: '41–60', n: at(bands, '41-60') }, { band: '21–40', n: at(bands, '21-40') },
      { band: '1–20', n: at(bands, '1-20') },
    ],
    unscored: at(bands, 'unscored'),
    stale: [
      { key: 'under3', label: 'Under 3 months', n: at(stale, 'under3') },
      { key: 'under12', label: '3 to 12 months', n: at(stale, 'under12') },
      { key: 'over12', label: 'Over 12 months', n: at(stale, 'over12') },
      { key: 'never', label: 'Never checked', n: at(stale, 'never') },
    ],
    worth: worth.map((w) => ({
      ref: w.venue_ref, name: named.get(w.venue_ref)?.name ?? null,
      subcategory: labels.get(w.subcategory) ?? null, outcode: w.outcode ? w.outcode.toUpperCase() : null,
      sources: (w.srcs ?? '').split(',').filter(Boolean),
      // A word, not a figure — and a place nothing rating-bearing has returned
      // gets no band at all rather than a zero.
      rating: w.crowd_band, been: w.count_band, score: w.data_score,
    })),
  };
}

/**
 * BO2q — the places themselves, one row per place with a tick or a dash per
 * fact, and a sortable count of what is missing.
 */
export async function places(areaSlug, {
  refs = null, category = null, subcategory = null, show = 'not-ready', q = null,
  missing = null, sort = 'missing', desc = true, limit = 200,
} = {}) {
  const args = [];
  const where = [];
  if (refs) { args.push(refs); where.push(`pi.venue_ref = any($${args.length})`); }
  else { args.push(lower(areaSlug)); where.push(`exists (select 1 from place_areas pa where pa.venue_ref = pi.venue_ref and pa.area_slug = $${args.length})`); }
  if (category) { args.push(category); where.push(`pi.category = $${args.length}`); }
  if (subcategory) { args.push(subcategory); where.push(`pi.subcategory = $${args.length}`); }
  if (show === 'ready') where.push('pi.ready');
  if (show === 'not-ready') where.push('not pi.ready');
  if (missing) { args.push(missing); where.push(`(pi.score_parts->'missing') ? $${args.length}`); }
  args.push(limit);
  const { rows } = await query(`
    select pi.venue_ref, pi.subcategory, pi.category, pi.data_score, pi.ready, pi.score_parts, pi.ownership, pi.oldest_fact,
           (select count(*)::int from place_index_sources src where src.venue_ref = pi.venue_ref) as seen_by,
           (select string_agg(src.source, ',' order by src.source) from place_index_sources src where src.venue_ref = pi.venue_ref) as srcs,
           (select upper(pa.area_slug) from place_areas pa join localities l on l.slug = pa.area_slug
             where pa.venue_ref = pi.venue_ref and l.kind = 'postcode' limit 1) as outcode
      from place_index pi
     where ${where.join(' and ')}
     order by pi.data_score asc nulls first
     limit $${args.length}`, args);
  const named = await namesFor(rows.map((r) => r.venue_ref));
  const all = SOURCES.map((s) => s.key);
  let out = rows.map((r) => {
    const parts = r.score_parts ?? {};
    const seen = new Set((r.srcs ?? '').split(',').filter(Boolean));
    const unseen = all.filter((s) => !seen.has(s));
    return {
      ref: r.venue_ref, name: named.get(r.venue_ref)?.name ?? null, nameFrom: named.get(r.venue_ref)?.from ?? null,
      category: r.category, subcategory: r.subcategory, outcode: r.outcode ?? null,
      score: r.data_score, ready: r.ready, ownership: r.ownership, oldestFact: r.oldest_fact,
      facts: Object.fromEntries(FACT_KEYS.map((f) => [f,
        (parts.judged ?? []).some((j) => j.fact === f)
          ? ((parts.held ?? []).includes(f) ? 'yes' : 'no')
          : ((parts.notCounted ?? []).includes(f) ? 'yes-uncounted' : 'n/a')])),
      missing: (parts.missing ?? []).length,
      missingFacts: parts.missing ?? [],
      barSet: parts.set !== false,
      unseenBy: unseen, seenBy: [...seen],
    };
  });
  if (q) {
    const needle = q.toLowerCase();
    out = out.filter((p) => (p.name ?? p.ref).toLowerCase().includes(needle));
  }
  const key = { missing: (p) => p.missing, score: (p) => p.score ?? -1, name: (p) => p.name ?? p.ref, unseen: (p) => p.unseenBy.length }[sort] ?? ((p) => p.missing);
  out.sort((a, b) => {
    const av = key(a), bv = key(b);
    if (typeof av === 'string') return desc ? String(bv).localeCompare(av) : av.localeCompare(String(bv));
    return desc ? bv - av : av - bv;
  });
  return out;
}

/**
 * Names, from where they are already legitimately held.
 *
 * An owned record, then the atlas (Wikipedia and Wikidata, ours to keep), then
 * OpenStreetMap through the sweep — and never the sweep's copy for a `google:`
 * ref, because that name is Google's. A Google-only place therefore has no name
 * here, which is the finding rather than a gap.
 */
export async function namesFor(refs) {
  const out = new Map();
  if (!refs?.length) return out;
  const { rows } = await query(`
    select pi.venue_ref,
           r.name as own_name,
           a.name as atlas_name,
           case when pi.venue_ref like 'google:%' then null else sp.name end as osm_name
      from place_index pi
      left join place_records r on r.venue_ref = pi.venue_ref
      left join attractions a on (a.venue_ref = pi.venue_ref or 'atlas:' || a.id::text = pi.venue_ref) and a.state <> 'rejected'
      left join lateral (select name from scout_places s where s.venue_ref = pi.venue_ref order by last_seen desc limit 1) sp on true
     where pi.venue_ref = any($1)`, [refs]);
  for (const r of rows) {
    const name = r.own_name ?? r.atlas_name ?? r.osm_name ?? null;
    const from = r.own_name ? 'ours' : r.atlas_name ? 'atlas' : r.osm_name ? 'osm' : null;
    out.set(r.venue_ref, { name, from });
  }
  return out;
}

export default {
  SOURCES, bars, seedBars, setBar, reindex, rescore, note, noteMany, refreshStats, statsAge,
  statsFor, statsForRefs, countries, areaBySlug, breakdown, coverage, categories, shelveAll,
  sources, quality, places, namesFor, labels,
};
