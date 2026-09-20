/**
 * The filing desk: the six tabs the taxonomy is worked through.
 *
 * The Places redesign (Claude Design, 20 Sep 2026) draws one screen with six
 * tabs — Overview, Categories, Labels, Mapping, Rules, Rows — and this is what
 * it reads. It is a new router rather than more of `taxonomy.js` because it is
 * a different job: `taxonomy.js` is the vocabulary and the rules, and this is
 * the desk somebody sits at to work them.
 *
 *   GET  /overview                     what waits on a human, and on what terms
 *   PUT  /thresholds                   one of the numbers the screens judge by
 *   GET  /categories                   the categories table
 *   GET  /categories/:key              one category's drawers
 *   GET  /subcategories/:key           one drawer: what fills it, and what it says
 *   GET  /subcategories/:key/places    every place in it
 *   PUT  /subcategories/:key/defaults  accept, flip or set one of its answers
 *   POST /subcategories/:key/accept    agree with everything proposed at once
 *   GET  /mapping                      every provider word, and where it points
 *   GET  /mapping/excluded             what is kept out of Epic, and why
 *   GET  /labels                       every question set, and the global labels
 *   GET  /labels/sets/:key             one set, and the words waiting on it
 *   GET  /labels/vocabulary            our own labels, and where each is asked
 *
 * Nothing here calls a provider. Every number comes from the index, the owned
 * records, the search log and the rules, so a screen can be refreshed as often
 * as somebody likes and it costs nothing.
 */

import { Router } from 'express';
import { requires } from '../access.js';
import { query } from '../db.js';
import * as filing from '../repositories/filing.js';
import * as placeAttributes from '../repositories/placeAttributes.js';
import * as questionSets from '../repositories/questionSets.js';
import * as taxonomyAudit from '../repositories/taxonomyAudit.js';
import { CORPUS_OPENS, auditAll } from '../domain/taxonomyAudit.js';
import { setThreshold, thresholds, thresholdValues } from '../repositories/settings.js';

export const filingRoutes = Router();

const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'bad_request' });
const actorOf = (req) => req.account?.email ?? 'the owner (passcode)';

/** The town a place reads as, from what we own. Never from a provider. */
const townOf = (rec) => {
  if (!rec?.postcode) return null;
  // The outward code is the part of a postcode that names somewhere. It is the
  // most we can say about where a place is without holding a rented address.
  return String(rec.postcode).trim().split(/\s+/)[0] || null;
};

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/**
 * GET /overview — the four queues, what ran while you were out, the thresholds.
 *
 * The heading is a count of things that wait on a *person*: the machine has
 * done everything it can and these are the decisions left. A queue at nought
 * is drawn grey rather than hidden, because "nothing waiting" is worth seeing.
 */
filingRoutes.get('/overview', requires('view_library'), async (_req, res, next) => {
  try {
    const limits = await thresholdValues();
    const [cands, pen, audit, drawers, runs, mine] = await Promise.all([
      // A word can be judged when it is a feature and enough places raised it.
      query(`select count(*)::int n from harvest_candidates
              where status = 'new' and kind = 'feature' and places_seen >= $1`, [limits.sightingFloor]),
      // The holding pen: raised, not yet callable, waiting for a later harvest.
      query(`select count(*)::int n from harvest_candidates
              where status in ('new', 'unresolved') and kind = 'unclear'`),
      taxonomyAudit.read().catch(() => null),
      argumentative(limits.spreadLimit),
      query(`select id, kind, status, places, candidates, cost_usd, started_at, finished_at, subcategories
               from vocabulary_runs order by started_at desc limit 4`),
      unengagedShare(),
    ]);

    const open = audit?.groups?.reduce((n, g) => n + (g.open ?? 0), 0) ?? 0;
    const queues = [
      { kicker: 'LABELS', count: cands.rows[0].n, what: 'candidates to judge',
        where: 'a feature, raised often enough to ask', go: 'labels' },
      { kicker: 'LABELS', count: pen.rows[0].n, what: 'words nobody can call',
        where: 'the holding pen · reconsidered at the next harvest', go: 'pen' },
      { kicker: 'MAPPING', count: open, what: 'audit proposals waiting',
        where: 'grouped · accept a whole group at once', go: 'audit' },
      { kicker: 'CATEGORIES', count: drawers.length, what: 'subcategories being argued with',
        where: 'their places disagree with the default', go: 'arguing', tone: 'warn' },
    ];

    res.json({
      queues,
      waiting: queues.reduce((n, q) => n + q.count, 0),
      arguing: drawers,
      // An audit that found nothing is not a clean taxonomy, and the screen has
      // to be able to tell the two apart (epic-1c, 20 Sep 2026). Whatever the
      // run could not see comes back with it.
      auditEvidence: audit?.audit?.evidence ?? null,
      runs: runs.rows.map((r) => ({
        id: r.id,
        name: r.kind === 'google' ? 'Vocabulary harvest' : r.kind === 'free' ? 'Free sweep' : r.kind,
        at: r.finished_at ?? r.started_at,
        state: r.status,
        scope: r.subcategories?.length ? `${r.subcategories.length} subcategories` : 'every question set',
        places: r.places,
        words: r.candidates,
        cost: Number(r.cost_usd ?? 0),
      })),
      // The code brief's §6 metric, which nothing else has ever drawn: how much
      // of what a household is shown got there through a mapping nobody has
      // ever engaged with.
      unengaged: mine,
      thresholds: await thresholds(),
    });
  } catch (err) { next(err); }
});

/**
 * Subcategories whose own places disagree with their defaults at or past the limit.
 *
 * The Overview counts them and the Rules tab lists them; both read this, so
 * the number and the list can never disagree.
 */
async function argumentative(spreadLimit) {
  const d = await filing.drawers();
  const { list: attrs } = await placeAttributes.attributes();
  const out = [];
  for (const s of d.subcategories) {
    if (!s.active) continue;
    const refs = d.refsBySub.get(s.key) ?? [];
    if (!refs.length) continue;
    const defaults = d.defaultsBySub.get(s.key) ?? new Map();
    const answers = attrs.filter((a) => a.active).map((a) => filing.drawerAnswer({
      attribute: a, refs, valuesByRef: d.valuesByRef, defaults, spreadLimit,
    }));
    const arguing = answers.filter((a) => a.mixed);
    if (!arguing.length) continue;
    out.push({
      key: s.key,
      label: s.label,
      category: s.category_key,
      places: refs.length,
      about: arguing.map((a) => a.label),
      worst: Math.max(...arguing.map((a) => a.spread)),
    });
  }
  return out.sort((a, b) => b.worst - a.worst);
}

/**
 * The share of what households were shown that came in through a mapping
 * nobody has ever engaged with.
 *
 * Code brief §6. One number, and it needs saying carefully: it is a share of
 * *impressions*, not of places, because a dead mapping that surfaces one place
 * a thousand times is a worse problem than one that surfaces a thousand places
 * once. Where nothing has been shown at all it is null rather than nought —
 * the screen must not read "0% dead" off an empty log.
 */
async function unengagedShare() {
  const [shown, opened, all] = await Promise.all([
    query(`select p.found_by as word, count(*)::int n
             from search_events e join place_index p on p.venue_ref = e.venue_ref
            where e.kind = 'shown' and p.found_by is not null group by 1`),
    query(`select p.found_by as word, count(*)::int n
             from search_events e join place_index p on p.venue_ref = e.venue_ref
            where e.kind in ('open','save','add_to_trip') and p.found_by is not null group by 1`),
    query(`select count(*)::int n from search_events where kind = 'shown' and venue_ref is not null`),
  ]);
  const engaged = new Set(opened.rows.filter((r) => r.n > 0).map((r) => r.word));
  const attributed = shown.rows.reduce((n, r) => n + r.n, 0);
  const total = all.rows[0]?.n ?? 0;
  if (!total) return { share: null, impressions: 0, attributed: 0, words: [], why: 'nothing has been shown yet' };

  /**
   * It does not speak until opening happens at all.
   *
   * Run against production the day it was written this said 96% of everything
   * shown came through a dead mapping — because the corpus held almost no
   * opens, so "never engaged with" was true of every word in it. That is the
   * same trap the audit's *nobody goes* fell into on the same day, and it is
   * the more dangerous of the two here: a number that large on the front door
   * reads as an emergency and it is measuring how young the product is.
   *
   * Same floor as the audit, from the same constant, so the two can never
   * disagree about when engagement is readable.
   */
  const opensAll = opened.rows.reduce((n, r) => n + r.n, 0);
  if (opensAll < CORPUS_OPENS) {
    return { share: null, impressions: total, attributed, opens: opensAll, needs: CORPUS_OPENS, words: [],
      why: `too few opens to read engagement — ${opensAll.toLocaleString()} against the ${CORPUS_OPENS} this needs` };
  }
  // The share is of what we can *attribute*, and the two numbers are both
  // returned so the screen can say which it is. Dividing the dead impressions
  // by every impression would read the ones we cannot attribute as healthy,
  // and dividing by the attributed ones without saying so would read as a
  // statement about the whole log.
  if (!attributed) {
    return { share: null, impressions: total, attributed: 0, words: [],
      why: 'nothing shown can be traced back to the word that found it' };
  }
  const dead = shown.rows.filter((r) => !engaged.has(r.word));
  const from = dead.reduce((n, r) => n + r.n, 0);
  return {
    share: Number((from / attributed).toFixed(4)),
    impressions: total,
    attributed,
    fromDead: from,
    words: dead.sort((a, b) => b.n - a.n).slice(0, 10).map((r) => ({ word: r.word, shown: r.n })),
    why: null,
  };
}

/** PUT /thresholds — one of the numbers, nudged. */
filingRoutes.put('/thresholds', requires('manage_library'), async (req, res, next) => {
  try {
    const saved = await setThreshold(req.body?.key, req.body?.value);
    res.json({ threshold: saved, thresholds: await thresholds() });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/** GET /categories — every category with what is in it and what waits. */
filingRoutes.get('/categories', requires('view_library'), async (_req, res, next) => {
  try {
    const [d, limits] = await Promise.all([filing.drawers(), thresholdValues()]);
    const { list: attrs } = await placeAttributes.attributes();
    const active = attrs.filter((a) => a.active);

    const proposedIn = (key) => {
      const refs = d.refsBySub.get(key) ?? [];
      const defaults = d.defaultsBySub.get(key) ?? new Map();
      return active.map((a) => filing.drawerAnswer({
        attribute: a, refs, valuesByRef: d.valuesByRef, defaults, spreadLimit: limits.spreadLimit,
      })).filter((a) => a.proposed && !a.mixed).length;
    };

    const categories = d.categories.filter((c) => c.active).map((c) => {
      const subs = d.subcategories.filter((s) => s.active && s.category_key === c.key);
      const places = subs.reduce((n, s) => n + (d.refsBySub.get(s.key)?.length ?? 0), 0);
      const review = subs.reduce((n, s) => n + proposedIn(s.key), 0);
      const sets = [...new Set(subs.map((s) => d.setBySub.get(s.key)).filter(Boolean)
        .map((k) => d.setByKey.get(k)?.name).filter(Boolean))];
      return { key: c.key, label: c.label, subs: subs.length, places, sets, review };
    });

    res.json({
      categories,
      counts: {
        categories: categories.length,
        subcategories: d.subcategories.filter((s) => s.active).length,
        places: [...d.refsBySub.values()].reduce((n, r) => n + r.length, 0),
        review: categories.reduce((n, c) => n + c.review, 0),
      },
    });
  } catch (err) { next(err); }
});

/** GET /categories/:key — the drawers in one category, as the table draws them. */
filingRoutes.get('/categories/:key', requires('view_library'), async (req, res, next) => {
  try {
    const key = String(req.params.key);
    const [d, limits] = await Promise.all([filing.drawers(), thresholdValues()]);
    const category = d.categories.find((c) => c.key === key);
    if (!category) throw bad(`${key} is not one of our categories.`);
    const { list: attrs } = await placeAttributes.attributes();
    const active = attrs.filter((a) => a.active);

    const words = await wordsBySubcategory();

    const subcategories = d.subcategories.filter((s) => s.active && s.category_key === key).map((s) => {
      const refs = d.refsBySub.get(s.key) ?? [];
      const defaults = d.defaultsBySub.get(s.key) ?? new Map();
      const answers = active.map((a) => filing.drawerAnswer({
        attribute: a, refs, valuesByRef: d.valuesByRef, defaults, spreadLimit: limits.spreadLimit,
      }));
      const yes = answers.filter((a) => a.kind === 'yesno' && a.value?.yesno === true).map((a) => a.label);
      return {
        key: s.key,
        label: s.label,
        words: words.get(s.key) ?? [],
        places: refs.length,
        alsoIn: s.also_in ?? [],
        // An empty drawer is a mapping gap, not a fact about Britain, and the
        // screen says so in red. It is only sayable when the drawer has rules;
        // a drawer with no rules at all is an orphan and reads differently.
        empty: refs.length === 0,
        labels: yes.slice(0, 4),
        review: answers.filter((a) => a.proposed && !a.mixed).length,
        set: d.setBySub.get(s.key) ? d.setByKey.get(d.setBySub.get(s.key))?.name ?? null : null,
      };
    });

    res.json({
      category: { key: category.key, label: category.label },
      subcategories,
      counts: {
        subcategories: subcategories.length,
        places: subcategories.reduce((n, s) => n + s.places, 0),
      },
    });
  } catch (err) { next(err); }
});

/** Which provider words point at each drawer, in one read. */
async function wordsBySubcategory() {
  const { rows } = await query(
    `select subcategory, labels from shelf_rules where subcategory is not null and labels is not null`);
  const out = new Map();
  for (const r of rows) {
    for (const l of r.labels ?? []) {
      out.set(r.subcategory, [...(out.get(r.subcategory) ?? []), String(l)]);
    }
  }
  return out;
}

/**
 * GET /subcategories/:key — one drawer.
 *
 * What fills it, what it says about the places in it, and which of those places
 * argue back.
 */
filingRoutes.get('/subcategories/:key', requires('view_library'), async (req, res, next) => {
  try {
    const key = String(req.params.key);
    const d = await filing.drawers();
    const sub = d.subcategories.find((s) => s.key === key);
    if (!sub) throw bad(`${key} is not one of our subcategories.`);
    const category = d.categories.find((c) => c.key === sub.category_key) ?? null;

    const [drawer, evidence, limits] = await Promise.all([
      filing.drawerOf(key, d), taxonomyAudit.evidence(), thresholdValues(),
    ]);

    const rules = (evidence.rulesBySub.get(key) ?? []).map((r) => {
      // A `labels` rule is written in provider words; every other scope *is*
      // its subject — a Wikidata kind, an experience, one place by name. Taking
      // only `labels` left every other rule reading "brings in 0", which is not
      // what it does; it is what we forgot to count.
      const words = (r.labels ?? []).length
        ? r.labels.map((l) => String(l).split(':').pop())
        : [String(r.subject)];
      const refs = words.flatMap((w) => evidence.placesByWord.get(w) ?? []);
      const unique = [...new Set(refs)];
      const opened = unique.reduce((n, ref) => n + (evidence.openedByRef.get(ref) ?? 0), 0);
      return {
        id: r.id,
        scope: r.scope,
        subject: r.subject,
        label: r.subject_label ?? r.subject,
        words,
        brings: unique.length,
        opens: opened,
        // The first few it brought, named where we own a name. "What it brought"
        // is the evidence for striking a rule — cemetery bringing forty
        // churchyards and one Highgate is only visible as a list.
        brought: unique.slice(0, 8).map((ref) => ({
          ref,
          name: d.recordsByRef.get(ref)?.name ?? null,
        })),
      };
    });

    const answers = [...drawer.facets, ...drawer.excluded, ...drawer.axes];
    const disagreeing = filing.disagreeingIn({
      refs: drawer.refs, valuesByRef: d.valuesByRef, answers, recordsByRef: d.recordsByRef,
    });

    res.json({
      subcategory: {
        key: sub.key,
        label: sub.label,
        category: category ? { key: category.key, label: category.label } : null,
        places: drawer.refs.length,
        proposed: drawer.proposed,
        set: d.setBySub.get(key) ? {
          key: d.setBySub.get(key),
          name: d.setByKey.get(d.setBySub.get(key))?.name ?? null,
        } : null,
      },
      rules,
      facets: drawer.facets,
      excluded: drawer.excluded,
      axes: drawer.axes,
      disagreeing,
      // Where nothing fills the drawer, the words that look like they belong.
      // An empty list is a real answer — "nothing unanswered looks like it
      // belongs here" — and the screen has to say that rather than nothing.
      likely: drawer.refs.length === 0 ? await likelyFor(sub, evidence) : [],
      splitting: disagreeing.length > drawer.refs.length * limits.spreadLimit,
    });
  } catch (err) { next(err); }
});

/**
 * Unanswered provider words that look like they belong in an empty drawer.
 *
 * Matched on the drawer's own words, so it is a suggestion made of evidence
 * rather than a guess: a word is offered when it shares a stem with the
 * drawer's name and nothing has been said about it yet.
 */
async function likelyFor(sub, evidence) {
  const stems = String(sub.label).toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 3)
    .map((t) => t.replace(/s$/, ''));
  if (!stems.length) return [];
  const unanswered = evidence.words.filter((w) => !w.points_at && w.decision !== 'notinepic');
  return unanswered
    .filter((w) => stems.some((t) => w.key.toLowerCase().includes(t)))
    .map((w) => ({
      word: w.key,
      label: w.label,
      brings: (evidence.placesByWord.get(w.key) ?? []).length,
    }))
    .sort((a, b) => b.brings - a.brings)
    .slice(0, 5);
}

/** GET /subcategories/:key/places — every place in the drawer. */
filingRoutes.get('/subcategories/:key/places', requires('view_library'), async (req, res, next) => {
  try {
    const key = String(req.params.key);
    const d = await filing.drawers();
    if (!d.subcategories.some((s) => s.key === key)) throw bad(`${key} is not one of our subcategories.`);
    const drawer = await filing.drawerOf(key, d);
    const answers = [...drawer.facets, ...drawer.axes];

    const places = drawer.refs.map((ref) => {
      const rec = d.recordsByRef.get(ref) ?? null;
      const mine = d.valuesByRef.get(ref) ?? new Map();
      const human = [...mine.values()].some((v) => v.by);
      const yes = answers.filter((a) => a.kind === 'yesno' && mine.get(a.key)?.yesno === true)
        .map((a) => a.label);
      return {
        ref,
        // Null, not a borrowed name: a place we have not researched has no name
        // we are allowed to keep, and the screen says "not researched yet".
        name: rec?.name ?? null,
        town: townOf(rec),
        photo: rec?.image_url ?? null,
        summary: yes.slice(0, 3),
        answered: mine.size,
        human,
      };
    });

    res.json({ subcategory: key, places, counts: { places: places.length } });
  } catch (err) { next(err); }
});

/**
 * PUT /subcategories/:key/defaults — accept, flip, or set one answer.
 *
 * Three verbs and not one, because they are three different statements. Accept
 * says "the number that is there is right" and changes nothing else, so a
 * stale screen cannot write back a value somebody has since changed. Flip is
 * the yes/no shortcut the row offers. Set is a value chosen outright, and it
 * arrives settled because choosing one is agreeing with it.
 */
filingRoutes.put('/subcategories/:key/defaults', requires('manage_library'), async (req, res, next) => {
  try {
    const key = String(req.params.key);
    const attribute = String(req.body?.attribute ?? '');
    if (!attribute) throw bad('Which answer?');
    const { byKey } = await placeAttributes.attributes();
    const attr = byKey.get(attribute);
    if (!attr) throw bad(`${attribute} is not one of our labels.`);

    /**
     * What the drawer answers *now*, stored or merely proposed.
     *
     * Accept and flip both act on what the screen is showing, and most of what
     * it shows has never been written down: a proposal read off the places in
     * the drawer has no `shelf_subcategory_attributes` row behind it. An
     * `update` would touch nothing and the screen would be told there was
     * nothing to accept, for the one row it was most obviously pointing at
     * (Codex, 20 Sep 2026).
     */
    const effective = async () => {
      const d = await filing.drawers();
      const stored = d.defaultsBySub.get(key)?.get(attribute) ?? null;
      if (stored) return { value: stored, stored: true };
      const drawer = await filing.drawerOf(key, d);
      const shown = [...drawer.facets, ...drawer.axes].find((a) => a.key === attribute) ?? null;
      return { value: shown?.value ?? null, stored: false, mixed: Boolean(shown?.mixed) };
    };

    if (req.body?.accept) {
      const now = await effective();
      if (now.mixed) throw bad(`The places here disagree about ${attr.label.toLowerCase()}, so there is no answer to accept.`);
      if (!now.value) throw bad(`There is nothing proposed there to accept.`);
      // One statement either way: it settles the row that is there, or writes
      // down the proposal that was not, and never overwrites a value somebody
      // set while this request was reading.
      const value = await placeAttributes.acceptDefault(key, attribute, now.value);
      return res.json({ attribute, value, settled: true });
    }

    if (req.body?.flip) {
      if (attr.kind !== 'yesno') throw bad(`${attr.label} is not a yes or no, so there is nothing to flip.`);
      const now = await effective();
      if (now.value?.yesno == null) throw bad(`${attr.label} has no answer here to flip.`);
      const value = await placeAttributes.setDefault(key, attribute, { yesno: !now.value.yesno }, { settled: true });
      return res.json({ attribute, value, settled: true });
    }

    const value = await placeAttributes.setDefault(key, attribute, req.body?.value ?? null, { settled: true });
    return res.json({ attribute, value, settled: Boolean(value) });
  } catch (err) { next(err); }
});

/**
 * POST /subcategories/:key/accept — agree with everything proposed.
 *
 * Only what is actually proposed: a mixed answer is not accepted into a false
 * default, and one already settled is left alone. The reply says how many, so
 * the screen reports what happened rather than what it asked for.
 */
filingRoutes.post('/subcategories/:key/accept', requires('manage_library'), async (req, res, next) => {
  try {
    const key = String(req.params.key);
    const d = await filing.drawers();
    if (!d.subcategories.some((s) => s.key === key)) throw bad(`${key} is not one of our subcategories.`);
    const drawer = await filing.drawerOf(key, d);
    const proposed = [...drawer.facets, ...drawer.axes].filter((a) => a.proposed && !a.mixed);

    let accepted = 0;
    for (const a of proposed) {
      await placeAttributes.acceptDefault(key, a.key, a.value);
      accepted += 1;
    }
    placeAttributes.forget();
    res.json({ accepted, by: actorOf(req) });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

/**
 * The six flags, in the words the screen prints.
 *
 * `grave` is the difference between "this looks wrong" and "this is wrong":
 * only the two that mean a word is bringing in places nobody could ever want
 * are drawn as danger. The design brief is explicit that a flag is a
 * suggestion and plenty will be wrong — "never a red error".
 */
const FLAGS = {
  nobody_goes: { key: 'nobody', name: 'Nobody goes', grave: true },
  not_visitable: { key: 'notvisitable', name: 'Not a visitable place', grave: true },
  singleton: { key: 'singleton', name: 'Singleton', grave: false },
  mixed: { key: 'mixed', name: 'Mixed', grave: false },
  orphan: { key: 'orphan', name: 'Orphan', grave: false },
  primary_mismatch: { key: 'mismatch', name: 'Primary mismatch', grave: false },
};

/**
 * The four states a row can be in, from the five words the table stores.
 *
 * `aside` is Not in Epic. `generic` is a word that is a label rather than a
 * drawer. `travel` and `nearby` are answers too — parking, and the chemist
 * beside the museum — and they are neither unanswered nor a drawer, so they
 * read as kept-as-a-label here and carry their own word in `answer`.
 */
const decisionOf = (w) => (w.points_at ? 'mapped'
  : w.decision === 'aside' ? 'notinepic'
    : (w.decision === 'generic' || w.decision === 'travel' || w.decision === 'nearby') ? 'secondary'
      : 'notsure');

/**
 * Every provider word, what it brings, and what looks wrong about it.
 *
 * **The flags are the audit's own signals, not a second opinion.** Running
 * `auditAll` and turning its proposals into marks on the rows is what stops
 * the Mapping screen and the Audit screen disagreeing about the same word —
 * which they would, within a week, if the six conditions were written out
 * twice. It also means the audit's guards come for free: *nobody goes* stays
 * silent until the corpus has opens, so the flag cannot appear on every row in
 * the table on a young product.
 */
filingRoutes.get('/mapping', requires('view_library'), async (_req, res, next) => {
  try {
    const evidence = await taxonomyAudit.evidence();
    const { proposals, evidence: saw } = auditAll(evidence);
    const carried = await placeAttributes.carriedByWord();

    // A proposal is about a word or about a subcategory; a row wears both —
    // its own, and the ones about the drawer it points at.
    const byWord = new Map();
    const bySub = new Map();
    for (const p of proposals) {
      const spec = FLAGS[p.flag];
      if (!spec) continue;
      const flag = { ...spec, why: p.because };
      const into = p.subject_kind === 'word' ? byWord : bySub;
      into.set(p.subject, [...(into.get(p.subject) ?? []), flag]);
    }

    // The rows are read here rather than taken from the evidence: `evidence.words`
    // is deliberately narrowed to the *undecided* ones, because that is all the
    // audit has an opinion about. The Mapping table is the whole vocabulary,
    // decided and not, and reading the audit's list would have shown 260 of 479
    // words and called every one of them "not answered".
    const { rows } = await query(
      `select l.key, l.label, l.decision, l.points_at, l.active, s.label as sub_label
         from taxonomy_labels l
         left join shelf_subcategories s on s.key = l.points_at
        where l.namespace = 'google'
        order by l.key`);

    const words = rows.map((w) => {
      const refs = evidence.placesByWord.get(w.key) ?? [];
      return {
        word: w.key,
        label: w.label ?? w.key,
        brings: refs.length,
        opens: refs.reduce((n, ref) => n + (evidence.openedByRef.get(ref) ?? 0), 0),
        pointsAt: w.points_at ? { key: w.points_at, label: w.sub_label ?? w.points_at } : null,
        decision: decisionOf(w),
        // Our own word for it, kept beside the screen's four because they are
        // not the same vocabulary: `travel` and `nearby` are real answers a
        // person gave — parking, and the chemist beside the museum — and both
        // collapse into "kept as a label" if only the four survive.
        answer: w.decision ?? null,
        labels: (carried.get(`google:${w.key}`) ?? []).map((c) => c.key),
        flags: [...(byWord.get(w.key) ?? []), ...(w.points_at ? bySub.get(w.points_at) ?? [] : [])],
      };
    });

    res.json({
      words,
      counts: {
        answered: words.filter((w) => w.decision === 'mapped').length,
        notSure: words.filter((w) => w.decision === 'notsure').length,
        secondary: words.filter((w) => w.decision === 'secondary').length,
        // First-class, and counted beside the others: excluding is the correct
        // answer for a large fraction of Google's types, and the brief is that
        // it has to read as progress rather than as a gap.
        notInEpic: words.filter((w) => w.decision === 'notinepic').length,
        flagged: words.filter((w) => w.flags.length).length,
        words: words.length,
      },
      // What the signals could not see, so an unflagged table does not read as
      // a clean one.
      evidence: saw,
    });
  } catch (err) { next(err); }
});

/** GET /mapping/excluded — what is kept out, and why. Reversible from here. */
filingRoutes.get('/mapping/excluded', requires('view_library'), async (_req, res, next) => {
  try {
    const evidence = await taxonomyAudit.evidence();
    const { proposals } = auditAll(evidence);
    const why = new Map(proposals.filter((p) => p.subject_kind === 'word').map((p) => [p.subject, p.because]));
    const { rows: kept } = await query(
      `select key, label, decision from taxonomy_labels
        where namespace = 'google' and decision = 'aside' order by key`);
    const rows = kept.map((w) => {
      const refs = evidence.placesByWord.get(w.key) ?? [];
      const opened = refs.reduce((n, ref) => n + (evidence.openedByRef.get(ref) ?? 0), 0);
      return {
        word: w.key,
        label: w.label ?? w.key,
        brings: refs.length,
        // A reason, always, and the honest one: where no signal has anything to
        // say, "somebody decided this" is the truth and beats inventing one.
        why: why.get(w.key)
          ?? (opened === 0 && refs.length
            ? `Brings in ${refs.length.toLocaleString()} places and nobody has ever opened one.`
            : 'Kept out by hand.'),
      };
    });
    res.json({ excluded: rows, counts: { words: rows.length, places: rows.reduce((n, r) => n + r.brings, 0) } });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Labels — question sets, the words waiting on a person, and our own vocabulary
// ---------------------------------------------------------------------------

/**
 * What state a harvested word is in, in the screen's vocabulary.
 *
 * Five, and they are genuinely five. A word the classifier could not call is
 * **held** — not pending, not ignored, not waiting on a human (brief §5.1) —
 * and comes back at the next harvest. A word validated against a source we own
 * is **confirmed**; one that was looked for and not found is **not confirmed**,
 * which is a real answer and a different fact from never having looked.
 */
function candidateState(c) {
  if (c.kind !== 'feature') return 'held';
  const owned = Object.entries(c.sources ?? {}).filter(([k]) => k !== 'reviews' && k !== 'google');
  const found = owned.reduce((n, [, v]) => n + Number(v || 0), 0);
  if (found > 0) return 'confirmed';
  if (c.classified_at) return 'notconfirmed';
  return 'validating';
}

/** How a source is named to a person. Never the table's own word. */
const SOURCE_WORDS = {
  site: 'venue page', venue: 'venue page', osm: 'OSM tag', wikipedia: 'Wikipedia',
  wikidata: 'Wikidata', fsa: 'the hygiene register', reviews: 'reviews', google: 'reviews',
};

/**
 * The provenance line, written here so no screen composes a number into prose.
 *
 * "seen in reviews of 2 of 60 · confirmed on 2 venue pages · 1 OSM tag" is one
 * string, because the rules for which clause appears when are rules about the
 * data and belong beside it.
 */
function provenanceOf(c) {
  const bits = [`seen in ${c.places_seen} of ${c.places_total} read`];
  for (const [k, v] of Object.entries(c.sources ?? {})) {
    if (k === 'reviews' || k === 'google' || !Number(v)) continue;
    const word = SOURCE_WORDS[k] ?? k;
    bits.push(`${v} ${word}${Number(v) === 1 ? '' : 's'}`);
  }
  if (bits.length === 1 && c.classified_at) bits.push('no owned source agreed');
  return bits.join(' · ');
}

const candidateRow = (c) => ({
  id: Number(c.id),
  word: c.raw_forms?.[0] ?? c.norm,
  seen: c.places_seen,
  of: c.places_total,
  state: candidateState(c),
  mark: c.gateWord ? 'GATE' : c.ageSignal ? 'AGE' : null,
  provenance: provenanceOf(c),
  raised: `raised ${new Date(c.first_seen).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
  // Null where the harvest predates polarity, which is not the same as nought
  // denials (migration 210).
  denies: (c.asserts + c.denies + c.asks) > 0 ? c.denies : null,
  quotes: [],
  snippet: null,
  places: (c.examples ?? []).slice(0, 4),
  why: c.kind === 'unclear' ? 'nobody can call it — a feature, a condition or an opinion'
    : c.kind === 'condition' ? 'a condition, not a feature'
      : c.kind === 'opinion' ? 'an opinion — that is the Epic score’s job' : null,
  doing: candidateState(c) === 'validating' ? 'reading the venue pages, OSM and Wikipedia' : null,
  subcategory: c.subcategory,
});

/** GET /labels — every question set, and the labels asked of everything. */
filingRoutes.get('/labels', requires('view_library'), async (_req, res, next) => {
  try {
    const [sets, all, d, limits] = await Promise.all([
      questionSets.sets(), questionSets.questionsFor(null), filing.drawers(), thresholdValues(),
    ]);
    const cands = await questionSets.candidates({ status: 'new', limit: 5000 });

    const rows = sets.map((s) => {
      const subs = (s.subcategories ?? []).map((k) => d.subcategories.find((x) => x.key === k)).filter(Boolean);
      const places = subs.reduce((n, x) => n + (d.refsBySub.get(x.key)?.length ?? 0), 0);
      const questions = all.filter((q) => q.set_key === s.key);
      const waiting = cands.filter((c) => subs.some((x) => x.key === c.subcategory)
        && c.places_seen >= limits.sightingFloor && c.kind === 'feature').length;
      return {
        key: s.key,
        name: s.name,
        // Settled only when the queue is empty: a set that has stopped
        // producing words but still has candidates waiting is *settling*, and
        // the two must not look the same.
        state: s.vocabulary_settled ? (waiting === 0 ? 'settled' : 'settling') : null,
        tooFewForTooMany: subs.length >= 4 && questions.length < 6,
        usedBy: subs.map((x) => x.label),
        questions: questions.length,
        places,
        waiting,
      };
    });

    res.json({
      sets: rows,
      globals: all.filter((q) => q.scope === 'global')
        .map((q) => ({ key: q.attribute_key, name: q.label, shape: shapeWord(q) })),
      counts: { sets: rows.length, questions: all.length, waiting: rows.reduce((n, r) => n + r.waiting, 0) },
    });
  } catch (err) { next(err); }
});

/** A label's kind, said in words rather than in the table's own. */
const shapeWord = (q) => (q.kind === 'yesno' ? 'Yes or no'
  : q.kind === 'range' ? 'A range'
    : q.kind === 'scale' ? 'A scale, 0 to 4'
      : 'One of a list');

/** GET /labels/sets/:key — one set: its questions, and the words waiting on it. */
filingRoutes.get('/labels/sets/:key', requires('view_library'), async (req, res, next) => {
  try {
    const key = String(req.params.key);
    const [sets, all, d, limits] = await Promise.all([
      questionSets.sets(), questionSets.questionsFor(key), filing.drawers(), thresholdValues(),
    ]);
    const set = sets.find((s) => s.key === key);
    if (!set) throw bad(`${key} is not one of our question sets.`);
    const subs = (set.subcategories ?? []).map((k) => d.subcategories.find((x) => x.key === k)).filter(Boolean);
    const subKeys = subs.map((x) => x.key);
    const places = subs.reduce((n, x) => n + (d.refsBySub.get(x.key)?.length ?? 0), 0);

    const [fresh, held] = await Promise.all([
      questionSets.candidates({ subcategories: subKeys, status: 'new', limit: 1000 }),
      questionSets.candidates({ subcategories: subKeys, status: 'unresolved', limit: 1000 }),
    ]);
    const rows = fresh.map(candidateRow);
    const floor = limits.sightingFloor;

    res.json({
      set: {
        key: set.key, name: set.name,
        state: set.vocabulary_settled ? 'settled' : null,
        usedBy: subs.map((x) => ({ key: x.key, label: x.label })),
        places,
      },
      questions: all.filter((q) => q.set_key === key).map((q) => ({
        id: Number(q.id),
        name: q.label,
        shape: shapeWord(q),
        gate: q.gate,
        // Both numbers, never the share alone: 4 of 5 and 800 of 1,000 are not
        // the same thing and the whole point of the list is that they differ.
        share: Number(q.answered) > 0
          ? (q.kind === 'yesno'
            ? `${Math.round((Number(q.said_yes) / Number(q.answered)) * 100)}% say yes · ${q.answered} answered`
            : `${q.answered} answered`)
          : 'nothing has answered it yet',
        thin: Number(q.answered) < 6,
      })),
      // Judgeable, at or above the floor, least evenly spread first — the ones
      // that tell two places apart.
      candidates: rows.filter((c) => c.state !== 'held' && c.seen >= floor),
      // The holding pen: not pending, not ignored, not waiting on a human.
      pen: held.map(candidateRow),
      inFlight: rows.filter((c) => c.state === 'validating'),
      // Visible, and deliberately not promotable.
      thin: rows.filter((c) => c.state !== 'held' && c.seen < floor),
      readNote: `${rows.reduce((n, c) => Math.max(n, c.of), 0)} places were read to find these words`
        + ` · ${places} are asked them`,
    });
  } catch (err) { next(err); }
});

/** GET /labels/vocabulary — our own labels, and where each is asked. */
filingRoutes.get('/labels/vocabulary', requires('view_library'), async (_req, res, next) => {
  try {
    const [{ list: attrs }, all, sets, d] = await Promise.all([
      placeAttributes.attributes(), questionSets.questionsFor(null), questionSets.sets(), filing.drawers(),
    ]);
    const setName = new Map(sets.map((s) => [s.key, s.name]));
    const rows = attrs.filter((a) => a.active).map((a) => {
      const asked = all.filter((q) => q.attribute_key === a.key);
      const global = asked.some((q) => q.scope === 'global');
      const inSets = [...new Set(asked.filter((q) => q.set_key).map((q) => q.set_key))];
      const places = global
        ? [...d.refsBySub.values()].reduce((n, r) => n + r.length, 0)
        : inSets.reduce((n, k) => {
          const s = sets.find((x) => x.key === k);
          return n + (s?.subcategories ?? []).reduce((m, sub) => m + (d.refsBySub.get(sub)?.length ?? 0), 0);
        }, 0);
      return {
        key: a.key,
        name: a.label,
        // Nowhere is the orphan case and reads differently: approved, and then
        // never asked of anything.
        scope: global ? 'everywhere' : inSets.length ? 'sets' : 'nowhere',
        sets: inSets.map((k) => setName.get(k)).filter(Boolean),
        places,
      };
    });
    res.json({
      vocabulary: rows,
      counts: {
        labels: rows.length,
        everywhere: rows.filter((r) => r.scope === 'everywhere').length,
        nowhere: rows.filter((r) => r.scope === 'nowhere').length,
      },
    });
  } catch (err) { next(err); }
});
