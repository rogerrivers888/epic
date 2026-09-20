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
 *   GET    /candidates               the harvest's words, with their share
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
import { requires } from '../access.js';
import { query } from '../db.js';
import * as sets from '../repositories/questionSets.js';
import * as harvest from '../sources/vocabulary.js';
import { ENRICH_AFTER, REGIONS, SAMPLE, enrichmentOn, settle } from '../domain/questions.js';
import { currentHousehold } from './household.js';

export const questionRoutes = Router();

const actorOf = (req) => req.account?.email ?? 'the owner (passcode)';
const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'bad_request' });

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
      query("select count(*) from harvest_candidates where status = 'new'"),
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
      pending: Number(pending.rows[0]?.count ?? 0),
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
      subcategories: subs.rows.map((s) => s.key), status: 'new', limit: 400,
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
        limit: Math.min(1000, Number(req.query.limit ?? 500) || 500),
      }),
    });
  } catch (err) { next(err); }
});

questionRoutes.post('/candidates/:id/promote', requires('manage_questions'), async (req, res, next) => {
  try {
    const { gate = false, kind = 'yesno', label = null, attributeKey = null, refreshDays = null } = req.body ?? {};
    res.json(await sets.promote(Number(req.params.id), { gate, kind, label, attributeKey, refreshDays, actor: actorOf(req) }));
  } catch (err) { next(err); }
});

questionRoutes.post('/candidates/:id/ignore', requires('manage_questions'), async (req, res, next) => {
  try { res.json(await sets.ignoreCandidate(Number(req.params.id), { actor: actorOf(req) })); } catch (err) { next(err); }
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
    const byQuestion = new Map();
    for (const a of answers) byQuestion.set(a.question_id, [...(byQuestion.get(a.question_id) ?? []), a]);
    res.json({
      venueRef: ref,
      subcategory,
      set: set ?? null,
      questions: asked.map((q) => {
        const rows = byQuestion.get(q.id) ?? [];
        const answer = settle(rows);
        return {
          id: q.id, label: q.label, kind: q.kind, gate: q.gate, scope: q.scope,
          // No row at all is "not asked yet" — a different fact from silence.
          state: answer?.state ?? 'not_asked',
          value: answer?.value ?? null,
          unresolved: answer?.unresolved ?? false,
          sources: answer?.sources ?? [],
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
