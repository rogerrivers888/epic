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
  // Every district covered either way, counted once. The grid and the old
  // per-outcode runs cover different ground and overlap in places, so adding
  // the two would double-count and taking the larger would drop the rest — and
  // the sentence would then contradict the count beside it, which is the exact
  // failure §5 exists to stop.
  const { rows: [u] } = await query(
    `select count(*)::int as outcodes from (
       select distinct upper(o) as code from census_tiles t, unnest(t.outcodes) o where ${where}
       union
       select distinct upper(area_slug) from area_counts
        where ${outcodes ? 'upper(area_slug) = any($1::text[])' : 'true'}
     ) covered`, params);
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
  const outcodesCovered = u.outcodes || 0;

  return {
    tiles: t.tiles,
    tilesDone: t.done,
    tilesCutOff: t.cut_off,
    outcodes: o.outcodes,
    districtsCensusedByOutcode: a.areas,
    // Both ways, counted once: what the coverage sentence is drawn from.
    districtsCovered: outcodesCovered,
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
export function reasonForState(state, { label, found, questions, coverage, slices = 0, byText = 0, byWords = 0, mixed = null }) {
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
  // Asked in plain words because Google has no word for the drawer: the places
  // are whatever the words matched, and nothing checked the kind. Said on the
  // row rather than in a footnote, because the number is only as good as the
  // words and the only way to know is to open a few.
  const how = byText
    ? ` ${n(byText)} of them found by a plain text query with no type to fence it, so open a few before trusting the number.`
    : byWords ? ` ${n(byWords)} of them found by words fenced to a Google type.` : '';
  // Asked one way here and another way there: the sum is of two questions, and
  // saying so is the only honest thing to do with it until the census has been
  // re-asked over the tiles that had the old one.
  // Two different things, and only one of them fixes itself. A tile of the grid
  // is re-opened and re-asked by the run; a district censused the old way, one
  // box per outcode, is in no run and nothing will go back for it.
  const behind = [];
  if (mixed?.tiles) behind.push(`${n(mixed.tiles)} tile${mixed.tiles === 1 ? '' : 's'} of the grid`);
  if (mixed?.districtsRunning) behind.push(`${n(mixed.districtsRunning)} district${mixed.districtsRunning === 1 ? '' : 's'} censused before the grid and now being covered by it`);
  if (mixed?.districtsAlone) behind.push(`${n(mixed.districtsAlone)} district${mixed.districtsAlone === 1 ? '' : 's'} no tile covers, which no run will go back for`);
  // A drawer whose only laggards are superseded districts is not behind
  // anything: the grid has asked those questions over the same ground.
  const same = behind.length
    ? ` ${behind.join(' and ')} ${behind.length === 1 && mixed.tiles === 1 ? 'was' : 'were'} censused before ${n(mixed.questions)} of this drawer's question${mixed.questions === 1 ? '' : 's'} existed and ${behind.length === 1 && mixed.tiles === 1 ? 'has' : 'have'} never been asked ${mixed.questions === 1 ? 'it' : 'them'}, so this is a sum of more than one question and not yet a denominator.`
    : '';
  return `${n(found)} found across ${coverage.says}.${how}${same}`;
}


/**
 * Drawers that were not asked the same question everywhere.
 *
 * A census is only a denominator if every tile was asked the same thing. It is
 * not, always: a tile is re-opened when the plan gains a *drawer*, but not when
 * an existing drawer gains a *question* — so four subcategories asked in plain
 * words today would keep those answers in every tile already done if somebody
 * taught them a Google type tomorrow, while later tiles answered a different
 * question entirely (epic-71, 21 Sep 2026).
 *
 * That is not something this file can fix and it is not something it may hide.
 * A count summed across tiles that were asked different questions is not one
 * number, and a comparison against a ground count is then measuring two things
 * at once. So it is detected — by the set of questions each tile was actually
 * asked for the drawer — and it travels with the count as a caveat.
 *
 * A tile that missed a question which already existed was cut short by a quota
 * — that is coverage, and the coverage sentence already says it. The difference
 * this looks for is a tile censused *before* a question existed at all, which is
 * the plan having changed underneath the census and cannot be read off the
 * counts (Codex, 21 Sep 2026, on both halves of getting this wrong).
 */
export async function askedDifferently({ outcodes = null } = {}) {
  const params = outcodes ? [outcodes] : [];
  const { rows } = await query(
    `with asked as (
       -- A question is a type *and* the words sent with it. Keyed on the type
       -- alone, a tile asked "sports_activity_location + climbing wall" and one
       -- asked "sports_activity_location + bouldering centre" had the same
       -- signature, so the detector missed exactly the change it was written to
       -- catch (Codex, 21 Sep 2026).
       --
       -- Refused slices are kept here, because a slice that failed is still a
       -- question that was *asked*; leaving them out made a tile whose one
       -- question was refused look like a tile asked a different question.
       select cs.subcategory, cs.area_slug,
              coalesce(cs.google_type, '') || '|' || coalesce(cs.query, '') as q,
              min(cs.ran_at) as at
         from census_slices cs
        where true ${slicesInScope(params)}
        group by 1, 2, 3
     ),
     first_asked as (
       select subcategory, q, min(at) as first_at from asked group by 1, 2
     ),
     tile as (
       select subcategory, area_slug, max(at) as ran_at from asked group by 1, 2
     ),
     behind as (
       -- A tile that was censused *before* one of this drawer's questions
       -- existed anywhere, and has never been asked it. That is the plan having
       -- changed underneath the census, and it is the only difference worth
       -- warning about: a tile that missed a question which already existed was
       -- cut short by a quota, which is coverage, and the coverage sentence
       -- already says so.
       select t.subcategory, t.area_slug, f.q
         from tile t
         join first_asked f on f.subcategory = t.subcategory and f.first_at > t.ran_at
        where not exists (
          select 1 from asked a
           where a.subcategory = t.subcategory and a.area_slug = t.area_slug and a.q = f.q)
     ),
     covered as (
       -- A district censused the old way is not necessarily abandoned: the grid
       -- may cover the same ground under different keys. So each one is asked
       -- how much of it the grid has done — all of it, some of it, or none.
       -- All 41 of the ring's districts turned out to be inside this run's
       -- region (epic-71, 21 Sep 2026), which makes "no run will go back for
       -- it" false for every one of them, and that sentence was on the board.
       select b.area_slug,
              count(t.grid_key)::int                                        as tiles,
              count(*) filter (where t.state = 'done')::int                 as done
         from (select distinct area_slug from behind) b
         left join census_tiles t on t.outcodes @> array[upper(b.area_slug)]
        group by 1
     )
     select b.subcategory,
            -- A tile of the grid, which the run re-opens and re-asks itself.
            count(distinct b.area_slug) filter (where t.grid_key is not null)::int as tiles,
            -- A district the grid has finished covering. Its questions have
            -- been asked, on better-shaped ground, under another key: it is
            -- superseded rather than behind, and saying otherwise would leave a
            -- warning on the board for ever with nothing anybody could do about
            -- it.
            count(distinct b.area_slug) filter (
              where t.grid_key is null and c.tiles > 0 and c.done = c.tiles)::int as superseded,
            -- One the grid is still working through.
            count(distinct b.area_slug) filter (
              where t.grid_key is null and c.tiles > 0 and c.done < c.tiles)::int as districts_running,
            -- And one no tile covers at all, which is the only case where
            -- nothing is going to go back for it.
            count(distinct b.area_slug) filter (
              where t.grid_key is null and coalesce(c.tiles, 0) = 0)::int          as districts_alone,
            count(distinct b.q)::int as questions
       from behind b
       left join census_tiles t on t.grid_key = b.area_slug
       left join covered c on c.area_slug = b.area_slug
      group by 1`, params);
  return new Map(rows.map((r) => [r.subcategory, {
    tiles: r.tiles,
    superseded: r.superseded,
    districtsRunning: r.districts_running,
    districtsAlone: r.districts_alone,
    districts: r.districts_running + r.districts_alone,
    questions: r.questions,
  }]));
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
  // How the count was got, not only how big it is. A drawer Google has no word
  // for is asked in plain words, and a place only a text query found is a place
  // Google never confirmed the kind of — so the number has to say so, or
  // somebody reads "42 historic houses" as forty-two houses (owner, 21 Sep
  // 2026: open twenty in Places and judge the precision before trusting it).
  const { rows: censused } = await query(
    `select ps.subcategory,
            count(distinct ps.venue_ref)::int as places,
            count(distinct ps.venue_ref) filter (where ps.sourced = 'text')::int  as by_text,
            count(distinct ps.venue_ref) filter (where ps.sourced = 'words')::int as by_words
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
  const mixed = await askedDifferently({ outcodes });
  const knownBy = new Map(known.map((r) => [r.subcategory, r.places]));
  const censusedBy = new Map(censused.map((r) => [r.subcategory, r.places]));
  const howFound = new Map(censused.map((r) => [r.subcategory, { text: r.by_text, words: r.by_words }]));
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
      // And how many of the places actually came that way. `words` is fenced by
      // a real Table A type and Google confirms the kind; `text` is not fenced
      // at all, because the drawer has no type to fence it with, so those are
      // the ones to open before the number is trusted.
      byText: howFound.get(s.key)?.text ?? 0,
      byWords: howFound.get(s.key)?.words ?? 0,
      // Whether every tile was asked the same thing. A count summed over tiles
      // that were asked different questions is not one number.
      askedDifferently: (mixed.get(s.key)?.tiles ?? 0) + (mixed.get(s.key)?.districts ?? 0),
      // Counted but never added to the total: their questions have been asked
      // on the grid, over the same ground, under a different key.
      superseded: mixed.get(s.key)?.superseded ?? 0,
      behind: mixed.get(s.key) ?? null,
      state,
      // How many times the question was actually put here, so "empty" can be
      // read against the effort behind it rather than taken on trust.
      slices: askedSlices,
      reason: reasonForState(state, {
        label: s.label, found, questions: questions.length, coverage, slices: askedSlices,
        byText: howFound.get(s.key)?.text ?? 0, byWords: howFound.get(s.key)?.words ?? 0,
        mixed: mixed.get(s.key) ?? null,
      }),
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
      // What was actually asked and answered, and what never got that far.
      slices: r.slices - r.failed,
      areas: r.areas,
      failed: r.failed,
      lastAt: r.last_at,
      // Where it was silent, not only how often. Ninety-six silent slices
      // across the home counties is not evidence that Google has no word for an
      // Israeli restaurant; it is evidence about the home counties, and a row
      // that did not say so would retire the type on the strength of it.
      // Asked, and separately refused. Nine thousand of the refusals in this
      // table are one incident — yesterday's ring census firing past the daily
      // cap because nothing read the answer — and folding them into "asked"
      // would put that incident's weight behind a recommendation to retire a
      // rule (21 Sep 2026).
      reason: `Asked ${n(r.slices - r.failed)} time${r.slices - r.failed === 1 ? '' : 's'} across ${n(r.areas)} area${r.areas === 1 ? '' : 's'} and returned nothing, ever${r.failed ? `, with ${n(r.failed)} more refused before they could answer` : ''} — over ${coverage.says}. Either Google does not use this word in the ground covered, or the rule points at the wrong one; both are a free fix, and neither is a fact about the country until the ground is wider.`,
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
export async function gaps({ outcodes = null, source = 'osm', staleDays = 30 } = {}) {
  if (!['osm', 'fhrs'].includes(source)) throw Object.assign(new Error('the ground count is osm or fhrs'), { status: 400 });
  const params = outcodes ? [outcodes] : [];
  const at = source === 'osm' ? 'osm_at' : 'fhrs_at';
  const { rows } = await query(
    `with checked as (
       -- Censused at some point and ground-counted, rather than sitting in
       -- state 'done' right now. A tile is re-opened whenever the plan gains a
       -- drawer, which during a run is most of them — and a comparison that
       -- vanished while the census was working would be blank exactly when
       -- somebody is watching it (21 Sep 2026).
       select t.grid_key from census_tiles t
        where t.${at} is not null and t.censused_at is not null
          ${outcodes ? 'and t.outcodes && $1::text[]' : ''}
     ),
     ground as (
       select g.subcategory, sum(g.places)::int as places,
              -- Tiles, not rows. A tile on a council boundary carries one row
              -- per council (migration 230); counting rows would claim the
              -- comparison covered more ground than it did, which is the one
              -- thing this query exists to get right.
              count(distinct g.grid_key)::int as tiles,
              max(g.counted_at) as counted_at,
              -- And the oldest, because a sum is only as fresh as its stalest
              -- part. The register is counted per council and the open map per
              -- box; a total whose newest component is today and whose oldest
              -- is from August is not "as it stands today", and saying so would
              -- be the reader making the same mistake the sweep was making
              -- (owner, 21 Sep 2026 — a stale ground count reads as agreement).
              min(g.counted_at) as oldest_at,
              min(g.caveat) as caveat, min(g.asked) as asked
         from ground_counts g join checked c on c.grid_key = g.grid_key
        where g.source = $${params.length + 1}
        group by 1
     ),
     census as (
       select ps.subcategory, count(distinct ps.venue_ref)::int as places,
              count(distinct ps.venue_ref) filter (where ps.sourced = 'text')::int as by_text
         from place_subcategories ps join checked c on c.grid_key = ps.area_slug
        group by 1
     )
     select s.key, s.label, s.category_key as category,
            coalesce(census.places, 0) as census, coalesce(census.by_text, 0) as by_text,
            ground.places as ground,
            ground.tiles, ground.counted_at, ground.oldest_at, ground.caveat, ground.asked
       from ground
       join shelf_subcategories s on s.key = ground.subcategory and s.active
       left join census on census.subcategory = ground.subcategory
      order by (ground.places - coalesce(census.places, 0)) desc`, [...params, source]);

  const whose = source === 'osm' ? 'the open map' : 'the hygiene register';
  const mixed = await askedDifferently({ outcodes });
  const found = rows.map((r) => {
    const shortfall = r.ground - r.census;
    const share = r.ground ? Math.round((r.census / r.ground) * 100) : null;
    // "As it stands today" is only true while every part of the sum is inside
    // the freshness window. Past it the sentence names the day instead, so a
    // number nobody has refreshed cannot pass itself off as this morning's.
    const oldest = r.oldest_at ? new Date(r.oldest_at) : null;
    const stale = oldest ? Date.now() - oldest.getTime() > staleDays * 86_400_000 : false;
    const asOf = stale ? `as it was counted on ${day(r.oldest_at)}` : 'as it stands today';
    return {
      key: r.key, label: r.label, category: r.category,
      census: r.census, byText: r.by_text, ground: r.ground, shortfall, foundShare: share,
      tiles: r.tiles, countedAt: r.counted_at, oldestAt: r.oldest_at, stale, source, asked: r.asked, caveat: r.caveat,
      askedDifferently: (mixed.get(r.key)?.tiles ?? 0) + (mixed.get(r.key)?.districts ?? 0),
      // Both sides say what they are. The census side is everything it has ever
      // found in these tiles; the free side is the source as it stands today.
      // Neither is "the number of places here", and two numbers with the same
      // name on one screen is the thing to avoid (epic-71, 21 Sep 2026).
      reason: shortfall > 0
        ? `The census has found ${n(r.census)} in all${r.by_text ? `, ${n(r.by_text)} of them from a plain text query` : ''}, where ${whose} has ${n(r.ground)} ${asOf} — the same ${n(r.tiles)} tile${r.tiles === 1 ? '' : 's'}, ${share}% of the ground count.${r.caveat ? ` ${r.caveat}` : ''}`
        : `The census has found ${n(r.census)} in all, where ${whose} has ${n(r.ground)} ${asOf} over the same ${n(r.tiles)} tile${r.tiles === 1 ? '' : 's'}, so nothing is obviously missing.${r.caveat ? ` ${r.caveat}` : ''}`,
      // Appended rather than folded in, so a gap computed against a census that
      // asked two different questions cannot be read as a measurement.
      ...(mixed.get(r.key)?.tiles ? { warning: `${n(mixed.get(r.key).tiles)} of these tiles were censused before ${n(mixed.get(r.key).questions)} of this drawer's questions existed and have never been asked them, so the shortfall is not yet a measurement of anything.` } : {}),
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

  return {
    source,
    // What is being subtracted from what, in one line, because the two sides
    // answer different questions and a shortfall read as "places we are
    // missing" would be the wrong subtraction.
    reading: `Everything the census has found in these tiles, against ${whose} as it stands today. Neither side is a count of what is there; the gap is where to look.`,
    gaps: found,
    noGroundCount,
    coverage: await coverageFor(outcodes),
  };
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
