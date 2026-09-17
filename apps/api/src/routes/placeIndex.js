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
import { requires } from '../access.js';
import { query } from '../db.js';
import * as index from '../repositories/placeIndex.js';
import * as reach from '../repositories/reach.js';
import { sectorOf, labelOf, CAP_MINUTES, EDGE_MINUTES } from '../domain/reach.js';
import { travelMode, estimateTravelMinutes } from '../domain/travel.js';
import { FACTS, FACT_KEYS, FACT_WEIGHTS, scorePlace, faultOf, SHORT_FAULT } from '../domain/placeIndex.js';
import { writeAudit } from '../repositories/roles.js';
import { OUR_LABEL, detailFor, blank, lineUp } from '../sources/compare.js';
import { googleSource } from '../sources/google.js';
import { tripadvisorSource } from '../sources/tripadvisor.js';
import { googleMatchFor, matchesFor } from '../sources/providerMatch.js';
import { whySourceFailed } from '../sources/why.js';
import { currentHousehold } from './household.js';

/** Who did it, said the same way every other back-office route says it. */
const actor = (req) => ({ actorId: req.account?.id ?? null, actorLabel: req.account?.email ?? 'the owner (passcode)' });

const router = express.Router();
const bad = (message, code = 'bad_request') => Object.assign(new Error(message), { status: 400, code });
const lower = (s) => String(s ?? '').trim().toLowerCase();

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
      ringBands: BANDS, modes: MODES,
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
      allTowns: (await query('select count(*)::int as n from localities where kind = $1 and parent_slug = $2', ['town', where])).rows[0].n,
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
      labels: req.query.by === 'labels'
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
    const { rows } = await query(`
      select coalesce(s.subject, '') as subject,
             count(*)::int                                          as searches,
             count(*) filter (where s.empty)::int                    as empty,
             count(*) filter (where not s.empty and s.outcome = 'none')::int as no_click,
             count(*) filter (where s.outcome in ('clicked','saved'))::int   as no_trip
        from searches s
       where s.at > now() - ($1 || ' days')::interval
         and ($2::text is null or s.area_slug = $2)
       group by 1 order by count(*) desc limit 40`, [String(since), slug]);
    const labels = new Map((await query('select key, label from shelf_subcategories').then((r) => r.rows)).map((r) => [r.key, r.label]));
    const catLabels = new Map((await query('select key, label from shelf_categories').then((r) => r.rows)).map((r) => [r.key, r.label]));
    const known = new Map((await query(
      `select subcategory, places from area_stats where area_slug = $1 and subcategory <> '' and source = '' and ownership = ''`,
      [slug ?? ''])).rows.map((r) => [r.subcategory, r.places]));
    res.json({
      ...(await head(scope)),
      since,
      totals: {
        searches: rows.reduce((n, r) => n + r.searches, 0),
        empty: rows.reduce((n, r) => n + r.empty, 0),
        noClick: rows.reduce((n, r) => n + r.no_click, 0),
        noTrip: rows.reduce((n, r) => n + r.no_trip, 0),
      },
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
             count(*) filter (where pi.ownership <> 'identified')::int as owned,
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
          known: h?.known ?? 0, owned: h?.owned ?? 0,
          ready: h ? (h.known ? Math.round((h.ready_count / h.known) * 100) : null) : null,
          avgScore: h?.avg_score == null ? null : Math.round(h.avg_score),
          searches: searches.get(s.key) ?? 0,
          nearest: best.has(s.key) ? best.get(s.key) : null,
        };
      }).filter((r) => r.known > 0 || r.searches > 0),
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
    const { rows: [att] } = await query(
      `select * from attractions where (venue_ref = $1 or 'atlas:' || id::text = $1) and state <> 'rejected' limit 1`, [ref]);
    const { rows: [sweep] } = await query('select * from scout_places where venue_ref = $1 order by last_seen desc limit 1', [ref]);
    const { rows: seen } = await query('select source, source_place_id, first_seen, last_seen from place_index_sources where venue_ref = $1 order by source', [ref]);
    const { rows: facts } = await query('select field, source, value, licence, retention, fetched_at, expires_at from place_facts where venue_ref = $1 order by field', [ref]);
    const { rows: areas } = await query(
      `select l.slug, l.name, l.kind from place_areas pa join localities l on l.slug = pa.area_slug where pa.venue_ref = $1 order by l.kind`, [ref]);
    const { rows: pictures } = await query(`
      select ia.id, ia.source, ia.licence, ia.licence_url, ia.creator, ia.credit_line, ia.title,
             ia.source_page_url, ia.width, ia.height, ia.bytes, ia.fetched_at, ia.may_store, li.role
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
    const hoursVal = rec?.opening_hours ?? null;
    // A source is a word, not a URL and not a sentence: the sentence belongs in
    // the row when it is opened, and a host is what the column has room for.
    const asWord = (v) => {
      if (!v) return null;
      const s = String(v);
      if (/^https?:\/\//i.test(s)) { try { return new URL(s).hostname.replace(/^www\./, ''); } catch { return 'their site'; } }
      return s;
    };
    const held = {
      picture: pictures.some((p) => p.may_store),
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
    const OURS = new Set(['ours', 'own', 'curate', 'hand', 'claim']);
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
        // **Ours, so editable.** The Source column's own tooltip says it: a
        // provider's value changes when they change it, and a copy of it we
        // could overwrite would be a copy we are not allowed to keep. So the
        // flag follows where the value came from, not a list (Codex, 17 Sep).
        editable: editable && held && OURS.has(String(from ?? '').toLowerCase()),
        // A hole offers the thing that would fill it. It used to be shadowed by
        // Edit, so Write, Find and Ask were unreachable.
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
      field('labels', 'Labels', (labelRows.map((l) => l.label).join(' · ') || null), 'ours', pi.indexed_at, null, true),
      field('what_it_is', 'What it is', rec?.summary ?? att?.summary ?? null, rec?.summary_source ?? att?.summary_source ?? null, rec?.curated_at ?? null, 'what_it_is', true, 'write',
            null, rec?.curated_from?.length ? `read from ${rec.curated_from.join(', ')}` : null),
      field('hours', 'Opening hours', hoursVal, factOf('opening_hours')?.source ?? (hoursVal ? 'ours' : null), factOf('opening_hours')?.fetched_at ?? null, 'hours', true, 'ask',
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
      })),
      // Identifiers, and what it means when there is not one: `not asked` is not
      // the same fact as `no match`, and the two must stay visibly different.
      ids: [
        { key: 'ours', label: 'Ours', value: rec ? ref : att ? `atlas:${att.id}` : null, state: rec || att ? 'held' : 'none' },
        { key: 'osm', label: 'OSM', value: rec?.osm_ref ?? att?.osm_ref ?? (ref.startsWith('osm:') ? ref.slice(4) : null), state: asked.has('osm') ? 'held' : 'not-asked' },
        { key: 'google', label: 'Google', value: ref.startsWith('google:') ? ref.slice(7) : null, state: ref.startsWith('google:') ? 'held' : asked.has('google') ? 'no-match' : 'not-asked' },
        { key: 'wikidata', label: 'Wikidata', value: att?.wikidata_id ?? rec?.wikidata_id ?? null, state: (att?.wikidata_id ?? rec?.wikidata_id) ? 'held' : att ? 'no-match' : 'not-asked' },
        { key: 'tripadvisor', label: 'Tripadvisor', value: seen.find((s) => s.source === 'tripadvisor')?.source_place_id ?? null, state: asked.has('tripadvisor') ? 'held' : 'not-asked' },
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
      await query(
        `insert into place_records (venue_ref, accessibility, updated_at) values ($1, jsonb_build_object('stepFree', $2::boolean), now())
         on conflict (venue_ref) do update set accessibility = place_records.accessibility || jsonb_build_object('stepFree', $2::boolean), updated_at = now()`,
        [ref, value === true || value === 'yes']);
    } else if (key === 'aka') {
      await query(
        `insert into place_records (venue_ref, curation, curated_at, updated_at) values ($1, jsonb_build_object('aka', $2::text), now(), now())
         on conflict (venue_ref) do update set curation = coalesce(place_records.curation, '{}'::jsonb) || jsonb_build_object('aka', $2::text), curated_at = now(), updated_at = now()`,
        [ref, value == null ? null : String(value)]);
    } else if (key === 'subcategory') {
      const { rows: [sub] } = await query('select key, category_key from shelf_subcategories where key = $1', [String(value)]);
      if (!sub) throw bad('No such subcategory.');
      await query(`update place_index set subcategory = $2, category = $3, derived_by = 'hand' where venue_ref = $1`, [ref, sub.key, sub.category_key]);
    } else if (key === 'outcode') {
      await query('delete from place_areas pa using localities l where l.slug = pa.area_slug and pa.venue_ref = $1 and l.kind = $2', [ref, 'postcode']);
      if (value) await query('insert into place_areas (venue_ref, area_slug) values ($1,$2) on conflict do nothing', [ref, lower(value)]);
    } else if (key === 'busy') {
      await query(`update place_records set count_band = $2 where venue_ref = $1`, [ref, value]);
    }
    await index.rescore();
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
    const named = (await index.namesFor([ref])).get(ref) ?? { name: null };

    // Ours: the owned record first, because it is the one researched from the
    // open web; the atlas or the sweep if that is all we hold.
    const { rows: [rec] } = await query('select * from place_records where venue_ref = $1', [ref]);
    const { rows: [att] } = await query(
      `select * from attractions where (venue_ref = $1 or 'atlas:' || id::text = $1) and state <> 'rejected' limit 1`, [ref]);
    const { rows: [sweep] } = await query('select * from scout_places where venue_ref = $1 order by last_seen desc limit 1', [ref]);
    const mine = rec
      ? { source: 'own', fields: Object.fromEntries(Object.entries(rec).filter(([, v]) => v != null)) }
      : att ? { source: 'atlas', fields: { name: att.name, summary: att.summary, website: att.website, lat: att.lat, lng: att.lng, wikidata_id: att.wikidata_id, wikipedia_url: att.wikipedia_url, crowd_band: att.crowd_band, count_band: att.count_band, epic_score: att.epic_score } }
      : sweep ? { source: 'sweep', fields: { name: sweep.name, website: sweep.website, lat: sweep.lat, lng: sweep.lng, cuisines: sweep.cuisines, crowd_band: sweep.crowd_band, count_band: sweep.count_band, epic_score: sweep.epic_score } }
      : null;
    const columns = [{ key: 'ours', label: mine ? OUR_LABEL[mine.source] ?? mine.source : 'Ours', note: mine ? null : 'we hold none', fields: mine?.fields ?? null }];

    // Google: by identifier when we hold one, else matched by name and distance.
    let google = { key: 'google', label: 'Google', note: null, fields: null, id: null, how: 'none' };
    if (!googleSource.enabled()) google.note = 'not switched on';
    else {
      let id = ref.startsWith('google:') ? ref.slice(7) : (await matchesFor([ref], 'google')).get(ref) ?? null;
      let how = id ? 'by its Google identifier' : null;
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
    }
    columns.push(google);

    // Tripadvisor: only where a ranking run has already made the join. A view is
    // two billed locations, so it is not made on the off-chance.
    let ta = { key: 'tripadvisor', label: 'Tripadvisor', note: null, fields: null, id: null };
    if (!tripadvisorSource.enabled()) ta.note = 'not switched on';
    else {
      const id = ref.startsWith('tripadvisor:') ? ref.slice(12) : (await matchesFor([ref], 'tripadvisor')).get(ref) ?? null;
      if (!id) ta.note = 'not asked';
      else {
        try { ta = { ...ta, id, fields: await detailFor('tripadvisor', id, household.id), note: 'fetched live · two locations billed a view' }; }
        catch (err) { ta = { ...ta, id, note: whySourceFailed('tripadvisor', err) }; }
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
    const factOf = (field) => facts.find((f) => f.field === field) ?? null;
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
          editable: Boolean(key && OURS_FIELDS.includes(key)),
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
             (select li.subject_type || ':' || li.subject_id from image_links li where li.image_id = ia.id limit 1) as on_place,
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
    res.json({
      matching: matching.n,
      pictures: rows.map((p) => ({
        id: p.id, source: p.source, licence: p.licence, licenceUrl: p.licence_url,
        creator: p.creator, creatorUrl: p.creator_url, credit: p.credit_line,
        title: p.title, caption: p.caption, page: p.source_page_url,
        width: p.width, height: p.height, bytes: p.bytes, fetchedAt: p.fetched_at,
        onPlace: p.on_place, role: p.role, fromHousehold: Boolean(p.contributor_household_id),
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
    if (req.body?.wait === true) return res.json(await index.reindex());
    res.json({ started: true });
    void index.reindex().catch(() => null);
  } catch (err) { next(err); }
});

/** Rebuild just the counts — what "Refresh the counts · 4 min ago" does. */
router.post('/refresh', requires('manage_library'), async (_req, res, next) => {
  try { res.json(await index.refreshStats()); } catch (err) { next(err); }
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
