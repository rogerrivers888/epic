/**
 * What the census found out, and what it found out about itself.
 *
 * The big census brief, 20 Sep 2026, §6. The run produces two things and the
 * second matters as much as the first: denominators — how many of a kind of
 * place there are — and **evidence about the taxonomy**. Which Google types
 * return nothing anywhere, which drawers are tiny everywhere, which questions
 * saturate constantly, and which drawers sit far below what the free sources
 * say is on the ground. That is the audit's input, and the brief is explicit
 * that it "should be captured deliberately rather than reconstructed later".
 *
 * Two rules run through all of it.
 *
 * **No number without its coverage** (§5). "A count of 2,400 for a subcategory
 * means nothing without knowing what was covered." So every count carries the
 * tiles it was drawn from, when they were censused, and whether any question
 * inside them was cut off — and the sentence that says so in words is written
 * here rather than at the screen, so two screens cannot describe the same
 * number differently.
 *
 * **Empty splits four ways, and only one of them is about the world.** A drawer
 * can be empty because nowhere it would be has been censused; because it has no
 * question at all — no Google type taught onto it and no word question, so the
 * census generates no queries and it can only ever read nought; because it has a
 * question that no run in this scope has yet asked, which is what happens to
 * every drawer for a while after somebody teaches it; or because Google was
 * asked, here, and had nothing. Only the last is a fact about the ground. The
 * other three are facts about us, and a screen that drew them the same way would
 * retire a perfectly good drawer for the sin of being new.
 *
 * Everything is read from what the census already wrote. Nothing here calls a
 * provider, so the board it feeds cannot spend a penny however often it is
 * refreshed — which is the policy's own rule for the area board.
 */

import { query } from '../db.js';
import { slicePlan, CENSUS_MAX_DEPTH } from '../sources/census.js';
import { OSM_GROUND, FHRS_GROUND } from '../sources/groundCounts.js';

/** 1204 -> "1,204". A number in a sentence is read, not parsed. */
export const n = (x) => Number(x ?? 0).toLocaleString('en-GB');

/** 21 Sep, the way a date is said out loud. */
export const day = (at) => (at ? new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null);

/**
 * Both ways a surfacing is filed, in one condition.
 *
 * The ring census wrote one row per outcode, so `place_subcategories.area_slug`
 * is an outcode; the big census writes one row per grid tile, so it is a tile
 * key and the tile carries the outcodes it covers. A findings query that read
 * only one of them would silently answer about half the census — and which half
 * would depend on when the area was last run. `repositories/censusRing.js` had
 * exactly this fault and it cost the ring board most of its places.
 */
const SURFACED_IN_SCOPE = `(
  upper(ps.area_slug) = any($1::text[])
  or ps.area_slug in (select grid_key from census_tiles where outcodes && $1::text[])
)`;
const SURFACED_ANYWHERE = 'ps.area_slug is not null';

/** The same question asked of a slice, which is filed the same two ways. */
const slicesInScope = (params) => (params.length
  ? `and (upper(cs.area_slug) = any($1::text[]) or cs.area_slug in (select grid_key from census_tiles where outcodes && $1::text[]))`
  : '');

/**
 * The coverage of a number, in words.
 *
 * Written once because §5 asks for every count to be labelled "never as a bare
 * national-looking number", and two screens writing that sentence for
 * themselves is how one of them ends up saying "1,204 golf clubs" flat.
 */
export function coverageSentence({ tiles, done, cutOff, outcodes, lastAt }) {
  if (!tiles && !outcodes) return 'nowhere censused yet';
  const where = outcodes
    ? `${n(outcodes)} district${outcodes === 1 ? '' : 's'}`
    : `${n(tiles)} tile${tiles === 1 ? '' : 's'}`;
  const when = lastAt ? `, censused ${day(lastAt)}` : '';
  const left = done < tiles ? `, ${n(tiles - done)} tile${tiles - done === 1 ? '' : 's'} still to do` : '';
  const floor = cutOff ? `, ${n(cutOff)} cut off at Google's ceiling — a floor, not a total` : '';
  return `${where}${when}${left}${floor}`;
}

/**
 * The tiles a scope is made of, which is what every count below is drawn from.
 *
 * `outcodes` null means everywhere the census has been, which is the honest
 * default for a taxonomy decision: the whole point of the run is that "golf
 * clubs · 41 places" stops being a Berkshire number.
 */
export async function coverageFor(outcodes = null) {
  const where = outcodes ? 't.outcodes && $1::text[]' : 'true';
  const params = outcodes ? [outcodes] : [];
  const { rows: [t] } = await query(
    `select count(*)::int                                     as tiles,
            count(*) filter (where t.state = 'done')::int      as done,
            count(*) filter (where t.saturated > 0)::int       as cut_off,
            coalesce(sum(t.places), 0)::int                    as places,
            min(t.censused_at)                                 as first_at,
            max(t.censused_at)                                 as last_at,
            count(*) filter (where t.osm_at is not null)::int  as osm_checked,
            count(*) filter (where t.fhrs_at is not null)::int as fhrs_checked
       from census_tiles t
      where ${where}`, params);
  const { rows: [o] } = await query(
    `select count(distinct o)::int as outcodes
       from census_tiles t, unnest(t.outcodes) o
      where ${where}`, params);
  // The districts censused the old way, before the grid. They hold real places,
  // and leaving them out would make the coverage sentence contradict the count
  // standing next to it.
  const { rows: [a] } = await query(
    `select count(distinct area_slug)::int as areas, max(censused_at) as last_at
       from area_counts
      where ${outcodes ? 'upper(area_slug) = any($1::text[])' : 'true'}`, params);

  // Compared as dates, not as strings: a text sort of two timestamps agrees
  // with time only while they share a format, and these come from two tables.
  const lastAt = [t.last_at, a.last_at].filter(Boolean)
    .sort((x, y) => new Date(x) - new Date(y)).pop() ?? null;
  const outcodesCovered = o.outcodes || a.areas || 0;

  return {
    tiles: t.tiles,
    tilesDone: t.done,
    tilesCutOff: t.cut_off,
    outcodes: o.outcodes,
    districtsCensusedByOutcode: a.areas,
    places: t.places,
    firstAt: t.first_at,
    lastAt,
    groundChecked: { osm: t.osm_checked, fhrs: t.fhrs_checked },
    // Whether a number drawn from this is a total or a floor. Anything cut off
    // anywhere, or any tile still to do, and the honest word is "at least".
    complete: t.cut_off === 0 && t.tiles === t.done,
    says: coverageSentence({ tiles: t.tiles, done: t.done, cutOff: t.cut_off, outcodes: outcodesCovered, lastAt }),
  };
}

/** Why a drawer reads the way it does, in one sentence a person can act on. */
export function reasonForState(state, { label, found, questions, coverage, slices = 0 }) {
  if (state === 'never_asked') {
    return `No question is ever asked for ${label}: no Google type is taught onto it and it has no word question, so the census generates no queries and it can only ever read nought.`;
  }
  if (state === 'never_censused') return `Nowhere ${label} would be has been censused yet.`;
  if (state === 'question_not_run') {
    return `${label} has ${n(questions)} question${questions === 1 ? '' : 's'} and no run has asked ${questions === 1 ? 'it' : 'them'} here yet, so nought means nobody has looked — not that there are none.`;
  }
  if (state === 'censused_empty') {
    return `Asked ${n(questions)} question${questions === 1 ? '' : 's'} in ${n(slices)} slice${slices === 1 ? '' : 's'} across ${coverage.says}, and Google returned nothing. Either there are none, or the question is the wrong one.`;
  }
  return `${n(found)} found across ${coverage.says}.`;
}

/**
 * Places per subcategory, with coverage — §6's first bullet, and the number
 * every taxonomy decision is currently being made without.
 *
 * `known` and `censused` are kept apart on purpose. `known` is what the index
 * holds filed under the drawer, everywhere, however it got there; `censused` is
 * how many distinct places the census surfaced under that drawer inside the
 * scope. They answer different questions — "what have we got" and "how many are
 * there" — and one pre-divided percentage would answer neither.
 */
export async function subcategories({ outcodes = null } = {}) {
  const coverage = await coverageFor(outcodes);
  const plan = await slicePlan();
  const asked = new Map(plan.map((p) => [p.subcategory, p.questions]));
  const params = outcodes ? [outcodes] : [];
  const scoped = outcodes ? SURFACED_IN_SCOPE : SURFACED_ANYWHERE;

  const { rows: subs } = await query(
    'select s.key, s.label, s.category_key as category from shelf_subcategories s where s.active order by s.category_key, s.key');
  const { rows: known } = await query(
    'select subcategory, count(*)::int as places from place_index where subcategory is not null group by 1');
  const { rows: censused } = await query(
    `select ps.subcategory, count(distinct ps.venue_ref)::int as places
       from place_subcategories ps where ${scoped} group by 1`, params);
  // Which drawers a run in this scope has actually put a question to. A
  // subcategory taught yesterday has a question and no answer, and calling that
  // "censused and empty" would be Google being blamed for a run that has not
  // happened yet. Refusals are excluded: a slice that failed is not a slice
  // that was asked and answered.
  const { rows: askedHere } = await query(
    `select cs.subcategory, count(*)::int as slices
       from census_slices cs
      where cs.problem is null ${outcodes ? slicesInScope([outcodes]) : ''}
      group by 1`, params);
  const { rows: scored } = await query(
    `select ps.subcategory, count(distinct ps.venue_ref)::int as places
       from place_subcategories ps
       join epic_scores e on e.venue_ref = ps.venue_ref
      where ${scoped} group by 1`, params);

  const askedBy = new Map(askedHere.map((r) => [r.subcategory, r.slices]));
  const knownBy = new Map(known.map((r) => [r.subcategory, r.places]));
  const censusedBy = new Map(censused.map((r) => [r.subcategory, r.places]));
  const scoredBy = new Map(scored.map((r) => [r.subcategory, r.places]));
  const anywhereCensused = coverage.tiles > 0 || coverage.districtsCensusedByOutcode > 0;

  const rows = subs.map((s) => {
    const questions = asked.get(s.key) ?? [];
    const found = censusedBy.get(s.key) ?? 0;
    const askedSlices = askedBy.get(s.key) ?? 0;
    const state = !questions.length ? 'never_asked'
      : !anywhereCensused ? 'never_censused'
        : found ? 'censused_found'
          : askedSlices ? 'censused_empty' : 'question_not_run';
    return {
      key: s.key,
      label: s.label,
      category: s.category,
      known: knownBy.get(s.key) ?? 0,
      censused: found,
      scored: scoredBy.get(s.key) ?? 0,
      questions: questions.length,
      // Whether the drawer's count comes from a text query fenced by a type
      // rather than from a type Google has a word for (`censusQuestions.js`).
      // A fenced count is narrower by construction and should be read as such.
      fenced: questions.some((q) => q.words),
      state,
      // How many times the question was actually put here, so "empty" can be
      // read against the effort behind it rather than taken on trust.
      slices: askedSlices,
      reason: reasonForState(state, { label: s.label, found, questions: questions.length, coverage, slices: askedSlices }),
    };
  });
  return { coverage, subcategories: rows };
}

/**
 * Google types that returned nothing in any tile — §6's third bullet, and free
 * evidence for the taxonomy audit.
 *
 * A type asked a hundred times that has never once returned a place is either a
 * word Google does not use in this country or a rule pointing at the wrong one.
 * Both are fixed by editing a rule, which costs nothing. What it is not is a
 * fact about the ground.
 *
 * A type in the plan that has never been *asked* is listed separately: that is
 * a coverage fact, not a taxonomy one, and confusing the two would retire a
 * perfectly good rule because no run had reached it yet.
 */
export async function silentTypes({ outcodes = null } = {}) {
  const params = outcodes ? [outcodes] : [];
  const coverage = await coverageFor(outcodes);
  const { rows } = await query(
    `select cs.google_type, cs.subcategory,
            count(*)::int                                      as slices,
            coalesce(sum(cs.returned), 0)::int                  as returned,
            count(distinct cs.area_slug)::int                   as areas,
            count(*) filter (where cs.problem is not null)::int as failed,
            max(cs.ran_at)                                      as last_at
       from census_slices cs
      where cs.google_type is not null ${slicesInScope(params)}
      group by 1, 2
      order by 4 asc, 3 desc`, params);

  const plan = await slicePlan();
  const everAsked = new Set(rows.map((r) => `${r.subcategory}|${r.google_type}`));
  const neverAsked = plan.flatMap((p) => p.questions
    .filter((q) => !everAsked.has(`${p.subcategory}|${q.type}`))
    .map((q) => ({
      type: q.type,
      subcategory: p.subcategory,
      words: q.words,
      reason: `In the plan for ${p.subcategory} and never asked anywhere — no run has reached it yet, so nothing is known about it either way.`,
    })));

  const silent = rows
    // A slice that failed is not a slice that was empty. A type whose every
    // slice was refused knows nothing about itself and must not be retired for
    // it (the census keeps the same distinction on its own rows).
    .filter((r) => r.returned === 0 && r.slices > r.failed)
    .map((r) => ({
      type: r.google_type,
      subcategory: r.subcategory,
      slices: r.slices,
      areas: r.areas,
      failed: r.failed,
      lastAt: r.last_at,
      // Where it was silent, not only how often. Ninety-six silent slices
      // across the home counties is not evidence that Google has no word for an
      // Israeli restaurant; it is evidence about the home counties, and a row
      // that did not say so would retire the type on the strength of it.
      reason: `Asked ${n(r.slices)} time${r.slices === 1 ? '' : 's'} across ${n(r.areas)} area${r.areas === 1 ? '' : 's'} and returned nothing, ever — over ${coverage.says}. Either Google does not use this word in the ground covered, or the rule points at the wrong one; both are a free fix, and neither is a fact about the country until the ground is wider.`,
    }));

  return { silent, neverAsked, coverage };
}

/**
 * Subcategories furthest below their free ground count — §6's fourth bullet.
 *
 * "A subcategory well below its ground count is a query gap, fixed by widening
 * the fan-out at no cost." The comparison is made **only over tiles that carry
 * both numbers**, because a census count over four hundred tiles set against a
 * ground count over twelve is not a shortfall, it is a mistake.
 *
 * Every row carries its caveat, from `groundCounts.js`. The open map counts a
 * crag beside a climbing wall and the register counts a school canteen beside a
 * café; a ground count presented as a target is how a census gets taught to
 * count pitches as grounds.
 */
export async function gaps({ outcodes = null, source = 'osm' } = {}) {
  if (!['osm', 'fhrs'].includes(source)) throw Object.assign(new Error('the ground count is osm or fhrs'), { status: 400 });
  const params = outcodes ? [outcodes] : [];
  const at = source === 'osm' ? 'osm_at' : 'fhrs_at';
  const { rows } = await query(
    `with checked as (
       select t.grid_key from census_tiles t
        where t.${at} is not null and t.state = 'done'
          ${outcodes ? 'and t.outcodes && $1::text[]' : ''}
     ),
     ground as (
       select g.subcategory, sum(g.places)::int as places, count(*)::int as tiles,
              max(g.counted_at) as counted_at, min(g.caveat) as caveat, min(g.asked) as asked
         from ground_counts g join checked c on c.grid_key = g.grid_key
        where g.source = $${params.length + 1}
        group by 1
     ),
     census as (
       select ps.subcategory, count(distinct ps.venue_ref)::int as places
         from place_subcategories ps join checked c on c.grid_key = ps.area_slug
        group by 1
     )
     select s.key, s.label, s.category_key as category,
            coalesce(census.places, 0) as census, ground.places as ground,
            ground.tiles, ground.counted_at, ground.caveat, ground.asked
       from ground
       join shelf_subcategories s on s.key = ground.subcategory and s.active
       left join census on census.subcategory = ground.subcategory
      order by (ground.places - coalesce(census.places, 0)) desc`, [...params, source]);

  const whose = source === 'osm' ? 'the open map' : 'the hygiene register';
  const found = rows.map((r) => {
    const shortfall = r.ground - r.census;
    const share = r.ground ? Math.round((r.census / r.ground) * 100) : null;
    return {
      key: r.key, label: r.label, category: r.category,
      census: r.census, ground: r.ground, shortfall, foundShare: share,
      tiles: r.tiles, countedAt: r.counted_at, source, asked: r.asked, caveat: r.caveat,
      reason: shortfall > 0
        ? `The census has ${n(r.census)} where ${whose} has ${n(r.ground)} in the same ${n(r.tiles)} tile${r.tiles === 1 ? '' : 's'} — ${share}% of the ground count.${r.caveat ? ` ${r.caveat}` : ''}`
        : `The census has ${n(r.census)} where ${whose} has ${n(r.ground)} in the same ${n(r.tiles)} tile${r.tiles === 1 ? '' : 's'}, so nothing is obviously missing.${r.caveat ? ` ${r.caveat}` : ''}`,
    };
  });

  // Which drawers can be checked at all. A subcategory with no free equivalent
  // is not passing the check — it is not taking it, and a screen that showed
  // only the rows above would quietly imply it had.
  const map = source === 'osm' ? OSM_GROUND : FHRS_GROUND;
  const { rows: all } = await query('select key, label from shelf_subcategories where active order by key');
  const noGroundCount = all.filter((s) => !map[s.key]).map((s) => ({
    key: s.key,
    label: s.label,
    reason: `${whose[0].toUpperCase()}${whose.slice(1)} has no equivalent of ${s.label}, so there is nothing free to check it against.`,
  }));

  return { source, gaps: found, noGroundCount, coverage: await coverageFor(outcodes) };
}

/**
 * What is still cut off — §6's last bullet, "a pacing signal for the next run".
 *
 * A slice that comes back with sixty has been cut off, and the census splits it
 * until it answers. One still saturated at the depth limit is a question the
 * grid cannot answer at this size: the count under it is a floor, and the fix is
 * a finer tile rather than another split.
 *
 * `CENSUS_MAX_DEPTH` is imported rather than copied. The first SE1 report kept
 * its own copy of the old limit and went on calling depth three "at the limit"
 * after the limit became six, which read as forty-one truncated drawers where
 * the true figure was nought (20 Sep 2026).
 */
export async function saturation({ outcodes = null, limit = 100 } = {}) {
  const params = outcodes ? [outcodes] : [];
  const scope = slicesInScope(params);
  const depthParam = `$${params.length + 1}`;
  const { rows } = await query(
    `select cs.subcategory, cs.google_type,
            count(*)::int                     as slices,
            count(distinct cs.area_slug)::int as areas,
            max(cs.ran_at)                    as last_at
       from census_slices cs
      where cs.saturated and cs.depth >= ${depthParam} ${scope}
      group by 1, 2
      order by 3 desc
      limit ${Math.min(500, Math.max(1, limit))}`, [...params, CENSUS_MAX_DEPTH]);
  const { rows: [all] } = await query(
    `select count(*)::int as slices,
            count(*) filter (where cs.saturated)::int as saturated,
            count(*) filter (where cs.saturated and cs.depth >= ${depthParam})::int as at_limit
       from census_slices cs where true ${scope}`, [...params, CENSUS_MAX_DEPTH]);

  return {
    depthLimit: CENSUS_MAX_DEPTH,
    slices: all.slices,
    saturated: all.saturated,
    atLimit: all.at_limit,
    coverage: await coverageFor(outcodes),
    rows: rows.map((r) => ({
      subcategory: r.subcategory, type: r.google_type, slices: r.slices, areas: r.areas, lastAt: r.last_at,
      reason: `${n(r.slices)} slice${r.slices === 1 ? '' : 's'} still cut off at Google's sixty after ${CENSUS_MAX_DEPTH} splits, across ${n(r.areas)} area${r.areas === 1 ? '' : 's'}. Every count under this question is a floor.`,
    })),
  };
}
