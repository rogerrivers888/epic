/**
 * /api/admin/desk — the back office's filing desk (handover 28 Sep 2026):
 * Overview · Categories · Facts · Mapping · Collections · Fact automations ·
 * Changes. Reads need view_library; every write needs manage_library, keeps
 * who and why, and is logged in Changes. The only confirmation in the whole
 * desk is Exclude on a word (the screen asks; the API trusts the screen).
 *
 * The old /api/admin/filing endpoints stay until nothing reads them.
 */

import { Router } from 'express';
import { requires } from '../access.js';
import { query } from '../db.js';
import * as settingsRepo from '../desk/settings.js';
import * as changesRepo from '../desk/changes.js';
import * as mapping from '../desk/mapping.js';
import { refreshProposals } from '../desk/proposals.js';
import * as categories from '../desk/categories.js';
import * as facts from '../desk/facts.js';
import * as verification from '../desk/verification.js';
import * as accuracy from '../desk/accuracy.js';
import * as collections from '../desk/collections.js';
import { overview, spendThisMonth } from '../desk/overview.js';
import { resolveLocation, chipOf, filterSays, REACHES, MODES } from '../desk/location.js';
import * as pipeline from '../desk/pipeline.js';
import { extracts as osmExtracts } from '../sources/osmExtract.js';

export const deskRoutes = Router();

const who = (req) => req.account?.email ?? 'the owner (passcode)';
const bad = (message) => Object.assign(new Error(message), { status: 400, code: 'bad_request' });
const str = (v) => (v == null || v === '' ? null : String(v));

/** The location filter from the query string, resolved once per request. */
async function loc(req) {
  const l = await resolveLocation({ where: req.query.where, minutes: Number(req.query.minutes) || 30, mode: str(req.query.mode) ?? 'car' });
  if (!l) return { loc: null, filter: null };
  return {
    loc: l,
    filter: l.unknown
      ? { unknown: true, where: l.where, message: 'Not a place we know yet — try a town or the first part of a postcode' }
      : { where: l.where, label: l.label, minutes: l.minutes, mode: l.mode, chip: `Showing: ${chipOf(l)}`, approx: l.approx, capped: l.capped, ...filterSays(l) },
  };
}

// ---------------------------------------------------------------------------
// Overview

deskRoutes.get('/overview', requires('view_library'), async (_req, res, next) => {
  try { res.json(await overview()); } catch (err) { next(err); }
});

/** The month's Google and Claude spend against budget — the Spend tile's own numbers, drawn atop Runs. */
deskRoutes.get('/overview/spend', requires('view_library'), async (_req, res, next) => {
  try { res.json(await spendThisMonth()); } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Changes

deskRoutes.get('/changes', requires('view_library'), async (req, res, next) => {
  try {
    res.json(await changesRepo.changes({
      area: str(req.query.area), who: str(req.query.who), q: str(req.query.q),
      limit: req.query.limit, offset: req.query.offset,
    }));
  } catch (err) { next(err); }
});

/**
 * POST /undo/:id — undo one change, whatever it was. The change row carries
 * its own inverse (`undo`), so the toast's Undo and the log cannot disagree.
 */
deskRoutes.post('/undo/:id', requires('manage_library'), async (req, res, next) => {
  try {
    const { rows: [change] } = await query('select * from bo_changes where id = $1', [String(req.params.id)]);
    if (!change) throw Object.assign(new Error('No such change.'), { status: 404 });
    if (change.undone_at) throw bad('That change has already been undone.');
    const u = change.undo;
    if (!u) throw bad('That change cannot be undone from here.');
    // Only the latest live change to a thing can be undone: undoing an older
    // one would write its before over a newer change (Codex, 28 Sep 2026).
    if (change.subject_type && change.subject_id) {
      const { rows: [newer] } = await query(
        `select id from bo_changes where subject_type = $1 and subject_id = $2 and undone_at is null and id <> $3
            and at > (select at from bo_changes where id = $3) limit 1`,
        [change.subject_type, change.subject_id, change.id]);
      if (newer) throw bad('A later change to the same thing stands; undo that one first.');
    }
    const by = who(req);
    if (u.kind === 'word_decision') await mapping.undo({ id: u.id, who: by });
    else if (u.kind === 'default') await categories.undoDefault({ change, who: by });
    else if (u.kind === 'subcategory_fact') await categories.undoFact({ change, who: by });
    else if (u.kind === 'correction') await facts.undoCorrection({ change, who: by });
    else if (u.kind === 'collection') await collections.undoCollection({ change, who: by });
    else if (u.kind === 'carry') {
      if (u.on) await query(`insert into taxonomy_label_carries (namespace, key, attribute_key, yesno) values ('google', $1, $2, true) on conflict do nothing`, [u.word, u.fact]);
      else await query(`delete from taxonomy_label_carries where namespace = 'google' and key = $1 and attribute_key = $2`, [u.word, u.fact]);
      await changesRepo.markUndone({ id: change.id, who: by });
    } else if (u.kind === 'link') {
      await categories.link({ a: u.a, b: u.b, who: by, on: u.on });
      await changesRepo.markUndone({ id: change.id, who: by });
    } else if (u.kind === 'setting') {
      await settingsRepo.setSetting(u.key, u.value, { who: by, what: `Undo · ${change.what}` });
      await changesRepo.markUndone({ id: change.id, who: by });
    } else throw bad('That change cannot be undone from here.');
    res.json({ undone: change.id });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Fact automations

deskRoutes.get('/settings', requires('view_library'), async (_req, res, next) => {
  try {
    const { values, meta } = await settingsRepo.settings();
    res.json({ values, meta, spec: settingsRepo.SETTINGS });
  } catch (err) { next(err); }
});

deskRoutes.put('/settings/:key', requires('manage_library'), async (req, res, next) => {
  try {
    // "What changed" is composed by the API from the key and value; a `what`
    // in the body is ignored (second audit CH.6).
    const out = await settingsRepo.setSetting(String(req.params.key), req.body?.value, { who: who(req) });
    res.json(out);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Mapping

deskRoutes.get('/mapping', requires('view_library'), async (_req, res, next) => {
  try { res.json(await mapping.mappingState()); } catch (err) { next(err); }
});

deskRoutes.get('/mapping/decisions', requires('view_library'), async (req, res, next) => {
  try { res.json(await mapping.decisions({ kind: str(req.query.kind) })); } catch (err) { next(err); }
});

/** The picker's catalogue: categories, subcategories and facts, searchable client-side. */
deskRoutes.get('/mapping/picker', requires('view_library'), async (_req, res, next) => {
  try {
    const [{ rows: cats }, { rows: subs }, { rows: facts_ }] = await Promise.all([
      query('select key, label from shelf_categories where active order by position, label'),
      query('select key, label, category_key from shelf_subcategories where active order by position, label'),
      query('select key, label, kind, standard from place_attributes where active order by label'),
    ]);
    res.json({ categories: cats, subcategories: subs.map((s) => ({ key: s.key, label: s.label, category: s.category_key })), facts: facts_ });
  } catch (err) { next(err); }
});

deskRoutes.put('/mapping/:word/targets', requires('manage_library'), async (req, res, next) => {
  try {
    res.json(await mapping.setTargets({
      word: String(req.params.word), subs: req.body?.subs, primary: str(req.body?.primary), why: str(req.body?.why), who: who(req),
    }));
  } catch (err) { next(err); }
});

deskRoutes.put('/mapping/:word/facts', requires('manage_library'), async (req, res, next) => {
  try {
    // A fact chip ticked or unticked in the picker: carried by every place the
    // word brings. Logged as Repointed (README: "picker edits are logged as
    // Repointed and are undoable") through the same decision path, so it is
    // in Decided as well as Changes and its Undo is the decision's.
    res.json(await mapping.setFact({
      word: String(req.params.word), fact: String(req.body?.fact ?? ''), on: req.body?.on !== false, why: str(req.body?.why), who: who(req),
    }));
  } catch (err) { next(err); }
});

deskRoutes.post('/mapping/:word/exclude', requires('manage_library'), async (req, res, next) => {
  try { res.json(await mapping.exclude({ word: String(req.params.word), why: str(req.body?.why), who: who(req) })); } catch (err) { next(err); }
});

deskRoutes.post('/mapping/:word/bring-back', requires('manage_library'), async (req, res, next) => {
  try { res.json(await mapping.bringBack({ word: String(req.params.word), why: str(req.body?.why), who: who(req) })); } catch (err) { next(err); }
});

deskRoutes.post('/mapping/proposals/:id', requires('manage_library'), async (req, res, next) => {
  try {
    const action = req.body?.action === 'keep' ? 'keep' : 'apply';
    res.json(await mapping.decideProposal({ id: String(req.params.id), action, why: str(req.body?.why), who: who(req) }));
  } catch (err) { next(err); }
});

deskRoutes.post('/mapping/decisions/:id/undo', requires('manage_library'), async (req, res, next) => {
  try { res.json(await mapping.undo({ id: String(req.params.id), who: who(req) })); } catch (err) { next(err); }
});

/**
 * POST /subcategories — "+ Create a new subcategory" from the picker. The
 * screen asks "Would a household browse this?" first (A4); the API needs the
 * answer to have been yes.
 */
deskRoutes.post('/subcategories', requires('manage_library'), async (req, res, next) => {
  try {
    if (req.body?.wouldBrowse !== true) throw bad('Would a household browse this? Only a yes makes a subcategory.');
    const label = String(req.body?.label ?? '').trim();
    const category = String(req.body?.category ?? '');
    if (!label) throw bad('Name it.');
    const key = label.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
    const { withTransaction } = await import('../db.js');
    const made = await withTransaction((c) => mapping.createSubcategory(c, { key, label, category }, who(req)));
    res.json({ key, label, category, made });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Categories

deskRoutes.get('/categories', requires('view_library'), async (req, res, next) => {
  try {
    const { loc: l, filter } = await loc(req);
    const out = await categories.subcategoryList({ cat: str(req.query.cat), q: str(req.query.q), loc: l && !l.unknown ? l : null });
    const { rows: cats } = await query('select key, label from shelf_categories where active order by position');
    res.json({ ...out, filter, categories: cats, reaches: REACHES, modes: MODES });
  } catch (err) { next(err); }
});

deskRoutes.get('/categories/impact', requires('view_library'), async (req, res, next) => {
  try {
    const subs = String(req.query.subs ?? '').split(',').filter(Boolean);
    res.json(await categories.bulkImpact({ subs, fact: String(req.query.fact ?? '') }));
  } catch (err) { next(err); }
});

deskRoutes.get('/categories/new-facts', requires('view_library'), async (_req, res, next) => {
  try { res.json(await categories.newFacts()); } catch (err) { next(err); }
});

deskRoutes.post('/categories/defaults', requires('manage_library'), async (req, res, next) => {
  try {
    res.json(await categories.setDefaults({
      subs: req.body?.subs, fact: String(req.body?.fact ?? ''), option: String(req.body?.option ?? ''), who: who(req), why: str(req.body?.why),
      bulk: req.body?.bulk === true,
    }));
  } catch (err) { next(err); }
});

deskRoutes.get('/subcategories/:key', requires('view_library'), async (req, res, next) => {
  try { res.json(await categories.subcategoryPage(String(req.params.key))); } catch (err) { next(err); }
});

deskRoutes.post('/subcategories/:key/defaults/:fact/accept', requires('manage_library'), async (req, res, next) => {
  try { res.json(await categories.acceptDefault({ sub: String(req.params.key), fact: String(req.params.fact), who: who(req) })); } catch (err) { next(err); }
});

deskRoutes.post('/subcategories/:key/facts/:fact/remove', requires('manage_library'), async (req, res, next) => {
  try { res.json(await categories.removeFact({ sub: String(req.params.key), fact: String(req.params.fact), who: who(req) })); } catch (err) { next(err); }
});

/** Review on a flagged default: the places here with a confirmed answer, beside the default. */
deskRoutes.get('/subcategories/:key/defaults/:fact/review', requires('view_library'), async (req, res, next) => {
  try { res.json(await categories.reviewDefault({ sub: String(req.params.key), fact: String(req.params.fact) })); } catch (err) { next(err); }
});

/** Copy facts from another subcategory: they arrive as Gathering evidence. */
deskRoutes.post('/subcategories/:key/copy-facts', requires('manage_library'), async (req, res, next) => {
  try { res.json(await categories.copyFacts({ to: String(req.params.key), from: String(req.body?.from ?? ''), who: who(req) })); } catch (err) { next(err); }
});

deskRoutes.post('/subcategories/:key/related', requires('manage_library'), async (req, res, next) => {
  try {
    res.json(await categories.link({ a: String(req.params.key), b: String(req.body?.other ?? ''), who: who(req), on: req.body?.on !== false }));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Facts

deskRoutes.get('/facts', requires('view_library'), async (req, res, next) => {
  try {
    res.json(await facts.allFacts({ q: str(req.query.q), cat: str(req.query.cat), sub: str(req.query.sub), status: str(req.query.status) }));
  } catch (err) { next(err); }
});

deskRoutes.get('/facts/excluded', requires('view_library'), async (_req, res, next) => {
  try { res.json({ rows: await facts.excludedFacts() }); } catch (err) { next(err); }
});

deskRoutes.post('/facts/excluded/:sub/:fact', requires('manage_library'), async (req, res, next) => {
  try {
    const mode = req.body?.mode === 'include_anyway' ? 'include_anyway' : 'put_back';
    res.json(await categories.restoreFact({ sub: String(req.params.sub), fact: String(req.params.fact), who: who(req), mode }));
  } catch (err) { next(err); }
});

deskRoutes.get('/facts/:key', requires('view_library'), async (req, res, next) => {
  try { res.json(await facts.factPage(String(req.params.key))); } catch (err) { next(err); }
});

deskRoutes.get('/facts/:key/places', requires('view_library'), async (req, res, next) => {
  try {
    res.json(await facts.factPlaces(String(req.params.key), {
      sub: str(req.query.sub), country: str(req.query.country), county: str(req.query.county), postcode: str(req.query.postcode), q: str(req.query.q),
    }));
  } catch (err) { next(err); }
});

deskRoutes.put('/places/:ref/facts/:fact', requires('manage_library'), async (req, res, next) => {
  try {
    res.json(await facts.correct({ ref: String(req.params.ref), fact: String(req.params.fact), option: String(req.body?.option ?? ''), why: str(req.body?.why), who: who(req) }));
  } catch (err) { next(err); }
});

deskRoutes.get('/verification', requires('view_library'), async (req, res, next) => {
  try { res.json(await verification.verification({ period: req.query.period === '7d' ? '7d' : '24h' })); } catch (err) { next(err); }
});

// Fact automations' header counts: verified, conflicts, don't know, backlog.
deskRoutes.get('/verification/month', requires('view_library'), async (_req, res, next) => {
  try { res.json(await verification.monthResults()); } catch (err) { next(err); }
});

deskRoutes.get('/verification/items', requires('view_library'), async (req, res, next) => {
  try {
    res.json(await verification.items({
      kind: String(req.query.kind ?? ''), period: str(req.query.period) ?? '7d', source: str(req.query.source),
      country: str(req.query.country), county: str(req.query.county), feature: str(req.query.feature),
    }));
  } catch (err) { next(err); }
});

deskRoutes.get('/accuracy', requires('view_library'), async (req, res, next) => {
  try {
    res.json(await accuracy.accuracy({
      view: req.query.view === 'category' ? 'category' : 'fact', source: str(req.query.source), chart: req.query.chart === 'daily' ? 'daily' : 'monthly',
    }));
  } catch (err) { next(err); }
});

deskRoutes.get('/accuracy/:kind/:key', requires('view_library'), async (req, res, next) => {
  try {
    const kind = ['fact', 'category', 'subcategory'].includes(req.params.kind) ? req.params.kind : 'fact';
    res.json(await accuracy.health({ kind, key: String(req.params.key), source: str(req.query.source) }));
  } catch (err) { next(err); }
});

deskRoutes.get('/accuracy/:kind/:key/disagreements', requires('view_library'), async (req, res, next) => {
  try {
    const kind = ['fact', 'category', 'subcategory'].includes(req.params.kind) ? req.params.kind : 'fact';
    res.json(await accuracy.disagreements({ kind, key: String(req.params.key), source: String(req.query.source ?? ''), q: str(req.query.q) }));
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Collections

deskRoutes.get('/collections', requires('view_library'), async (req, res, next) => {
  try {
    const { loc: l, filter } = await loc(req);
    res.json({ ...(await collections.collectionList({ loc: l && !l.unknown ? l : null })), filter, reaches: REACHES, modes: MODES });
  } catch (err) { next(err); }
});

deskRoutes.post('/collections/preview', requires('view_library'), async (req, res, next) => {
  try {
    const { loc: l } = await loc(req);
    res.json(await collections.preview({ rule: req.body?.rule, loc: l && !l.unknown ? l : null }));
  } catch (err) { next(err); }
});

deskRoutes.post('/collections', requires('manage_library'), async (req, res, next) => {
  try {
    res.json(await collections.saveCollection({ key: null, title: req.body?.title, copy: req.body?.copy, rule: req.body?.rule, who: who(req) }));
  } catch (err) { next(err); }
});

deskRoutes.put('/collections/:key', requires('manage_library'), async (req, res, next) => {
  try {
    res.json(await collections.saveCollection({ key: String(req.params.key), title: req.body?.title, copy: req.body?.copy, rule: req.body?.rule, who: who(req) }));
  } catch (err) { next(err); }
});

deskRoutes.get('/collections/as-household', requires('view_library'), async (req, res, next) => {
  try {
    let householdId = str(req.query.household);
    if (!householdId) householdId = req.account?.household_id ?? null;
    const { rows: households } = await query(
      `select h.id, h.name from households h where exists (select 1 from accounts a where a.household_id = h.id) order by h.created_at`);
    if (!householdId) householdId = households[0]?.id ?? null;
    if (!householdId) return res.json({ households: [], shown: [], hidden: [] });
    // The preview's own taps, never written: who it is seen as, and its
    // hearts as [{ key, member, days }]. Read through the same code as the
    // family's endpoint, so `inspire` and `list` are what they would get.
    let hearts = null;
    if (req.query.hearts != null) {
      try { hearts = JSON.parse(String(req.query.hearts)); } catch { hearts = null; }
      if (!Array.isArray(hearts)) hearts = null;
    }
    res.json({ ...(await collections.asHousehold({ householdId, seenAs: str(req.query.as), hearts })), households });
  } catch (err) { next(err); }
});

deskRoutes.get('/places/:ref/card', requires('view_library'), async (req, res, next) => {
  try { res.json(await collections.placeCard(String(req.params.ref))); } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Housekeeping the desk runs for itself (called from server.js at boot and
// daily): raise and retire mapping proposals.

export async function deskHousekeeping() {
  // Order matters: drop what has expired, check what is waiting, then work out
  // each drawer's facts from what has now been verified.
  const dropped = await pipeline.dropExpired().catch((err) => ({ error: err.message }));
  const checked = await pipeline.verifyBacklog({ limit: 200 }).catch((err) => ({ error: err.message }));
  const added = await pipeline.add().catch((err) => ({ error: err.message }));
  return { proposals: await refreshProposals(), narrowed: await mapping.refreshNarrowings(), dropped, checked, added };
}

/** The local open-map extracts, read only: which regions, when, how many places. */
deskRoutes.get('/osm', requires('view_library'), async (_req, res, next) => {
  try { res.json({ extracts: await osmExtracts(), switchedOn: String(process.env.EPIC_OSM_EXTRACT ?? '') || null }); } catch (err) { next(err); }
});

export default deskRoutes;
