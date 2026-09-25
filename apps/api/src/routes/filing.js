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
 *   GET  /pending                      words a person typed that nothing asks yet
 *   POST /categories                   name a category
 *   POST /subcategories                name a drawer, with a bar in the same breath
 *   POST /categories/:key/apply        say one thing about several drawers at once
 *   PUT  /mapping/:word                where one of Google's words points
 *   PUT  /mapping/:word/carries        a fact riding along on what it brings
 *   GET  /mapping/:word/destinations   where it could point, and what each would do
 *   GET  /rows                         the rows a household browses, and their fill
 *   PUT  /rows/:id                     its words, or its rule
 *   POST /rows/:id/heart               heart it, as somebody
 *   GET  /subcategories/:key/train     the places worth looking at, and why
 *   GET  /places/:ref                  one place, as the desk and a household see it
 *   PUT  /places/:ref                  what one place says for itself
 *   POST /subcategories/:key/not-sure  these twelve do not belong here
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
import * as labelRepo from '../repositories/taxonomyLabels.js';
import * as shelfRules from '../repositories/shelfRules.js';
import * as shelfTaxonomy from '../repositories/shelfTaxonomy.js';
import * as browseRows from '../repositories/browseRows.js';
import * as notSure from '../repositories/notSure.js';
import * as placeIndex from '../repositories/placeIndex.js';
import { currentHousehold } from './household.js';
import * as taxonomyAudit from '../repositories/taxonomyAudit.js';
import { CORPUS_OPENS, auditAll } from '../domain/taxonomyAudit.js';
import { invariantRuns, noteInvariantRun, setThreshold, thresholds, thresholdValues } from '../repositories/settings.js';
import {
  STAGES, clearsOf, diagnose, headlineOf, livenessOf, saturationOf, stageOf,
} from '../domain/runFunnel.js';

export const filingRoutes = Router();

const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'bad_request' });
const actorOf = (req) => req.account?.email ?? 'the owner (passcode)';

/** The town a place reads as, from what we own. Never from a provider. */
const townOf = (rec) => {
  // The outward code is the part of a postcode that names somewhere. It is the
  // most we can say about where a place is without holding a rented address.
  if (rec?.postcode) return String(rec.postcode).trim().split(/\s+/)[0] || null;
  // Failing that, the atlas's own region — coarser, and ours. A place we can
  // name and cannot place at all is rarer than it looks.
  if (rec?.where) return String(rec.where).replace(/-/g, ' ');
  return null;
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
/**
 * POST /checks/run — the bar checks, now rather than at the next daily tick.
 *
 * The same pass the schedule runs (server.js), recorded the same way, so the
 * Overview says "ran just now, by hand" rather than waiting a day to say
 * anything. Asked for by the sign-off of 24 Sep 2026 (§9): "afterwards, run
 * the invariants and report".
 */
filingRoutes.post('/checks/run', requires('manage_library'), async (req, res, next) => {
  try {
    const run = await placeIndex.checkBars({ repair: req.body?.repair !== false, trigger: 'manual' });
    await noteInvariantRun(run).catch(() => {});
    res.json({ run });
  } catch (err) { next(err); }
});

filingRoutes.get('/overview', requires('view_library'), async (_req, res, next) => {
  try {
    const limits = await thresholdValues();
    const [cands, pen, audit, drawers, runs, mine, checks] = await Promise.all([
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
      // When the bar invariants last ran and what they found. Null is "never
      // ran", which the screen must draw differently from "ran and found
      // nothing" (owner, 24 Sep 2026).
      invariantRuns().catch(() => null),
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
      invariants: checks,
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
    // Worded as what it is rather than as a shortfall: a count against a
    // target reads as a fault, and this is the product being new (epic-1c,
    // 21 Sep 2026). The numbers still come back for anybody who wants them.
    return { share: null, impressions: total, attributed, opens: opensAll, needs: CORPUS_OPENS, words: [],
      why: opensAll === 0
        ? 'nobody has opened anything yet, so engagement cannot be read'
        : `almost nothing has been opened yet — ${opensAll.toLocaleString()} so far — so engagement cannot be read` };
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
      /**
       * Every drawer, flat, for the picker.
       *
       * §4's control browses categories in a rail and shows their drawers
       * beside it, so it needs all of them and not only the one whose screen
       * it is on — fed from the current category alone it showed an empty
       * list for every other rung of the rail.
       */
      subcategories: d.subcategories.filter((s) => s.active).map((s) => ({
        key: s.key,
        label: s.label,
        category: s.category_key,
        places: d.refsBySub.get(s.key)?.length ?? 0,
      })),
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
        // The words with their namespace still on, because a screen saying
        // "from Google: Q2022036" is naming the wrong source: `labels` rules
        // are a provider's words and every other scope is ours or the open
        // map's, and stripping the namespace made them indistinguishable.
        labels: (r.labels ?? []).map(String),
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

    const answers = [...drawer.facets, ...drawer.excluded];
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
      disagreeing,
      // Where nothing fills the drawer, the words that look like they belong.
      // An empty list is a real answer — "nothing unanswered looks like it
      // belongs here" — and the screen has to say that rather than nothing.
      likely: drawer.refs.length === 0 ? await likelyFor(sub, evidence) : [],
      splitting: disagreeing.length > drawer.refs.length * limits.spreadLimit,
      /**
       * Whether "nobody has opened this" means anything yet.
       *
       * Below the corpus floor it does not: nothing has been opened, so every
       * rule on the screen reads "never opened" in red and the colour stops
       * meaning anything. Same floor as the audit and the front door, so the
       * three cannot disagree about when demand is readable.
       */
      demandReadable: [...evidence.openedByRef.values()].reduce((n, v) => n + v, 0) >= CORPUS_OPENS,
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
  // `evidence.unmapped` and not `evidence.words`: the latter is mapped down to
  // {key, label, subcategoryLabel} before we see it, so reading `points_at`
  // off it found undefined on every row and offered words already pointing at
  // another drawer as candidates for this empty one (epic-f2, 21 Sep 2026).
  const unanswered = evidence.unmapped;
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
    const answers = drawer.facets;

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
      const shown = drawer.facets.find((a) => a.key === attribute) ?? null;
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
    const proposed = drawer.facets.filter((a) => a.proposed && !a.mixed);

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

/**
 * Exported for its test: the mapping is the one place the stored quote
 * becomes something a reviewer can read, and it was left at `quotes: []`
 * after the quote started being stored (Codex, 25 Sep 2026).
 */
export const candidateRow = (c) => ({
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
  // The quote the feature pass kept, from owned text (migration 247). Rented
  // text never reaches the column, so anything here may be shown.
  quotes: c.evidence
    ? [{ text: c.evidence, place: c.evidence_ref ?? '', source: Object.keys(c.sources ?? {}).find((k) => k !== 'google') ?? 'features' }]
    : [],
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
      // Every question, not `questionsFor(null)`: that returns the globals
      // alone, so every set on this table counted nought of its own.
      questionSets.sets(), questionSets.everyQuestion(), filing.drawers(), thresholdValues(),
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
      // Same trap: with the globals alone every label read "nowhere", which is
      // the orphan case, so the whole vocabulary looked unasked.
      placeAttributes.attributes(), questionSets.everyQuestion(), questionSets.sets(), filing.drawers(),
    ]);
    const setName = new Map(sets.map((s) => [s.key, s.name]));
    // This screen is our own vocabulary and where each word is *asked*. Only
    // the live labels: a retired one — the eight graded axes, since migration
    // 246 — is not a word anybody can be offered "Ask it in…" for.
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

/**
 * PUT /mapping/:word — where one of Google's words points.
 *
 * Three answers and they are one field between them, because they are three
 * values of the same decision: a drawer, a label, or Not in Epic. The reply
 * carries what it *was* so the row can offer an undo — the design brief asks
 * for "no confirm step, undo on the row", and an undo needs somewhere to go
 * back to.
 *
 * Excluding is a first-class answer here and not a failure to answer. For a
 * road bridge it is the correct one, and the counter on this screen treats it
 * as progress rather than as a gap.
 */
filingRoutes.put('/mapping/:word', requires('manage_library'), async (req, res, next) => {
  try {
    const word = String(req.params.word);
    const { rows: was } = await query(
      "select key, points_at, decision from taxonomy_labels where namespace = 'google' and key = $1", [word]);
    if (!was[0]) throw bad(`Google has no word ${word}.`);
    const before = { subcategory: was[0].points_at ?? null, decision: was[0].decision ?? null };

    const subcategory = req.body?.subcategory ? String(req.body.subcategory) : null;
    const decision = req.body?.decision ? String(req.body.decision) : null;
    if (subcategory && decision) throw bad('A word points at a drawer or it is answered some other way, not both.');
    if (!subcategory && !decision) throw bad('Where should it point?');

    const tax = await shelfTaxonomy.taxonomy();
    let said;
    if (subcategory) {
      const sub = tax.subByKey.get(subcategory);
      if (!sub) throw bad(`${subcategory} is not one of our subcategories.`);
      // And here the rule goes last, for the same reason read the other way:
      // a word that reads as pointing at a drawer it does not yet fill is a
      // visible, harmless half-state, and a rule filing places into a drawer
      // the word does not admit to is not.
      await labelRepo.save({ namespace: 'google', key: word, decision: 'none', active: true });
      await labelRepo.pointAt('google', word, subcategory);
      await shelfRules.teach({
        scope: 'labels',
        labels: [`google:${word}`],
        subcategory,
        reason: `Pointed at ${sub.label} from the filing desk.`,
        by: actorOf(req),
      });
      said = `${word} → ${sub.label}`;
    } else {
      if (!['aside', 'generic', 'travel', 'nearby'].includes(decision)) {
        throw bad(`${decision} is not one of the answers.`);
      }
      /**
       * The rule first, deliberately.
       *
       * These are three statements and not one transaction, because each goes
       * through the repository that owns its table and none of them takes a
       * client. So the order is chosen for what a failure between them leaves
       * behind. The rule is the thing that actually files places; the other
       * two are how the word *reads*. Dropping the rule first means the worst
       * half-finished state is a word that still looks mapped and fills
       * nothing — visible on this very screen as "brings 0", and answerable
       * again. The other order would leave a word answered "not in Epic" that
       * is still quietly filing places into a drawer, which is the one state
       * nobody would go looking for.
       */
      const byScope = await shelfRules.rules();
      // Keyed by scope and then by subject, not a list — a canonicalised
      // `labels` rule is looked up by the subject the canonicaliser wrote,
      // which for a single word is the word itself.
      const rule = byScope.labels?.get(`google:${word}`);
      if (rule) await shelfRules.forgetRule(rule.id);
      await labelRepo.pointAt('google', word, null);
      await labelRepo.save({ namespace: 'google', key: word, decision });
      said = decision === 'aside' ? `${word} → Not in Epic` : `${word} → kept as a label`;
    }

    placeAttributes.forget();
    res.json({ word, said, before });
  } catch (err) { next(err); }
});

/**
 * PUT /mapping/:word/carries — a fact riding along on every place a word brings.
 *
 * Separate from where it points, because they are two different statements
 * about the same word and they never compete: `italian_restaurant` files a
 * place in Restaurants *and* says Italian. A scale is refused by the
 * repository, and rightly — a word may raise a question about a place and
 * never answer one.
 */
filingRoutes.put('/mapping/:word/carries', requires('manage_library'), async (req, res, next) => {
  try {
    const word = String(req.params.word);
    const attribute = String(req.body?.label ?? '');
    if (!attribute) throw bad('Which label?');
    const { byKey } = await placeAttributes.attributes();
    const attr = byKey.get(attribute);
    if (!attr) throw bad(`${attribute} is not one of our labels.`);
    const on = req.body?.on !== false;

    // What "on" means is the label's own shape. A yes/no carried by a word is
    // a yes; anything else has to be told what it carries, and says so rather
    // than guessing a value onto every place the word brings.
    let value = null;
    if (on) {
      if (attr.kind === 'yesno') value = { yesno: true };
      else if (req.body?.value) value = req.body.value;
      else throw bad(`${attr.label} is not a yes or no, so say what it carries.`);
    }
    await placeAttributes.setCarries(`google:${word}`, attribute, value);
    res.json({ word, attribute, on, said: `${attr.label} ${on ? 'carried by' : 'off'} ${word}` });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Rows — the long list a household browses
// ---------------------------------------------------------------------------

/**
 * GET /rows — every row, what its rule returns in each district, and its hearts.
 *
 * The fill is the expensive part and the reason it is one pass: forty rules
 * against every place is forty full scans if each row fetches for itself.
 *
 * `share` is null where nobody has hearted a row, which is a different fact
 * from nought — "nobody has yet" and "households looked and declined" read
 * differently, and a screen handed 0 cannot tell them apart.
 */
filingRoutes.get('/rows', requires('view_library'), async (req, res, next) => {
  try {
    const [list, ctx, limits, household] = await Promise.all([
      browseRows.rows(), browseRows.pool(), thresholdValues(), currentHousehold(),
    ]);
    const dists = browseRows.districts(ctx);
    const [hearts, { shares, households }] = await Promise.all([
      browseRows.heartsFor(household?.id ?? null), browseRows.shares(),
    ]);

    // The labels a shorthand is rendered with: our own attributes, plus the
    // drawers and cabinets a rule can name.
    const labels = new Map([
      ...[...ctx.attributes].map(([k, a]) => [k, { label: a.label }]),
      ...[...ctx.subcategories].map(([k, s]) => [k, { label: s.label }]),
      ...ctx.categories.map((c) => [c.key, { label: c.label }]),
    ]);

    const rows = list.map((r) => {
      const { fill, total } = browseRows.fillFor(r, ctx, dists.districts);
      // Every heart on this row, oldest first. More than one member of a
      // household can heart the same row, and the screen has to be able to
      // unheart the right one rather than the first person it can find.
      const mine = hearts.get(r.key) ?? [];
      const heart = mine[0] ?? null;
      return {
        id: r.key,
        group: r.grouping,
        title: r.title,
        copy: r.copy ?? '',
        rule: browseRows.shorthand(r.predicate, labels),
        // The rule itself, so the screen can edit it as structure rather than
        // as a caption it cannot parse back.
        predicate: r.predicate,
        fill,
        total,
        // Below the minimum fill *somewhere*: a row that works in one district
        // and is empty in another is the case the preview exists to find.
        thin: dists.districts.some((d) => (fill[d.code]?.count ?? 0) < limits.minRowFill),
        // Why it is empty, where it is: a gap in what we have asked and a gap
        // in what exists want different fixes and must not look the same.
        why: total === 0 ? browseRows.emptyBecause(r, ctx) : null,
        hearted: mine.length > 0,
        heartedBy: heart?.name ?? null,
        /**
         * Whose heart it is, by id.
         *
         * A name is not an identity — two members of one household can share
         * one — so a screen matching on `heartedBy` to decide what to delete is
         * guessing. This is the row the unheart is aimed at.
         */
        heartedById: heart?.member_id ?? null,
        /** Everyone who has hearted it, where more than one person has. */
        heartedByAll: mine.map((h) => ({ id: h.member_id, name: h.name })),
        heartedDays: heart ? Math.floor((Date.now() - new Date(heart.hearted_at).getTime()) / 86400000) : null,
        share: shares.get(r.key) ?? null,
      };
    });

    const { rows: members } = await query(
      `select id, name, is_minor, birth_year, birth_date from members
        where household_id = $1 order by is_minor, name`, [household?.id ?? null]);

    res.json({
      rows,
      districts: dists.districts.map((d) => ({ code: d.code, town: d.code, density: d.density, places: d.places })),
      // Said rather than padded: three districts that differ is the whole
      // point of the preview, and inventing them would make it a picture of
      // somewhere Epic holds nothing.
      districtsNote: dists.enough
        ? `previewed in three districts · ${dists.districts.map((d) => `${d.code} ${d.density}`).join(' · ')}`
        : `not enough places to preview a row in three districts — ${
          dists.districts.map((d) => `${d.code} holds ${d.places}`).join(' · ')}`,
      members: members.map((m) => ({
        id: m.id, name: m.name,
        role: m.is_minor ? 'child' : 'adult',
        age: m.birth_year ? new Date().getFullYear() - m.birth_year : null,
      })),
      household: household ? { id: household.id, name: household.name ?? null } : null,
      households,
      minFill: limits.minRowFill,
    });
  } catch (err) { next(err); }
});

/** PUT /rows/:id — its words, or its rule. The rule is checked before it is kept. */
filingRoutes.put('/rows/:id', requires('manage_library'), async (req, res, next) => {
  try {
    // The shorthand is rendered from the rule and is not a way of setting it.
    // Accepting it silently would return 200 having saved nothing, which is
    // precisely the prototype's own failure — an editable field that changes
    // nothing — reappearing on the other side of the wire (Codex, 21 Sep 2026).
    if (req.body?.rule !== undefined) {
      throw bad('A row\u2019s rule is set as structure, not as its shorthand. Send `predicate`.');
    }
    const ctx = await browseRows.pool();
    const row = await browseRows.save(String(req.params.id), {
      title: req.body?.title,
      copy: req.body?.copy,
      predicate: req.body?.predicate,
    }, {
      attributes: ctx.attributes,
      subcategories: new Set(ctx.subcategories.keys()),
      categories: new Set(ctx.categories.map((c) => c.key)),
    });
    res.json({ row });
  } catch (err) { next(err); }
});

/**
 * POST /rows/:id/heart — heart it, or take it back.
 *
 * `member` is required and is the first-heart question's answer. Hearting with
 * nobody chosen is not a heart to drop quietly; it is a question the screen
 * has to ask, so this refuses and says so rather than guessing an owner.
 */
filingRoutes.post('/rows/:id/heart', requires('manage_library'), async (req, res, next) => {
  try {
    const household = await currentHousehold();
    if (!household) throw bad('Which household? Nobody is signed in to one.');
    const memberId = req.body?.member ? String(req.body.member) : null;
    if (!memberId) throw bad('Whose list is this? Pick somebody first.');
    // And they have to be somebody in *this* household. Without the check any
    // member id would be recorded against the signed-in household, and
    // `heartsFor` would then read that person's name back out onto its screen
    // (Codex, 21 Sep 2026).
    const { rows: [mine] } = await query(
      'select id from members where id = $1 and household_id = $2', [memberId, household.id]);
    if (!mine) throw bad('That is not somebody in this household.');
    const out = await browseRows.heart(String(req.params.id), {
      householdId: household.id, memberId, on: req.body?.on !== false,
    });
    res.json({ row: req.params.id, hearted: Boolean(out) });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Rules — the defaults, and the two ways one can be wrong
// ---------------------------------------------------------------------------

/**
 * A default contradicted by more than this share of what it files is doing
 * more harm than good, and the screen tints the row.
 *
 * It is not `spreadLimit`. That one decides whether a drawer has an answer at
 * all — past it the places disagree too much for a default to be proposed.
 * This one is about a default that *already exists*, usually because somebody
 * accepted it, and is now wrong about most of what it touches. A drawer can
 * sit under the first and over the second.
 */
const DEAD_SHARE = 0.6;

/**
 * GET /rules — every default a drawer sets, worst first.
 *
 * **Two columns, because there are two different ways to be wrong** (owner,
 * 20 Sep 2026), and they must not be added together:
 *
 *  - **Places contradict it** is computed. Of the places this default files,
 *    how many hold a different value. A high count can mean the rule is too
 *    broad, or that the drawer wants splitting. Nobody has said anything — the
 *    data disagrees with itself.
 *  - **People called it wrong** is human: of those, how many were set by a
 *    person. Every one is somebody who looked at a place and said no, which
 *    makes it the stronger signal of the two and the reason it is counted
 *    separately rather than folded in.
 *
 * It is deliberately *not* `rule_overrides`. That table records a place being
 * moved to a different drawer — a fact about filing — and a default is a fact
 * about what a drawer says. Counting one as the other would put "41 people
 * moved this place" beside "how thrilling · 3" and invite somebody to retire a
 * default because of a filing argument.
 */
filingRoutes.get('/rules', requires('view_library'), async (_req, res, next) => {
  try {
    const d = await filing.drawers();
    const { byKey } = await placeAttributes.attributes();
    const { rows, defaults } = filing.rulesFrom({
      subcategories: d.subcategories,
      refsBySub: d.refsBySub,
      defaultsBySub: d.defaultsBySub,
      valuesByRef: d.valuesByRef,
      byKey,
      deadShare: DEAD_SHARE,
    });

    res.json({
      rules: rows,
      counts: {
        rules: defaults,
        arguedWith: rows.filter((r) => r.contradicted > 0).length,
        dead: rows.filter((r) => r.dead).length,
        overruled: rows.filter((r) => r.overridden > 0).length,
      },
    });
  } catch (err) { next(err); }
});

/**
 * POST /rules/:id/retire — the drawer stops saying this.
 *
 * Retiring is deleting the default, not overwriting it with a blank: a row
 * holding nothing would have to be read as "we looked and could not say",
 * which is a different answer from never having had one. Every place keeps
 * whatever it says for itself.
 */
filingRoutes.post('/rules/:id/retire', requires('manage_library'), async (req, res, next) => {
  try {
    const [subcategory, attribute] = String(req.params.id).split(':');
    if (!subcategory || !attribute) throw bad('Which drawer, and which answer?');
    const { rowCount } = await query(
      `delete from shelf_subcategory_attributes where subcategory_key = $1 and attribute_key = $2`,
      [subcategory, attribute],
    );
    if (!rowCount) throw bad('That drawer does not set that answer.');
    res.json({ retired: true, subcategory, attribute, by: actorOf(req) });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Runs — where the volume dies, and whether the queue is winning
// ---------------------------------------------------------------------------



/** The runs that can be started, with what each would cost before the click. */
/** What each kind of run is called on the screen. */
const RUN_NAMES = {
  google: 'Vocabulary harvest',
  free: 'Free sweep',
  probe: 'Probe',
  features: 'Feature pass',
};

const TRIGGERS = [
  {
    key: 'free', name: 'Free sweep', action: 'Run the sweep', cost: '£0.00', rate: null,
    sources: 'the venue’s page · OSM · Wikipedia · nothing paid for',
  },
  {
    key: 'harvest', name: 'Vocabulary harvest', action: 'Run the harvest', cost: null,
    rate: '0.33p a place', sources: 'reviews only',
  },
  {
    key: 'validate', name: 'Validation pass', action: 'Validate them', cost: '£0.00', rate: null,
    sources: 'the venue’s page · OSM · Wikipedia',
  },
];

/**
 * GET /runs — the funnel per run, the queue's direction, and saturation.
 *
 * Readable cold: every number carries its own scope in words rather than
 * relying on a column header, and a bad drop is named rather than left as a
 * shape for somebody to interpret.
 */
filingRoutes.get('/runs', requires('view_library'), async (_req, res, next) => {
  try {
    const limits = await thresholdValues();
    const [runList, sets, counted] = await Promise.all([
      questionSets.runs({ limit: 12 }),
      questionSets.sets(),
      query(`select subcategory, status, kind, places_seen, places_total, first_seen from harvest_candidates`),
    ]);

    // A stalled run belongs in the list, not in the live panel: it is not
    // going, and pretending it finished would invent a result.
    const runs = runList.filter((r) => livenessOf(r) !== 'running').map((r) => {
      const f = r.funnel ?? null;
      // Raised by *this* run: its own subcategories, inside its own window.
      // `first_seen` is when a word was raised, so a word this run saw again
      // belongs to the run that found it, not to this one.
      const mine = counted.rows.filter((c) => (r.subcategories ?? []).includes(c.subcategory)
        && c.first_seen >= r.started_at
        && (!r.finished_at || c.first_seen <= r.finished_at));
      const thin = mine.filter((c) => (c.places_seen ?? 0) < limits.sightingFloor).length;
      const waiting = mine.filter((c) => c.status === 'new' && c.kind === 'feature'
        && (c.places_seen ?? 0) >= limits.sightingFloor).length;
      const d = livenessOf(r) === 'stalled'
        // It did not report, and we do not know how it ended. "Not recorded"
        // would blame the funnel for something the run never got to.
        ? { says: 'stopped without finishing', at: null, healthy: false, recorded: Boolean(f), spoke: false }
        : diagnose(f);

      return {
        id: String(r.id),
        name: RUN_NAMES[r.kind] ?? r.kind,
        at: r.finished_at ?? r.started_at,
        scope: `${(r.subcategories ?? []).length} subcategories`,
        sources: r.kind === 'google' ? 'reviews only' : 'the venue’s page · OSM · Wikipedia',
        cost: Number(r.cost_usd ?? 0),
        state: r.status === 'failed' ? 'failed' : livenessOf(r) === 'stalled' ? 'stalled' : 'done',
        funnel: STAGES.map(([key, name]) => ({
          key,
          name,
          // Null where the run did not record it. Nought would read as
          // "nothing came through", which is the one thing it does not mean.
          count: key === 'thin' ? thin : key === 'waiting' ? waiting : (f ? f[key] ?? null : null),
          bad: d.at === key,
        })),
        diagnosis: d.says,
        healthy: d.healthy,
        recorded: d.recorded,
        // Whether that diagnosis is a verdict or a shrug. A run too small to
        // judge is not unhealthy, so `healthy` alone cannot tell the screen to
        // draw it quietly.
        spoke: d.spoke,
        /**
         * Saturation per *subcategory*, which is what the run measured.
         *
         * The panel below reports it per question set, because a set is what
         * settles and stops being read. But a set is made of drawers, there are
         * no sets yet, and the question somebody actually has after a run is
         * "which drawers need more places" — which the run already answers and
         * nothing surfaced (owner, 21 Sep 2026: "Saturation per subcategory —
         * which are settled, which need more places").
         */
        curves: Object.entries(r.saturation ?? {})
          .map(([key, c]) => ({
            subcategory: key,
            sampled: c.sampled ?? c.places ?? 0,
            distinct: c.distinct ?? 0,
            // New words the last full block of ten places taught.
            newWordsPerTen: c.curve?.filter((x) => !x.partial).at(-1)?.newWords ?? null,
            settled: Boolean(c.saturated),
            // Twenty places that taught nothing because there was nothing to
            // read about them is the drawer that most needs the next pass, not
            // one we have finished with.
            nothingToRead: Boolean(c.nothingToRead),
          }))
          .sort((a, b) => (b.newWordsPerTen ?? 0) - (a.newWordsPerTen ?? 0)),
      };
    });

    const weeks = await weeksOf(counted.rows);
    res.json({
      headline: headlineOf(weeks),
      scope: `${sets.length} question sets · ${counted.rows.length} words raised in all`,
      triggers: TRIGGERS,
      // A run in flight is the one thing this screen cannot be missing: runs
      // take hours, and a screen with no live state looks like a screen where
      // nothing is happening.
      live: liveOf(runList.find((r) => livenessOf(r) === 'running') ?? null),
      runs,
      weeks,
      clears: clearsOf(weeks),
      saturation: saturationOf(sets, counted.rows, limits),
    });
  } catch (err) { next(err); }
});

/** Four weeks of raised against decided, oldest first. */
async function weeksOf(candidates) {
  const week = 7 * 24 * 3600 * 1000;
  const now = Date.now();
  const out = [];
  for (let i = 3; i >= 0; i -= 1) {
    const from = now - (i + 1) * week;
    const to = now - i * week;
    const label = new Date(from).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    out.push({
      label,
      raised: candidates.filter((c) => +new Date(c.first_seen) >= from && +new Date(c.first_seen) < to).length,
      decided: 0,
    });
  }
  const { rows } = await query(
    `select decided_at from harvest_candidates where decided_at is not null and decided_at > now() - interval '28 days'`);
  for (const r of rows) {
    const at = +new Date(r.decided_at);
    const i = Math.floor((now - at) / week);
    if (i >= 0 && i < 4) out[3 - i].decided += 1;
  }
  return out;
}



/** The live run, with its stages filling one at a time. */
function liveOf(run) {
  if (!run) return null;
  const f = run.funnel ?? {};
  return {
    name: RUN_NAMES[run.kind] ?? run.kind,
    scope: `${(run.subcategories ?? []).length} subcategories`,
    funnel: STAGES.map(([key, name]) => ({ name, count: f[key] ?? 0, done: f[key] != null })),
  };
}


// ---------------------------------------------------------------------------
// The decision log
// ---------------------------------------------------------------------------

/** What each ending is called on the row, and which of them reads as a gain. */
const DECISIONS = {
  promoted: { word: 'approved', decision: 'approved' },
  ignored: { word: 'ignored', decision: 'ignored' },
  merged: { word: 'merged', decision: 'merged' },
  parked: { word: 'parked', decision: 'parked' },
  rejected: { word: 'rejected', decision: 'rejected' },
  unresolved: { word: 'held', decision: 'held' },
};

/**
 * GET /decisions — what was decided, newest first.
 *
 * Without this there is no answer to "what did I do last Tuesday", which is
 * the difference between traceable and auditable (handoff §15). It reads
 * `harvest_candidates` rather than a log of its own: a candidate carries its
 * status, who decided it and when, so a second table would be a second
 * version of the same truth and the two would drift.
 */
filingRoutes.get('/decisions', requires('view_library'), async (req, res, next) => {
  try {
    const want = String(req.query.decision ?? '').trim();
    const inSet = String(req.query.set ?? '').trim();
    const [{ rows }, sets, d] = await Promise.all([
      query(`select id, norm, raw_forms, subcategory, status, decided_by, decided_at, question_id
               from harvest_candidates
              where decided_at is not null
              order by decided_at desc limit 500`),
      questionSets.sets(),
      filing.drawers(),
    ]);

    const setOf = new Map();
    for (const s of sets) for (const sub of s.subcategories ?? []) setOf.set(sub, s);

    const all = rows.map((r) => {
      const spec = DECISIONS[r.status] ?? { word: r.status, decision: r.status };
      const set = setOf.get(r.subcategory) ?? null;
      const drawer = d.subcategories.find((x) => x.key === r.subcategory) ?? null;
      return {
        id: Number(r.id),
        // The word a person typed, where we kept it, rather than the
        // normalised key — the log is read by the person who decided it.
        word: r.raw_forms?.[0] ?? r.norm,
        set: set?.name ?? null,
        setKey: set?.key ?? null,
        decision: spec.decision,
        // The decision said in full, so a row reads without its column header.
        said: spec.decision === 'merged' && drawer ? `merged into ${drawer.label}` : spec.word,
        at: r.decided_at,
        by: r.decided_by ?? null,
      };
    });

    const decisions = all.filter((r) => (!want || want === 'all' || r.decision === want)
      && (!inSet || inSet === 'all' || r.setKey === inSet));

    res.json({
      decisions,
      sets: sets.map((s) => ({ key: s.key, name: s.name })),
      counts: { shown: decisions.length, all: all.length },
    });
  } catch (err) { next(err); }
});

/**
 * GET /decisions/:word/trail — one word, from first sighting to what it is
 * asked of now.
 *
 * Built from the dates the candidate already carries rather than from an
 * event stream, so it cannot disagree with the row it came from. Where a step
 * has no date of its own it is left out rather than guessed at.
 */
filingRoutes.get('/decisions/:word/trail', requires('view_library'), async (req, res, next) => {
  try {
    const word = String(req.params.word);
    const { rows } = await query(
      `select * from harvest_candidates where norm = $1 or $1 = any(raw_forms) limit 1`, [word]);
    const c = rows[0];
    if (!c) throw bad(`Nothing has been raised called “${word}”.`);

    const when = (at) => (at ? new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—');
    const steps = [];
    steps.push({
      when: when(c.first_seen),
      what: `seen on ${c.places_seen} of ${c.places_total ?? c.places_seen} places read`,
    });
    if (c.denies) {
      steps.push({ when: when(c.first_seen), what: `${c.denies} of those said it hasn’t got one` });
    }
    if (c.classified_at) {
      steps.push({
        when: when(c.classified_at),
        what: c.kind === 'unclear'
          ? 'held · the classifier could not call it'
          : `classified as ${c.kind === 'feature' ? 'a feature' : c.kind}`,
      });
    }
    if (c.decided_at) {
      const spec = DECISIONS[c.status] ?? { word: c.status };
      steps.push({
        when: when(c.decided_at),
        what: c.decided_by ? `${spec.word} by ${c.decided_by}` : spec.word,
      });
    }
    if (c.question_id) {
      const asked = await query(
        `select count(*)::int n from place_answers where question_id = $1`, [c.question_id]);
      steps.push({ when: '—', what: `asked of ${asked.rows[0].n} places` });
    } else if (c.status === 'promoted') {
      steps.push({ when: '—', what: 'approved · not attached to a set, so nothing asks it' });
    }

    res.json({ trail: { word: c.raw_forms?.[0] ?? c.norm, steps } });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Train — teaching one place at a time
// ---------------------------------------------------------------------------

/**
 * GET /subcategories/:key/train — a screenful of the drawer, to tap the wrong
 * ones out of.
 *
 * The sweep this route used to feed — one place, one graded axis at a time,
 * "we think 3" — went with the eight (the axes brief, 25 Sep 2026): a number a
 * person puts on how thrilling somewhere is cannot be extracted from text and
 * is not a fact about the place. What is left is the grid, which is a filing
 * question and not a judgement: is this place one of these, or not.
 */
filingRoutes.get('/subcategories/:key/train', requires('view_library'), async (req, res, next) => {
  try {
    const key = String(req.params.key);
    const d = await filing.drawers();
    const sub = d.subcategories.find((s) => s.key === key);
    if (!sub) throw bad(`${key} is not one of our subcategories.`);
    const refs = d.refsBySub.get(key) ?? [];

    res.json({
      subcategory: { key: sub.key, label: sub.label, places: refs.length },
      // Twelve for the grid — a screenful, and enough that being wrong about
      // one is obvious beside eleven that are right.
      grid: refs.slice(0, 12).map((ref) => {
        const rec = d.recordsByRef.get(ref) ?? null;
        return { ref, name: rec?.name ?? null, town: townOf(rec), photo: rec?.image_url ?? null };
      }),
    });
  } catch (err) { next(err); }
});

/**
 * PUT /places/:ref — what one place says for itself.
 *
 * Always attributed. A value a person set outranks the drawer for good, and
 * the screens draw it differently, so an unattributed write would be a value
 * nobody could later argue with.
 */
filingRoutes.put('/places/:ref', requires('manage_library'), async (req, res, next) => {
  try {
    const ref = String(req.params.ref);
    const attribute = String(req.body?.attribute ?? '');
    if (!attribute) throw bad('Which answer?');
    const { byKey } = await placeAttributes.attributes();
    const attr = byKey.get(attribute);
    if (!attr) throw bad(`${attribute} is not one of our labels.`);
    const value = req.body?.value ?? null;
    const saved = await placeAttributes.setValue(ref, attribute, value, {
      reason: req.body?.reason ? String(req.body.reason).slice(0, 300) : null,
      by: actorOf(req),
    });
    res.json({
      ref,
      attribute,
      value: saved ? filing.said(value, attr) : null,
      said: saved
        ? `${attr.label} set to ${filing.said(value, attr)}`
        : `${attr.label} back to what it inherits`,
    });
  } catch (err) { next(err); }
});

/**
 * GET /places/:ref — one place, as both the back office and a household see it.
 *
 * The question set's answers come back in the three states they are genuinely
 * in, and the middle one is the one worth keeping: **nothing found** is a real
 * answer. Three sources were read and none mentioned it, which is a different
 * fact from never having asked — and the two look identical if a screen only
 * knows "answered" and "blank" (the question-sets brief, 20 Sep 2026).
 */
filingRoutes.get('/places/:ref', requires('view_library'), async (req, res, next) => {
  try {
    const ref = String(req.params.ref);
    const d = await filing.drawers();
    const { rows: where } = await query(
      'select subcategory, category from place_index where venue_ref = $1', [ref]);
    const subKey = where[0]?.subcategory ?? null;
    if (!subKey) throw bad('That place is not filed anywhere yet.');
    const sub = d.subcategories.find((s) => s.key === subKey) ?? null;
    const drawer = await filing.drawerOf(subKey, d);
    const mine = d.valuesByRef.get(ref) ?? new Map();
    const rec = d.recordsByRef.get(ref) ?? null;

    const say = (a) => {
      const own = mine.get(a.key);
      return {
        key: a.key,
        label: a.label,
        kind: a.kind,
        anchor: a.anchor,
        value: own ?? a.value ?? null,
        said: filing.said(own ?? a.value, a),
        // Where the answer came from, which is what the control's colour says:
        // a person's own answer is drawn filled, an inherited one in lime.
        from: own?.by ? 'a person' : own ? 'what we hold' : a.value ? 'the drawer' : null,
        mine: Boolean(own),
      };
    };

    const setKey = d.setBySub.get(subKey) ?? null;
    let questions = [];
    // With or without a set. A drawer with no question set is still asked the
    // global questions — Duration and Cost band since migration 246 — and
    // `questionsFor(null)` is exactly those (Codex, 25 Sep 2026).
    {
      const [qs, { rows: answered }] = await Promise.all([
        questionSets.questionsFor(setKey),
        query('select * from place_answers where venue_ref = $1', [ref]),
      ]);
      /**
       * One question can have several answers, one per source.
       *
       * `place_answers` is keyed `(venue_ref, question_id, source)` precisely
       * so that two sources disagreeing are both kept — the brief is explicit
       * that disagreement is stored unresolved and never silently resolved. A
       * plain map by question id keeps whichever row the database happened to
       * return first, so the same place could read Yes or Nothing found on
       * consecutive loads (Codex, 21 Sep 2026).
       *
       * So: an answer beats a nothing-found, and among equals the most
       * recently checked wins — and where two *answered* sources disagree the
       * row says so rather than picking one.
       */
      const byQ = new Map();
      for (const a of answered) {
        const id = String(a.question_id);
        const had = byQ.get(id);
        if (!had) { byQ.set(id, a); continue; }
        const better = (x, y) => {
          if ((x.state === 'answered') !== (y.state === 'answered')) return x.state === 'answered' ? x : y;
          return new Date(x.checked_at ?? 0) >= new Date(y.checked_at ?? 0) ? x : y;
        };
        const keep = better(a, had);
        const other = keep === a ? had : a;
        // Two sources that both answered and do not agree is a fact about the
        // place, not a tie to break quietly.
        const said = (r) => (r.yesno != null ? String(r.yesno) : r.choice ?? String(r.number ?? ''));
        keep.unresolved = keep.unresolved
          || (keep.state === 'answered' && other.state === 'answered' && said(keep) !== said(other));
        byQ.set(id, keep);
      }
      // The set's own questions and the ones asked of everything: Duration
      // and Cost band are global (migration 246), and an answer to a global
      // question is as much a fact about this place as one to the set's
      // (Codex, 25 Sep 2026).
      questions = qs.filter((q) => q.set_key === setKey || q.scope === 'global').map((q) => {
        const a = byQ.get(String(q.id));
        if (!a) {
          return { id: Number(q.id), name: q.label, state: 'notasked',
            said: 'Not asked yet', source: 'added after this place was last read' };
        }
        if (a.state !== 'answered') {
          return { id: Number(q.id), name: q.label, state: 'nothing',
            said: 'Nothing found',
            source: a.source ? `${a.source} read it and did not mention it` : 'read, and not mentioned' };
        }
        return {
          id: Number(q.id), name: q.label, state: 'answered',
          said: a.yesno != null ? (a.yesno ? 'Yes' : 'No')
            : a.choice ?? (a.number != null ? String(a.number) : '—'),
          source: `${a.source}${a.checked_at ? ` · checked ${new Date(a.checked_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}`,
          url: a.source_url ?? null,
          unresolved: a.unresolved,
        };
      });
    }

    res.json({
      place: {
        ref,
        name: rec?.name ?? null,
        town: townOf(rec),
        photo: rec?.image_url ?? null,
        subcategory: sub ? { key: sub.key, label: sub.label } : null,
      },
      facets: drawer.facets.map(say),
      questions,
      set: setKey ? { key: setKey, name: d.setByKey.get(setKey)?.name ?? setKey } : null,
    });
  } catch (err) { next(err); }
});

/**
 * POST /subcategories/:key/not-sure — these do not belong here.
 *
 * The honest half of the grid. Saying a place is not a museum is a real
 * judgement and goes somewhere real: the not-sure list, where where-it-should-
 * go is decided with the rest of its kind. Confirming the others writes
 * nothing, because there is nowhere to write it and a screen that reported a
 * confirmation it had not made would be worse than one that does not offer it.
 */
filingRoutes.post('/subcategories/:key/not-sure', requires('manage_library'), async (req, res, next) => {
  try {
    const key = String(req.params.key);
    const d = await filing.drawers();
    const sub = d.subcategories.find((s) => s.key === key);
    if (!sub) throw bad(`${key} is not one of our subcategories.`);
    const refs = (Array.isArray(req.body?.refs) ? req.body.refs : []).map(String).filter(Boolean).slice(0, 50);
    if (!refs.length) throw bad('Which places?');
    let queued = 0;
    for (const ref of refs) {
      const rec = d.recordsByRef.get(ref) ?? null;
      await notSure.notSettled({
        ref,
        name: rec?.name ?? null,
        address: rec?.postcode ?? null,
        words: [],
        wouldBe: key,
        reason: `A person looked at it beside eleven others and said it is not ${sub.label.toLowerCase()}.`,
      });
      queued += 1;
    }
    res.json({ queued, said: `${queued} sent to Not sure`, by: actorOf(req) });
  } catch (err) { next(err); }
});

/**
 * GET /mapping/:word/destinations — where this word could point, and what
 * each would do.
 *
 * Fetched when a row opens rather than sent with the table, because the
 * consequence depends on the *word*: 485 words against 74 drawers is 36,000
 * sentences nobody will read, and one row-open is exactly when you need the
 * twelve that matter.
 *
 * **The note is written here and is never optional.** The design brief calls
 * it "the single highest-value thing on this screen" — "Landmarks & monuments
 * — brings in 1,240 places · 1,180 have never been opened" is what would have
 * prevented most of the present mess. Composed in the screen it would get the
 * plurals wrong the first time a word brought one place.
 */
filingRoutes.get('/mapping/:word/destinations', requires('view_library'), async (req, res, next) => {
  try {
    const word = String(req.params.word);
    const [evidence, d, { list: attrs }] = await Promise.all([
      taxonomyAudit.evidence(), filing.drawers(), placeAttributes.attributes(),
    ]);
    const refs = evidence.placesByWord.get(word) ?? [];
    const opened = refs.filter((r) => (evidence.openedByRef.get(r) ?? 0) > 0).length;
    const brings = refs.length;
    const never = Math.max(0, brings - opened);
    const readable = [...evidence.openedByRef.values()].reduce((n, v) => n + v, 0) >= CORPUS_OPENS;

    const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
    const noteFor = (already) => {
      const bits = [`brings in ${plural(brings, 'place')}`];
      // "None of them has ever been opened" only means something once opening
      // happens at all — the same floor the audit and the front door use.
      if (readable && brings) bits.push(`${plural(never, 'has', 'have')} never been opened`);
      bits.push(`joins ${plural(already, 'place')} already there`);
      return bits.join(' · ');
    };

    const categories = d.categories.filter((c) => c.active)
      .map((c) => ({
        key: c.key,
        name: c.label,
        count: d.subcategories.filter((s) => s.active && s.category_key === c.key).length,
      }));

    const subcategories = d.subcategories.filter((s) => s.active).map((s) => ({
      key: s.key,
      name: s.label,
      category: s.category_key,
      kind: 'subcategory',
      note: noteFor(d.refsBySub.get(s.key)?.length ?? 0),
      // Bad news on a destination is a word that would bring in a lot of
      // places nobody wants. Only sayable once demand can be read.
      grave: readable && brings > 100 && never === brings,
    }));

    res.json({
      word,
      brings,
      opened,
      categories,
      subcategories,
      labels: attrs.filter((a) => a.active).map((a) => ({
        key: a.key,
        name: a.label,
        kind: 'label',
        note: `a fact carried by every place ${word} brings`,
      })),
      notInEpic: {
        key: 'aside',
        name: 'Not in Epic',
        kind: 'out',
        note: `keeps ${plural(brings, 'place')} out · excluding is an answer`,
      },
    });
  } catch (err) { next(err); }
});

/**
 * GET /pending — words a person typed that nothing asks yet.
 *
 * The third of the Labels screens, and the one with the least data behind it
 * on a young estate: every harvested word came from a source, and a word a
 * *person* typed is a different thing — somebody looked at a place, wrote
 * something down, and it has been sitting there ever since.
 *
 * Two things arrive here. A candidate raised by a human rather than by a
 * source, and one of our own labels that was approved into the vocabulary and
 * then never attached to anything — the orphan case, which is the commoner of
 * the two and is the one the screen exists to clear.
 *
 * **When it is empty it says which kind of empty.** An empty list and a list
 * nobody can produce look identical, and the second is what this is today.
 */
filingRoutes.get('/pending', requires('view_library'), async (_req, res, next) => {
  try {
    const [{ list: attrs }, all, sets, typed] = await Promise.all([
      placeAttributes.attributes(),
      // And here it mattered most: a label asked only by a set was never seen
      // as asked, so it was offered as an orphan to be retired.
      questionSets.everyQuestion(),
      questionSets.sets(),
      query(`select id, norm, raw_forms, subcategory, places_seen, sources, examples
               from harvest_candidates
              where status in ('new', 'unresolved') and sources ? 'human'
              order by places_seen desc limit 200`),
    ]);
    const asked = new Set(all.map((q) => q.attribute_key));
    const setName = new Map(sets.map((s) => [s.key, s.name]));

    const orphans = attrs
      .filter((a) => a.active && !asked.has(a.key))
      .map((a) => ({
        id: a.key,
        word: a.label,
        times: 1,
        from: 'approved into the vocabulary, and never attached to a set',
        // The closest things we already have, by the words they share.
        near: nearestLabels(a, attrs).map((x) => x.label),
        repoint: 'nothing asks it, so nothing would move',
        kind: 'orphan',
      }));

    const human = typed.rows.map((c) => ({
      id: String(c.id),
      word: c.raw_forms?.[0] ?? c.norm,
      times: Number(c.sources?.human ?? 1),
      from: c.subcategory ? `typed on a place in ${c.subcategory}` : 'typed by a person',
      near: nearestLabels({ label: c.norm }, attrs).map((x) => x.label),
      repoint: `${c.places_seen} ${c.places_seen === 1 ? 'place' : 'places'}`,
      kind: 'typed',
    }));

    res.json({
      pending: [...human, ...orphans],
      sets: sets.map((s) => ({ key: s.key, name: setName.get(s.key) ?? s.key })),
      counts: { typed: human.length, orphans: orphans.length },
      why: human.length + orphans.length === 0
        ? 'nothing is waiting: every label we have is asked somewhere, and nobody has typed a new word on a place yet'
        : human.length === 0
          ? 'nobody has typed a word on a place yet — these are labels approved into the vocabulary that nothing asks'
          : null,
    });
  } catch (err) { next(err); }
});

/** The labels closest to a word, by the words they have in common. */
function nearestLabels(a, attrs) {
  const words = new Set(String(a.label ?? '').toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2));
  if (!words.size) return [];
  return attrs
    .filter((x) => x.active && x.key !== a.key)
    .map((x) => ({
      ...x,
      shared: String(x.label).toLowerCase().split(/[^a-z]+/).filter((w) => words.has(w)).length,
    }))
    .filter((x) => x.shared > 0)
    .sort((x, y) => y.shared - x.shared)
    .slice(0, 3);
}

/**
 * GET /runs/:id/stages/:stage — what is actually in one stage of one run.
 *
 * The expander on a run row. It exists because a funnel is a shape and a shape
 * is not evidence: "1,290 after the resolver" is a claim somebody has to be
 * able to open and disagree with, and an expander that opens on nothing is the
 * failure this section keeps re-learning.
 *
 * Three of the seven can be listed exactly, from the candidates the run raised:
 * the words it collapsed to, the ones too thin to judge, and the ones in the
 * holding pen. Two more — what it wrote down, and what is waiting on a person —
 * are the same list under a different question.
 *
 * Two cannot, and say so rather than showing something close:
 *
 *   · **places read** is a count and not a list. A run records how many places
 *     it read, never which, and inventing the list from the drawer's places
 *     today would be a different set — places have been added since.
 *   · **words out** is mentions before normalisation, and those are gone by
 *     design. They are read out of rented text in memory and never written
 *     down; the collapsed word is what survives. That is the policy working,
 *     not a hole.
 */
filingRoutes.get('/runs/:id/stages/:stage', requires('view_library'), async (req, res, next) => {
  try {
    const stage = String(req.params.stage);
    const known = STAGES.find(([key]) => key === stage);
    if (!known) throw bad(`There is no stage called ${stage}.`);

    const { rows: [run] } = await query('select * from vocabulary_runs where id = $1', [req.params.id]);
    if (!run) throw bad('There is no run by that id.');

    const limits = await thresholdValues();
    const subs = run.subcategories ?? [];
    const { rows: raised } = await query(
      `select norm, raw_forms, subcategory, places_seen, places_total, status, kind
         from harvest_candidates
        where subcategory = any($1)
          and first_seen >= $2
          and ($3::timestamptz is null or first_seen <= $3)
        order by places_seen desc, norm`,
      [subs, run.started_at, run.finished_at]);

    const floor = limits.sightingFloor;
    const thin = raised.filter((c) => (c.places_seen ?? 0) < floor);
    const held = raised.filter((c) => c.kind === 'unclear');
    const waiting = raised.filter((c) => c.status === 'new' && c.kind === 'feature'
      && (c.places_seen ?? 0) >= floor);
    const word = (c) => c.raw_forms?.[0] ?? c.norm;

    // What the run recorded for this stage, or null where it recorded nothing.
    // `read` has a second home — `vocabulary_runs.places` predates the funnel —
    // so a run from before migration 232 can still say how many it read.
    const counted = run.funnel?.[stage] ?? (stage === 'read' ? run.places ?? null : null);
    const lists = {
      // Not a list, and saying so beats a plausible one: a run records how many
      // places it read, never which.
      read: { items: [], note: 'a run records how many places it read, never which' },
      // Gone by design. The mentions are read out of rented text in memory and
      // never written down; the collapsed word is what survives.
      raw: { items: [], note: counted == null
        ? 'this run did not record its middle'
        : 'mentions before normalisation · read in memory and never written down' },
      collapsed: { items: raised.map(word), note: 'distinct words after the resolver' },
      thin: { items: thin.map(word), note: `below ${floor} sightings · visible, and not promotable` },
      held: { items: held.map(word), note: 'the classifier could not call these' },
      // Everything the run wrote down, which is what the funnel counts. It
      // filtered to features here and the expander opened on nothing while the
      // row above it said forty thousand — the exact failure the drill exists
      // to prevent.
      stored: {
        items: raised.map(word),
        note: `${raised.filter((c) => c.kind === 'feature').length} of these are features;`
          + ` the rest are in the holding pen until something can call them`,
      },
      waiting: { items: waiting.map(word), note: 'at or above the floor, and nobody has decided them' },
    };

    const out = lists[stage];
    res.json({
      run: String(run.id),
      name: known[1],
      // Null, not nought, where the run did not record it and the stage cannot
      // be listed: nought would read as "nothing came through", which is the
      // one thing it does not mean.
      ...stageOf({ stage, funnel: run.funnel, places: run.places, items: out.items }),
      // Where the run counted more than this list holds, the difference is
      // words it saw again rather than words that are missing — and the note
      // has to say which, or the list reads as a shortfall.
      note: out.note,
      // Capped, because a stage can hold a thousand words and the expander is a
      // row on a table. The count above is the whole of it.
      items: out.items.slice(0, 60),
      more: Math.max(0, out.items.length - 60),
      /**
       * What the list is, said plainly.
       *
       * On a repeat run the funnel counts every word that passed through and
       * the list holds only the ones first raised then, because `first_seen`
       * never moves. Both are true; they are different questions.
       */
      listNote: stageOf({ stage, funnel: run.funnel, places: run.places, items: out.items }).exact
        ? null
        : 'the words this run raised for the first time; the count above includes ones it saw again',
      subs: subs.length ? `${subs.length} subcategories · ${subs.slice(0, 6).join(', ')}${subs.length > 6 ? '…' : ''}` : 'every question set',
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Making a category, making a drawer, and filling several at once
// ---------------------------------------------------------------------------

/** POST /categories — name a category. It starts empty, and says so. */
filingRoutes.post('/categories', requires('manage_library'), async (req, res, next) => {
  try {
    const label = String(req.body?.label ?? '').trim();
    if (!label) throw bad('Name the category.');
    const row = await shelfTaxonomy.saveCategory({ label, by: actorOf(req) });
    res.json({ category: { key: row.key, label: row.label }, said: `${row.label} added · no subcategories yet` });
  } catch (err) { next(err); }
});

/**
 * POST /subcategories — name a drawer, and give it a bar in the same breath.
 *
 * **A drawer without a bar is a drawer full of invisible places.** Every place
 * in it reads "not set" for ever: never scored, never ready, never on a board.
 * Twenty-four of seventy-four drawers on production were in that state this
 * morning, thirteen of them made through an API rather than by a migration —
 * and the test that guards the invariant builds from migrations, so it could
 * not see a single one of them (epic-1c, 21 Sep 2026).
 *
 * `seedBars()` would give it one at the next boot. Between now and then is a
 * window in which somebody files places into a drawer that cannot score them,
 * so the bar is written here rather than waited for.
 */
filingRoutes.post('/subcategories', requires('manage_library'), async (req, res, next) => {
  try {
    const label = String(req.body?.label ?? '').trim();
    const categoryKey = String(req.body?.category ?? '').trim();
    if (!label) throw bad('Name the subcategory.');
    if (!categoryKey) throw bad('Which category does it belong to?');
    const row = await shelfTaxonomy.saveSubcategory({ categoryKey, label, by: actorOf(req) });
    // Inherited from the drawers beside it, because there is no coded bar for
    // a drawer nobody has written one for.
    const bar = await placeIndex.inheritBar(row.key).catch(() => null);
    res.json({
      subcategory: { key: row.key, label: row.label },
      bar: Boolean(bar),
      said: bar
        ? `${row.label} added · no places yet, and it knows what would make one ready`
        : `${row.label} added · no places yet, and it has no bar — its places cannot be scored`,
    });
  } catch (err) { next(err); }
});

/**
 * POST /categories/:key/apply — say one thing about several drawers at once.
 *
 * Two kinds of pick, and they do different things. A **label** becomes a
 * default on every ticked drawer — a fact about the places in it. A
 * **subcategory** lists the ticked drawers in that one's *cabinet*, which is
 * what "Also in" holds: our schema files a drawer under extra categories, not
 * under other drawers.
 *
 * The reply says what happened in the words the screen will print, because
 * "applied 3" is not a sentence a person can check against what they meant.
 */
filingRoutes.post('/categories/:key/apply', requires('manage_library'), async (req, res, next) => {
  try {
    const subs = (Array.isArray(req.body?.subcategories) ? req.body.subcategories : []).map(String).filter(Boolean);
    const picks = (Array.isArray(req.body?.picks) ? req.body.picks : []).slice(0, 20);
    if (!subs.length) throw bad('Which drawers?');
    if (!picks.length) throw bad('What should land on them?');

    const [d, { byKey }] = await Promise.all([filing.drawers(), placeAttributes.attributes()]);
    const byKeySub = new Map(d.subcategories.map((s) => [s.key, s]));
    for (const key of subs) if (!byKeySub.has(key)) throw bad(`${key} is not one of our subcategories.`);

    const did = [];
    for (const pick of picks) {
      const kind = String(pick?.kind ?? '');
      const key = String(pick?.key ?? '');
      if (kind === 'label') {
        const attr = byKey.get(key);
        if (!attr) throw bad(`${key} is not one of our labels.`);
        if (attr.kind !== 'yesno') {
          // A yes/no can be applied to many drawers at once and mean the same
          // thing on each. A range or a one-of cannot, and guessing a value
          // onto twelve drawers is not a bulk action, it is twelve mistakes.
          throw bad(`${attr.label} is not a yes or no, so it cannot be set on several drawers at once.`);
        }
        for (const sub of subs) {
          await placeAttributes.setDefault(sub, key, { yesno: true }, { settled: true });
        }
        did.push(`${attr.label} set on ${subs.length} ${subs.length === 1 ? 'drawer' : 'drawers'}`);
      } else if (kind === 'subcategory' || kind === 'category') {
        // A drawer is listed in a *cabinet*. Picking a drawer means the cabinet
        // that drawer is in, which is the only thing "Also in" can hold.
        const cabinet = kind === 'category' ? key : byKeySub.get(key)?.category_key;
        if (!cabinet) throw bad(`${key} is not in a category we know.`);
        const cat = d.categories.find((c) => c.key === cabinet);
        for (const sub of subs) {
          if (byKeySub.get(sub)?.category_key === cabinet) continue;
          await query(
            `insert into shelf_subcategory_categories (subcategory_key, category_key)
             values ($1, $2) on conflict do nothing`, [sub, cabinet]);
        }
        did.push(`${subs.length} also in ${cat?.label ?? cabinet}`);
      } else {
        throw bad('A pick is a label or a subcategory.');
      }
    }
    shelfTaxonomy.forget();
    placeAttributes.forget();
    res.json({ applied: picks.length, said: did.join(' · '), by: actorOf(req) });
  } catch (err) { next(err); }
});
