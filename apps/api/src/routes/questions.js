/**
 * Question sets, the words waiting to become one, and the harvest that raises
 * them.
 *
 * Brief: "Epic — Question sets and the vocabulary harvest", 20 September 2026.
 * The screens are being drawn and this is written to the brief rather than to
 * a screen nobody has seen yet, which is what §7 asks for: "Build to the
 * schema, not to a screen you have not seen."
 *
 *   GET    /                         the sets, the pending count, the globals
 *   GET    /sets/:key                one set: its subcategories, its questions, its candidates
 *   PUT    /sets                     name a set, or switch one off
 *   PUT    /sets/:key/subcategories  attach a subcategory to it
 *   DELETE /sets/subcategories/:key  detach one
 *   POST   /questions                ask something of a set
 *   PATCH  /questions/:id            gate it, re-order it, change when it goes stale
 *   DELETE /questions/:id            stop asking it
 *   GET    /candidates               the harvest's words, with their share and polarity
 *   GET    /candidates/pen            the holding pen: words nobody has called yet
 *   POST   /candidates/classify       sort the pen into features, conditions and opinions
 *   POST   /candidates/:id/kind       call one by hand
 *   POST   /candidates/:id/promote   make one a question (or a gate)
 *   POST   /candidates/:id/ignore    never again — and it means never
 *   POST   /candidates/:id/restore   the way back the design brief asks for
 *   GET    /answers/:ref             one place's answers, in three states
 *   GET    /harvest                  the runs, and what a Google pass would cost
 *   POST   /harvest/probe            one call, to prove what the docs say
 *   POST   /harvest/free             the free sweep — costs nothing, runs freely
 *   POST   /harvest/google           the paid pass — refuses without the cost confirmed
 *
 * Reading and changing are separate capabilities, per `034_back_office.sql`:
 * promoting a word changes what every place of that kind is asked afterwards,
 * and running the paid pass spends money. Neither is the same privilege as
 * looking at the queue.
 */

import { Router } from 'express';
import { requires, can } from '../access.js';
import { query } from '../db.js';
import * as sets from '../repositories/questionSets.js';
import * as harvest from '../sources/vocabulary.js';
import * as features from '../sources/featureHarvest.js';
import * as sweep from '../sources/researchSweep.js';
import * as reference from '../sources/referenceSet.js';
import { ENRICH_AFTER, KINDS, REGIONS, SAMPLE, enrichmentOn, settle } from '../domain/questions.js';
import * as placeAttributes from '../repositories/placeAttributes.js';
import { currentHousehold } from './household.js';

export const questionRoutes = Router();

const actorOf = (req) => req.account?.email ?? 'the owner (passcode)';
const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'bad_request' });

/**
 * A sightings floor is a whole number of places, or it is not set.
 *
 * Anything else — a fraction, `Infinity`, a word — is read as "no floor"
 * rather than refused, because a floor is a reading aid and not a decision;
 * the one thing it must never do is reach the integer cast as something the
 * database cannot hold (Codex, 25 Sep 2026).
 */
const INT4_MAX = 2147483647;
const wholeFloor = (raw) => {
  if (raw == null || raw === '') return null;
  const n = Math.floor(Number(raw));
  // Above int4 is "no floor" too: `?minSeen=9999999999` is finite and whole
  // and still cannot be held by the cast (Codex, 25 Sep 2026).
  return Number.isFinite(n) && n >= 1 && n <= INT4_MAX ? n : null;
};

/**
 * The Labels tab, as the design brief restructures it: question sets are the
 * work, the pending count sits on the tab, and the dictionary is behind a
 * control.
 */
questionRoutes.get('/', requires('view_questions'), async (_req, res, next) => {
  try {
    const [all, globals, pending, unattached] = await Promise.all([
      sets.sets(),
      sets.questionsFor(null),
      query(`select count(*) filter (where status = 'new') as promotable,
                    count(*) filter (where status = 'unresolved' and kind = 'unclear') as pen
               from harvest_candidates`),
      query(
        `select s.key, s.label, count(p.venue_ref) as places
           from shelf_subcategories s
           left join place_index p on p.subcategory = s.key
          where s.active and not exists (select 1 from question_set_subcategories ss where ss.subcategory_key = s.key)
          group by 1, 2 order by count(p.venue_ref) desc`,
      ),
    ]);
    res.json({
      sets: all,
      // Shown greyed on a set's screen, and not editable there.
      global: globals.filter((q) => q.scope === 'global'),
      // The count on the tab is what is waiting for a person. The pen is
      // waiting for a classifier and is nobody's queue.
      pending: Number(pending.rows[0]?.promotable ?? 0),
      holdingPen: Number(pending.rows[0]?.pen ?? 0),
      // "If it uses none, that is a state worth showing — those places are
      // being asked only the global questions."
      withoutASet: unattached.rows,
    });
  } catch (err) { next(err); }
});

questionRoutes.get('/sets/:key', requires('view_questions'), async (req, res, next) => {
  try {
    const { rows } = await query('select * from question_sets where key = $1', [req.params.key]);
    if (!rows[0]) return res.status(404).json({ error: 'not_found', message: 'No such question set.' });
    const subs = await query(
      `select ss.subcategory_key as key, s.label, count(p.venue_ref) as places
         from question_set_subcategories ss
         join shelf_subcategories s on s.key = ss.subcategory_key
         left join place_index p on p.subcategory = ss.subcategory_key
        where ss.set_key = $1 group by 1, 2 order by 2`,
      [req.params.key],
    );
    const questions = await sets.questionsFor(req.params.key);
    const words = await sets.candidates({
      subcategories: subs.rows.map((s) => s.key), status: 'new', limit: 400, withEvidence: can(req, 'manage_questions'),
    });
    return res.json({
      set: rows[0],
      subcategories: subs.rows,
      places: subs.rows.reduce((n, s) => n + Number(s.places), 0),
      asked: {
        everywhere: questions.filter((q) => q.scope === 'global'),
        here: questions.filter((q) => q.scope === 'set'),
      },
      candidates: words,
    });
  } catch (err) { next(err); }
});

questionRoutes.put('/sets', requires('manage_questions'), async (req, res, next) => {
  try { res.json(await sets.saveSet(req.body ?? {})); } catch (err) { next(err); }
});

questionRoutes.put('/sets/:key/subcategories', requires('manage_questions'), async (req, res, next) => {
  try {
    const subcategory = String(req.body?.subcategory ?? '').trim();
    if (!subcategory) throw bad('Name the subcategory to attach.');
    res.json(await sets.attach(req.params.key, subcategory));
  } catch (err) { next(err); }
});

questionRoutes.delete('/sets/subcategories/:key', requires('manage_questions'), async (req, res, next) => {
  try { await sets.detach(req.params.key); res.json({ ok: true }); } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// the questions
// ---------------------------------------------------------------------------

questionRoutes.post('/questions', requires('manage_questions'), async (req, res, next) => {
  try {
    const { attributeKey, setKey = null, scope = 'set', gate = false, refreshDays = null, position } = req.body ?? {};
    if (!attributeKey) throw bad('A question has to name one of our labels.');
    res.json(await sets.addQuestion({ attributeKey, setKey, scope, gate, refreshDays, position }));
  } catch (err) { next(err); }
});

questionRoutes.patch('/questions/:id', requires('manage_questions'), async (req, res, next) => {
  try {
    const row = await sets.updateQuestion(Number(req.params.id), req.body ?? {});
    if (!row) return res.status(404).json({ error: 'not_found', message: 'No such question.' });
    return res.json(row);
  } catch (err) { return next(err); }
});

questionRoutes.delete('/questions/:id', requires('manage_questions'), async (req, res, next) => {
  try { res.json(await sets.removeQuestion(Number(req.params.id))); } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// the candidates
// ---------------------------------------------------------------------------

/**
 * The harvest's words.
 *
 * Returned with the share and nothing else decided: the design brief sorts by
 * how unevenly a word is spread, marks the gates and the age signals so a
 * common-but-essential word is not buried, and that is the screen's job. The
 * API's job is to hand over the count honestly.
 */
questionRoutes.get('/candidates', requires('view_questions'), async (req, res, next) => {
  try {
    const status = req.query.status ? String(req.query.status) : 'new';
    res.json({
      candidates: await sets.candidates({
        subcategory: req.query.subcategory ? String(req.query.subcategory) : null,
        status: status === 'all' ? null : status,
        // Which run raised it. Without this a drawer's feature pass is
        // unreadable behind forty thousand words from the Google pass.
        source: req.query.source ? String(req.query.source) : null,
        kind: req.query.kind ? String(req.query.kind) : null,
        // Which end of the list, and the sightings floor. The default is the
        // design brief's rarest-first; `common` with `minSeen` is how a reader
        // gets at the words seen on the most places without paging through
        // the pile (see `candidates` in the repository for why that mattered).
        sort: req.query.sort === 'common' ? 'common' : 'rare',
        // A whole number or nothing: the repository binds it as an integer,
        // and `1.5` or `Infinity` reaching that cast was a 500 on a GET
        // (Codex, 25 Sep 2026).
        minSeen: wholeFloor(req.query.minSeen),
        limit: Math.min(1000, Number(req.query.limit ?? 500) || 500),
        withEvidence: can(req, 'manage_questions'),
      }),
    });
  } catch (err) { next(err); }
});

/**
 * The holding pen.
 *
 * Brief §5.2, and the design comments' third state on L28: words the
 * classifier could not call, "shown apart from the promotable ones, and
 * reconsidered when the next harvest raises their count. Not pending, not
 * ignored, not waiting on a human. Just unresolved."
 */
questionRoutes.get('/candidates/pen', requires('view_questions'), async (req, res, next) => {
  try {
    const subcategory = req.query.subcategory ? String(req.query.subcategory) : null;
    const [unclear, resolved] = await Promise.all([
      sets.candidates({ subcategory, status: 'unresolved', kind: 'unclear', limit: 500, withEvidence: can(req, 'manage_questions') }),
      sets.candidates({ subcategory, status: 'unresolved', limit: 500, withEvidence: can(req, 'manage_questions') }),
    ]);
    res.json({
      // What nobody has called yet, and what has been called something that is
      // not a question. The two are different states and the screen shows them
      // differently.
      waiting: unclear,
      notQuestions: resolved.filter((c) => c.kind !== 'unclear'),
    });
  } catch (err) { next(err); }
});

/**
 * Sort the pen.
 *
 * One model call per eighty words, on the vocabulary rather than the text, so
 * the verdict "wave machine is a feature" is bought once for every water park
 * there will ever be. A word it cannot call stays in the pen.
 */
questionRoutes.post('/candidates/classify', requires('manage_questions'), async (req, res, next) => {
  try {
    const household = await currentHousehold().catch(() => null);
    res.json(await harvest.classifyCandidates({
      subcategory: req.body?.subcategory ? String(req.body.subcategory) : null,
      limit: Math.min(2000, Number(req.body?.limit ?? 400) || 400),
      householdId: household?.id ?? null,
      sessionId: req.session?.id ?? null,
    }));
  } catch (err) { next(err); }
});

/** Call one by hand, where somebody knows better than the classifier did. */
questionRoutes.post('/candidates/:id/kind', requires('manage_questions'), async (req, res, next) => {
  try {
    const kind = String(req.body?.kind ?? '');
    if (!KINDS.includes(kind)) throw bad(`A word is one of ${KINDS.join(', ')}.`);
    const row = await sets.setKind(Number(req.params.id), { kind, by: actorOf(req) });
    if (!row) return res.status(404).json({ error: 'not_found', message: 'That word has already been decided.' });
    return res.json(row);
  } catch (err) { return next(err); }
});

questionRoutes.post('/candidates/:id/promote', requires('manage_questions'), async (req, res, next) => {
  try {
    const { gate = false, kind = 'yesno', label = null, attributeKey = null, refreshDays = null, setKey = null } = req.body ?? {};
    res.json(await sets.promote(Number(req.params.id), {
      gate, kind, label, attributeKey, refreshDays, actor: actorOf(req),
      // Onto another sheet than the drawer's own, by name (C18: a moat raised
      // under museums belongs to Historic).
      setKey: setKey ? String(setKey) : null,
    }));
  } catch (err) { next(err); }
});

/**
 * Decide a word as a filing (C24): it names another drawer, and a place that
 * has one is *also in* that drawer rather than answering a question about it.
 */
questionRoutes.post('/candidates/:id/file', requires('manage_questions'), async (req, res, next) => {
  try {
    const under = String(req.body?.under ?? '').trim();
    if (!under) throw bad('Name the drawer this word files a place under.');
    res.json(await sets.fileUnder(Number(req.params.id), { under, by: actorOf(req) }));
  } catch (err) { next(err); }
});

questionRoutes.post('/candidates/:id/ignore', requires('manage_questions'), async (req, res, next) => {
  try {
    res.json(await sets.ignoreCandidate(Number(req.params.id), {
      actor: actorOf(req), reason: req.body?.reason ? String(req.body.reason) : null,
    }));
  } catch (err) { next(err); }
});

/** A global question said another way: an alias, never a second question (C18). */
questionRoutes.post('/candidates/:id/alias', requires('manage_questions'), async (req, res, next) => {
  try {
    const attributeKey = String(req.body?.attributeKey ?? '').trim();
    if (!attributeKey) throw bad('Name the global question this word means.');
    res.json(await sets.aliasToGlobal(Number(req.params.id), { attributeKey, actor: actorOf(req) }));
  } catch (err) { next(err); }
});

/** A quoted word that is a fact about every place: a new global question (C20). */
questionRoutes.post('/candidates/:id/global', requires('manage_questions'), async (req, res, next) => {
  try {
    const { label = null, kind = 'yesno', refreshDays = null } = req.body ?? {};
    // A shape the labels hold, and a whole number of days as given — never
    // rounded into a different cadence (Codex, 26 Sep 2026).
    // One of a list needs its list, which this door does not take, so it is
    // yes/no or a range here (Codex, 26 Sep 2026).
    if (!['yesno', 'range'].includes(kind)) throw bad('A global fact made from a word is yes/no or a range.');
    const days = refreshDays == null ? null : Number(refreshDays);
    if (days != null && !(Number.isInteger(days) && days >= 1 && days <= 3650)) throw bad('A re-check cadence is a whole number of days, 1 to 3650.');
    res.json(await sets.globalFromCandidate(Number(req.params.id), { label, kind, refreshDays: days, actor: actorOf(req) }));
  } catch (err) { next(err); }
});

questionRoutes.post('/candidates/:id/restore', requires('manage_questions'), async (req, res, next) => {
  try {
    const row = await sets.unignore(Number(req.params.id));
    if (!row) return res.status(404).json({ error: 'not_found', message: 'That word is not on the ignored list.' });
    return res.json(row);
  } catch (err) { return next(err); }
});

// ---------------------------------------------------------------------------
// the answers
// ---------------------------------------------------------------------------

/**
 * What one place has to show for its set — the block Inspect draws.
 *
 * Three states, and the middle one is the most easily lost: a question with an
 * answer, a question asked where every owned source was silent, and a question
 * this place has never been asked because it postdates the last look. The
 * third is computed here rather than stored, because it is the absence of a
 * row and nothing else.
 */
questionRoutes.get('/answers/:ref', requires('view_questions'), async (req, res, next) => {
  try {
    const ref = decodeURIComponent(req.params.ref);
    const { rows: place } = await query('select subcategory from place_index where venue_ref = $1', [ref]);
    const subcategory = place[0]?.subcategory ?? null;
    const set = subcategory ? await sets.setForSubcategory(subcategory) : null;
    const asked = await sets.questionsFor(set?.key ?? null);
    const answers = await sets.answersFor(ref);
    // Tier one of the brief's three (§5.5): what the place inherits from its
    // drawer, free and instant, so "a water park nobody has ever looked at
    // still has indoors, booking, the age range and the eight. The page is
    // never empty."
    const defaults = subcategory ? (await placeAttributes.attributes()).bySubcategory.get(subcategory) : null;
    const byQuestion = new Map();
    for (const a of answers) byQuestion.set(a.question_id, [...(byQuestion.get(a.question_id) ?? []), a]);
    res.json({
      venueRef: ref,
      subcategory,
      set: set ? { ...set, readsReviews: !set.vocabulary_settled } : null,
      questions: asked.map((q) => {
        const rows = byQuestion.get(q.id) ?? [];
        const answer = settle(rows);
        const inherited = defaults?.get(q.attribute_key) ?? null;
        return {
          id: q.id, label: q.label, kind: q.kind, gate: q.gate, scope: q.scope,
          // No row at all is "not asked yet" — a different fact from silence.
          state: answer?.state ?? 'not_asked',
          value: answer?.value ?? null,
          unresolved: answer?.unresolved ?? false,
          sources: answer?.sources ?? [],
          // Drawn where the place itself has said nothing. It is what the
          // drawer says about places of this kind, not a claim about this one,
          // and it is labelled that way rather than dressed as an answer.
          inherited: answer ? null : inherited,
          ...(answer?.other ? { other: answer.other } : {}),
        };
      }),
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// the harvest
// ---------------------------------------------------------------------------

questionRoutes.get('/harvest', requires('view_questions'), async (req, res, next) => {
  try {
    const [runs, plan, kinds] = await Promise.all([
      sets.runs({ limit: 20 }),
      harvest.estimate({ regionsPer: Number(req.query.regions ?? REGIONS.length) || REGIONS.length }),
      harvest.harvestable({}),
    ]);
    res.json({
      runs,
      plan,
      sample: SAMPLE,
      regions: REGIONS.map((r) => ({ key: r.key, label: r.label })),
      subcategories: kinds.length,
      places: kinds.reduce((n, k) => n + Number(k.places), 0),
    });
  } catch (err) { next(err); }
});

/** One call, to prove `reviewSummary` comes back on Text Search and in the UK. */
questionRoutes.post('/harvest/probe', requires('manage_questions'), async (req, res, next) => {
  try {
    const household = await currentHousehold().catch(() => null);
    res.json(await harvest.probe({
      textQuery: req.body?.textQuery ? String(req.body.textQuery) : undefined,
      householdId: household?.id ?? null,
      sessionId: req.session?.id ?? null,
    }));
  } catch (err) { next(err); }
});

/** The free sweep. Nothing to confirm: it cannot bill. */
questionRoutes.post('/harvest/free', requires('manage_questions'), async (req, res, next) => {
  try {
    res.json(await harvest.freeSweep({
      subcategories: Array.isArray(req.body?.subcategories) ? req.body.subcategories : null,
      size: Number(req.body?.size ?? 0) || undefined,
      live: req.body?.live === true,
    }));
  } catch (err) { next(err); }
});

/** Where the candidates now in the queue came from. */
questionRoutes.get('/candidates/origins', requires('view_library'), async (_req, res, next) => {
  try {
    res.json({ origins: await sets.candidateOrigins() });
  } catch (err) { next(err); }
});

/**
 * Remove what the old sweep raised, leaving every decision alone.
 *
 * The sweep read every accessibility field it had *checked* as one the place
 * has, so some of what it raised is a negative recorded as a feature. Confirm
 * with the number it reports, the same gate the paid runs use.
 */
questionRoutes.post('/candidates/purge-sweep', requires('manage_questions'), async (req, res, next) => {
  try {
    res.json(await sets.purgeSweepCandidates({ confirm: req.body?.confirm ?? null }));
  } catch (err) {
    if (err?.code === 'confirm_required') {
      return res.status(409).json({ error: err.code, message: err.message, plan: err.plan ?? null });
    }
    return next(err);
  }
});

/**
 * The feature pass: one call per drawer, asking what recurs across it.
 *
 * Replaces the per-word extractor, which raised 46,000 words over two runs and
 * produced nought decisions. Same confirm-the-cost gate as the Google pass —
 * `confirm` must equal the number of calls the estimate reported, so the only
 * way to start it is to have read what it costs. A 409 carries the plan back.
 */
questionRoutes.post('/harvest/features', requires('manage_questions'), async (req, res, next) => {
  try {
    const household = await currentHousehold().catch(() => null);
    res.json(await features.run({
      subcategories: Array.isArray(req.body?.subcategories) ? req.body.subcategories : null,
      size: Number(req.body?.size ?? 0) || undefined,
      confirm: req.body?.confirm ?? null,
      householdId: household?.id ?? null,
      sessionId: req.session?.id ?? null,
    }));
  } catch (err) {
    // The 409 has to carry the estimate, or "confirm with that number" names a
    // number the caller cannot see. The global handler serialises `error` and
    // `message` only and drops `err.plan` (Codex, 21 Sep 2026).
    if (err?.code === 'confirm_required' || err?.code === 'over_session_bound') {
      return res.status(409).json({ error: err.code, message: err.message, plan: err.plan ?? null });
    }
    return next(err);
  }
});

/** What the feature pass would cost, without running it. */
/**
 * The research sweep — the owner's one paid exception (25 Sep 2026).
 *
 *   GET  /sweep/estimate   what it would cost, and the request count to confirm with
 *   POST /sweep            start it; refuses without that count
 *   GET  /sweep            the last few, with their funnels
 *   GET  /sweep/:id        one, with its funnel and per-drawer breakdown
 *
 * It runs off the request: the row is written, the worker is kicked, and the
 * answer comes back at once. A deploy in the middle is picked up at boot.
 */
const subsOf = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(',') : null);
questionRoutes.get('/sweep/estimate', requires('view_library'), async (req, res, next) => {
  try {
    res.json(await sweep.estimate({
      subcategories: subsOf(req.query.subcategories),
      floor: Number(req.query.floor ?? 0) || undefined,
    }));
  } catch (err) { next(err); }
});
questionRoutes.post('/sweep', requires('manage_questions'), async (req, res, next) => {
  try {
    const household = await currentHousehold().catch(() => null);
    const row = await sweep.start({
      subcategories: subsOf(req.body?.subcategories),
      floor: Number(req.body?.floor ?? 0) || undefined,
      confirm: req.body?.confirm ?? null,
      householdId: household?.id ?? null,
      startedBy: actorOf(req),
      startedSessionId: req.session?.id ?? null,
    });
    void sweep.work(row.id).catch((err) => console.warn(`sweep ${row.id}: ${err.message}`));
    res.status(202).json({ sweep: row });
  } catch (err) {
    if (err?.code === 'confirm_required' || err?.code === 'already_running' || err?.code === 'no_household') {
      return res.status(409).json({ error: err.code, message: err.message, plan: err.plan ?? null, sweep: err.sweep ?? null });
    }
    return next(err);
  }
});
/**
 * The deep reference set (owner, 25 Sep 2026).
 *
 *   GET  /reference/propose   the twenty a category and why each is there
 *   GET  /reference/estimate  what it would cost, and the number to confirm with
 *   POST /reference           start it — a research sweep in reference mode
 *   GET  /reference/:id/held  what every place in it now holds, and from where
 */
questionRoutes.get('/reference/propose', requires('view_library'), async (req, res, next) => {
  try { res.json({ categories: await reference.propose({ categories: subsOf(req.query.categories) }) }); } catch (err) { next(err); }
});
questionRoutes.get('/reference/estimate', requires('view_library'), async (req, res, next) => {
  try { res.json(await reference.estimate({ categories: subsOf(req.query.categories) })); } catch (err) { next(err); }
});
questionRoutes.post('/reference', requires('manage_questions'), async (req, res, next) => {
  try {
    const household = await currentHousehold().catch(() => null);
    const row = await reference.start({ categories: subsOf(req.body?.categories), confirm: req.body?.confirm ?? null, householdId: household?.id ?? null, startedBy: actorOf(req) });
    void sweep.work(row.id).catch((err) => console.warn(`reference set ${row.id}: ${err.message}`));
    res.status(202).json({ sweep: row });
  } catch (err) {
    if (['confirm_required', 'already_running', 'no_household', 'short_category', 'unknown_category', 'google_unavailable'].includes(err?.code)) {
      return res.status(409).json({ error: err.code, message: err.message, plan: err.plan ?? null });
    }
    return next(err);
  }
});
questionRoutes.get('/reference/:id/held', requires('view_library'), async (req, res, next) => {
  try { res.json({ places: await reference.held(String(req.params.id)) }); } catch (err) { next(err); }
});
/** The facts behind a set's disagreements — which field, which sources, which values. */
questionRoutes.get('/reference/:id/disagreements', requires('view_library'), async (req, res, next) => {
  try { res.json({ places: await reference.disagreements(String(req.params.id), { limit: Math.min(200, Number(req.query.limit ?? 20) || 20) }) }); } catch (err) { next(err); }
});

/** The audit of encyclopedia matches that are about a town, an area or a landform the place is not. */
/** How far the free body backfill has got, and how many places hold a body. Read-only. */
questionRoutes.get('/reference/body-progress', requires('view_library'), async (_req, res, next) => {
  try { res.json(await reference.bodyProgress()); } catch (err) { next(err); }
});
questionRoutes.get('/reference/wikipedia-audit', requires('view_library'), async (_req, res, next) => {
  try { res.json(await reference.wikipediaAudit()); } catch (err) { next(err); }
});
/** Forget what those wrong matches attached, and recompose each record. Owned data, corrected. */
questionRoutes.post('/reference/wikipedia-audit/forget', requires('manage_questions'), async (req, res, next) => {
  try {
    const own = await import('../sources/own.js');
    const audit = await reference.wikipediaAudit();
    // Named places only, when names are given: the owner decides the held-back
    // list one place at a time, and a place he has not decided yet is left
    // exactly as it is (26 Sep 2026). Only a flagged place is ever forgotten.
    const only = Array.isArray(req.body?.refs) ? new Set(req.body.refs.map(String)) : null;
    const chosen = audit.places.filter((p) => !only || only.has(p.venue_ref));
    let forgotten = 0;
    for (const p of chosen) { await own.forgetEncyclopedia(p.venue_ref); forgotten += 1; }
    const notFlagged = only ? [...only].filter((r) => !audit.places.some((p) => p.venue_ref === r)) : [];
    res.json({ checked: audit.checked, flagged: audit.flagged, forgotten, notFlagged });
  } catch (err) { next(err); }
});

questionRoutes.get('/sweep', requires('view_library'), async (_req, res, next) => {
  try {
    const rows = await sweep.recent();
    res.json({ sweeps: await Promise.all(rows.map(async (r) => ({ ...r, funnel: await sweep.funnelOf(r.id) }))) });
  } catch (err) { next(err); }
});
/** POST /sweep/:id/retry — ask again about the places a finished sweep failed on. Free where the record is seeded. */
questionRoutes.get('/sweep/:id/retry/estimate', requires('view_library'), async (req, res, next) => {
  try { res.json(await sweep.retryEstimate(String(req.params.id))); } catch (err) { next(err); }
});
questionRoutes.post('/sweep/:id/retry', requires('manage_questions'), async (req, res, next) => {
  try {
    const row = await sweep.retryFailed(String(req.params.id), { confirm: req.body?.confirm ?? null });
    if (!row) return res.status(404).json({ error: 'not_found', message: 'No sweep by that id.' });
    if (row.retried) void sweep.work(row.id).catch((err) => console.warn(`sweep ${row.id}: ${err.message}`));
    res.status(202).json({ sweep: row, retried: row.retried });
  } catch (err) {
    if (err?.code === 'already_running' || err?.code === 'confirm_required') return res.status(409).json({ error: err.code, message: err.message, plan: err.plan ?? null, sweep: err.sweep ?? null });
    return next(err);
  }
});
questionRoutes.get('/sweep/:id', requires('view_library'), async (req, res, next) => {
  try {
    const row = await sweep.one(String(req.params.id));
    if (!row) return res.status(404).json({ error: 'not_found', message: 'No sweep by that id.' });
    res.json({ sweep: row, funnel: await sweep.funnelOf(row.id), drawers: await sweep.byDrawer(row.id),
      places: req.query.places ? await sweep.places(row.id) : undefined });
  } catch (err) { next(err); }
});

questionRoutes.get('/harvest/features/estimate', requires('view_library'), async (req, res, next) => {
  try {
    res.json(await features.estimate({
      subcategories: req.query.subcategories ? String(req.query.subcategories).split(',') : null,
      size: Number(req.query.size ?? 0) || undefined,
    }));
  } catch (err) { next(err); }
});

/**
 * The Google pass, which will not run on a shrug.
 *
 * `confirm` has to equal the number of requests the estimate reports, so the
 * only way to start it is to have read what it costs. A 409 carries the plan
 * back, which is the screen's "here is the price, click again".
 */
questionRoutes.post('/harvest/google', requires('manage_questions'), async (req, res, next) => {
  try {
    const household = await currentHousehold().catch(() => null);
    res.json(await harvest.googleHarvest({
      subcategories: Array.isArray(req.body?.subcategories) ? req.body.subcategories : null,
      regionsPer: Number(req.body?.regions ?? REGIONS.length) || REGIONS.length,
      confirm: req.body?.confirm ?? null,
      householdId: household?.id ?? null,
      sessionId: req.session?.id ?? null,
    }));
  } catch (err) {
    if (err.code === 'confirm_required') {
      return res.status(409).json({ error: 'confirm_required', message: err.message, plan: err.plan });
    }
    return next(err);
  }
});

/**
 * The enrichment hook, which is built and switched off.
 *
 * Brief §5: answering a place's questions is demand-driven, and the queue is
 * read from the search log. Shown here so the hook is visible rather than
 * buried — and running it is not offered at all, because `EPIC_ENRICHMENT` is
 * unset and the brief says to leave it that way.
 */
questionRoutes.get('/enrichment', requires('view_questions'), async (req, res, next) => {
  try {
    res.json({
      on: enrichmentOn(),
      after: ENRICH_AFTER,
      queue: await harvest.enrichmentQueue({ limit: Math.min(200, Number(req.query.limit ?? 50) || 50) }),
    });
  } catch (err) { next(err); }
});

export default questionRoutes;
