/**
 * What recurs across a drawer, asked once per drawer.
 *
 * The first harvest asked nothing. It tokenised every place's text on its own,
 * counted the tokens, and called the result a vocabulary: 46,000 "features"
 * over two runs, **nought of them promotable**, because a word seen on one
 * place cannot tell two places apart and almost every word was seen on one
 * place. What came out was a menu reader and a stop-word list — `prawn
 * linguine`, `by-sa`, `mo-su`, `bristol`, `around`.
 *
 * So the unit of the question changes (owner, 21 Sep 2026): **extract per
 * subcategory, not per word.** Pool the sampled places' text for one drawer,
 * ask the model *once* which facilities or physical features recur across
 * them, take a short evidence quote for each, and then **count each proposed
 * feature across the places ourselves**.
 *
 * That last step is the half that makes it trustworthy, and it is deliberately
 * not the model's job. The model proposes; the corpus counts. A feature the
 * model was confident about and that appears in one place's text is a feature
 * seen on one place, and it will fail the sightings floor exactly as it should
 * — no matter how sure the answer sounded.
 *
 * Three things never reach the model:
 *
 *   · **boilerplate** — licence footers, opening-hours syntax, page furniture
 *     and the place's own name, stripped first (`domain/boilerplate.js`);
 *   · **menus** — a dish is not a facility. What a menu says about a place is
 *     its cuisine, which has its own vocabulary and its own path, so menu text
 *     is routed there and never to the feature path;
 *   · **rented text itself**, beyond the moment of the call. It is read in
 *     memory, the evidence quote is kept only against a candidate under
 *     review, and nothing else is written down.
 */

import { z } from 'zod/v4';

import { MODEL, SESSION_CALL_BOUND, parseStructured } from '../claude.js';
import { query } from '../db.js';
import { asserted, looksLikeMenu, namesOf, strip } from '../domain/boilerplate.js';
import * as sets from '../repositories/questionSets.js';

/** Places sampled per drawer. Twenty is the brief's number. */
export const SAMPLE_SIZE = 20;

/**
 * What one call may propose.
 *
 * Capped, because an unbounded list is how a model turns a thin drawer into
 * forty guesses. Twelve is more than any question set should ever hold — the
 * Labels tab draws eight as too many — so the cap never binds on a good drawer
 * and always binds on a hallucinating one.
 */
export const MOST_PER_DRAWER = 12;

/**
 * The shape an answer has to have.
 *
 * `evidence` is required and is checked against the pooled text before the
 * feature is kept: a quote that is not in the corpus means the model wrote the
 * feature rather than found it, and that one is dropped. It is the cheapest
 * hallucination check available and it costs nothing extra to ask for.
 */
const Feature = z.object({
  name: z.string().describe('The feature, two or three words, as a household would say it. "Wave machine", not "the wave machine at this venue".'),
  kind: z.enum(['facility', 'physical']).describe('facility: something provided — a café, a hire shop, parking. physical: something the place has — a waterfall, a summit, a beach.'),
  evidence: z.string().describe('A short quote from the text, copied exactly, showing this feature being described at one of the places.'),
});

const Answer = z.object({
  features: z.array(Feature).max(MOST_PER_DRAWER),
  /** Said out loud so a thin drawer reports itself rather than inventing. */
  tooThin: z.boolean().describe('True when the pooled text does not describe enough to say what recurs.'),
});

const SYSTEM = `You are reading descriptions of several places that belong to the same category, to work out which facilities or physical features RECUR ACROSS THEM.

You are building a short list of questions that will be asked of every place of this kind. A good feature is one where knowing the answer would help somebody choose between two of these places.

Rules:
- A feature must appear at more than one place. If something is described at only one place, leave it out.
- A feature is a FACILITY (something provided: a café, parking, a hire shop, a lift) or a PHYSICAL FEATURE (something the place has: a waterfall, a summit, a beach, a lake).
- Never a dish, a menu item, or a cuisine. Never an opinion ("friendly staff", "lovely views"). Never a condition ("busy at weekends"). Never a place name, a town or a county.
- Prefer two or three words, in the words a household would use.
- Copy the evidence quote exactly from the text. Do not paraphrase it.
- If the text is too thin to say what recurs, set tooThin and return no features. That is a real answer and a better one than guessing.`;

/**
 * The places to read for one drawer, the best-described first.
 *
 * Three sources, and the third is the one that matters most. `place_records`
 * is what `sources/own.js` researched from the venue's own page; `attractions`
 * is the atlas — the open encyclopedias — and on this estate it holds four
 * times as much long text as the records do. The free sweep already reads it
 * and calls it "the richest free material there is"; reading only the records
 * costed a 65-drawer job as a 14-drawer one, because most drawers looked empty
 * when they were merely being read in the wrong place.
 *
 * An atlas place is in the index under its own id (`atlas:<uuid>`) *and* in
 * `attractions` under the ref it was matched to, so both ways in are needed or
 * half the atlas is invisible — the same trap `heldTextFor` documents.
 *
 * Places with nothing written about them anywhere are not sampled: they
 * contribute no evidence and would only flatter the drawer's denominator.
 */
async function placesFor(subcategory, { size = SAMPLE_SIZE } = {}) {
  const { rows } = await query(
    `select p.venue_ref,
            r.name,
            r.postcode,
            r.accessibility,
            r.experiences,
            concat_ws(' ', r.summary, a.summary) as summary
       from place_index p
       left join place_records r on r.venue_ref = p.venue_ref
       left join lateral (
         select at.summary
           from attractions at
          where at.venue_ref = p.venue_ref
             or ('atlas:' || at.id::text) = p.venue_ref
          order by length(at.summary) desc nulls last
          limit 1
       ) a on true
      where p.subcategory = $1
        and length(concat_ws(' ', r.summary, a.summary)) > 80
      order by length(concat_ws(' ', r.summary, a.summary)) desc
      limit $2`,
    [subcategory, size],
  );
  return rows;
}

/** A list column, however the record happens to hold it. */
const listOf = (v) => (Array.isArray(v) ? v : []).map((x) => String(x)).filter(Boolean);


/** One place's text, cleaned, with menus routed away from the feature path. */
export function textOf(place) {
  const names = namesOf({ name: place.name, town: place.postcode });
  const parts = [];
  let menus = 0;
  // The owned description, plus the two list columns that describe rather than
  // identify. Accessibility is a set of keys, not prose, so it is joined into
  // one — "step free, hearing loop" reads as a sentence to the extractor and
  // carries exactly the facilities this run is looking for.
  const said = [
    place.summary,
    listOf(place.experiences).join(', '),
    asserted(place.accessibility).join(', '),
  ];
  for (const raw of said) {
    if (!raw) continue;
    // A dish is not a facility. What a menu says about a place is its cuisine,
    // which has its own vocabulary and its own path.
    if (looksLikeMenu(raw)) { menus += 1; continue; }
    const clean = strip(raw, { names });
    if (clean) parts.push(clean);
  }
  return { text: parts.join(' '), menus };
}

/**
 * The pooled text for one drawer, and what it cost to build.
 *
 * Numbered, because the model is asked which features recur *across places* and
 * it has to be able to see where one ends and the next begins.
 */
export function poolFor(places) {
  const kept = [];
  let menus = 0;
  for (const place of places) {
    const { text, menus: m } = textOf(place);
    menus += m;
    if (text) kept.push({ ref: place.venue_ref, text });
  }
  const pooled = kept.map((p, i) => `--- place ${i + 1} ---\n${p.text}`).join('\n\n');
  return { pooled, kept, menus };
}

/**
 * How often each proposed feature actually appears, counted by us.
 *
 * The model proposes; the corpus counts. Matched on the feature's words rather
 * than the whole phrase, so "wave machine" finds "the wave machine" and "wave
 * machines" without finding a place that merely says "machine".
 */
export function countAcross(feature, kept) {
  const words = String(feature.name).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  if (!words.length) return { seen: 0, on: [] };
  // Every word of the feature, as a *word*. `includes` let each token match
  // inside an unrelated one, so "wave machine" counted a place that said
  // "waveform" and "machinery" — two substrings, no feature, and the corpus
  // check this function exists to be had been defeated (Codex, 21 Sep 2026).
  //
  // A trailing `s` or `es` is allowed, because "wave machines" and "wave
  // machine" are the same feature and a household says both.
  const res = words.map((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:e?s)?\\b`, 'i'));
  const on = [];
  for (const place of kept) {
    if (res.every((re) => re.test(place.text))) on.push(place.ref);
  }
  return { seen: on.length, on };
}

/**
 * Two places is the least that can show something recurring.
 *
 * Used by the estimate and by the run, so the number a run is confirmed against
 * is the number of calls it will actually make.
 */
export const ENOUGH_TO_ASK = 2;

/** Is the evidence quote actually in the text we sent? */
/** The most a quote may run to. Longer is not a "short evidence quote". */
export const QUOTE_MAX = 240;

const normalised = (text) => String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

export function evidenced(feature, pooled) {
  const quote = normalised(feature.evidence);
  // The whole quote, not its opening. Checking the first sixty characters
  // let a genuine opening carry an invented ending into the table, where it
  // would be shown as an owned-source quote (Codex, 25 Sep 2026). Over the
  // stored length it is refused rather than trimmed, because a trimmed quote
  // is not the one that was checked either.
  if (quote.length < 8 || quote.length > QUOTE_MAX) return false;
  return normalised(pooled).includes(quote);
}

/**
 * Which place the quote was taken from.
 *
 * The quote is stored now (migration 247, owner 25 Sep 2026: "a candidate I
 * can certify but not read is one I cannot approve"), and a quote is worth
 * more with the place it came from beside it. The pooled text is the places'
 * text joined, so the first kept place whose own text holds the quote is the
 * one — and null, honestly, if the quote crossed a boundary and belongs to
 * nobody, which `evidenced` allows and this does not pretend about.
 */
export function quotedFrom(feature, kept) {
  const quote = normalised(feature.evidence);
  if (quote.length < 8 || quote.length > QUOTE_MAX) return null;
  const hit = kept.find((k) => normalised(k.text).includes(quote));
  return hit?.ref ?? null;
}

/**
 * What the run would cost, before it runs.
 *
 * Estimated from the pooled text rather than guessed: characters over a
 * tokens-per-character ratio, at the model's own published rate. It is an
 * estimate and says so — the output side especially, which cannot be known
 * until the model answers — but it is built from the actual corpus and is the
 * number the run is confirmed against.
 */
const CHARS_PER_TOKEN = 3.6;
const SYSTEM_TOKENS = Math.ceil(SYSTEM.length / CHARS_PER_TOKEN);
/** A full answer at the cap: twelve features, a name, a kind and a quote each. */
const OUTPUT_TOKENS = 700;
const USD = { input: 5 / 1_000_000, output: 25 / 1_000_000 };
const GBP_PER_USD = 0.79;

export async function estimate({ subcategories = null, size = SAMPLE_SIZE } = {}) {
  /**
   * One aggregate query, not one per drawer.
   *
   * The first version called `placesFor` for every drawer — seventy-three
   * round trips, each pulling twenty places' full text through a lateral join
   * over the atlas — and timed out at five and a half minutes against
   * production. Nothing about an estimate needs the text itself; it needs how
   * much of it there is. So the length is summed in the database and the text
   * stays there.
   *
   * `size` is applied with a window rather than a limit, because the estimate
   * has to measure the same twenty places the run will read — the longest
   * descriptions — and not all of them.
   */
  const { rows } = await query(
    `with said as (
       select p.subcategory,
              length(concat_ws(' ', r.summary, a.summary)) as len,
              row_number() over (
                partition by p.subcategory
                order by length(concat_ws(' ', r.summary, a.summary)) desc
              ) as rank
         from place_index p
         left join place_records r on r.venue_ref = p.venue_ref
         left join lateral (
           select at.summary
             from attractions at
            where at.venue_ref = p.venue_ref
               or ('atlas:' || at.id::text) = p.venue_ref
            order by length(at.summary) desc nulls last
            limit 1
         ) a on true
         join shelf_subcategories s on s.key = p.subcategory and s.active
        where length(concat_ws(' ', r.summary, a.summary)) > 80
          ${subcategories?.length ? 'and p.subcategory = any($2)' : ''}
     )
     select subcategory, count(*)::int as places, sum(len)::bigint as chars
       from said
      where rank <= $1
      group by 1
     having count(*) >= ${ENOUGH_TO_ASK}
      order by count(*) desc`,
    subcategories?.length ? [size, subcategories] : [size],
  );

  const drawers = rows.map((r) => ({
    subcategory: r.subcategory,
    places: r.places,
    // This drawer's own estimate, not the running total.
    inputTokens: SYSTEM_TOKENS + Math.ceil(Number(r.chars) / CHARS_PER_TOKEN),
  }));
  const inputTokens = drawers.reduce((n, d) => n + d.inputTokens, 0);
  const calls = drawers.length;
  const outputTokens = calls * OUTPUT_TOKENS;
  const usd = inputTokens * USD.input + outputTokens * USD.output;
  return {
    calls,
    model: MODEL,
    places: drawers.reduce((n, d) => n + d.places, 0),
    inputTokens,
    outputTokens,
    costUsd: Number(usd.toFixed(2)),
    costGbp: Number((usd * GBP_PER_USD).toFixed(2)),
    // The output half is the estimate's soft edge and the note says so.
    basis: `${calls} calls · input measured from the pooled text · output assumed at ${OUTPUT_TOKENS} tokens a call`,
    drawers,
  };
}

/** Drawers worth asking about: active, and with places that have text. */
export async function harvestable({ subcategories = null } = {}) {
  const { rows } = await query(
    `select s.key, s.label, count(*) as places
       from shelf_subcategories s
       join place_index p on p.subcategory = s.key
       left join place_records r on r.venue_ref = p.venue_ref
       left join lateral (
         select at.summary
           from attractions at
          where at.venue_ref = p.venue_ref
             or ('atlas:' || at.id::text) = p.venue_ref
          order by length(at.summary) desc nulls last
          limit 1
       ) a on true
      where s.active
        and length(concat_ws(' ', r.summary, a.summary)) > 80
        ${subcategories?.length ? 'and s.key = any($1)' : ''}
      group by 1, 2
      having count(*) >= ${ENOUGH_TO_ASK}
      order by count(*) desc`,
    subcategories?.length ? [subcategories] : [],
  );
  return rows;
}

/**
 * Ask one drawer what recurs across it.
 *
 * Returns the features that survived both checks — the evidence quote is in
 * the corpus, and the feature is actually on more than one place — with the
 * count we made ourselves rather than the one the model implied.
 */
export async function featuresIn(subcategory, { size = SAMPLE_SIZE, householdId = null, sessionId = null } = {}) {
  const places = await placesFor(subcategory, { size });
  const { pooled, kept, menus } = poolFor(places);
  if (kept.length < ENOUGH_TO_ASK) {
    // Two places cannot show what recurs. Saying so is a real answer.
    return { subcategory, read: kept.length, menusSkipped: menus, features: [], tooThin: true, why: 'fewer than two places have text to read' };
  }

  const meta = {};
  const answer = await parseStructured({
    system: SYSTEM,
    messages: [{ role: 'user', content: `These are all ${subcategory}. Which facilities or physical features recur across them?\n\n${pooled}` }],
    schema: Answer,
    householdId,
    sessionId,
    purpose: 'harvest.features',
    effort: 'medium',
    maxTokens: 2048,
    meta,
  });

  const features = [];
  for (const f of answer.features ?? []) {
    // A quote that is not in the corpus means the model wrote the feature
    // rather than found it.
    if (!evidenced(f, pooled)) continue;
    const { seen, on } = countAcross(f, kept);
    // The corpus decides. A feature on one place cannot tell two places apart,
    // whatever the answer sounded like.
    if (seen < 2) continue;
    features.push({ name: f.name.trim(), kind: f.kind, evidence: f.evidence, from: quotedFrom(f, kept), seen, of: kept.length, on });
  }

  return {
    subcategory,
    read: kept.length,
    menusSkipped: menus,
    features: features.sort((a, b) => b.seen - a.seen),
    tooThin: Boolean(answer.tooThin) && features.length === 0,
    proposed: (answer.features ?? []).length,
    costUsd: meta.costUsd ?? 0,
  };
}

/**
 * The whole run: one call per drawer, and the candidates it earned.
 *
 * `confirm` has to equal the number of calls the estimate reported, so the only
 * way to start it is to have read what it costs — the same gate the Google
 * pass uses, and for the same reason.
 */
export async function run({ subcategories = null, size = SAMPLE_SIZE, confirm = null, householdId = null, sessionId = null, onProgress = null } = {}) {
  const plan = await estimate({ subcategories, size });
  if (Number(confirm) !== plan.calls) {
    const err = new Error(`This run is ${plan.calls} calls at about £${plan.costGbp}. Confirm with that number to run it.`);
    err.code = 'confirm_required';
    err.status = 409;
    err.plan = plan;
    throw err;
  }

  /**
   * A run longer than the session allowance would spend and then die.
   *
   * `parseStructured` asserts the session bound before every call, so a
   * fifty-nine drawer run on one session pays for the first forty, writes
   * their candidates, and then fails — with no resume, and the money already
   * gone (Codex, 21 Sep 2026). Refused up front, with the number that would
   * fit, rather than discovered two thirds of the way through.
   */
  if (sessionId && plan.calls > SESSION_CALL_BOUND) {
    const err = new Error(
      `This run is ${plan.calls} calls and a session may make ${SESSION_CALL_BOUND}. `
      + 'Scope it to fewer subcategories, or run it without a session.');
    err.code = 'over_session_bound';
    err.status = 409;
    err.plan = plan;
    throw err;
  }

  const drawers = await harvestable({ subcategories });
  const runRow = await sets.startRun({
    kind: 'features',
    subcategories: drawers.map((d) => d.key),
    params: { size, calls: plan.calls, estimateGbp: plan.costGbp },
  });

  const funnel = { read: 0, raw: 0, collapsed: 0, stored: 0, fresh: 0, held: 0, ignored: 0 };
  const report = [];
  let usd = 0;
  try {
    for (const d of drawers) {
      const out = await featuresIn(d.key, { size, householdId, sessionId });
      usd += out.costUsd ?? 0;
      funnel.read += out.read;
      funnel.raw += out.proposed ?? 0;
      funnel.collapsed += out.features.length;

      if (out.features.length) {
        const written = await sets.recordCandidates(d.key, out.features.map((f) => ({
          norm: f.name.toLowerCase(),
          raw: f.name,
          rawForms: [f.name],
          sources: new Set(['features']),
          examples: f.on.slice(0, 5),
          // The quote, and the place it was read from. Owned text, so it may
          // be kept; `recordCandidates` refuses one that arrives with a rented
          // source, which this path never carries.
          evidence: f.evidence,
          evidenceRef: f.from,
          placesSeen: f.seen,
          // Proposed and counted, never denied: this path reads descriptions
          // rather than reviews, and a description does not say a place has
          // *not* got something.
          asserts: f.seen, denies: 0, asks: 0,
        })), { placesTotal: out.read });
        funnel.stored += written.touched ?? 0;
        funnel.fresh += written.stored ?? 0;
        funnel.held += written.held ?? 0;
        funnel.ignored += written.skipped ?? 0;
      }

      report.push({
        subcategory: d.key, read: out.read, proposed: out.proposed ?? 0,
        kept: out.features.length, menusSkipped: out.menusSkipped, tooThin: out.tooThin,
      });
      await sets.noteRun(runRow.id, { funnel, places: funnel.read, candidates: funnel.collapsed, costUsd: usd });
      onProgress?.({ subcategory: d.key, done: report.length, of: drawers.length });
    }
    await sets.finishRun(runRow.id, {
      places: funnel.read, calls: plan.calls, candidates: funnel.collapsed, costUsd: usd, funnel,
    });
  } catch (err) {
    await sets.finishRun(runRow.id, {
      status: 'failed', places: funnel.read, candidates: funnel.collapsed, costUsd: usd, funnel,
      note: String(err.message).slice(0, 200),
    });
    throw err;
  }

  return { run: String(runRow.id), estimate: plan, funnel, costUsd: Number(usd.toFixed(2)), drawers: report };
}
