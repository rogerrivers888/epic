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
import { query } from '../db.js';
import * as shelfRules from '../repositories/shelfRules.js';
import * as taxonomy from '../repositories/shelfTaxonomy.js';
import * as labelRepo from '../repositories/taxonomyLabels.js';
import { kindsByQid, nameKinds } from '../repositories/library.js';
import { kindLabels } from '../sources/wikimedia.js';
import { NAMESPACES, labelsOfRule, parseLabel, scopeFor } from '../domain/labels.js';
import { knownLabels, landingOf, landingOfSet } from '../domain/landing.js';
import { suggestFor, sureDecisionFor, sureMappingFor } from '../domain/googleSuggest.js';
import { SHELF_FLOOR } from '../domain/moods.js';

export const taxonomyRoutes = Router();

const actorOf = (req) => req.account?.email ?? 'the owner (passcode)';
const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'bad_request' });

/**
 * The code's vocabulary is in the table before anything reads it, and the
 * decisions Epic is sure of are made — once per process, only where nobody
 * has decided, and never for anything that would land in one of our
 * subcategories (owner, 13 Sep 2026: "you shouldn't be asking me to approve
 * those… but only if you're sure").
 */
let decided = false;
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
  const unnamed = [...new Set(all.filter((l) => l.startsWith('wikidata:') && !names.get(l)).map((l) => l.slice('wikidata:'.length)))];
  // Named in the background — Wikidata can take a minute to say no (Codex, 12
  // Sep 2026) — so this answer carries the rule's own label and the next one
  // carries Wikidata's.
  if (unnamed.length) nameLater(unnamed);
  return rules.map((r) => ({
    ...r,
    labelList: labelsOfRule(r).map((l) => ({ label: l, name: names.get(l) ?? (r.scope === 'kind' ? r.subject_label ?? null : null) })),
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
    const [rows, rules, tax] = await Promise.all([
      labelRepo.list({
        namespace, q, seenOnly: !all && (namespace === 'wikidata' || !namespace),
        limit: Math.min(2000, Number(req.query.limit) || 400), offset: Number(req.query.offset) || 0,
      }),
      shelfRules.rules(), taxonomy.taxonomy(),
    ]);
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
    }));
    res.json({ namespace, q, all, labels, offset: Number(req.query.offset) || 0, more: rows.length >= (Math.min(2000, Number(req.query.limit) || 400)), subcategories: tax.subcategories, categories: tax.categories });
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

    const { scope, subject } = scopeFor(labels);
    const names = await namesFor(labels);
    const subjectLabel = req.body?.subjectLabel
      ?? labels.map((l) => names.get(l) ?? l.split(':').slice(1).join(':')).join(' + ');
    const rule = await shelfRules.teach({
      scope, subject, subjectLabel, labels,
      weights: req.body?.weights ?? {}, subcategory,
      reason: req.body?.reason ?? null, by: actorOf(req),
      known: tax.categories.map((c) => c.key),
    });
    await query(
      `insert into admin_audit (actor_id, actor_label, action, subject_type, subject_id, subject_label, after)
       values ($1,$2,'taxonomy.rule','shelf_rule',$3,$4,$5)`,
      [req.account?.id ?? null, actorOf(req), rule.id, `${rule.scope}: ${rule.subject_label ?? rule.subject}`,
       JSON.stringify({ labels, subcategory, weights: rule.weights, reason: rule.reason })]);
    res.json({ rule: (await withLabels([rule]))[0] });
  } catch (err) { next(err); }
});

/**
 * POST /rules/batch { items: [{ labels, subcategory, aside, reason }] } — the
 * owner approving a group's suggestions in one press. Each item is either a
 * rule (labels → subcategory) or a label set aside; one that fails does not
 * stop the rest, and the answer says which.
 */
taxonomyRoutes.post('/rules/batch', requires('manage_library'), async (req, res, next) => {
  try {
    await ready();
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 500) : [];
    if (!items.length) throw bad('Nothing to approve.');
    const tax = await taxonomy.taxonomy();
    const known = tax.categories.map((c) => c.key);
    const done = []; const failed = [];
    for (const it of items) {
      const labels = Array.isArray(it?.labels) ? it.labels.map(String) : [];
      try {
        // Every label must parse: dropping a bad one would write a broader rule
        // than was asked for (Codex, 12 Sep 2026).
        if (!labels.length) throw new Error('no label');
        const badAt = labels.findIndex((l) => !parseLabel(l));
        if (badAt >= 0) throw new Error(`not a label: ${labels[badAt] || '(empty)'}`);
        if (it.aside || it.nearby) {
          if (labels.length !== 1) throw new Error('decide one label at a time');
          const { namespace, key } = parseLabel(labels[0]);
          await labelRepo.save({ namespace, key, decision: it.aside ? 'aside' : 'nearby' });
          done.push({ labels, aside: Boolean(it.aside), nearby: Boolean(it.nearby) });
          continue;
        }
        const subcategory = it.subcategory ? String(it.subcategory) : null;
        if (!subcategory || !tax.subByKey.has(subcategory)) throw new Error(`${subcategory} is not a subcategory`);
        const { scope, subject } = scopeFor(labels);
        const names = await namesFor(labels);
        const rule = await shelfRules.teach({
          scope, subject, labels, subjectLabel: labels.map((l) => names.get(l) ?? l.split(':').slice(1).join(':')).join(' + '),
          weights: {}, subcategory, reason: it.reason ?? 'Approved from the suggested mapping.', by: actorOf(req), known,
        });
        // A label decided earlier and now mapped is back in the list, its decision cleared.
        for (const l of labels) { const p = parseLabel(l); await labelRepo.save({ namespace: p.namespace, key: p.key, decision: 'none' }); }
        await query(
          `insert into admin_audit (actor_id, actor_label, action, subject_type, subject_id, subject_label, after)
           values ($1,$2,'taxonomy.rule','shelf_rule',$3,$4,$5)`,
          [req.account?.id ?? null, actorOf(req), rule.id, `${rule.scope}: ${rule.subject_label ?? rule.subject}`,
           JSON.stringify({ labels, subcategory, reason: rule.reason, batch: true })]);
        done.push({ labels, subcategory, ruleId: rule.id });
      } catch (err) { failed.push({ labels, error: String(err.message ?? err) }); }
    }
    res.json({ done, failed });
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
