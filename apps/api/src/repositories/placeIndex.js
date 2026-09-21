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
import { FACT_KEYS, FACT_WEIGHTS, defaultBars, scorePlace, readyShare, ownedRecordSql } from '../domain/placeIndex.js';
import { COUNTRY_NAMES } from '../sources/portraits.js';
import { crowdBand, countBand, score } from '../domain/scoring.js';

/** Sources we can be asked about, in the order the boards print them. */
export const SOURCES = [
  { key: 'google',      label: 'Google',        explain: 'Rented: identifiers and counts only, with nothing stored.', optIn: false, paid: true },
  { key: 'osm',         label: 'OSM',           explain: 'Ours to keep under its licence, which is why most of our names come from here.', optIn: false, paid: false },
  { key: 'atlas',       label: 'Atlas',         explain: 'Wikidata and Wikipedia, ours to keep.', optIn: false, paid: false },
  { key: 'sweep',       label: 'Sweep',         explain: 'Our own food census of an outcode.', optIn: false, paid: false },
  { key: 'tripadvisor', label: 'Tripadvisor',   explain: 'Opt-in and capped at 120 locations a month, so an empty column usually means we did not spend the call.', optIn: true, paid: true },
  { key: 'own',         label: 'Ours',          explain: 'Places here we hold our own research on.', optIn: false, paid: false },
];

/**
 * A source row is "we asked". A source row that *found* the place is narrower,
 * and it is what coverage means.
 *
 * `askThese` writes a Google row with no identifier on purpose when Google has
 * never heard of a place — the second of the two states the board keeps apart —
 * and counting it as coverage inflated Google's column and moved every "only
 * one source" figure with it (Codex, 18 Sep 2026).
 *
 * The rule is about the paid sources only, because they are the only ones an
 * identifier proves anything about. Everything free writes a row without one as
 * a matter of course.
 */
const FOUND_IT = (t) => `${t}.source_place_id is not null
   -- Only a source we *pay* proves itself with an identifier. The free ones
   -- write a row without one all the time and mean it: the sweep and the atlas
   -- name themselves as they ingest, and "ours" has no identifier to give.
   or ${t}.source not in ('google', 'tripadvisor')
   -- And a provider's own reference carries the identifier in the ref itself,
   -- so saving a Google result is a finding whether or not the column repeats
   -- it (Codex, 18 Sep 2026 — the first cut of this rule hid them all).
   or ${t}.venue_ref like ${t}.source || ':%'`;

/**
 * When a place may be called *placed*.
 *
 * It has a cell; or it never could have one (no coordinates); or the stamper
 * has already answered about *this* position — including the answer "outside
 * the postcode coverage", which is a `place_cells` row with a null cell and is
 * an answer rather than a wait; or there is no matrix at all yet.
 *
 * Marking anything else placed means nothing ever copies its cell in, and the
 * place stays out of every ring view until somebody runs a full rebuild. The
 * hourly pass had this rule and the rebuild did not, so a place whose stamp had
 * not been reached — ONS timed out, or the limit ran out before it — was marked
 * placed by the next rebuild and left there (Codex, 18 Sep 2026).
 */
const PLACED_ENOUGH = `(lat is null or lng is null
   -- A stamp about *this* position. Holding a cell is not enough on its own:
   -- the cell may have been copied from a stamp of where the place used to be,
   -- and accepting it marked the row placed for good — so the corrected point
   -- never got its own stamp copied in, and every ring view kept the old one
   -- (Codex, 18 Sep 2026). The stamper's answer "outside the postcode
   -- coverage" is a row with a null cell, and is an answer rather than a wait.
   or exists (
     select 1 from place_cells pc
      where pc.venue_ref = place_index.venue_ref
        and pc.lat is not null and pc.lng is not null
        and abs(pc.lat - place_index.lat) <= 0.0005
        and abs(pc.lng - place_index.lng) <= 0.0005)
   or not exists (select 1 from geo_cells limit 1))`;

const lower = (s) => String(s ?? '').trim().toLowerCase();

/**
 * What makes a `place_records` row an *owned* place.
 *
 * One definition, in `domain/placeIndex.js`, because five things ask it and
 * they have to agree (Codex, 17 Sep 2026: a corrected postcode counted for the
 * rebuild and not for the promotion).
 */
const OWNED_RECORD = ownedRecordSql('r');

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
/**
 * Give one drawer a bar by inheriting it, and say that is what happened.
 *
 * The owner, 21 Sep 2026: "A new drawer inherits one from its nearest
 * subcategory or its category, marked inherited, so it can't be invisible and
 * doesn't pretend to have been considered."
 *
 * Nearest is the commonest bar among its own category's other drawers, because
 * the category is the closest thing to a statement about what kind of day out
 * this is. Failing that — a drawer in an empty category — the safe floor: a
 * picture, a sentence and when it is open, which is true of everything.
 *
 * `set_by` is `inherited`, never `seed`. A seeded bar is one somebody wrote
 * down for that drawer; an inherited one is a guess standing in until they do,
 * and the back office can tell them apart.
 */
const FLOOR = ['picture', 'what_it_is', 'hours'];

export async function inheritBar(key, client = null) {
  // Takes the transaction's own connection where there is one. A drawer being
  // created is not committed yet, so the pool cannot see it — and the adopt
  // path holds `for update` on that row, so asking the pool would wait for a
  // lock the caller is holding.
  const ask = client ? (sql, args) => client.query(sql, args) : query;
  const { rows: [sub] } = await ask(
    'select key, category_key from shelf_subcategories where key = $1', [key]);
  if (!sub) return null;
  const { rows: have } = await ask('select 1 from ready_bars where subcategory_key = $1 limit 1', [key]);
  if (have.length) return null;

  // What its siblings are judged on. Grouped by the exact set of required
  // facts, commonest first, so one odd sibling cannot decide it.
  const { rows: siblings } = await ask(
    `select b.subcategory_key, array_agg(b.fact order by b.fact) filter (where b.required) as facts
       from ready_bars b
       join shelf_subcategories s on s.key = b.subcategory_key
      where s.category_key = $1 and s.key <> $2 and s.active
      group by b.subcategory_key`, [sub.category_key, key]);
  const tally = new Map();
  for (const r of siblings) {
    if (!r.facts?.length) continue;
    const k = r.facts.join(',');
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  const facts = best ? best[0].split(',') : FLOOR;
  const from = best ? `the rest of ${sub.category_key}` : 'the floor every place shares';

  for (const fact of FACT_KEYS) {
    await ask(
      `insert into ready_bars (subcategory_key, fact, weight, required, set_by)
       values ($1,$2,$3,$4,'inherited') on conflict do nothing`,
      [key, fact, FACT_WEIGHTS[fact] ?? 0, facts.includes(fact)]);
  }
  return { key, facts, from };
}

/**
 * The invariant: no active drawer without a bar.
 *
 * The owner, 21 Sep 2026: "add an invariant that runs against live data, not
 * migrations… Your test couldn't see API-created drawers, and the next route in
 * will repeat this silently."
 *
 * That is exactly what happened: `searchLog.test.js` builds its database from
 * migrations, so the thirteen drawers the audit API created were invisible to
 * it and every place in them read "not set" for weeks. A test that reads the
 * schema cannot see the data, so this reads the data.
 */
export async function drawersWithoutABar() {
  const { rows } = await query(
    `select s.key, s.label
       from shelf_subcategories s
      where s.active
        and not exists (select 1 from ready_bars b where b.subcategory_key = s.key)
      order by s.key`);
  return rows;
}

export async function seedBars() {
  const seed = defaultBars();
  const { rows: subs } = await query('select key from shelf_subcategories where active');
  const have = new Set((await query('select distinct subcategory_key from ready_bars')).rows.map((r) => r.subcategory_key));
  let added = 0;
  for (const { key } of subs) {
    if (have.has(key)) continue;
    const facts = seed[key];
    // No coded bar for it: it was made through an API rather than a migration,
    // so it inherits one instead of staying invisible.
    if (!facts) { await inheritBar(key); added += 1; continue; }
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
        -- One attraction per place, and one detail row with it: the reference
        -- index is not unique, so a place harvested in two regions produced two
        -- rows here and the score written for it was whichever one the update
        -- happened to land on last (Codex, 18 Sep 2026).
        left join lateral (
          select a2.* from attractions a2
           where (a2.venue_ref = pi.venue_ref or 'atlas:' || a2.id::text = pi.venue_ref)
             and a2.state <> 'hidden'
           order by a2.last_seen desc, a2.id limit 1) a on true
        left join lateral (
          select d2.* from attraction_details d2 where d2.attraction_id = a.id limit 1) d on true
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

/**
 * A place that has been retired goes.
 *
 * Hiding an attraction in the library took it out of the harvest's insert and
 * left the row it had already made: the index went on counting it as known, as
 * owned and as somewhere worth collecting (Codex, 18 Sep 2026). This runs inside
 * every rebuild *and* on the path that retires one, because the hourly settling
 * pass only looks at rows waiting to be placed and would never reach it
 * otherwise (Codex, 18 Sep 2026, the round after).
 */
/**
 * A claim nobody is making any more is not a claim.
 *
 * Ownership only ever rises on its own, which is right for research — a fact we
 * hold we go on holding. A *claim* is different: it is somebody's live interest,
 * and when the household is erased (Epic 1 C10, "delete means delete") the rows
 * behind it cascade away while the derived index row stays "claimed" for good.
 * Coverage then counts a household that no longer exists, and Collect goes on
 * prioritising a place nobody asked for (Codex, 18 Sep 2026).
 *
 * Both claim paths, as everything else here reads them. Pass refs to settle a
 * few; pass nothing to settle the estate, which is what a rebuild does.
 */
export async function settleClaims(refs = null, client = null) {
  const run = client ? (sql, args) => client.query(sql, args) : (sql, args) => query(sql, args);
  // `placed_at = null` with it: the boards read `area_stats`, which is derived,
  // and a row demoted in place left the rollup counting a claim that was gone
  // until something unrelated happened to rebuild (Codex, 18 Sep 2026). Unplaced
  // means the hourly settle picks it up and refreshes the figures, so this heals
  // on its own even if nobody calls refreshStats.
  const { rowCount } = await run(
    `update place_index pi set ownership = 'identified', placed_at = null
      where pi.ownership = 'claimed'
        and ($1::text[] is null or pi.venue_ref = any($1))
        and not exists (select 1 from household_places hp where hp.venue_ref = pi.venue_ref)
        and not exists (select 1 from place_claims pc where pc.venue_ref = pi.venue_ref)`, [refs]);
  return rowCount;
}

async function retireWhileLocked() {
  // Hiding an attraction in the library took it out of the harvest's insert and
  // left the row it had already made: a rebuild stopped refreshing it and went
  // on counting it as known, as owned, and as somewhere worth collecting
  // (Codex, 18 Sep 2026). A retired attraction's source row goes with it, though
  // a place whose *reference* is an atlas one keeps that source on the next
  // pass and should: the atlas is still where the identifier came from, it is
  // just no longer a reason to hold the place. The index row goes only when the
  // attraction was the whole reason for it —
  // nobody else has returned the place, we hold no research of our own on it,
  // and no household has claimed it. Anything else is still a real place that
  // happens to have lost one source.
  // Never a reference another attraction is still using.
  //
  // Two attractions can share a venue_ref, so "this one is hidden" does not mean
  // "this place is retired" — deleting on the hidden one alone took a live place
  // out of the index, and inside a rebuild it removed a row the next insert
  // needs (Codex, 18 Sep 2026).
  await query(`
    delete from place_index_sources s
     using attractions a
     where s.source = 'atlas' and a.state = 'hidden'
       and s.venue_ref = coalesce(a.venue_ref, 'atlas:' || a.id::text)
       and not exists (
         select 1 from attractions live
          where live.state <> 'hidden'
            and coalesce(live.venue_ref, 'atlas:' || live.id::text) = s.venue_ref)`);
  const { rowCount: retired } = await query(`
    delete from place_index pi
     where pi.venue_ref in (
       select coalesce(a.venue_ref, 'atlas:' || a.id::text) from attractions a where a.state = 'hidden')
       and not exists (
         select 1 from attractions live
          where live.state <> 'hidden'
            and coalesce(live.venue_ref, 'atlas:' || live.id::text) = pi.venue_ref)
       and not exists (select 1 from place_index_sources s where s.venue_ref = pi.venue_ref)
       and not exists (select 1 from place_records r where r.venue_ref = pi.venue_ref and ${OWNED_RECORD})
       and not exists (select 1 from household_places hp where hp.venue_ref = pi.venue_ref)
       and not exists (select 1 from place_claims pc where pc.venue_ref = pi.venue_ref)`);
  // And a place that survives the retirement is re-asked what it is.
  //
  // Removing the atlas source left `ownership` where it was, so a place whose
  // only research *was* the retired attraction went on being counted as owned —
  // which is the one state that tells Collect to leave it alone (Codex, 18 Sep
  // 2026). The same questions the rebuild asks, asked again for these.
  //
  // A sweep row keeps the *place*; it does not keep it owned. The rebuild files
  // a swept place as identified, so letting a name in `scout_places` block this
  // left a place whose only owned fact was the retired summary still reading as
  // researched (Codex, 18 Sep 2026, the round after).
  await query(`
    update place_index pi
       set ownership = case
             when exists (select 1 from household_places hp where hp.venue_ref = pi.venue_ref)
               or exists (select 1 from place_claims pc where pc.venue_ref = pi.venue_ref) then 'claimed'
             else 'identified' end,
           placed_at = null
     where pi.ownership = 'owned'
       and pi.venue_ref in (
         select coalesce(a.venue_ref, 'atlas:' || a.id::text) from attractions a where a.state = 'hidden')
       and not exists (
         select 1 from attractions live
          where live.state <> 'hidden'
            and coalesce(live.venue_ref, 'atlas:' || live.id::text) = pi.venue_ref)
       and not exists (
         select 1 from attractions a
          where (a.venue_ref = pi.venue_ref or 'atlas:' || a.id::text = pi.venue_ref)
            and a.state <> 'hidden'
            and coalesce(a.summary, a.website, a.wikipedia_url) is not null)
       and not exists (
         select 1 from place_records r where r.venue_ref = pi.venue_ref and ${OWNED_RECORD})`);

  // The rows hung off it go with it, or they are counted against a place that
  // is no longer in the index.
  if (retired) {
    await query(`
      delete from place_areas pa
       where not exists (select 1 from place_index pi where pi.venue_ref = pa.venue_ref)`);
    await query(`
      delete from place_cells pc
       where not exists (select 1 from place_index pi where pi.venue_ref = pc.venue_ref)`);
    await query(`
      delete from place_index_labels pl
       where not exists (select 1 from place_index pi where pi.venue_ref = pl.venue_ref)`);
  }
  return { retired };
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
      from (
        -- One row per reference, whatever the harvest holds.
        --
        -- attractions_venue_idx is not unique, so the same place harvested in
        -- two regions is two rows — and a statement cannot touch one primary key
        -- twice: the whole rebuild aborted with "ON CONFLICT DO UPDATE command
        -- cannot affect row a second time", which is every rebuild, for ever,
        -- the day a place is harvested twice (Codex, 18 Sep 2026). The newest is
        -- kept, as it is everywhere else here.
        select distinct on (coalesce(venue_ref, 'atlas:' || id::text)) *
          from attractions
         -- hidden is the state the library actually sets
         -- (repositories/library.js); there is no rejected, so the guard that
         -- named it excluded nothing and a hidden attraction went on being
         -- counted, scored, owned and collected (Codex, 18 Sep 2026).
         where state <> 'hidden'
         order by coalesce(venue_ref, 'atlas:' || id::text), last_seen desc, id
      ) a left join regions reg on reg.slug = a.region_slug
    on conflict (venue_ref) do update
       set lat = coalesce(excluded.lat, place_index.lat),
           lng = coalesce(excluded.lng, place_index.lng),
           -- The country a source knows, where the row does not. A place noted
           -- by the write path before anything knew its country kept a null
           -- through every rebuild, so it had no country area row and was
           -- missing from the country boards for good (Codex, 17 Sep 2026).
           -- First one wins, as everywhere else.
           country_code = coalesce(place_index.country_code, excluded.country_code),
           last_seen = greatest(place_index.last_seen, excluded.last_seen),
           -- identified < claimed < owned, said out loud rather than left to
           -- the alphabet, which puts claimed below identified.
           ownership = case when place_index.ownership = 'owned' or excluded.ownership = 'owned' then 'owned'
                            when place_index.ownership = 'claimed' or excluded.ownership = 'claimed' then 'claimed'
                            else 'identified' end`);

  await query(`
    insert into place_index (venue_ref, lat, lng, country_code, derived_by, ownership, first_seen, last_seen)
    -- One row per place, whatever it is grouped by.
    --
    -- The same venue can sit in two swept areas — a restaurant on an outcode
    -- boundary is in both — with different coordinates or a different country
    -- on each. Grouping by those emitted two rows for one primary key, and
    -- an upsert cannot touch the same row twice, so the whole
    -- statement aborted: the first build and every rebuild, on data that is
    -- perfectly valid (Codex, 17 Sep 2026).
    --
    -- The most recently seen row wins the position, and the country says
    -- nothing rather than saying Britain where the area does not know.
    select sp.venue_ref,
           (array_agg(sp.lat order by sp.last_seen desc))[1],
           (array_agg(sp.lng order by sp.last_seen desc))[1],
           (array_agg(sa.country_code order by sp.last_seen desc))[1],
           'sweep', 'identified', min(sp.first_seen), max(sp.last_seen)
      from scout_places sp left join scout_areas sa on sa.code = sp.area_code
     group by sp.venue_ref
    on conflict (venue_ref) do update
       set lat = coalesce(place_index.lat, excluded.lat),
           lng = coalesce(place_index.lng, excluded.lng),
           -- The same: the sweep's area knows the country when the row does not.
           country_code = coalesce(place_index.country_code, excluded.country_code),
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
       -- Our own record's position wins where it has one, the same rule the
       -- live write follows: the rebuild kept whatever was there first, so a
       -- corrected coordinate never survived a rebuild (Codex, 18 Sep 2026).
       set lat = coalesce(excluded.lat, place_index.lat),
           lng = coalesce(excluded.lng, place_index.lng),
           ownership = case when excluded.ownership = 'owned' then 'owned' else place_index.ownership end,
           last_seen = greatest(place_index.last_seen, excluded.last_seen)`);

  // A household claiming a place is the third kind of ownership: we may hold
  // nothing of our own about it, but somebody has said it matters.
  //
  //     Both ways a household can claim one. Saving it writes
  //     `household_places`; a suggested shortlist item and a trip's own base
  //     write only `place_claims`, and reading the first alone left exactly the
  //     places somebody asked for filed as identified — so Collect's claimed
  //     lane, which exists to answer those, could not see them (Codex, 18 Sep
  //     2026).
  await query(`
    insert into place_index (venue_ref, derived_by, ownership, first_seen, last_seen)
    select venue_ref, 'claim', 'claimed', min(first_seen), max(last_seen) from (
      select hp.venue_ref, hp.first_seen, hp.last_seen
        from household_places hp where hp.venue_ref is not null
      union all
      select pc.venue_ref, pc.claimed_at, pc.claimed_at from place_claims pc
    ) claims group by venue_ref
    on conflict (venue_ref) do update
       set ownership = case when place_index.ownership = 'identified' then 'claimed' else place_index.ownership end`);

  // The other direction: a claim whose household has been erased. The clause
  // above only ever promotes, so without this a deleted household's claims sat
  // in the index for good (Codex, 18 Sep 2026).
  await settleClaims();

  await retireWhileLocked();

  // Every country the index holds places in gets a row you can point at.
  //
  // `settleNew()` makes one as a place arrives, which does not help a place that
  // was already there when the level was built: on an upgrade the index is empty
  // when migration 169 runs, and the first build then marks everything placed —
  // so a Portuguese place saved months ago would never have got its country
  // (Codex, 18 Sep 2026). The rebuild knows the whole index, so it asks here.
  await query(
    `insert into localities (slug, name, kind, country_code, nation)
     select distinct lower(pi.country_code),
            coalesce(n.name, upper(pi.country_code)), 'country', upper(pi.country_code), null
       from place_index pi
       left join (select * from unnest($1::text[], $2::text[]) as t(code, name)) n
              on n.code = upper(pi.country_code)
      where pi.country_code is not null
     on conflict (slug) do nothing`,
    [Object.keys(COUNTRY_NAMES), Object.values(COUNTRY_NAMES)]);

  onProgress?.({ stage: 'places' });

  // 2 — who has ever returned each of them.
  await query(`
    insert into place_index_sources (venue_ref, source, source_place_id, first_seen, last_seen)
    select pi.venue_ref,
           case when pi.venue_ref like 'google:%' then 'google'
                when pi.venue_ref like 'osm:%'    then 'osm'
                when pi.venue_ref like 'atlas:%'  then 'atlas'
                else split_part(pi.venue_ref, ':', 1) end,
           split_part(pi.venue_ref, ':', 2), pi.first_seen,
           -- Not the place's clock.
           --
           -- On the very first build there is no row to protect, so this wrote
           -- the place's own last_seen — which a household claim or an empty
           -- owned record moves — into the source's. Google could look freshly
           -- asked about a place nobody had asked it about for years, and
           -- Collect's twelve-month rule then kept away from it (Codex, 18 Sep
           -- 2026). The reference says the source knows the place; it says
           -- nothing about when we last asked, so the row starts at the
           -- beginning and the first real ask moves it.
           pi.first_seen
      from place_index pi where position(':' in pi.venue_ref) > 0
    -- The source's own clock is not touched on a rebuild.
    --
    -- place_index.last_seen is the place's, and a household claim or an owned
    -- record moves it — so copying it onto the source inferred from the
    -- reference made Google look freshly asked about a place it had not been
    -- asked about for months, and the twelve-month window then kept Collect
    -- away from it (Codex, 18 Sep 2026). A source's last_seen only ever moves
    -- on evidence about that source.
    on conflict (venue_ref, source) do nothing`);
  await query(`
    insert into place_index_sources (venue_ref, source, source_place_id, first_seen, last_seen)
    -- One row per reference, for the same reason the place insert has one: two
    -- harvests of the same place would make the same key twice and abort the
    -- rebuild (Codex, 18 Sep 2026).
    select distinct on (coalesce(a.venue_ref, 'atlas:' || a.id::text))
           coalesce(a.venue_ref, 'atlas:' || a.id::text), 'atlas', a.id::text, a.first_seen, a.last_seen
      from attractions a where a.state <> 'hidden'
     order by coalesce(a.venue_ref, 'atlas:' || a.id::text), a.last_seen desc, a.id
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
      from attractions a where a.state <> 'hidden' and a.region_slug is not null
    on conflict do nothing`);
  await query(`
    insert into place_areas (venue_ref, area_slug)
    select coalesce(a.venue_ref, 'atlas:' || a.id::text), a.locality_slug
      from attractions a where a.state <> 'hidden' and a.locality_slug is not null
    on conflict do nothing`);
  await query(`
    insert into place_areas (venue_ref, area_slug)
    select coalesce(a.venue_ref, 'atlas:' || a.id::text), lower(a.outcode)
      from attractions a where a.state <> 'hidden' and a.outcode is not null
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
    select r.venue_ref, lower(case
             -- Already an outward code, which is what the place editor stores
             -- and what half the sources give us. Taking the last three
             -- characters off "ZZ99" leaves "Z" — so a full reindex deleted the
             -- link the editor had just made and never put it back, and the
             -- place vanished off that outcode's board (Codex, 18 Sep 2026).
             when btrim(upper(r.postcode)) ~ '^[A-Z]{1,2}[0-9][A-Z0-9]?$'
               then btrim(upper(r.postcode))
             -- The outward code is everything before the space. Stripping the
             -- space first and then matching let the pattern eat the incode's
             -- first digit, so "SL4 1DE" was filed under "SL41" — an outcode
             -- that does not exist (the invariant check, 18 Sep 2026).
             when position(' ' in btrim(r.postcode)) > 0
               then split_part(btrim(upper(r.postcode)), ' ', 1)
             -- Written without one, the incode is always the last three.
             else left(upper(btrim(r.postcode)), greatest(0, length(btrim(r.postcode)) - 3))
           end)
      from place_records r
     where r.postcode is not null
       and lower(case
             -- Already an outward code, which is what the place editor stores
             -- and what half the sources give us. Taking the last three
             -- characters off "ZZ99" leaves "Z" — so a full reindex deleted the
             -- link the editor had just made and never put it back, and the
             -- place vanished off that outcode's board (Codex, 18 Sep 2026).
             when btrim(upper(r.postcode)) ~ '^[A-Z]{1,2}[0-9][A-Z0-9]?$'
               then btrim(upper(r.postcode))
             -- The outward code is everything before the space. Stripping the
             -- space first and then matching let the pattern eat the incode's
             -- first digit, so "SL4 1DE" was filed under "SL41" — an outcode
             -- that does not exist (the invariant check, 18 Sep 2026).
             when position(' ' in btrim(r.postcode)) > 0
               then split_part(btrim(upper(r.postcode)), ' ', 1)
             -- Written without one, the incode is always the last three.
             else left(upper(btrim(r.postcode)), greatest(0, length(btrim(r.postcode)) - 3))
           end) ~ '^[a-z]{1,2}[0-9][a-z0-9]?$'
    on conflict do nothing`);
  // And where the household said it was — the same source the hourly pass reads
  // (Codex, 18 Sep 2026). Matched by name, because the column is a word rather
  // than a slug, and only where we hold a locality by that name.
  await query(`
    insert into place_areas (venue_ref, area_slug)
    select hp.venue_ref, l.slug
      from household_places hp
      join localities l
        on lower(l.name) = lower(hp.locality)
       and (hp.country_code is null or l.country_code = upper(hp.country_code))
     where hp.locality is not null
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
      from place_cells pc
     where pc.venue_ref = pi.venue_ref and pi.cell is distinct from pc.cell
       -- Only a stamp made for where the place is *now*. A corrected position
       -- clears the cell on purpose; copying the old stamp back put it straight
       -- again and the place kept the travel times of where it used to be
       -- (Codex, 18 Sep 2026).
       and (pi.lat is null or pi.lng is null or (pc.lat is not null and pc.lng is not null
        and abs(pc.lat - pi.lat) <= 0.0005
        and abs(pc.lng - pi.lng) <= 0.0005))`);

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
  // has nothing left to do — but only what it touched.
  //
  // A place saved while the rebuild was between its area pass and this line was
  // marked placed without ever having been placed, and `settleNew` then skipped
  // it: absent from every area board until the next full rebuild (Codex, 17 Sep
  // 2026). `t0` is when this rebuild started, so anything first seen since is
  // left for the hourly pass, which is exactly what that pass is for.
  //
  // And only rows nothing has dirtied since. `noteMany` clears `placed_at` when
  // a place's ownership rises or a new source appears, and a blanket update set
  // it again — so a place changed *during* the rebuild, after its area pass,
  // was marked placed without having been (Codex, 17 Sep 2026). Two conditions,
  // both about this rebuild: first seen before it started, and last written
  // before it started.
  await query(
    `update place_index set placed_at = now()
      where first_seen <= $1 and coalesce(last_seen, first_seen) <= $1
        and ${PLACED_ENOUGH}`, [new Date(t0)]);
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
/** What the first build writes down when it finishes, so a failure can retry. */
const BUILT_KEY = 'placeIndex.builtAt';

/**
 * Retirement from outside a rebuild, under the same lock as one.
 *
 * The library's kinds-refresh calls this directly, and it deletes rows a
 * rebuild is in the middle of inserting: a retirement landing between the index
 * insert and the source and area inserts that follow it takes the row out from
 * under them and the foreign keys fail, leaving the derived index half built
 * (Codex, 18 Sep 2026). Every other thing that rewrites these tables already
 * queues behind this lock; this was the one that did not.
 */
export async function retire() {
  // Waiting, not trying: a retirement is a decision somebody made, and a
  // rebuild that is already past its own retirement step will not do it for us
  // (Codex, 18 Sep 2026).
  return underTheBuildLock(() => retireWhileLocked(), { retired: 0, why: 'a rebuild is going on' }, { wait: true });
}

export async function buildIfEmpty() {
  // "Has a build ever *finished*", not "are there any rows".
  //
  // A rebuild is not one transaction — it cannot be, it deletes and refills
  // four tables and scores a million places — so a build that fell over
  // halfway had already committed its first inserts. Any row then counted as
  // proof it had finished, and the next boot skipped it for ever, leaving the
  // areas or the shelves or the rollups half-built (Codex, 17 Sep 2026).
  const { rows: [done] } = await query('select value from app_settings where key = $1', [BUILT_KEY]);
  if (done) return { built: false, why: 'a build has already finished' };
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
      const { rows: [again] } = await query('select value from app_settings where key = $1', [BUILT_KEY]);
      if (again) return { built: false, why: 'a build finished while we waited' };
      // The bars first. Scoring against an empty `ready_bars` marks every place
      // "not set" and not ready, which is a worse answer than no answer — it
      // reads as a finding rather than as a job that has not run.
      await seedBars();
      // The already-locked implementation, not `reindex()`: we are holding the
      // lock, and asking for it again on another pooled connection answered
      // "somebody else is rebuilding" — so the first build on an upgraded
      // installation reported success and did nothing at all (Codex, 17 Sep
      // 2026).
      const out = await reindexWhileLocked({ onProgress: null });
      // Written down only now — after everything, so a failure anywhere above
      // leaves this unset and the next boot tries again.
      await query(
        `insert into app_settings (key, value) values ($1, to_jsonb(now()::text))
         on conflict (key) do update set value = excluded.value, updated_at = now()`, [BUILT_KEY]);
      return { built: true, ...out };
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
 *
 * `wait` is for the one caller that is not about to be done for it. Retiring an
 * attraction is a *decision somebody made*, and the rebuild going on beside it
 * may already be past its own retirement step — so treating contention as
 * success left the hidden attraction in the index and its rollups until the
 * next full rebuild (Codex, 18 Sep 2026). It waits its turn rather than
 * pretending it had one, and gives up after half a minute rather than holding a
 * request open for ever.
 */
async function underTheBuildLock(fn, ifBusy, { wait = false } = {}) {
  const client = await pool.connect();
  try {
    if (wait) {
      // `set local` outside a transaction is discarded at the end of its own
      // statement, so the timeout was not there at all and the wait was
      // unbounded — a stalled rebuild would have held this request and a pool
      // connection for ever (Codex, 18 Sep 2026). On the session, and put back
      // afterwards because the connection goes back to the pool.
      await client.query("set lock_timeout = '30s'").catch(() => null);
      let mine = false;
      try {
        await client.query('select pg_advisory_lock(hashtext($1))', [BUILD_LOCK]);
        mine = true;
      } catch { /* the thirty seconds ran out */ }
      try {
        if (!mine) return ifBusy;
        return await fn();
      } finally {
        if (mine) await client.query('select pg_advisory_unlock(hashtext($1))', [BUILD_LOCK]).catch(() => null);
        await client.query('set lock_timeout = default').catch(() => null);
      }
    }
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
  // Oldest attempt first, never-tried first of all.
  //
  // In no order, a row that cannot be placed — the postcode service down, a
  // point nobody answers about — held the front of the queue for ever, and past
  // five thousand waiting the places behind it were never reached at all
  // (Codex, 18 Sep 2026; migration 171).
  const { rows: waiting } = await query(
    `select venue_ref from place_index
      where placed_at is null
      order by settle_tried_at nulls first
      limit $1`, [limit]);
  // Nothing to place is not the same as nothing to count.
  //
  // A live search notes places against `place_index` continuously, and that
  // moves what the rollup should say without necessarily leaving anything
  // waiting to be placed — so on a quiet hour this returned here and the boards'
  // lists went on showing whatever the last settle happened to leave. In
  // production on 18 Sep 2026 they were thirteen hours behind. Refreshed only
  // when the index has actually moved since the last one, so a genuinely quiet
  // hour still costs one small query.
  if (!waiting.length) {
    const { rows: [behind] } = await query(
      `select (select max(last_seen) from place_index) > coalesce((select max(refreshed_at) from area_stats), 'epoch') as yes`);
    if (behind?.yes) await refreshStats();
    return { settled: 0, refreshed: Boolean(behind?.yes) };
  }
  const refs = waiting.map((r) => r.venue_ref);
  // Marked as tried before the work, so a hand that throws still goes to the
  // back rather than being taken again immediately.
  await query('update place_index set settle_tried_at = now() where venue_ref = any($1)', [refs]);

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

  // 0b — and a country we hold places in is a place you can point at.
  //
  //      The index files a place under `lower(country_code)` whatever the code
  //      is, and the country picker lists localities of kind 'country' — so a
  //      place saved abroad got an area row no screen could reach (Codex, 18 Sep
  //      2026; migration 169 did the ones already there). The name comes from
  //      the app's own list, and is the code itself where nothing knows better.
  await query(
    `insert into localities (slug, name, kind, country_code, nation)
     select distinct lower(pi.country_code),
            coalesce(n.name, upper(pi.country_code)), 'country', upper(pi.country_code), null
       from place_index pi
       left join (select * from unnest($2::text[], $3::text[]) as t(code, name)) n
              on n.code = upper(pi.country_code)
      where pi.venue_ref = any($1) and pi.country_code is not null
     on conflict (slug) do nothing`,
    [refs, Object.keys(COUNTRY_NAMES), Object.values(COUNTRY_NAMES)]);

  // 1 — where they are. The same four sources the rebuild reads, and the same
  //     rule that a town carries its county.
  //
  //     The old rows go first. "These places have no area rows yet, by
  //     definition" was true when the only way into this hand was being new; a
  //     place is now sent back here when its *position* is corrected too, and
  //     inserting without deleting left it counted in the county it used to be
  //     in as well as the one it is in (Codex, 18 Sep 2026).
  await query('delete from place_areas where venue_ref = any($1)', [refs]);
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
     where a.state <> 'hidden' and x.slug is not null
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
    select r.venue_ref, lower(case
             -- Already an outward code, which is what the place editor stores
             -- and what half the sources give us. Taking the last three
             -- characters off "ZZ99" leaves "Z" — so a full reindex deleted the
             -- link the editor had just made and never put it back, and the
             -- place vanished off that outcode's board (Codex, 18 Sep 2026).
             when btrim(upper(r.postcode)) ~ '^[A-Z]{1,2}[0-9][A-Z0-9]?$'
               then btrim(upper(r.postcode))
             -- The outward code is everything before the space. Stripping the
             -- space first and then matching let the pattern eat the incode's
             -- first digit, so "SL4 1DE" was filed under "SL41" — an outcode
             -- that does not exist (the invariant check, 18 Sep 2026).
             when position(' ' in btrim(r.postcode)) > 0
               then split_part(btrim(upper(r.postcode)), ' ', 1)
             -- Written without one, the incode is always the last three.
             else left(upper(btrim(r.postcode)), greatest(0, length(btrim(r.postcode)) - 3))
           end)
      from place_records r
     where r.venue_ref = any($1) and r.postcode is not null
       and lower(case
             -- Already an outward code, which is what the place editor stores
             -- and what half the sources give us. Taking the last three
             -- characters off "ZZ99" leaves "Z" — so a full reindex deleted the
             -- link the editor had just made and never put it back, and the
             -- place vanished off that outcode's board (Codex, 18 Sep 2026).
             when btrim(upper(r.postcode)) ~ '^[A-Z]{1,2}[0-9][A-Z0-9]?$'
               then btrim(upper(r.postcode))
             -- The outward code is everything before the space. Stripping the
             -- space first and then matching let the pattern eat the incode's
             -- first digit, so "SL4 1DE" was filed under "SL41" — an outcode
             -- that does not exist (the invariant check, 18 Sep 2026).
             when position(' ' in btrim(r.postcode)) > 0
               then split_part(btrim(upper(r.postcode)), ' ', 1)
             -- Written without one, the incode is always the last three.
             else left(upper(btrim(r.postcode)), greatest(0, length(btrim(r.postcode)) - 3))
           end) ~ '^[a-z]{1,2}[0-9][a-z0-9]?$'
    on conflict do nothing`, [refs]);
  // And where the household said it was.
  //
  // A place somebody saves carries the locality the geocoder gave it, and
  // nothing read it — so a saved place with no postcode and no sweep row behind
  // it got its country and stopped there, missing from every county and town
  // board although the household had told us where it was (Codex, 18 Sep 2026).
  // Matched by name, because `household_places.locality` is a word rather than
  // a slug, and only where we already hold a locality by that name.
  await query(`
    insert into place_areas (venue_ref, area_slug)
    select hp.venue_ref, l.slug
      from household_places hp
      join localities l
        on lower(l.name) = lower(hp.locality)
       and (hp.country_code is null or l.country_code = upper(hp.country_code))
     where hp.venue_ref = any($1) and hp.locality is not null
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
     where pc.venue_ref = pi.venue_ref and pi.venue_ref = any($1) and pi.cell is distinct from pc.cell
       -- The same rule the rebuild uses: a stamp about this position, not about
       -- the one it had before somebody put it right.
       and (pi.lat is null or pi.lng is null or (pc.lat is not null and pc.lng is not null
        and abs(pc.lat - pi.lat) <= 0.0005
        and abs(pc.lng - pi.lng) <= 0.0005))`, [refs]);

  // 3 — our shelf, and 4 — the score, which is what clears `indexed_at`.
  await shelveAll({ refs });
  const scored = await rescore({ refs });
  // Placed — except where something we are still waiting for would change the
  // answer.
  //
  // A place whose cell has not been stamped yet is one the reach build has not
  // reached: ONS timed out, or there were more points than that pass takes. The
  // stamp arrives on a later hour, and marking the place placed meant nothing
  // ever copied it into the index — so it stayed out of every ring view until
  // somebody ran a full rebuild (Codex, 18 Sep 2026).
  //
  // Everything else is placed whether or not it found anything: an outcode
  // nobody has swept has no area to be in, and retrying that every hour for
  // ever would starve the places that do have work to do.
  await query(
    `update place_index set placed_at = now()
      where venue_ref = any($1) and ${PLACED_ENOUGH}`, [refs]);
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
export async function note({ ref, lat = null, lng = null, source = null, sourceId = null, countryCode = null, ownership = null }) {
  if (!ref) return;
  // One row is a batch of one.
  //
  // This had its own insert, and the two drifted: the country defaulted to GB
  // where the batch leaves it null, and the conflict clause could not fill a
  // country in afterwards or send the row back to be settled — so a place noted
  // this way was filed under Great Britain for good (Codex, 18 Sep 2026). There
  // is one statement now, and it is the one the sweep uses.
  await noteMany([{ ref, lat, lng, sourceId, sources: source ? [source] : [] }], { countryCode, ownership });
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
      -- One attraction per place, deterministically: the reference index is not
      -- unique, so a place harvested into two regions was two rows here and the
      -- update took whichever it reached last — two different categories meant
      -- a shelf that changed between rebuilds (Codex, 18 Sep 2026).
      left join lateral (
        select a2.category, a2.kinds, a2.id from attractions a2
         where (a2.venue_ref = pi.venue_ref or 'atlas:' || a2.id::text = pi.venue_ref)
           and a2.state <> 'hidden'
         order by a2.last_seen desc, a2.id limit 1) a on true
      left join lateral (select category, cuisine_group from scout_places s where s.venue_ref = pi.venue_ref order by last_seen desc limit 1) sp on true
      left join place_records r on r.venue_ref = pi.venue_ref
     -- Hand-shelved places are read too, and their shelf is left alone below.
     --
     -- Leaving them out of the query after the labels had been deleted meant
     -- every rebuild dropped the provider words for exactly the places somebody
     -- had corrected by hand, so the Labels lens lost them for good (Codex, 18
     -- Sep 2026). The shelf is somebody's decision; the labels are the sources'.
     ${refs ? 'where pi.venue_ref = any($1)' : ''}`, refs ? [refs] : []);

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
    // The words are rewritten; the shelf is not. A shelf set by hand outlives
    // every rebuild, which is the whole point of setting one.
    if (r.derived_by === 'hand') { if (words.length >= 500) await flush(); continue; }
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
  // One entry per place, whatever the caller handed over.
  //
  // A batch with the same reference twice — a harvest where two rows resolve to
  // one place — made two tuples for one primary key, and a statement cannot
  // touch the same row twice: the whole insert aborted, and on the pool path
  // the swallow hid it, so the batch was silently not written (Codex, 17 Sep
  // 2026, and found by trying it). Later entries win, because a caller that
  // says a thing twice means the second one.
  const byRef = new Map();
  for (const p of places) {
    const row = typeof p === 'string' ? { ref: p } : p;
    if (!row?.ref) continue;
    const had = byRef.get(row.ref);
    byRef.set(row.ref, had ? { ...had, ...row, sources: [...(had.sources ?? []), ...(row.sources ?? [])] } : row);
  }
  const rows = [...byRef.values()];
  if (!rows.length) return { noted: 0 };
  const write = async (exec) => {
    // `now()` is in the tuple, not implied by the column list. Without it the
    // statement had five targets and four expressions and threw every time —
    // which the swallow on the pool path hid completely, so the index was never
    // actually written to (found by the sweep's own tests, 17 Sep 2026).
    // A position carries its own provenance and its own clock.
    //
    // The data policy holds a coordinate for thirty days where it came from a
    // provider, and for good where it came from the open map (migration 184).
    // Stamping it *here* rather than in a writer of its own is the whole point:
    // every display path already reaches the index through `noteSeen` and this,
    // so a parallel writer would have left every live search's coordinates
    // undated and outside the expiry — which is exactly what the first cut of
    // it did (Codex, 19 Sep 2026). The source is read off the reference, which
    // is the only thing that actually knows whose point it is.
    const values = rows.map((_, i) => `($${i * 6 + 1},$${i * 6 + 2}::double precision,$${i * 6 + 3}::double precision,$${i * 6 + 4},$${i * 6 + 5}, now(), $${i * 6 + 6}::text[], case when $${i * 6 + 2}::double precision is not null then now() end, case when $${i * 6 + 2}::double precision is not null then split_part($${i * 6 + 1}, ':', 1) end)`).join(',');
    await exec(
      `insert into place_index (venue_ref, lat, lng, country_code, ownership, last_seen, google_types, coords_at, coords_from)
       values ${values}
       on conflict (venue_ref) do update
          -- A later source's position wins, where it has one.
          --
          -- Holding the first one for ever meant a corrected coordinate never
          -- reached the index: the place kept whatever the first thing to
          -- mention it thought, and its cell, its ring and every distance off it
          -- stayed wrong until somebody rebuilt the whole index by hand (Codex,
          -- 18 Sep 2026). A caller with no position still cannot erase one — a
          -- household claim carries none.
          set lat = coalesce(excluded.lat, place_index.lat),
              lng = coalesce(excluded.lng, place_index.lng),
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
              -- area_stats counts ownership, place_areas is built from the
              -- country, and the ring is read off the position — so a row whose
              -- ownership rises, or that learns where it is, goes back in
              -- settleNew's hands and the boards catch up on the hour rather
              -- than at the next full rebuild (Codex, 17 Sep 2026).
              -- A cell is an answer about *this* position. When the position
              -- moves the old cell is not merely stale, it is wrong — and
              -- leaving it there let the settling pass mark the place settled
              -- on it, after which nothing ever asked again (Codex, 18 Sep
              -- 2026).
              cell = case
                when excluded.lat is not null and place_index.lat is not null
                 and (abs(place_index.lat - excluded.lat) > 0.0005
                      or abs(coalesce(place_index.lng, 0) - coalesce(excluded.lng, 0)) > 0.0005)
                then null else place_index.cell end,
              placed_at = case
                when place_index.ownership <> (
                  case when place_index.ownership = 'owned' or excluded.ownership = 'owned' then 'owned'
                       when place_index.ownership = 'claimed' or excluded.ownership = 'claimed' then 'claimed'
                       else 'identified' end)
                  or (place_index.country_code is null and excluded.country_code is not null)
                  or (place_index.lat is null and excluded.lat is not null)
                  -- Both halves of a position. A place stored with a latitude
                  -- and no longitude was marked settled, and the longitude
                  -- arriving later filled the column without sending it back to
                  -- be placed — so it never got a cell and never appeared in a
                  -- ring (Codex, 18 Sep 2026).
                  or (place_index.lng is null and excluded.lng is not null)
                  -- Or the position moved: about fifty metres is more than a
                  -- rounding and enough to change the cell it sits in.
                  or (excluded.lat is not null and place_index.lat is not null
                      and (abs(place_index.lat - excluded.lat) > 0.0005
                           or abs(coalesce(place_index.lng, 0) - coalesce(excluded.lng, 0)) > 0.0005))
                then null else place_index.placed_at end,
              -- Only where a position actually arrived. A caller with none must
              -- not restart somebody else's thirty days.
              coords_at = case when excluded.lat is not null then excluded.coords_at else place_index.coords_at end,
              coords_from = case when excluded.lat is not null then excluded.coords_from else place_index.coords_from end,
              -- Google's own words for what it is, which the census is too
              -- cheap to buy and a display search carries for nothing.
              google_types = coalesce(excluded.google_types, place_index.google_types),
              last_seen = now()`,
      rows.flatMap((p) => [p.ref, p.lat ?? null, p.lng ?? null, p.countryCode ?? countryCode, p.ownership ?? ownership ?? 'identified', p.types?.length ? p.types : null]));
    // Who has returned each place, which may be more than one of them.
    //
    // A sweep result is often Google *and* OpenStreetMap, and the sweep keeps
    // that in `scout_places.from_sources` — but only the synthetic `sweep` was
    // handed to the index, so the sources lens undercounted both and read
    // combined places as single-source (Codex, 17 Sep 2026).
    //
    // Deduplicated by the pair, across the whole batch. A statement cannot
    // touch the same row twice, and there are two ways to end up with one
    // tuple twice: a place naming the same source twice, and the same place
    // twice in one batch — a harvest where two rows resolve to one reference.
    // Per place it was already right; the pair covers both (Codex, 17 Sep 2026).
    const seenPair = new Set();
    const triples = rows.flatMap((p) => {
      const said = Array.isArray(p.sources) && p.sources.length ? p.sources : [p.source ?? source];
      return said
        .filter(Boolean)
        // One identifier belongs to one source. `sourceId` is the identifier at
        // the source the caller is writing *as*, so handing it to every source a
        // place names would file Google's reference under OSM (Codex, 18 Sep
        // 2026). `sourceIds` is the map for a caller that knows several.
        .map((sc) => {
          const key = String(sc);
          const named = p.sourceIds?.[key];
          const mine = key === String(p.source ?? source ?? '') ? p.sourceId ?? null : null;
          // Nothing is invented for a source that did not hand one over: a
          // merged place whose Google identifier we do not hold reads as
          // "asked, no identifier", and coverage reads the ref for that case
          // (FOUND_IT) rather than this column guessing.
          return [p.ref, key, named ?? mine ?? null];
        })
        .filter(([ref, sc]) => {
          const pair = `${ref}\u0000${sc}`;
          if (seenPair.has(pair)) return false;
          seenPair.add(pair);
          return true;
        });
    });
    if (triples.length) {
      // Which of these have no identifier yet.
      //
      // An identifier arriving on a row that had none is the same kind of news
      // as a new source: it turns "we asked and found nothing" into coverage
      // (FOUND_IT), and the place has to be settled again or its figures keep
      // the old answer (Codex, 18 Sep 2026). The upsert cannot tell us — inside
      // `do update` the table name is the row as it will be — so it is read
      // first, and only when this batch is actually carrying identifiers.
      const carrying = triples.filter(([, , id]) => id);
      const wereBlank = new Set();
      if (carrying.length) {
        const { rows } = await exec(
          `select venue_ref, source from place_index_sources
            where source_place_id is null
              and (venue_ref, source) in (${carrying.map((_, i) => `($${i * 2 + 1},$${i * 2 + 2})`).join(',')})`,
          carrying.flatMap(([ref, sc]) => [ref, sc]));
        for (const r of rows) wereBlank.add(`${r.venue_ref}\u0000${r.source}`);
      }
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
      // places go back in the settling queue too — and so does one that has
      // just gained an identifier, for the same reason.
      const filled = carrying
        .filter(([ref, sc]) => wereBlank.has(`${ref}\u0000${sc}`))
        .map(([ref]) => ref);
      const fresh = [...new Set([...said.rows.filter((r) => r.first_time).map((r) => r.venue_ref), ...filled])];
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
    // And one at a time, waiting rather than skipping.
    //
    // Two refreshes overlapping — a collection finishing while somebody saves a
    // ready bar — both delete the visible rows and then both insert the same
    // keys, so the second failed on a unique violation *after* its own writes
    // had committed: a 500 on an operation that worked (Codex, 18 Sep 2026).
    // A transaction lock rather than the build lock's try-and-skip, because the
    // second one has figures of its own to write down and must not be the one
    // that does not run.
    await client.query('select pg_advisory_xact_lock(hashtext($1))', ['epic.placeIndex.stats']);
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
        join place_index_sources src on src.venue_ref = pi.venue_ref and (${FOUND_IT('src')})
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
  // Counted now, not read from the rollup.
  //
  // The rollup is what the *lists* read — every country, every town in a county
  // — and that is the reason it exists: one row each rather than a count over
  // millions. But the five numbers at the top of a level are one area, and they
  // sit directly above a board that counts live. Reading them from the rollup
  // meant the two disagreed whenever the rollup was behind, and on 18 Sep 2026
  // BS1's header said 53 known while its own eight categories, on the same
  // screen, added up to 85. Thirteen hours behind, and the owner had asked for
  // the Refresh button to be taken off the screen — rightly: a number you have
  // to press a button to believe is not a number.
  //
  // One indexed lookup on `place_areas` and a join on the primary key. A
  // category or a subcategory narrows the same set, exactly as `statsForRefs`
  // does for a ring — a subcategory decides its own category, so the category
  // is ignored whenever one is given.
  const { rows } = await query(
    `select count(*)::int as known,
            count(*) filter (where pi.ownership = 'owned')::int      as owned,
            count(*) filter (where pi.ownership = 'claimed')::int    as claimed,
            count(*) filter (where pi.ownership = 'identified')::int as identified,
            count(*) filter (where pi.ready)::int as ready_count,
            avg(pi.data_score)::real as avg_score
       from place_index pi
      where exists (select 1 from place_areas pa where pa.venue_ref = pi.venue_ref and pa.area_slug = $1)
        and ($3::text <> '' or $2::text = '' or pi.category = $2)
        and ($3::text = '' or pi.subcategory = $3)`,
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
 * What an area means to the search log, which is not what it means to the index.
 *
 * `whereOf()` files a point search against a *county*, because that is the
 * honest grain for "somebody looked here": a town boundary is not where a
 * search stops. So three things have to be translated before the log can be
 * read by area —
 *
 *   - a country: its counties do not carry `parent_slug` (the country was added
 *     later, migration 145), so its descendants are every locality sharing its
 *     country code;
 *   - a county: itself, plus the towns that name it as parent;
 *   - a town: not its own slug, which nothing is filed under — its cells.
 *
 * A town whose places have no cell yet cannot be told apart from its county at
 * all. It reads the county's figures and says whose they are, rather than
 * showing zeros that would read as "nobody asked" (`asCounty`).
 *
 * Both demand boards resolve through this one function. The lens inside Places
 * had it and the standalone board did not, so `/admin/demand?where=gb` reported
 * nothing at all while the same question inside Places answered (Codex, 18 Sep
 * 2026).
 */
export async function demandScope(area) {
  if (!area) return { slugs: null, cells: null, asCounty: null };
  if (area.kind === 'town') {
    const { rows } = await query(
      `select distinct pi.cell from place_index pi
         join place_areas pa on pa.venue_ref = pi.venue_ref
        where pa.area_slug = $1 and pi.cell is not null`, [area.slug]);
    const cells = rows.map((r) => r.cell);
    if (cells.length) return { slugs: null, cells, asCounty: null };
    const county = area.parent_slug ? await areaBySlug(area.parent_slug) : null;
    return { slugs: [county?.slug ?? area.slug], cells: null, asCounty: county };
  }
  const { rows } = await query(
    area.kind === 'country'
      ? `select slug from localities where country_code = upper($2) or slug = $1`
      // `$2` is unused here and still bound, because both branches take the
      // same two parameters and Postgres refuses a statement given more than it
      // names. Cast, because a parameter compared only with itself has no
      // inferable type and preparing it can fail outright.
      : `select slug from localities where ($2::text = $2::text) and (slug = $1 or parent_slug = $1)`,
    [area.slug, area.country_code ?? '']);
  return { slugs: rows.map((r) => r.slug), cells: null, asCounty: null };
}

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
      -- What was asked for here, by cell rather than by slug for a town or an
      -- outcode.
      --
      -- whereOf files a point search against a *county* on purpose — that is
      -- the honest grain for a point — and rewrites a town's slug to its
      -- parent. So asking for the town's own slug answered nought on every row,
      -- and the ladder could not be sorted or read by demand at all (Codex,
      -- 18 Sep 2026). A county still matches by slug, which is where its
      -- searches are.
      left join lateral (
        select count(*)::int as searches, count(*) filter (where s.empty)::int as empty
          from searches s
         where s.at > now() - ($3 || ' days')::interval
           and (case when $2 = 'county' then s.area_slug = l.slug
                     else s.cell in (select pi.cell from place_areas pa
                                       join place_index pi on pi.venue_ref = pa.venue_ref
                                      where pa.area_slug = l.slug and pi.cell is not null)
                end)
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
           -- The website comes off the score, which already worked it out.
           --
           -- rescore() writes website into score_parts for every place it
           -- touches, from the same three sources — the record, the venue's own
           -- page on the attraction, the sweep. Asking those three again here,
           -- once per place, was three lateral lookups across every place in
           -- Britain: eighty-three seconds for the country board (18 Sep 2026,
           -- measured on the deployed site). One jsonb read instead.
           select pa.area_slug, pi.venue_ref, pi.ready, pi.score_parts
             from mine m
             join place_areas pa on pa.venue_ref = m.venue_ref
             join place_index pi on pi.venue_ref = m.venue_ref
            where pa.area_slug <> $1
         ),
         -- Which towns each outcode's own places also sit in, worked out once
         -- rather than per row. Joined straight on, it multiplied every place by
         -- the number of areas it belongs to and every count on the board with
         -- it (18 Sep 2026 — the same duplication the laterals above exist to
         -- avoid, made by the fix for the slow one).
         towns_ as (
           select r.area_slug, string_agg(distinct t.name, ', ') as towns
             from rows_ r
             join place_areas pa3 on pa3.venue_ref = r.venue_ref
             join localities t on t.slug = pa3.area_slug and t.kind = 'town'
            group by r.area_slug
         )
    select l.slug, l.name, l.kind,
           -- The towns this outcode's own places actually sit in — the way back
           -- across the two ladders, and the only honest thing to print beside
           -- an outcode. Read through the places, not through a parent an
           -- outcode does not have.
           tw.towns,
           count(*)::int as known,
           count(*) filter (where pi.ownership = 'owned')::int as owned,
           count(*) filter (where pi.ownership = 'claimed')::int as claimed,
           count(*) filter (where r.ready)::int as ready_count,
           -- A picture a subcategory does not require is still a picture: it
           -- lands in notCounted, and counting only held made coverage fall
           -- when somebody changed the bar (Codex, 18 Sep 2026). The three
           -- columns beside this one already read both.
           count(*) filter (where (r.score_parts->'held') ? 'picture'
                               or (r.score_parts->'notCounted') ? 'picture')::int as picture,
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
      -- The way back across the two ladders, and the only honest thing to print
      -- beside an outcode, which has no parent of its own.
      left join towns_ tw on tw.area_slug = l.slug and l.kind = 'postcode'
       where l.kind in ('town', 'postcode')
     group by l.slug, l.name, l.kind, tw.towns
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
  // "Can show" is the count that answers the owner's question of 20 Sep 2026:
  // the board said 423 places in Fun inside this ring and the app showed five.
  // Most of the difference is places we know only as a provider's identifier —
  // real, countable, and not something a household may ever be shown, because
  // we hold no name for them that is ours. The same name rule as `namesFor`
  // and the household view, so the three never disagree.
  //
  // Written as three `exists` rather than as joins, and with the attraction
  // matched two ways instead of on `a.venue_ref = pi.venue_ref or 'atlas:' ||
  // a.id::text = pi.venue_ref`. That OR is the one no index can serve at either
  // end — the same shape that made the search box take sixteen seconds (19 Sep
  // 2026) — and joining it here took this board from two seconds to
  // twenty-five on a thirty-minute ring (20 Sep 2026, on the deployed site).
  const SHOWABLE = `(
    exists (select 1 from place_records r2 where r2.venue_ref = pi.venue_ref and r2.name is not null)
    or exists (select 1 from attractions a2
                where a2.venue_ref = pi.venue_ref and a2.state <> 'hidden'
                  and a2.name is not null and a2.display_source is distinct from 'google')
    or (pi.venue_ref like 'atlas:%' and exists (
          select 1 from attractions a3
           where a3.id::text = substring(pi.venue_ref from 7) and a3.state <> 'hidden'
             and a3.name is not null and a3.display_source is distinct from 'google'))
    or ((pi.venue_ref like 'osm:%' or pi.venue_ref like 'atlas:%'
         or pi.venue_ref like 'wikidata:%' or pi.venue_ref like 'own:%')
        and exists (select 1 from scout_places s2 where s2.venue_ref = pi.venue_ref and s2.name is not null))
  )`;
  const { rows: held } = await query(`
    select pi.category, pi.subcategory,
           count(*)::int as known,
           count(*) filter (where ${SHOWABLE})::int as showable,
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
    const c = byCat.get(h.category) ?? { known: 0, showable: 0, owned: 0, claimed: 0, identified: 0, ready_count: 0, sum: 0, n: 0 };
    c.known += h.known; c.showable += h.showable; c.owned += h.owned; c.claimed += h.claimed; c.identified += h.identified; c.ready_count += h.ready_count;
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
      // An area's own searches *and* its descendants'.
      //
      // A point search is filed against a county, so Great Britain's searches
      // live under its counties and a town's under its own county — and asking
      // for the slug alone showed no demand at all on the country and town
      // boards while the Demand lens beside them showed plenty (Codex, 18 Sep
      // 2026).
      // A town's searches are filed against its county — `whereOf` normalises
      // to the county because that is the honest grain for a point search — so
      // a town matching its own slug and its descendants found nothing, while
      // the Demand lens beside it showed the county's plenty (Codex, 18 Sep
      // 2026). `demandScope` is the one place that knows this; upward as well
      // as downward.
      : `select subject, count(*)::int as searches, count(*) filter (where empty)::int as empty
           from searches s
          where s.at > now() - ($1 || ' days')::interval
            and ($2::text[] is null or s.area_slug = any($2))
            and ($3::text[] is null or s.cell = any($3))
          group by subject`,
    refs
      ? [String(since), refs]
      : await (async () => {
        const scope = await demandScope(await areaBySlug(slug ?? ''));
        return [String(since), scope.slugs ?? (slug ? [slug] : null), scope.cells];
      })())).rows.map((r) => [r.subject, r]));

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
        known: c?.known ?? 0, showable: c?.showable ?? 0, owned: c?.owned ?? 0, claimed: c?.claimed ?? 0, identified: c?.identified ?? 0,
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
      known: h?.known ?? 0, showable: h?.showable ?? 0, owned: h?.owned ?? 0, claimed: h?.claimed ?? 0, identified: h?.identified ?? 0,
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
         n as (select s.venue_ref, count(*)::int as sources from scoped s join place_index_sources src on src.venue_ref = s.venue_ref where ${FOUND_IT('src')} group by s.venue_ref)
    select s.subcategory,
           count(*)::int as known,
           ${SOURCES.map((x, i) => (x.key === 'own'
             // "Ours" is the same fact the OWNED figure above it is, so it is
             // counted the same way. Counting the `own` *source* instead made
             // one screen say 58 owned over a column of dashes (Codex, 17 Sep).
             ? `count(*) filter (where s.ownership = 'owned')::int as src_${i}`
             : `count(*) filter (where exists (select 1 from place_index_sources q where q.venue_ref = s.venue_ref and q.source = '${x.key}' and (${FOUND_IT('q')})))::int as src_${i}`)).join(',\n           ')},
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
           (select string_agg(src.source, ',' order by src.source) from place_index_sources src where src.venue_ref = pi.venue_ref and (${FOUND_IT('src')})) as srcs,
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
      standIn: named.get(w.venue_ref)?.standIn ?? false,
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
  const UNSEEN = `(select count(*)::int from place_index_sources src where src.venue_ref = pi.venue_ref and (${FOUND_IT('src')}))`;
  const ORDER = {
    missing: `${MISSING} ${desc ? 'desc' : 'asc'}, pi.data_score asc nulls first`,
    score: `pi.data_score ${desc ? 'desc' : 'asc'} nulls last`,
    name: `${NAME} ${desc ? 'desc' : 'asc'}`,
    unseen: `${UNSEEN} ${desc ? 'asc' : 'desc'}`,
  }[sort] ?? `${MISSING} desc, pi.data_score asc nulls first`;
  args.push(limit);
  const { rows } = await query(`
    select pi.venue_ref, pi.subcategory, pi.category, pi.data_score, pi.ready, pi.score_parts, pi.ownership, pi.oldest_fact,
           (select count(*)::int from place_index_sources src where src.venue_ref = pi.venue_ref and (${FOUND_IT('src')})) as seen_by,
           (select string_agg(src.source, ',' order by src.source) from place_index_sources src where src.venue_ref = pi.venue_ref and (${FOUND_IT('src')})) as srcs,
           (select upper(pa.area_slug) from place_areas pa join localities l on l.slug = pa.area_slug
             where pa.venue_ref = pi.venue_ref and l.kind = 'postcode' limit 1) as outcode
      from place_index pi
      left join place_records r on r.venue_ref = pi.venue_ref
      -- One attraction per place: the reference index is not unique, so a place
      -- harvested in two regions was two rows in the list — and the duplicates
      -- ate the page's own limit, hiding places below them (Codex, 18 Sep 2026).
      left join lateral (
        select a2.* from attractions a2
         where (a2.venue_ref = pi.venue_ref or 'atlas:' || a2.id::text = pi.venue_ref)
           and a2.state <> 'hidden'
         order by a2.last_seen desc, a2.id limit 1) a on true
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
      // True where the name is the search term that found it, not the place's
      // own — the sweep may not keep a provider's name and is waiting for an
      // open one (namesFor).
      standIn: named.get(r.venue_ref)?.standIn ?? false,
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
/**
 * Places a live search returned, into the index.
 *
 * The board's own words for Known are "every place any source has ever seen
 * here, however little we hold about it", and a place a provider returned and
 * we put in front of a household is one of those — recorded as an impression
 * and a log row, neither of which the rebuild reads, it stayed out of Places
 * until somebody happened to save it (Codex, 18 Sep 2026).
 *
 * The reference, where it is, and who returned it. Never a name: that is rented
 * and there is nowhere here to put one (CLAUDE.md).
 *
 * Each source keeps its own identifier. A place found through Google is
 * `google:ChIJ…`, and that id belongs to Google's row and to no other — handing
 * one source's identifier to every source a place names would file Google's
 * reference under OSM (Codex, 18 Sep 2026, twice).
 *
 * One function because four routes do this — discover, places, the trip map and
 * Inspire — and the last four times a rule lived in more than one place, the
 * copies drifted.
 */
/**
 * Turn what a search just paid for into a score that is ours to keep.
 *
 * The owner, 20 Sep 2026: "we're supposed to be taking these review scores and
 * converting them into an epic score, so they're stored. If I pay to look at
 * the next 30 pubs and bars, we should be converting it into our score, and
 * from that moment on, that location should always have a score."
 *
 * Agreed, and it was not happening: a display search carried a rating and a
 * review count for every place it returned, the results were composed, and both
 * figures were dropped on the floor. The next search bought them again.
 *
 * What is written down is *derived* and nothing else — the crowd as one of four
 * words, how many have been as one of four, and the Epic score itself. The
 * rating never lands in a column and never reaches a device; it is read, turned
 * into a judgement of ours, and forgotten (data policy, 19 Sep 2026: "The Epic
 * score is ours because it is derived… never a stored copy of Google's 4.6").
 * None of these is an owned *fact* (`OWNED_FACTS`), so scoring a place does not
 * make it owned — it makes it ranked.
 *
 * Both places a score is kept are written, for the same reason `rescoreOne`
 * writes both: a screen reading one and a list ordering by the other is drift.
 */
export async function noteScores(venues = []) {
  const refs = []; const crowds = []; const counts = []; const epics = []; const owneds = [];
  for (const v of venues ?? []) {
    const ref = v?.venueRef ?? (v?.source && v?.sourcePlaceId ? `${v.source}:${v.sourcePlaceId}` : null);
    const rating = Number(v?.rating);
    if (!ref || !Number.isFinite(rating) || rating <= 0) continue;
    const reviews = Number.isFinite(Number(v?.ratingCount)) ? Number(v.ratingCount) : 0;
    const crowd = crowdBand(rating, reviews);
    const many = countBand(reviews);
    const { epicScore, ownedScore } = score({
      crowd, count: many,
      accolades: v.accolades ?? [],
      menuItems: v.menuItems ?? 0,
      cuisines: v.cuisines ?? [],
      website: v.website ?? null,
      summary: v.summary ?? null,
      openingHours: v.openingHours ?? null,
      chainScale: v.chainScale ?? 'independent',
    });
    refs.push(ref); crowds.push(crowd); counts.push(many); epics.push(epicScore); owneds.push(ownedScore);
  }
  if (!refs.length) return { scored: 0 };
  await query(
    `insert into place_records (venue_ref, crowd_band, count_band, epic_score, owned_score, banded_at, scored_at, updated_at)
     select t.ref, t.crowd, t.many, t.epic, t.owned, now(), now(), now()
       from unnest($1::text[], $2::text[], $3::text[], $4::numeric[], $5::numeric[]) as t(ref, crowd, many, epic, owned)
     on conflict (venue_ref) do update
        set crowd_band = excluded.crowd_band, count_band = excluded.count_band,
            epic_score = excluded.epic_score, owned_score = excluded.owned_score,
            banded_at = now(), scored_at = now(), updated_at = now()`,
    [refs, crowds, counts, epics, owneds],
  );
  // The sweep's copy, where it has one. Never inserted: a sweep row belongs to
  // an area sweep and inventing one here would claim we had swept somewhere.
  await query(
    `update scout_places sp
        set epic_score = t.epic, owned_score = t.owned,
            crowd_band = t.crowd, count_band = t.many, scored_at = now()
       from unnest($1::text[], $2::text[], $3::text[], $4::numeric[], $5::numeric[]) as t(ref, crowd, many, epic, owned)
      where sp.venue_ref = t.ref`,
    [refs, crowds, counts, epics, owneds],
  );
  return { scored: refs.length };
}

export async function noteSeen(venues = []) {
  const rows = (venues ?? [])
    .map((v) => {
      // The reference a place already has, before one is built for it.
      //
      // The four callers hand over three shapes: a raw provider record with
      // `source` and `sourcePlaceId`, a normalised item that already carries a
      // `venueRef`, and a stored result whose `source` says `own` while its ref
      // belongs to whoever first found it. Building `source:sourcePlaceId` for
      // all of them dropped the normalised ones on the floor and would have
      // written `own:ChIJ…` rows for the stored ones — a second, false identity
      // for a place we already hold (Codex, 18 Sep 2026).
      const ref = v?.venueRef ?? (v?.source && v?.sourcePlaceId ? `${v.source}:${v.sourcePlaceId}` : null);
      if (!ref || v.lat == null || v.lng == null) return null;
      // Who the reference actually belongs to, which is not always `v.source`.
      const owner = String(ref).split(':')[0];
      const id = String(ref).slice(owner.length + 1);
      const sources = [...new Set([owner, v.source, ...(v.contributingSources ?? [])])]
        .filter(Boolean)
        // "own" is not a source that returns places; it is how a stored result
        // describes itself.
        .filter((x) => x !== 'own' || owner === 'own');
      return {
        ref,
        lat: v.lat, lng: v.lng,
        countryCode: v.countryCode ?? null,
        // What Google calls it. Free on a display search, Pro on its own, so
        // this is the only place it is ever learned (data policy, 19 Sep 2026).
        types: [...new Set([v.primaryType, ...(v.labels ?? []).map((l) => String(l).replace(/^google:/, ''))].filter(Boolean))],
        sources,
        // Its own id for the source the reference belongs to, and every other
        // contributor's where the merge carried one.
        //
        // "Nothing invented for the others" was right — but the merge does know
        // them and was throwing them away, so a Google result merged into an
        // OpenStreetMap one wrote a Google row with no id and `FOUND_IT` read
        // Google as having found nothing. Coverage undercounted and "one source
        // only" was inflated by exactly the cross-provider matches that prove
        // the opposite (Codex, 19 Sep 2026). The canonical one wins where both
        // speak: it is the reference the place is actually filed under.
        sourceIds: { ...(v.sourceIds ?? {}), ...(id ? { [owner]: id } : {}) },
      };
    })
    .filter(Boolean);
  if (!rows.length) return { noted: 0 };
  // Best-effort: a household's search is never worth failing over bookkeeping.
  return noteMany(rows, { source: null }).catch(() => ({ noted: 0 }));
}

/**
 * The first ten, as a household would be shown them.
 *
 * Every other read on these boards answers "how complete is our data"; this one
 * answers "what would somebody actually see", which is a different order and a
 * different set of fields (owner, 20 Sep 2026: "I want the default view to be
 * what the user sees… I should just see the first 10").
 *
 * Two rules make it a household's list rather than the index's:
 *
 *   · **Ranked by the Epic score**, which is ours — Google's rating and review
 *     count plus our own signals, derived and written down, never a stored copy
 *     of anybody's number (data policy, 19 Sep 2026). Nothing is asked of a
 *     provider here: every field comes from a table we may keep, which is what
 *     makes it instant. A place we have not scored yet sorts below one we have
 *     rather than above it, because "we do not know" is not a high mark.
 *   · **Nothing nameless, and no stand-ins.** A `google:` reference nobody owns
 *     has no name we may hold, and the sweep writes the search term that found
 *     it — "(wildlife park)" — while it waits for an open one. Both are
 *     findings on the index's own board and neither is a place a household may
 *     be shown: "we're not displaying random strings to users on our website"
 *     (owner, 20 Sep 2026). They are counted out loud instead, so the ones held
 *     back are a number on the board rather than a silent gap.
 */
/**
 * The entities a venue's own page actually carries, named and numbered.
 *
 * Read off a marketing page, "air-conditioned restaurant &amp; bar" is not
 * English — it is the markup showing through, and it is exactly the kind of
 * thing nobody should ever be shown (owner, 20 Sep 2026). The numbered forms
 * are handled by rule rather than by list, because `&#x27;` and `&#8217;` are
 * as common as the words and no hand-written list ever holds them all (Codex,
 * 20 Sep 2026).
 */
const ENTITY = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: '\u2019', nbsp: ' ',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
  ndash: '\u2013', mdash: '\u2014', hellip: '\u2026', middot: '\u00b7',
  pound: '\u00a3', euro: '\u20ac', deg: '\u00b0', eacute: '\u00e9', hyphen: '-',
};
const codePoint = (n) => {
  try { return String.fromCodePoint(n); } catch { return ''; }
};
export const decodeEntities = (text) => String(text)
  .replace(/&#x([0-9a-f]+);/gi, (m, hex) => codePoint(parseInt(hex, 16)) || m)
  .replace(/&#(\d+);/g, (m, dec) => codePoint(Number(dec)) || m)
  .replace(/&([a-z]+);/gi, (m, name) => ENTITY[name.toLowerCase()] ?? m);

/**
 * Words that end in a full stop without ending a sentence.
 *
 * "St. Mary's Church welcomes visitors" is one sentence, and cutting at the
 * first full stop left the row saying "St." — which is most churches (Codex,
 * 20 Sep 2026).
 */
const NOT_THE_END = /(?:^|\s)(?:st|mr|mrs|ms|dr|no|vs|etc|jr|sr|ave|rd|approx|co|inc|ltd|ft|c|e\.g|i\.e|[A-Z])\.$/i;

/**
 * What we say a place is, in a line a list can hold.
 *
 * The whole account belongs on the place's own page; a row needs the first
 * sentence of it.
 */
const inAWord = (text) => {
  if (!text) return null;
  const plain = decodeEntities(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!plain) return null;
  let first = plain;
  const ends = /[.!?](?=\s|$)/g;
  for (let m = ends.exec(plain); m; m = ends.exec(plain)) {
    const upTo = plain.slice(0, m.index + 1);
    if (NOT_THE_END.test(upTo)) continue;
    first = upTo;
    break;
  }
  return first.length > 120 ? `${first.slice(0, 117).trimEnd()}\u2026` : first;
};

export async function household(areaSlug, {
  refs = null, category = null, subcategory = null, limit = 10, offset = 0,
} = {}) {
  const args = [];
  const where = [];
  if (refs) { args.push(refs); where.push(`pi.venue_ref = any($${args.length})`); }
  else { args.push(lower(areaSlug)); where.push(`exists (select 1 from place_areas pa where pa.venue_ref = pi.venue_ref and pa.area_slug = $${args.length})`); }
  if (category) { args.push(category); where.push(`pi.category = $${args.length}`); }
  if (subcategory) { args.push(subcategory); where.push(`pi.subcategory = $${args.length}`); }

  // The same name rule as `namesFor`, in SQL, because it decides which rows
  // exist at all here — and a filter applied after the limit would take ten and
  // then show four.
  const NAME = `coalesce(r.name, case when a.display_source is distinct from 'google' then a.name end,
                         case when pi.venue_ref like 'osm:%' or pi.venue_ref like 'atlas:%'
                                   or pi.venue_ref like 'wikidata:%' or pi.venue_ref like 'own:%'
                              then sp.name end)`;
  // The freshest score, not the first one found. Both places a score is kept
  // are written by `rescoreOne`, but the lookup's own banding writes the owned
  // record alone — so a place swept in June and re-banded last night had two,
  // and reading the sweep's first ranked the board on the older of them
  // (Codex, 20 Sep 2026).
  // When the owned record's score was last worked out. The lookup's banding
  // stamps `banded_at` and the scorer stamps `scored_at`, so reading one of
  // them alone called a score written last night older than a sweep in June
  // (Codex, 20 Sep 2026). A tie goes to the owned record: it is the layer we
  // curate on purpose.
  const OWN_SCORED = "coalesce(greatest(r.scored_at, r.banded_at), to_timestamp(0))";
  /** When the owned record's *bands* were last worked out, which is its own act. */
  const OWN_BANDED = "coalesce(r.banded_at, to_timestamp(0))";
  const SCORE = `case
    when sp.epic_score is null then coalesce(r.epic_score, a.epic_score)
    when r.epic_score is null then sp.epic_score
    when ${OWN_SCORED} >= coalesce(sp.scored_at, to_timestamp(0)) then r.epic_score
    else sp.epic_score end`;
  args.push(limit);
  args.push(offset);
  const sql = (select, tail) => `
    select ${select}
      from place_index pi
      left join place_records r on r.venue_ref = pi.venue_ref
      left join lateral (
        select a2.* from attractions a2
         where (a2.venue_ref = pi.venue_ref or 'atlas:' || a2.id::text = pi.venue_ref)
           and a2.state <> 'hidden'
         order by a2.last_seen desc, a2.id limit 1) a on true
      left join lateral (
        select s2.* from scout_places s2 where s2.venue_ref = pi.venue_ref
         order by s2.last_seen desc limit 1) sp on true
      left join lateral (
        select d2.* from attraction_details d2 where d2.attraction_id = a.id limit 1) d on true
     where ${where.join(' and ')}${tail}`;

  const { rows } = await query(sql(`
    pi.venue_ref, pi.category, pi.subcategory, pi.data_score, pi.ready, pi.ownership,
    ${NAME} as name,
    ${SCORE} as epic_score,
    greatest(sp.scored_at, r.scored_at, r.banded_at) as scored_at, sp.rank,
    -- A band from wherever it was last worked out: the sweep keeps one, so does
    -- an owned record that has been collected, and so does an attraction from
    -- the atlas harvest. Reading the sweep's alone left a place we own but have
    -- never swept with no standing at all (Codex, 20 Sep 2026).
    -- A band has its own stamp. Rescoring an owned record moves scored_at and
    -- leaves the bands exactly as they were, so choosing them on the score's
    -- freshness handed back a band from last spring as this morning's evidence
    -- (Codex, 20 Sep 2026). And an atlas attraction keeps its standing in
    -- "band": "crowd_band" there belongs to the activity sweep, and reading
    -- that alone left every harvested attraction with no standing at all.
    case when ${OWN_BANDED} >= coalesce(sp.scored_at, to_timestamp(0)) then coalesce(r.crowd_band, sp.crowd_band, a.crowd_band, a.band)
         else coalesce(sp.crowd_band, r.crowd_band, a.crowd_band, a.band) end as crowd_band,
    case when ${OWN_BANDED} >= coalesce(sp.scored_at, to_timestamp(0)) then coalesce(r.count_band, sp.count_band, a.count_band)
         else coalesce(sp.count_band, r.count_band, a.count_band) end as count_band,
    -- An empty list is not an answer. Both of these default to '[]' on the
    -- sweep's row, so a place swept before anybody looked at its food lost the
    -- cuisines its owned record holds (Codex, 20 Sep 2026).
    sp.chain,
    coalesce(nullif(sp.cuisines, '[]'::jsonb), nullif(r.cuisines, '[]'::jsonb)) as cuisines,
    coalesce(nullif(sp.accolades, '[]'::jsonb), nullif(a.accolades, '[]'::jsonb)) as accolades,
    -- The curation writes its description under "what" (sources/curate.js's
    -- own schema); reading "summary" alone said nothing had been written about
    -- a place we had written four paragraphs about (Codex, 20 Sep 2026). Both
    -- keys are read, because older rows hold the other one.
    -- Ours first: a hand-written summary, then what we curated from the venue's
    -- own pages, and the encyclopedia's only if we have written nothing. The
    -- atlas ahead of the curation meant a place we had written four paragraphs
    -- about still read as Wikipedia's first line (Codex, 20 Sep 2026).
    coalesce(r.summary, r.curation->>'what', r.curation->>'summary', a.summary) as summary,
    coalesce(r.website, a.website, sp.website) as website,
    -- The same two places the readiness bar counts hours in, so the tick here
    -- and the tick on the index board are about the same fact.
    coalesce(r.opening_hours, d.visit->>'openingHours') as opening_hours,
    coalesce(r.lat, sp.lat, a.lat) as lat, coalesce(r.lng, sp.lng, a.lng) as lng,
    (select upper(pa.area_slug) from place_areas pa join localities l on l.slug = pa.area_slug
      where pa.venue_ref = pi.venue_ref and l.kind = 'postcode' limit 1) as outcode,
    (select li.image_id from image_links li join image_assets ia on ia.id = li.image_id
      where ia.may_store and ia.moderation = 'approved'
        and ((li.subject_type = 'place' and li.subject_id = pi.venue_ref)
          or (li.subject_type = 'attraction' and li.subject_id = a.id::text))
      order by li.position limit 1) as picture,
    (select m.state = 'read' from place_menus m where m.venue_ref = pi.venue_ref order by m.read_at desc nulls last limit 1) as menu_read`,
    ` and ${NAME} is not null
      order by ${SCORE} desc nulls last, sp.rank asc nulls last, pi.data_score desc nulls last, pi.venue_ref
      limit $${args.length - 1} offset $${args.length}`), args);

  // What the ten were chosen from, and what was held back for having no name we
  // may show. Both are counted over the same scope, so the board can say "ten
  // of forty-one, twelve held back" without a second idea of where it is.
  const { rows: [counted] } = await query(sql(`
    count(*) filter (where ${NAME} is not null)::int as named,
    count(*) filter (where ${NAME} is null)::int as nameless,
    count(*) filter (where ${NAME} is not null and ${SCORE} is null)::int as unscored`, ''), args.slice(0, -2));

  return {
    rows: rows.map((r) => ({
      ref: r.venue_ref, name: r.name,
      category: r.category, subcategory: r.subcategory, outcode: r.outcode ?? null,
      // Ours, and said to one decimal place because that is the precision it is
      // kept to; a place nobody has scored says so rather than printing a nought.
      epicScore: r.epic_score == null ? null : Math.round(Number(r.epic_score) * 10) / 10,
      scoredAt: r.scored_at ?? null, rank: r.rank ?? null,
      // Bands, never a rating: the figures the band was made from are a
      // provider's and were never written down (§13.10).
      standing: r.crowd_band ?? null, howMany: r.count_band ?? null,
      chain: r.chain === true, cuisines: r.cuisines ?? [], accolades: r.accolades ?? [],
      what: inAWord(r.summary), website: r.website ?? null,
      hours: Boolean(r.opening_hours), menu: r.menu_read === true,
      picture: r.picture ?? null,
      lat: r.lat == null ? null : Number(r.lat), lng: r.lng == null ? null : Number(r.lng),
      dataScore: r.data_score, ready: r.ready, ownership: r.ownership,
    })),
    from: offset, named: counted?.named ?? 0,
    nameless: counted?.nameless ?? 0,
    unscored: counted?.unscored ?? 0,
  };
}

export async function namesFor(refs) {
  const out = new Map();
  if (!refs?.length) return out;
  const { rows } = await query(`
    select pi.venue_ref,
           r.name as own_name,
           a.name as atlas_name,
           a.display_source,
           -- Named only where the reference itself is an open one.
           --
           -- The sweep keeps a name because OpenStreetMap's is ours to keep;
           -- a licensed source's is not, and denying google alone would have
           -- handed back a Tripadvisor name labelled OSM the day a
           -- tripadvisor reference reached scout_places (Codex, 18 Sep
           -- 2026). A list of what may be kept, never a list of what may not —
           -- the fallback has to be silence (CLAUDE.md).
           case when pi.venue_ref like 'osm:%' or pi.venue_ref like 'atlas:%'
                     or pi.venue_ref like 'wikidata:%' or pi.venue_ref like 'own:%'
                then sp.name else null end as osm_name
      from place_index pi
      left join place_records r on r.venue_ref = pi.venue_ref
      -- One attraction per place: the reference index is not unique, so a place
      -- harvested in two regions was two rows in the list — and the duplicates
      -- ate the page's own limit, hiding places below them (Codex, 18 Sep 2026).
      left join lateral (
        select a2.* from attractions a2
         where (a2.venue_ref = pi.venue_ref or 'atlas:' || a2.id::text = pi.venue_ref)
           and a2.state <> 'hidden'
         order by a2.last_seen desc, a2.id limit 1) a on true
      left join lateral (select name from scout_places s where s.venue_ref = pi.venue_ref order by last_seen desc limit 1) sp on true
     where pi.venue_ref = any($1)`, [refs]);
  for (const r of rows) {
    const name = r.own_name ?? r.atlas_name ?? r.osm_name ?? null;
    const from = r.own_name ? 'ours' : r.atlas_name ? 'atlas' : r.osm_name ? 'osm' : null;
    // Whether that name is a stand-in rather than the place's own.
    //
    // The activity sweep finds a place through Google and may not keep Google's
    // name, so it writes the search term that found it — "(wildlife park)" —
    // and waits for an OpenStreetMap match to give it a name we may keep
    // (activitySweep.js, display_source = 'google'). On screen that read as a
    // place actually called "(wildlife park)", and a board full of them reads
    // as broken data rather than as work waiting (owner, 18 Sep 2026).
    out.set(r.venue_ref, { name, from, standIn: from === 'atlas' && r.display_source === 'google' });
  }
  return out;
}

export default {
  SOURCES, bars, seedBars, setBar, reindex, rescore, note, noteMany, refreshStats, statsAge,
  statsFor, statsForRefs, countries, areaBySlug, demandScope, breakdown, coverage, categories, shelveAll, settleClaims,
  sources, quality, places, household, namesFor, labels, noteSeen, noteScores,
};
