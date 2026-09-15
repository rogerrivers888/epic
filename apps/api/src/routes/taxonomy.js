/**
 * The taxonomy: Epic's categories and subcategories, every provider's own
 * words, and the rules that map the one onto the other.
 *
 * The owner, 12 Sep 2026: "I'd like to have a screen where I can manage
 * categories and subcategories… for each category or subcategory, add the
 * combination of labels that determine whether that particular activity lives
 * in that particular subcategory… view all of our providers, categories, and
 * subcategories… the mappings between our providers' categories… map [our
 * master categories and subcategories] to the providers' subcategories."
 *
 *   GET  /            the two levels, every namespace with its counts, every rule
 *   GET  /labels      one namespace's words, each with where it lands and why
 *   GET  /matrix      every subcategory × every provider: the words that land there
 *   GET  /rules       the rules that fill one subcategory
 *   PUT  /rules       a rule: these labels → this subcategory (and/or weights)
 *   POST /try         where a set of labels would land, before saving
 *   PUT  /labels      name a label in English, or switch it off
 *
 * The categories and subcategories themselves are still written through
 * /api/admin/shelves/categories and /subcategories — one writer per table.
 *
 * Nothing here calls a provider. The vocabulary is the providers' published
 * words plus a count of how often each has been seen; where a word lands is
 * worked out by running the code's own maps and the rules table
 * (domain/landing.js), never by asking anybody.
 */

import { Router } from 'express';
import { requires } from '../access.js';
import { query, withTransaction } from '../db.js';
import * as shelfRules from '../repositories/shelfRules.js';
import * as taxonomy from '../repositories/shelfTaxonomy.js';
import * as labelRepo from '../repositories/taxonomyLabels.js';
import * as placeAttributes from '../repositories/placeAttributes.js';
import * as placeParts from '../repositories/placeParts.js';
import * as notSure from '../repositories/notSure.js';
import { recommendForWord, research } from '../domain/research.js';
import { kindsByQid, nameKinds } from '../repositories/library.js';
import { kindLabels } from '../sources/wikimedia.js';
import { NAMESPACES, labelsOfRule, parseLabel, scopeFor } from '../domain/labels.js';
import { knownLabels, landingOf, landingOfSet, venueForGoogleTypes } from '../domain/landing.js';
import { suggestFor, sureDecisionFor, sureMappingFor, WHY_UNSURE } from '../domain/googleSuggest.js';
import { examplesOfType } from '../sources/google.js';
import { currentHousehold } from './household.js';
import * as visitsRepo from '../repositories/visits.js';
import { SHELF_FLOOR, shelvesForVenue } from '../domain/moods.js';

export const taxonomyRoutes = Router();

const actorOf = (req) => req.account?.email ?? 'the owner (passcode)';
const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'bad_request' });

/**
 * The research run's ceiling (the handoff, BO10).
 *
 * 250 places per run, raisable on the run that asks for it and never by itself.
 * The handoff's reasoning, kept because it is the whole argument: "A cap you
 * can raise beats a budget you discover afterwards." The maximum is what one
 * request may ask for at all, so a typo of 25000 stops at something survivable.
 */
/** What `/pairs` shows, so a count and the list it opens can never disagree. */
export const PAIRS_SHOWN = 60;
export const RUN_CEILING = 250;
export const RUN_CEILING_MAX = 1000;

/**
 * The code's vocabulary is in the table before anything reads it, and the
 * decisions Epic is sure of are made — once per process, only where nobody
 * has decided, and never for anything that would land in one of our
 * subcategories (owner, 13 Sep 2026: "you shouldn't be asking me to approve
 * those… but only if you're sure").
 */
let decided = false;
/** Called at boot as well (server.js), so the mappings exist before anybody opens the screen. */
export async function ensureTaxonomyReady() { return ready(); }
async function ready() {
  await labelRepo.ensureKnown(knownLabels());
  if (decided) return;
  decided = true;
  try {
    const open = await labelRepo.undecidedGoogle();
    const sure = open.map((r) => ({ key: r.key, decision: sureDecisionFor(r.key, r.note) })).filter((r) => r.decision);
    await labelRepo.decideMany(sure);
    // The mappings Epic is sure of become rules of its own, signed "Epic", so
    // the screen can show them as such and the owner can change any of them.
    const tax = await taxonomy.taxonomy();
    const subKeys = tax.subcategories.filter((s) => s.active).map((s) => s.key);
    const known = tax.categories.map((c) => c.key);
    for (const r of open) {
      if (sure.some((s) => s.key === r.key)) continue;
      const m = sureMappingFor(r.key, r.note, subKeys);
      if (!m) continue;
      const label = `google:${r.key}`;
      const { scope, subject } = scopeFor([label]);
      await shelfRules.teach({ scope, subject, labels: [label], subjectLabel: r.key.replace(/_/g, ' '), weights: {}, subcategory: m.subcategory, reason: `Mapped by Epic: ${m.why}.`, by: 'Epic', known });
      await labelRepo.pointAt('google', r.key, m.subcategory);
    }
  } catch { decided = false; }
}

/** English names for a list of labels, from whichever table holds each. */
async function namesFor(labels) {
  const parsed = [...new Set(labels)].map((l) => [l, parseLabel(l)]).filter(([, p]) => p);
  const qids = parsed.filter(([, p]) => p.namespace === 'wikidata').map(([, p]) => p.key);
  const others = parsed.filter(([, p]) => p.namespace !== 'wikidata');
  const out = new Map();
  if (qids.length) for (const [q, row] of await kindsByQid(qids)) out.set(`wikidata:${q}`, row.label ?? null);
  if (others.length) {
    const { rows } = await query(
      `select namespace, key, label from taxonomy_labels
        where (namespace, key) in (select * from unnest($1::text[], $2::text[]))`,
      [others.map(([, p]) => p.namespace), others.map(([, p]) => p.key)]);
    for (const r of rows) out.set(`${r.namespace}:${r.key}`, r.label ?? null);
  }
  // Our own words live in the subcategory and secondary-label vocabularies, so
  // without this a rule said in our words shows a slug where its name should be
  // (Codex, 14 Sep 2026).
  const ourKeys = parsed.filter(([, p]) => p.namespace === 'epic').map(([, p]) => p.key);
  if (ourKeys.length) {
    const { rows } = await query(
      `select key, label from shelf_subcategories where key = any($1::text[])
       union all
       select key, label from place_attributes where key = any($1::text[])`, [ourKeys]);
    for (const r of rows) out.set(`epic:${r.key}`, r.label ?? null);
  }
  return out;
}

/**
 * A rule as the screen draws it: the labels it is about, each with a name.
 *
 * A Wikidata type the harvest has not named yet is named here, from Wikidata,
 * keyless, before the answer goes out — the owner saw "Q18674739" on a rule
 * and called it what it was, a bug (12 Sep 2026). The rule's own
 * `subject_label` is the fallback if Wikidata is not answering.
 */
async function withLabels(rules) {
  const all = rules.flatMap((r) => labelsOfRule(r));
  const names = await namesFor(all);
  // Which of our labels each provider word means, so a screen can show a rule
  // in our words rather than in Google's — and say plainly where a word means
  // nothing of ours yet (the handoff: "Rules are written only in our labels").
  const pointsAt = new Map();
  const provider = [...new Set(all.filter((l) => !l.startsWith('epic:')))];
  if (provider.length) {
    const { rows } = await query(
      `select namespace, key, points_at from taxonomy_labels
        where namespace || ':' || key = any($1)`,
      [provider],
    ).catch(() => ({ rows: [] }));
    for (const r of rows) pointsAt.set(`${r.namespace}:${r.key}`, r.points_at);
  }
  const unnamed = [...new Set(all.filter((l) => l.startsWith('wikidata:') && !names.get(l)).map((l) => l.slice('wikidata:'.length)))];
  // Named in the background — Wikidata can take a minute to say no (Codex, 12
  // Sep 2026) — so this answer carries the rule's own label and the next one
  // carries Wikidata's.
  if (unnamed.length) nameLater(unnamed);
  return rules.map((r) => ({
    ...r,
    labelList: labelsOfRule(r).map((l) => ({
      label: l,
      name: names.get(l) ?? (r.scope === 'kind' ? r.subject_label ?? null : null),
      // `epic:` labels are already ours; a provider's word is ours only through
      // what it points at, and null means it means nothing of ours yet.
      pointsAt: l.startsWith('epic:') ? l.slice('epic:'.length) : pointsAt.get(l) ?? null,
    })),
  }));
}

/** The Q-numbers a naming call is already out for, so a busy screen asks Wikidata once. */
const naming = new Set();
function nameLater(qids) {
  const fresh = qids.filter((q) => !naming.has(q));
  if (!fresh.length) return;
  for (const q of fresh) naming.add(q);
  // Three hundred at a time, each batch written as soon as it lands, so a
  // batch Wikidata drops does not cost the ones before it (Codex, 12 Sep 2026).
  (async () => {
    for (let i = 0; i < fresh.length; i += 300) {
      const slice = fresh.slice(i, i + 300);
      try {
        const got = await kindLabels(slice);
        if (got?.size) await nameKinds(got);
      } catch { /* the next page load asks again for what is still unnamed */ }
      finally { for (const q of slice) naming.delete(q); }
    }
  })();
}

// ---------------------------------------------------------------------------

taxonomyRoutes.get('/', requires('view_library'), async (_req, res, next) => {
  try {
    await ready();
    const [tax, use, rules, counts] = await Promise.all([
      taxonomy.taxonomy(), taxonomy.subcategoryUse(), shelfRules.list(), labelRepo.counts(),
    ]);
    const decorated = await withLabels(rules);
    const taughtIn = (ns) => decorated.filter((r) => r.labelList.some((l) => l.label.startsWith(`${ns}:`))).length;
    res.json({
      categories: tax.categories.map((c) => ({ ...c, subcategories: tax.subcategories.filter((s) => s.category_key === c.key).map((s) => ({ ...s, rules: use.get(s.key) ?? 0 })) })),
      subcategories: tax.subcategories.map((s) => ({ ...s, rules: use.get(s.key) ?? 0 })),
      namespaces: NAMESPACES.map((n) => ({ ...n, ...(counts.get(n.key) ?? { total: 0, seen: 0 }), taught: taughtIn(n.key) })),
      rules: decorated,
      floor: SHELF_FLOOR,
    });
  } catch (err) { next(err); }
});

/**
 * GET /labels?namespace=google&q=&all=1&limit=&offset=
 *
 * Each word with where it lands today. Wikidata's eight thousand types are
 * shown only where an atlas place has carried one, unless `all` is asked for.
 */
taxonomyRoutes.get('/labels', requires('view_library'), async (req, res, next) => {
  try {
    await ready();
    const namespace = req.query.namespace ? String(req.query.namespace) : null;
    if (namespace && !NAMESPACES.some((n) => n.key === namespace)) throw bad(`${namespace} is not a source of labels`);
    const q = String(req.query.q || '').trim() || null;
    const all = req.query.all === '1' || req.query.all === 'true';
    const [rows, rules, tax, attrs, carried] = await Promise.all([
      labelRepo.list({
        namespace, q, seenOnly: !all && (namespace === 'wikidata' || !namespace),
        limit: Math.min(2000, Number(req.query.limit) || 400), offset: Number(req.query.offset) || 0,
      }),
      shelfRules.rules(), taxonomy.taxonomy(),
      placeAttributes.attributes(), placeAttributes.carriedByWord(),
    ]);
    /**
     * How many specific words each word is seen beside — "Catches N words".
     *
     * One query rather than one per word (the audit), but only over the rows
     * being returned and only for the list that draws it: this endpoint also
     * backs the typeahead, and a whole-table aggregation on every keystroke is
     * a real cost. Capped at what `/pairs` will actually return, or a row would
     * say "catches 100" and open on sixty (Codex, 15 Sep 2026).
     */
    const catchable = namespace === 'google'
      ? rows.filter((r) => r.decision === 'generic').map((r) => `${r.namespace}:${r.key}`)
      : [];
    const catches = catchable.length
      ? await query(
        `select label, least(count(*), $2)::int as n from taxonomy_label_pairs
          where label = any($1) group by label`,
        [catchable, PAIRS_SHOWN],
      ).then((r) => new Map(r.rows.map((x) => [x.label, x.n]))).catch(() => new Map())
      : new Map();
    const subKeys = tax.subcategories.filter((s) => s.active).map((s) => s.key);
    const labels = rows.map((r) => ({
      ...r,
      // A Wikidata type the harvest refuses (`place_kinds.admit` false) never
      // becomes an atlas place, so it lands nowhere rather than "in Culture".
      landing: r.namespace === 'wikidata' && r.active === false
        ? { category: null, subcategory: null, how: 'none', via: null, derived: [] }
        : landingOf({ namespace: r.namespace, key: r.key, kindCategory: r.namespace === 'wikidata' ? r.note : null }, rules, tax.vocab),
      // Where a Google type could go, for the owner to approve or change
      // (domain/googleSuggest.js). A suggestion, never a decision.
      suggestion: r.namespace === 'google' ? suggestFor(r.key, r.note, subKeys) : null,
      // Why it is a judgement call, where it is one (the handoff, BO5).
      why: r.namespace === 'google' ? WHY_UNSURE[r.key] ?? null : null,
      /** The specific words seen beside this one — what it catches. */
      catches: catches.get(`${r.namespace}:${r.key}`) ?? 0,
      // What else the word says, besides where it sends a place. The owner,
      // 14 Sep 2026: "I see a fine dining restaurant, but no label for fine
      // dining." A word's second label is named here, beside its first.
      carries: (carried.get(`${r.namespace}:${r.key}`) ?? []).map((c) => ({
        key: c.key,
        label: attrs.byKey.get(c.key)?.label ?? c.key,
        kind: attrs.byKey.get(c.key)?.kind ?? 'yesno',
        value: c.value,
      })),
    }));
    res.json({
      namespace, q, all, labels, offset: Number(req.query.offset) || 0,
      more: rows.length >= (Math.min(2000, Number(req.query.limit) || 400)),
      subcategories: tax.subcategories, categories: tax.categories,
      // The secondary labels a word can be given, so the control has its list.
      secondary: attrs.list.filter((a) => a.active).map((a) => ({
        key: a.key, label: a.label, kind: a.kind, options: a.options ?? [],
        range_min: a.range_min, range_max: a.range_max, unit: a.unit,
      })),
    });
  } catch (err) { next(err); }
});

/**
 * GET /not-sure — the places the labels could not settle, and the last runs.
 * POST /not-sure/run { refs } — look them up. PUT /not-sure { ref, as } — his
 * decision, which is the only thing that files anything.
 *
 * The owner, 14 Sep 2026: "we'll be able to bulk say, 'Anthropic, go look and
 * find this, and get the answers'", and "no ceiling on the automated Claude
 * runs. I just want to concentrate on two specific areas: the area around
 * Sunningdale and the area around Bristol." The geography is the bound.
 *
 * The handoff settles what that means in practice: **250 places per run, a hard
 * ceiling you raise per run and which never raises itself**, with a receipt of
 * what it read and what it cost. "A cap you can raise beats a budget you
 * discover afterwards." No ceiling on the *runs*; a ceiling on each one.
 */
taxonomyRoutes.get('/not-sure', requires('view_library'), async (req, res, next) => {
  try {
    const [rows, counts, runs] = await Promise.all([
      notSure.list({ state: req.query.state ? String(req.query.state) : null }),
      notSure.counts(),
      notSure.runs(5),
    ]);
    const tax = await taxonomy.taxonomy();
    // "Our labels on it" (the handoff, BO10): each word said in ours, which is
    // how you see at a glance why nothing settled the place. Resolved here,
    // because the mapping lives here and a bare `water_park` means nothing on
    // a screen (the audit, 15 Sep 2026).
    const words = [...new Set(rows.flatMap((r) => r.words ?? []))];
    const means = new Map();
    if (words.length) {
      const [{ rows: found }, attrs, carried] = await Promise.all([
        query(`select key, points_at from taxonomy_labels where namespace = 'google' and key = any($1)`, [words]),
        placeAttributes.attributes(),
        placeAttributes.carriedByWord(),
      ]);
      // A word can point at a *secondary* label as well as a primary one, and
      // it can carry one besides — a cuisine, an age. Reading only points_at
      // against the subcategories told him none of a place's words meant
      // anything of ours when several did (Codex, 15 Sep 2026).
      const nameOf = (k) => tax.subByKey.get(k)?.label ?? attrs.byKey.get(k)?.label ?? k.replace(/-/g, ' ');
      for (const f of found) if (f.points_at) means.set(f.key, nameOf(f.points_at));
      for (const w of words) {
        // With the value it carries, or "Cuisine" alone says nothing about the
        // place: italian_restaurant means Cuisine · Italian (Codex, 15 Sep 2026).
        const reads = (v) => (v?.choice ? ` · ${v.choice}`
          : v?.from != null && v?.to != null ? ` ${v.from} to ${v.to}`
            : v?.from != null ? ` ${v.from} and up`
              : v?.to != null ? ` up to ${v.to}`
                : v?.yesno === false ? ' — no' : '');
        const also = (carried.get(`google:${w}`) ?? [])
          .map((c) => `${attrs.byKey.get(c.key)?.label ?? c.key}${reads(c.value)}`)
          .filter(Boolean);
        if (!also.length) continue;
        means.set(w, [means.get(w), ...also].filter(Boolean).join(' · '));
      }
    }
    res.json({
      places: rows.map((r) => ({ ...r, our_words: (r.words ?? []).map((w) => means.get(w) ?? null).filter(Boolean) })),
      counts, runs, subcategories: tax.subcategories, categories: tax.categories,
    });
  } catch (err) { next(err); }
});

/**
 * POST /word { label, places } — what one of a provider's words means, read off
 * the real places that carry it.
 *
 * The owner, 15 Sep 2026: "I want to have the option to ask the AI to look at
 * them and to actually check the website addresses and come up with a
 * recommendation." The sample comes from the screen, so this spends no provider
 * call of its own — only Claude, reading the websites already fetched.
 *
 * It recommends and never applies. A word files hundreds of places, so a
 * confident wrong answer here is the most expensive mistake on the screen.
 */
taxonomyRoutes.post('/word', requires('manage_library'), async (req, res, next) => {
  try {
    const label = String(req.body?.label || '').trim();
    const parsed = parseLabel(label);
    if (!parsed) throw bad('Which word?');
    const places = Array.isArray(req.body?.places) ? req.body.places.slice(0, 12) : [];
    if (!places.length) throw bad('Look at some real ones first — there is nothing to read.');
    const [tax, attrs, household] = await Promise.all([
      taxonomy.taxonomy(), placeAttributes.attributes(), currentHousehold(),
    ]);
    const said = await recommendForWord({
      word: parsed.key,
      places,
      primary: tax.active.subcategories.map((sc) => ({ key: sc.key, label: sc.label })),
      // Not the ranges. A range belongs to a drawer or to one place — "suits
      // ages 0 to 7" is not something a provider's word can assert about every
      // place that carries it — and offering one invited a yes/no answer in a
      // row meant for two numbers (Codex, 15 Sep 2026).
      secondary: attrs.list
        .filter((a) => a.active && a.kind !== 'range')
        .map((a) => ({ key: a.key, label: a.label, options: a.options ?? [] })),
      householdId: household?.id ?? null,
      sessionId: null,
    });
    res.json({ label, said });
  } catch (err) { next(err); }
});

/**
 * POST /not-sure/queue { subcategory, places } — put places already on screen
 * on the not-sure list.
 *
 * BO8 has twelve real places in front of it and knows which four the labels did
 * not settle. Sending those four used to re-run the examples search, which is a
 * second live provider call to learn what the screen already knew (the audit,
 * 15 Sep 2026). Nothing about a place is stored beyond what the list holds:
 * the reference, the name, the address and the words, which is the not-sure
 * list's own shape.
 */
taxonomyRoutes.post('/not-sure/queue', requires('manage_library'), async (req, res, next) => {
  try {
    const wouldBe = req.body?.subcategory ? String(req.body.subcategory) : null;
    const places = Array.isArray(req.body?.places) ? req.body.places.slice(0, 200) : [];
    if (!places.length) throw bad('Which places?');
    let queued = 0;
    for (const p of places) {
      const ref = String(p?.ref || '').trim();
      if (!ref) continue;
      await notSure.notSettled({
        ref,
        name: p.name ? String(p.name) : null,
        address: p.address ? String(p.address) : null,
        words: Array.isArray(p.words) ? p.words.map(String) : [],
        wouldBe,
        reason: p.reason ? String(p.reason).slice(0, 300)
          : 'Nothing it carries settles it, and it turned up in this drawer\u2019s own sample.',
      });
      queued += 1;
    }
    res.json({ queued });
  } catch (err) { next(err); }
});

taxonomyRoutes.post('/not-sure/run', requires('manage_library'), async (req, res, next) => {
  try {
    // The ceiling is named on every run and defaults to 250. It is never read
    // from anywhere that could have raised itself between runs (the handoff,
    // BO10): a request that says nothing gets 250, not last time's number.
    const cap = Math.min(RUN_CEILING_MAX, Math.max(1, Number(req.body?.cap) || RUN_CEILING));
    const asked = Array.isArray(req.body?.refs) ? req.body.refs.map(String) : [];
    if (!asked.length) throw bad('Which places?');
    const refs = asked.slice(0, cap);
    const [tax, household] = await Promise.all([taxonomy.taxonomy(), currentHousehold()]);
    const allowed = tax.active.subcategories.map((sc) => ({ key: sc.key, label: sc.label }));
    // Only what is still waiting. A settled place dragged back through a run
    // would undo his decision (Codex, 14 Sep 2026).
    const waiting = (await notSure.list({ state: 'waiting', limit: RUN_CEILING_MAX })).filter((p) => refs.includes(p.venue_ref));
    const run = await notSure.startRun({ askedFor: waiting.length, by: actorOf(req) });
    // The answer goes back now and the reading happens after it. Six places
    // take minutes of web search and the gateway gives a request twenty-eight
    // seconds, so waiting for the run meant the run always failed (14 Sep 2026,
    // the same ceiling the area sweep hit). The screen watches the run and the
    // places fill in as they are answered.
    // Said out loud when it stopped short, because a run that quietly did 250
    // of 400 and reported success is the thing a ceiling is meant to prevent.
    res.json({
      run, started: waiting.length, cap,
      stoppedAt: asked.length > refs.length ? { asked: asked.length, doing: refs.length } : null,
    });

    void (async () => {
    let looked = 0; let got = 0; let pence = 0;
    for (const p of waiting) {
      const meta = {};
      try {
        const said = await research({
          // The address goes with it: without it a run cannot tell the Bristol
          // one from the Sunningdale one (Codex, 14 Sep 2026).
          place: { ref: p.venue_ref, name: p.name, address: p.address, words: p.words },
          allowed, householdId: household?.id ?? null, sessionId: null, meta,
        });
        looked += 1;
        pence += Math.round((meta.costUsd ?? 0) * 79);
        if (said) {
          got += 1;
          // A parent comes back as a name, which is not a venue reference. It is
          // kept as a name and only becomes a proposal where the name matches a
          // place we already know (Codex, 14 Sep 2026).
          // Only where the name matches exactly one place we know. Two
          // attractions of the same name in different towns would otherwise make
          // this pick one at random (Codex, 14 Sep 2026).
          let parentRef = null;
          if (said.partOf) {
            const { rows: found } = await query(
              `select venue_ref from place_records where lower(name) = lower($1) limit 2`, [said.partOf]);
            parentRef = found.length === 1 ? found[0].venue_ref : null;
          }
          await notSure.answered(p.venue_ref, {
            said: said.is, because: said.because, source: said.source, partOfName: said.partOf ?? null,
          });
          // A part-of is a proposal, never applied: the owner confirms it.
          if (parentRef && parentRef !== p.venue_ref) {
            await placeParts.setPart(p.venue_ref, parentRef, { how: 'proposed', note: said.because, by: 'Claude' });
          }
        }
      } catch (err) {
        // One place failing is not the run failing, but a spent budget is: going
        // on would be hundreds of calls that cannot succeed. Matched on the code
        // rather than the class name, which was never set (Codex, 14 Sep 2026).
        if (err?.code === 'model_budget_reached' || err?.code === 'spend_bound_reached') break;
      }
    }
      await notSure.finishRun(run.id, { lookedAt: looked, answered: got, costPence: pence, note: null })
        .catch(() => { /* the run is a receipt; losing it does not lose the answers */ });
    })();
  } catch (err) { next(err); }
});

taxonomyRoutes.put('/not-sure', requires('manage_library'), async (req, res, next) => {
  try {
    const ref = String(req.body?.ref || '').trim();
    if (!ref) throw bad('Which place?');
    const as = req.body?.as ? String(req.body.as) : null;
    const tax = await taxonomy.taxonomy();
    if (as && !tax.subByKey.has(as)) throw bad(`${as} is not one of our labels.`);
    // Both or neither: a row that says it is settled while no rule was written
    // has left the list without being filed anywhere (Codex, 14 Sep 2026).
    const row = await withTransaction(async (c) => {
      const { rows } = await c.query(
        `update not_sure set state = $2, settled_as = $3, settled_by = $4, updated_at = now()
          where venue_ref = $1 returning *`,
        [ref, as ? 'settled' : 'dropped', as ?? null, actorOf(req)]);
      const found = rows[0] ?? null;
      if (as) {
        await c.query(
          `insert into shelf_rules (scope, subject, subject_label, weights, subcategory, reason, taught_by, seeded)
           values ('place', $1, $2, '{}'::jsonb, $3, $4, $5, false)
           on conflict (scope, subject) do update
              set subcategory = excluded.subcategory, reason = excluded.reason,
                  taught_by = excluded.taught_by, updated_at = now()`,
          [ref, found?.name ?? ref, as,
           found?.because ? `Settled from the not-sure list: ${found.because}` : 'Settled from the not-sure list.',
           actorOf(req)]);
      }
      return found;
    });
    shelfRules.forget();
    res.json({ place: row });
  } catch (err) { next(err); }
});

/**
 * GET /parts?parent=ref — what is inside a place, and what is waiting to be
 * settled. POST /parts { child, parent, note } says so; a null parent forgets
 * it.
 *
 * The owner, 14 Sep 2026: "if you know something is part of Thorpe Park, it all
 * lives in Thorpe Park, and we should only ever display Thorpe Park, not Amity
 * Beach." No rule can do this — a bit of a theme park and a standalone water
 * park carry the same words — so it is a fact recorded about two places.
 */
taxonomyRoutes.get('/parts', requires('view_library'), async (req, res, next) => {
  try {
    const parent = req.query.parent ? String(req.query.parent) : null;
    if (parent) { res.json({ parent, children: await placeParts.childrenOf(parent) }); return; }
    // The settled ones too, so the screen says what it has done rather than
    // disappearing the moment the queue is empty (the handoff, BO11).
    const [proposed, told] = await Promise.all([
      placeParts.proposed(Number(req.query.limit) || 100),
      placeParts.told(Number(req.query.limit) || 100),
    ]);
    res.json({ proposed, told });
  } catch (err) { next(err); }
});

taxonomyRoutes.post('/parts', requires('manage_library'), async (req, res, next) => {
  try {
    const child = String(req.body?.child || '').trim();
    if (!child) throw bad('Which place is inside the other?');
    const part = await placeParts.setPart(child, req.body?.parent ?? null,
      { how: 'told', note: req.body?.note ?? null, by: actorOf(req) });
    await query(
      `insert into admin_audit (actor_id, actor_label, action, subject_type, subject_id, subject_label, after)
       values ($1,$2,'taxonomy.part','place',null,$3,$4)`,
      [req.account?.id ?? null, actorOf(req), child, JSON.stringify(part ?? { child, parent: null })]);
    res.json({ part });
  } catch (err) { next(err); }
});

/**
 * GET /attributes — the vocabulary, with every drawer's defaults.
 *
 * The owner, 14 Sep 2026: "I feel like we need the ability to create these
 * attributes." An attribute says what a place is *like*, never what it is, so
 * it never competes with a subcategory: a climbing wall is in Climbing, and it
 * is indoors, and it suits ages eight upward, all at once.
 */
taxonomyRoutes.get('/attributes', requires('view_library'), async (req, res, next) => {
  try {
    const [vocab, tax, places] = await Promise.all([
      placeAttributes.attributes(), taxonomy.taxonomy(), placeAttributes.placeCounts(),
    ]);
    res.json({
      attributes: vocab.list,
      defaults: Object.fromEntries([...vocab.bySubcategory].map(([k, m]) => [k, Object.fromEntries(m)])),
      // A count of places, which is not the same unit as the coverage beside it
      // and must not be merged with it (the handoff, BO7a).
      places,
      subcategories: tax.subcategories, categories: tax.categories,
    });
  } catch (err) { next(err); }
});

/** PUT /attributes — name one, or change it. */
taxonomyRoutes.put('/attributes', requires('manage_library'), async (req, res, next) => {
  try {
    const attribute = await placeAttributes.saveAttribute({
      key: req.body?.key, label: req.body?.label, kind: req.body?.kind, blurb: req.body?.blurb,
      options: Array.isArray(req.body?.options) ? req.body.options.map(String) : undefined,
      rangeMin: req.body?.rangeMin, rangeMax: req.body?.rangeMax, unit: req.body?.unit,
      position: req.body?.position, active: req.body?.active,
    });
    await query(
      `insert into admin_audit (actor_id, actor_label, action, subject_type, subject_id, subject_label, after)
       values ($1,$2,'taxonomy.attribute','place_attribute',null,$3,$4)`,
      [req.account?.id ?? null, actorOf(req), attribute.label, JSON.stringify(attribute)]);
    res.json({ attribute });
  } catch (err) { next(err); }
});

/**
 * PUT /attributes/brings { attribute, brings, value } — what one of our labels
 * brings with it, and as what. A null value forgets it.
 */
taxonomyRoutes.put('/attributes/brings', requires('manage_library'), async (req, res, next) => {
  try {
    const value = await placeAttributes.setBrings(
      String(req.body?.attribute || ''), String(req.body?.brings || ''), req.body?.value ?? null);
    res.json({ attribute: req.body?.attribute, brings: req.body?.brings, value });
  } catch (err) { next(err); }
});

/**
 * PUT /labels/carries { label, attribute, value } — what a provider's word says
 * besides where it sends a place. A null value forgets it.
 *
 * The owner, 14 Sep 2026: "Is the type of restaurant like French restaurants or
 * fine dining, for example? I see a fine dining restaurant, but no label for
 * fine dining." Where the word points is one question and what else it says is
 * another; this is the second, and setting it never moves a place.
 */
taxonomyRoutes.put('/labels/carries', requires('manage_library'), async (req, res, next) => {
  try {
    const value = await placeAttributes.setCarries(
      String(req.body?.label || ''), String(req.body?.attribute || ''), req.body?.value ?? null);
    res.json({ label: req.body?.label, attribute: req.body?.attribute, value });
  } catch (err) { next(err); }
});

/**
 * PUT /attributes/default { subcategory, attribute, value } — what every place
 * in a drawer is taken to be. A null value clears it back to "nothing said",
 * which is not the same as "no".
 */
taxonomyRoutes.put('/attributes/default', requires('manage_library'), async (req, res, next) => {
  try {
    const value = await placeAttributes.setDefault(
      String(req.body?.subcategory || ''), String(req.body?.attribute || ''), req.body?.value ?? null);
    res.json({ subcategory: req.body?.subcategory, attribute: req.body?.attribute, value });
  } catch (err) { next(err); }
});

/**
 * GET /attributes/place?ref=&subcategory= — what one place is, attribute by
 * attribute, with `setAt` saying whether the answer came from the place itself
 * or was inherited from its drawer.
 */
taxonomyRoutes.get('/attributes/place', requires('view_library'), async (req, res, next) => {
  try {
    const ref = String(req.query.ref || '').trim();
    if (!ref) throw bad('Which place?');
    const subcategory = req.query.subcategory ? String(req.query.subcategory) : null;
    // Its own words, so what they carry shows up here too: a place typed
    // fine_dining_restaurant reads as fine dining without anybody saying so.
    const words = Array.isArray(req.query.words) ? req.query.words.map(String)
      : req.query.words ? String(req.query.words).split(',').filter(Boolean) : [];
    const [vocab, own] = await Promise.all([placeAttributes.attributes(), placeAttributes.valuesFor(ref)]);
    res.json({
      ref, subcategory, attributes: vocab.list,
      values: placeAttributes.resolveFor({ subcategory, words }, own, vocab),
      // The same question with nothing set on the place: what it *would* be, so
      // a screen can show the answer "Back to what it inherits" restores before
      // anybody presses it (Codex, 15 Sep 2026 — and it is what BO7a asks for:
      // "where you can see what was inherited").
      inherited: placeAttributes.resolveFor({ subcategory, words }, new Map(), vocab),
    });
  } catch (err) { next(err); }
});

/**
 * PUT /attributes/place { ref, attribute, value, reason } — what one place says
 * for itself, where it differs from its drawer. The reason is kept on purpose:
 * it is what a model is shown next time (owner, 14 Sep 2026).
 */
taxonomyRoutes.put('/attributes/place', requires('manage_library'), async (req, res, next) => {
  try {
    const ref = String(req.body?.ref || '').trim();
    if (!ref) throw bad('Which place?');
    const saved = await placeAttributes.setValue(ref, String(req.body?.attribute || ''), req.body?.value ?? null,
      { reason: req.body?.reason ?? null, by: actorOf(req) });
    res.json({ ref, attribute: req.body?.attribute, value: saved });
  } catch (err) { next(err); }
});

/**
 * GET /examples?label=google:event_venue — a handful of real places.
 *
 * The owner, 13 Sep 2026: "there are 195 event venues… I need to be able to
 * click through and see some examples because I have no idea what they are,
 * where they fall into, and what I should be doing with them."
 *
 * One Google Text Search, fenced to that type and to a box round the
 * household's home, answered with the names, the addresses and — the point of
 * it — every other word Google puts on the same place, each said to be mapped
 * or not. Nothing is stored. It costs one provider call, so it happens on a
 * press and never on a page load.
 */
taxonomyRoutes.get('/examples', requires('manage_library'), async (req, res, next) => {
  try {
    await ready();
    const label = String(req.query.label || '').trim();
    const parsed = parseLabel(label);
    if (!parsed) throw bad(`${label || '(nothing)'} is not a label`);
    if (parsed.namespace !== 'google') throw bad('Examples come from Google, so only a Google word can be looked at.');
    const household = await currentHousehold();
    const center = household?.home_lat != null && household?.home_lng != null
      ? { lat: Number(household.home_lat), lng: Number(household.home_lng) }
      // Nowhere set yet: central London, which has one of most things.
      : { lat: 51.5074, lng: -0.1278 };
    const meter = {};
    const out = await examplesOfType({ center, type: parsed.key, meter, limit: 12 });
    if (Object.keys(meter).length) {
      await visitsRepo.recordProviderCall(household?.id ?? null, 'google', 'admin.taxonomy.examples', meter).catch(() => null);
    }
    // Every word on those places, said with where it lands, so the answer to
    // "what is an event venue?" is the company it keeps.
    const [rules, tax, rows] = await Promise.all([shelfRules.rules(), taxonomy.taxonomy(), labelRepo.list({ namespace: 'google', limit: 2000 })]);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const seen = new Map();
    for (const p of out.places) {
      for (const t of p.types ?? []) {
        if (t === parsed.key) continue;
        seen.set(t, (seen.get(t) ?? 0) + 1);
      }
    }
    // How often this word is the only thing we know about a place.
    //
    // The owner, 14 Sep 2026: "we don't necessarily need to exclude Activity
    // Centre or throw it away… The Activity Centre then gives us that context,
    // which might be useful." The test is whether anything else on the place is
    // mapped: adventure sports centre came back with twelve places and not one
    // carried another word we had answered, so throwing it away leaves Epic
    // knowing nothing at all about Activate or Wild Wood Adventure. A word like
    // `establishment` is the opposite — a restaurant is nearly always there too.
    // The rest of the place's words are asked *as a set*, not one at a time: a
    // combination rule names several words and none of them answers alone, so
    // asking singly would call a place alone that Epic can in fact file (Codex,
    // 14 Sep 2026).

    // One question, asked one way — by the resolver itself.
    //
    // Rewriting it here got it wrong three times running: it missed the
    // combinations no single word answers for, it let Google's defaults read an
    // excluded night club back as a bar, it gave a single word precedence over
    // a longer rule, and it never saw the rules written in our own words at all.
    // So it is not rewritten. The words are turned into a place the way Google
    // turns them into a place, and shelvesForVenue answers (Codex, 14 Sep 2026,
    // four passes).
    //
    // A word that was explicitly decided — an excluded night club, a generic
    // tourist attraction — comes out of the set before any of that, or the
    // defaults put it back.
    const live = (types) => (types ?? []).filter((t) => !byKey.get(t)?.decision);
    const filedAs = (types, primaryType) => {
      const words = live(types);
      if (!words.length) return null;
      const venue = venueForGoogleTypes(words, words.includes(primaryType) ? primaryType : null);
      return shelvesForVenue(venue, rules, tax.vocab).subcategory ?? null;
    };
    for (const p of out.places) p.landsIn = filedAs(p.types, p.primaryType ?? null);
    // And which of *our* labels each place carries, from the whole vocabulary —
    // the screen was deriving this from `travels`, which is capped at twelve, so
    // a place reaching a label through a less common word was left out of the
    // count while the rule would have caught it (Codex, 15 Sep 2026).
    //
    // The queried word's own contribution is deliberately left out. Every place
    // here carries that word by construction, and the screen reads its mapping
    // live: answering or re-answering the word while its examples are open must
    // change the count, and a snapshot taken before the answer cannot (Codex,
    // twice). Anything derived from the *other* words is stable.
    for (const p of out.places) {
      p.ours = [...new Set((p.types ?? [])
        .filter((t) => t !== parsed.key)
        .map((t) => byKey.get(t)?.points_at)
        .filter(Boolean))];
    }
    // And whether we already know it sits inside somewhere bigger, which is why
    // a place like Amity Beach never settles on its own (the handoff, BO8).
    // `parts()` answers with { childToParent }, not a Map — reading `.size` off
    // the wrapper was always undefined, so this never ran at all (Codex,
    // 15 Sep 2026).
    const { childToParent: parents } = await placeParts.parts().catch(() => ({ childToParent: new Map() }));
    if (parents.size) {
      const names = await query(
        `select venue_ref, name from place_records where venue_ref = any($1)`, [[...parents.values()]],
      ).then((r) => new Map(r.rows.map((x) => [x.venue_ref, x.name]))).catch(() => new Map());
      for (const p of out.places) {
        const parent = parents.get(`google:${p.id}`);
        p.partOf = parent ? names.get(parent) ?? parent : null;
      }
    }
    // And how many the queried word is carrying on its own — the same question,
    // with that word taken away. If it *was* the primary, what is left has no
    // primary; promoting the next one would invent a reading.
    const alone = out.places.filter((p) => {
      const rest = (p.types ?? []).filter((t) => t !== parsed.key);
      if (!rest.length) return true;
      return !filedAs(rest, p.primaryType && p.primaryType !== parsed.key ? p.primaryType : null);
    }).length;

    const alsoCalled = [...seen.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 24)
      .map(([key, on]) => {
        const row = byKey.get(key);
        return {
          key, on, label: row?.label ?? null, decision: row?.decision ?? null,
          landing: landingOf({ namespace: 'google', key }, rules, tax.vocab),
        };
      });
    // The shape is the rule worth writing (the handoff, BO9). Group the places
    // found by the set of words they carry, ignoring the queried word itself and
    // the ones that sit on everything, and the biggest group is the combination
    // to name. Where every place is its own shape there is no rule to write, and
    // the screen says so rather than showing twelve rows of one.
    const EVERYWHERE = new Set(['establishment', 'point_of_interest']);
    const shapeOf = (p) => (p.types ?? [])
      .filter((t) => t !== parsed.key && !EVERYWHERE.has(t))
      .sort()
      .join(' + ');
    const byShape = new Map();
    for (const p of out.places) {
      const k = shapeOf(p);
      byShape.set(k, [...(byShape.get(k) ?? []), p.name]);
    }
    const shapes = [...byShape.entries()]
      .map(([k, names]) => ({ words: k ? k.split(' + ') : [], on: names.length, names: names.slice(0, 4) }))
      .sort((a, b) => b.on - a.on || a.words.length - b.words.length);
    // And how often each word travels with the one asked about, which is what
    // the bars are drawn from.
    const travels = [...seen.entries()]
      .filter(([k]) => !EVERYWHERE.has(k))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 12)
      .map(([key, on]) => ({ key, on, label: byKey.get(key)?.label ?? null, points_at: byKey.get(key)?.points_at ?? null }));

    // The ones the labels could not settle go on the not-sure list rather than
    // being quietly filed wrong (the handoff, BO8; Codex, 14 Sep 2026: nothing
    // was putting anything on it). Eight of twelve water parks were settled by
    // their words; the four that were not are exactly these.
    if (req.query.queue === '1') {
      for (const p of out.places) {
        // The resolver's answer, not a guess from one word. Where it lands
        // somewhere, it is settled and has no business on the list.
        if (p.landsIn) continue;
        const rest = (p.types ?? []).filter((t) => t !== parsed.key);
        await notSure.notSettled({
          ref: `google:${p.id}`,
          name: p.name,
          address: p.address,
          words: p.types ?? [],
          wouldBe: landingOf({ namespace: 'google', key: parsed.key }, rules, tax.vocab).subcategory,
          reason: rest.length
            ? `Carries ${parsed.key.replace(/_/g, ' ')} and nothing else we have mapped.`
            : `Carries nothing but ${parsed.key.replace(/_/g, ' ')}.`,
        });
      }
    }

    res.json({
      label, near: household?.home_label ?? 'London', places: out.places,
      shapes, travels,
      // The words on everything, said once rather than in every row.
      everywhere: [...seen.entries()].filter(([k]) => EVERYWHERE.has(k)).map(([key, on]) => ({ key, on })),
      // False where Google would not take the word as a filter: the search was
      // by words and the answers were then kept only if they really carry it.
      fenced: out.fenced !== false,
      // Of the places found, how many carry nothing else we have mapped.
      alone,
      alsoCalled, calls: out.calls, problem: out.problem,
      subcategories: tax.subcategories, categories: tax.categories,
    });
  } catch (err) { next(err); }
});

/**
 * GET /pairs?label=google:tourist_attraction — what a generic word catches.
 *
 * The owner, 13 Sep 2026: "instead surface all the subcategories and map those
 * accordingly." A generic word says nothing on its own, so the useful question
 * is which specific words of the same source turn up on the same places. Those
 * are counted as they are seen (repositories/taxonomyLabels.js) — nothing about
 * a place is stored — and come back in the same shape as a row on the screen,
 * so each one can be mapped from here.
 */
taxonomyRoutes.get('/pairs', requires('view_library'), async (req, res, next) => {
  try {
    await ready();
    const label = String(req.query.label || '').trim();
    const parsed = parseLabel(label);
    if (!parsed) throw bad(`${label || '(nothing)'} is not a label`);
    const [pairs, rules, tax] = await Promise.all([
      // Always the same number the count is capped at. A caller-set limit made
      // the two disagree in both directions — "catches 60" opening on thirty,
      // or on two hundred (Codex, 15 Sep 2026).
      labelRepo.pairsFor(label, PAIRS_SHOWN),
      shelfRules.rules(), taxonomy.taxonomy(),
    ]);
    const subKeys = tax.subcategories.filter((s) => s.active).map((s) => s.key);
    const words = pairs.map((p) => {
      const i = p.other.indexOf(':');
      const namespace = p.other.slice(0, i);
      const key = p.other.slice(i + 1);
      return {
        namespace, key, label: p.name ?? null, note: p.note ?? null,
        seen_count: p.seen_count, active: p.active !== false, decision: p.decision ?? null,
        landing: landingOf({ namespace, key }, rules, tax.vocab),
        suggestion: namespace === 'google' ? suggestFor(key, p.note, subKeys) : null,
      };
    });
    res.json({ label, words, subcategories: tax.subcategories, categories: tax.categories });
  } catch (err) { next(err); }
});

/**
 * GET /matrix — every subcategory against every provider.
 *
 * Rows are Epic's drawers; columns are the namespaces; a cell is the words
 * from that source which land in that drawer today, and how (taught, or the
 * code's own default). The `unfiled` row is the words that land in a category
 * with no drawer, and `nowhere` the ones that fall to the broadest shelf
 * because nothing knows them — both are work queues.
 */
taxonomyRoutes.get('/matrix', requires('view_library'), async (req, res, next) => {
  try {
    await ready();
    const all = req.query.all === '1';
    const [rows, rules, tax] = await Promise.all([
      // The whole vocabulary, Wikidata's eight thousand included when `all` is asked for.
      labelRepo.list({ seenOnly: false, limit: 20000 }), shelfRules.rules(), taxonomy.taxonomy(),
    ]);
    const cells = {};
    const unfiled = {};
    const nowhere = {};
    const put = (bucket, key, ns, entry) => {
      bucket[key] ??= {};
      (bucket[key][ns] ??= []).push(entry);
    };
    for (const r of rows) {
      if (r.namespace === 'wikidata' && !all && !(r.seen_count > 0)) continue;
      if (r.active === false) continue;
      const l = landingOf({ namespace: r.namespace, key: r.key, kindCategory: r.namespace === 'wikidata' ? r.note : null }, rules, tax.vocab);
      const entry = { key: r.key, label: r.label ?? null, seen: r.seen_count, how: l.how };
      if (l.how === 'none') continue;
      if (l.subcategory) put(cells, l.subcategory, r.namespace, entry);
      else if (l.how === 'fallback') put(nowhere, l.category ?? 'fun', r.namespace, entry);
      else put(unfiled, l.category ?? 'none', r.namespace, entry);
    }
    res.json({
      namespaces: NAMESPACES.map((n) => n.key),
      categories: tax.categories.map((c) => ({ ...c, subcategories: tax.subcategories.filter((s) => s.category_key === c.key) })),
      cells, unfiled, nowhere, all,
    });
  } catch (err) { next(err); }
});

/** GET /rules?subcategory=castles — what fills one drawer. */
taxonomyRoutes.get('/rules', requires('view_library'), async (req, res, next) => {
  try {
    const sub = String(req.query.subcategory || '').trim();
    if (!sub) throw bad('Say which subcategory.');
    const { rows } = await query('select * from shelf_rules where subcategory = $1 order by scope, coalesce(subject_label, subject)', [sub]);
    res.json({ subcategory: sub, rules: await withLabels(rows) });
  } catch (err) { next(err); }
});

/**
 * PUT /rules — these labels belong in this subcategory (and/or on these shelves).
 *
 * One label about a Wikidata type, an atlas word or an experience is written
 * to that scope, so it is the same rule the Shelves screen would have written;
 * anything else is a `labels` rule and fires only when a place carries every
 * label named (domain/labels.js `scopeFor`).
 */
taxonomyRoutes.put('/rules', requires('manage_library'), async (req, res, next) => {
  try {
    await ready();
    const labels = Array.isArray(req.body?.labels) ? req.body.labels.map(String) : [];
    if (!labels.length) throw bad('A rule needs at least one label.');
    const unknown = labels.filter((l) => !parseLabel(l));
    if (unknown.length) throw bad(`Not a label: ${unknown.join(', ')}`);
    const tax = await taxonomy.taxonomy();
    const subcategory = req.body?.subcategory ? String(req.body.subcategory) : null;
    if (subcategory && !tax.subByKey.has(subcategory)) throw bad(`${subcategory} is not a subcategory`);

    // `scopeFor` normalises: our own words come back bare, because that is what
    // a place's words are turned into before a rule sees them. Passing the
    // typed ones on would store a rule that never fires (Codex, 14 Sep 2026).
    const { scope, subject, labels: stored } = scopeFor(labels);
    const names = await namesFor(labels);
    const subjectLabel = req.body?.subjectLabel
      ?? labels.map((l) => names.get(l) ?? l.split(':').slice(1).join(':')).join(' + ');
    const rule = await shelfRules.teach({
      scope, subject, subjectLabel, labels: stored,
      weights: req.body?.weights ?? {}, subcategory,
      reason: req.body?.reason ?? null, by: actorOf(req),
      known: tax.categories.map((c) => c.key),
    });
    await query(
      `insert into admin_audit (actor_id, actor_label, action, subject_type, subject_id, subject_label, after)
       values ($1,$2,'taxonomy.rule','shelf_rule',$3,$4,$5)`,
      [req.account?.id ?? null, actorOf(req), rule.id, `${rule.scope}: ${rule.subject_label ?? rule.subject}`,
       JSON.stringify({ labels, subcategory, weights: rule.weights, reason: rule.reason })]);
    // One word named, one subcategory given: that is the word's meaning, so it
    // is recorded as such (14 Sep 2026).
    if (labels.length === 1 && subcategory) {
      const p = parseLabel(labels[0]);
      // Only a provider's word points at one of ours. One of ours *is* the
      // destination, and recording it as pointing at itself would put a second
      // copy of it in the vocabulary (Codex, 14 Sep 2026).
      if (p && p.namespace !== 'epic') await labelRepo.pointAt(p.namespace, p.key, subcategory);
    }
    res.json({ rule: (await withLabels([rule]))[0] });
  } catch (err) { next(err); }
});

/**
 * POST /rules/batch { items: [{ labels, subcategory, aside, nearby, travel, generic, reason }] }
 * — the owner approving a group's suggestions in one press. Each item is
 * either a rule (labels → subcategory) or one of the four decisions that are
 * not a rule; one that fails does not stop the rest, and the answer says which.
 */
taxonomyRoutes.post('/rules/batch', requires('manage_library'), async (req, res, next) => {
  try {
    await ready();
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 500) : [];
    if (!items.length) throw bad('Nothing to approve.');
    const tax = await taxonomy.taxonomy();
    const known = tax.categories.map((c) => c.key);
    const done = []; const failed = [];
    // What this batch is about to undo (migration 130). The labels' own rows as
    // they stand, every rule it deletes, and every rule it makes. Taken here
    // rather than in the browser, because the browser has no way of knowing
    // what a generic decision is about to delete (Codex, 15 Sep 2026).
    const undo = { labels: [], deleted: [], made: [] };
    const remember = async (labelList) => {
      for (const l of labelList) {
        const parsed = parseLabel(l);
        if (!parsed || parsed.namespace === 'epic') continue;
        if (undo.labels.some((x) => x.namespace === parsed.namespace && x.key === parsed.key)) continue;
        // A Wikidata type is not a row in `taxonomy_labels` — it is a
        // `place_kinds` row whose one switch is `admit`, and a decision sets it
        // (Codex, 15 Sep 2026). Read it from where it actually lives, or Undo
        // silently restores nothing for every Wikidata word.
        if (parsed.namespace === 'wikidata') {
          const { rows } = await query(
            'select qid as key, admit as active, points_at from place_kinds where qid = $1', [parsed.key]);
          undo.labels.push({
            namespace: 'wikidata', key: parsed.key, decision: null,
            active: rows[0]?.active ?? null, points_at: rows[0]?.points_at ?? null,
          });
          continue;
        }
        const { rows } = await query(
          'select namespace, key, decision, active, points_at from taxonomy_labels where namespace = $1 and key = $2',
          [parsed.namespace, parsed.key]);
        // `active` goes with the decision: deciding a word aside switches it
        // off, and putting the decision back without it leaves it hidden.
        undo.labels.push(rows[0] ?? { namespace: parsed.namespace, key: parsed.key, decision: null, active: true, points_at: null });
      }
    };
    for (const it of items) {
      const labels = Array.isArray(it?.labels) ? it.labels.map(String) : [];
      try {
        // Every label must parse: dropping a bad one would write a broader rule
        // than was asked for (Codex, 12 Sep 2026).
        if (!labels.length) throw new Error('no label');
        const badAt = labels.findIndex((l) => !parseLabel(l));
        if (badAt >= 0) throw new Error(`not a label: ${labels[badAt] || '(empty)'}`);
        // The sixth answer: back to nothing said. A word answered wrongly could
        // only be put back inside Undo's four seconds, and "six answers, one
        // column, one control" means all six (the audit, 15 Sep 2026).
        if (it.unanswered) {
          if (labels.length !== 1) throw new Error('decide one label at a time');
          const { namespace, key } = parseLabel(labels[0]);
          await remember(labels);
          const { rows: going } = await query(
            `select * from shelf_rules where scope = 'labels' and subject = $1`, [labels[0]]);
          undo.deleted.push(...going);
          await query(`delete from shelf_rules where scope = 'labels' and subject = $1`, [labels[0]]);
          shelfRules.forget();
          await labelRepo.save({ namespace, key, decision: 'none', active: true });
          await labelRepo.pointAt(namespace, key, null);
          done.push({ labels, unanswered: true });
          continue;
        }
        if (it.aside || it.nearby || it.travel || it.generic) {
          if (labels.length !== 1) throw new Error('decide one label at a time');
          const { namespace, key } = parseLabel(labels[0]);
          const decision = it.aside ? 'aside' : it.travel ? 'travel' : it.generic ? 'generic' : 'nearby';
          await remember(labels);
          // Kept whole, because putting a rule back means putting all of it
          // back: its labels, its reason and who taught it.
          const { rows: going } = await query(
            decision === 'generic'
              ? `select * from shelf_rules where scope = 'labels' and (subject = $1 or $1 = any(labels))`
              : `select * from shelf_rules where scope = 'labels' and subject = $1`,
            [labels[0]]);
          undo.deleted.push(...going);
          await labelRepo.save({ namespace, key, decision });
          // A decision replaces a mapping: a rule about this one word, if there
          // is one, goes, or the resolver would keep filing by it (Codex, 13 Sep 2026).
          // For 'generic' that is the whole point, and it goes further: a word
          // that carries nothing cannot carry anything in company either, so a
          // combination rule naming it — `google:museum + google:tourist_attraction`
          // — goes too, or it would keep deciding landings through the back
          // door (Codex, 13 Sep 2026, second pass).
          if (decision === 'generic') {
            await query(`delete from shelf_rules where scope = 'labels' and (subject = $1 or $1 = any(labels))`, [labels[0]]);
          } else {
            await query(`delete from shelf_rules where scope = 'labels' and subject = $1`, [labels[0]]);
          }
          shelfRules.forget();
          // The word no longer means one of our labels, so nothing written in
          // our words may keep firing for it (Codex, 14 Sep 2026).
          await labelRepo.pointAt(namespace, key, null);
          done.push({ labels, aside: decision === 'aside', nearby: decision === 'nearby', travel: decision === 'travel', generic: decision === 'generic' });
          continue;
        }
        const subcategory = it.subcategory ? String(it.subcategory) : null;
        if (!subcategory || !tax.subByKey.has(subcategory)) throw new Error(`${subcategory} is not a subcategory`);
        await remember(labels);
        const { scope, subject, labels: stored } = scopeFor(labels);
        // teach() upserts on (scope, subject). A rule that was already there is
        // *changed*, not made, and recording its id as made would have Undo
        // delete a rule that existed before the batch (Codex, 15 Sep 2026).
        const { rows: before } = await query(
          'select * from shelf_rules where scope = $1 and subject = $2', [scope, String(subject)]);
        const names = await namesFor(labels);
        const rule = await shelfRules.teach({
          scope, subject, labels: stored, subjectLabel: labels.map((l) => names.get(l) ?? l.split(':').slice(1).join(':')).join(' + '),
          weights: {}, subcategory, reason: it.reason ?? 'Approved from the suggested mapping.', by: actorOf(req), known,
        });
        // A label decided earlier and now mapped is back in the list, its decision cleared.
        for (const l of labels) { const p = parseLabel(l); await labelRepo.save({ namespace: p.namespace, key: p.key, decision: 'none' }); }
        // Mapping one word to a subcategory *is* the statement that the word
        // means that label of ours, so it is recorded as one (14 Sep 2026).
        if (labels.length === 1) { const p = parseLabel(labels[0]); if (p.namespace !== 'epic') await labelRepo.pointAt(p.namespace, p.key, subcategory); }
        await query(
          `insert into admin_audit (actor_id, actor_label, action, subject_type, subject_id, subject_label, after)
           values ($1,$2,'taxonomy.rule','shelf_rule',$3,$4,$5)`,
          [req.account?.id ?? null, actorOf(req), rule.id, `${rule.scope}: ${rule.subject_label ?? rule.subject}`,
           JSON.stringify({ labels, subcategory, reason: rule.reason, batch: true })]);
        if (before.length) undo.deleted.push(before[0]); else undo.made.push(rule.id);
        done.push({ labels, subcategory, ruleId: rule.id });
      } catch (err) { failed.push({ labels, error: String(err.message ?? err) }); }
    }
    // Only where something actually changed: a batch that failed wholesale has
    // nothing to take back and an Undo that does nothing is worse than none.
    let undoId = null;
    if (done.length) {
      const { rows } = await query(
        'insert into taxonomy_undo (by, snapshot) values ($1, $2) returning id',
        [actorOf(req), JSON.stringify(undo)]);
      undoId = rows[0].id;
    }
    res.json({ done, failed, undo: undoId });
  } catch (err) { next(err); }
});

/**
 * POST /rules/undo { id } — put back exactly what that batch changed.
 *
 * The labels' own rows, the rules it deleted and the rules it made, all three,
 * in one transaction. Restoring a rule means restoring all of it — its labels,
 * its reason, and who taught it — so the row goes back whole rather than being
 * re-taught, which would put Epic's name on something the owner wrote.
 *
 * It can only be done once. A second press would "restore" a state that has
 * since been changed again by somebody else.
 */
taxonomyRoutes.post('/rules/undo', requires('manage_library'), async (req, res, next) => {
  try {
    const id = String(req.body?.id || '').trim();
    if (!id) throw bad('Undo what?');
    const out = await withTransaction(async (client) => {
      const { rows } = await client.query(
        'update taxonomy_undo set undone_at = now() where id = $1 and undone_at is null returning snapshot', [id]);
      if (!rows.length) throw bad('That change has already been taken back.');
      const snap = rows[0].snapshot ?? {};
      // The rules this batch made, gone.
      for (const ruleId of snap.made ?? []) {
        await client.query('delete from shelf_rules where id = $1', [ruleId]);
      }
      // The rules it deleted, back whole.
      for (const r of snap.deleted ?? []) {
        // Overwritten, not skipped: a rule that was *changed* still has its id,
        // so "do nothing" would leave the change in place (Codex, 15 Sep 2026).
        await client.query(
          `insert into shelf_rules (id, scope, subject, subject_label, weights, reason, taught_by, seeded, subcategory, labels)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           on conflict (id) do update set
             scope = excluded.scope, subject = excluded.subject, subject_label = excluded.subject_label,
             weights = excluded.weights, reason = excluded.reason, taught_by = excluded.taught_by,
             seeded = excluded.seeded, subcategory = excluded.subcategory, labels = excluded.labels,
             updated_at = now()`,
          [r.id, r.scope, r.subject, r.subject_label, r.weights, r.reason, r.taught_by, r.seeded, r.subcategory, r.labels]);
      }
      // And each word's own answer as it stood.
      for (const l of snap.labels ?? []) {
        if (l.namespace === 'wikidata') {
          await client.query(
            'update place_kinds set admit = $2, points_at = $3, updated_at = now() where qid = $1',
            [l.key, l.active ?? true, l.points_at ?? null]);
          continue;
        }
        await client.query(
          `update taxonomy_labels set decision = $3, active = $4, points_at = $5, updated_at = now()
            where namespace = $1 and key = $2`,
          [l.namespace, l.key, l.decision ?? null, l.active ?? true, l.points_at ?? null]);
      }
      return { rules: (snap.made ?? []).length, back: (snap.deleted ?? []).length, words: (snap.labels ?? []).length };
    });
    shelfRules.forget();
    // The resolver reads points_at out of the taxonomy's own five-second cache,
    // so without this a word just put back keeps landing where the undone
    // change sent it (Codex, 15 Sep 2026).
    taxonomy.forget();
    res.json({ undone: true, ...out });
  } catch (err) { next(err); }
});

/**
 * POST /adopt { label, categoryKey, name } — Google's own word becomes a
 * subcategory of ours, under the category picked, and the word is mapped to
 * it: one transaction, so neither half can be left without the other. A
 * subcategory already spelled that way under the same category is reused;
 * under another category it is refused rather than moved (Codex, 13 Sep 2026).
 */
const slugOf = (text) => String(text || '').toLowerCase().trim().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
taxonomyRoutes.post('/adopt', requires('manage_library'), async (req, res, next) => {
  try {
    await ready();
    const label = String(req.body?.label || '');
    const parsed = parseLabel(label);
    if (!parsed) throw bad('Say which word.');
    const name = String(req.body?.name || parsed.key.replace(/_/g, ' ')).trim();
    const key = slugOf(name);
    if (!key) throw bad('The new subcategory needs a name.');
    const tax = await taxonomy.taxonomy();
    const categoryKey = String(req.body?.categoryKey || '');
    if (!tax.byKey.has(categoryKey)) throw bad(`${categoryKey} is not a category`);
    const { subject } = scopeFor([label]);
    const result = await withTransaction(async (c) => {
      // Read the key inside the transaction, not from the five-second cache,
      // so two adoptions at once or another process's write cannot slip past
      // the check (Codex, 13 Sep 2026).
      // One adoption of a given name at a time: a lock on the key itself, so a
      // second request for a name that does not exist yet waits and then finds
      // the row the first one made (Codex, 13 Sep 2026).
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [`adopt:${key}`]);
      const seen = await c.query('select * from shelf_subcategories where key = $1 for update', [key]);
      const existing = seen.rows[0] ?? null;
      if (existing && existing.category_key !== categoryKey) {
        throw bad(`There is already a subcategory called ${existing.label} under ${tax.byKey.get(existing.category_key)?.label ?? existing.category_key}. Pick it from the list, or rename that one first.`);
      }
      let sc = existing;
      if (!sc) {
        const ins = await c.query(
          `insert into shelf_subcategories (category_key, key, label, position, seeded) values ($1, $2, $3, 100, false) returning *`,
          [categoryKey, key, name]);
        sc = ins.rows[0];
      }
      // Which menus also list it, inside the same transaction: split across two
      // requests, a failure after the adopt left the drawer created without its
      // listings while the screen reported the whole thing as failed (Codex,
      // 15 Sep 2026). It is a listing, never a second home.
      const alsoIn = Array.isArray(req.body?.alsoIn)
        ? req.body.alsoIn.map(String).filter((k) => tax.byKey.has(k) && k !== categoryKey)
        : [];
      if (alsoIn.length) {
        await c.query('delete from shelf_subcategory_categories where subcategory_key = $1', [sc.key]);
        // With their ordinality, as the other path stores it: the taxonomy reads
        // these in `position` order and shelvesOf keeps that order, so leaving
        // them all at 0 reorders the lanes by category key (Codex, 15 Sep 2026).
        for (const [i, k] of alsoIn.entries()) {
          await c.query(
            `insert into shelf_subcategory_categories (subcategory_key, category_key, position) values ($1, $2, $3)
             on conflict do nothing`, [sc.key, k, i]);
        }
      }
      const rule = await c.query(
        `insert into shelf_rules (scope, subject, subject_label, weights, subcategory, reason, taught_by, seeded, labels)
         values ('labels', $1, $2, '{}', $3, $4, $5, false, $6)
         on conflict (scope, subject) do update
            set subcategory = excluded.subcategory, weights = excluded.weights, reason = excluded.reason, taught_by = excluded.taught_by, seeded = false, labels = excluded.labels, updated_at = now()
         returning *`,
        [subject, name, sc.key, `Adopted Google's own word, ${name}.`, actorOf(req), [label]]);
      // Adopting a word is the plainest statement of all that it means this
      // label of ours, so it is recorded inside the same transaction (Codex,
      // 14 Sep 2026).
      await c.query(
        `update taxonomy_labels set decision = null, active = true, points_at = $3, updated_at = now()
          where namespace = $1 and key = $2`,
        [parsed.namespace, parsed.key, sc.key]);
      // And a rule in our words, so every other provider's word for the same
      // thing reaches the new subcategory too.
      await c.query(
        `insert into shelf_rules (scope, subject, subject_label, weights, subcategory, reason, taught_by, seeded, labels)
         values ('ours', $1, $2, '{}'::jsonb, $1, $3, $4, false, array[$1])
         on conflict (scope, subject) do update set subcategory = excluded.subcategory, updated_at = now()`,
        [sc.key, sc.label, `Said in our words: every provider word pointing at ${sc.label} reaches this.`, actorOf(req)]);
      await c.query(
        `insert into admin_audit (actor_id, actor_label, action, subject_type, subject_id, subject_label, after)
         values ($1,$2,'taxonomy.adopt','shelf_subcategory',$3,$4,$5)`,
        [req.account?.id ?? null, actorOf(req), sc.id, `${categoryKey} · ${sc.label}`, JSON.stringify({ label, created: !existing, ruleId: rule.rows[0].id })]);
      return { subcategory: sc, rule: rule.rows[0], created: !existing };
    });
    shelfRules.forget(); taxonomy.forget();
    res.json(result);
  } catch (err) { next(err); }
});

/** POST /try { labels } — where this combination would land, right now, without saving. */
taxonomyRoutes.post('/try', requires('view_library'), async (req, res, next) => {
  try {
    await ready();
    const labels = Array.isArray(req.body?.labels) ? req.body.labels.map(String).filter(parseLabel) : [];
    if (!labels.length) throw bad('Pick at least one label.');
    const [rules, tax] = await Promise.all([shelfRules.rules(), taxonomy.taxonomy()]);
    // A Wikidata type carries its atlas word with it, as it does on a real row.
    const qids = labels.map(parseLabel).filter((p) => p.namespace === 'wikidata').map((p) => p.key);
    const kinds = qids.length ? await kindsByQid(qids) : new Map();
    const kindCategory = qids.map((q) => kinds.get(q)?.category).find(Boolean) ?? null;
    const filed = landingOfSet(labels, { kindCategory }, rules, tax.vocab);
    res.json({
      labels,
      category: filed.category, subcategory: filed.subcategory, weights: filed.weights,
      because: filed.because, confident: filed.confident,
    });
  } catch (err) { next(err); }
});

/** PUT /labels { namespace, key, label?, active? } — the English name, or off. */
taxonomyRoutes.put('/labels', requires('manage_library'), async (req, res, next) => {
  try {
    await ready();
    const namespace = String(req.body?.namespace || '');
    const key = String(req.body?.key || '');
    if (!parseLabel(`${namespace}:${key}`)) throw bad('Say which label.');
    const row = await labelRepo.save({ namespace, key, label: req.body?.label, note: req.body?.note, active: req.body?.active });
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json({ label: row });
  } catch (err) { next(err); }
});

export default taxonomyRoutes;
