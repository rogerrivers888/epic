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
import * as taxonomyAudit from '../repositories/taxonomyAudit.js';
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
 * Subcategories whose own places disagree with their defaults past the limit.
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

    if (req.body?.accept) {
      const value = await placeAttributes.settleDefault(key, attribute);
      return res.json({ attribute, value, settled: true });
    }

    if (req.body?.flip) {
      if (attr.kind !== 'yesno') throw bad(`${attr.label} is not a yes or no, so there is nothing to flip.`);
      const d = await filing.drawers();
      const now = d.defaultsBySub.get(key)?.get(attribute) ?? null;
      if (now?.yesno == null) throw bad(`${attr.label} has no answer here to flip.`);
      const value = await placeAttributes.setDefault(key, attribute, { yesno: !now.yesno }, { settled: true });
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
      const had = d.defaultsBySub.get(key)?.get(a.key);
      if (had) await placeAttributes.settleDefault(key, a.key);
      // A value only the places propose has never been written down; accepting
      // it is what writes it.
      else await placeAttributes.setDefault(key, a.key, a.value, { settled: true });
      accepted += 1;
    }
    res.json({ accepted, by: actorOf(req) });
  } catch (err) { next(err); }
});
