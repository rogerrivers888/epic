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

import { pool, query, withTransaction } from '../db.js';
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

/**
 * What makes a `place_records` row an *owned* place.
 *
 * Any one fact of our own is enough — a sentence we wrote, the address of their
 * own page, the hours they publish, a price band, a street, a telephone number,
 * whether you can get in without steps. An empty row is a place we have noticed
 * and not researched, and calling that owned is how 1,357 of 1,361 places came
 * to look researched on a board whose average score was ten (17 Sep 2026).
 */
const OWNED_RECORD = `(
  coalesce(r.summary, r.website, r.opening_hours, r.price_range, r.address, r.phone) is not null
  or r.accessibility <> '{}'::jsonb
  or r.curated_at is not null
)`;

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
             -- Approved, not merely keepable. may_store is a licence fact and
             -- stays true on a household photograph that is still waiting, and
             -- on one a moderator has rejected — so the bar counted pictures
             -- nobody will ever be shown (Codex, 17 Sep 2026). The same
             -- condition every read that publishes one applies.
             (exists (select 1 from image_links li join image_assets ia on ia.id = li.image_id
                       where ia.may_store and ia.moderation = 'approved'
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
        -- Not a rejected one. Every other query about an attraction excludes
        -- them, and this one did not — so a place could be scored ready on a
        -- summary, a website, opening hours and pictures belonging to an
        -- attraction somebody had thrown out (Codex, 17 Sep 2026).
        left join attractions  a on (a.venue_ref = pi.venue_ref or 'atlas:' || a.id::text = pi.venue_ref)
                                and a.state <> 'rejected'
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
  // Under the build lock, like every other rebuild. A manual one could land on
  // top of the hourly settling pass or on another manual one, and all three
  // delete and refill the same derived tables (Codex, 17 Sep 2026).
  return underTheBuildLock(() => reindexWhileLocked({ onProgress }), { places: 0, skipped: 'a rebuild is already going on' });
}

async function reindexWhileLocked({ onProgress }) {
  const t0 = Date.now();

  // 1 — every place, from every harvest. `on conflict` keeps `first_seen`, so a
  //     rebuild never rewrites when we first saw something.
  await query(`
    insert into place_index (venue_ref, lat, lng, country_code, category, subcategory, derived_by, ownership, first_seen, last_seen)
    -- Null, not 'GB'. A region with no country is a country nobody has told us,
    -- and guessing here put the place under Great Britain for good — the exact
    -- thing migration 159 exists to stop (Codex, 17 Sep 2026).
    select coalesce(a.venue_ref, 'atlas:' || a.id::text), a.lat, a.lng, reg.country_code,
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
    -- The same: an area with no country says nothing rather than saying Britain.
    select sp.venue_ref, sp.lat, sp.lng, sa.country_code, 'sweep', 'identified', min(sp.first_seen), max(sp.last_seen)
      from scout_places sp left join scout_areas sa on sa.code = sp.area_code
     group by sp.venue_ref, sp.lat, sp.lng, sa.country_code
    on conflict (venue_ref) do update
       set lat = coalesce(place_index.lat, excluded.lat),
           lng = coalesce(place_index.lng, excluded.lng),
           last_seen = greatest(place_index.last_seen, excluded.last_seen)`);

  // An owned record is one that holds something of ours to read.
  //
  // `ensureRecord` makes an empty row the moment a household touches a place,
  // and calling that owned counted every place we had merely *noticed* as one
  // we had researched — so coverage read better than it was and Collect skipped
  // the places that most needed it (Codex, 17 Sep 2026). The same question
  // `noteOwned` answers, asked of the same columns.
  await query(`
    insert into place_index (venue_ref, lat, lng, derived_by, ownership, first_seen, last_seen)
    select r.venue_ref, r.lat, r.lng, 'own',
           case when ${OWNED_RECORD} then 'owned' else 'identified' end,
           r.first_owned, r.updated_at
      from place_records r
    on conflict (venue_ref) do update
       set lat = coalesce(place_index.lat, excluded.lat),
           lng = coalesce(place_index.lng, excluded.lng),
           ownership = case when excluded.ownership = 'owned' then 'owned' else place_index.ownership end,
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
    select r.venue_ref, 'own', r.venue_ref, r.first_owned, r.updated_at
      from place_records r
     -- Only a record that holds something of ours. ensureRecord makes an
     -- empty row before the research runs, and the own row's last_seen is
     -- what the twelve-month free-collection window reads — so stamping one
     -- here shut the free pass out of every unresearched place for a year,
     -- which is the exact thing ensureRecord was changed to stop doing
     -- (Codex, 17 Sep 2026). The same predicate, asked in the same words.
     where ${OWNED_RECORD}
    on conflict (venue_ref, source) do update set last_seen = greatest(place_index_sources.last_seen, excluded.last_seen)`);
  // And any row an earlier build synthesised for an empty record goes, or the
  // window stays shut on it until the record is finally researched.
  await query(`
    delete from place_index_sources src
     where src.source = 'own'
       and exists (select 1 from place_records r where r.venue_ref = src.venue_ref and not ${OWNED_RECORD})`);
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

  // A rebuild places everything it touched, so the incremental pass afterwards
  // has nothing left to do.
  await query('update place_index set placed_at = now()');
  const total = (await query('select count(*)::int as n from place_index')).rows[0].n;
  await refreshStats();
  return { places: total, ...scored, ms: Date.now() - t0 };
}

/**
 * Build the index the first time, if nothing ever has.
 *
 * The index is derived: on an installation that predates it, migration 142
 * creates the tables empty and every board in Places reads as though Epic had
 * never seen a place. Nothing put that right except an administrator noticing
 * and pressing Rebuild (Codex, 17 Sep 2026).
 *
 * Run at boot. It is a full rebuild, so it is only ever done when the index is
 * empty *and* there is something to put in it — not on a fresh database, and
 * never a second time.
 */
export async function buildIfEmpty() {
  const { rows: [have] } = await query('select count(*)::int as n from place_index');
  if (have.n > 0) return { built: false, places: have.n };
  const { rows: [any] } = await query(`
    select (select count(*) from attractions)     +
           (select count(*) from scout_places)    +
           (select count(*) from place_records)   +
           (select count(*) from household_places) as n`);
  if (!Number(any.n)) return { built: false, places: 0 };

  // One instance, not all of them.
  //
  // A rebuild deletes and refills `place_areas`, the labels and `area_stats`
  // wholesale, and those inserts are not conflict-safe — so two instances
  // booting together could both find the index empty, both start, and leave
  // half a set of rollups between them (Codex, 17 Sep 2026).
  //
  // An advisory lock is held by a *connection*, so it is taken on a client of
  // our own and released on the same one. Through the pool it could be taken on
  // one connection and unlocked on another, which fails quietly and leaks the
  // lock until that connection is recycled (`reach.js` does the same thing for
  // the same reason).
  return underTheBuildLock(
    async () => {
      // The second look, now that nobody else can be in here: whoever lost the
      // race may have finished the whole thing while we waited.
      const { rows: [again] } = await query('select count(*)::int as n from place_index');
      if (again.n > 0) return { built: false, places: again.n };
      // The bars first. Scoring against an empty `ready_bars` marks every place
      // "not set" and not ready, which is a worse answer than no answer — it
      // reads as a finding rather than as a job that has not run.
      await seedBars();
      // The already-locked implementation, not `reindex()`: we are holding the
      // lock, and asking for it again on another pooled connection answered
      // "somebody else is rebuilding" — so the first build on an upgraded
      // installation reported success and did nothing at all (Codex, 17 Sep
      // 2026).
      return { built: true, ...await reindexWhileLocked({ onProgress: null }) };
    },
    { built: false, places: 0, why: 'another instance is building it' },
  );
}

/**
 * The lock every rebuild of the derived tables is taken under.
 *
 * `reindex()` deletes and refills `place_areas`, the labels and `area_stats`
 * wholesale, and `settleNew()` writes the same tables for a handful of places.
 * Run together — two instances booting, or the first build racing the hourly
 * sweep in one process — either can fail or leave half a set of rollups, and
 * because any row in `place_index` makes the next `buildIfEmpty()` return
 * early, an incomplete first build would never retry itself (Codex, 17 Sep
 * 2026).
 *
 * An advisory lock belongs to a *connection*, so it is taken on a client of our
 * own and released on the same one; through the pool it could be taken on one
 * and unlocked on another, which fails quietly and leaks the lock. `reach.js`
 * does the same thing for the same reason.
 *
 * Whoever does not get it does not queue: the pass already going is about to do
 * the same work.
 */
async function underTheBuildLock(fn, ifBusy) {
  const client = await pool.connect();
  try {
    const { rows: [got] } = await client.query('select pg_try_advisory_lock(hashtext($1)) as mine', [BUILD_LOCK]);
    if (!got.mine) return ifBusy;
    try { return await fn(); }
    finally { await client.query('select pg_advisory_unlock(hashtext($1))', [BUILD_LOCK]).catch(() => null); }
  } finally {
    client.release();
  }
}

/** What a rebuild is claimed under. */
const BUILD_LOCK = 'epic.placeIndex.build';

/**
 * Place the ones nobody has placed yet.
 *
 * `noteMany` writes the row the moment a place is kept, and that is all it
 * writes: no area, no cell, no shelf, no score. But every board in Places reads
 * through `place_areas`, so until something derives those a newly swept or
 * claimed place is in the index and invisible on the screen — and it stayed
 * that way until an administrator thought to press Rebuild (Codex, 17 Sep
 * 2026).
 *
 * This is the same derivation the full rebuild does, scoped to the places that
 * have never had it. `placed_at` is the marker (migration 149) rather than
 * `indexed_at`, which defaults to now() and so is already set on a brand new
 * row. It runs on the hour and whenever somebody presses Refresh, and it is
 * safe to run when there is nothing to do: one indexed read that finds nothing.
 */
export async function settleNew({ limit = 5000 } = {}) {
  // Under the same lock as a full rebuild: the two write the same tables, and a
  // settling pass running inside a rebuild can leave either half-done (Codex,
  // 17 Sep 2026). Whoever does not get the lock does nothing — the rebuild
  // going on is about to place everything anyway.
  return underTheBuildLock(() => settleWhileLocked(limit), { settled: 0, why: 'a rebuild is going on' });
}

async function settleWhileLocked(limit) {
  // Same reason as `buildIfEmpty`: a first sweep on a fresh installation must
  // not score its places against a bar nobody has set.
  await seedBars();
  const { rows: waiting } = await query(
    'select venue_ref from place_index where placed_at is null limit $1', [limit]);
  if (!waiting.length) return { settled: 0 };
  const refs = waiting.map((r) => r.venue_ref);

  // 0 — the country, where something knows it and the row does not.
  //
  //     The write path says nothing when it does not know, so this fills it
  //     from the same places the rebuild reads — the sweep's area, the
  //     harvest's region — and leaves it null when nobody knows. Without it a
  //     newly swept place had no country, and the country is the first area
  //     every board reads through (Codex, 17 Sep 2026).
  await query(`
    update place_index pi set country_code = coalesce(sa.country_code, reg.country_code)
      from (select venue_ref from place_index where venue_ref = any($1) and country_code is null) todo
      left join lateral (
        select sa.country_code from scout_places sp join scout_areas sa on sa.code = sp.area_code
         where sp.venue_ref = todo.venue_ref limit 1) sa on true
      left join lateral (
        select reg.country_code from attractions a join regions reg on reg.slug = a.region_slug
         where (a.venue_ref = todo.venue_ref or 'atlas:' || a.id::text = todo.venue_ref) limit 1) reg on true
     where pi.venue_ref = todo.venue_ref
       and coalesce(sa.country_code, reg.country_code) is not null`, [refs]);

  // 1 — where they are. The same four sources the rebuild reads, and the same
  //     rule that a town carries its county. Nothing is deleted first: these
  //     places have no area rows yet, by definition.
  await query(`
    insert into place_areas (venue_ref, area_slug)
    select pi.venue_ref, lower(pi.country_code) from place_index pi
     where pi.venue_ref = any($1) and pi.country_code is not null
    on conflict do nothing`, [refs]);
  await query(`
    insert into place_areas (venue_ref, area_slug)
    select coalesce(a.venue_ref, 'atlas:' || a.id::text), x.slug
      from attractions a
      cross join lateral (values (a.region_slug), (a.locality_slug), (lower(a.outcode))) as x(slug)
     where a.state <> 'rejected' and x.slug is not null
       and coalesce(a.venue_ref, 'atlas:' || a.id::text) = any($1)
    on conflict do nothing`, [refs]);
  await query(`
    insert into place_areas (venue_ref, area_slug)
    select sp.venue_ref, x.slug
      from scout_places sp
      cross join lateral (values (sp.locality_slug), (lower(sp.outcode))) as x(slug)
     where x.slug is not null and sp.venue_ref = any($1)
    on conflict do nothing`, [refs]);
  await query(`
    insert into place_areas (venue_ref, area_slug)
    select r.venue_ref, lower(substring(replace(upper(r.postcode), ' ', '') from '^[A-Z]{1,2}[0-9][0-9A-Z]?'))
      from place_records r
     where r.venue_ref = any($1) and r.postcode is not null
       and substring(replace(upper(r.postcode), ' ', '') from '^[A-Z]{1,2}[0-9][0-9A-Z]?') is not null
    on conflict do nothing`, [refs]);
  await query(`
    insert into place_areas (venue_ref, area_slug)
    select pa.venue_ref, l.parent_slug
      from place_areas pa join localities l on l.slug = pa.area_slug
     where pa.venue_ref = any($1) and l.kind = 'town' and l.parent_slug is not null
    on conflict do nothing`, [refs]);

  // 2 — the cell the reach build stamped, so a ring finds them.
  await query(`
    update place_index pi set cell = pc.cell
      from place_cells pc
     where pc.venue_ref = pi.venue_ref and pi.venue_ref = any($1) and pi.cell is distinct from pc.cell`, [refs]);

  // 3 — our shelf, and 4 — the score, which is what clears `indexed_at`.
  await shelveAll({ refs });
  const scored = await rescore({ refs });
  // Placed. Whether or not any of it found anything — an outcode nobody has
  // swept yet has no area to be in, and retrying it every hour for ever would
  // starve the ones that do. The next full rebuild picks it up.
  await query('update place_index set placed_at = now() where venue_ref = any($1)', [refs]);
  // The boards read `area_stats`, so a place placed but not counted is still
  // missing from every headline.
  await refreshStats();
  return { settled: refs.length, ...scored };
}

/**
 * Work every place's score out again from scratch.
 *
 * Free, no network, and the thing to run after any change to the bar. Nothing is
 * adjusted: the score is a pure function of the facts held and the bar in force,
 * so a rebuild cannot drift from what the screen says the weights are.
 */
export async function rescore({ subcategory = null, refs = null } = {}) {
  const bar = await bars();
  const args = [];
  const where = [];
  if (subcategory) { args.push(subcategory); where.push(`p.subcategory = $${args.length}`); }
  if (refs) { args.push(refs); where.push(`p.venue_ref = any($${args.length})`); }
  const { rows } = await query(
    `${HELD_SQL} join place_index p on p.venue_ref = x.venue_ref
      ${where.length ? `where ${where.join(' and ')}` : ''}`, args);
  const { rows: subRows } = refs
    ? await query('select venue_ref, subcategory from place_index where venue_ref = any($1)', [refs])
    : await query('select venue_ref, subcategory from place_index');
  const subs = new Map(subRows.map((r) => [r.venue_ref, r.subcategory]));
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
export async function shelveAll({ refs = null } = {}) {
  const [taught, tax] = await Promise.all([shelfRules(), taxonomy()]);
  // Only the shelves being rebuilt are cleared. A full pass wipes the lot and
  // fills it again; an incremental one must not throw away every other place's
  // words to file a hundred new ones.
  if (refs) await query('delete from place_index_labels where venue_ref = any($1)', [refs]);
  else await query('delete from place_index_labels');
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
     where pi.derived_by is distinct from 'hand'
       ${refs ? 'and pi.venue_ref = any($1)' : ''}`, refs ? [refs] : []);

  const chunk = [];
  // The words each place was filed by, so the labels lens can be driven by the
  // taxonomy the way the subcategory lens is — every label listed whether or not
  // anything carries it, because an empty one is the finding.
  const words = [];
  const flush = async () => {
    if (chunk.length) {
      // Cast, because a row that clears a shelf is four nulls and Postgres
      // cannot infer a type from nothing (17 Sep 2026).
      const values = chunk.map((_, i) => `($${i * 4 + 1}::text,$${i * 4 + 2}::text,$${i * 4 + 3}::text,$${i * 4 + 4}::text)`).join(',');
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
    if (!filed) {
      // Nothing resolves it any more — its attraction was rejected, or the
      // classification it was filed by is gone. The old shelf used to stay,
      // so even a full rebuild went on counting the place under a drawer
      // nothing put it in (Codex, 17 Sep 2026). A shelf set by hand is
      // somebody's decision and survives; a derived one does not outlive what
      // derived it.
      if (r.derived_by !== 'hand') { chunk.push([r.venue_ref, null, null, null]); if (chunk.length >= 500) await flush(); }
      continue;
    }
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
export async function noteMany(places = [], { source = null, countryCode = null, ownership = null, client = null } = {}) {
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
              -- The first source that knows fills it, and nothing overwrites
              -- it afterwards (Codex, 17 Sep 2026, four rounds on this one
              -- line). Two earlier rules leaked — a default that could be
              -- overwritten, then a confirmed value that could not be told
              -- from the default — and the third was "never change", which
              -- filed every place nobody had told us about under Great
              -- Britain, permanently. Null is the honest third state
              -- (migration 159): nobody has said.
              country_code = coalesce(place_index.country_code, excluded.country_code),
              -- identified < claimed < owned, and only ever upward: a household
              -- claiming a place we already research does not un-own it.
              ownership = case when place_index.ownership = 'owned' or excluded.ownership = 'owned' then 'owned'
                               when place_index.ownership = 'claimed' or excluded.ownership = 'claimed' then 'claimed'
                               else 'identified' end,
              -- An ownership that moved is a place that counts differently, and
              -- area_stats counts ownership. Clearing placed_at puts it back
              -- in settleNew's hands so the rollups catch up on the hour
              -- rather than at the next full rebuild (Codex, 17 Sep 2026).
              placed_at = case
                when place_index.ownership <> (
                  case when place_index.ownership = 'owned' or excluded.ownership = 'owned' then 'owned'
                       when place_index.ownership = 'claimed' or excluded.ownership = 'claimed' then 'claimed'
                       else 'identified' end)
                then null else place_index.placed_at end,
              last_seen = now()`,
      rows.flatMap((p) => [p.ref, p.lat ?? null, p.lng ?? null, p.countryCode ?? countryCode, p.ownership ?? ownership ?? 'identified']));
    // Who has returned each place, which may be more than one of them.
    //
    // A sweep result is often Google *and* OpenStreetMap, and the sweep keeps
    // that in `scout_places.from_sources` — but only the synthetic `sweep` was
    // handed to the index, so the sources lens undercounted both and read
    // combined places as single-source (Codex, 17 Sep 2026).
    const triples = rows.flatMap((p) => {
      const said = Array.isArray(p.sources) && p.sources.length ? p.sources : [p.source ?? source];
      return said
        .filter(Boolean)
        .map((s) => [p.ref, String(s), p.sourceId ?? null])
        // Two names for the same source in one list would be two identical
        // tuples, and `on conflict` cannot see a duplicate inside its own
        // statement.
        .filter((t, i, all) => all.findIndex((o) => o[1] === t[1]) === i);
    });
    if (triples.length) {
      const src = triples.map((_, i) => `($${i * 3 + 1},$${i * 3 + 2},$${i * 3 + 3})`).join(',');
      const said = await exec(
        `insert into place_index_sources (venue_ref, source, source_place_id)
         values ${src}
         on conflict (venue_ref, source) do update
            set last_seen = now(),
                -- An identifier we have just paid to find fills a row that had
                -- none. It never overwrites one we already hold: the match is
                -- the thing that stops us paying for it twice (Codex, 17 Sep).
                source_place_id = coalesce(place_index_sources.source_place_id, excluded.source_place_id)
         -- xmax is nought on a row this statement inserted, which is how a new
         -- source is told from one we already knew about.
         returning venue_ref, (xmax = 0) as first_time`,
        triples.flat());
      // A source nobody had seen before changes the sources lens, so those
      // places go back in the settling queue too.
      const fresh = [...new Set(said.rows.filter((r) => r.first_time).map((r) => r.venue_ref))];
      if (fresh.length) {
        await exec('update place_index set placed_at = null where venue_ref = any($1)', [fresh]);
      }
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
  // Emptied and refilled in one go.
  //
  // The delete committed on its own and four inserts followed it, so anybody
  // reading a board in between saw an empty dashboard — and an insert that
  // failed left `area_stats` half-built until the next successful refresh
  // (Codex, 17 Sep 2026). In one transaction, a reader holds the previous
  // complete answer until the replacement is ready.
  return withTransaction(async (client) => {
    await client.query('delete from area_stats');
    // Three kinds, counted as three. Owned used to mean "not identified", which
    // put every place a household had merely *claimed* into the figure the screen
    // defines as holding our own research — so coverage read better than it was
    // and the places most worth curating were the ones hidden by it (Codex,
    // 17 Sep 2026).
    const shared = `
        count(*)::int                                                        as places,
        count(*) filter (where pi.ownership = 'owned')::int                   as owned,
        count(*) filter (where pi.ownership = 'claimed')::int                 as claimed,
        count(*) filter (where pi.ownership = 'identified')::int              as identified,
        count(*) filter (where pi.ready)::int                                 as ready,
        avg(pi.data_score)::real                                              as avg_score`;
    await client.query(`
      insert into area_stats (area_slug, category, subcategory, source, ownership, places, owned, claimed, identified, ready, avg_score)
      select pa.area_slug, '', '', '', '', ${shared}
        from place_areas pa join place_index pi on pi.venue_ref = pa.venue_ref
       group by pa.area_slug`);
    await client.query(`
      insert into area_stats (area_slug, category, subcategory, source, ownership, places, owned, claimed, identified, ready, avg_score)
      select pa.area_slug, pi.category, '', '', '', ${shared}
        from place_areas pa join place_index pi on pi.venue_ref = pa.venue_ref
       where pi.category is not null
       group by pa.area_slug, pi.category`);
    await client.query(`
      insert into area_stats (area_slug, category, subcategory, source, ownership, places, owned, claimed, identified, ready, avg_score)
      select pa.area_slug, coalesce(pi.category, ''), pi.subcategory, '', '', ${shared}
        from place_areas pa join place_index pi on pi.venue_ref = pa.venue_ref
       where pi.subcategory is not null
       group by pa.area_slug, pi.category, pi.subcategory`);
    await client.query(`
      insert into area_stats (area_slug, category, subcategory, source, ownership, places, owned, claimed, identified, ready, avg_score)
      select pa.area_slug, '', '', src.source, '', ${shared}
        from place_areas pa
        join place_index pi on pi.venue_ref = pa.venue_ref
        join place_index_sources src on src.venue_ref = pi.venue_ref
       group by pa.area_slug, src.source`);
    const { rows } = await client.query('select count(*)::int as n, max(refreshed_at) as at from area_stats');
    return rows[0];
  });
}

/** When the counts were last rebuilt, so the screen can say "4 min ago". */
export const statsAge = async () =>
  (await query('select max(refreshed_at) as at from area_stats')).rows[0]?.at ?? null;

// ---------------------------------------------------------------------------
// reading it
// ---------------------------------------------------------------------------

/**
 * How each column of the breakdown ladder is ordered, in the database.
 *
 * It has to be the database, because the list is a slice: sorting a page that
 * was chosen arbitrarily ranks the wrong two hundred areas. `ready` is the
 * share rather than the count, which is what the column prints, and a place
 * with nothing known has no share — `nulls last` keeps those at the bottom
 * whichever way round it is read.
 */
const ORDER_BY = {
  known: 'coalesce(st.places, 0)',
  owned: 'coalesce(st.owned, 0)',
  identified: 'coalesce(st.identified, 0)',
  ready: 'case when coalesce(st.places, 0) > 0 then coalesce(st.ready, 0)::real / st.places else null end',
  score: 'st.avg_score',
  searches: 'coalesce(d.searches, 0)',
  empty: 'coalesce(d.empty, 0)',
  name: 'l.name',
};

const FIVE = `
  coalesce(st.places, 0)     as known,
  coalesce(st.owned, 0)      as owned,
  -- A household said it matters; we still hold nothing of our own about it.
  -- Kept apart from both of the others, because it is its own answer and it is
  -- the shortest route to a place worth curating (Codex, 17 Sep 2026).
  coalesce(st.claimed, 0)    as claimed,
  coalesce(st.identified, 0) as identified,
  coalesce(st.ready, 0)      as ready_count,
  st.avg_score               as avg_score`;

/**
 * Which ways of getting about the matrix can answer, where we are standing.
 *
 * A mode with no `cell_builds` row for these cells has no reach rows either, so
 * a ring in that mode comes back empty — and an empty board that looks like an
 * answer is worse than a control that says it is not built yet (17 Sep 2026,
 * the verification audit).
 */
export async function modesFor(scope) {
  const { rows } = scope?.kind === 'ring' && scope.cell
    ? await query(
      `select distinct cb.mode from cell_builds cb
        where cb.from_cell = $1`, [scope.cell])
    : await query(
      `select distinct cb.mode from cell_builds cb
         join geo_cells g on g.code = cb.from_cell
        where $1::text is null or g.country_code = upper($1)`,
      [scope?.kind === 'area' ? (scope.area?.country_code ?? null) : null]);
  // Said in the words the screen uses, not the matrix's.
  const SAID = { driving: 'drive', walking: 'walk', transit: 'transit' };
  return [...new Set(rows.map((r) => SAID[r.mode] ?? r.mode))];
}

/** The five numbers every level prints, for one area. */
export async function statsFor(areaSlug, { category = '', subcategory = '' } = {}) {
  // A subcategory decides its own category, so asking for both would be asking
  // the caller to know something it has no reason to. The rollup keeps the
  // category on the row because it is worth reading; the *lookup* ignores it
  // whenever a subcategory is given — otherwise the subcategory board asked for
  // `category = ''` against rows stored under `culture` and every one of its
  // five numbers came back a dash while its own list showed twelve places
  // (found by opening the screen, 17 Sep 2026).
  const { rows } = await query(
    `select ${FIVE} from area_stats st
      where st.area_slug = $1 and st.subcategory = $3 and st.source = '' and st.ownership = ''
        and ($3 <> '' or st.category = $2)`,
    [lower(areaSlug), category ?? '', subcategory ?? '']);
  const r = rows[0] ?? { known: 0, owned: 0, claimed: 0, identified: 0, ready_count: 0, avg_score: null };
  return {
    known: r.known, owned: r.owned, claimed: r.claimed, identified: r.identified,
    readyCount: r.ready_count, ready: readyShare(r.ready_count, r.known),
    avgScore: r.avg_score == null ? null : Math.round(r.avg_score),
  };
}

/** The same five, for a set of refs (a ring, or a selection). */
export async function statsForRefs(refs, { category = '', subcategory = '' } = {}) {
  if (!refs?.length) return { known: 0, owned: 0, claimed: 0, identified: 0, readyCount: 0, ready: null, avgScore: null };
  const { rows } = await query(
    `select count(*)::int as known,
            count(*) filter (where ownership = 'owned')::int        as owned,
            count(*) filter (where ownership = 'claimed')::int      as claimed,
            count(*) filter (where ownership = 'identified')::int   as identified,
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
    known: r.known, owned: r.owned, claimed: r.claimed, identified: r.identified, readyCount: r.ready_count,
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
    known: r.known, owned: r.owned, claimed: r.claimed, identified: r.identified,
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
     -- Ordered before it is cut, not after. Great Britain broken down by
     -- postcode is 2,900 outcodes; taking an arbitrary 200 and *then* sorting
     -- them in JavaScript printed a top ten that was nothing of the sort
     -- (Codex, 17 Sep 2026). The same expressions the ladder sorts by, said
     -- once, in SQL.
     order by ${ORDER_BY[sort] ?? ORDER_BY.searches} ${desc ? 'desc' : 'asc'} nulls last, l.name asc
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

  const out = rows.map((r) => ({
    slug: r.slug, name: r.name, kind: r.kind, parent: r.parent_name ?? null,
    known: r.known, owned: r.owned, claimed: r.claimed, identified: r.identified,
    readyCount: r.ready_count, ready: readyShare(r.ready_count, r.known),
    avgScore: r.avg_score == null ? null : Math.round(r.avg_score),
    searches: r.searches, empty: r.empty,
  }));
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
           count(*) filter (where pi.ownership = 'owned')::int as owned,
           count(*) filter (where pi.ownership = 'claimed')::int as claimed,
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
    known: r.known, owned: r.owned, claimed: r.claimed ?? 0,
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
           count(*) filter (where pi.ownership = 'owned')::int as owned,
           count(*) filter (where pi.ownership = 'claimed')::int as claimed,
           count(*) filter (where pi.ownership = 'identified')::int  as identified,
           count(*) filter (where pi.ready)::int as ready_count,
           avg(pi.data_score)::real as avg_score,
           -- How many of them actually have a score. A category's average is
           -- the mean over *scored* places, so a subcategory with two scored
           -- places out of two hundred must not weigh two hundred — the band
           -- and the row read differently for the same category, which the
           -- design's fourth law forbids (17 Sep 2026, the verification audit).
           count(pi.data_score)::int as scored
      from place_index pi where ${scope.sql}
     group by pi.category, pi.subcategory`, scope.args);
  const bySub = new Map(held.filter((h) => h.subcategory).map((h) => [h.subcategory, h]));
  const byCat = new Map();
  for (const h of held) {
    if (!h.category) continue;
    const c = byCat.get(h.category) ?? { known: 0, owned: 0, claimed: 0, identified: 0, ready_count: 0, sum: 0, n: 0 };
    c.known += h.known; c.owned += h.owned; c.claimed += h.claimed; c.identified += h.identified; c.ready_count += h.ready_count;
    if (h.avg_score != null && h.scored) { c.sum += h.avg_score * h.scored; c.n += h.scored; }
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
        known: c?.known ?? 0, owned: c?.owned ?? 0, claimed: c?.claimed ?? 0, identified: c?.identified ?? 0,
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
      known: h?.known ?? 0, owned: h?.owned ?? 0, claimed: h?.claimed ?? 0, identified: h?.identified ?? 0,
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
           count(*) filter (where pi.ownership = 'owned')::int as owned,
           count(*) filter (where pi.ownership = 'claimed')::int as claimed,
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
      known: h?.known ?? 0, owned: h?.owned ?? 0, claimed: h?.claimed ?? 0,
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
             ? `count(*) filter (where s.ownership = 'owned')::int as src_${i}`
             : `count(*) filter (where exists (select 1 from place_index_sources q where q.venue_ref = s.venue_ref and q.source = '${x.key}'))::int as src_${i}`)).join(',\n           ')},
           count(*) filter (where coalesce(n.sources, 0) = 1)::int as one_only,
           count(*) filter (where coalesce(n.sources, 0) = 1 and s.venue_ref like 'google:%')::int as google_only
      from scoped s left join n on n.venue_ref = s.venue_ref
     where s.subcategory is not null
     group by s.subcategory
     order by count(*) desc
     limit $${scope.args.length + 1}`, [...scope.args, limit]);
  const labels = new Map((await query('select key, label from shelf_subcategories')).rows.map((r) => [r.key, r.label]));
  // When each source was last asked about a place *here*.
  //
  // The column's own words are "when this source was last asked about a place
  // here", and it printed the word "somewhere" — because all it was given was a
  // boolean, taken from every source anywhere (17 Sep 2026, the verification
  // audit). `place_index_sources.last_seen` is the date, and the scope is the
  // one the board is standing in.
  const { rows: seen } = await query(`
    with scoped as (select pi.venue_ref from place_index pi where ${scope.sql})
    select src.source, max(src.last_seen) as at, count(*)::int as n
      from place_index_sources src join scoped s on s.venue_ref = src.venue_ref
     group by src.source`, scope.args);
  const lastHere = new Map(seen.map((r) => [r.source, r.at]));
  // And whether it has ever been asked anywhere, so a source with nothing here
  // reads "not asked here" rather than "never asked at all".
  const asked = new Set((await query('select distinct source from place_index_sources')).rows.map((r) => r.source));
  // How many subcategories there are at all, because "5 of 59" is the finding:
  // the ones that are not listed are the ones nothing landed in.
  const all = (await query('select count(*)::int as n from shelf_subcategories where active')).rows[0].n;
  return {
    sources: SOURCES.map((s) => ({
      ...s,
      asked: asked.has(s.key),
      // The date the column asks for, and null where it has never been asked here.
      askedHere: lastHere.get(s.key) ?? null,
    })),
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
     -- Everything we hold no research on, which is the identified ones *and*
     -- the claimed ones. A claimed place is one a household said matters and we
     -- still hold nothing about — the shortest list of places worth owning
     -- next, and requiring "identified" hid every one of them (Codex, 17 Sep
     -- 2026). A claimed place sorts above an identified one on the same
     -- evidence, because somebody has already said so.
     where ${scope.sql} and pi.ownership <> 'owned'
     order by (pi.ownership = 'claimed') desc,
              case coalesce(sp.count_band, r.count_band)
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
      // Which of the two reasons it is here: a household said it matters, or
      // nobody has and we hold nothing either way (Codex, 17 Sep 2026).
      ownership: w.ownership,
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
  // The name search and the sort happen **in the query**, before the limit.
  // Filtering two hundred rows that SQL had already picked meant a search could
  // come back empty with a match sitting at row two hundred and one, and a sort
  // could never reach the real top of the scope (Codex, 17 Sep 2026).
  //
  // The name is not a column here — it lives wherever we are allowed to hold it
  // — so it is joined in rather than guessed at.
  const NAME = `coalesce(r.name, a.name, case when pi.venue_ref like 'google:%' then null else sp.name end, pi.venue_ref)`;
  if (q) { args.push(`%${q}%`); where.push(`${NAME} ilike $${args.length}`); }
  const MISSING = `jsonb_array_length(coalesce(pi.score_parts->'missing', '[]'::jsonb))`;
  const UNSEEN = `(select count(*)::int from place_index_sources src where src.venue_ref = pi.venue_ref)`;
  const ORDER = {
    missing: `${MISSING} ${desc ? 'desc' : 'asc'}, pi.data_score asc nulls first`,
    score: `pi.data_score ${desc ? 'desc' : 'asc'} nulls last`,
    name: `${NAME} ${desc ? 'desc' : 'asc'}`,
    unseen: `${UNSEEN} ${desc ? 'asc' : 'desc'}`,
  }[sort] ?? `${MISSING} desc, pi.data_score asc nulls first`;
  args.push(limit);
  const { rows } = await query(`
    select pi.venue_ref, pi.subcategory, pi.category, pi.data_score, pi.ready, pi.score_parts, pi.ownership, pi.oldest_fact,
           (select count(*)::int from place_index_sources src where src.venue_ref = pi.venue_ref) as seen_by,
           (select string_agg(src.source, ',' order by src.source) from place_index_sources src where src.venue_ref = pi.venue_ref) as srcs,
           (select upper(pa.area_slug) from place_areas pa join localities l on l.slug = pa.area_slug
             where pa.venue_ref = pi.venue_ref and l.kind = 'postcode' limit 1) as outcode
      from place_index pi
      left join place_records r on r.venue_ref = pi.venue_ref
      left join attractions a on (a.venue_ref = pi.venue_ref or 'atlas:' || a.id::text = pi.venue_ref) and a.state <> 'rejected'
      left join lateral (select name from scout_places s where s.venue_ref = pi.venue_ref order by last_seen desc limit 1) sp on true
     where ${where.join(' and ')}
     order by ${ORDER}
     limit $${args.length}`, args);
  const named = await namesFor(rows.map((r) => r.venue_ref));
  const all = SOURCES.map((s) => s.key);
  const out = rows.map((r) => {
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
