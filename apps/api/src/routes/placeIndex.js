/**
 * Places — one screen, one grammar, every lens.
 *
 * Five back-office screens that were each bound to a different table become one
 * that is bound to a question, and this is what it reads. Every level answers
 * the same five numbers — known, owned, identified only, ready, average data
 * score — so a country, a county, a ring, a category and a subcategory all read
 * the same way, and the only thing that changes between them is what goes in the
 * `where`.
 *
 * Nothing here returns a provider's content. Names come from an owned record,
 * from the atlas or from OpenStreetMap; a `google:` ref nobody owns comes back
 * without one, and the nameless row on screen is the finding.
 *
 * `view_library` to look. Anything that spends — a name fetched from Google, a
 * comparison, a collection run — needs `manage_library`, and says what it costs
 * before it does it.
 */

import express from 'express';
import { can, requires } from '../access.js';
import { query, withTransaction } from '../db.js';
import * as index from '../repositories/placeIndex.js';
import * as reach from '../repositories/reach.js';
import { sectorOf, labelOf, CAP_MINUTES, EDGE_MINUTES } from '../domain/reach.js';
import { travelMode, estimateTravelMinutes } from '../domain/travel.js';
import { FACTS, FACT_KEYS, FACT_WEIGHTS, scorePlace, faultOf, SHORT_FAULT, holdsAnOwnedFact } from '../domain/placeIndex.js';
import { writeAudit } from '../repositories/roles.js';
import { OUR_LABEL, detailFor, blank, lineUp } from '../sources/compare.js';
import { googleSource } from '../sources/google.js';
import { tripadvisorSource } from '../sources/tripadvisor.js';
import { TRIPADVISOR_CAP } from '../repositories/runs.js';
import { PRICE_PER_UNIT_USD, USD_TO_GBP } from '../domain/providerPrices.js';
import * as collectRuns from '../repositories/collectRuns.js';
import * as ownedPlaces from '../repositories/ownedPlaces.js';
import { googleMatchFor, matchesFor } from '../sources/providerMatch.js';
import { whySourceFailed } from '../sources/why.js';
import { currentHousehold } from './household.js';
import { enrich } from '../sources/own.js';
import { crowdBand, countBand } from '../domain/scoring.js';
import { pictureFor } from '../sources/placePicture.js';

/** Who did it, said the same way every other back-office route says it. */
const actor = (req) => ({ actorId: req.account?.id ?? null, actorLabel: req.account?.email ?? 'the owner (passcode)' });

const router = express.Router();
const bad = (message, code = 'bad_request') => Object.assign(new Error(message), { status: 400, code });
const lower = (s) => String(s ?? '').trim().toLowerCase();
/** Pence, said as money, so a limit reads as one. */
const money = (pence) => `£${(Math.max(0, pence) / 100).toFixed(2)}`;

/**
 * The ceiling, checked before a call rather than after it.
 *
 * "Nothing spends past it" is printed on the Runs board, and a limit that is
 * only shown is not a limit (Codex, 17 Sep 2026). Everything on a collection
 * path asks this first, and a run that would cross it is refused with what is
 * left rather than half-done.
 */
export async function roomToSpend(pence, { holder = null, reserve = true } = {}) {
  return withTransaction(async (client) => {
    // The lock is on the setting the ceiling is written in, taken before it is
    // read. Two runs asking at once are then serialised on it, so the second
    // one sees the first one's claim rather than the same stale total (Codex,
    // 17 Sep 2026).
    // The row is made first if it is not there. `for update` over no rows locks
    // nothing at all, so without this the very first two callers on a fresh
    // installation would serialise on nothing and both walk through.
    await client.query(
      `insert into app_settings (key, value) values ('collect.ceiling_pence', '25000'::jsonb)
       on conflict (key) do nothing`);
    const { rows: [set] } = await client.query(
      `select value from app_settings where key = 'collect.ceiling_pence' for update`);
    const ceilingPence = Number(set?.value ?? 25000);
    // Reservations that outlived the run that took them. By now whatever they
    // covered is in `provider_calls`, and counting both would refuse spending
    // that is genuinely there.
    await client.query('delete from spend_reservations where expires_at < now()');
    const { rows: [spend] } = await client.query(
      `select coalesce(sum(estimated_cost_usd), 0)::numeric as usd
         from provider_calls where created_at > date_trunc('month', now())`);
    const { rows: [held] } = await client.query(
      'select coalesce(sum(pence), 0)::int as pence from spend_reservations');
    // The ledger is in dollars; the ceiling is the owner's, in pounds.
    const spentPence = Math.round(Number(spend?.usd ?? 0) * 100 * USD_TO_GBP);
    const claimed = held.pence;
    const left = ceilingPence - spentPence - claimed;
    // A run that spends nothing is never over a ceiling — the ceiling is about
    // money, and researching a place from its own page costs none. Only a call
    // that would actually go out is measured against it.
    const ok = pence <= 0 || pence <= left;
    let reservation = null;
    if (ok && reserve && pence > 0) {
      const { rows: [r] } = await client.query(
        'insert into spend_reservations (pence, holder) values ($1,$2) returning id', [pence, holder]);
      reservation = r.id;
    }
    return { ok, reservation, ceilingPence, spentPence, claimedPence: claimed, leftPence: Math.max(0, left) };
  });
}

/** Give back what a run did not spend, the moment it is known. */
export const releaseSpend = (id) =>
  (id ? query('delete from spend_reservations where id = $1', [id]).catch(() => null) : Promise.resolve());

const overTheCeiling = (res, want, room) => {
  // `reservation` is bookkeeping, not an answer: nothing was claimed, because
  // nothing was allowed.
  const { reservation, ok, ...said } = room;
  return res.status(422).json({
    error: 'over_the_ceiling',
    message: `That would spend ${money(want)} and there is ${money(room.leftPence)} left of this month's ${money(room.ceilingPence)}.`,
    ...said,
  });
};

/**
 * How long a paid answer stands before it is worth buying again.
 *
 * The design's own words: "a staleness rule so a place is not re-asked inside
 * twelve months unless something changed". The same number the Collect board
 * prints.
 */
export const STALE_MONTHS = 12;

/**
 * What asking Google about one place actually costs.
 *
 * Two calls, not one, for a place we have never matched: a Nearby Search to
 * find out which Google place it is, then a Place Details to read it. The
 * collection paths priced only the second, so a run reserved half what it spent
 * (Codex, 17 Sep 2026). A ref that is already `google:`, or that we have
 * matched before, needs only the detail.
 */
// What one Places request costs us, in pence, from the one price table there
// is. A hard-coded 1.4p was the old figure and the ledger now records $0.032 a
// request — so a run reserved a little over half what it spent, and near the
// ceiling that is a run admitted with no room (Codex, 17 Sep 2026).
const pencePerCall = () => Math.round(PRICE_PER_UNIT_USD.google * 100 * USD_TO_GBP * 100) / 100;
const DETAIL_PENCE = pencePerCall();
const MATCH_PENCE = pencePerCall();
const askingCost = (refs, matched) =>
  Math.round(refs.reduce((p, ref) =>
    p + DETAIL_PENCE + (ref.startsWith('google:') || matched.has(ref) ? 0 : MATCH_PENCE), 0));

/** Which of these we already hold a Google id for, so no search is needed. */
async function alreadyMatched(refs) {
  if (!refs.length) return new Set();
  const held = await matchesFor(refs, 'google');
  return new Set([...held.entries()].filter(([, id]) => id).map(([ref]) => ref));
}

/**
 * How many locations one Tripadvisor view bills.
 *
 * Their detail response carries the locations it covers and the adapter counts
 * them (`sources/tripadvisor.js`), so the monthly allowance is spent twice as
 * fast as a count of places would suggest. The cap is claimed in *their* units
 * (Codex, 17 Sep 2026).
 */
const TA_UNITS_PER_VIEW = 2;

/** The ring chooser's three steps, and the three ways of getting there. */
export const BANDS = [30, 60, 90];
const MODES = ['drive', 'walk', 'transit'];

/**
 * What `?where=` means, and what `?within=&by=` does to it.
 *
 * Three answers, and the screen draws the same table for all three:
 *   · an area we hold — a country, a county, a town, a postcode district;
 *   · a postcode with a ring — one area made of every cell inside it;
 *   · nothing, which is the country picker.
 *
 * A county is a shape and needs no radius. A town or a postcode may take one.
 */
async function resolveWhere({ where, within, by }) {
  const slug = lower(where).replace(/\s+/g, '-');
  if (!slug) return { kind: 'none' };

  const minutes = Number(within);
  const ring = Number.isFinite(minutes) && minutes > 0 ? Math.min(CAP_MINUTES, minutes) : null;
  const mode = MODES.includes(lower(by)) ? lower(by) : 'drive';

  const area = await index.areaBySlug(slug);
  if (area && !ring) return { kind: 'area', area };

  // A ring starts from a cell: the postcode's own if it is one, otherwise the
  // area's centre snapped to the nearest cell we hold.
  let cell = null;
  let label = null;
  const sector = sectorOf(slug.replace(/-/g, ' '));
  if (sector) { cell = `sector:${sector}`; label = slug.replace(/-/g, ' ').toUpperCase(); }
  else if (area?.lat != null && area?.lng != null) {
    const at = await reach.cellAt({ lat: area.lat, lng: area.lng });
    cell = at?.code ?? null; label = area.name;
  }
  if (!cell) return area ? { kind: 'area', area } : { kind: 'unknown', slug };

  // A cell we have never seen is not an error: it is a postcode in an area
  // nothing has been indexed in, and the honest answer is the nearest one we do
  // hold with the distance said out loud.
  const known = (await query('select code, lat, lng, places from geo_cells where code = $1', [cell])).rows[0] ?? null;
  const within_ = await reach.placesWithin(cell, { minutes: ring ?? 30, mode: travelMode(mode) });
  return {
    kind: 'ring',
    area: area ?? null,
    cell, cellLabel: labelOf(cell), label: label ?? labelOf(cell),
    minutes: ring ?? 30, mode,
    refs: [...new Set(within_.map((p) => p.venue_ref))],
    minutesByRef: new Map(within_.map((p) => [p.venue_ref, p.minutes])),
    cellKnown: Boolean(known),
    cells: (await reach.reachableCells(cell, { minutes: ring ?? 30, mode: travelMode(mode) })).length,
  };
}

/** The breadcrumb over every level: where you came from, and what it holds. */
async function trail(scope) {
  const out = [];
  if (scope.kind === 'area') {
    const a = scope.area;
    if (a.kind !== 'country') {
      const country = await index.areaBySlug(lower(a.country_code));
      if (country) out.push({ slug: country.slug, label: country.name, ...(await index.statsFor(country.slug)) });
    }
    if (a.kind === 'town' && a.parent_slug) {
      const p = await index.areaBySlug(a.parent_slug);
      if (p) out.push({ slug: p.slug, label: p.name, ...(await index.statsFor(p.slug)) });
    }
  }
  if (scope.kind === 'ring') {
    const country = await index.areaBySlug('gb');
    if (country) out.push({ slug: country.slug, label: country.name, ...(await index.statsFor(country.slug)) });
  }
  return out;
}

const statsOf = (scope, extra = {}) =>
  (scope.kind === 'ring' ? index.statsForRefs(scope.refs, extra) : index.statsFor(scope.area.slug, extra));

const head = async (scope) => ({
  kind: scope.kind,
  slug: scope.kind === 'area' ? scope.area.slug : scope.cell,
  name: scope.kind === 'area' ? scope.area.name : scope.label,
  areaKind: scope.kind === 'area' ? scope.area.kind : 'ring',
  // A ring drawn round a town is still a town, and the kicker says so rather
  // than calling Maidstone a postcode.
  fromKind: scope.kind === 'ring' ? (scope.area?.kind ?? 'postcode') : null,
  minutes: scope.minutes ?? null, mode: scope.mode ?? null,
  cells: scope.cells ?? null,
  trail: await trail(scope),
});

// ---------------------------------------------------------------------------
// the levels
// ---------------------------------------------------------------------------

/** BO2m — select a country, and whether its travel times are worked out yet. */
router.get('/countries', requires('view_library'), async (_req, res, next) => {
  try {
    res.json({ countries: await index.countries(), refreshedAt: await index.statsAge() });
  } catch (err) { next(err); }
});

/** The five numbers, the breadcrumb and the ring's own facts, for any level. */
router.get('/area', requires('view_library'), async (req, res, next) => {
  try {
    const scope = await resolveWhere(req.query);
    if (scope.kind === 'none') return res.json({ kind: 'none' });
    if (scope.kind === 'unknown') return res.status(404).json({ error: 'no_area', message: 'Nothing here by that name yet.' });
    res.json({
      ...(await head(scope)),
      stats: await statsOf(scope, { category: req.query.cat ?? '', subcategory: req.query.sub ?? '' }),
      refreshedAt: await index.statsAge(),
      ringBands: BANDS,
      // Which ways of getting about the matrix can answer *here*.
      //
      // The chooser used to offer all three whatever was built, so tapping Walk
      // or Transit in a country with only a driving matrix gave an empty board
      // and nothing said why (17 Sep 2026, the verification audit). Building a
      // mode is a run, on Runs; this is the reading.
      modes: MODES,
      modesBuilt: await index.modesFor(scope),
    });
  } catch (err) { next(err); }
});

/** BO2a / BO2n — the same level cut by county, by city or by postcode district. */
router.get('/breakdown', requires('view_library'), async (req, res, next) => {
  try {
    const where = lower(req.query.where) || 'gb';
    const out = await index.breakdown(where, {
      by: req.query.by ?? 'county',
      sort: req.query.sort ?? 'searches',
      desc: req.query.desc !== '0',
      since: Number(req.query.since) || 30,
    });
    // `all` is how many there are at all, so a list that is a slice says so.
    res.json({ rows: out.rows, all: out.all, totals: await index.statsFor(where) });
  } catch (err) { next(err); }
});

/** BO2b — the coverage grid, towns and outcodes together. */
router.get('/coverage', requires('view_library'), async (req, res, next) => {
  try {
    const where = lower(req.query.where) || 'gb';
    const rows = await index.coverage(where);
    res.json({
      rows,
      towns: rows.filter((r) => r.kind === 'town').length,
      outcodes: rows.filter((r) => r.kind === 'postcode').length,
      // How many towns there are at all, so a list that is a slice says so.
      //
      // A town is parented to its county, never to the country (migration 145
      // keeps that hierarchy), so at country level `parent_slug = 'gb'` counted
      // nothing and the board fell back to the number of rows it had — "30 of
      // 30 towns" over a country with hundreds (Codex, 17 Sep 2026).
      allTowns: (await query(
        `select count(*)::int as n from localities l
          where l.kind = 'town'
            and case when $2 = '' then true
                     when exists (select 1 from localities c where c.slug = $1 and c.kind = 'country')
                       then l.country_code = upper($2)
                     else l.parent_slug = $1 end`,
        [where, (await index.areaBySlug(where))?.country_code ?? ''])).rows[0].n,
      refreshedAt: await index.statsAge(),
    });
  } catch (err) { next(err); }
});

/** BO2c / BO2o / BO2p — the taxonomy, with the counts left-joined onto it. */
router.get('/categories', requires('view_library'), async (req, res, next) => {
  try {
    const scope = await resolveWhere(req.query);
    if (scope.kind === 'none' || scope.kind === 'unknown') throw bad('Which area? Pass ?where=.');
    const rows = await index.categories(scope.kind === 'area' ? scope.area.slug : null, {
      refs: scope.kind === 'ring' ? scope.refs : null,
      category: req.query.cat ? String(req.query.cat) : null,
      since: Number(req.query.since) || 30,
    });
    // A category opened is its own level, so it prints the category's five
    // numbers rather than the area's (Codex, 17 Sep 2026).
    const scoped = { category: req.query.cat ? String(req.query.cat) : '', subcategory: '' };
    res.json({
      ...(await head(scope)), stats: await statsOf(scope, scoped),
      // The subcategories there are at all, so "9 of 9" can be printed.
      subcategories: (await query('select count(*)::int as n from shelf_subcategories where active')).rows[0].n,
      categories: rows, facts: FACTS,
      // `words`, not `by`. A ring's travel mode is carried in `by`, so the
      // words toggle sharing the name meant opening the Labels view — or the
      // Subcategories view — of a walking ring silently counted a driving one
      // (17 Sep 2026, the verification audit).
      labels: req.query.words === 'labels'
        ? await index.labels(scope.kind === 'area' ? scope.area.slug : null, { refs: scope.kind === 'ring' ? scope.refs : null })
        : null,
    });
  } catch (err) { next(err); }
});

/** BO2d — which providers have ever seen these places. */
router.get('/sources', requires('view_library'), async (req, res, next) => {
  try {
    const scope = await resolveWhere(req.query);
    if (scope.kind === 'none' || scope.kind === 'unknown') throw bad('Which area? Pass ?where=.');
    const out = await index.sources(scope.kind === 'area' ? scope.area.slug : null, { refs: scope.kind === 'ring' ? scope.refs : null });
    res.json({ ...(await head(scope)), stats: await statsOf(scope), ...out });
  } catch (err) { next(err); }
});

/** BO2e — the score distribution, staleness, and what is worth owning next. */
router.get('/quality', requires('view_library'), async (req, res, next) => {
  try {
    const scope = await resolveWhere(req.query);
    if (scope.kind === 'none' || scope.kind === 'unknown') throw bad('Which area? Pass ?where=.');
    const out = await index.quality(scope.kind === 'area' ? scope.area.slug : null, { refs: scope.kind === 'ring' ? scope.refs : null });
    res.json({ ...(await head(scope)), stats: await statsOf(scope), ...out });
  } catch (err) { next(err); }
});

/**
 * BO2f — the demand lens: the gaps ranked by what was actually searched for.
 *
 * This is the lens that stops the collection budget going on an area nobody asks
 * about, which is why Part A and Part D are one programme.
 */
router.get('/demand', requires('view_library'), async (req, res, next) => {
  try {
    const scope = await resolveWhere(req.query);
    if (scope.kind === 'none' || scope.kind === 'unknown') throw bad('Which area? Pass ?where=.');
    const since = Number(req.query.since) || 30;
    const slug = scope.kind === 'area' ? scope.area.slug : null;
    // A ring is scoped by the cells inside it, not by an area slug it has not
    // got: `null` made the predicate true for every search in the database, so a
    // thirty-minute ring showed the whole estate's demand under its own heading
    // (Codex, 17 Sep 2026).
    const cells = scope.kind === 'ring'
      ? (await reach.reachableCells(scope.cell, { minutes: scope.minutes, mode: travelMode(scope.mode) })).map((c) => c.to_cell)
      : scope.kind === 'area' && scope.area.kind === 'town'
        // A town's searches are not filed under the town. `whereOf` normalises
        // a town to its parent county on purpose — the county is the honest
        // grain for a point search — so a town lens asking for its own slug got
        // nothing at all (Codex, 17 Sep 2026). Its own cells are the answer.
        ? (await query(
          `select distinct pi.cell from place_index pi
             join place_areas pa on pa.venue_ref = pi.venue_ref
            where pa.area_slug = $1 and pi.cell is not null`, [scope.area.slug])).rows.map((r) => r.cell)
        : null;
    // A town whose places have no cell yet cannot be told apart from its county
    // at all, and zeros would read as "nobody asked". It reads the county's
    // figures and says whose they are (17 Sep 2026).
    const asCounty = scope.kind === 'area' && scope.area.kind === 'town' && !(cells ?? []).length
      ? (await index.areaBySlug(scope.area.parent_slug ?? '')) ?? null
      : null;
    // Everything under this area, not only this area.
    //
    // Searches are filed against a county, so Great Britain asking for
    // `area_slug = 'gb'` found only the handful nobody could place — its
    // counties' searches were all missing (Codex, 17 Sep 2026).
    // A country's counties do not carry `parent_slug` — the country was added
    // later (migration 145) and the hierarchy was left as it stood — so a
    // country's descendants are "every locality with this country code", and a
    // county's are itself plus the towns that name it.
    const slugs = scope.kind === 'area' && scope.area.kind !== 'town'
      ? (await query(
        scope.area.kind === 'country'
          ? `select slug from localities where country_code = upper($2) or slug = $1`
          // `$2` is unused here and still bound, because both branches take the
          // same two parameters and Postgres refuses a statement given more
          // than it names.
          : `select slug from localities where ($2 = $2) and (slug = $1 or parent_slug = $1)`,
        [scope.area.slug, scope.area.country_code ?? ''])).rows.map((r) => r.slug)
      : null;
    const { rows: everything } = await query(`
      select coalesce(s.subject, '') as subject,
             count(*)::int                                          as searches,
             count(*) filter (where s.empty)::int                    as empty,
             count(*) filter (where not s.empty and s.outcome = 'none')::int as no_click,
             count(*) filter (where s.outcome in ('clicked','saved'))::int   as no_trip
        from searches s
       where s.at > now() - ($1 || ' days')::interval
         and ($2::text[] is null or s.area_slug = any($2))
         and ($3::text[] is null or s.cell = any($3))
       group by 1 order by count(*) desc`,
    [String(since), asCounty ? [asCounty.slug] : slugs, asCounty ? null : cells]);
    // The four headline figures are of every subject, not of the forty the list
    // has room for.
    const totals = everything.reduce((t, r) => ({
      searches: t.searches + r.searches, empty: t.empty + r.empty,
      noClick: t.noClick + r.no_click, noTrip: t.noTrip + r.no_trip,
    }), { searches: 0, empty: 0, noClick: 0, noTrip: 0 });
    const rows = everything.slice(0, 40);
    const labels = new Map((await query('select key, label from shelf_subcategories').then((r) => r.rows)).map((r) => [r.key, r.label]));
    const catLabels = new Map((await query('select key, label from shelf_categories').then((r) => r.rows)).map((r) => [r.key, r.label]));
    // How many places there are per subject, which decides the fault.
    //
    // A ring has no area slug, so reading `area_stats` for one answered nothing
    // and every subject inside a ring was reported as "no places" — the wrong
    // one of the three faults, and the one that sends a collection budget
    // somewhere it is not needed (Codex, 17 Sep 2026). A ring counts its own
    // refs, the way the rest of its figures do.
    const known = new Map((scope.kind === 'ring'
      ? (await query(
        `select subcategory, count(*)::int as places from place_index
          where venue_ref = any($1) and subcategory is not null group by subcategory`, [scope.refs])).rows
      : (await query(
        `select subcategory, places from area_stats where area_slug = $1 and subcategory <> '' and source = '' and ownership = ''`,
        [slug ?? ''])).rows).map((r) => [r.subcategory, r.places]));
    res.json({
      ...(await head(scope)),
      since, totals,
      // Whose figures these are, where they are not this area's own. A point
      // search is filed against a county, so a town with no cells of its own
      // reads its county's and says so rather than showing nought.
      figuresFrom: asCounty ? { slug: asCounty.slug, name: asCounty.name, why: 'a search is recorded against a county' } : null,
      // How many subjects there are at all, so a list of forty says it is one.
      subjects: everything.length,
      rows: rows.map((r) => {
        const k = known.get(r.subject) ?? 0;
        const fault = faultOf({ searches: r.searches, empty: r.empty, noClick: r.no_click, noTrip: r.no_trip, known: k });
        return {
          subject: r.subject || null,
          label: r.subject ? (labels.get(r.subject) ?? catLabels.get(r.subject) ?? r.subject) : 'Anything',
          searches: r.searches, empty: r.empty, noClick: r.no_click, noTrip: r.no_trip,
          known: r.subject ? k : null,
          fault: fault.key, faultLabel: fault.label,
          shortFault: fault.key === 'no-places' && k ? 'Came back empty' : SHORT_FAULT[fault.key],
          owner: fault.owner, act: fault.act,
        };
      }),
    });
  } catch (err) { next(err); }
});

/**
 * BO2g — a town and its ring, read from the matrix rather than calculated.
 *
 * The facts at the bottom of that board are the point of the whole thing: one
 * row read, no distances computed, nothing spent.
 */
router.get('/ring', requires('view_library'), async (req, res, next) => {
  try {
    const scope = await resolveWhere({ ...req.query, within: req.query.within ?? 30 });
    if (scope.kind !== 'ring') throw bad('That is not somewhere a ring can start from.');
    const { rows } = await query(`
      select pi.subcategory, count(*)::int as known,
             count(*) filter (where pi.ownership = 'owned')::int as owned,
           count(*) filter (where pi.ownership = 'claimed')::int as claimed,
             count(*) filter (where pi.ready)::int as ready_count,
             avg(pi.data_score)::real as avg_score
        from place_index pi where pi.venue_ref = any($1) and pi.subcategory is not null
       group by pi.subcategory order by count(*) desc`, [scope.refs]);
    const labels = new Map((await query('select key, label from shelf_subcategories')).rows.map((r) => [r.key, r.label]));
    const nearest = new Map();
    for (const [ref, mins] of scope.minutesByRef) nearest.set(ref, mins);
    const { rows: near } = await query(
      `select subcategory, venue_ref from place_index where venue_ref = any($1) and subcategory is not null`, [scope.refs]);
    const best = new Map();
    for (const r of near) {
      const m = nearest.get(r.venue_ref);
      if (m == null) continue;
      if (!best.has(r.subcategory) || m < best.get(r.subcategory)) best.set(r.subcategory, m);
    }
    // Every subcategory, listed whether or not anything landed in it: a ring
    // with none of something is the finding, and "none within 90" says so.
    const all = (await query('select key, label from shelf_subcategories where active order by position')).rows;
    const held = new Map(rows.map((r) => [r.subcategory, r]));
    const searches = new Map((await query(
      `select subject, count(*)::int as n from searches
        where at > now() - interval '30 days' and cell = any($1) group by subject`,
      [(await reach.reachableCells(scope.cell, { minutes: scope.minutes, mode: travelMode(scope.mode) })).map((c) => c.to_cell)]
    )).rows.map((r) => [r.subject, r.n]));
    // Per mode: a driving ring must not print the walking build's timestamp.
    const built = (await query(
      'select max(at) as at, max(method) as method from cell_builds where from_cell = $1 and mode = $2',
      [scope.cell, travelMode(scope.mode)])).rows[0] ?? { at: null, method: null };
    // What answering this actually cost. The claim on this board is the whole
    // argument for the matrix, so it is measured rather than asserted: a ring
    // that started from a postcode reads the matrix and computes nothing; one
    // that started from a town name snaps to the nearest cell first, and that
    // snap is distances (Codex, 17 Sep 2026).
    const snapped = scope.area != null && !sectorOf(String(req.query.where ?? '').replace(/-/g, ' '));
    const matrixRows = (await reach.reachableCells(scope.cell, { minutes: scope.minutes, mode: travelMode(scope.mode) })).length;
    res.json({
      ...(await head(scope)),
      stats: await index.statsForRefs(scope.refs),
      rows: all.map((s) => {
        const h = held.get(s.key);
        return {
          key: s.key, label: s.label,
          known: h?.known ?? 0, owned: h?.owned ?? 0, claimed: h?.claimed ?? 0,
          ready: h ? (h.known ? Math.round((h.ready_count / h.known) * 100) : null) : null,
          avgScore: h?.avg_score == null ? null : Math.round(h.avg_score),
          searches: searches.get(s.key) ?? 0,
          nearest: best.has(s.key) ? best.get(s.key) : null,
        };
      // Every one of them, as the comment eleven lines up promises. The filter
      // that used to sit here dropped exactly the rows the board exists to
      // show: a ring with none of something, that nobody has searched for
      // either, is the emptiest gap there is (17 Sep 2026, the verification
      // audit).
      }),
      // What answering this cost, said plainly, because it is the argument.
      ring: {
        cell: scope.cell, cellLabel: labelOf(scope.cell),
        cellsInReach: scope.cells,
        cellsTotal: (await query('select count(*)::int as n from geo_cells')).rows[0].n,
        // One index range over `reach`, and that is the answer. The figure is
        // the rows that range returned, not a constant.
        rowsRead: matrixRows,
        // Nothing, from a postcode. From a town name, the one snap to the
        // nearest cell we hold — said rather than rounded away.
        distancesComputed: snapped ? 1 : 0,
        spendPence: 0,
        builtAt: built.at, builtMethod: built.method,
        // Estimated from distance, not routed (routes/reach.js). The screen says
        // so, because a date under "travel times worked out" reads as a road
        // network build otherwise.
        estimated: built.method !== 'osrm',
        // The ring is deliberately a few minutes generous, so a place at the
        // edge of its sector is offered rather than lost. Said out loud.
        edgeMinutes: EDGE_MINUTES,
      },
    });
  } catch (err) { next(err); }
});

/** BO2q — the places themselves. */
router.get('/places', requires('view_library'), async (req, res, next) => {
  try {
    const scope = await resolveWhere(req.query);
    if (scope.kind === 'none' || scope.kind === 'unknown') throw bad('Which area? Pass ?where=.');
    const sub = req.query.sub ? String(req.query.sub) : null;
    const rows = await index.places(scope.kind === 'area' ? scope.area.slug : null, {
      refs: scope.kind === 'ring' ? scope.refs : null,
      category: req.query.cat ? String(req.query.cat) : null,
      subcategory: sub,
      show: ['ready', 'not-ready', 'all'].includes(String(req.query.show)) ? String(req.query.show) : 'not-ready',
      q: req.query.q ? String(req.query.q) : null,
      missing: req.query.missing ? String(req.query.missing) : null,
      sort: String(req.query.sort ?? 'missing'),
      desc: req.query.desc !== '0',
    });
    const bar = sub ? (await index.bars()).get(sub) ?? [] : [];
    const scoped = { category: req.query.cat ? String(req.query.cat) : '', subcategory: sub ?? '' };
    const stats = await statsOf(scope, scoped);
    res.json({
      ...(await head(scope)),
      stats,
      // How many of this subcategory are not ready, so the count above the list
      // is "N of the M not ready" rather than "N of everything here".
      notReady: Math.max(0, stats.known - stats.readyCount),
      rows, facts: FACTS,
      // What this kind of place is judged on, so the column headers can explain
      // themselves rather than being six flat ticks.
      bar: bar.filter((b) => b.required),
      counted: bar.filter((b) => b.required).map((b) => b.fact),
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// one place
// ---------------------------------------------------------------------------

/**
 * BO2h / BO2r — one place, every field, where each came from, and what nobody
 * has asked yet.
 *
 * This is what removes the 404. The old `/api/admin/lookup/place` did not look a
 * place up at all: it re-ran the whole ring search and hunted for the ref in the
 * new results, against a twelve-hour in-process cache that every deploy wiped.
 * This reads the index.
 */
router.get('/place', requires('view_library'), async (req, res, next) => {
  try {
    const ref = String(req.query.ref ?? '').trim();
    if (!ref) throw bad('Which place? Pass its ref.');
    const { rows: [pi] } = await query('select * from place_index where venue_ref = $1', [ref]);
    if (!pi) return res.status(404).json({ error: 'not_indexed', message: 'Nothing indexed under that ref yet.' });

    const name = (await index.namesFor([ref])).get(ref) ?? { name: null, from: null };
    const { rows: [rec] } = await query('select * from place_records where venue_ref = $1', [ref]);
    // A harvested attraction's hours live on its detail row, not on an owned
    // record. `HELD_SQL` counts those, so a place could be `ready` in the index
    // and say "hours missing" on its own tab (Codex, 17 Sep 2026).
    const { rows: [atlasDetail] } = await query(
      `select d.visit->>'openingHours' as hours
         from attractions a join attraction_details d on d.attraction_id = a.id
        where (a.venue_ref = $1 or 'atlas:' || a.id::text = $1) and a.state <> 'rejected' limit 1`, [ref]);
    const { rows: [att] } = await query(
      `select * from attractions where (venue_ref = $1 or 'atlas:' || id::text = $1) and state <> 'rejected' limit 1`, [ref]);
    const { rows: [sweep] } = await query('select * from scout_places where venue_ref = $1 order by last_seen desc limit 1', [ref]);
    const { rows: seen } = await query('select source, source_place_id, first_seen, last_seen from place_index_sources where venue_ref = $1 order by source', [ref]);
    const { rows: facts } = await query('select field, source, value, licence, retention, fetched_at, expires_at from place_facts where venue_ref = $1 order by field', [ref]);
    const { rows: areas } = await query(
      `select l.slug, l.name, l.kind from place_areas pa join localities l on l.slug = pa.area_slug where pa.venue_ref = $1 order by l.kind`, [ref]);
    const { rows: pictures } = await query(`
      select ia.id, ia.source, ia.licence, ia.licence_url, ia.creator, ia.credit_line, ia.title,
             ia.source_page_url, ia.width, ia.height, ia.bytes, ia.fetched_at, ia.may_store, ia.moderation,
             li.role, li.subject_type as link_kind,
             -- An attraction's picture says the attraction; a place's says this
             -- place, which is the one we are standing on.
             (select a.name from attractions a where a.id::text = li.subject_id and li.subject_type = 'attraction') as on_place_name
        from image_links li join image_assets ia on ia.id = li.image_id
       where (li.subject_type = 'place' and li.subject_id = $1)
          or (li.subject_type = 'attraction' and li.subject_id = $2)
       order by li.position`, [ref, att?.id ?? '00000000-0000-0000-0000-000000000000']);
    const { rows: menus } = await query('select state, item_count, menu_url as url, read_at from place_menus where venue_ref = $1 order by read_at desc nulls last limit 1', [ref])
      .catch(() => ({ rows: [] }));
    const { rows: labelRows } = await query('select label from place_index_labels where venue_ref = $1 order by label', [ref]);
    const catLabel = new Map((await query('select key, label from shelf_categories')).rows.map((r) => [r.key, r.label]));
    const subLabel = new Map((await query('select key, label from shelf_subcategories')).rows.map((r) => [r.key, r.label]));

    const factOf = (field) => facts.find((f) => f.field === field) ?? null;
    const hoursVal = rec?.opening_hours ?? atlasDetail?.hours ?? null;
    // A source is a word, not a URL and not a sentence: the sentence belongs in
    // the row when it is opened, and a host is what the column has room for.
    const asWord = (v) => {
      if (!v) return null;
      const s = String(v);
      if (/^https?:\/\//i.test(s)) { try { return new URL(s).hostname.replace(/^www\./, ''); } catch { return 'their site'; } }
      return s;
    };
    const held = {
      // Approved, not merely keepable — the same condition `HELD_SQL` applies.
      // Reading only `may_store` here let this tab say a picture was held while
      // the score on the same page said it was not (Codex, 17 Sep 2026).
      picture: pictures.some((p) => p.may_store && p.moderation === 'approved'),
      what_it_is: Boolean(rec?.summary ?? att?.summary ?? rec?.curation?.summary),
      hours: Boolean(hoursVal),
      menu: menus[0]?.state === 'read',
      prices: Boolean(rec?.price_range),
      step_free: rec?.accessibility?.stepFree != null,
    };
    const bar = (await index.bars()).get(pi.subcategory) ?? [];
    const scored = scorePlace({ bar, held });

    // Every field a place can carry, whether or not we hold it. A dash is a hole
    // to fill; `n/a` is a fact this kind of place is not judged on.
    const judged = new Set(scored.parts.judged.map((j) => j.fact));
    // Whose values are ours to change.
    //
    // The open sources are on the list because their content is ours to keep
    // for good (CLAUDE.md): the atlas, Wikipedia, Wikidata, OpenStreetMap and
    // the venue's own published page. A sentence from Wikipedia that we could
    // not correct was the whole reason the curation column exists. A licensed
    // provider's value is never here — it changes when they change it, and a
    // copy of it we could overwrite would be a copy we may not keep.
    const OURS = new Set([
      'ours', 'own', 'curate', 'hand', 'claim',
      'atlas', 'wikipedia', 'wikidata', 'osm', 'openstreetmap', 'commons', 'their site', 'site',
    ]);
    const field = (key, label, value, source, checked, fact = null, editable = false, action = null, note = null, reference = null) => {
      const from = value == null ? null : asWord(source);
      const held = value != null;
      const counted = fact ? judged.has(fact) : null;
      return {
        key, label, value: value ?? null,
        // Nothing held, nothing to say about where it came from: a source beside
        // a dash reads as though we hold something we do not.
        source: from,
        // A fact this kind of place is not judged on has not been "never
        // checked" — there was never anything to check (Codex, 17 Sep 2026).
        checked: held ? checked ?? null : counted === false ? null : 'never',
        note, reference,
        counted,
        notCounted: fact ? !judged.has(fact) : false,
        // **Ours, so editable — and a hole is ours too.**
        //
        // The Source column's own tooltip says the rule: a provider's value
        // changes when they change it, and a copy of it we could overwrite
        // would be a copy we are not allowed to keep. So the flag follows where
        // the value came from.
        //
        // But a field we hold *nothing* for came from nobody, and requiring
        // `held` meant only a value that already existed could be edited —
        // "Also known as", the address, the prices, step-free and the telephone
        // number were all blank rows with no way to fill them in (Codex, 17 Sep
        // 2026). A hole with a run behind it offers the run; a hole without one
        // can be typed into.
        editable: editable && (!held || OURS.has(String(from ?? '').toLowerCase())),
        // A hole offers the thing that would fill it *and* the box to type it
        // in. It used to offer only one of the two, whichever way round the
        // flags fell (Codex, 17 Sep 2026, and again on the editability fix).
        action: held ? null : action,
      };
    };
    const record = [
      field('name', 'Name', name.name, name.from, rec?.updated_at ?? att?.updated_at ?? sweep?.last_seen ?? null, null, false,
            null, null, name.from === 'atlas' && att ? `attractions ${att.id}` : name.from === 'osm' && sweep ? `scout_places ${sweep.venue_ref}` : rec ? `place_records ${ref}` : null),
      field('aka', 'Also known as', rec?.curation?.aka ?? null, rec?.curation?.aka ? 'ours' : null, rec?.curated_at ?? null, null, true,
            null, rec?.curated_model ? `Curate · ${rec.curated_model}` : null, rec?.curated_at ? `curate run ${new Date(rec.curated_at).toISOString().slice(0, 10)} · field aka` : null),
      field('address', 'Address', rec?.address ?? factOf('address')?.value ?? null, rec?.address ? 'ours' : factOf('address')?.source ?? null, factOf('address')?.fetched_at ?? null, null, true,
            null, null, factOf('address') ? `place_facts ${ref} · address · ${factOf('address').source}` : rec ? `place_records ${ref} · address` : null),
      field('position', 'Position', pi.lat != null ? `${Number(pi.lat).toFixed(4)}, ${Number(pi.lng).toFixed(4)}` : null, 'ours', pi.indexed_at, null, false),
      field('outcode', 'Postcode area', areas.find((a) => a.kind === 'postcode')?.slug?.toUpperCase() ?? null, 'ours', pi.indexed_at, null, true),
      field('subcategory', 'Subcategory',
            pi.subcategory ? `${catLabel.get(pi.category) ?? pi.category} › ${subLabel.get(pi.subcategory) ?? pi.subcategory}` : null,
            'ours', null, null, true, null, null, pi.derived_by),
      // Our own words for this place, which is what every rule is written
      // against. Ours, and therefore ours to change.
      // Read-only. The words a place was filed by come from the shelving rules,
      // and the row used to offer an editor whose save the PATCH route refused
      // — every attempt a 400 (Codex, 17 Sep 2026). The rule is changed on
      // Categories, and the warning beside the shelf says how far that travels.
      field('labels', 'Labels', (labelRows.map((l) => l.label).join(' · ') || null), 'ours', pi.indexed_at, null, false),
      field('what_it_is', 'What it is', rec?.summary ?? att?.summary ?? null, rec?.summary_source ?? att?.summary_source ?? null, rec?.curated_at ?? null, 'what_it_is', true, 'write',
            null, rec?.curated_from?.length ? `read from ${rec.curated_from.join(', ')}` : null),
      field('hours', 'Opening hours', hoursVal,
            factOf('opening_hours')?.source ?? (rec?.opening_hours ? 'ours' : atlasDetail?.hours ? 'atlas' : null),
            factOf('opening_hours')?.fetched_at ?? null, 'hours', true, 'ask',
            null, factOf('opening_hours') ? `place_facts ${ref} · opening_hours · ${factOf('opening_hours').source}` : null),
      field('prices', 'Prices', rec?.price_range ?? null, rec?.price_range ? 'ours' : factOf('price_range')?.source ?? null, factOf('price_range')?.fetched_at ?? null, 'prices', true),
      field('step_free', 'Step-free', rec?.accessibility?.stepFree == null ? null : (rec.accessibility.stepFree ? 'yes' : 'no'), 'ours', rec?.updated_at ?? null, 'step_free', true),
      field('phone', 'Telephone', rec?.phone ?? null, rec?.phone ? 'ours' : factOf('phone')?.source ?? null, factOf('phone')?.fetched_at ?? null, null, true,
            null, null, factOf('phone') ? `place_facts ${ref} · phone · ${factOf('phone').source}` : null),
      field('website', 'Website', rec?.website ?? att?.website ?? sweep?.website ?? null, rec?.website ? 'ours' : factOf('website')?.source ?? (att?.website ? 'atlas' : sweep?.website ? 'osm' : null), factOf('website')?.fetched_at ?? null, null, true, 'find'),
      field('menu', 'Menu', menus[0]?.state === 'read' ? `${menus[0].item_count} dishes` : null, menus[0]?.url ? 'their site' : null, menus[0]?.read_at ?? null, 'menu', false, 'read',
            null, null, menus[0]?.url ?? null),
      field('busy', 'How busy', sweep?.count_band ?? rec?.count_band ?? null, 'ours', sweep?.scored_at ?? rec?.banded_at ?? null, null, true, 'ask',
            'Banded at the moment of the call. The figure it came from was never written down.'),
      field('accolades', 'Accolades', (att?.accolades ?? sweep?.accolades ?? []).map((a) => a.label ?? a.key ?? a).join(', ') || null, 'ours', att?.updated_at ?? null, null, false,
            null, 'A fact about who said what, published to be quoted — ours for good once found.'),
      field('designations', 'Designations', att?.heritage ?? null, att?.heritage ? 'Wikidata' : null, att?.updated_at ?? null, null, false),
    ];

    const asked = new Set(seen.map((s) => s.source));
    const unseen = index.SOURCES.filter((s) => !asked.has(s.key));
    res.json({
      ref,
      name: name.name, nameFrom: name.from,
      category: pi.category, subcategory: pi.subcategory, ownership: pi.ownership,
      score: pi.data_score, ready: pi.ready, scoreParts: pi.score_parts,
      oldestFact: pi.oldest_fact, seenBy: seen.length, lat: pi.lat, lng: pi.lng, cell: pi.cell,
      have: scored.parts.held.length, missingCount: scored.parts.missing.length,
      areas: areas.map((a) => ({ slug: a.slug, name: a.name, kind: a.kind })),
      sources: seen.map((s) => ({ source: s.source, id: s.source_place_id, firstSeen: s.first_seen, lastSeen: s.last_seen })),
      unseen: unseen.map((s) => ({ ...s, pence: s.key === 'google' ? 1.4 : null })),
      unseenFree: unseen.filter((s) => !s.paid).length,
      unseenPaid: unseen.filter((s) => s.paid).length,
      record,
      facts: facts.map((f) => ({ field: f.field, source: f.source, value: f.value, licence: f.licence, retention: f.retention, fetchedAt: f.fetched_at, expiresAt: f.expires_at })),
      pictures: pictures.map((p) => ({
        id: p.id, source: p.source, licence: p.licence, licenceUrl: p.licence_url, creator: p.creator,
        credit: p.credit_line, title: p.title, page: p.source_page_url, width: p.width, height: p.height,
        bytes: p.bytes, fetchedAt: p.fetched_at, owned: p.may_store, role: p.role,
        // Which place it is attached to, so the drawer's Pictures tab can print
        // it the way the Pictures board does. Without it the column read a
        // permanent dash (17 Sep 2026, the verification audit).
        onPlace: p.on_place_name ?? (p.link_kind === 'place' ? name.name : null),
      })),
      // Identifiers, and what it means when there is not one: `not asked` is not
      // the same fact as `no match`, and the two must stay visibly different.
      ids: [
        { key: 'ours', label: 'Ours', value: rec ? ref : att ? `atlas:${att.id}` : null, state: rec || att ? 'held' : 'none' },
        { key: 'osm', label: 'OSM', value: rec?.osm_ref ?? att?.osm_ref ?? (ref.startsWith('osm:') ? ref.slice(4) : null), state: asked.has('osm') ? 'held' : 'not-asked' },
        { key: 'google', label: 'Google', value: ref.startsWith('google:') ? ref.slice(7) : null, state: ref.startsWith('google:') ? 'held' : asked.has('google') ? 'no-match' : 'not-asked' },
        { key: 'wikidata', label: 'Wikidata', value: att?.wikidata_id ?? rec?.wikidata_id ?? null, state: (att?.wikidata_id ?? rec?.wikidata_id) ? 'held' : att ? 'no-match' : 'not-asked' },
        { key: 'tripadvisor', label: 'Tripadvisor', value: seen.find((s) => s.source === 'tripadvisor')?.source_place_id ?? null, state: asked.has('tripadvisor') ? 'held' : 'not-asked' },
        // A council's own reference for the place — BO2r lists it beside the
        // others (`WIN-PLAY-014`). Nothing holds one yet: no local-authority
        // register is switched on, so the row reads "not asked", which is the
        // finding rather than a gap (17 Sep 2026, the verification audit).
        {
          key: 'council', label: 'Council ref',
          value: factOf('council_ref')?.value ?? null,
          state: factOf('council_ref') ? 'held' : 'not-asked',
        },
      ],
      atlas: att ? { id: att.id, state: att.state, pinned: att.pinned, note: att.note, rank: att.rank, scoreParts: att.score_parts } : null,
    });
  } catch (err) { next(err); }
});

/** BO2r's History tab: which run changed what, from the audit trail. */
router.get('/place/history', requires('view_library'), async (req, res, next) => {
  try {
    const ref = String(req.query.ref ?? '').trim();
    if (!ref) throw bad('Which place? Pass its ref.');
    const { rows } = await query(
      `select at, action, actor_label, before, after from admin_audit
        where subject_id = $1 order by at desc limit 40`, [ref]);
    const { rows: calls } = await query(
      `select created_at, provider, purpose, estimated_cost_usd from provider_calls
        where units->>'ref' = $1 order by created_at desc limit 40`, [ref]);
    res.json({
      rows: [
        ...rows.map((r) => ({ at: r.at, what: r.action, who: r.actor_label, kind: 'edit' })),
        ...calls.map((c) => ({ at: c.created_at, what: `${c.provider} · ${c.purpose}`, who: null, kind: 'call', usd: Number(c.estimated_cost_usd ?? 0) })),
      ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 40),
    });
  } catch (err) { next(err); }
});

/**
 * Edit one of our own values.
 *
 * Only ours. A provider's column is never editable here — it changes when they
 * change it, and a field we could overwrite would be a copy of theirs that we
 * are not allowed to keep.
 */
const OURS = new Set(['aka', 'address', 'outcode', 'subcategory', 'what_it_is', 'hours', 'prices', 'step_free', 'phone', 'website', 'busy']);
router.patch('/place', requires('manage_library'), async (req, res, next) => {
  try {
    const ref = String(req.body?.ref ?? '').trim();
    const key = String(req.body?.field ?? '').trim();
    const value = req.body?.value ?? null;
    if (!ref || !OURS.has(key)) throw bad('That field is not ours to change.');
    const before = (await query('select * from place_records where venue_ref = $1', [ref])).rows[0] ?? null;
    const COLUMN = { address: 'address', what_it_is: 'summary', hours: 'opening_hours', prices: 'price_range', phone: 'phone', website: 'website' };
    if (COLUMN[key]) {
      await query(
        `insert into place_records (venue_ref, ${COLUMN[key]}, updated_at) values ($1,$2, now())
         on conflict (venue_ref) do update set ${COLUMN[key]} = excluded.${COLUMN[key]}, updated_at = now()`, [ref, value]);
      if (key === 'what_it_is') await query(`update place_records set summary_source = 'ours' where venue_ref = $1`, [ref]);
    } else if (key === 'step_free') {
      // Three states, not two: yes, no, and nobody has looked.
      //
      // Every value that was not `true` or `yes` became a definite "no",
      // including an empty one — so an administrator could not remove a
      // step-free fact that was wrong. Clearing it recorded the opposite claim,
      // kept the fact counted as held, and left the score saying so (Codex,
      // 17 Sep 2026).
      const said = value == null ? '' : String(value).trim().toLowerCase();
      if (said === '') {
        await query(
          `update place_records set accessibility = accessibility - 'stepFree', updated_at = now()
            where venue_ref = $1`, [ref]);
      } else if (['yes', 'no', 'true', 'false'].includes(said)) {
        const yes = said === 'yes' || said === 'true';
        await query(
          `insert into place_records (venue_ref, accessibility, updated_at) values ($1, jsonb_build_object('stepFree', $2::boolean), now())
           on conflict (venue_ref) do update set accessibility = place_records.accessibility || jsonb_build_object('stepFree', $2::boolean), updated_at = now()`,
          [ref, yes]);
      } else throw bad('Step-free is yes, no, or empty for "nobody has looked".');
    } else if (key === 'aka') {
      await query(
        `insert into place_records (venue_ref, curation, curated_at, updated_at) values ($1, jsonb_build_object('aka', $2::text), now(), now())
         on conflict (venue_ref) do update set curation = coalesce(place_records.curation, '{}'::jsonb) || jsonb_build_object('aka', $2::text), curated_at = now(), updated_at = now()`,
        [ref, value == null ? null : String(value)]);
    } else if (key === 'subcategory') {
      // By key, or by the words the row prints. The record shows
      // "Food › Restaurants" and the editor sends back what it was shown, so a
      // save of the unchanged value answered "No such subcategory" and there
      // was no way to make the edit without knowing a hidden database key
      // (Codex, 17 Sep 2026).
      const said = String(value ?? '').split('›').pop().trim();
      const { rows: [sub] } = await query(
        `select key, category_key from shelf_subcategories
          where key = $1 or lower(label) = lower($2) limit 1`, [String(value), said]);
      if (!sub) throw bad('No such subcategory.');
      await query(`update place_index set subcategory = $2, category = $3, derived_by = 'hand' where venue_ref = $1`, [ref, sub.key, sub.category_key]);
    } else if (key === 'outcode') {
      // Written where a rebuild will read it again.
      //
      // `place_areas` is derived: the rebuild deletes it and recreates it from
      // the attractions, the sweep and our own records — so a correction made
      // only there was thrown away the next time anybody pressed Rebuild, and
      // the wrong outcode came back (Codex, 17 Sep 2026). The owned record's
      // postcode is where a rebuild takes it from, so that is where it goes,
      // and `place_areas` is updated now so the boards do not wait.
      await query(
        `insert into place_records (venue_ref, postcode, updated_at) values ($1,$2, now())
         on conflict (venue_ref) do update set postcode = excluded.postcode, updated_at = now()`,
        [ref, value ? String(value).toUpperCase() : null]);
      await query('delete from place_areas pa using localities l where l.slug = pa.area_slug and pa.venue_ref = $1 and l.kind = $2', [ref, 'postcode']);
      if (value) await query('insert into place_areas (venue_ref, area_slug) values ($1,$2) on conflict do nothing', [ref, lower(value)]);
    } else if (key === 'busy') {
      // A sweep-only place has no owned record yet, and an UPDATE against no row
      // reported success while changing nothing (Codex, 17 Sep 2026).
      await query(
        `insert into place_records (venue_ref, count_band, updated_at) values ($1,$2, now())
         on conflict (venue_ref) do update set count_band = excluded.count_band, updated_at = now()`,
        [ref, value]);
    }
    // Writing a fact of our own onto a place is what "owned" means.
    //
    // Every branch above except the subcategory and the outcode puts a value in
    // `place_records`, and a place we hold our own research on is not
    // "identified" any more. Left alone, the rollups still counted it as one
    // and paid collection went on thinking it was worth a call (Codex, 17 Sep
    // 2026).
    //
    // Not the busy band, though: that is a judgement made *about* a provider's
    // rating at the moment of the call, not a fact of our own — and the rule
    // the rebuild asks does not count it, so marking the place owned here would
    // be undone by the next rebuild (17 Sep 2026, the verification audit). One
    // definition, asked the same way in every place that asks it.
    //
    // Through `noteOwned`, which is the one path that claims ownership: it
    // writes the `own` source row as well, and without that the sources lens
    // said we had never researched the place and the free-collection window
    // treated it as never asked (Codex, 17 Sep 2026). The outcode counts, now
    // that it lands on the record the rebuild reads.
    // Asked from scratch rather than nudged upward: clearing a place's only
    // owned field has to be able to take the ownership back down, and
    // `noteOwned` only ever moves it up (Codex, 17 Sep 2026).
    if (key !== 'subcategory') await ownedPlaces.settleOwnership(ref);
    // Scored *and* counted. The edit can change what a place is judged on, or
    // which area or shelf it is in, and the boards read `area_stats` — so
    // rescoring alone left every headline stale until somebody pressed Refresh
    // (Codex, 17 Sep 2026).
    await index.rescore({ refs: [ref] });
    await index.refreshStats();
    await writeAudit({ ...actor(req), action: 'place.edit', subjectType: 'place', subjectId: ref, subjectLabel: key, before: { [key]: before?.[COLUMN[key]] ?? null }, after: { [key]: value } });
    res.json({ ok: true, ref, field: key });
  } catch (err) { next(err); }
});

/**
 * How far a change to the shelf would travel, before it travels.
 *
 * Owner's rule, kept from the old inspector: editing a category "opens a
 * sentence, not a dropdown" and says how many places and how many counties the
 * rule catches. To change only this place, pin it.
 */
router.get('/place/reach', requires('view_library'), async (req, res, next) => {
  try {
    const ref = String(req.query.ref ?? '').trim();
    const sub = String(req.query.sub ?? '').trim();
    if (!ref) throw bad('Which place?');
    const { rows: [pi] } = await query('select derived_by, subcategory from place_index where venue_ref = $1', [ref]);
    const rule = pi?.derived_by ?? null;
    if (!rule || !rule.startsWith('rule:')) return res.json({ rule: null, places: 1, counties: 1, onlyThis: true });
    // Distinct places and distinct counties. Counting the join rows made a
    // place in three areas three places, and the county filter sat in the join
    // condition where it filtered nothing (Codex, 17 Sep 2026).
    const { rows: [n] } = await query(`
      select count(distinct pi.venue_ref)::int as places,
             count(distinct l.slug)::int as counties
        from place_index pi
        left join place_areas pa on pa.venue_ref = pi.venue_ref
        left join localities l on l.slug = pa.area_slug and l.kind = 'county'
       where pi.derived_by = $1`, [rule]);
    res.json({ rule: rule.slice(5), places: n.places, counties: n.counties, onlyThis: false, to: sub || null });
  } catch (err) { next(err); }
});


/**
 * BO2h — ours beside each provider's, field by field.
 *
 * Only the *ours* column is editable. A provider's column changes when they
 * change it, and a copy of it we could overwrite would be a copy we are not
 * allowed to keep in the first place.
 *
 * It spends: one Place Details call per place, held in memory for six hours and
 * attributed in `provider_calls` like every other outbound call. The screen says
 * what it costs before the button is pressed.
 */
router.get('/place/compare', requires('view_library'), async (req, res, next) => {
  try {
    const ref = String(req.query.ref ?? '').trim();
    if (!ref) throw bad('Which place? Pass its ref.');
    const { rows: [pi] } = await query('select * from place_index where venue_ref = $1', [ref]);
    if (!pi) return res.status(404).json({ error: 'not_indexed', message: 'Nothing indexed under that ref yet.' });
    const household = await currentHousehold();
    // Looking is `view_library`; **spending is not**. A live detail call is a
    // paid call whoever opened the screen, so without `manage_library` the
    // provider columns read "not asked" rather than quietly billing (Codex,
    // 17 Sep 2026).
    const maySpend = can(req, 'manage_library');
    const named = (await index.namesFor([ref])).get(ref) ?? { name: null };

    // Ours: the owned record first, because it is the one researched from the
    // open web; the atlas or the sweep if that is all we hold.
    const { rows: [rec] } = await query('select * from place_records where venue_ref = $1', [ref]);
    // A harvested attraction's hours live on its detail row, not on an owned
    // record. `HELD_SQL` counts those, so a place could be `ready` in the index
    // and say "hours missing" on its own tab (Codex, 17 Sep 2026).
    const { rows: [atlasDetail] } = await query(
      `select d.visit->>'openingHours' as hours
         from attractions a join attraction_details d on d.attraction_id = a.id
        where (a.venue_ref = $1 or 'atlas:' || a.id::text = $1) and a.state <> 'rejected' limit 1`, [ref]);
    const { rows: [att] } = await query(
      `select * from attractions where (venue_ref = $1 or 'atlas:' || id::text = $1) and state <> 'rejected' limit 1`, [ref]);
    const { rows: [sweep] } = await query('select * from scout_places where venue_ref = $1 order by last_seen desc limit 1', [ref]);
    // An empty `place_records` row does not count as ours.
    //
    // `ensureRecord` makes one the moment a household touches a place, and
    // before the research runs — so any such row won this and the comparison
    // labelled the database's own bookkeeping "Owned record" while suppressing
    // an atlas or sweep record that actually held the facts (Codex, 17 Sep
    // 2026). The same question the index asks.
    // The same question the index asks, from the same list: a record holding
    // only a name is a place we have noticed, and treating it as ours
    // suppressed a richer atlas or sweep record (Codex, 17 Sep 2026).
    const ours = holdsAnOwnedFact(rec) ? rec : null;
    const mine = ours
      ? { source: 'own', fields: Object.fromEntries(Object.entries(ours).filter(([, v]) => v != null)) }
      : att ? { source: 'atlas', fields: { name: att.name, summary: att.summary, website: att.website, lat: att.lat, lng: att.lng, wikidata_id: att.wikidata_id, wikipedia_url: att.wikipedia_url, crowd_band: att.crowd_band, count_band: att.count_band, epic_score: att.epic_score } }
      : sweep ? { source: 'sweep', fields: { name: sweep.name, website: sweep.website, lat: sweep.lat, lng: sweep.lng, cuisines: sweep.cuisines, crowd_band: sweep.crowd_band, count_band: sweep.count_band, epic_score: sweep.epic_score } }
      : null;
    const columns = [{ key: 'ours', label: mine ? OUR_LABEL[mine.source] ?? mine.source : 'Ours', note: mine ? null : 'we hold none', fields: mine?.fields ?? null }];

    // Google: by identifier when we hold one, else matched by name and distance.
    let google = { key: 'google', label: 'Google', note: null, fields: null, id: null, how: 'none' };
    if (!googleSource.enabled()) google.note = 'not switched on';
    else if (!maySpend) google.note = 'not asked';
    else {
      let id = ref.startsWith('google:') ? ref.slice(7) : (await matchesFor([ref], 'google')).get(ref) ?? null;
      let how = id ? 'by its Google identifier' : null;
      // The ceiling, before either call.
      //
      // Both the match and the detail are billed, and this screen asked for
      // them without consulting it at all — so the ceiling the Runs board calls
      // hard could be walked through by opening a comparison (Codex, 17 Sep
      // 2026). The Tripadvisor column below has always claimed its locations;
      // this is the same rule for money. Two calls where a match is needed,
      // one where we already hold the identifier.
      const wants = id ? DETAIL_PENCE : DETAIL_PENCE + MATCH_PENCE;
      const room = await roomToSpend(Math.round(wants), { holder: 'compare' });
      if (!room.ok) {
        google.note = `over this month's ceiling · ${money(room.leftPence)} left`;
      } else try {
        if (!id && req.query.match === '1') {
          try {
            const m = await googleMatchFor({ venueRef: ref, name: named.name, lat: pi.lat, lng: pi.lng, householdId: household.id, strict: true });
            id = m?.id ?? null; how = id ? 'matched by name and distance' : null;
          } catch (err) { if (err?.provider !== 'google') throw err; google.note = whySourceFailed('google', err); }
        }
        if (google.note) { /* said in plain words above */ }
        else if (id) {
          try { google = { ...google, id, how, fields: await detailFor('google', id, household.id), note: `${how} · fetched live` }; }
          catch (err) { google = { ...google, id, how, note: whySourceFailed('google', err) }; }
        } else google.note = req.query.match === '1' ? 'no match' : 'not asked';
      } finally { await releaseSpend(room.reservation); }
    }
    columns.push(google);

    // Tripadvisor: only where a ranking run has already made the join. A view is
    // two billed locations, so it is not made on the off-chance.
    let ta = { key: 'tripadvisor', label: 'Tripadvisor', note: null, fields: null, id: null };
    if (!tripadvisorSource.enabled()) ta.note = 'not switched on';
    else if (!maySpend) ta.note = 'not asked';
    else {
      const id = ref.startsWith('tripadvisor:') ? ref.slice(12) : (await matchesFor([ref], 'tripadvisor')).get(ref) ?? null;
      if (!id) ta.note = 'not asked';
      else {
        // The monthly ceiling, here as well. Collect claims its locations
        // before it asks, and this comparison did not — so once the allowance
        // was gone, every uncached comparison went on billing two locations
        // past a cap the Runs board calls hard (Codex, 17 Sep 2026).
        const room = await tripadvisorRoom(TA_UNITS_PER_VIEW);
        if (!room.granted) ta.note = `over the monthly ceiling · ${room.left} location${room.left === 1 ? '' : 's'} left`;
        else {
          try { ta = { ...ta, id, fields: await detailFor('tripadvisor', id, household.id), note: 'fetched live · two locations billed a view' }; }
          catch (err) { ta = { ...ta, id, note: whySourceFailed('tripadvisor', err) }; }
          finally { await releaseSpend(room.reservation); }
        }
      }
    }
    columns.push(ta);

    const rows = lineUp(Object.fromEntries(columns.map((c) => [c.key, c.fields])));
    for (const c of columns) {
      c.of = rows.filter((r) => r.keys[c.key]).length;
      c.filled = rows.filter((r) => r.keys[c.key] && !blank(r.cells[c.key])).length;
      // Four different facts, and the board insists they stay visibly apart: we
      // hold it, we never asked, we asked and there is no such place, or the
      // source is not switched on here (Codex, 17 Sep 2026).
      c.state = c.fields ? 'held'
        : c.note === 'not switched on' ? 'off'
        : c.note === 'no match' ? 'no-match'
        : c.key === 'ours' ? 'no-match' : 'not-asked';
    }
    // Where *our* version of each field came from, and when it was last checked.
    // A column-wide note printed on every row said "ours" against values that
    // were OpenStreetMap's (Codex, 17 Sep 2026).
    const prov = rec?.provenance ?? {};
    const { rows: held } = await query(
      'select field, source, fetched_at from place_facts where venue_ref = $1', [ref]);
    const factOf = (field) => held.find((f) => f.field === field) ?? null;
    res.json({
      ref, name: named.name, columns,
      rows: rows.map((r) => {
        const key = r.keys.ours;
        const f = key ? factOf(key) : null;
        const from = key
          ? (prov[key]?.source ?? f?.source ?? (mine ? OUR_SOURCE[mine.source] : null))
          : null;
        return {
          ...r,
          label: FACT_WORD[r.key] ?? null,
          from: key && !blank(r.cells.ours)
            ? [from, f?.fetched_at ? `${Math.max(1, Math.round((Date.now() - new Date(f.fetched_at).getTime()) / 2_592_000_000))} mo ago` : null].filter(Boolean).join(' · ') || 'ours'
            : key ? 'we hold none' : null,
          // Ours, so editable — and "ours" means where the value actually came
          // from, not a list of field names. The record tab already decided it
          // that way; two tabs with two answers is worse than either (Codex,
          // 17 Sep 2026).
          editable: Boolean(key && OURS_FIELDS.includes(key) && !blank(r.cells.ours)
            && OUR_HANDS.has(String(from ?? '').toLowerCase())),
        };
      }),
      ours: OURS_FIELDS,
      // How far a change to the shelf would travel, said on this board too.
      shelf: { subcategory: pi.subcategory, category: pi.category, derivedBy: pi.derived_by },
    });
  } catch (err) { next(err); }
});

/** Which of the compared rows are ours, and therefore the only editable ones. */
const OURS_FIELDS = ['address', 'website', 'summary', 'opening_hours', 'price_range', 'phone', 'curation', 'crowd_band', 'count_band'];
const OUR_SOURCE = { own: 'ours', atlas: 'the atlas', sweep: 'the sweep' };
/** Where a value has to have come from for us to be allowed to change it. */
const OUR_HANDS = new Set(['ours', 'own', 'curate', 'hand', 'claim']);

/**
 * A field said the way a household would say it.
 *
 * The board's Fact column is "one field a household would expect to see on the
 * place" — Name, Address, Opening hours, How busy — not the column names the
 * tables happen to use (Codex, 17 Sep 2026).
 */
const FACT_WORD = {
  name: 'Name', address: 'Address', lat: 'Position', lng: 'Position', postcode: 'Postcode',
  opening_hours: 'Opening hours', website: 'Website', phone: 'Telephone', email: 'E-mail',
  summary: 'What it is', image_url: 'Picture we own', photos: 'Pictures they hold',
  crowd_band: 'How well thought of', count_band: 'How busy', rating: 'How well thought of', ratingCount: 'How busy',
  price_range: 'Prices', priceLevel: 'Prices', cuisines: 'What it serves', experiences: 'What it is for',
  dietary_options: 'Diets', good_for_children: 'Good for children', accessibility: 'Getting in',
  menu_url: 'Menu', menu_label: 'Menu', booking_url: 'Booking', socials: 'Where else they are',
  osm_ref: 'OpenStreetMap', wikidata_id: 'Wikidata', wikipedia_url: 'Wikipedia',
  curation: 'What we wrote', epic_score: 'Our score', category: 'Shelf', reviews: 'Reviews',
  openNow: 'Open now', mapsUrl: 'On their map', aiSummary: 'Their summary', reviewSummary: 'Their summary of reviews',
};

/**
 * BO2r's "What each source returned" — literally the fields we get.
 *
 * A source that was never asked is listed as `not asked`, never as empty: the
 * two are different facts and the screen must keep them visibly apart.
 */
router.get('/place/raw', requires('view_library'), async (req, res, next) => {
  try {
    const ref = String(req.query.ref ?? '').trim();
    if (!ref) throw bad('Which place? Pass its ref.');
    const { rows: facts } = await query(
      'select field, source, value, licence, retention, fetched_at, expires_at from place_facts where venue_ref = $1 order by source, field', [ref]);
    const { rows: seen } = await query('select source, source_place_id, first_seen, last_seen from place_index_sources where venue_ref = $1', [ref]);
    const asked = new Set(seen.map((s) => s.source));
    const bySource = new Map();
    for (const f of facts) {
      if (!bySource.has(f.source)) bySource.set(f.source, []);
      bySource.get(f.source).push({ field: f.field, value: f.value, licence: f.licence, retention: f.retention, fetchedAt: f.fetched_at, expiresAt: f.expires_at });
    }
    res.json({
      ref,
      sources: index.SOURCES.map((s) => ({
        key: s.key, label: s.label, explain: s.explain,
        state: !asked.has(s.key) ? 'not-asked' : (bySource.get(s.key)?.length ? 'held' : 'no-match'),
        id: seen.find((x) => x.source === s.key)?.source_place_id ?? null,
        lastSeen: seen.find((x) => x.source === s.key)?.last_seen ?? null,
        fields: bySource.get(s.key) ?? [],
      })),
    });
  } catch (err) { next(err); }
});

/**
 * Write these places up ourselves. Free, and nothing here is a provider's.
 *
 * `own.js` researches a place from its own published page, the open
 * encyclopedias and OpenStreetMap — never from a provider's reviews — and what
 * it finds lands in `place_records`, which is ours to keep (CLAUDE.md, and
 * Technical Constraints §13.10). This is the *Curate these N · free* action on
 * every board that has a selection.
 */
async function curateThese(refs, householdId) {
  {
    const household = { id: householdId };
    // What we already know about each place, so the research has a name and a
    // point to ask the open map with. Without a seed, `own.js` falls back to one
    // billed Google request per place to find out what it is looking at — which
    // would make a button labelled *free* spend money (Codex, 17 Sep 2026).
    const named = await index.namesFor(refs);
    const { rows: known } = await query(`
      select pi.venue_ref, pi.lat, pi.lng, pi.subcategory,
             coalesce(r.website, a.website, sp.website) as website,
             -- The street, and only the street: an attraction's name is not an
             -- address, and passing it as one gave the matchers the name twice
             -- (Codex, 17 Sep 2026).
             --
             -- In own.js's own order of preference — the venue's own page,
             -- then the open map, then a reverse geocode — and only facts that
             -- have not expired, because a fact past its retention is one we
             -- may no longer compose from.
             coalesce(r.address, (select pf.value #>> '{}' from place_facts pf
                                   where pf.venue_ref = pi.venue_ref and pf.field = 'address'
                                     and pf.expires_at is null
                                   order by case pf.source when 'site' then 0 when 'osm' then 1
                                                           when 'nominatim' then 2 else 3 end
                                   limit 1)) as address,
             (select l.name from place_areas pa join localities l on l.slug = pa.area_slug
               where pa.venue_ref = pi.venue_ref and l.kind = 'town' limit 1) as locality
        from place_index pi
        left join place_records r on r.venue_ref = pi.venue_ref
        left join attractions a on (a.venue_ref = pi.venue_ref or 'atlas:' || a.id::text = pi.venue_ref) and a.state <> 'rejected'
        left join lateral (select website from scout_places s where s.venue_ref = pi.venue_ref limit 1) sp on true
       where pi.venue_ref = any($1)`, [refs]);
    const seedOf = new Map(known.map((k) => [k.venue_ref, k]));

    let started = 0;
    const refused = [];
    for (const ref of refs) {
      const k = seedOf.get(ref);
      const name = named.get(ref)?.name ?? null;
      if (!name || k?.lat == null) {
        // Nothing of ours says which place this is, and finding out costs a
        // call. That is a collection run, not this one.
        refused.push({ ref, why: 'we hold no name or position to go looking with' });
        continue;
      }
      try {
        await enrich(ref, {
          householdId: household.id,
          // The address goes in too: `seedFor` returns a supplied seed whole as
          // soon as it has a name and a point, so anything left out is lost —
          // and the street is what tells two branches of one group apart
          // (Codex, 17 Sep 2026).
          seed: { name, lat: k.lat, lng: k.lng, website: k.website, locality: k.locality, address: k.address, category: k.subcategory },
          // Asked again, but never erasing: a source that happens to answer with
          // nothing is not evidence that what it said last time was wrong, and
          // `force` alone would throw the old facts away (Codex, 17 Sep 2026).
          force: true, replace: false, paid: false,
        });
        started += 1;
      } catch (err) { refused.push({ ref, why: whySourceFailed(err?.provider ?? 'own', err) }); }
    }
    return { started, refused };
  }
}

router.post('/curate', requires('manage_library'), async (req, res, next) => {
  try {
    const refs = (Array.isArray(req.body?.refs) ? req.body.refs : []).map(String).filter(Boolean).slice(0, 50);
    if (!refs.length) throw bad('Nothing selected.');
    const household = await currentHousehold();
    const out = await curateThese(refs, household.id);
    await index.rescore();
    await index.refreshStats();
    res.json({ ...out, spentPence: 0 });
  } catch (err) { next(err); }
});

/**
 * Ask the paid sources about these places, and say what it cost.
 *
 * One Place Details call each, attributed in `provider_calls` like every other
 * outbound call. The figures it reads are banded at the moment of the call and
 * the numbers thrown away (`domain/scoring.js`); what is kept is the identifier
 * and our own word for it.
 */
async function askThese(refs, householdId) {
  {
    const household = { id: householdId };
    const named = await index.namesFor(refs);
    const { rows: pos } = await query('select venue_ref, lat, lng from place_index where venue_ref = any($1)', [refs]);
    const at = new Map(pos.map((p) => [p.venue_ref, p]));
    let asked = 0;
    const refused = [];
    /**
     * The names, for this screen and no longer.
     *
     * A provider's name is rented: it is handed back so the rows the back office
     * is looking at stop being bare identifiers, and it is **not written down**
     * (CLAUDE.md). What *is* kept is ours — the band, which is a judgement made
     * at the moment of the call, and the identifier, so the next question does
     * not have to be matched again.
     */
    const names = [];
    for (const ref of refs) {
      try {
        const id = ref.startsWith('google:') ? ref.slice(7) : (await googleMatchFor({
          venueRef: ref, name: named.get(ref)?.name ?? null,
          lat: at.get(ref)?.lat ?? null, lng: at.get(ref)?.lng ?? null,
          householdId: household.id, strict: true,
        }))?.id ?? null;
        if (!id) {
          // Asked, and there is no such place there. Without a row the place
          // read "not asked" for ever, sailed past the twelve-month window on
          // every collection, and was quoted as spending a match call each time
          // — while `googleMatchFor` was answering out of its remembered miss
          // (Codex, 17 Sep 2026). A row with no identifier is exactly the
          // second of the two states the board keeps apart.
          await index.noteMany([{ ref }], { source: 'google' });
          refused.push({ ref, why: 'no match' });
          continue;
        }
        const detail = await detailFor('google', id, household.id);
        // Banded here, and the figures go no further: `crowdBand` and
        // `countBand` are the only things that leave this block, and the rating
        // and the review count die with the response (domain/scoring.js).
        const crowd = crowdBand(detail?.rating, detail?.ratingCount);
        const count = countBand(detail?.ratingCount);
        if (crowd || count) {
          await query(
            `insert into place_records (venue_ref, crowd_band, count_band, banded_at, updated_at)
             values ($1,$2,$3, now(), now())
             on conflict (venue_ref) do update
                set crowd_band = coalesce(excluded.crowd_band, place_records.crowd_band),
                    count_band = coalesce(excluded.count_band, place_records.count_band),
                    banded_at = now(), updated_at = now()`,
            [ref, crowd, count]);
        }
        // The identifier goes on the row it belongs to, not in the options —
        // `noteMany` reads it per place (Codex, 17 Sep 2026).
        await index.noteMany([{ ref, sourceId: id }], { source: 'google' });
        if (detail?.name) names.push({ ref, name: detail.name });
        asked += 1;
      } catch (err) {
        if (err?.provider !== 'google') throw err;
        refused.push({ ref, why: whySourceFailed('google', err) });
      }
    }
    return { asked, refused, names };
  }
}

/**
 * The same question, asked of Tripadvisor.
 *
 * Kept apart from `askThese` rather than folded into it, because the two are not
 * interchangeable: Tripadvisor has a hard monthly ceiling counted in calls
 * (`TRIPADVISOR_CAP`) where Google's is counted in money, and a Tripadvisor view
 * bills two locations. Choosing Tripadvisor on the Collect drawer used to run
 * Google instead — the same money, from the wrong provider, silently (Codex,
 * 17 Sep 2026).
 */
async function askTripadvisor(refs, householdId) {
  const matched = await matchesFor(refs, 'tripadvisor');
  let asked = 0;
  const refused = [];
  const names = [];
  for (const ref of refs) {
    const id = ref.startsWith('tripadvisor:') ? ref.slice(12) : matched.get(ref) ?? null;
    // No join, no call: a view is not spent looking for a place we have never
    // matched. The ranking run is what makes the join.
    if (!id) { refused.push({ ref, why: 'no match' }); continue; }
    try {
      const detail = await detailFor('tripadvisor', id, householdId);
      const crowd = crowdBand(detail?.rating, detail?.ratingCount);
      const count = countBand(detail?.ratingCount);
      if (crowd || count) {
        await query(
          `insert into place_records (venue_ref, crowd_band, count_band, banded_at, updated_at)
           values ($1,$2,$3, now(), now())
           on conflict (venue_ref) do update
              set crowd_band = coalesce(excluded.crowd_band, place_records.crowd_band),
                  count_band = coalesce(excluded.count_band, place_records.count_band),
                  banded_at = now(), updated_at = now()`,
          [ref, crowd, count]);
      }
      await index.noteMany([{ ref, sourceId: id }], { source: 'tripadvisor' });
      if (detail?.name) names.push({ ref, name: detail.name });
      asked += 1;
    } catch (err) {
      if (err?.provider !== 'tripadvisor') throw err;
      refused.push({ ref, why: whySourceFailed('tripadvisor', err) });
    }
  }
  return { asked, refused, names };
}

/**
 * How many Tripadvisor calls this month has left — and a claim on them.
 *
 * The same shape as `roomToSpend`, and for the same reason: two runs reading
 * the same unlocked count both found room near the cap and between them went
 * past it (Codex, 17 Sep 2026). This is the one ceiling that is contractual
 * rather than budgetary, so it is the one that least tolerates a race.
 *
 * `want: 0` asks without claiming, for a screen that only wants to say how many
 * are left.
 */
export async function tripadvisorRoom(want = 0) {
  return withTransaction(async (client) => {
    await client.query(
      `insert into app_settings (key, value) values ('collect.tripadvisor_cap', $1::text::jsonb)
       on conflict (key) do nothing`, [String(TRIPADVISOR_CAP)]);
    await client.query(
      `select value from app_settings where key = 'collect.tripadvisor_cap' for update`);
    await client.query('delete from spend_reservations where expires_at < now()');
    // The units they bill for, not the rows we wrote. One Tripadvisor view is
    // two billed locations, so counting rows let sixty views spend a hundred
    // and twenty of an allowance the board said was a hundred and twenty
    // (Codex, 17 Sep 2026).
    const { rows: [made] } = await client.query(
      `select coalesce(sum(greatest(coalesce((units->>'tripadvisor')::int, 1), 1)), 0)::int as calls
         from provider_calls
        where provider = 'tripadvisor' and created_at > date_trunc('month', now())`);
    const { rows: [held] } = await client.query(
      `select coalesce(sum(calls), 0)::int as calls from spend_reservations where provider = 'tripadvisor'`);
    const left = Math.max(0, TRIPADVISOR_CAP - made.calls - held.calls);
    // Whatever fits, and never more: a batch is cut to what is left rather than
    // refused whole, because half a county's worth of answers is worth having.
    const granted = Math.max(0, Math.min(want, left));
    let reservation = null;
    if (granted > 0) {
      const { rows: [r] } = await client.query(
        `insert into spend_reservations (pence, calls, provider, holder)
         values (0, $1, 'tripadvisor', $2) returning id`, [granted, 'collect']);
      reservation = r.id;
    }
    return { left, granted, reservation };
  });
}

router.post('/ask', requires('manage_library'), async (req, res, next) => {
  try {
    const refs = (Array.isArray(req.body?.refs) ? req.body.refs : []).map(String).filter(Boolean).slice(0, 50);
    if (!refs.length) throw bad('Nothing selected.');
    if (!googleSource.enabled()) {
      return res.status(422).json({
        error: 'not_switched_on',
        message: 'Google is not switched on here. The key is the owner\'s to add in Doppler.',
      });
    }
    // Before a penny of it: what one Place Details call costs, times the number
    // of them, against what is left of this month's ceiling.
    const want = askingCost(refs, await alreadyMatched(refs));
    const room = await roomToSpend(want, { holder: 'ask' });
    if (!room.ok) return overTheCeiling(res, want, room);
    try {
      const household = await currentHousehold();
      const out = await askThese(refs, household.id);
      if (out.asked) { await index.rescore(); await index.refreshStats(); }
      res.json({ ...out, spentPence: want });
    } finally {
      // The claim is let go whether it went well or not: by now every call it
      // covered is in `provider_calls`, which is what the next one counts.
      await releaseSpend(room.reservation);
    }
  } catch (err) { next(err); }
});

/**
 * Look for a picture of this place we are allowed to keep.
 *
 * Walks the ladder in `sources/placePicture.js` — the venue's own logo, then
 * Wikimedia Commons, then street level — and **writes the bytes and every
 * licence field into the library**, which is what makes a picture appear.
 * Enriching a place can learn that a Wikipedia image exists; only this puts one
 * on the place (Codex, 17 Sep 2026).
 */
router.post('/pictures/find', requires('manage_library'), async (req, res, next) => {
  try {
    const refs = (Array.isArray(req.body?.refs) ? req.body.refs : []).map(String).filter(Boolean).slice(0, 25);
    if (!refs.length) throw bad('Nothing selected.');
    const { rows } = await query(`
      select pi.venue_ref, pi.lat, pi.lng, pi.subcategory as category,
             coalesce(r.name, a.name) as name,
             coalesce(r.website, a.website) as website,
             coalesce(r.wikidata_id, a.wikidata_id) as wikidata_id,
             coalesce(r.wikipedia_url, a.wikipedia_url) as wikipedia_url
        from place_index pi
        left join place_records r on r.venue_ref = pi.venue_ref
        left join attractions a on (a.venue_ref = pi.venue_ref or 'atlas:' || a.id::text = pi.venue_ref) and a.state <> 'rejected'
       where pi.venue_ref = any($1)`, [refs]);
    const out = [];
    // Deliberately asked, so it looks again — a logo we found once should be
    // improvable. What it may not do is demote a photograph somebody in the
    // house took, and that guard lives in `pictureFor` where every caller gets
    // it (Codex, 17 Sep 2026).
    for (const place of rows) out.push({ ref: place.venue_ref, ...(await pictureFor(place, { force: true })) });
    await index.rescore();
    await index.refreshStats();
    res.json({ found: out.filter((o) => o.state === 'found').length, results: out, spentPence: 0 });
  } catch (err) { next(err); }
});

/**
 * Collect here — go and get what is missing, for the area you are standing in.
 *
 * Every *Collect* on every Places board ends up here, and it carries its own
 * scope: a county, a ring, a category, a subcategory. The sources chosen on the
 * Collect lens decide what is actually asked, and the paid ones are checked
 * against the month's ceiling before anything goes out.
 *
 * It answers immediately and runs on: a collection over fifty places outlives
 * the gateway, and Runs is the page that watches what is going.
 */
/**
 * What a collection would actually do, before it does it.
 *
 * The board used to work its own figures out — "every identified place in the
 * county", priced at a per-call rate it kept its own copy of — while the run
 * took fifty places, dropped everything asked inside twelve months, and priced
 * an unmatched place at two calls rather than one. So a county could quote four
 * figures for a run that would ask about fifty (17 Sep 2026, the verification
 * audit). This is the plan, and both the quote and the run read it, so they
 * cannot disagree.
 */
async function planCollect(where) {
  const scope = await resolveWhere(where ?? {});
  if (scope.kind === 'none' || scope.kind === 'unknown') throw bad('Which area? Pass where.');
  // A GET carries them comma-separated; a POST carries an array. Both are read.
  const chosen = new Set((Array.isArray(where?.sources)
    ? where.sources
    : String(where?.sources ?? 'own').split(',')).map((x) => String(x).trim()).filter(Boolean));
  const limit = Math.min(200, Math.max(1, Number(where?.limit) || 50));

  // The places in scope that would gain most: the ones that are not ready,
  // worst first.
  const args = [];
  const wh = [];
  if (scope.kind === 'ring') { args.push(scope.refs); wh.push(`pi.venue_ref = any($${args.length})`); }
  else { args.push(scope.area.slug); wh.push(`exists (select 1 from place_areas pa where pa.venue_ref = pi.venue_ref and pa.area_slug = $${args.length})`); }
  if (where?.cat) { args.push(String(where.cat)); wh.push(`pi.category = $${args.length}`); }
  if (where?.sub) { args.push(String(where.sub)); wh.push(`pi.subcategory = $${args.length}`); }
  // A wide net, cut to the run's size *after* the freshness rule.
  //
  // Taking the worst `limit` rows first and then dropping the ones asked about
  // inside twelve months meant a run could do nothing at all — and do nothing
  // again next time, because the ordering never changes, so the eligible places
  // below the cut were never reached (Codex, 17 Sep 2026). The net is twenty
  // times the run, which is enough to find work behind a wall of fresh answers
  // and still bounded.
  args.push(limit * 20);
  const { rows: candidates } = await query(
    `select pi.venue_ref, pi.ownership from place_index pi
      where ${wh.join(' and ')}
      order by pi.ready asc, pi.data_score asc nulls first
      limit $${args.length}`, args);

  const freeChosen = ['own', 'osm', 'atlas'].filter((k) => chosen.has(k));
  const everything = candidates.map((r) => r.venue_ref);
  // Only a place we hold nothing of our own about is worth a paid call — which
  // is both the identified ones and the claimed ones. A claimed place is one a
  // household has said matters and we still hold nothing about: the best
  // candidate there is, and splitting owned from claimed had quietly taken all
  // of them out of Collect's reach (Codex, 17 Sep 2026).
  const worthPaying = candidates.filter((r) => r.ownership !== 'owned').map((r) => r.venue_ref);

  /**
   * The staleness rule, enforced rather than printed.
   *
   * The design asks for "a staleness rule so a place is not re-asked inside
   * twelve months unless something changed", and the board says so on the row —
   * but nothing checked it, so reopening the same scope and pressing again
   * bought the same answers over (Codex, 17 Sep 2026).
   *
   * The free pass is one act, so it is keyed on one source: `curateThese` runs
   * `enrich`, which reads the venue's own page, the open map and the
   * encyclopedias together and cannot be asked for one of them alone. What it
   * writes is an `own` row, so that is the window's key; keying it on the three
   * names separately meant choosing Atlas alone offered work for ever.
   */
  const FREE_KEY = 'own';
  const SOURCES_ASKED = ['google', 'tripadvisor', ...(freeChosen.length ? [FREE_KEY] : [])];
  const { rows: lately } = everything.length ? await query(
    `select source, venue_ref from place_index_sources
      where venue_ref = any($1) and source = any($2)
        and last_seen > now() - ($3 || ' months')::interval`,
    [everything, SOURCES_ASKED, String(STALE_MONTHS)]) : { rows: [] };
  const askedLately = new Map(SOURCES_ASKED.map((k) => [k, new Set()]));
  for (const r of lately) askedLately.get(r.source)?.add(r.venue_ref);
  const notLately = (src, from) => from.filter((ref) => !askedLately.get(src)?.has(ref));

  // Cut to the run's size here, where "eligible" is finally known. Each list
  // is cut on its own, because a source with nothing fresh in front of it
  // should not be held back by one that has.
  const take = (list) => list.slice(0, limit);
  const freeEligible = freeChosen.length ? notLately(FREE_KEY, everything) : [];
  const free = take(freeEligible);
  // How many the window left alone, out of everything the net found.
  const freeFresh = everything.length - freeEligible.length;

  // Each paid source on its own terms, and only if it was chosen and is
  // switched on. One shared list run through Google was how asking Tripadvisor
  // spent Google's money (Codex, 17 Sep 2026).
  const google = chosen.has('google') && googleSource.enabled() ? take(notLately('google', worthPaying)) : [];
  let tripadvisor = chosen.has('tripadvisor') && tripadvisorSource.enabled() ? take(notLately('tripadvisor', worthPaying)) : [];
  // Tripadvisor's ceiling is counted in their locations, and a view is two.
  const taLeft = tripadvisor.length
    ? Math.floor((await tripadvisorRoom(0)).left / TA_UNITS_PER_VIEW) : 0;
  const taCapped = Math.max(0, tripadvisor.length - taLeft);
  tripadvisor = tripadvisor.slice(0, taLeft);

  const want = askingCost(google, await alreadyMatched(google));
  return {
    scope, chosen, limit,
    // How many this run will actually touch, which is what the board prints.
    places: new Set([...free, ...google, ...tripadvisor]).size,
    free, freeFresh, google, tripadvisor, taCapped, taLeft,
    want,
    fresh: {
      google: worthPaying.length - notLately('google', worthPaying).length,
      tripadvisor: worthPaying.length - notLately('tripadvisor', worthPaying).length,
      free: freeFresh,
    },
  };
}

/**
 * The quote: the same plan, read rather than run.
 *
 * `view_library`, because looking at what something would cost is looking.
 */
router.get('/collect/quote', requires('view_library'), async (req, res, next) => {
  try {
    const plan = await planCollect(req.query);
    const room = await roomToSpend(plan.want, { reserve: false });
    res.json({
      ...(await head(plan.scope)),
      places: plan.places, limit: plan.limit, staleMonths: STALE_MONTHS,
      // Per source, so every figure on the board is derivable from this.
      would: { free: plan.free.length, google: plan.google.length, tripadvisor: plan.tripadvisor.length },
      fresh: plan.fresh,
      spendPence: plan.want,
      tripadvisorCapped: plan.taCapped, tripadvisorLeft: plan.taLeft,
      leftPence: room.leftPence, overTheCeiling: !room.ok,
    });
  } catch (err) { next(err); }
});

router.post('/collect', requires('manage_library'), async (req, res, next) => {
  try {
    const plan = await planCollect(req.body ?? {});
    const { free, google, tripadvisor, want } = plan;
    // Checked here without claiming it: the run takes its money a chunk at a
    // time, so holding the whole list's worth for the length of the run would
    // lock out everything else for as long as it took.
    const room = await roomToSpend(want, { reserve: false });
    if (!room.ok) return overTheCeiling(res, want, room);

    const household = await currentHousehold();
    // Written down before a word of it is done, so an answer of "started" is a
    // claim something can check afterwards (Codex, 17 Sep 2026).
    const run = await collectRuns.start({
      whereLabel: plan.scope.kind === 'ring' ? `${plan.places} places in a ring` : (plan.scope.area?.name ?? plan.scope.area?.slug ?? null),
      scope: { kind: plan.scope.kind, slug: plan.scope.area?.slug ?? null, cat: req.body?.cat ?? null, sub: req.body?.sub ?? null },
      sources: [...plan.chosen],
      todo: { free, google, tripadvisor },
      // Whose run it is, on the row: a resume happens outside any request, and
      // `currentHousehold()` there answers with the founding household — which
      // would attribute somebody else's calls to them (Codex, 17 Sep 2026).
      householdId: household.id,
      startedBy: req.account?.email ?? null,
    });
    res.json({
      started: true, runId: run.id, places: plan.places, sources: [...plan.chosen],
      free: free.length, paid: google.length + tripadvisor.length,
      google: google.length, tripadvisor: tripadvisor.length,
      // Said out loud, because "we asked about fewer than you chose" is a
      // figure somebody would otherwise go looking for.
      fresh: plan.fresh,
      staleMonths: STALE_MONTHS,
      // Said out loud rather than swallowed: the ones the monthly ceiling left out.
      tripadvisorCapped: plan.taCapped, tripadvisorLeft: plan.taLeft,
      spendPence: want, leftPence: room.leftPence,
    });
    void work(run.id, household.id);
  } catch (err) { next(err); }
});

/**
 * Work through one collection run, a chunk at a time.
 *
 * After every chunk the row is written: those places come off the list, the
 * count goes up, and `touched_at` moves. So a process that dies mid-run loses
 * at most one chunk, and what is left is still on the row for the next process
 * to pick up. It is deliberately not clever about concurrency — a run is
 * resumed only once it has gone untouched for ten minutes, which is longer than
 * any chunk takes.
 */
async function work(runId, householdId) {
  try {
    for (;;) {
      const run = await collectRuns.one(runId);
      if (!run || run.state !== 'running') return;
      const todo = run.todo ?? {};
      const source = ['google', 'tripadvisor', 'free'].find((k) => (todo[k] ?? []).length);
      if (!source) break;
      const batch = todo[source].slice(0, collectRuns.CHUNK);
      // Off the list before the first call goes out. Taking it off afterwards
      // meant a deploy in between left the whole chunk on `todo` and the
      // resumed run paid for all of it again (Codex, 17 Sep 2026).
      await collectRuns.claim(runId, source, batch);
      if (source === 'free') {
        const out = await curateThese(batch, householdId);
        await collectRuns.done(runId, 'free', { done: out.started, refused: out.refused });
      } else if (source === 'google') {
        // The ceiling is asked again per chunk, not once at the start: a run
        // that outlives a deploy must not outlive the month's budget either.
        const cost = askingCost(batch, await alreadyMatched(batch));
        const room = await roomToSpend(cost, { holder: `collect:${runId}` });
        if (!room.ok) { await collectRuns.done(runId, 'google', { refused: batch.map((ref) => ({ ref, why: 'over the ceiling' })) }); continue; }
        try {
          const out = await askThese(batch, householdId);
          // What the whole chunk was claimed at, apportioned to what answered:
          // a place that did not match still cost the search that found that out.
          await collectRuns.done(runId, 'google', { done: out.asked, refused: out.refused, spentPence: cost });
        } finally { await releaseSpend(room.reservation); }
      } else {
        // Claimed in locations, sliced back into places.
        const room = await tripadvisorRoom(batch.length * TA_UNITS_PER_VIEW);
        const may = batch.slice(0, Math.floor(room.granted / TA_UNITS_PER_VIEW));
        try {
          const out = may.length ? await askTripadvisor(may, householdId) : { asked: 0, refused: [] };
          await collectRuns.done(runId, 'tripadvisor', {
            done: out.asked,
            refused: [...out.refused, ...batch.slice(may.length).map((ref) => ({ ref, why: 'over the monthly ceiling' }))],
          });
        } finally { await releaseSpend(room.reservation); }
      }
    }
    await index.settleNew();
    await index.rescore();
    await index.refreshStats();
    await collectRuns.finish(runId);
  } catch (err) {
    console.warn(`collect: ${err.message}`);
    await collectRuns.fail(runId, err.message).catch(() => null);
  }
}

/**
 * Pick up whatever a deploy interrupted.
 *
 * Called on the hour. A run is only resumed once it has gone untouched for ten
 * minutes, so this cannot start a second worker on a run that is simply slow.
 */
export async function resumeCollections() {
  // Claimed, not merely read: the claim and the selection are one statement, so
  // two instances booting together cannot both pick up the same run and make
  // the same paid calls (Codex, 17 Sep 2026).
  const waiting = await collectRuns.claimStranded();
  if (!waiting.length) return { resumed: 0 };
  let resumed = 0;
  for (const run of waiting) {
    // No household on the row means the run predates this column, and guessing
    // one would put its calls on somebody's account. It is failed instead, so
    // the board asks for it to be started again rather than quietly finishing
    // it wrongly.
    if (!run.household_id) { await collectRuns.fail(run.id, 'it was interrupted and we cannot tell whose run it was'); continue; }
    // Whatever it was in the middle of asking about is written off rather than
    // asked again: we cannot know whether those calls were billed, and the safe
    // direction is not to pay twice (Codex, 17 Sep 2026).
    await collectRuns.abandonInFlight(run.id);
    void work(run.id, run.household_id);
    resumed += 1;
  }
  return { resumed };
}


// ---------------------------------------------------------------------------
// pictures
// ---------------------------------------------------------------------------

/**
 * BO2j — the picture index the owner asked for by name (4 Sep 2026: "some form
 * of index, a proper form of indexing, so we can search and find the images that
 * we own").
 *
 * Every licence field on one picture, and the attribution page as a link rather
 * than as a string somebody has to copy.
 */
router.get('/pictures', requires('view_library'), async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    const facet = String(req.query.facet ?? '').trim();
    const args = [];
    const where = ['ia.may_store'];
    if (q) { args.push(q); where.push(`ia.search @@ plainto_tsquery('english', $${args.length})`); }
    if (facet === 'household') where.push('ia.contributor_household_id is not null');
    // The same test the tile dims on: a picture we may keep but cannot credit is
    // not publishable, whatever its licence says about whether credit is
    // required (Codex, 17 Sep 2026).
    else if (facet === 'needs-attribution') where.push("coalesce(ia.credit_line, '') = ''");
    else if (facet) { args.push(facet); where.push(`ia.source = $${args.length}`); }
    args.push(Math.min(240, Number(req.query.limit) || 60));
    const { rows } = await query(`
      select ia.id, ia.source, ia.licence, ia.licence_url, ia.creator, ia.creator_url, ia.credit_line,
             ia.title, ia.caption, ia.source_page_url, ia.width, ia.height, ia.bytes, ia.fetched_at,
             ia.contributor_household_id,
             -- What it is a picture *of*, in words.
             --
             -- This used to hand back "place:osm:123" and the board printed it
             -- unresolved (17 Sep 2026, the verification audit). An attraction
             -- knows its own name; a place's name comes from the same ladder
             -- every other name on these screens comes from, so the ref is
             -- handed over beside the words and resolved once.
             (select li.subject_id from image_links li where li.image_id = ia.id limit 1) as on_ref,
             (select li.subject_type from image_links li where li.image_id = ia.id limit 1) as on_kind,
             (select a.name from image_links li join attractions a on a.id::text = li.subject_id
               where li.image_id = ia.id and li.subject_type = 'attraction' limit 1) as on_attraction,
             (select li.role from image_links li where li.image_id = ia.id limit 1) as role
        from image_assets ia
       where ${where.join(' and ')}
       order by ia.fetched_at desc
       limit $${args.length}`, args);
    const { rows: [counts] } = await query(`
      select count(*) filter (where may_store)::int as owned,
             count(*) filter (where contributor_household_id is not null)::int as household,
             count(*) filter (where may_store and coalesce(credit_line,'') = '')::int as needs_attribution
        from image_assets`);
    const { rows: facets } = await query(
      `select source, count(*)::int as n from image_assets where may_store group by source order by count(*) desc`);
    const { rows: [noPicture] } = await query(`
      select count(*)::int as n from place_index pi
       where not ((pi.score_parts->'held') ? 'picture')`);
    // The words the boards use for a source, rather than the key the harvester
    // wrote. `household` is the same set as the "A household" facet, so it is
    // named once and not listed twice.
    const SOURCE_WORD = { wikimedia: 'Commons', commons: 'Commons', geograph: 'Geograph', site: 'The venue’s own', logo: 'The venue’s own logo', street: 'Street level', household: 'A household' };
    // How many match, not how many were sent: the heading reads as the size of
    // the answer.
    const { rows: [matching] } = await query(
      `select count(*)::int as n from image_assets ia where ${where.join(' and ')}`, args.slice(0, -1));
    // One read of the name ladder for the whole page, not one per row.
    const placeNames = await index.namesFor(
      [...new Set(rows.filter((p) => p.on_kind === 'place' && p.on_ref).map((p) => p.on_ref))]);
    res.json({
      matching: matching.n,
      pictures: rows.map((p) => ({
        id: p.id, source: p.source, licence: p.licence, licenceUrl: p.licence_url,
        creator: p.creator, creatorUrl: p.creator_url, credit: p.credit_line,
        title: p.title, caption: p.caption, page: p.source_page_url,
        width: p.width, height: p.height, bytes: p.bytes, fetchedAt: p.fetched_at,
        onRef: p.on_ref ?? null, onKind: p.on_kind ?? null,
        // The words, resolved: an attraction's own name, or the place's from
        // the name ladder, or nothing — which means it is attached to nothing.
        onPlace: p.on_attraction ?? (p.on_kind === 'place' ? (placeNames.get(p.on_ref)?.name ?? null) : null),
        role: p.role, fromHousehold: Boolean(p.contributor_household_id),
        attribution: Boolean(p.credit_line),
      })),
      counts: { ...counts, noPicture: noPicture.n },
      facets: [
        ...facets.filter((f) => f.source !== 'household').map((f) => ({ key: f.source, label: SOURCE_WORD[f.source] ?? f.source, n: f.n })),
        { key: 'household', label: 'A household', n: counts.household },
        { key: 'needs-attribution', label: 'Needs attribution', n: counts.needs_attribution },
      ],
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// the bar
// ---------------------------------------------------------------------------

/** BO2k — what counts as ready, per kind of place. The authoritative board. */
router.get('/bars', requires('view_library'), async (_req, res, next) => {
  try {
    const bar = await index.bars();
    const { rows: subs } = await query(`
      select s.key, s.label, s.category_key, c.label as category_label,
             (select count(*)::int from place_index pi where pi.subcategory = s.key) as places,
             (select count(*)::int from place_index pi where pi.subcategory = s.key and pi.ready) as ready
        from shelf_subcategories s join shelf_categories c on c.key = s.category_key
       where s.active order by c.position, s.position`);
    res.json({
      facts: FACTS, weights: FACT_WEIGHTS,
      subcategories: subs.map((s) => {
        const b = bar.get(s.key) ?? [];
        return {
          key: s.key, label: s.label, category: s.category_key, categoryLabel: s.category_label,
          places: s.places, ready: s.ready,
          set: b.some((x) => x.required),
          facts: FACT_KEYS.map((f) => {
            const row = b.find((x) => x.fact === f);
            return { fact: f, weight: row?.weight ?? FACT_WEIGHTS[f], required: Boolean(row?.required) };
          }),
        };
      }),
      britain: await index.statsFor('gb'),
    });
  } catch (err) { next(err); }
});

/** How many places hold each fact, for the bar being composed. */
router.get('/bars/:sub/facts', requires('view_library'), async (req, res, next) => {
  try {
    const sub = String(req.params.sub);
    const { rows: [n] } = await query(`
      select count(*)::int as places,
             ${FACT_KEYS.map((f) => `count(*) filter (where (score_parts->'held') ? '${f}' or (score_parts->'notCounted') ? '${f}')::int as ${f}`).join(',\n             ')}
        from place_index where subcategory = $1`, [sub]);
    res.json({ places: n.places, held: Object.fromEntries(FACT_KEYS.map((f) => [f, n[f]])) });
  } catch (err) { next(err); }
});

/**
 * What saving this bar would do, stated before it saves.
 *
 * The lower number is the point: 38% → 34% nationally means the old one was
 * wrong, not that something has broken.
 */
router.post('/bars/:sub/effect', requires('view_library'), async (req, res, next) => {
  try {
    const sub = String(req.params.sub);
    const want = Array.isArray(req.body?.facts) ? req.body.facts : [];
    const { rows } = await query(
      `select pi.venue_ref, pi.ready, pi.score_parts,
              (select string_agg(distinct pa.area_slug, ',') from place_areas pa join localities l on l.slug = pa.area_slug
                where pa.venue_ref = pi.venue_ref and l.kind = 'county') as counties
         from place_index pi where pi.subcategory = $1`, [sub]);
    const bar = want.map((f) => ({ fact: f.fact, weight: Number(f.weight) || FACT_WEIGHTS[f.fact] || 0, required: Boolean(f.required) }));
    let readyNow = 0, readyAfter = 0, lost = 0, gained = 0;
    const moved = new Set();
    for (const r of rows) {
      const parts = r.score_parts ?? {};
      const held = Object.fromEntries(FACT_KEYS.map((f) => [f,
        (parts.held ?? []).includes(f) || (parts.notCounted ?? []).includes(f)]));
      const after = scorePlace({ bar, held });
      if (r.ready) readyNow += 1;
      if (after.ready) readyAfter += 1;
      if (r.ready && !after.ready) { lost += 1; for (const c of (r.counties ?? '').split(',').filter(Boolean)) moved.add(c); }
      if (!r.ready && after.ready) { gained += 1; for (const c of (r.counties ?? '').split(',').filter(Boolean)) moved.add(c); }
    }
    const britain = await index.statsFor('gb');
    const delta = readyAfter - readyNow;
    res.json({
      places: rows.length,
      readyNow, readyAfter,
      shareNow: rows.length ? Math.round((readyNow / rows.length) * 100) : null,
      shareAfter: rows.length ? Math.round((readyAfter / rows.length) * 100) : null,
      stopBeingReady: lost, startBeingReady: gained,
      countiesMoved: moved.size,
      britainNow: britain.ready,
      britainAfter: britain.known ? Math.round(((britain.readyCount + delta) / britain.known) * 100) : null,
      rescore: rows.length,
    });
  } catch (err) { next(err); }
});

/** Save the bar, and work every affected place out again from scratch. */
router.put('/bars/:sub', requires('manage_library'), async (req, res, next) => {
  try {
    const sub = String(req.params.sub);
    const want = Array.isArray(req.body?.facts) ? req.body.facts : [];
    const before = await index.setBar(sub, want.map((f) => ({ fact: f.fact, weight: Number(f.weight) || FACT_WEIGHTS[f.fact] || 0, required: Boolean(f.required) })), actor(req).actorLabel);
    const out = await index.rescore({ subcategory: sub });
    await index.refreshStats();
    await writeAudit({ ...actor(req), action: 'ready.bar', subjectType: 'subcategory', subjectId: sub, subjectLabel: sub, before: { facts: before }, after: { facts: want } });
    res.json({ ok: true, ...out });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// keeping it current
// ---------------------------------------------------------------------------

/** Rebuild the index. Free, no network, and resumable by being idempotent. */
router.post('/reindex', requires('manage_library'), async (req, res, next) => {
  try {
    await index.seedBars();
    // `reindex()` takes the build lock itself, so a rebuild landing on top of
    // the hourly settling pass or on another rebuild finds it busy and says so
    // rather than half-filling the same tables (Codex, 17 Sep 2026). That holds
    // for the detached path as much as the waiting one.
    if (req.body?.wait === true) return res.json(await index.reindex());
    res.json({ started: true });
    void index.reindex().then((r) => {
      if (r?.skipped) console.log(`epic-api: places — rebuild skipped, ${r.skipped}`);
    }).catch(() => null);
  } catch (err) { next(err); }
});

/** Rebuild just the counts — what "Refresh the counts · 4 min ago" does. */
router.post('/refresh', requires('manage_library'), async (_req, res, next) => {
  try {
    // Anything kept since the last pass is placed first — otherwise Refresh
    // recounts the places the boards already knew about and the new ones stay
    // invisible, which is the opposite of what the button says.
    const placed = await index.settleNew();
    res.json({ ...await index.refreshStats(), ...placed });
  } catch (err) { next(err); }
});

/** Work every score out again. Free, and the thing to run after a bar changes. */
router.post('/rescore', requires('manage_library'), async (req, res, next) => {
  try {
    const out = await index.rescore({ subcategory: req.body?.subcategory ?? null });
    await index.refreshStats();
    res.json(out);
  } catch (err) { next(err); }
});

/** The area search box: a county, a town or a postcode. */
router.get('/search', requires('view_library'), async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (!q) return res.json({ areas: [], postcode: null });
    const { rows } = await query(
      `select l.slug, l.name, l.kind, p.name as parent
         from localities l left join localities p on p.slug = l.parent_slug
        where l.name ilike $1 or l.slug ilike $1
        order by (l.kind = 'county') desc, (l.kind = 'town') desc, l.name limit 12`, [`%${q}%`]);
    const sector = sectorOf(q);
    res.json({
      areas: rows.map((r) => ({ slug: r.slug, name: r.name, kind: r.kind, parent: r.parent })),
      // A full postcode is not an area — it is a point, and a point takes a ring.
      postcode: sector ? { sector, cell: `sector:${sector}`, label: q.toUpperCase(), bands: BANDS, modes: MODES } : null,
    });
  } catch (err) { next(err); }
});

export default router;
